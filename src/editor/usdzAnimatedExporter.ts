/**
 * Animated USDZ exporter.
 *
 * This is a TypeScript port of three.js' `USDZExporter`
 * (three/examples/jsm/exporters/USDZExporter.js, r181) with one feature added:
 * **transform animation**. The stock three.js exporter bakes a single static
 * `matrix4d xformOp:transform` per prim and has no animation support at all.
 *
 * The additions are intentionally surgical so the port stays easy to diff
 * against upstream:
 *   - `buildHeader` emits stage time metadata (`startTimeCode`, `endTimeCode`,
 *     `timeCodesPerSecond`, `framesPerSecond`) when animation is present.
 *   - `buildXform` emits `matrix4d xformOp:transform.timeSamples = { ... }`
 *     instead of the static transform for any object that has baked samples.
 *
 * Samples are full local matrices baked per frame (see
 * `createUsdzTransformAnimation` in gltfExport.ts), so USD's linear timeSample
 * interpolation reproduces the editor's eased motion faithfully. Apple AR Quick
 * Look and usdview both play transform timeSamples.
 */
import {
  type BufferAttribute,
  type BufferGeometry,
  Color,
  DoubleSide,
  type InterleavedBufferAttribute,
  type Material,
  type Matrix4,
  type Mesh,
  NoColorSpace,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Texture,
  type Vector2,
} from "three";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";

/** One baked local-transform sample for a single object. */
export interface UsdzTransformSample {
  timeCode: number;
  matrix: Matrix4;
}

/** Baked transform animation for an entire export, keyed by `Object3D.uuid`. */
export interface UsdzTransformAnimation {
  startTimeCode: number;
  endTimeCode: number;
  timeCodesPerSecond: number;
  framesPerSecond: number;
  samplesByObjectUuid: Map<string, UsdzTransformSample[]>;
}

export interface UsdzExportOptions {
  ar?: {
    anchoring?: { type?: string };
    planeAnchoring?: { alignment?: string };
  };
  includeAnchoringProperties?: boolean;
  onlyVisible?: boolean;
  quickLookCompatible?: boolean;
  maxTextureSize?: number;
  /** When supplied, animated objects are exported with timeSamples. */
  animation?: UsdzTransformAnimation | null;
}

type ResolvedOptions = Required<Omit<UsdzExportOptions, "animation">> & {
  animation: UsdzTransformAnimation | null;
};

type UsdzFiles = Record<string, Uint8Array | [Uint8Array, { extra: Record<number, Uint8Array> }] | null>;

function resolveUsdzOptions(options: UsdzExportOptions): ResolvedOptions {
  return {
    ar: {
      anchoring: { type: options.ar?.anchoring?.type ?? "plane" },
      planeAnchoring: { alignment: options.ar?.planeAnchoring?.alignment ?? "horizontal" },
    },
    includeAnchoringProperties: options.includeAnchoringProperties ?? true,
    onlyVisible: options.onlyVisible ?? true,
    quickLookCompatible: options.quickLookCompatible ?? false,
    maxTextureSize: options.maxTextureSize ?? 1024,
    animation: options.animation ?? null,
  };
}

type CanvasDrawableImage = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

// A loose view over the union of MeshStandardMaterial / MeshPhysicalMaterial
// properties the exporter reads. The host app converts every USDZ-bound
// material to MeshStandardMaterial first (see gltfExport.convertMaterialsForUsdz).
type PreviewMaterial = Material & {
  id: number;
  color: Color;
  emissive: Color;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  opacity: number;
  alphaTest: number;
  transparent: boolean;
  map: Texture | null;
  emissiveMap: Texture | null;
  normalMap: Texture | null;
  aoMap: Texture | null;
  aoMapIntensity: number;
  roughnessMap: Texture | null;
  metalnessMap: Texture | null;
  alphaMap: Texture | null;
  isMeshStandardMaterial?: boolean;
  isMeshPhysicalMaterial?: boolean;
  // Physical-only fields. Always read inside the `isMeshPhysicalMaterial` guard;
  // typed non-optional so the guarded branch type-checks.
  ior: number;
  clearcoat: number;
  clearcoatMap?: Texture | null;
  clearcoatRoughness: number;
  clearcoatRoughnessMap?: Texture | null;
};

interface UsdMetadataEntry {
  key: string;
  value: string | string[];
}

class USDNode {
  metadata: UsdMetadataEntry[];
  properties: Array<{ property: string; metadata: string[] }>;
  children: USDNode[];

  constructor(
    public name: string,
    public type = "",
    metadata: UsdMetadataEntry[] = [],
    properties: Array<{ property: string; metadata: string[] }> = [],
  ) {
    this.metadata = metadata;
    this.properties = properties;
    this.children = [];
  }

  addMetadata(key: string, value: string | string[]): void {
    this.metadata.push({ key, value });
  }

  addProperty(property: string, metadata: string[] = []): void {
    this.properties.push({ property, metadata });
  }

  addChild(child: USDNode): void {
    this.children.push(child);
  }

  toString(indent = 0): string {
    const pad = "\t".repeat(indent);

    const formattedMetadata = this.metadata.map((item) => {
      const key = item.key;
      const value = item.value;

      if (Array.isArray(value)) {
        const lines: string[] = [];
        lines.push(`${key} = {`);
        value.forEach((line) => {
          lines.push(`${pad}\t\t${line}`);
        });
        lines.push(`${pad}\t}`);
        return lines.join("\n");
      }

      return `${key} = ${value}`;
    });

    const meta = formattedMetadata.length
      ? ` (\n${formattedMetadata.map((l) => `${pad}\t${l}`).join("\n")}\n${pad})`
      : "";

    const properties = this.properties.map((l) => {
      const property = l.property;
      const metadata = l.metadata.length
        ? ` (\n${l.metadata.map((m) => `${pad}\t\t${m}`).join("\n")}\n${pad}\t)`
        : "";
      return `${pad}\t${property}${metadata}`;
    });
    const children = this.children.map((c) => c.toString(indent + 1));

    const bodyLines: string[] = [];

    if (properties.length > 0) {
      bodyLines.push(...properties);
    }

    if (children.length > 0) {
      if (properties.length > 0) {
        bodyLines.push("");
      }

      for (let i = 0; i < children.length; i++) {
        bodyLines.push(children[i]);
        if (i < children.length - 1) {
          bodyLines.push("");
        }
      }
    }

    const bodyContent = bodyLines.join("\n");
    const type = this.type ? this.type + " " : "";

    return `${pad}def ${type}"${this.name}"${meta}\n${pad}{\n${bodyContent}\n${pad}}`;
  }
}

interface TextureUtils {
  decompress(texture: Texture): Promise<Texture>;
}

/**
 * Drop-in replacement for three's `USDZExporter` that additionally honors an
 * `animation` option to emit transform timeSamples.
 */
export class AnimatedUSDZExporter {
  textureUtils: TextureUtils | null = null;

  setTextureUtils(utils: TextureUtils): void {
    this.textureUtils = utils;
  }

  /**
   * Builds just the `model.usda` document text (no zipping, no texture
   * encoding). Useful for tests and tooling that need to inspect the authored
   * USD without depending on the zip step — which in turn depends on a real
   * `Uint8Array`/`TextEncoder` realm (jsdom mismatches break fflate's instanceof
   * checks, even though real browsers are fine).
   */
  buildModelUsda(scene: Object3D, options: UsdzExportOptions = {}): string {
    const resolved = resolveUsdzOptions(options);
    const usedNames = new Set<string>();
    const files: UsdzFiles = { "model.usda": null };
    return buildModelDocument(scene, resolved, usedNames, files).output;
  }

  async parseAsync(scene: Object3D, options: UsdzExportOptions = {}): Promise<Uint8Array> {
    const resolved = resolveUsdzOptions(options);

    const usedNames = new Set<string>();
    const files: UsdzFiles = {};
    const modelFileName = "model.usda";

    // model file should be first in USDZ archive so we init it here
    files[modelFileName] = null;

    const { output, textures } = buildModelDocument(scene, resolved, usedNames, files);

    files[modelFileName] = strToU8(output);

    for (const id in textures) {
      let texture = textures[id];

      if ((texture as Texture & { isCompressedTexture?: boolean }).isCompressedTexture === true) {
        if (this.textureUtils === null) {
          throw new Error(
            "AnimatedUSDZExporter: setTextureUtils() must be called to process compressed textures.",
          );
        }
        texture = await this.textureUtils.decompress(texture);
      }

      const canvas = imageToCanvas(texture.image as CanvasDrawableImage, texture.flipY, resolved.maxTextureSize);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
      if (!blob) {
        throw new Error("AnimatedUSDZExporter: Unable to encode texture to PNG.");
      }

      files[`textures/Texture_${id}.png`] = new Uint8Array(await blob.arrayBuffer());
    }

    // 64 byte alignment
    // https://github.com/101arrowz/fflate/issues/39#issuecomment-777263109
    let offset = 0;

    for (const filename in files) {
      const file = files[filename] as Uint8Array;
      const headerSize = 34 + filename.length;

      offset += headerSize;

      const offsetMod64 = offset & 63;

      if (offsetMod64 !== 4) {
        const padLength = 64 - offsetMod64;
        const padding = new Uint8Array(padLength);

        files[filename] = [file, { extra: { 12345: padding } }];
      }

      offset = file.length;
    }

    return zipSync(files as Parameters<typeof zipSync>[0], { level: 0 });
  }
}

function getName(object: Object3D, namesSet: Set<string>): string {
  let name = object.name;
  name = name.replace(/[^A-Za-z0-9_]/g, "");
  if (/^[0-9]/.test(name)) {
    name = "_" + name;
  }

  if (name === "") {
    name = (object as Object3D & { isCamera?: boolean }).isCamera ? "Camera" : "Object";
  }

  if (namesSet.has(name)) {
    name = name + "_" + object.id;
  }

  namesSet.add(name);

  return name;
}

function imageToCanvas(image: CanvasDrawableImage, flipY: boolean, maxTextureSize: number): HTMLCanvasElement {
  if (
    (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas) ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
  ) {
    const scale = maxTextureSize / Math.max(image.width, image.height);

    const canvas = document.createElement("canvas");
    canvas.width = image.width * Math.min(1, scale);
    canvas.height = image.height * Math.min(1, scale);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("AnimatedUSDZExporter: Unable to acquire 2D canvas context.");
    }

    if (flipY === true) {
      context.translate(0, canvas.height);
      context.scale(1, -1);
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
  }

  throw new Error("AnimatedUSDZExporter: No valid image data found. Unable to process texture.");
}

const PRECISION = 7;

function buildHeader(animation: UsdzTransformAnimation | null): string {
  const timeMetadata = animation
    ? `\tstartTimeCode = ${formatTimeCode(animation.startTimeCode)}\n` +
      `\tendTimeCode = ${formatTimeCode(animation.endTimeCode)}\n` +
      `\ttimeCodesPerSecond = ${animation.timeCodesPerSecond}\n` +
      `\tframesPerSecond = ${animation.framesPerSecond}\n`
    : "";

  return `#usda 1.0
(
	customLayerData = {
		string creator = "3Forge AnimatedUSDZExporter"
	}
	defaultPrim = "Root"
	metersPerUnit = 1
${timeMetadata}	upAxis = "Y"
)
`;
}

function formatTimeCode(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  // Trim noisy floats but keep enough precision for non-integer frame rates.
  return String(Number(value.toFixed(4)));
}

// Xform

function buildXform(object: Object3D, usedNames: Set<string>, animation: UsdzTransformAnimation | null): USDNode {
  const name = getName(object, usedNames);
  const samples = animation?.samplesByObjectUuid.get(object.uuid);

  if (object.matrix.determinant() < 0) {
    console.warn("AnimatedUSDZExporter: USDZ does not support negative scales", object);
  }

  const node = new USDNode(name, "Xform");

  if (samples && samples.length > 0) {
    node.addProperty(buildTransformTimeSamples(samples));
  } else {
    node.addProperty(`matrix4d xformOp:transform = ${buildMatrix(object.matrix)}`);
  }
  node.addProperty('uniform token[] xformOpOrder = ["xformOp:transform"]');

  return node;
}

function buildTransformTimeSamples(samples: UsdzTransformSample[]): string {
  const lines = samples
    .map((sample) => `\t\t\t${formatTimeCode(sample.timeCode)}: ${buildMatrix(sample.matrix)},`)
    .join("\n");
  return `matrix4d xformOp:transform.timeSamples = {\n${lines}\n\t\t}`;
}

function buildMesh(object: Mesh, geometry: BufferGeometry, material: PreviewMaterial, usedNames: Set<string>, animation: UsdzTransformAnimation | null): USDNode {
  const node = buildXform(object, usedNames, animation);

  node.addMetadata("prepend references", `@./geometries/Geometry_${geometry.id}.usda@</Geometry>`);
  node.addMetadata("prepend apiSchemas", '["MaterialBindingAPI"]');

  node.addProperty(`rel material:binding = </Materials/Material_${material.id}>`);

  return node;
}

function buildMatrix(matrix: Matrix4): string {
  const array = matrix.elements;

  return `( ${buildMatrixRow(array, 0)}, ${buildMatrixRow(array, 4)}, ${buildMatrixRow(array, 8)}, ${buildMatrixRow(array, 12)} )`;
}

function buildMatrixRow(array: ArrayLike<number>, offset: number): string {
  return `(${array[offset + 0]}, ${array[offset + 1]}, ${array[offset + 2]}, ${array[offset + 3]})`;
}

function buildModelDocument(
  scene: Object3D,
  resolved: ResolvedOptions,
  usedNames: Set<string>,
  files: UsdzFiles,
): { output: string; textures: Record<string, Texture> } {
  const root = new USDNode("Root", "Xform");
  const scenesNode = new USDNode("Scenes", "Scope");
  scenesNode.addMetadata("kind", '"sceneLibrary"');
  root.addChild(scenesNode);

  const sceneName = "Scene";
  const sceneNode = new USDNode(sceneName, "Xform");
  sceneNode.addMetadata("customData", [
    "bool preliminary_collidesWithEnvironment = 0",
    `string sceneName = "${sceneName}"`,
  ]);
  sceneNode.addMetadata("sceneName", `"${sceneName}"`);
  if (resolved.includeAnchoringProperties) {
    sceneNode.addProperty(`token preliminary:anchoring:type = "${resolved.ar.anchoring!.type}"`);
    sceneNode.addProperty(`token preliminary:planeAnchoring:alignment = "${resolved.ar.planeAnchoring!.alignment}"`);
  }

  scenesNode.addChild(sceneNode);

  const materials: Record<string, PreviewMaterial> = {};
  const textures: Record<string, Texture> = {};

  buildHierarchy(scene, sceneNode, materials, usedNames, files, resolved);

  const materialsNode = buildMaterials(materials, textures, resolved.quickLookCompatible);

  const output = buildHeader(resolved.animation) + "\n" + root.toString() + "\n\n" + materialsNode.toString();

  return { output, textures };
}

function buildHierarchy(
  object: Object3D,
  parentNode: USDNode,
  materials: Record<string, PreviewMaterial>,
  usedNames: Set<string>,
  files: UsdzFiles,
  options: ResolvedOptions,
): void {
  for (let i = 0, l = object.children.length; i < l; i++) {
    const child = object.children[i] as Object3D & {
      isMesh?: boolean;
      isCamera?: boolean;
      geometry?: BufferGeometry;
      material?: Material;
    };

    if (child.visible === false && options.onlyVisible === true) continue;

    let childNode: USDNode | undefined;

    if (child.isMesh && child.geometry && child.material) {
      const geometry = child.geometry;
      const material = child.material as PreviewMaterial;

      if (material.isMeshStandardMaterial) {
        const geometryFileName = "geometries/Geometry_" + geometry.id + ".usda";

        if (!(geometryFileName in files)) {
          const meshObject = buildMeshObject(geometry);
          files[geometryFileName] = strToU8(buildHeader(null) + "\n" + meshObject.toString());
        }

        if (!(material.uuid in materials)) {
          materials[material.uuid] = material;
        }

        childNode = buildMesh(child as Mesh, geometry, materials[material.uuid], usedNames, options.animation);
      } else {
        console.warn(
          "AnimatedUSDZExporter: Unsupported material type (USDZ only supports MeshStandardMaterial)",
          child,
        );
      }
    } else if (child.isCamera) {
      childNode = buildCamera(child as PerspectiveCamera & OrthographicCamera, usedNames);
    } else {
      childNode = buildXform(child, usedNames, options.animation);
    }

    if (childNode) {
      parentNode.addChild(childNode);
      buildHierarchy(child, childNode, materials, usedNames, files, options);
    }
  }
}

// Mesh

function buildMeshObject(geometry: BufferGeometry): USDNode {
  const node = new USDNode("Geometry");
  node.addChild(buildMeshNode(geometry));
  return node;
}

function buildMeshNode(geometry: BufferGeometry): USDNode {
  const name = "Geometry";
  const attributes = geometry.attributes;
  const count = attributes.position.count;

  const node = new USDNode(name, "Mesh");

  node.addProperty(`int[] faceVertexCounts = [${buildMeshVertexCount(geometry)}]`);
  node.addProperty(`int[] faceVertexIndices = [${buildMeshVertexIndices(geometry)}]`);
  node.addProperty(`normal3f[] normals = [${buildVector3Array(attributes.normal, count)}]`, ['interpolation = "vertex"']);
  node.addProperty(`point3f[] points = [${buildVector3Array(attributes.position, count)}]`);

  for (let i = 0; i < 4; i++) {
    const id = i > 0 ? i : "";
    const attribute = attributes["uv" + id];
    if (attribute !== undefined) {
      node.addProperty(`texCoord2f[] primvars:st${id} = [${buildVector2Array(attribute)}]`, ['interpolation = "vertex"']);
    }
  }

  const colorAttribute = attributes.color;
  if (colorAttribute !== undefined) {
    node.addProperty(
      `color3f[] primvars:displayColor = [${buildVector3Array(colorAttribute, count)}]`,
      ['interpolation = "vertex"'],
    );
  }

  node.addProperty('uniform token subdivisionScheme = "none"');

  return node;
}

function buildMeshVertexCount(geometry: BufferGeometry): string {
  const count = geometry.index !== null ? geometry.index.count : geometry.attributes.position.count;
  return Array(count / 3).fill(3).join(", ");
}

function buildMeshVertexIndices(geometry: BufferGeometry): string {
  const index = geometry.index;
  const array: number[] = [];

  if (index !== null) {
    for (let i = 0; i < index.count; i++) {
      array.push(index.getX(i));
    }
  } else {
    const length = geometry.attributes.position.count;
    for (let i = 0; i < length; i++) {
      array.push(i);
    }
  }

  return array.join(", ");
}

function buildVector3Array(attribute: BufferAttribute | InterleavedBufferAttribute | undefined, count: number): string {
  if (attribute === undefined) {
    console.warn("AnimatedUSDZExporter: Normals missing.");
    return Array(count).fill("(0, 0, 0)").join(", ");
  }

  const array: string[] = [];

  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i);
    const y = attribute.getY(i);
    const z = attribute.getZ(i);

    array.push(`(${x.toPrecision(PRECISION)}, ${y.toPrecision(PRECISION)}, ${z.toPrecision(PRECISION)})`);
  }

  return array.join(", ");
}

function buildVector2Array(attribute: BufferAttribute | InterleavedBufferAttribute): string {
  const array: string[] = [];

  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i);
    const y = attribute.getY(i);

    array.push(`(${x.toPrecision(PRECISION)}, ${(1 - y).toPrecision(PRECISION)})`);
  }

  return array.join(", ");
}

// Materials

function buildMaterials(
  materials: Record<string, PreviewMaterial>,
  textures: Record<string, Texture>,
  quickLookCompatible = false,
): USDNode {
  const materialsNode = new USDNode("Materials");

  for (const uuid in materials) {
    const material = materials[uuid];
    materialsNode.addChild(buildMaterial(material, textures, quickLookCompatible));
  }

  return materialsNode;
}

function buildMaterial(material: PreviewMaterial, textures: Record<string, Texture>, quickLookCompatible = false): USDNode {
  // https://graphics.pixar.com/usd/docs/UsdPreviewSurface-Proposal.html

  const materialNode = new USDNode(`Material_${material.id}`, "Material");

  function buildTextureNodes(texture: Texture, mapType: string, color?: Color): USDNode[] {
    const id = texture.source.id + "_" + texture.flipY;

    textures[id] = texture;

    const uv = texture.channel > 0 ? "st" + texture.channel : "st";

    const WRAPPINGS: Record<number, string> = {
      1000: "repeat", // RepeatWrapping
      1001: "clamp", // ClampToEdgeWrapping
      1002: "mirror", // MirroredRepeatWrapping
    };

    const repeat = texture.repeat.clone();
    const offset = texture.offset.clone();
    const rotation = texture.rotation;

    const xRotationOffset = Math.sin(rotation);
    const yRotationOffset = Math.cos(rotation);

    offset.y = 1 - offset.y - repeat.y;

    if (quickLookCompatible) {
      offset.x = offset.x / repeat.x;
      offset.y = offset.y / repeat.y;

      offset.x += xRotationOffset / repeat.x;
      offset.y += yRotationOffset - 1;
    } else {
      offset.x += xRotationOffset * repeat.x;
      offset.y += (1 - yRotationOffset) * repeat.y;
    }

    const primvarReaderNode = new USDNode(`PrimvarReader_${mapType}`, "Shader");
    primvarReaderNode.addProperty('uniform token info:id = "UsdPrimvarReader_float2"');
    primvarReaderNode.addProperty("float2 inputs:fallback = (0.0, 0.0)");
    primvarReaderNode.addProperty(`string inputs:varname = "${uv}"`);
    primvarReaderNode.addProperty("float2 outputs:result");

    const transform2dNode = new USDNode(`Transform2d_${mapType}`, "Shader");
    transform2dNode.addProperty('uniform token info:id = "UsdTransform2d"');
    transform2dNode.addProperty(
      `float2 inputs:in.connect = </Materials/Material_${material.id}/PrimvarReader_${mapType}.outputs:result>`,
    );
    transform2dNode.addProperty(`float inputs:rotation = ${(rotation * (180 / Math.PI)).toFixed(PRECISION)}`);
    transform2dNode.addProperty(`float2 inputs:scale = ${buildVector2(repeat)}`);
    transform2dNode.addProperty(`float2 inputs:translation = ${buildVector2(offset)}`);
    transform2dNode.addProperty("float2 outputs:result");

    const textureNode = new USDNode(`Texture_${texture.id}_${mapType}`, "Shader");
    textureNode.addProperty('uniform token info:id = "UsdUVTexture"');
    textureNode.addProperty(`asset inputs:file = @textures/Texture_${id}.png@`);
    textureNode.addProperty(
      `float2 inputs:st.connect = </Materials/Material_${material.id}/Transform2d_${mapType}.outputs:result>`,
    );

    if (color !== undefined) {
      textureNode.addProperty(`float4 inputs:scale = ${buildColor4(color)}`);
    }

    if (mapType === "normal") {
      textureNode.addProperty("float4 inputs:scale = (2, 2, 2, 1)");
      textureNode.addProperty("float4 inputs:bias = (-1, -1, -1, 0)");
    }

    textureNode.addProperty(
      `token inputs:sourceColorSpace = "${texture.colorSpace === NoColorSpace ? "raw" : "sRGB"}"`,
    );
    textureNode.addProperty(`token inputs:wrapS = "${WRAPPINGS[texture.wrapS]}"`);
    textureNode.addProperty(`token inputs:wrapT = "${WRAPPINGS[texture.wrapT]}"`);
    textureNode.addProperty("float outputs:r");
    textureNode.addProperty("float outputs:g");
    textureNode.addProperty("float outputs:b");
    textureNode.addProperty("float3 outputs:rgb");

    if (material.transparent || material.alphaTest > 0.0) {
      textureNode.addProperty("float outputs:a");
    }

    return [primvarReaderNode, transform2dNode, textureNode];
  }

  if (material.side === DoubleSide) {
    console.warn("AnimatedUSDZExporter: USDZ does not support double sided materials", material);
  }

  const previewSurfaceNode = new USDNode("PreviewSurface", "Shader");
  previewSurfaceNode.addProperty('uniform token info:id = "UsdPreviewSurface"');

  if (material.map !== null) {
    previewSurfaceNode.addProperty(
      `color3f inputs:diffuseColor.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:rgb>`,
    );

    if (material.transparent) {
      previewSurfaceNode.addProperty(
        `float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:a>`,
      );
    } else if (material.alphaTest > 0.0) {
      previewSurfaceNode.addProperty(
        `float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:a>`,
      );
      previewSurfaceNode.addProperty(`float inputs:opacityThreshold = ${material.alphaTest}`);
    }

    buildTextureNodes(material.map, "diffuse", material.color).forEach((node) => materialNode.addChild(node));
  } else {
    previewSurfaceNode.addProperty(`color3f inputs:diffuseColor = ${buildColor(material.color)}`);
  }

  if (material.emissiveMap !== null) {
    previewSurfaceNode.addProperty(
      `color3f inputs:emissiveColor.connect = </Materials/Material_${material.id}/Texture_${material.emissiveMap.id}_emissive.outputs:rgb>`,
    );

    const emissiveColor = new Color(
      material.emissive.r * material.emissiveIntensity,
      material.emissive.g * material.emissiveIntensity,
      material.emissive.b * material.emissiveIntensity,
    );
    buildTextureNodes(material.emissiveMap, "emissive", emissiveColor).forEach((node) => materialNode.addChild(node));
  } else if (material.emissive.getHex() > 0) {
    previewSurfaceNode.addProperty(`color3f inputs:emissiveColor = ${buildColor(material.emissive)}`);
  }

  if (material.normalMap !== null) {
    previewSurfaceNode.addProperty(
      `normal3f inputs:normal.connect = </Materials/Material_${material.id}/Texture_${material.normalMap.id}_normal.outputs:rgb>`,
    );

    buildTextureNodes(material.normalMap, "normal").forEach((node) => materialNode.addChild(node));
  }

  if (material.aoMap !== null) {
    previewSurfaceNode.addProperty(
      `float inputs:occlusion.connect = </Materials/Material_${material.id}/Texture_${material.aoMap.id}_occlusion.outputs:r>`,
    );

    const aoColor = new Color(material.aoMapIntensity, material.aoMapIntensity, material.aoMapIntensity);
    buildTextureNodes(material.aoMap, "occlusion", aoColor).forEach((node) => materialNode.addChild(node));
  }

  if (material.roughnessMap !== null) {
    previewSurfaceNode.addProperty(
      `float inputs:roughness.connect = </Materials/Material_${material.id}/Texture_${material.roughnessMap.id}_roughness.outputs:g>`,
    );

    const roughnessColor = new Color(material.roughness, material.roughness, material.roughness);
    buildTextureNodes(material.roughnessMap, "roughness", roughnessColor).forEach((node) => materialNode.addChild(node));
  } else {
    previewSurfaceNode.addProperty(`float inputs:roughness = ${material.roughness}`);
  }

  if (material.metalnessMap !== null) {
    previewSurfaceNode.addProperty(
      `float inputs:metallic.connect = </Materials/Material_${material.id}/Texture_${material.metalnessMap.id}_metallic.outputs:b>`,
    );

    const metalnessColor = new Color(material.metalness, material.metalness, material.metalness);
    buildTextureNodes(material.metalnessMap, "metallic", metalnessColor).forEach((node) => materialNode.addChild(node));
  } else {
    previewSurfaceNode.addProperty(`float inputs:metallic = ${material.metalness}`);
  }

  if (material.alphaMap !== null) {
    previewSurfaceNode.addProperty(
      `float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.alphaMap.id}_opacity.outputs:r>`,
    );
    previewSurfaceNode.addProperty("float inputs:opacityThreshold = 0.0001");

    buildTextureNodes(material.alphaMap, "opacity").forEach((node) => materialNode.addChild(node));
  } else {
    previewSurfaceNode.addProperty(`float inputs:opacity = ${material.opacity}`);
  }

  if (material.isMeshPhysicalMaterial) {
    if (material.clearcoatMap != null) {
      previewSurfaceNode.addProperty(
        `float inputs:clearcoat.connect = </Materials/Material_${material.id}/Texture_${material.clearcoatMap.id}_clearcoat.outputs:r>`,
      );

      const clearcoatColor = new Color(material.clearcoat, material.clearcoat, material.clearcoat);
      buildTextureNodes(material.clearcoatMap, "clearcoat", clearcoatColor).forEach((node) => materialNode.addChild(node));
    } else {
      previewSurfaceNode.addProperty(`float inputs:clearcoat = ${material.clearcoat}`);
    }

    if (material.clearcoatRoughnessMap != null) {
      previewSurfaceNode.addProperty(
        `float inputs:clearcoatRoughness.connect = </Materials/Material_${material.id}/Texture_${material.clearcoatRoughnessMap.id}_clearcoatRoughness.outputs:g>`,
      );

      const clearcoatRoughnessColor = new Color(
        material.clearcoatRoughness,
        material.clearcoatRoughness,
        material.clearcoatRoughness,
      );
      buildTextureNodes(material.clearcoatRoughnessMap, "clearcoatRoughness", clearcoatRoughnessColor).forEach(
        (node) => materialNode.addChild(node),
      );
    } else {
      previewSurfaceNode.addProperty(`float inputs:clearcoatRoughness = ${material.clearcoatRoughness}`);
    }

    previewSurfaceNode.addProperty(`float inputs:ior = ${material.ior}`);
  }

  previewSurfaceNode.addProperty("int inputs:useSpecularWorkflow = 0");
  previewSurfaceNode.addProperty("token outputs:surface");

  materialNode.addChild(previewSurfaceNode);

  materialNode.addProperty(
    `token outputs:surface.connect = </Materials/Material_${material.id}/PreviewSurface.outputs:surface>`,
  );

  return materialNode;
}

function buildColor(color: Color): string {
  return `(${color.r}, ${color.g}, ${color.b})`;
}

function buildColor4(color: Color): string {
  return `(${color.r}, ${color.g}, ${color.b}, 1.0)`;
}

function buildVector2(vector: Vector2): string {
  return `(${vector.x}, ${vector.y})`;
}

function buildCamera(camera: PerspectiveCamera & OrthographicCamera, usedNames: Set<string>): USDNode {
  const name = getName(camera, usedNames);

  const transform = buildMatrix(camera.matrix);

  if (camera.matrix.determinant() < 0) {
    console.warn("AnimatedUSDZExporter: USDZ does not support negative scales", camera);
  }

  const node = new USDNode(name, "Camera");
  node.addProperty(`matrix4d xformOp:transform = ${transform}`);
  node.addProperty('uniform token[] xformOpOrder = ["xformOp:transform"]');

  const isOrthographic = (camera as OrthographicCamera).isOrthographicCamera === true;
  const projection = isOrthographic ? "orthographic" : "perspective";
  node.addProperty(`token projection = "${projection}"`);

  const clippingRange = `(${camera.near.toPrecision(PRECISION)}, ${camera.far.toPrecision(PRECISION)})`;
  node.addProperty(`float2 clippingRange = ${clippingRange}`);

  let horizontalAperture: string;
  if (isOrthographic) {
    horizontalAperture = ((Math.abs(camera.left) + Math.abs(camera.right)) * 10).toPrecision(PRECISION);
  } else {
    horizontalAperture = camera.getFilmWidth().toPrecision(PRECISION);
  }

  node.addProperty(`float horizontalAperture = ${horizontalAperture}`);

  let verticalAperture: string;
  if (isOrthographic) {
    verticalAperture = ((Math.abs(camera.top) + Math.abs(camera.bottom)) * 10).toPrecision(PRECISION);
  } else {
    verticalAperture = camera.getFilmHeight().toPrecision(PRECISION);
  }

  node.addProperty(`float verticalAperture = ${verticalAperture}`);

  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    node.addProperty(`float focalLength = ${camera.getFocalLength().toPrecision(PRECISION)}`);
    node.addProperty(`float focusDistance = ${camera.focus.toPrecision(PRECISION)}`);
  }

  return node;
}

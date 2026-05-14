import {
  AnimationClip as ThreeAnimationClip,
  BackSide,
  BasicDepthPacking,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  Euler,
  FrontSide,
  Group,
  IcosahedronGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshNormalMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RGBADepthPacking,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  RingGeometry,
  TetrahedronGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
  TorusKnotGeometry,
  VectorKeyframeTrack,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { evaluateAnimationTrackValue, frameToSeconds, getAnimationValue, isTrackMuted, sortTrackKeyframes } from "./animation";
import { decodeDataUrl } from "./exportPackage";
import { DEFAULT_FONT_ID, getAvailableFonts, parseFontAsset } from "./fonts";
import { containsUsdcMagic } from "./modelBuffer";
import { awaitTextureLoadsDuring } from "./textureLoadWait";
import type { AnimationClip, AnimationPropertyPath, AnimationTrack, ComponentBlueprint, EditorNode, ImageAsset, ImageNode, MaterialSpec, ModelAsset, NodeOriginSpec, TextNode } from "./types";

type MaterialBaseOptions = Record<string, unknown>;

export async function createBlueprintExportGroup(blueprint: ComponentBlueprint): Promise<Group> {
  const builder = new BlueprintObjectBuilder(blueprint);
  return builder.build();
}

export async function exportBlueprintToGltfJson(blueprint: ComponentBlueprint): Promise<string> {
  const group = await createBlueprintExportGroup(blueprint);
  const result = await exportGroup(group, false, createGltfAnimationClips(blueprint, group));
  if (result instanceof ArrayBuffer) {
    throw new Error("Expected GLTF JSON export.");
  }

  return JSON.stringify(result, null, 2);
}

export async function exportBlueprintToGlbBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  const group = await createBlueprintExportGroup(blueprint);
  const result = await exportGroup(group, true, createGltfAnimationClips(blueprint, group));
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("Expected GLB binary export.");
  }

  return new Blob([result], { type: "model/gltf-binary" });
}

export async function exportBlueprintToUsdzBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  const group = await createBlueprintExportGroup(blueprint);
  group.updateMatrixWorld(true);
  convertMaterialsForUsdz(group);
  normalizeTexturesForCanvasExport(group);
  const result = await new USDZExporter().parseAsync(group);
  return new Blob([result as BlobPart], { type: "model/vnd.usdz+zip" });
}

export function convertMaterialsForUsdz(group: Group): void {
  group.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => convertMaterialForUsdz(material));
      return;
    }
    object.material = convertMaterialForUsdz(object.material);
  });
}

function convertMaterialForUsdz(material: Material): Material {
  if ((material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
    return material;
  }

  const source = material as Material & {
    color?: Color;
    map?: Texture | null;
    emissive?: Color;
    emissiveMap?: Texture | null;
    emissiveIntensity?: number;
    normalMap?: Texture | null;
  };

  const replacement = new MeshStandardMaterial({
    color: source.color instanceof Color ? source.color.clone() : new Color(0xffffff),
    metalness: 0,
    roughness: 1,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
  });

  if (source.map) {
    replacement.map = source.map;
  }
  if (source.emissive instanceof Color) {
    replacement.emissive = source.emissive.clone();
  }
  if (source.emissiveMap) {
    replacement.emissiveMap = source.emissiveMap;
  }
  if (typeof source.emissiveIntensity === "number") {
    replacement.emissiveIntensity = source.emissiveIntensity;
  }
  if (source.normalMap) {
    replacement.normalMap = source.normalMap;
  }

  replacement.name = material.name;
  return replacement;
}

export async function exportBlueprintToGltfBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  return new Blob([await exportBlueprintToGltfJson(blueprint)], { type: "model/gltf+json" });
}

async function exportGroup(
  group: Group,
  binary: boolean,
  animations: ThreeAnimationClip[] = [],
): Promise<ArrayBuffer | { [key: string]: unknown }> {
  normalizeTexturesForCanvasExport(group);
  const scene = new Scene();
  scene.name = group.name;
  scene.add(group);

  const exporter = new GLTFExporter();
  return exporter.parseAsync(scene, {
    animations,
    binary,
    onlyVisible: false,
    trs: true,
  });
}

export function normalizeTexturesForCanvasExport(group: Group): void {
  group.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!value || typeof value !== "object" || !("isTexture" in value) || value.isTexture !== true) {
          continue;
        }

        normalizeTextureForCanvasExport(value as Texture);
      }
    }
  });
}

function normalizeTextureForCanvasExport(texture: Texture): void {
  const image = texture.image as unknown;
  if (!image || (isCanvasDrawableImage(image) && !hasDataTextureShape(image))) {
    return;
  }

  const canvas = textureImageToCanvas(image);
  if (!canvas) {
    return;
  }

  texture.image = canvas;
  texture.needsUpdate = true;
}

function textureImageToCanvas(image: unknown): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = getTextureImageSize(image);
  if (!size) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  if (hasDataTextureShape(image)) {
    const pixelCount = size.width * size.height;
    const source = image.data;
    const channelCount = Math.max(1, Math.floor(source.length / pixelCount));
    const rgba = new Uint8ClampedArray(pixelCount * 4);

    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const src = pixel * channelCount;
      const dst = pixel * 4;
      rgba[dst + 0] = source[src + 0] ?? 0;
      rgba[dst + 1] = source[src + 1] ?? source[src + 0] ?? 0;
      rgba[dst + 2] = source[src + 2] ?? source[src + 0] ?? 0;
      rgba[dst + 3] = source[src + 3] ?? 255;
    }

    const imageData = createCanvasImageData(context, rgba, size.width, size.height);
    if (!imageData) {
      return null;
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  if (isCanvasDrawableImage(image)) {
    try {
      context.drawImage(image, 0, 0, size.width, size.height);
      return canvas;
    } catch (error) {
      console.warn("Unable to normalize texture image for export:", error);
    }
  }

  return null;
}

function createCanvasImageData(
  context: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData | null {
  if (typeof ImageData !== "undefined") {
    const imageDataArray = new Uint8ClampedArray(data.length);
    imageDataArray.set(data);
    return new ImageData(imageDataArray, width, height);
  }

  if (typeof context.createImageData === "function") {
    const imageData = context.createImageData(width, height);
    imageData.data.set(data);
    return imageData;
  }

  return null;
}

function getTextureImageSize(image: unknown): { width: number; height: number } | null {
  if (!image || typeof image !== "object") {
    return null;
  }

  const source = image as { width?: unknown; height?: unknown; videoWidth?: unknown; videoHeight?: unknown };
  const width = typeof source.width === "number"
    ? source.width
    : typeof source.videoWidth === "number"
      ? source.videoWidth
      : 0;
  const height = typeof source.height === "number"
    ? source.height
    : typeof source.videoHeight === "number"
      ? source.videoHeight
      : 0;

  return width > 0 && height > 0 ? { width, height } : null;
}

function hasDataTextureShape(image: unknown): image is { data: ArrayLike<number>; width: number; height: number } {
  return !!image
    && typeof image === "object"
    && "data" in image
    && "width" in image
    && "height" in image
    && typeof (image as { width?: unknown }).width === "number"
    && typeof (image as { height?: unknown }).height === "number"
    && isArrayLikeNumberData((image as { data?: unknown }).data);
}

function isArrayLikeNumberData(value: unknown): value is ArrayLike<number> {
  return !!value
    && typeof value === "object"
    && "length" in value
    && typeof (value as { length?: unknown }).length === "number";
}

function isCanvasDrawableImage(value: unknown): value is CanvasImageSource {
  return (typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement)
    || (typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement)
    || (typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement)
    || (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap)
    || (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
    || (typeof SVGImageElement !== "undefined" && value instanceof SVGImageElement)
    || (typeof VideoFrame !== "undefined" && value instanceof VideoFrame);
}

type TransformTrackFamily = "position" | "rotation" | "scale";
type TransformAxis = "x" | "y" | "z";

function createGltfAnimationClips(blueprint: ComponentBlueprint, root: Group): ThreeAnimationClip[] {
  const nodesById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const objectsByNodeId = collectExportObjectsByNodeId(root);

  return blueprint.animation.clips.flatMap((clip) => {
    const tracks = createGltfTracksForClip(clip, nodesById, objectsByNodeId);
    return tracks.length > 0 ? [new ThreeAnimationClip(clip.name, -1, tracks)] : [];
  });
}

function collectExportObjectsByNodeId(root: Group): Map<string, Group> {
  const objectsByNodeId = new Map<string, Group>();
  root.traverse((object) => {
    const nodeId = object.userData.nodeId;
    if (typeof nodeId === "string" && object instanceof Group) {
      objectsByNodeId.set(nodeId, object);
    }
  });
  return objectsByNodeId;
}

function createGltfTracksForClip(
  clip: AnimationClip,
  nodesById: Map<string, EditorNode>,
  objectsByNodeId: Map<string, Group>,
): Array<VectorKeyframeTrack | QuaternionKeyframeTrack> {
  const groupedTracks = new Map<string, Partial<Record<TransformAxis, AnimationTrack>>>();

  for (const track of clip.tracks) {
    if (track.keyframes.length === 0 || isTrackMuted(track)) {
      continue;
    }

    const parsed = parseTransformAnimationProperty(track.property);
    if (!parsed) {
      continue;
    }

    const key = `${track.nodeId}:${parsed.family}`;
    const entry = groupedTracks.get(key) ?? {};
    entry[parsed.axis] = track;
    groupedTracks.set(key, entry);
  }

  const gltfTracks: Array<VectorKeyframeTrack | QuaternionKeyframeTrack> = [];

  for (const [key, axisTracks] of groupedTracks) {
    const [nodeId, family] = key.split(":") as [string, TransformTrackFamily];
    const node = nodesById.get(nodeId);
    const object = objectsByNodeId.get(nodeId);
    if (!node || !object) {
      continue;
    }

    const frames = collectAnimationFrames(axisTracks);
    if (frames.length === 0) {
      continue;
    }

    const times = frames.map((frame) => frameToSeconds(frame, clip.fps));
    if (family === "rotation") {
      const values = frames.flatMap((frame) => createQuaternionValuesAtFrame(node, axisTracks, frame));
      gltfTracks.push(new QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, values));
      continue;
    }

    const values = frames.flatMap((frame) => createVectorValuesAtFrame(node, family, axisTracks, frame));
    gltfTracks.push(new VectorKeyframeTrack(`${object.uuid}.${family}`, times, values));
  }

  return gltfTracks;
}

function parseTransformAnimationProperty(
  property: AnimationPropertyPath,
): { family: TransformTrackFamily; axis: TransformAxis } | null {
  const match = /^transform\.(position|rotation|scale)\.([xyz])$/.exec(property);
  if (!match) {
    return null;
  }

  return {
    family: match[1] as TransformTrackFamily,
    axis: match[2] as TransformAxis,
  };
}

function collectAnimationFrames(axisTracks: Partial<Record<TransformAxis, AnimationTrack>>): number[] {
  const frames = new Set<number>();
  for (const track of Object.values(axisTracks)) {
    if (!track) {
      continue;
    }
    for (const keyframe of sortTrackKeyframes(track.keyframes)) {
      frames.add(keyframe.frame);
    }
  }
  return [...frames].sort((left, right) => left - right);
}

function createVectorValuesAtFrame(
  node: EditorNode,
  family: "position" | "scale",
  axisTracks: Partial<Record<TransformAxis, AnimationTrack>>,
  frame: number,
): number[] {
  return AXES.map((axis) => evaluateAxisValueAtFrame(node, family, axis, axisTracks[axis], frame));
}

function createQuaternionValuesAtFrame(
  node: EditorNode,
  axisTracks: Partial<Record<TransformAxis, AnimationTrack>>,
  frame: number,
): number[] {
  const [x, y, z] = AXES.map((axis) => evaluateAxisValueAtFrame(node, "rotation", axis, axisTracks[axis], frame));
  const quaternion = new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));
  return quaternion.toArray();
}

function evaluateAxisValueAtFrame(
  node: EditorNode,
  family: TransformTrackFamily,
  axis: TransformAxis,
  track: AnimationTrack | undefined,
  frame: number,
): number {
  const property = `transform.${family}.${axis}` as AnimationPropertyPath;
  return evaluateAnimationTrackValue(track, getAnimationValue(node, property), frame);
}

const AXES: TransformAxis[] = ["x", "y", "z"];

/**
 * Parses a USDZ buffer via {@link USDLoader.parse} while ensuring that every
 * texture loaded through {@link TextureLoader} during parsing has its
 * underlying image fully decoded before the returned Group is handed back.
 * Delegates to {@link awaitTextureLoadsDuring} for the prototype patching;
 * see that helper for rationale.
 */
export async function parseUsdzWithTextures(
  usdLoader: USDLoader,
  buffer: ArrayBuffer,
): Promise<Group> {
  return awaitTextureLoadsDuring(() => usdLoader.parse(buffer));
}

class BlueprintObjectBuilder {
  private readonly textureLoader = new TextureLoader();
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private readonly objectMap = new Map<string, Group>();
  private readonly childContainerMap = new Map<string, Group>();
  private readonly imagesById: Map<string, ImageAsset>;
  private readonly modelsById: Map<string, ModelAsset>;
  private readonly modelGroupCache = new Map<string, Promise<Group>>();
  private readonly gltfLoader = new GLTFLoader();
  private readonly usdLoader = new USDLoader();

  constructor(private readonly blueprint: ComponentBlueprint) {
    this.imagesById = new Map((blueprint.images ?? []).flatMap((image) => (
      image.id ? [[image.id, image] as const] : []
    )));
    this.modelsById = new Map((blueprint.models ?? []).map((model) => [model.id, model] as const));
  }

  async build(): Promise<Group> {
    const root = new Group();
    root.name = this.blueprint.componentName.trim() || "3Forge Component";

    for (const node of this.blueprint.nodes) {
      const object = await this.createObject(node);
      this.objectMap.set(node.id, object);
    }

    for (const node of this.blueprint.nodes) {
      const object = this.objectMap.get(node.id);
      if (!object) {
        continue;
      }

      if (node.parentId && this.objectMap.has(node.parentId)) {
        const parentContainer = this.childContainerMap.get(node.parentId) ?? this.objectMap.get(node.parentId);
        parentContainer?.add(object);
        continue;
      }

      root.add(object);
    }

    return root;
  }

  private async createObject(node: EditorNode): Promise<Group> {
    const object = node.type === "group"
      ? this.buildGroupObject(node)
      : node.type === "model"
        ? await this.buildModelObject(node)
      : await this.buildWrappedNodeObject(node);
    object.name = node.name;
    object.visible = node.visible;
    object.userData.nodeId = node.id;
    object.userData.nodeType = node.type;
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
    object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
    return object;
  }

  private async buildModelObject(node: Extract<EditorNode, { type: "model" }>): Promise<Group> {
    const wrapper = new Group();
    const asset = this.modelsById.get(node.modelId);
    if (!asset) {
      return wrapper;
    }

    const loaded = await this.getCachedModelGroup(asset);
    loaded.traverse((child) => {
      child.userData.assetId = asset.id;
      child.userData.nodeId = node.id;
      child.userData.nodeType = node.type;
      if (child instanceof Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    wrapper.add(loaded);
    return wrapper;
  }

  private async getCachedModelGroup(asset: ModelAsset): Promise<Group> {
    let promise = this.modelGroupCache.get(asset.id);
    if (!promise) {
      promise = this.loadModelAssetGroup(asset);
      this.modelGroupCache.set(asset.id, promise);
    }
    const group = await promise;
    return group.clone(true);
  }

  private async loadModelAssetGroup(asset: ModelAsset): Promise<Group> {
    const bytes = decodeDataUrl(asset.src);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    if (asset.format === "glb") {
      const gltf = await this.gltfLoader.parseAsync(buffer, "");
      return gltf.scene.clone(true);
    }

    if (asset.format === "gltf") {
      const json = new TextDecoder().decode(bytes);
      const gltf = await this.gltfLoader.parseAsync(json, "");
      return gltf.scene.clone(true);
    }

    if (asset.format === "usdz") {
      try {
        const { parseUsdz } = await import("../lib/openusd/openusdParser");
        return await parseUsdz(buffer, asset.name ?? "asset.usdz");
      } catch (openUsdError) {
        console.warn("OpenUSD export parse failed, falling back:", openUsdError);
        if (containsUsdcMagic(bytes)) {
          const { parseUsdc } = await import("./usdcParser");
          return awaitTextureLoadsDuring(() => parseUsdc(buffer));
        }
      }
    }

    return parseUsdzWithTextures(this.usdLoader, buffer);
  }

  private buildGroupObject(node: Extract<EditorNode, { type: "group" }>): Group {
    const wrapper = new Group();
    const content = new Group();
    content.name = `${node.name} Content`;
    content.position.set(node.pivotOffset.x, node.pivotOffset.y, node.pivotOffset.z);
    wrapper.add(content);
    this.childContainerMap.set(node.id, content);
    return wrapper;
  }

  private async buildWrappedNodeObject(node: Exclude<EditorNode, { type: "group" | "model" }>): Promise<Group> {
    const wrapper = new Group();
    const mesh = await this.buildMeshObject(node);
    this.applyNodeOrigin(mesh, node.origin);
    wrapper.add(mesh);
    return wrapper;
  }

  private async buildMeshObject(node: Exclude<EditorNode, { type: "group" | "model" }>): Promise<Mesh> {
    let mesh: Mesh;
    switch (node.type) {
      case "box":
        mesh = new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), await this.createNodeMaterial(node));
        break;
      case "circle":
        mesh = new Mesh(new CircleGeometry(node.geometry.radius, node.geometry.segments, node.geometry.thetaStarts, node.geometry.thetaLenght), await this.createNodeMaterial(node));
        break;
      case "sphere":
        mesh = new Mesh(new SphereGeometry(
          node.geometry.radius,
          Math.max(3, Math.round(node.geometry.widthSegments)),
          Math.max(2, Math.round(node.geometry.heightSegments)),
          node.geometry.phiStart,
          node.geometry.phiLength,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), await this.createNodeMaterial(node));
        break;
      case "cylinder":
        mesh = new Mesh(new CylinderGeometry(
          node.geometry.radiusTop,
          node.geometry.radiusBottom,
          node.geometry.height,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.heightSegments)),
          false,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), await this.createNodeMaterial(node));
        break;
      case "cone":
        mesh = new Mesh(new ConeGeometry(
          node.geometry.radius,
          node.geometry.height,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.heightSegments)),
          false,
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), await this.createNodeMaterial(node));
        break;
      case "capsule":
        mesh = new Mesh(new CapsuleGeometry(
          node.geometry.radius,
          node.geometry.length,
          Math.max(1, Math.round(node.geometry.capSegments)),
          Math.max(3, Math.round(node.geometry.radialSegments)),
        ), await this.createNodeMaterial(node));
        break;
      case "ring":
        mesh = new Mesh(new RingGeometry(
          node.geometry.innerRadius,
          node.geometry.outerRadius,
          Math.max(3, Math.round(node.geometry.thetaSegments)),
          Math.max(1, Math.round(node.geometry.phiSegments)),
          node.geometry.thetaStart,
          node.geometry.thetaLength,
        ), await this.createNodeMaterial(node));
        break;
      case "torus":
        mesh = new Mesh(new TorusGeometry(
          node.geometry.radius,
          node.geometry.tube,
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(3, Math.round(node.geometry.tubularSegments)),
          node.geometry.arc,
        ), await this.createNodeMaterial(node));
        break;
      case "torusKnot":
        mesh = new Mesh(new TorusKnotGeometry(
          node.geometry.radius,
          node.geometry.tube,
          Math.max(3, Math.round(node.geometry.tubularSegments)),
          Math.max(3, Math.round(node.geometry.radialSegments)),
          Math.max(1, Math.round(node.geometry.p)),
          Math.max(1, Math.round(node.geometry.q)),
        ), await this.createNodeMaterial(node));
        break;
      case "dodecahedron":
        mesh = new Mesh(new DodecahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), await this.createNodeMaterial(node));
        break;
      case "icosahedron":
        mesh = new Mesh(new IcosahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), await this.createNodeMaterial(node));
        break;
      case "octahedron":
        mesh = new Mesh(new OctahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), await this.createNodeMaterial(node));
        break;
      case "tetrahedron":
        mesh = new Mesh(new TetrahedronGeometry(node.geometry.radius, Math.max(0, Math.round(node.geometry.detail))), await this.createNodeMaterial(node));
        break;
      case "plane":
        mesh = new Mesh(new PlaneGeometry(node.geometry.width, node.geometry.height), await this.createNodeMaterial(node));
        break;
      case "image":
        mesh = await this.createImageMesh(node);
        break;
      case "text":
        mesh = new Mesh(this.createTextGeometry(node), await this.createNodeMaterial(node));
        break;
    }

    mesh.name = `${node.name} Mesh`;
    mesh.castShadow = node.material.castShadow;
    mesh.receiveShadow = node.material.receiveShadow;
    mesh.visible = node.material.visible;
    return mesh;
  }

  private createTextGeometry(node: TextNode): TextGeometry {
    const availableFonts = getAvailableFonts(this.blueprint.fonts);
    const fontAsset = availableFonts.find((font) => font.id === node.fontId)
      ?? availableFonts.find((font) => font.id === DEFAULT_FONT_ID)
      ?? availableFonts[0];
    if (!fontAsset) {
      throw new Error(`Font not found for text node "${node.name}".`);
    }

    return new TextGeometry(node.geometry.text || " ", {
      font: parseFontAsset(fontAsset),
      size: Math.max(node.geometry.size, 0.01),
      depth: Math.max(node.geometry.depth, 0),
      curveSegments: Math.max(1, Math.round(node.geometry.curveSegments)),
      bevelEnabled: node.geometry.bevelEnabled,
      bevelThickness: Math.max(node.geometry.bevelThickness, 0),
      bevelSize: Math.max(node.geometry.bevelSize, 0),
    });
  }

  private applyNodeOrigin(mesh: Mesh, origin: NodeOriginSpec): void {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) {
      return;
    }

    mesh.position.set(
      resolveOriginOffset(bounds.min.x, bounds.max.x, origin.x),
      resolveOriginOffset(bounds.min.y, bounds.max.y, origin.y),
      resolveOriginOffset(bounds.min.z, bounds.max.z, origin.z),
    );
  }

  private async createNodeMaterial(node: Exclude<EditorNode, { type: "group" | "model" }>): Promise<Material> {
    return buildMaterialFromSpec(await this.createBaseMaterialOptions(node), node.material);
  }

  private async createBaseMaterialOptions(node: Exclude<EditorNode, { type: "group" | "model" }>): Promise<MaterialBaseOptions> {
    const materialTexture = await this.getMaterialTexture(node.material);
    return {
      color: node.material.color,
      side: resolveMaterialSide(node.material.side),
      opacity: node.material.opacity,
      transparent: node.material.transparent,
      alphaTest: node.material.alphaTest,
      depthTest: node.material.depthTest,
      depthWrite: node.material.depthWrite,
      colorWrite: node.material.colorWrite,
      dithering: node.material.dithering,
      toneMapped: node.material.toneMapped,
      premultipliedAlpha: node.material.premultipliedAlpha,
      polygonOffset: node.material.polygonOffset,
      polygonOffsetFactor: node.material.polygonOffsetFactor,
      polygonOffsetUnits: node.material.polygonOffsetUnits,
      wireframe: node.material.wireframe,
      wireframeLinewidth: node.material.wireframeLinewidth,
      ...(materialTexture ? { map: materialTexture } : {}),
    };
  }

  private async createImageMesh(node: ImageNode): Promise<Mesh> {
    const geometry = new PlaneGeometry(node.geometry.width, node.geometry.height);
    const texture = await this.getMaterialTexture(node.material) ?? await this.getTexture(resolveImageAssetForNode(node, this.imagesById).src);
    const material = buildMaterialFromSpec({
      ...await this.createBaseMaterialOptions(node),
      map: texture,
    }, node.material);
    return new Mesh(geometry, material);
  }

  private async getMaterialTexture(material: MaterialSpec): Promise<Texture | null> {
    if (!material.mapImageId) {
      return null;
    }

    const asset = this.imagesById.get(material.mapImageId);
    return asset ? this.getTexture(asset.src) : null;
  }

  private async getTexture(src: string): Promise<Texture> {
    let promise = this.textureCache.get(src);
    if (!promise) {
      promise = this.textureLoader.loadAsync(src).then((texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      });
      this.textureCache.set(src, promise);
    }

    return promise;
  }
}

function buildMaterialFromSpec(baseOptions: MaterialBaseOptions, spec: MaterialSpec): Material {
  switch (spec.type) {
    case "basic":
      return new MeshBasicMaterial({
        ...baseOptions,
        fog: spec.fog,
      });
    case "lambert":
      return new MeshLambertMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
    case "phong":
      return new MeshPhongMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        specular: spec.specular,
        shininess: spec.shininess,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
    case "toon":
      return new MeshToonMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        fog: spec.fog,
      });
    case "physical":
      return new MeshPhysicalMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        roughness: spec.roughness,
        metalness: spec.metalness,
        envMapIntensity: spec.envMapIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
        ior: spec.ior,
        transmission: spec.transmission,
        thickness: spec.thickness,
        clearcoat: spec.clearcoat,
        clearcoatRoughness: spec.clearcoatRoughness,
        reflectivity: spec.reflectivity,
        iridescence: spec.iridescence,
        iridescenceIOR: spec.iridescenceIOR,
        iridescenceThicknessRange: [
          spec.iridescenceThicknessRangeStart,
          spec.iridescenceThicknessRangeEnd,
        ],
        sheen: spec.sheen,
        sheenRoughness: spec.sheenRoughness,
        sheenColor: spec.sheenColor,
        specularIntensity: spec.specularIntensity,
        specularColor: spec.specularColor,
        attenuationDistance: spec.attenuationDistance,
        attenuationColor: spec.attenuationColor,
        dispersion: spec.dispersion,
        anisotropy: spec.anisotropy,
      });
    case "normal":
      return new MeshNormalMaterial({
        ...baseOptions,
        flatShading: spec.flatShading,
      });
    case "depth":
      return new MeshDepthMaterial({
        ...baseOptions,
        depthPacking: resolveDepthPacking(spec.depthPacking),
      });
    default:
      return new MeshStandardMaterial({
        ...baseOptions,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        roughness: spec.roughness,
        metalness: spec.metalness,
        envMapIntensity: spec.envMapIntensity,
        flatShading: spec.flatShading,
        fog: spec.fog,
      });
  }
}

function resolveMaterialSide(side: MaterialSpec["side"]) {
  switch (side) {
    case "back":
      return BackSide;
    case "double":
      return DoubleSide;
    default:
      return FrontSide;
  }
}

function resolveDepthPacking(depthPacking: MaterialSpec["depthPacking"]) {
  return depthPacking === "rgba" ? RGBADepthPacking : BasicDepthPacking;
}

function resolveOriginOffset(min: number, max: number, origin: NodeOriginSpec["x"] | NodeOriginSpec["y"] | NodeOriginSpec["z"]): number {
  switch (origin) {
    case "left":
    case "bottom":
    case "back":
      return -min;
    case "right":
    case "top":
    case "front":
      return -max;
    default:
      return -((min + max) * 0.5);
  }
}

function resolveImageAssetForNode(node: ImageNode, imagesById: Map<string, ImageAsset>): ImageAsset {
  if (node.imageId) {
    const asset = imagesById.get(node.imageId);
    if (asset) {
      return asset;
    }
  }

  return node.image;
}

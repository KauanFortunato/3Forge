import {
  AnimationClip as ThreeAnimationClip,
  BackSide,
  BasicDepthPacking,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  FrontSide,
  Group,
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
  PlaneGeometry,
  RGBADepthPacking,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  VectorKeyframeTrack,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { evaluateAnimationTrackValue, frameToSeconds, getAnimationValue, isTrackMuted, sortTrackKeyframes } from "./animation";
import { DEFAULT_FONT_ID, getAvailableFonts, parseFontAsset } from "./fonts";
import type { AnimationClip, AnimationPropertyPath, AnimationTrack, ComponentBlueprint, EditorNode, ImageAsset, ImageNode, MaterialSpec, NodeOriginSpec, TextNode } from "./types";

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

export async function exportBlueprintToGltfBlob(blueprint: ComponentBlueprint): Promise<Blob> {
  return new Blob([await exportBlueprintToGltfJson(blueprint)], { type: "model/gltf+json" });
}

async function exportGroup(
  group: Group,
  binary: boolean,
  animations: ThreeAnimationClip[] = [],
): Promise<ArrayBuffer | { [key: string]: unknown }> {
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

class BlueprintObjectBuilder {
  private readonly textureLoader = new TextureLoader();
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private readonly objectMap = new Map<string, Group>();
  private readonly childContainerMap = new Map<string, Group>();
  private readonly imagesById: Map<string, ImageAsset>;

  constructor(private readonly blueprint: ComponentBlueprint) {
    this.imagesById = new Map((blueprint.images ?? []).flatMap((image) => (
      image.id ? [[image.id, image] as const] : []
    )));
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

  private buildGroupObject(node: Extract<EditorNode, { type: "group" }>): Group {
    const wrapper = new Group();
    const content = new Group();
    content.name = `${node.name} Content`;
    content.position.set(node.pivotOffset.x, node.pivotOffset.y, node.pivotOffset.z);
    wrapper.add(content);
    this.childContainerMap.set(node.id, content);
    return wrapper;
  }

  private async buildWrappedNodeObject(node: Exclude<EditorNode, { type: "group" }>): Promise<Group> {
    const wrapper = new Group();
    const mesh = await this.buildMeshObject(node);
    this.applyNodeOrigin(mesh, node.origin);
    wrapper.add(mesh);
    return wrapper;
  }

  private async buildMeshObject(node: Exclude<EditorNode, { type: "group" }>): Promise<Mesh> {
    let mesh: Mesh;
    switch (node.type) {
      case "box":
        mesh = new Mesh(new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth), await this.createNodeMaterial(node));
        break;
      case "circle":
        mesh = new Mesh(new CircleGeometry(node.geometry.radius, node.geometry.segments, node.geometry.thetaStarts, node.geometry.thetaLenght), await this.createNodeMaterial(node));
        break;
      case "sphere":
        mesh = new Mesh(new SphereGeometry(node.geometry.radius, 32, 24), await this.createNodeMaterial(node));
        break;
      case "cylinder":
        mesh = new Mesh(new CylinderGeometry(node.geometry.radiusTop, node.geometry.radiusBottom, node.geometry.height, 32), await this.createNodeMaterial(node));
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

  private async createNodeMaterial(node: Exclude<EditorNode, { type: "group" }>): Promise<Material> {
    return buildMaterialFromSpec(await this.createBaseMaterialOptions(node), node.material);
  }

  private async createBaseMaterialOptions(node: Exclude<EditorNode, { type: "group" }>): Promise<MaterialBaseOptions> {
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

import { Color, Euler, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import type { AnimationClip, Material, Texture } from "three";

import { convertGltfAnimationsByObject } from "./gltfAnimationImport";
import type { GltfObjectAnimations } from "./gltfAnimationImport";
import { createMaterialSpec } from "./materials";
import type { MaterialSpec, ModelImportPlanNode } from "./types";

/**
 * A texture lifted out of a parsed glTF/GLB material, rasterised to a PNG data
 * URL so it can be registered as a standalone editor ImageAsset and linked back
 * to the owning MaterialAsset via `MaterialSpec.mapImageId`.
 */
export interface GltfTextureSnapshot {
  /** Stable de-dupe key (source Texture uuid) so one image is created per texture. */
  key: string;
  dataUrl: string;
  width: number;
  height: number;
  name: string;
  mimeType: string;
}

/**
 * A unique material discovered while walking a parsed glTF/GLB scene. `key` is
 * the source Material uuid; the import pass mints one MaterialAsset per key and
 * links every mesh part that referenced it.
 */
export interface GltfMaterialSnapshot {
  key: string;
  name: string;
  spec: MaterialSpec;
  texture?: GltfTextureSnapshot;
}

export interface GltfImportData {
  /** Unique materials, in first-seen order. */
  materials: GltfMaterialSnapshot[];
  /**
   * Explode plan mirroring the glTF node hierarchy: each container Object3D
   * becomes an `xform` (group) node and each Mesh a `model` node pinned to its
   * index-path `partPath`, with **local** transforms (relative to the parent)
   * so the tree reconstructs the original layout. Mesh nodes carry their source
   * material uuid in `materialId` as a *key* — {@link remapGltfPlanMaterialIds}
   * swaps these for real MaterialAsset ids before the plan reaches
   * {@link EditorStore.insertModelImportPlan}.
   */
  plan: ModelImportPlanNode[];
}

/**
 * Capture the editable scalar/color fields of a parsed Three.js material into a
 * MaterialSpec. Texture maps stay on the rendered (cloned) material; only these
 * scalars are surfaced for editing in the Materials panel.
 */
export function materialSpecFromThreeMaterial(material: Material | undefined | null): MaterialSpec {
  const mat = material as unknown as Record<string, unknown> & {
    color?: Color;
    emissive?: Color;
    isMeshPhysicalMaterial?: boolean;
  };
  const isPhysical = Boolean(mat?.isMeshPhysicalMaterial);
  const colorHex = mat?.color && typeof mat.color.getHexString === "function"
    ? `#${mat.color.getHexString()}`
    : undefined;
  const spec = createMaterialSpec(colorHex, isPhysical ? "physical" : "standard");
  if (!material) {
    return spec;
  }
  if (mat.emissive && typeof mat.emissive.getHexString === "function") {
    spec.emissive = `#${mat.emissive.getHexString()}`;
  }
  if (typeof mat.emissiveIntensity === "number") spec.emissiveIntensity = mat.emissiveIntensity;
  if (typeof mat.roughness === "number") spec.roughness = mat.roughness;
  if (typeof mat.metalness === "number") spec.metalness = mat.metalness;
  if (typeof mat.opacity === "number") spec.opacity = mat.opacity;
  if (typeof mat.transparent === "boolean") spec.transparent = mat.transparent;
  if (typeof mat.alphaTest === "number") spec.alphaTest = mat.alphaTest;
  // Three side constants: FrontSide=0, BackSide=1, DoubleSide=2.
  spec.side = material.side === 1 ? "back" : material.side === 2 ? "double" : "front";
  if (typeof mat.transmission === "number") spec.transmission = mat.transmission;
  if (typeof mat.thickness === "number") spec.thickness = mat.thickness;
  if (typeof mat.clearcoat === "number") spec.clearcoat = mat.clearcoat;
  if (typeof mat.clearcoatRoughness === "number") spec.clearcoatRoughness = mat.clearcoatRoughness;
  if (typeof mat.ior === "number") spec.ior = mat.ior;
  if (typeof mat.envMapIntensity === "number") spec.envMapIntensity = mat.envMapIntensity;
  return spec;
}

/**
 * Rasterise a parsed texture's image to a PNG data URL. Returns `undefined` when
 * the image isn't drawable (no dimensions, tainted canvas, or no 2D context —
 * e.g. under jsdom). Browser-only; never called from the test path.
 */
function textureToSnapshot(texture: Texture | null | undefined): GltfTextureSnapshot | undefined {
  if (!texture || !texture.image) {
    return undefined;
  }
  const image = texture.image as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const width = image.width ?? image.videoWidth ?? 0;
  const height = image.height ?? image.videoHeight ?? 0;
  if (!width || !height) {
    return undefined;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    return {
      key: texture.uuid,
      dataUrl,
      width,
      height,
      name: (texture.name || "").trim() || "Texture",
      mimeType: "image/png",
    };
  } catch {
    return undefined;
  }
}

function registerMaterial(
  material: Material,
  materials: Map<string, GltfMaterialSnapshot>,
): string {
  const key = material.uuid;
  if (!materials.has(key)) {
    const spec = materialSpecFromThreeMaterial(material);
    const texture = textureToSnapshot((material as unknown as { map?: Texture | null }).map);
    materials.set(key, {
      key,
      name: (material.name || "").trim() || "Material",
      spec,
      texture,
    });
  }
  return key;
}

function leafName(object: Object3D, isMesh: boolean): string {
  const raw = (object.name || "").trim();
  if (!raw) {
    return isMesh ? "Mesh" : "Group";
  }
  return raw.includes("/") ? (raw.split("/").filter(Boolean).pop() ?? raw) : raw;
}

/**
 * Skinned meshes deform via a Skeleton whose bone references would be severed
 * by the shallow per-part clone the explode renderer uses — so we never explode
 * a rigged model. The import falls back to a single ModelNode that keeps the
 * skeleton (and its animation) intact.
 */
function hasSkinnedMesh(root: Object3D): boolean {
  let skinned = false;
  root.traverse((object) => {
    if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
      skinned = true;
    }
  });
  return skinned;
}

/**
 * Build a hierarchical explode plan from a parsed glTF/GLB group, mirroring the
 * node tree: container Object3Ds become `xform` (group) nodes and Meshes become
 * `model` nodes pinned to their index-path `partPath`, all carrying **local**
 * transforms (relative to the parent) so the editor hierarchy reconstructs the
 * original layout — groups included. `withMaterialKeys` controls whether each
 * mesh node carries its source material uuid in `materialId` (import path,
 * later remapped to a real MaterialAsset) or an inline {@link MaterialSpec}
 * (manual-explode path); the material is captured into `materials` either way.
 */
function buildPlanNodes(
  objects: Object3D[],
  parentPath: string,
  materials: Map<string, GltfMaterialSnapshot>,
  withMaterialKeys: boolean,
  animations?: GltfObjectAnimations,
): ModelImportPlanNode[] {
  return objects.map((object, index) => {
    const path = parentPath ? `${parentPath}.${index}` : String(index);
    const isMesh = object instanceof Mesh;
    const planNode: ModelImportPlanNode = {
      name: leafName(object, isMesh),
      kind: isMesh ? "mesh" : "xform",
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      children: buildPlanNodes(object.children, path, materials, withMaterialKeys, animations),
    };
    const nodeTracks = animations?.byObject.get(object);
    if (nodeTracks && nodeTracks.length > 0) {
      planNode.animation = {
        fps: animations!.fps,
        durationFrames: animations!.durationFrames,
        tracks: nodeTracks,
      };
    }
    if (isMesh) {
      planNode.partPath = path;
      const mesh = object as Mesh;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material) {
        const key = registerMaterial(material, materials);
        if (withMaterialKeys) {
          planNode.materialId = key;
        } else {
          planNode.material = materials.get(key)!.spec;
        }
      }
    }
    return planNode;
  });
}

const collapsePm = new Matrix4();
const collapseCm = new Matrix4();
const collapsePos = new Vector3();
const collapseQuat = new Quaternion();
const collapseScale = new Vector3();
const collapseEuler = new Euler();

/** Compose `parent` and `child` local transforms into the child's frame. */
function mergeTransformIntoChild(parent: ModelImportPlanNode, child: ModelImportPlanNode): ModelImportPlanNode {
  collapsePm.compose(
    collapsePos.set(parent.position.x, parent.position.y, parent.position.z),
    collapseQuat.setFromEuler(collapseEuler.set(parent.rotation.x, parent.rotation.y, parent.rotation.z, "XYZ")),
    collapseScale.set(parent.scale.x, parent.scale.y, parent.scale.z),
  );
  collapseCm.compose(
    collapsePos.set(child.position.x, child.position.y, child.position.z),
    collapseQuat.setFromEuler(collapseEuler.set(child.rotation.x, child.rotation.y, child.rotation.z, "XYZ")),
    collapseScale.set(child.scale.x, child.scale.y, child.scale.z),
  );
  collapsePm.multiply(collapseCm);
  collapsePm.decompose(collapsePos, collapseQuat, collapseScale);
  collapseEuler.setFromQuaternion(collapseQuat, "XYZ");
  return {
    ...child,
    // Keep the container's name when it carries a real (authored) one — the
    // single child is usually GLTFLoader's anonymous primitive wrapper.
    name: parent.name && parent.name !== "Group" ? parent.name : child.name,
    position: { x: collapsePos.x, y: collapsePos.y, z: collapsePos.z },
    rotation: { x: collapseEuler.x, y: collapseEuler.y, z: collapseEuler.z },
    scale: { x: collapseScale.x, y: collapseScale.y, z: collapseScale.z },
  };
}

/**
 * Collapse redundant single-child container (`xform`) nodes that glTF importers
 * routinely insert — e.g. a node that merely wraps one mesh. Each such wrapper
 * is folded into its sole child (transforms composed) so the editor hierarchy
 * matches the authored model instead of the converter's bookkeeping. `partPath`
 * is left untouched (it indexes the parsed tree, not the blueprint hierarchy),
 * so rendering stays correct.
 */
function collapsePassthroughGroups(nodes: ModelImportPlanNode[]): ModelImportPlanNode[] {
  return nodes.map((node) => {
    let current: ModelImportPlanNode = { ...node, children: collapsePassthroughGroups(node.children) };
    // Never fold an animated wrapper (or one whose sole child is animated):
    // its keyframes target that node's own local transform, which the merge
    // would silently drop or double-apply.
    while (
      current.kind === "xform"
      && current.children.length === 1
      && !current.animation
      && !current.children[0].animation
    ) {
      current = mergeTransformIntoChild(current, current.children[0]);
    }
    return current;
  });
}

function buildPlan(
  root: Object3D,
  materials: Map<string, GltfMaterialSnapshot>,
  withMaterialKeys: boolean,
  animations?: GltfObjectAnimations,
): ModelImportPlanNode[] {
  if (hasSkinnedMesh(root)) {
    return [];
  }
  return collapsePassthroughGroups(buildPlanNodes(root.children, "", materials, withMaterialKeys, animations));
}

/**
 * Walk a parsed glTF/GLB scene and produce the hierarchical explode plan
 * (groups + meshes) plus the unique materials (with rasterised base-colour
 * textures). Used by the import pass to surface every part as an independently
 * editable, material-linked node while preserving the model's group hierarchy.
 */
export function buildGltfImportData(scene: Object3D, animations: AnimationClip[] = []): GltfImportData {
  const materials = new Map<string, GltfMaterialSnapshot>();
  const objectAnimations = animations.length > 0
    ? convertGltfAnimationsByObject(animations, scene)
    : undefined;
  const plan = buildPlan(scene, materials, true, objectAnimations);
  return { materials: [...materials.values()], plan };
}

/**
 * Like {@link buildGltfImportData} but each mesh node carries an inline
 * {@link MaterialSpec} (no MaterialAssets are minted). Used by the manual
 * "Explode into editable parts" action on already-imported models.
 */
export function buildInlineExplodePlan(scene: Object3D): ModelImportPlanNode[] {
  const materials = new Map<string, GltfMaterialSnapshot>();
  return buildPlan(scene, materials, false);
}

/**
 * Replace the source-material-uuid keys stashed in each mesh plan node's
 * `materialId` with the real MaterialAsset ids from `materialIdByKey`. Keys with
 * no mapping are cleared so the node falls back to an inline material.
 */
export function remapGltfPlanMaterialIds(
  plan: ModelImportPlanNode[],
  materialIdByKey: Map<string, string>,
): ModelImportPlanNode[] {
  return plan.map((node) => {
    const next: ModelImportPlanNode = {
      ...node,
      children: remapGltfPlanMaterialIds(node.children, materialIdByKey),
    };
    if (next.materialId) {
      const mapped = materialIdByKey.get(next.materialId);
      if (mapped) {
        next.materialId = mapped;
      } else {
        delete next.materialId;
      }
    }
    return next;
  });
}

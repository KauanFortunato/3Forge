import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { DEFAULT_FONT_ID, parseFontAsset } from "./fonts";
import type {
  EditorNode,
  FontAsset,
  GroupNode,
  NodeOriginSpec,
  TextNode,
  TransformSpec,
  Vec3Like,
} from "./types";

export interface Bounds3Like {
  min: Vec3Like;
  max: Vec3Like;
}

export interface SpatialLookup {
  getNode(nodeId: string): EditorNode | undefined;
  getNodeChildren(parentId: string | null): EditorNode[];
  getFont(fontId: string): FontAsset | undefined;
}

export function resolveOriginOffset(
  min: number,
  max: number,
  origin: NodeOriginSpec["x"] | NodeOriginSpec["y"] | NodeOriginSpec["z"],
): number {
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

export function getBoundsOriginOffset(bounds: Bounds3Like, origin: NodeOriginSpec): Vec3Like {
  return {
    x: resolveOriginOffset(bounds.min.x, bounds.max.x, origin.x),
    y: resolveOriginOffset(bounds.min.y, bounds.max.y, origin.y),
    z: resolveOriginOffset(bounds.min.z, bounds.max.z, origin.z),
  };
}

export function transformOffsetByTransform(offset: Vec3Like, transform: TransformSpec): Vec3Like {
  const result = new Vector3(offset.x, offset.y, offset.z);
  result.multiply(new Vector3(
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
  ));
  result.applyQuaternion(new Quaternion().setFromEuler(new Euler(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  )));

  return {
    x: result.x,
    y: result.y,
    z: result.z,
  };
}

export function computeGroupContentBounds(groupId: string, lookup: SpatialLookup): Bounds3Like | null {
  const children = lookup.getNodeChildren(groupId);
  let bounds: Bounds3Like | null = null;

  for (const child of children) {
    const childBounds = computeNodeLocalBounds(child, lookup);
    if (!childBounds) {
      continue;
    }

    const transformed = transformBounds(childBounds, child.transform);
    bounds = bounds ? unionBounds(bounds, transformed) : transformed;
  }

  return bounds;
}

export function computeNodeLocalBounds(node: EditorNode, lookup: SpatialLookup): Bounds3Like | null {
  if (node.type === "group") {
    const contentBounds = computeGroupContentBounds(node.id, lookup);
    if (!contentBounds) {
      return null;
    }
    return translateBounds(contentBounds, node.pivotOffset);
  }

  const geometryBounds = getRenderableGeometryBounds(node, lookup);
  if (!geometryBounds) {
    return null;
  }
  return translateBounds(geometryBounds, getBoundsOriginOffset(geometryBounds, node.origin));
}

export function computeNodeWorldBounds(nodeId: string, lookup: SpatialLookup): Bounds3Like | null {
  const node = lookup.getNode(nodeId);
  if (!node) {
    return null;
  }

  const localBounds = computeNodeLocalBounds(node, lookup);
  if (!localBounds) {
    return null;
  }

  return transformBoundsWithMatrix(localBounds, computeNodeWorldMatrix(nodeId, lookup));
}

export function computeNodeWorldPosition(nodeId: string, lookup: SpatialLookup): Vec3Like | null {
  const matrix = computeNodeWorldMatrix(nodeId, lookup);
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, rotation, scale);
  return {
    x: position.x,
    y: position.y,
    z: position.z,
  };
}

export function computeNodeWorldMatrix(nodeId: string, lookup: SpatialLookup): Matrix4 {
  const node = lookup.getNode(nodeId);
  if (!node) {
    return new Matrix4();
  }

  const localMatrix = new Matrix4().compose(
    new Vector3(node.transform.position.x, node.transform.position.y, node.transform.position.z),
    new Quaternion().setFromEuler(new Euler(
      node.transform.rotation.x,
      node.transform.rotation.y,
      node.transform.rotation.z,
    )),
    new Vector3(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z),
  );

  if (!node.parentId) {
    return localMatrix;
  }

  const parent = lookup.getNode(node.parentId);
  if (!parent) {
    return localMatrix;
  }

  const parentMatrix = computeNodeWorldMatrix(parent.id, lookup);
  if (parent.type !== "group") {
    return parentMatrix.multiply(localMatrix);
  }

  const attachmentMatrix = new Matrix4().makeTranslation(
    parent.pivotOffset.x,
    parent.pivotOffset.y,
    parent.pivotOffset.z,
  );

  return parentMatrix.multiply(attachmentMatrix).multiply(localMatrix);
}

function getRenderableGeometryBounds(node: Exclude<EditorNode, { type: "group" }>, lookup: SpatialLookup): Bounds3Like | null {
  switch (node.type) {
    case "box":
      return geometryBoundsFromFactory(() => new BoxGeometry(node.geometry.width, node.geometry.height, node.geometry.depth));
    case "circle":
      return geometryBoundsFromFactory(() => new CircleGeometry(
        node.geometry.radius,
        node.geometry.segments,
        node.geometry.thetaLenght,
        node.geometry.thetaStarts,
      ));
    case "sphere":
      return geometryBoundsFromFactory(() => new SphereGeometry(node.geometry.radius, 32, 24));
    case "cylinder":
      return geometryBoundsFromFactory(() => new CylinderGeometry(
        node.geometry.radiusTop,
        node.geometry.radiusBottom,
        node.geometry.height,
        32,
      ));
    case "plane":
    case "image":
      return geometryBoundsFromFactory(() => new PlaneGeometry(node.geometry.width, node.geometry.height));
    case "text":
      return getTextGeometryBounds(node, lookup);
  }
}

function getTextGeometryBounds(node: TextNode, lookup: SpatialLookup): Bounds3Like | null {
  const font = lookup.getFont(node.fontId) ?? lookup.getFont(DEFAULT_FONT_ID);
  if (!font) {
    return null;
  }

  const geometry = new TextGeometry(node.geometry.text || " ", {
    font: parseFontAsset(font),
    size: Math.max(node.geometry.size, 0.01),
    depth: Math.max(node.geometry.depth, 0),
    curveSegments: Math.max(1, Math.round(node.geometry.curveSegments)),
    bevelEnabled: node.geometry.bevelEnabled,
    bevelThickness: Math.max(node.geometry.bevelThickness, 0),
    bevelSize: Math.max(node.geometry.bevelSize, 0),
  });

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  geometry.dispose();

  return bounds ? fromThreeBounds(bounds.min, bounds.max) : null;
}

function geometryBoundsFromFactory(createGeometry: () => { computeBoundingBox: () => void; boundingBox: { min: Vector3; max: Vector3 } | null; dispose: () => void }): Bounds3Like | null {
  const geometry = createGeometry();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  geometry.dispose();
  return bounds ? fromThreeBounds(bounds.min, bounds.max) : null;
}

function transformBounds(bounds: Bounds3Like, transform: TransformSpec): Bounds3Like {
  const matrix = new Matrix4().compose(
    new Vector3(transform.position.x, transform.position.y, transform.position.z),
    new Quaternion().setFromEuler(new Euler(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
    )),
    new Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
  );

  return transformBoundsWithMatrix(bounds, matrix);
}

function transformBoundsWithMatrix(bounds: Bounds3Like, matrix: Matrix4): Bounds3Like {
  let nextBounds: Bounds3Like | null = null;

  for (const corner of createBoundsCorners(bounds)) {
    const transformed = corner.clone().applyMatrix4(matrix);
    nextBounds = nextBounds
      ? expandBounds(nextBounds, transformed)
      : {
        min: { x: transformed.x, y: transformed.y, z: transformed.z },
        max: { x: transformed.x, y: transformed.y, z: transformed.z },
      };
  }

  return nextBounds ?? {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };
}

function translateBounds(bounds: Bounds3Like, offset: Vec3Like): Bounds3Like {
  return {
    min: {
      x: bounds.min.x + offset.x,
      y: bounds.min.y + offset.y,
      z: bounds.min.z + offset.z,
    },
    max: {
      x: bounds.max.x + offset.x,
      y: bounds.max.y + offset.y,
      z: bounds.max.z + offset.z,
    },
  };
}

function unionBounds(a: Bounds3Like, b: Bounds3Like): Bounds3Like {
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

function expandBounds(bounds: Bounds3Like, point: Vector3): Bounds3Like {
  return {
    min: {
      x: Math.min(bounds.min.x, point.x),
      y: Math.min(bounds.min.y, point.y),
      z: Math.min(bounds.min.z, point.z),
    },
    max: {
      x: Math.max(bounds.max.x, point.x),
      y: Math.max(bounds.max.y, point.y),
      z: Math.max(bounds.max.z, point.z),
    },
  };
}

function createBoundsCorners(bounds: Bounds3Like): Vector3[] {
  return [
    new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ];
}

function fromThreeBounds(min: Vector3, max: Vector3): Bounds3Like {
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}

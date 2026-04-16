import type { Vec3Like } from "./types";

export type AlignmentAxis = "x" | "y" | "z";
export type AlignmentFeature = "pivot" | "center" | "min" | "max";

export interface AlignmentAxisBounds {
  min: number;
  center: number;
  max: number;
}

export interface AlignmentShape {
  id: string;
  pivot: Vec3Like;
  bounds: Record<AlignmentAxis, AlignmentAxisBounds>;
}

export interface AlignmentMatch {
  axis: AlignmentAxis;
  sourceFeature: AlignmentFeature;
  targetFeature: AlignmentFeature;
  delta: number;
  targetId: string;
  sourceValue: number;
  targetValue: number;
}

export interface AlignmentSnapResult {
  position: Vec3Like;
  matches: AlignmentMatch[];
}

const AXES: AlignmentAxis[] = ["x", "y", "z"];
const DEFAULT_FEATURES: AlignmentFeature[] = ["center", "min", "max"];

export function createAlignmentShape(
  id: string,
  pivot: Vec3Like,
  min: Vec3Like,
  max: Vec3Like,
): AlignmentShape {
  return {
    id,
    pivot: { ...pivot },
    bounds: {
      x: createAxisBounds(min.x, max.x),
      y: createAxisBounds(min.y, max.y),
      z: createAxisBounds(min.z, max.z),
    },
  };
}

export function findAlignmentSnaps(
  moving: AlignmentShape,
  candidates: AlignmentShape[],
  threshold = 0.18,
  features: AlignmentFeature[] = DEFAULT_FEATURES,
  axes: AlignmentAxis[] = AXES,
): AlignmentSnapResult {
  const position: Vec3Like = { ...moving.pivot };
  const matches: AlignmentMatch[] = [];

  for (const axis of axes) {
    let bestMatch: AlignmentMatch | null = null;

    for (const candidate of candidates) {
      if (candidate.id === moving.id) {
        continue;
      }

      const sourceFeatures = getFeatureValues(moving, axis, features);
      const targetFeatures = getFeatureValues(candidate, axis, features);

      for (const [sourceFeature, sourceValue] of sourceFeatures) {
        for (const [targetFeature, targetValue] of targetFeatures) {
          const delta = targetValue - sourceValue;
          if (Math.abs(delta) > threshold) {
            continue;
          }

          const nextMatch: AlignmentMatch = {
            axis,
            sourceFeature,
            targetFeature,
            delta,
            targetId: candidate.id,
            sourceValue,
            targetValue,
          };

          if (!bestMatch || shouldReplaceMatch(nextMatch, bestMatch)) {
            bestMatch = nextMatch;
          }
        }
      }
    }

    if (!bestMatch) {
      continue;
    }

    position[axis] += bestMatch.delta;
    matches.push(bestMatch);
  }

  return {
    position,
    matches,
  };
}

function createAxisBounds(a: number, b: number): AlignmentAxisBounds {
  const min = Math.min(a, b);
  const max = Math.max(a, b);

  return {
    min,
    center: Number(((min + max) * 0.5).toFixed(6)),
    max,
  };
}

function getFeatureValues(shape: AlignmentShape, axis: AlignmentAxis, features: AlignmentFeature[]): Array<[AlignmentFeature, number]> {
  return features.map((feature) => [feature, getFeatureValue(shape, axis, feature)]);
}

function getFeatureValue(shape: AlignmentShape, axis: AlignmentAxis, feature: AlignmentFeature): number {
  switch (feature) {
    case "pivot":
      return shape.pivot[axis];
    case "center":
      return shape.bounds[axis].center;
    case "min":
      return shape.bounds[axis].min;
    case "max":
      return shape.bounds[axis].max;
  }
}

function shouldReplaceMatch(next: AlignmentMatch, current: AlignmentMatch): boolean {
  const nextDistance = Math.abs(next.delta);
  const currentDistance = Math.abs(current.delta);
  if (nextDistance !== currentDistance) {
    return nextDistance < currentDistance;
  }

  const nextRank = getFeatureRank(next);
  const currentRank = getFeatureRank(current);
  if (nextRank !== currentRank) {
    return nextRank < currentRank;
  }

  return next.targetId.localeCompare(current.targetId) < 0;
}

function getFeatureRank(match: Pick<AlignmentMatch, "sourceFeature" | "targetFeature">): number {
  return getSingleFeatureRank(match.sourceFeature) + getSingleFeatureRank(match.targetFeature);
}

function getSingleFeatureRank(feature: AlignmentFeature): number {
  switch (feature) {
    case "center":
      return 0;
    case "min":
    case "max":
      return 1;
    case "pivot":
      return 2;
  }
}

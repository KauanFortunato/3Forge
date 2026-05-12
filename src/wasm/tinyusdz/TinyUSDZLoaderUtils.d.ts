import { Material, Object3D } from "three";

export interface BuildThreeNodeOptions {
  overrideMaterial?: boolean;
  envMap?: unknown;
  envMapIntensity?: number;
}

export class TinyUSDZLoaderUtils {
  static buildThreeNode(
    usdNode: unknown,
    defaultMtl?: Material | null,
    usdScene?: unknown,
    options?: BuildThreeNodeOptions,
  ): Object3D;
}

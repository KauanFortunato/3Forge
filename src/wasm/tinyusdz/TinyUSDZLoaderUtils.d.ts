import { Material, MeshPhysicalMaterial, Object3D } from "three";

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
  ): Promise<Object3D>;

  static setupMesh(
    mesh: unknown,
    defaultMtl: Material | null,
    usdScene: unknown,
    options: BuildThreeNodeOptions,
  ): Promise<Object3D>;

  static convertUsdMaterialToMeshPhysicalMaterial(
    usdMaterial: unknown,
    usdScene: unknown,
  ): Promise<MeshPhysicalMaterial>;
}

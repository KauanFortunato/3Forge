import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

export class SampleExportedComponent {
  public readonly group: Group;

  constructor() {
    this.group = new Group();
    this.group.name = "SampleExportedComponent";
  }

  public async build(): Promise<void> {
    this.dispose();

    const geometry = new BoxGeometry(1.4, 1.4, 1.4);
    const material = new MeshStandardMaterial({
      color: "#7c44de",
      roughness: 0.45,
      metalness: 0.12,
    });
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  public dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material?.dispose?.();
      }
    });

    this.group.clear();
  }
}

import { AnimationClip, BufferGeometry, Group, Mesh, MeshStandardMaterial, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";

import { buildGltfImportData, materialSpecFromThreeMaterial, remapGltfPlanMaterialIds } from "./gltfImport";

describe("gltfImport", () => {
  it("extracts scalar/color fields from a Three.js material", () => {
    const material = new MeshStandardMaterial({ color: 0xff8800, roughness: 0.7, metalness: 0.25 });
    const spec = materialSpecFromThreeMaterial(material);
    expect(spec.color).toBe("#ff8800");
    expect(spec.roughness).toBeCloseTo(0.7);
    expect(spec.metalness).toBeCloseTo(0.25);
    expect(spec.type).toBe("standard");
  });

  it("builds a hierarchical explode plan preserving groups, with local transforms and unique materials", () => {
    const scene = new Group();
    const body = new Group();
    body.name = "Body";
    body.position.set(0, 1, 0);

    const redMat = new MeshStandardMaterial({ color: 0xff0000 });
    const chassis = new Mesh(new BufferGeometry(), redMat);
    chassis.name = "Chassis";
    chassis.position.set(0, 0.5, 0);

    const blueMat = new MeshStandardMaterial({ color: 0x0000ff });
    const wheel = new Mesh(new BufferGeometry(), blueMat);
    wheel.name = "Wheel";

    // Two meshes sharing the same material instance -> a single MaterialAsset.
    const wheel2 = new Mesh(new BufferGeometry(), blueMat);
    wheel2.name = "Wheel2";

    body.add(chassis, wheel, wheel2);
    scene.add(body);

    const { plan, materials } = buildGltfImportData(scene);

    // The Body group is preserved as an xform node holding the meshes.
    expect(plan).toHaveLength(1);
    const bodyPlan = plan[0];
    expect(bodyPlan.kind).toBe("xform");
    expect(bodyPlan.name).toBe("Body");
    expect(bodyPlan.partPath).toBeUndefined();
    // Local transform (relative to parent), not baked to world.
    expect(bodyPlan.position).toEqual({ x: 0, y: 1, z: 0 });

    expect(bodyPlan.children.map((c) => c.name)).toEqual(["Chassis", "Wheel", "Wheel2"]);
    expect(bodyPlan.children.map((c) => c.kind)).toEqual(["mesh", "mesh", "mesh"]);
    expect(bodyPlan.children.map((c) => c.partPath)).toEqual(["0.0", "0.1", "0.2"]);

    const chassisPlan = bodyPlan.children[0];
    expect(chassisPlan.position).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(chassisPlan.materialId).toBe(redMat.uuid);

    // Shared material instance de-duplicates to one snapshot.
    expect(materials).toHaveLength(2);
    expect(materials.map((m) => m.key).sort()).toEqual([redMat.uuid, blueMat.uuid].sort());
    const red = materials.find((m) => m.key === redMat.uuid);
    expect(red?.spec.color).toBe("#ff0000");
  });

  it("collapses redundant single-child wrapper groups into the mesh, composing transforms", () => {
    // scene -> "Car" (wrapper, 1 child) -> "Inner" (wrapper, 1 child) -> mesh
    const scene = new Group();
    const car = new Group();
    car.name = "Car";
    car.position.set(2, 0, 0);
    const inner = new Group();
    inner.name = ""; // anonymous converter wrapper
    inner.position.set(0, 0, 3);
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ color: 0x00ff00 }));
    mesh.name = "";
    mesh.position.set(0, 1, 0);
    inner.add(mesh);
    car.add(inner);
    scene.add(car);

    const { plan } = buildGltfImportData(scene);

    // The whole single-child chain collapses to one mesh node.
    expect(plan).toHaveLength(1);
    const part = plan[0];
    expect(part.kind).toBe("mesh");
    // Keeps the authored container name over the anonymous wrappers/mesh.
    expect(part.name).toBe("Car");
    // partPath still points at the mesh in the *parsed* tree (0 -> 0 -> 0).
    expect(part.partPath).toBe("0.0.0");
    // Composed local transform: 2 + 0 + 0 (x), 0 + 0 + 1 (y), 0 + 3 + 0 (z).
    expect(part.position.x).toBeCloseTo(2);
    expect(part.position.y).toBeCloseTo(1);
    expect(part.position.z).toBeCloseTo(3);
  });

  it("keeps multi-child groups (does not collapse real hierarchy)", () => {
    const scene = new Group();
    const group = new Group();
    group.name = "Rig";
    const a = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    a.name = "A";
    const b = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    b.name = "B";
    group.add(a, b);
    scene.add(group);

    const { plan } = buildGltfImportData(scene);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("xform");
    expect(plan[0].name).toBe("Rig");
    expect(plan[0].children.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("attaches per-node glTF animations to the matching mesh part", () => {
    const scene = new Group();
    const wheel = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    wheel.name = "Wheel";
    const body = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    body.name = "Body";
    scene.add(wheel, body);

    // Animate only the wheel's Y position from 0 -> 5.
    const track = new VectorKeyframeTrack("Wheel.position", [0, 1], [0, 0, 0, 0, 5, 0]);
    const clip = new AnimationClip("Spin", 1, [track]);

    const { plan } = buildGltfImportData(scene, [clip]);
    const wheelPlan = plan.find((n) => n.name === "Wheel");
    const bodyPlan = plan.find((n) => n.name === "Body");
    expect(wheelPlan?.animation).toBeDefined();
    expect(wheelPlan?.animation?.tracks.some((t) => t.property === "transform.position.y")).toBe(true);
    // The non-animated part gets no tracks.
    expect(bodyPlan?.animation).toBeUndefined();
  });

  it("does not collapse an animated single-child wrapper group", () => {
    const scene = new Group();
    const hub = new Group();
    hub.name = "Hub";
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    mesh.name = "Spinner";
    hub.add(mesh);
    scene.add(hub);

    const track = new VectorKeyframeTrack("Hub.position", [0, 1], [0, 0, 0, 0, 2, 0]);
    const clip = new AnimationClip("Move", 1, [track]);

    const { plan } = buildGltfImportData(scene, [clip]);
    // Hub is animated, so it stays as its own node instead of folding into Spinner.
    expect(plan).toHaveLength(1);
    expect(plan[0].name).toBe("Hub");
    expect(plan[0].kind).toBe("xform");
    expect(plan[0].animation).toBeDefined();
    expect(plan[0].children.map((c) => c.name)).toEqual(["Spinner"]);
  });

  it("remaps source-material keys to real MaterialAsset ids and clears unknown keys", () => {
    const scene = new Group();
    const matA = new MeshStandardMaterial({ color: 0x112233 });
    const meshA = new Mesh(new BufferGeometry(), matA);
    meshA.name = "A";
    scene.add(meshA);

    const { plan } = buildGltfImportData(scene);
    expect(plan[0].partPath).toBe("0");
    expect(plan[0].materialId).toBe(matA.uuid);

    const mapped = remapGltfPlanMaterialIds(plan, new Map([[matA.uuid, "material-real-1"]]));
    expect(mapped[0].materialId).toBe("material-real-1");

    const unmapped = remapGltfPlanMaterialIds(plan, new Map());
    expect(unmapped[0].materialId).toBeUndefined();
  });
});

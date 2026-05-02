import { describe, expect, it } from "vitest";
import {
  getCompatiblePaths,
  isPathCompatible,
  type NodeType,
} from "./propertyCompatibility";

const ALL_TYPES: NodeType[] = [
  "group",
  "box",
  "sphere",
  "circle",
  "cylinder",
  "plane",
  "text",
  "image",
];

const NON_GROUP_TYPES: NodeType[] = ALL_TYPES.filter((t) => t !== "group");

const TRANSFORM_PATHS = [
  "transform.position.x",
  "transform.position.y",
  "transform.position.z",
  "transform.rotation.x",
  "transform.rotation.y",
  "transform.rotation.z",
  "transform.scale.x",
  "transform.scale.y",
  "transform.scale.z",
  "origin.x",
  "origin.y",
  "origin.z",
];

describe("isPathCompatible — transform & origin", () => {
  it("marks every transform/origin path as applicable across every type pair", () => {
    for (const source of ALL_TYPES) {
      for (const target of ALL_TYPES) {
        for (const path of TRANSFORM_PATHS) {
          const result = isPathCompatible(source, target, path);
          expect(result).toEqual({ status: "applicable", targetPath: path });
        }
      }
    }
  });

  it("marks top-level `visible` as applicable across every type pair", () => {
    for (const source of ALL_TYPES) {
      for (const target of ALL_TYPES) {
        expect(isPathCompatible(source, target, "visible")).toEqual({
          status: "applicable",
          targetPath: "visible",
        });
      }
    }
  });

  it("reports unknown transform paths as unsupported with an explicit reason", () => {
    const result = isPathCompatible("box", "box", "transform.position.w");
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toContain("transform.position.w");
    }
  });
});

describe("isPathCompatible — group excludes material & geometry", () => {
  it("unsupports all material paths when the source is a group", () => {
    const materialPaths = [
      "material.color",
      "material.opacity",
      "material.emissive",
      "material.castShadow",
      "material.type",
    ];
    for (const path of materialPaths) {
      for (const target of NON_GROUP_TYPES) {
        const result = isPathCompatible("group", target, path);
        expect(result.status).toBe("unsupported");
      }
    }
  });

  it("unsupports all material paths when the target is a group", () => {
    const result = isPathCompatible("box", "group", "material.color");
    expect(result.status).toBe("unsupported");
  });

  it("unsupports all geometry paths when either side is a group", () => {
    expect(isPathCompatible("group", "box", "geometry.width").status).toBe("unsupported");
    expect(isPathCompatible("box", "group", "geometry.width").status).toBe("unsupported");
  });
});

describe("isPathCompatible — material common & shadow", () => {
  it("cross-applies material common paths between any two non-group nodes", () => {
    for (const source of NON_GROUP_TYPES) {
      for (const target of NON_GROUP_TYPES) {
        expect(isPathCompatible(source, target, "material.color")).toEqual({
          status: "applicable",
          targetPath: "material.color",
        });
        expect(isPathCompatible(source, target, "material.opacity")).toEqual({
          status: "applicable",
          targetPath: "material.opacity",
        });
        expect(isPathCompatible(source, target, "material.visible")).toEqual({
          status: "applicable",
          targetPath: "material.visible",
        });
        expect(isPathCompatible(source, target, "material.mapImageId")).toEqual({
          status: "applicable",
          targetPath: "material.mapImageId",
        });
      }
    }
  });

  it("cross-applies shadow paths between any two non-group nodes", () => {
    expect(isPathCompatible("box", "sphere", "material.castShadow")).toEqual({
      status: "applicable",
      targetPath: "material.castShadow",
    });
    expect(isPathCompatible("text", "image", "material.receiveShadow")).toEqual({
      status: "applicable",
      targetPath: "material.receiveShadow",
    });
  });

  it("treats `material.type` itself as applicable between non-group pairs", () => {
    expect(isPathCompatible("box", "sphere", "material.type")).toEqual({
      status: "applicable",
      targetPath: "material.type",
    });
  });
});

describe("isPathCompatible — material type-specific properties", () => {
  it("applies `material.emissive` from standard→standard", () => {
    const result = isPathCompatible("box", "sphere", "material.emissive", {
      sourceMaterialType: "standard",
      targetMaterialType: "standard",
    });
    expect(result).toEqual({ status: "applicable", targetPath: "material.emissive" });
  });

  it("unsupports `material.emissive` from standard→basic with the exact reason", () => {
    const result = isPathCompatible("box", "sphere", "material.emissive", {
      sourceMaterialType: "standard",
      targetMaterialType: "basic",
    });
    expect(result).toEqual({
      status: "unsupported",
      reason: "target material type does not expose this material property",
    });
  });

  it("unsupports `material.emissive` from basic→basic (source lacks it)", () => {
    const result = isPathCompatible("box", "sphere", "material.emissive", {
      sourceMaterialType: "basic",
      targetMaterialType: "basic",
    });
    expect(result.status).toBe("unsupported");
  });

  it("unsupports `material.roughness`/`material.metalness` when the target is basic", () => {
    for (const path of ["material.roughness", "material.metalness"]) {
      const result = isPathCompatible("box", "plane", path, {
        sourceMaterialType: "standard",
        targetMaterialType: "basic",
      });
      expect(result.status).toBe("unsupported");
    }
  });

  it("applies physical essentials only between physical materials", () => {
    expect(isPathCompatible("box", "sphere", "material.transmission", {
      sourceMaterialType: "physical",
      targetMaterialType: "physical",
    })).toEqual({ status: "applicable", targetPath: "material.transmission" });
    expect(isPathCompatible("box", "sphere", "material.transmission", {
      sourceMaterialType: "physical",
      targetMaterialType: "standard",
    }).status).toBe("unsupported");
  });
});

describe("isPathCompatible — geometry exact matches", () => {
  it("is applicable for same-type exact geometry paths", () => {
    expect(isPathCompatible("box", "box", "geometry.width")).toEqual({
      status: "applicable",
      targetPath: "geometry.width",
    });
    expect(isPathCompatible("cylinder", "cylinder", "geometry.radiusTop")).toEqual({
      status: "applicable",
      targetPath: "geometry.radiusTop",
    });
  });

  it("reports geometry paths absent on the source as unsupported", () => {
    const result = isPathCompatible("sphere", "sphere", "geometry.width");
    expect(result.status).toBe("unsupported");
  });
});

describe("isPathCompatible — geometry aliases", () => {
  it("aliases plane.width → image.width and plane.height → image.height", () => {
    expect(isPathCompatible("plane", "image", "geometry.width")).toEqual({
      status: "alias",
      targetPath: "geometry.width",
    });
    expect(isPathCompatible("plane", "image", "geometry.height")).toEqual({
      status: "alias",
      targetPath: "geometry.height",
    });
  });

  it("aliases image.width → plane.width symmetrically", () => {
    expect(isPathCompatible("image", "plane", "geometry.width")).toEqual({
      status: "alias",
      targetPath: "geometry.width",
    });
  });

  it("does not alias plane.width → box.width (different semantic)", () => {
    const result = isPathCompatible("plane", "box", "geometry.width");
    expect(result.status).toBe("unsupported");
  });

  it("aliases sphere.radius ↔ circle.radius", () => {
    expect(isPathCompatible("sphere", "circle", "geometry.radius")).toEqual({
      status: "alias",
      targetPath: "geometry.radius",
    });
    expect(isPathCompatible("circle", "sphere", "geometry.radius")).toEqual({
      status: "alias",
      targetPath: "geometry.radius",
    });
  });

  it("intentionally does NOT alias sphere.radius → cylinder.radiusTop", () => {
    const result = isPathCompatible("sphere", "cylinder", "geometry.radius");
    expect(result.status).toBe("unsupported");
  });

  it("aliases cylinder.height ↔ box.height", () => {
    expect(isPathCompatible("cylinder", "box", "geometry.height")).toEqual({
      status: "alias",
      targetPath: "geometry.height",
    });
    expect(isPathCompatible("box", "cylinder", "geometry.height")).toEqual({
      status: "alias",
      targetPath: "geometry.height",
    });
  });
});

describe("isPathCompatible — text & image specifics", () => {
  it("allows text geometry within text only", () => {
    expect(isPathCompatible("text", "text", "geometry.text")).toEqual({
      status: "applicable",
      targetPath: "geometry.text",
    });
    expect(isPathCompatible("text", "box", "geometry.text").status).toBe("unsupported");
    expect(isPathCompatible("text", "box", "geometry.bevelEnabled").status).toBe("unsupported");
  });
});

describe("isPathCompatible — unknown paths", () => {
  it("returns an unsupported result with an explicit reason for unknown paths", () => {
    const result = isPathCompatible("box", "box", "foo.bar");
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toMatch(/unknown/i);
    }
  });

  it("returns an unsupported result for an unknown material path", () => {
    const result = isPathCompatible("box", "box", "material.unknown");
    expect(result.status).toBe("unsupported");
  });
});

describe("getCompatiblePaths", () => {
  it("returns all geometry + material + transform for box→box", () => {
    const result = getCompatiblePaths("box", "box", {
      sourceMaterialType: "standard",
      targetMaterialType: "standard",
    });
    const paths = result.map((entry) => entry.path);

    // transform + origin
    for (const path of TRANSFORM_PATHS) {
      expect(paths).toContain(path);
    }
    // top-level
    expect(paths).toContain("visible");
    // material common
    expect(paths).toContain("material.color");
    expect(paths).toContain("material.opacity");
    expect(paths).toContain("material.visible");
    expect(paths).toContain("material.type");
    // material shadow
    expect(paths).toContain("material.castShadow");
    expect(paths).toContain("material.receiveShadow");
    // material PBR (both standard)
    expect(paths).toContain("material.emissive");
    expect(paths).toContain("material.roughness");
    expect(paths).toContain("material.metalness");
    expect(paths).toContain("material.fog");
    expect(paths).not.toContain("material.transmission");
    // geometry
    expect(paths).toContain("geometry.width");
    expect(paths).toContain("geometry.height");
    expect(paths).toContain("geometry.depth");

    // All same-type results should be `applicable`, not `alias`.
    for (const entry of result) {
      expect(entry.kind).toBe("applicable");
    }
  });

  it("returns only transform/origin/visible for group→box", () => {
    const result = getCompatiblePaths("group", "box");
    const paths = result.map((entry) => entry.path).sort();
    const expected = [...TRANSFORM_PATHS, "visible"].sort();
    expect(paths).toEqual(expected);
    for (const entry of result) {
      expect(entry.kind).toBe("applicable");
    }
  });

  it("omits material.emissive from source list when source material is basic", () => {
    const result = getCompatiblePaths("box", "box", {
      sourceMaterialType: "basic",
      targetMaterialType: "basic",
    });
    const paths = result.map((entry) => entry.path);
    expect(paths).not.toContain("material.emissive");
    expect(paths).not.toContain("material.roughness");
    expect(paths).not.toContain("material.metalness");
    // Common material paths still present.
    expect(paths).toContain("material.color");
    expect(paths).toContain("material.visible");
  });

  it("marks plane→image geometry matches as alias entries", () => {
    const result = getCompatiblePaths("plane", "image");
    const widthEntry = result.find((entry) => entry.path === "geometry.width");
    expect(widthEntry).toEqual({
      path: "geometry.width",
      targetPath: "geometry.width",
      kind: "alias",
    });
  });
});

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <pxr/pxr.h>
#include <pxr/base/plug/registry.h>
#include <pxr/base/gf/matrix4d.h>
#include <pxr/base/gf/vec2f.h>
#include <pxr/base/gf/vec3f.h>
#include <pxr/base/tf/token.h>
#include <pxr/base/vt/array.h>
#include <pxr/base/vt/value.h>
#include <pxr/usd/ar/asset.h>
#include <pxr/usd/ar/resolver.h>
#include <pxr/usd/ar/resolvedPath.h>
#include <pxr/usd/ar/resolverContextBinder.h>
#include <pxr/usd/sdf/assetPath.h>
#include <pxr/usd/sdf/layer.h>
#include <pxr/usd/sdf/path.h>
#include <pxr/usd/sdf/types.h>
#include <pxr/usd/usd/attribute.h>
#include <pxr/usd/usd/prim.h>
#include <pxr/usd/usd/primRange.h>
#include <pxr/usd/usd/stage.h>
#include <pxr/usd/usd/timeCode.h>
#include <pxr/usd/usdGeom/mesh.h>
#include <pxr/usd/usdGeom/imageable.h>
#include <pxr/usd/usdGeom/primvar.h>
#include <pxr/usd/usdGeom/primvarsAPI.h>
#include <pxr/usd/usdGeom/subset.h>
#include <pxr/usd/usdGeom/xformable.h>
#include <pxr/usd/usdShade/connectableAPI.h>
#include <pxr/usd/usdShade/input.h>
#include <pxr/usd/usdShade/material.h>
#include <pxr/usd/usdShade/materialBindingAPI.h>
#include <pxr/usd/usdShade/shader.h>
#include <pxr/usd/usdSkel/animation.h>
#include <pxr/usd/usdSkel/bindingAPI.h>
#include <pxr/usd/usdSkel/blendShape.h>
#include <pxr/usd/usdSkel/root.h>
#include <pxr/usd/usdSkel/skeleton.h>
#include <pxr/usd/usdSkel/topology.h>
#include <pxr/usd/usdSkel/utils.h>
#include <pxr/base/gf/matrix4f.h>
#include <pxr/base/gf/quatf.h>
#include <pxr/base/gf/vec3f.h>

namespace em = emscripten;

// ============================================================================
// Stage cache
// ============================================================================
static std::unordered_map<int, pxr::UsdStageRefPtr> g_stages;
static int g_nextStageId = 1;

// ============================================================================
// TypedArray helpers (zero-copy view + slice for safety)
// ============================================================================
static em::val makeFloat32Array(const float* data, size_t count) {
    em::val Float32 = em::val::global("Float32Array");
    if (count == 0) return Float32.new_(0);
    auto view = em::typed_memory_view(count, data);
    return Float32.new_(view).call<em::val>("slice");
}

static em::val makeInt32Array(const int* data, size_t count) {
    em::val Int32 = em::val::global("Int32Array");
    if (count == 0) return Int32.new_(0);
    auto view = em::typed_memory_view(count, data);
    return Int32.new_(view).call<em::val>("slice");
}

static em::val makeUint8Array(const uint8_t* data, size_t count) {
    em::val Uint8 = em::val::global("Uint8Array");
    if (count == 0) return Uint8.new_(0);
    auto view = em::typed_memory_view(count, data);
    return Uint8.new_(view).call<em::val>("slice");
}

// ============================================================================
// Existing functions (unchanged)
// ============================================================================
std::string getUsdVersion() {
    return std::to_string(PXR_MAJOR_VERSION) + "." +
            std::to_string(PXR_MINOR_VERSION) + "." +
            std::to_string(PXR_PATCH_VERSION);
}

std::string registerPlugins(const std::string& path) {
    pxr::PlugPluginPtrVector plugins =
        pxr::PlugRegistry::GetInstance().RegisterPlugins(path);
    return "REGISTERED_PLUGINS=" + std::to_string(plugins.size());
}

std::string createAnonymousLayer() {
    pxr::SdfLayerRefPtr layer = pxr::SdfLayer::CreateAnonymous();
    if (!layer) return "FAILED_CREATE_LAYER";
    return "CREATED_LAYER=" + layer->GetIdentifier();
}

std::string importUsdaFromString(const std::string& usdaText) {
    pxr::SdfLayerRefPtr layer = pxr::SdfLayer::CreateAnonymous(".usda");
    if (!layer) return "FAILED_CREATE_LAYER";
    if (!layer->ImportFromString(usdaText)) return "FAILED_IMPORT_STRING";
    std::string exported;
    if (!layer->ExportToString(&exported)) return "FAILED_EXPORT_STRING";
    return exported;
}

std::string openStageFromUsdaString(const std::string& usdaText) {
    pxr::SdfLayerRefPtr layer = pxr::SdfLayer::CreateAnonymous(".usda");
    if (!layer) return "FAILED_CREATE_LAYER";
    if (!layer->ImportFromString(usdaText)) return "FAILED_IMPORT_STRING";
    pxr::UsdStageRefPtr stage = pxr::UsdStage::Open(layer);
    if (!stage) return "FAILED_OPEN_STAGE";
    pxr::UsdPrim root = stage->GetPrimAtPath(pxr::SdfPath("/Root"));
    if (!root) return "STAGE_OPENED_BUT_ROOT_NOT_FOUND";
    return "STAGE_OPENED_ROOT_TYPE=" + root.GetTypeName().GetString();
}

std::string listPrimsFromUsdaString(const std::string& usdaText) {
    pxr::SdfLayerRefPtr layer = pxr::SdfLayer::CreateAnonymous(".usda");
    if (!layer) return "FAILED_CREATE_LAYER";
    if (!layer->ImportFromString(usdaText)) return "FAILED_IMPORT_STRING";
    pxr::UsdStageRefPtr stage = pxr::UsdStage::Open(layer);
    if (!stage) return "FAILED_OPEN_STAGE";
    std::ostringstream out;
    for (const pxr::UsdPrim& prim : stage->Traverse()) {
        out << prim.GetPath().GetString() << " | "
            << prim.GetTypeName().GetString() << "\n";
    }
    return out.str();
}

// ============================================================================
// NEW: Stage management (binary)
// ============================================================================

// Open USDC or USDZ from in-memory buffer. Returns stageId (>=1) or -1 on error.
int openStageFromBinary(em::val jsBytes, const std::string& filename) {
    std::vector<uint8_t> bytes = em::convertJSArrayToNumberVector<uint8_t>(jsBytes);
    if (bytes.empty()) return -1;

    // Write to MEMFS so USD's resolver can open it (USDZ asset paths
    // like "model.usdz[textures/diffuse.jpg]" require a real file path).
    std::string vpath = "/tmp/" + filename;
    if (FILE* fp = fopen(vpath.c_str(), "wb")) {
        fwrite(bytes.data(), 1, bytes.size(), fp);
        fclose(fp);
    } else {
        return -1;
    }

    pxr::UsdStageRefPtr stage = pxr::UsdStage::Open(vpath);
    if (!stage) return -1;

    int id = g_nextStageId++;
    g_stages[id] = stage;
    return id;
}

void closeStage(int stageId) { g_stages.erase(stageId); }
bool hasStage(int stageId) { return g_stages.count(stageId) > 0; }

// ============================================================================
// NEW: Prim hierarchy
// ============================================================================

// Returns Array<{path, type, parent, hasMesh, hasXformable}>
em::val listPrims(int stageId) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();

    em::val arr = em::val::array();
    int idx = 0;
    for (const pxr::UsdPrim& prim : it->second->Traverse()) {
        em::val o = em::val::object();
        o.set("path", prim.GetPath().GetString());
        o.set("type", prim.GetTypeName().GetString());
        o.set("parent", prim.GetParent() ? prim.GetParent().GetPath().GetString()
                                          : std::string(""));
        o.set("isMesh", prim.IsA<pxr::UsdGeomMesh>());
        o.set("isXformable", static_cast<bool>(pxr::UsdGeomXformable(prim)));
        arr.set(idx++, o);
    }
    return arr;
}

// ============================================================================
// NEW: Mesh geometry
// ============================================================================

// Returns:
//   {
//     points: Float32Array,           // xyz triples
//     normals: Float32Array,          // xyz triples (may be empty)
//     uvs: Float32Array,              // st pairs (may be empty)
//     faceVertexCounts: Int32Array,
//     faceVertexIndices: Int32Array,
//     normalsInterpolation: string,   // "vertex"|"faceVarying"|"uniform"|"constant"
//     uvsInterpolation: string,
//     subsets: Array<{name, indices: Int32Array, materialPath: string}>
//   }
em::val getMeshData(int stageId, const std::string& primPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();

    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    if (!prim || !prim.IsA<pxr::UsdGeomMesh>()) return em::val::null();

    pxr::UsdGeomMesh mesh(prim);

    pxr::VtArray<pxr::GfVec3f> points;
    mesh.GetPointsAttr().Get(&points);

    pxr::VtArray<int> faceVertexCounts;
    mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts);

    pxr::VtArray<int> faceVertexIndices;
    mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices);

    pxr::VtArray<pxr::GfVec3f> normals;
    std::string normalsInterp;
    if (auto attr = mesh.GetNormalsAttr()) {
        if (attr.Get(&normals)) normalsInterp = mesh.GetNormalsInterpolation().GetString();
    }

    pxr::VtArray<pxr::GfVec2f> uvs;
    std::string uvsInterp;
    {
        pxr::UsdGeomPrimvarsAPI primvars(prim);
        pxr::UsdGeomPrimvar st = primvars.GetPrimvar(pxr::TfToken("st"));
        if (!st) st = primvars.GetPrimvar(pxr::TfToken("UVMap"));
        if (!st) {
            // Fall back: first float2/texCoord2 primvar (some authors use
            // names like "uv", "uv0", "Texture_Coordinate", etc).
            for (const auto& pv : primvars.GetPrimvars()) {
                const pxr::SdfValueTypeName type = pv.GetTypeName();
                if (type == pxr::SdfValueTypeNames->TexCoord2fArray
                    || type == pxr::SdfValueTypeNames->Float2Array) {
                    st = pv;
                    break;
                }
            }
        }
        if (st) {
            // ComputeFlattened expands indexed primvars (UVs are commonly
            // stored as compact-values + indices array). For non-indexed
            // primvars it returns the data unchanged.
            if (st.ComputeFlattened(&uvs)) {
                uvsInterp = st.GetInterpolation().GetString();
            }
        }
    }

    em::val result = em::val::object();
    result.set("points", makeFloat32Array(
        reinterpret_cast<const float*>(points.data()), points.size() * 3));
    result.set("normals", makeFloat32Array(
        reinterpret_cast<const float*>(normals.data()), normals.size() * 3));
    result.set("uvs", makeFloat32Array(
        reinterpret_cast<const float*>(uvs.data()), uvs.size() * 2));
    result.set("faceVertexCounts",
        makeInt32Array(faceVertexCounts.data(), faceVertexCounts.size()));
    result.set("faceVertexIndices",
        makeInt32Array(faceVertexIndices.data(), faceVertexIndices.size()));
    result.set("normalsInterpolation", normalsInterp);
    result.set("uvsInterpolation", uvsInterp);

    // GeomSubsets — face partitions for per-face material binding
    em::val subsets = em::val::array();
    int subsetIdx = 0;
    for (const pxr::UsdPrim& child : prim.GetChildren()) {
        if (!child.IsA<pxr::UsdGeomSubset>()) continue;
        pxr::UsdGeomSubset subset(child);
        pxr::VtArray<int> indices;
        subset.GetIndicesAttr().Get(&indices);

        em::val s = em::val::object();
        s.set("name", child.GetName().GetString());
        s.set("indices", makeInt32Array(indices.data(), indices.size()));
        pxr::UsdShadeMaterialBindingAPI binding(child);
        pxr::UsdShadeMaterial bound = binding.ComputeBoundMaterial();
        s.set("materialPath", bound ? bound.GetPath().GetString() : std::string(""));
        subsets.set(subsetIdx++, s);
    }
    result.set("subsets", subsets);

    return result;
}

// ============================================================================
// NEW: Transforms (column-major Float32Array[16] for Three.js Matrix4)
// ============================================================================
em::val getLocalTransform(int stageId, const std::string& primPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    pxr::UsdGeomXformable xform(prim);
    if (!xform) return em::val::null();

    pxr::GfMatrix4d m(1.0);
    bool resets;
    xform.GetLocalTransformation(&m, &resets);

    float v[16];
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r) v[c * 4 + r] = static_cast<float>(m[r][c]);
    return makeFloat32Array(v, 16);
}

em::val getWorldTransform(int stageId, const std::string& primPath, double t) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    pxr::UsdGeomXformable xform(prim);
    if (!xform) return em::val::null();

    pxr::UsdTimeCode tc = std::isnan(t) ? pxr::UsdTimeCode::Default()
                                        : pxr::UsdTimeCode(t);
    pxr::GfMatrix4d m = xform.ComputeLocalToWorldTransform(tc);

    float v[16];
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r) v[c * 4 + r] = static_cast<float>(m[r][c]);
    return makeFloat32Array(v, 16);
}

// ============================================================================
// NEW: Materials
// ============================================================================

// Returns "" if no binding.
std::string getMaterialBinding(int stageId, const std::string& primPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return "";
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    if (!prim) return "";
    pxr::UsdShadeMaterialBindingAPI binding(prim);
    pxr::UsdShadeMaterial mat = binding.ComputeBoundMaterial();
    return mat ? mat.GetPath().GetString() : "";
}

static em::val readShaderInput(const pxr::UsdShadeShader& shader,
                                const pxr::TfToken& name) {
    pxr::UsdShadeInput input = shader.GetInput(name);
    if (!input) return em::val::null();

    // Connected → texture?
    pxr::UsdShadeConnectableAPI source;
    pxr::TfToken sourceName;
    pxr::UsdShadeAttributeType sourceType;
    if (input.GetConnectedSource(&source, &sourceName, &sourceType)) {
        pxr::UsdShadeShader connected(source.GetPrim());
        if (connected) {
            pxr::TfToken shaderId;
            connected.GetShaderId(&shaderId);
            if (shaderId == pxr::TfToken("UsdUVTexture")) {
                em::val tex = em::val::object();
                tex.set("type", std::string("texture"));
                tex.set("shaderPath", connected.GetPath().GetString());
                tex.set("sourceName", sourceName.GetString());

                if (auto fileIn = connected.GetInput(pxr::TfToken("file"))) {
                    pxr::SdfAssetPath ap;
                    fileIn.Get(&ap);
                    tex.set("assetPath", ap.GetAssetPath());
                    tex.set("resolvedPath", ap.GetResolvedPath());
                }
                if (auto wrapS = connected.GetInput(pxr::TfToken("wrapS"))) {
                    pxr::TfToken w; if (wrapS.Get(&w)) tex.set("wrapS", w.GetString());
                }
                if (auto wrapT = connected.GetInput(pxr::TfToken("wrapT"))) {
                    pxr::TfToken w; if (wrapT.Get(&w)) tex.set("wrapT", w.GetString());
                }
                if (auto stIn = connected.GetInput(pxr::TfToken("st"))) {
                    pxr::UsdShadeConnectableAPI stSrc;
                    pxr::TfToken stName;
                    pxr::UsdShadeAttributeType stType;
                    if (stIn.GetConnectedSource(&stSrc, &stName, &stType)) {
                        pxr::UsdShadeShader stReader(stSrc.GetPrim());
                        if (stReader) {
                            if (auto vn = stReader.GetInput(pxr::TfToken("varname"))) {
                                pxr::TfToken t; if (vn.Get(&t)) tex.set("uvSet", t.GetString());
                            }
                        }
                    }
                }
                return tex;
            }
        }
    }

    // Direct value
    pxr::VtValue v;
    if (!input.Get(&v)) return em::val::null();

    em::val result = em::val::object();
    result.set("type", std::string("value"));

    if (v.IsHolding<pxr::GfVec3f>()) {
        auto vec = v.Get<pxr::GfVec3f>();
        em::val arr = em::val::array();
        arr.set(0, vec[0]); arr.set(1, vec[1]); arr.set(2, vec[2]);
        result.set("value", arr);
    } else if (v.IsHolding<float>())  result.set("value", v.Get<float>());
    else if (v.IsHolding<double>())   result.set("value", v.Get<double>());
    else if (v.IsHolding<int>())      result.set("value", v.Get<int>());
    else if (v.IsHolding<bool>())     result.set("value", v.Get<bool>());
    else                              result.set("value", em::val::null());

    return result;
}

// Returns map of UsdPreviewSurface inputs.
em::val getMaterialParams(int stageId, const std::string& materialPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(materialPath));
    pxr::UsdShadeMaterial material(prim);
    if (!material) return em::val::null();

    pxr::UsdShadeShader surface = material.ComputeSurfaceSource();
    if (!surface) return em::val::null();

    em::val result = em::val::object();
    static const pxr::TfToken kInputs[] = {
        pxr::TfToken("diffuseColor"),
        pxr::TfToken("metallic"),
        pxr::TfToken("roughness"),
        pxr::TfToken("normal"),
        pxr::TfToken("occlusion"),
        pxr::TfToken("emissiveColor"),
        pxr::TfToken("opacity"),
        pxr::TfToken("clearcoat"),
        pxr::TfToken("clearcoatRoughness"),
        pxr::TfToken("ior"),
        pxr::TfToken("specularColor"),
        pxr::TfToken("useSpecularWorkflow"),
    };
    for (const auto& tok : kInputs) {
        em::val v = readShaderInput(surface, tok);
        if (!v.isNull()) result.set(tok.GetString(), v);
    }
    return result;
}

// ============================================================================
// NEW: Asset bytes (USDZ-embedded textures)
// ============================================================================

// assetPath e.g. "0/textures/diffuse.jpg" relative to a USDZ archive.
// Binds the stage's resolver context so USDZ-internal paths resolve correctly
// (USD rewrites them to "/tmp/model.usdz[0/textures/diffuse.jpg]" form internally).
em::val getAssetBytes(int stageId, const std::string& assetPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdStageRefPtr stage = it->second;

    pxr::ArResolver& resolver = pxr::ArGetResolver();
    pxr::ArResolverContextBinder binder(stage->GetPathResolverContext());

    // Anchor the asset path against the root layer so USDZ-internal paths
    // (e.g. "0/foo.png") become valid resolvable paths
    // (e.g. "/tmp/model.usdz[0/foo.png]").
    pxr::SdfLayerHandle rootLayer = stage->GetRootLayer();
    std::string anchored = rootLayer ? rootLayer->ComputeAbsolutePath(assetPath) : assetPath;

    pxr::ArResolvedPath resolved = resolver.Resolve(anchored);
    if (resolved.empty()) {
        resolved = resolver.Resolve(assetPath);
    }
    if (resolved.empty()) return em::val::null();

    std::shared_ptr<pxr::ArAsset> asset = resolver.OpenAsset(resolved);
    if (!asset) return em::val::null();

    size_t size = asset->GetSize();
    std::shared_ptr<const char> buffer = asset->GetBuffer();
    if (!buffer) return em::val::null();

    return makeUint8Array(reinterpret_cast<const uint8_t*>(buffer.get()), size);
}

// ============================================================================
// NEW: Animation
// ============================================================================

em::val getStageTimeInfo(int stageId) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    em::val r = em::val::object();
    r.set("startTime", it->second->GetStartTimeCode());
    r.set("endTime", it->second->GetEndTimeCode());
    r.set("framesPerSecond", it->second->GetFramesPerSecond());
    r.set("timeCodesPerSecond", it->second->GetTimeCodesPerSecond());
    return r;
}

em::val getTimeSamples(int stageId, const std::string& attrPath) {
    em::val arr = em::val::array();
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return arr;
    pxr::UsdAttribute attr = it->second->GetAttributeAtPath(pxr::SdfPath(attrPath));
    if (!attr) return arr;
    std::vector<double> times;
    attr.GetTimeSamples(&times);
    for (size_t i = 0; i < times.size(); ++i) arr.set(i, times[i]);
    return arr;
}

em::val getTimeSampledAttributes(int stageId, const std::string& primPath) {
    em::val arr = em::val::array();
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return arr;
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    if (!prim) return arr;

    size_t outIdx = 0;
    for (const pxr::UsdAttribute& attr : prim.GetAttributes()) {
        if (attr.GetNumTimeSamples() > 0) {
            arr.set(outIdx++, attr.GetName().GetString());
        }
    }
    return arr;
}

std::string getVisibility(int stageId, const std::string& primPath, double t) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return "";
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    pxr::UsdGeomImageable imageable(prim);
    if (!imageable) return "";

    pxr::UsdTimeCode tc = std::isnan(t) ? pxr::UsdTimeCode::Default()
                                        : pxr::UsdTimeCode(t);
    pxr::TfToken visibility;
    if (!imageable.GetVisibilityAttr().Get(&visibility, tc)) return "";
    return visibility.GetString();
}

// ============================================================================
// NEW: UsdSkel — skeleton, skin binding, animation, blend shapes
// ============================================================================
//
// USD skeletal model — quick refresher:
//   * SkelRoot is an xform-like container whose descendants share a skeleton.
//   * Skeleton authors the joint hierarchy: joint paths, rest pose, bind pose.
//   * SkelAnimation drives the joints over time (rotations/translations/scales)
//     and optionally drives blendshape weights.
//   * Meshes inside the SkelRoot carry a SkelBindingAPI: per-point skinning
//     weights, a binding to the Skeleton, and a binding to the SkelAnimation.
//
// These bindings return raw arrays the TS layer assembles into THREE.Skeleton
// + THREE.SkinnedMesh. We deliberately do NOT compute final transforms here —
// the renderer applies bone matrices at draw time.

// Returns { isSkelRoot, skeletonPath, animationPath } for a prim, walking the
// SkelBindingAPI on the prim itself OR inherited from a SkelRoot ancestor.
// Empty strings if no binding.
em::val getSkelRootInfo(int stageId, const std::string& primPath) {
    em::val r = em::val::object();
    r.set("isSkelRoot", false);
    r.set("skeletonPath", std::string(""));
    r.set("animationPath", std::string(""));

    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return r;
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(primPath));
    if (!prim) return r;

    r.set("isSkelRoot", prim.IsA<pxr::UsdSkelRoot>());

    pxr::UsdSkelBindingAPI bindingAPI(prim);
    if (bindingAPI) {
        pxr::UsdSkelSkeleton skel;
        if (bindingAPI.GetSkeleton(&skel)) {
            r.set("skeletonPath", skel.GetPath().GetString());
        }
        pxr::UsdSkelAnimation anim;
        if (bindingAPI.GetAnimationSource(&anim)) {
            r.set("animationPath", anim.GetPath().GetString());
        }
    }
    return r;
}

// Returns { joints, restTransforms, bindTransforms, parentIndices }.
// Joints are USD joint paths (e.g. "root", "root/Bone1") in skeleton order.
// restTransforms are LOCAL space; bindTransforms are WORLD space (USD convention).
// parentIndices[i] = -1 for roots, else index of the joint's parent in `joints`.
em::val getSkeleton(int stageId, const std::string& skelPath) {
    em::val r = em::val::object();
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(skelPath));
    pxr::UsdSkelSkeleton skel(prim);
    if (!skel) return em::val::null();

    pxr::VtArray<pxr::TfToken> jointTokens;
    skel.GetJointsAttr().Get(&jointTokens);

    em::val jointsArr = em::val::array();
    std::vector<std::string> jointStrs;
    jointStrs.reserve(jointTokens.size());
    for (size_t i = 0; i < jointTokens.size(); ++i) {
        jointStrs.push_back(jointTokens[i].GetString());
        jointsArr.set(i, jointStrs.back());
    }
    r.set("joints", jointsArr);

    pxr::VtArray<pxr::GfMatrix4d> rest, bind;
    skel.GetRestTransformsAttr().Get(&rest);
    skel.GetBindTransformsAttr().Get(&bind);

    auto matrixArrayToFloat32 = [](const pxr::VtArray<pxr::GfMatrix4d>& mats) {
        std::vector<float> out(mats.size() * 16);
        for (size_t i = 0; i < mats.size(); ++i) {
            const pxr::GfMatrix4d& m = mats[i];
            for (int c = 0; c < 4; ++c)
                for (int rIdx = 0; rIdx < 4; ++rIdx)
                    out[i * 16 + c * 4 + rIdx] = static_cast<float>(m[rIdx][c]);
        }
        return out;
    };

    std::vector<float> restF = matrixArrayToFloat32(rest);
    std::vector<float> bindF = matrixArrayToFloat32(bind);
    r.set("restTransforms", makeFloat32Array(restF.data(), restF.size()));
    r.set("bindTransforms", makeFloat32Array(bindF.data(), bindF.size()));

    // UsdSkelTopology gives us the parent index of each joint, computed from
    // the slash-separated joint paths (a joint "root/A/B" has parent "root/A").
    pxr::UsdSkelTopology topology(jointTokens);
    std::vector<int> parents(topology.GetNumJoints());
    for (size_t i = 0; i < parents.size(); ++i) {
        parents[i] = topology.GetParent(i);
    }
    r.set("parentIndices", makeInt32Array(parents.data(), parents.size()));

    return r;
}

// Returns { skelPath, animationPath, jointIndices, jointWeights,
//           numInfluencesPerComponent, geomBindTransform } for a mesh prim
// with SkelBindingAPI, or null if the mesh isn't skinned.
em::val getSkinBinding(int stageId, const std::string& meshPath) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(meshPath));
    if (!prim) return em::val::null();

    pxr::UsdSkelBindingAPI binding(prim);
    if (!binding) return em::val::null();

    pxr::UsdGeomPrimvar jiPv = binding.GetJointIndicesPrimvar();
    pxr::UsdGeomPrimvar jwPv = binding.GetJointWeightsPrimvar();
    if (!jiPv || !jwPv) return em::val::null();

    pxr::VtArray<int> jointIndices;
    pxr::VtArray<float> jointWeights;
    if (!jiPv.ComputeFlattened(&jointIndices) || !jwPv.ComputeFlattened(&jointWeights)) {
        return em::val::null();
    }

    em::val r = em::val::object();

    pxr::UsdSkelSkeleton skel;
    if (binding.GetSkeleton(&skel)) {
        r.set("skelPath", skel.GetPath().GetString());
    } else {
        r.set("skelPath", std::string(""));
    }
    pxr::UsdSkelAnimation anim;
    if (binding.GetAnimationSource(&anim)) {
        r.set("animationPath", anim.GetPath().GetString());
    } else {
        r.set("animationPath", std::string(""));
    }

    r.set("jointIndices", makeInt32Array(jointIndices.data(), jointIndices.size()));
    r.set("jointWeights", makeFloat32Array(jointWeights.data(), jointWeights.size()));

    int elementSize = jiPv.GetElementSize();
    if (elementSize <= 0) elementSize = 1;
    r.set("numInfluencesPerComponent", elementSize);

    pxr::GfMatrix4d geomBind(1.0);
    binding.GetGeomBindTransformAttr().Get(&geomBind);
    float gb[16];
    for (int c = 0; c < 4; ++c)
        for (int rIdx = 0; rIdx < 4; ++rIdx)
            gb[c * 4 + rIdx] = static_cast<float>(geomBind[rIdx][c]);
    r.set("geomBindTransform", makeFloat32Array(gb, 16));

    // Mesh's local-space blend shape names (drives morph targets) — empty if none.
    pxr::VtArray<pxr::TfToken> blendShapes;
    binding.GetBlendShapesAttr().Get(&blendShapes);
    em::val bsArr = em::val::array();
    std::vector<std::string> bsStrs;
    bsStrs.reserve(blendShapes.size());
    for (size_t i = 0; i < blendShapes.size(); ++i) {
        bsStrs.push_back(blendShapes[i].GetString());
        bsArr.set(i, bsStrs.back());
    }
    r.set("blendShapes", bsArr);

    // Relationship to BlendShape prims (one target prim per blend shape name).
    pxr::SdfPathVector blendShapeTargets;
    binding.GetBlendShapeTargetsRel().GetTargets(&blendShapeTargets);
    em::val bsTargetsArr = em::val::array();
    std::vector<std::string> bsTargetStrs;
    bsTargetStrs.reserve(blendShapeTargets.size());
    for (size_t i = 0; i < blendShapeTargets.size(); ++i) {
        bsTargetStrs.push_back(blendShapeTargets[i].GetString());
        bsTargetsArr.set(i, bsTargetStrs.back());
    }
    r.set("blendShapeTargets", bsTargetsArr);

    return r;
}

// Returns { joints, rotations, translations, scales, blendShapes, blendShapeWeights }
// at the given timeCode. `rotations` is a Float32Array of quaternions packed as
// [x,y,z,w,x,y,z,w,...] (Three.js convention). `translations` and `scales` are
// xyz triples per joint. `joints` and `blendShapes` are the SkelAnimation's
// own joint/blendShape ordering — the TS layer must remap to skeleton order.
em::val getSkelAnimation(int stageId, const std::string& animPath, double t) {
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return em::val::null();
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(animPath));
    pxr::UsdSkelAnimation anim(prim);
    if (!anim) return em::val::null();

    pxr::UsdTimeCode tc = std::isnan(t) ? pxr::UsdTimeCode::Default()
                                        : pxr::UsdTimeCode(t);

    em::val r = em::val::object();

    pxr::VtArray<pxr::TfToken> jointTokens;
    anim.GetJointsAttr().Get(&jointTokens);
    em::val jointsArr = em::val::array();
    std::vector<std::string> jointStrs;
    jointStrs.reserve(jointTokens.size());
    for (size_t i = 0; i < jointTokens.size(); ++i) {
        jointStrs.push_back(jointTokens[i].GetString());
        jointsArr.set(i, jointStrs.back());
    }
    r.set("joints", jointsArr);

    pxr::VtArray<pxr::GfQuatf> rotations;
    anim.GetRotationsAttr().Get(&rotations, tc);
    std::vector<float> rotF(rotations.size() * 4);
    for (size_t i = 0; i < rotations.size(); ++i) {
        const pxr::GfQuatf& q = rotations[i];
        rotF[i * 4 + 0] = q.GetImaginary()[0];
        rotF[i * 4 + 1] = q.GetImaginary()[1];
        rotF[i * 4 + 2] = q.GetImaginary()[2];
        rotF[i * 4 + 3] = q.GetReal();
    }
    r.set("rotations", makeFloat32Array(rotF.data(), rotF.size()));

    pxr::VtArray<pxr::GfVec3f> translations;
    anim.GetTranslationsAttr().Get(&translations, tc);
    r.set("translations", makeFloat32Array(
        reinterpret_cast<const float*>(translations.data()), translations.size() * 3));

    pxr::VtArray<pxr::GfVec3h> scalesH;
    anim.GetScalesAttr().Get(&scalesH, tc);
    std::vector<float> scaleF(scalesH.size() * 3);
    for (size_t i = 0; i < scalesH.size(); ++i) {
        scaleF[i * 3 + 0] = static_cast<float>(scalesH[i][0]);
        scaleF[i * 3 + 1] = static_cast<float>(scalesH[i][1]);
        scaleF[i * 3 + 2] = static_cast<float>(scalesH[i][2]);
    }
    r.set("scales", makeFloat32Array(scaleF.data(), scaleF.size()));

    pxr::VtArray<pxr::TfToken> bsTokens;
    anim.GetBlendShapesAttr().Get(&bsTokens);
    em::val bsArr = em::val::array();
    std::vector<std::string> bsStrs;
    bsStrs.reserve(bsTokens.size());
    for (size_t i = 0; i < bsTokens.size(); ++i) {
        bsStrs.push_back(bsTokens[i].GetString());
        bsArr.set(i, bsStrs.back());
    }
    r.set("blendShapes", bsArr);

    pxr::VtArray<float> bsWeights;
    anim.GetBlendShapeWeightsAttr().Get(&bsWeights, tc);
    r.set("blendShapeWeights", makeFloat32Array(bsWeights.data(), bsWeights.size()));

    return r;
}

// Returns [{ name, offsets, pointIndices }] for each BlendShape prim referenced
// by the mesh's SkelBindingAPI.blendShapeTargets. `offsets` are xyz deltas per
// affected point, `pointIndices` indexes into the mesh's points array.
em::val getBlendShapes(int stageId, const std::string& meshPath) {
    em::val arr = em::val::array();
    auto it = g_stages.find(stageId);
    if (it == g_stages.end()) return arr;
    pxr::UsdPrim prim = it->second->GetPrimAtPath(pxr::SdfPath(meshPath));
    if (!prim) return arr;

    pxr::UsdSkelBindingAPI binding(prim);
    if (!binding) return arr;

    pxr::SdfPathVector targets;
    binding.GetBlendShapeTargetsRel().GetTargets(&targets);

    size_t outIdx = 0;
    for (const auto& targetPath : targets) {
        pxr::UsdPrim bsPrim = it->second->GetPrimAtPath(targetPath);
        pxr::UsdSkelBlendShape bs(bsPrim);
        if (!bs) continue;

        pxr::VtArray<pxr::GfVec3f> offsets;
        bs.GetOffsetsAttr().Get(&offsets);
        pxr::VtArray<int> pointIndices;
        bs.GetPointIndicesAttr().Get(&pointIndices);

        em::val entry = em::val::object();
        entry.set("name", bsPrim.GetName().GetString());
        entry.set("offsets", makeFloat32Array(
            reinterpret_cast<const float*>(offsets.data()), offsets.size() * 3));
        entry.set("pointIndices", makeInt32Array(pointIndices.data(), pointIndices.size()));
        arr.set(outIdx++, entry);
    }
    return arr;
}

// ============================================================================
// EMSCRIPTEN_BINDINGS
// ============================================================================
EMSCRIPTEN_BINDINGS(openusd_module) {
    using em::function;
    // existing
    function("getUsdVersion", &getUsdVersion);
    function("registerPlugins", &registerPlugins);
    function("createAnonymousLayer", &createAnonymousLayer);
    function("importUsdaFromString", &importUsdaFromString);
    function("openStageFromUsdaString", &openStageFromUsdaString);
    function("listPrimsFromUsdaString", &listPrimsFromUsdaString);
    // new — stage
    function("openStageFromBinary", &openStageFromBinary);
    function("closeStage", &closeStage);
    function("hasStage", &hasStage);
    // new — geometry
    function("listPrims", &listPrims);
    function("getMeshData", &getMeshData);
    function("getLocalTransform", &getLocalTransform);
    function("getWorldTransform", &getWorldTransform);
    // new — materials
    function("getMaterialBinding", &getMaterialBinding);
    function("getMaterialParams", &getMaterialParams);
    // new — assets
    function("getAssetBytes", &getAssetBytes);
    // new — animation
    function("getStageTimeInfo", &getStageTimeInfo);
    function("getTimeSamples", &getTimeSamples);
    function("getTimeSampledAttributes", &getTimeSampledAttributes);
    function("getVisibility", &getVisibility);
    // new — UsdSkel (Phase B)
    function("getSkelRootInfo", &getSkelRootInfo);
    function("getSkeleton", &getSkeleton);
    function("getSkinBinding", &getSkinBinding);
    function("getSkelAnimation", &getSkelAnimation);
    function("getBlendShapes", &getBlendShapes);
}

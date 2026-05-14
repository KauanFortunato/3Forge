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
#include <pxr/usd/usdGeom/primvar.h>
#include <pxr/usd/usdGeom/primvarsAPI.h>
#include <pxr/usd/usdGeom/subset.h>
#include <pxr/usd/usdGeom/xformable.h>
#include <pxr/usd/usdShade/connectableAPI.h>
#include <pxr/usd/usdShade/input.h>
#include <pxr/usd/usdShade/material.h>
#include <pxr/usd/usdShade/materialBindingAPI.h>
#include <pxr/usd/usdShade/shader.h>

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
}

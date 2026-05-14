import * as THREE from 'three';

import { LoaderUtils } from "three"

class TinyUSDZLoaderUtils extends LoaderUtils {

    constructor() {
        super();
    }

    static async getDataFromURI(uri) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return [null, new Error(`Response status: ${response.status}`)];
            }

            const buf = await response.arrayBuiffer();
            const data = new Uint8Array(buf);

            return [data, null];

        } catch (error) {
            return [null, error];
        }
    }

    // Extract file extension from URI/path
    static getFileExtension(uri) {
        if (!uri || typeof uri !== 'string') return '';

        // Remove query parameters and hash
        const cleanUri = uri.split('?')[0].split('#')[0];

        // Get the last part after the last dot
        const lastDotIndex = cleanUri.lastIndexOf('.');
        if (lastDotIndex === -1 || lastDotIndex === cleanUri.length - 1) {
            return '';
        }

        return cleanUri.substring(lastDotIndex + 1).toLowerCase();
    }

    // Determine MIME type from file extension
    static getMimeTypeFromExtension(extension) {
        const mimeTypes = {
            // Images
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'tiff': 'image/tiff',
            'tif': 'image/tiff',
            'svg': 'image/svg+xml',
            'ico': 'image/x-icon',

            // HDR/EXR formats
            'hdr': 'image/vnd.radiance',
            'exr': 'image/x-exr',
            'rgbe': 'image/vnd.radiance',

            // 3D/USD formats
            'usd': 'model/vnd.usdz+zip',
            'usda': 'model/vnd.usd+ascii',
            'usdc': 'model/vnd.usd+binary',
            'usdz': 'model/vnd.usdz+zip',

            // Other common formats
            'json': 'application/json',
            'xml': 'application/xml',
            'txt': 'text/plain',
            'bin': 'application/octet-stream'
        };

        return mimeTypes[extension.toLowerCase()] || null;
    }

    // Helper method to determine MIME type
    static getMimeType(texImage) {

        if (texImage.uri) {
            const mime = this.getMimeTypeFromExtension(this.getFileExtension(texImage.uri));
            if (mime != null) {
                return mime;
            }
        }

        // Try to detect from magic bytes if available
        const data = new Uint8Array(texImage.data);
        if (data.length >= 4) {
            // PNG magic bytes: 89 50 4E 47
            if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
                return 'image/png';
            }
            // JPEG magic bytes: FF D8 FF
            if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
                return 'image/jpeg';
            }
            // WEBP magic bytes: 52 49 46 46 ... 57 45 42 50
            if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
                return 'image/webp';
            }
        }

        // Default fallback
        return 'image/png';
    }

    static toUint8Array(source) {
        if (source instanceof Uint8Array) {
            return source;
        }
        if (ArrayBuffer.isView(source)) {
            return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        }
        return new Uint8Array(source);
    }

    static createTextureDataView(texImage) {
        const channels = texImage.channels;
        const pixelCount = texImage.width * texImage.height;
        const componentCount = pixelCount * channels;
        const source = texImage.data;
        const sourceByteLength = source.byteLength ?? source.length;
        const sourceLength = source.length ?? sourceByteLength;

        if (sourceLength === componentCount && source.BYTES_PER_ELEMENT > 1) {
            const data = new Uint8Array(componentCount);
            if (source instanceof Float32Array || source instanceof Float64Array) {
                for (let index = 0; index < componentCount; index++) {
                    const value = source[index];
                    data[index] = Math.max(0, Math.min(255, value <= 1 ? Math.round(value * 255) : Math.round(value)));
                }
            } else {
                const shift = Math.max(0, (source.BYTES_PER_ELEMENT - 1) * 8);
                for (let index = 0; index < componentCount; index++) {
                    data[index] = Math.max(0, Math.min(255, source[index] >> shift));
                }
            }
            return { data, channels };
        }

        if (sourceByteLength === componentCount * 2) {
            const data = new Uint8Array(componentCount);
            if (source.BYTES_PER_ELEMENT === 2) {
                for (let index = 0; index < componentCount; index++) {
                    data[index] = source[index] >> 8;
                }
            } else {
                const bytes = this.toUint8Array(source);
                for (let index = 0; index < componentCount; index++) {
                    data[index] = bytes[index * 2 + 1] ?? bytes[index * 2] ?? 0;
                }
            }
            return { data, channels };
        }

        if (sourceLength === componentCount) {
            const data = this.toUint8Array(source);
            return { data, channels };
        }

        if (sourceByteLength === componentCount) {
            const data = this.toUint8Array(source);
            return { data, channels };
        }

        if (channels === 3 && sourceLength === pixelCount * 3) {
            const rgb = this.toUint8Array(source);
            const rgba = new Uint8Array(pixelCount * 4);
            for (let pixel = 0; pixel < pixelCount; pixel++) {
                const rgbOffset = pixel * 3;
                const rgbaOffset = pixel * 4;
                rgba[rgbaOffset] = rgb[rgbOffset];
                rgba[rgbaOffset + 1] = rgb[rgbOffset + 1];
                rgba[rgbaOffset + 2] = rgb[rgbOffset + 2];
                rgba[rgbaOffset + 3] = 255;
            }
            return { data: rgba, channels: 4 };
        }

        console.warn(
            "tinyusdz: unexpected decoded texture payload size",
            {
                uri: texImage.uri,
                width: texImage.width,
                height: texImage.height,
                channels,
                sourceLength,
                sourceByteLength,
                expectedComponents: componentCount,
            },
        );
        const data = this.toUint8Array(source);
        return { data, channels };
    }

    static createDataTextureFromUSDImage(texImage) {
        const { data, channels } = this.createTextureDataView(texImage);
        const texture = new THREE.DataTexture(data, texImage.width, texImage.height);
        if (channels == 1) {
            texture.format = THREE.RedFormat;
        } else if (channels == 2) {
            texture.format = THREE.RGFormat;
        } else if (channels == 3) {
            const pixelCount = texImage.width * texImage.height;
            const rgba = new Uint8Array(pixelCount * 4);
            for (let pixel = 0; pixel < pixelCount; pixel++) {
                const rgbOffset = pixel * 3;
                const rgbaOffset = pixel * 4;
                rgba[rgbaOffset] = data[rgbOffset];
                rgba[rgbaOffset + 1] = data[rgbOffset + 1];
                rgba[rgbaOffset + 2] = data[rgbOffset + 2];
                rgba[rgbaOffset + 3] = 255;
            }
            texture.image.data = rgba;
            texture.format = THREE.RGBAFormat;
        } else if (channels == 4) {
            texture.format = THREE.RGBAFormat;
        } else {
            return Promise.reject(new Error("Unsupported image channels: " + channels));
        }
        texture.type = THREE.UnsignedByteType;
        texture.flipY = true;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.unpackAlignment = 1;
        texture.needsUpdate = true;
        return Promise.resolve(texture);
    }

    static prepareTexture(texture, options = {}) {
        texture.flipY = true;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.unpackAlignment = 1;
        if (options.colorSpace) {
            texture.colorSpace = options.colorSpace;
        }
        texture.needsUpdate = true;
        return texture;
    }

    static async getTextureFromUSD(usdScene, textureId, options = {}) {
        if (textureId === undefined) return Promise.reject(new Error("textureId undefined"));


        const tex = usdScene.getTexture(textureId);

        const texImage = usdScene.getImage(tex.textureImageId);
        //console.log("Loading texture from URI:", texImage);

        // there are 3 states for texture:
        // 1. URI only. Need to fetch texture(file) from URI in JS layer.
        // 2. Texture is loaded from USDZ file, but not yet decoded(Use Three.js or JS library to decode)
        // 3. Texture is decoded and ready to use in Three.js.

        if (texImage.uri && (texImage.bufferId == -1)) {
            // Case 1: URI only

            const loader = new THREE.TextureLoader();

            //console.log("Loading texture from URI:", texImage.uri);
            // TODO: Use HDR/EXR loader if a uri is HDR/EXR file.
            return loader.loadAsync(texImage.uri).then((texture) => this.prepareTexture(texture, options));

        } else if (texImage.bufferId >= 0 && texImage.data) {
            //console.log("case 2 or 3");

            if (texImage.decoded) {
                //console.log("case 3");

                return this.createDataTextureFromUSDImage(texImage).then((texture) => this.prepareTexture(texture, options));

            } else {
                //console.log("case 3");
                try {
                    const blob = new Blob([texImage.data], { type: this.getMimeType(texImage) });
                    const blobUrl = URL.createObjectURL(blob);

                    const loader = new THREE.TextureLoader();

                    //console.log("blobUrl", blobUrl);
                    // TODO: Use HDR/EXR loader if a uri is HDR/EXR file.
                    return loader.loadAsync(blobUrl).then((texture) => this.prepareTexture(texture, options));
                } catch (error) {
                    console.error("Failed to create Blob from texture data:", error);
                    return Promise.reject(new Error("Failed to create Blob from texture data"));
                }
            }

        } else {
            //console.log("case 3");
            return Promise.reject(new Error("Invalid USD texture info"));
        }
    }

    static createDefaultMaterial() {
        return new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0.18, 0.18, 0.18),
            emissive: 0x000000,
            metalness: 0.0,
            roughness: 0.5,
            transparent: false,
            depthTest: true,
            side: THREE.FrontSide
        });
    }

    //
    // Convert UsdPreviewSureface to MeshPhysicalMaterial
    // - [x] diffuseColor -> color
    // - [x] ior -> ior
    // - [x] clearcoat -> clearcoat
    // - [x] clearcoatRoughness -> clearcoatRoughness
    // - [x] specularColor -> specular
    // - [x] roughness -> roughness 
    // - [x] metallic -> metalness
    // - [x] emissiveColor -> emissive
    // - [x] opacity -> opacity (TODO: map to .transmission?)
    // - [x] occlusion -> aoMap
    // - [x] normal -> normalMap
    // - [x] displacement -> displacementMap
    static async convertUsdMaterialToMeshPhysicalMaterial(usdMaterial, usdScene) {
        const material = new THREE.MeshPhysicalMaterial();
        const pending = [];

        // Diffuse color and texture
        material.color = new THREE.Color(0.18, 0.18, 0.18);
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'diffuseColor')) {
            const color = usdMaterial.diffuseColor;
            material.color = new THREE.Color(color[0], color[1], color[2]);
            //console.log("diffuseColor:", material.color);
        }

        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'diffuseColorTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.diffuseColorTextureId, { colorSpace: THREE.SRGBColorSpace })
                    .then((texture) => { material.map = texture; })
                    .catch((err) => {
                        console.error("failed to load texture. uri not exists or Cross-Site origin header is not set in the web server?", err);
                    })
            );
        }

        // IOR
        material.ior = 1.5;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'ior')) {
            material.ior = usdMaterial.ior;
        }

        // Clearcoat
        material.clearcoat = 0.0;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'clearcoat')) {
            material.clearcoat = usdMaterial.clearcoat;
        }

        material.clearcoatRoughness = 0.0;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'clearcoatRoughness')) {
            material.clearcoatRoughness = usdMaterial.clearcoatRoughness;
        }

        // Workflow selection
        material.useSpecularWorkflow = false;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'useSpecularWorkflow')) {
            material.useSpecularWorkflow = usdMaterial.useSpecularWorkflow;
        }

        if (material.useSpecularWorkflow) {
            material.specularColor = new THREE.Color(0.0, 0.0, 0.0);
            if (Object.prototype.hasOwnProperty.call(usdMaterial, 'specularColor')) {
                const color = usdMaterial.specularColor;
                material.specularColor = new THREE.Color(color[0], color[1], color[2]);
            }
            if (Object.prototype.hasOwnProperty.call(usdMaterial, 'specularColorTextureId')) {
                pending.push(
                    this.getTextureFromUSD(usdScene, usdMaterial.specularColorTextureId, { colorSpace: THREE.SRGBColorSpace })
                        .then((texture) => { material.specularColorMap = texture; })
                        .catch((err) => {
                            console.error("failed to load specular color texture", err);
                        })
                );
            }
        } else {
            material.metalness = 0.0;
            if (Object.prototype.hasOwnProperty.call(usdMaterial, 'metallic')) {
                material.metalness = usdMaterial.metallic;
            }
            if (Object.prototype.hasOwnProperty.call(usdMaterial, 'metallicTextureId')) {
                pending.push(
                    this.getTextureFromUSD(usdScene, usdMaterial.metallicTextureId)
                        .then((texture) => { material.metalnessMap = texture; })
                        .catch((err) => {
                            console.error("failed to load metallic texture", err);
                        })
                );
            }
        }

        // Roughness
        material.roughness = 0.5;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'roughness')) {
            material.roughness = usdMaterial.roughness;
        }
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'roughnessTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.roughnessTextureId)
                    .then((texture) => { material.roughnessMap = texture; })
                    .catch((err) => {
                        console.error("failed to load roughness texture", err);
                    })
            );
        }

        // Emissive
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'emissiveColor')) {
            const color = usdMaterial.emissiveColor;
            material.emissive = new THREE.Color(color[0], color[1], color[2]);
        }
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'emissiveColorTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.emissiveColorTextureId, { colorSpace: THREE.SRGBColorSpace })
                    .then((texture) => { material.emissiveMap = texture; })
                    .catch((err) => {
                        console.error("failed to load emissive texture", err);
                    })
            );
        }

        // Opacity
        material.opacity = 1.0;
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'opacity')) {
            material.opacity = usdMaterial.opacity;
            if (material.opacity < 1.0) {
                material.transparent = true;
            }
        }
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'opacityTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.opacityTextureId)
                    .then((texture) => {
                        material.alphaMap = texture;
                        material.transparent = true;
                    })
                    .catch((err) => {
                        console.error("failed to load opacity texture", err);
                    })
            );
        }

        // Ambient Occlusion
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'occlusionTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.occlusionTextureId)
                    .then((texture) => { material.aoMap = texture; })
                    .catch((err) => {
                        console.error("failed to load occlusion texture", err);
                    })
            );
        }

        // Normal Map
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'normalTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.normalTextureId)
                    .then((texture) => { material.normalMap = texture; })
                    .catch((err) => {
                        console.error("failed to load normal texture", err);
                    })
            );
        }

        // Displacement Map
        if (Object.prototype.hasOwnProperty.call(usdMaterial, 'displacementTextureId')) {
            pending.push(
                this.getTextureFromUSD(usdScene, usdMaterial.displacementTextureId)
                    .then((texture) => {
                        material.displacementMap = texture;
                        material.displacementScale = 1.0;
                    })
                    .catch((err) => {
                        console.error("failed to load displacement texture", err);
                    })
            );
        }

        await Promise.allSettled(pending);
        material.needsUpdate = true;
        return material;
    }

    static isFaceVaryingAttribute(attribute, itemSize, faceVertexCount) {
        return attribute && attribute.length === faceVertexCount * itemSize;
    }

    static isPointVaryingAttribute(attribute, itemSize, pointCount) {
        return attribute && attribute.length === pointCount * itemSize;
    }

    static expandPointAttribute(attribute, itemSize, indices) {
        const expanded = new attribute.constructor(indices.length * itemSize);
        for (let i = 0; i < indices.length; i++) {
            const sourceOffset = indices[i] * itemSize;
            const targetOffset = i * itemSize;
            for (let component = 0; component < itemSize; component++) {
                expanded[targetOffset + component] = attribute[sourceOffset + component];
            }
        }
        return expanded;
    }

    static convertUsdMeshToThreeMesh(mesh) {
        const geometry = new THREE.BufferGeometry();
        const indices = mesh.faceVertexIndices;
        const pointCount = mesh.points.length / 3;
        const faceVertexCount = indices.length;
        const hasFaceVaryingTexcoords = this.isFaceVaryingAttribute(mesh.texcoords, 2, faceVertexCount);
        const hasFaceVaryingNormals = this.isFaceVaryingAttribute(mesh.normals, 3, faceVertexCount);
        const hasFaceVaryingColors = this.isFaceVaryingAttribute(mesh.vertexColors, 3, faceVertexCount);
        const hasFaceVaryingTangents = this.isFaceVaryingAttribute(mesh.tangents, 3, faceVertexCount);
        const needsExpandedGeometry = hasFaceVaryingTexcoords || hasFaceVaryingNormals || hasFaceVaryingColors || hasFaceVaryingTangents;

        if (needsExpandedGeometry) {
            geometry.setAttribute('position', new THREE.BufferAttribute(this.expandPointAttribute(mesh.points, 3, indices), 3));

            if (hasFaceVaryingTexcoords) {
                geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.texcoords, 2));
            } else if (this.isPointVaryingAttribute(mesh.texcoords, 2, pointCount)) {
                geometry.setAttribute('uv', new THREE.BufferAttribute(this.expandPointAttribute(mesh.texcoords, 2, indices), 2));
            }

            if (hasFaceVaryingNormals) {
                geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
            } else if (this.isPointVaryingAttribute(mesh.normals, 3, pointCount)) {
                geometry.setAttribute('normal', new THREE.BufferAttribute(this.expandPointAttribute(mesh.normals, 3, indices), 3));
            }

            if (hasFaceVaryingColors) {
                geometry.setAttribute('color', new THREE.BufferAttribute(mesh.vertexColors, 3));
            } else if (this.isPointVaryingAttribute(mesh.vertexColors, 3, pointCount)) {
                geometry.setAttribute('color', new THREE.BufferAttribute(this.expandPointAttribute(mesh.vertexColors, 3, indices), 3));
            }

            if (hasFaceVaryingTangents) {
                geometry.setAttribute('tangent', new THREE.BufferAttribute(mesh.tangents, 3));
            } else if (this.isPointVaryingAttribute(mesh.tangents, 3, pointCount)) {
                geometry.setAttribute('tangent', new THREE.BufferAttribute(this.expandPointAttribute(mesh.tangents, 3, indices), 3));
            }
        } else {
            geometry.setAttribute('position', new THREE.BufferAttribute(mesh.points, 3));

            // Assume mesh is triangulated.
            // itemsize = 1 since Index expects IntArray for VertexIndices in Three.js?
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));

            if (this.isPointVaryingAttribute(mesh.texcoords, 2, pointCount)) {
                geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.texcoords, 2));
            }

            // faceVarying normals
            if (this.isPointVaryingAttribute(mesh.normals, 3, pointCount)) {
                geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
            }

            if (this.isPointVaryingAttribute(mesh.vertexColors, 3, pointCount)) {
                geometry.setAttribute('color', new THREE.BufferAttribute(mesh.vertexColors, 3));
            }

            if (this.isPointVaryingAttribute(mesh.tangents, 3, pointCount)) {
                geometry.setAttribute('tangent', new THREE.BufferAttribute(mesh.tangents, 3));
            }
        }

        // TODO: uv1

        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }

        if (geometry.attributes.uv && !geometry.attributes.uv2) {
            geometry.setAttribute('uv2', geometry.attributes.uv.clone());
        }

        // Only compute tangents if we have both UV coordinates and normals
        if (!geometry.attributes.tangent && geometry.index && geometry.attributes.uv && geometry.attributes.normal) {
            // TODO: try MikTSpace tangent algorithm: https://threejs.org/docs/#examples/en/utils/BufferGeometryUtils.computeMikkTSpaceTangents 
            geometry.computeTangents();
        }

        // TODO: vertex opacities(per-vertex alpha)

        // Three.js does not have sideness attribute in Mesh.
        // Store doubleSided param to customData
        if (Object.prototype.hasOwnProperty.call(mesh, 'doubleSided')) {
          geometry.userData['doubleSided'] = mesh.doubleSided;
        }

        return geometry;
    }

    static async setupMesh(mesh /* TinyUSDZLoaderNative::RenderMesh */, defaultMtl, usdScene, options) {

        const geometry = this.convertUsdMeshToThreeMesh(mesh);

        const normalMtl = new THREE.MeshNormalMaterial();

        let mtl = null;

        //console.log("overrideMaterial:", options.overrideMaterial);
        if (options.overrideMaterial) {
            mtl = defaultMtl || normalMtl
        } else {

            // tinyusdz reports materialId === -1 when a mesh has no direct
            // `material:binding` rel — e.g. when the USD original uses parent
            // inheritance via `materialBindingAPI`. In that case, fall back to
            // material 0 if the scene exposes one, so meshes that share the
            // model's only material still pick it up.
            let resolvedMaterialId = mesh.materialId;
            if (resolvedMaterialId < 0 && typeof usdScene.getMaterial === "function") {
                const probe = usdScene.getMaterial(0);
                if (probe && typeof probe === "object") {
                    resolvedMaterialId = 0;
                }
            }

            const usdMaterial = usdScene.getMaterial(resolvedMaterialId);
            //console.log("usdMaterial:", usdMaterial);


            const pbrMaterial = await this.convertUsdMaterialToMeshPhysicalMaterial(usdMaterial, usdScene);
            //console.log("pbrMaterial:", pbrMaterial);


            // Setting envmap is required for PBR materials to work correctly(e.g. clearcoat)
            pbrMaterial.envMap = options.envMap || null;
            pbrMaterial.envMapIntensity = options.envMapIntensity || 1.0;

            //console.log("envmap:", options.envMap);

            // Sideness is determined by the mesh
            if (Object.prototype.hasOwnProperty.call(geometry.userData, 'doubleSided')) {
              if (geometry.userData.doubleSided) {

                usdMaterial.side = THREE.DoubleSide;
                pbrMaterial.side = THREE.DoubleSide;
              }
            }

            mtl = pbrMaterial || defaultMtl || normalMtl;
        }

        const threeMesh = new THREE.Mesh(geometry, mtl);

        return threeMesh;
    }


    // arr = float array with 16 elements(row major order)
    static toMatrix4(a) {
        const m = new THREE.Matrix4();

        m.set(a[0], a[1], a[2], a[3],
            a[4], a[5], a[6], a[7],
            a[8], a[9], a[10], a[11],
            a[12], a[13], a[14], a[15]);

        return m;
    }

    // Supported options
    // 'overrideMaterial' : Override usd material with defaultMtl.

    static async buildThreeNode(usdNode /* TinyUSDZLoader.Node */, defaultMtl = null, usdScene /* TinyUSDZLoader.Scene */ = null, options = {})
   /* => Promise<THREE.Object3D> */ {

        var node = new THREE.Group();

        //console.log("usdNode.nodeType:", usdNode.nodeType, "primName:", usdNode.primName, "absPath:", usdNode.absPath);
        if (usdNode.nodeType == 'xform') {

            // intermediate xform node
            // TODO: create THREE.Group and apply transform.
            node.matrix = this.toMatrix4(usdNode.localMatrix);
            node.matrixAutoUpdate = false;

        } else if (usdNode.nodeType == 'mesh') {

            // contentId is the mesh ID in the USD scene.
            const mesh = usdScene.getMesh(usdNode.contentId);

            const threeMesh = await this.setupMesh(mesh, defaultMtl, usdScene, options);
            node = threeMesh;

        } else {
            // ???

        }

        node.name = usdNode.primName;
        node.userData['primMeta.displayName'] = usdNode.displayName;
        node.userData['primMeta.absPath'] = usdNode.absPath;

        if (Object.prototype.hasOwnProperty.call(usdNode, 'children')) {

            // traverse children
            for (const child of usdNode.children) {
                const childNode = await this.buildThreeNode(child, defaultMtl, usdScene, options);
                node.add(childNode);
            }
        }

        return node;
    }

}

export { TinyUSDZLoaderUtils };

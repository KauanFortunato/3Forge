import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createPwaHeadTags, pwaManifest } from "./scripts/pwa-config.mjs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const appVersion = `v${packageJson.version}`;
const arPreviewAssets = new Map();
const AR_PREVIEW_TTL_MS = 60 * 60 * 1000;

function arPreviewPlugin() {
  return {
    name: "3forge-ar-preview",
    configureServer(server) {
      installArPreviewMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installArPreviewMiddleware(server.middlewares);
    },
  };
}

function installArPreviewMiddleware(middlewares) {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/__3forge_ar_preview/")) {
      next();
      return;
    }

    try {
      pruneExpiredArPreviewAssets();

      if (req.method === "POST" && req.url === "/__3forge_ar_preview/publish") {
        const payload = JSON.parse(await readRequestBody(req));
        const id = createArPreviewId();
        const createdAt = Date.now();
        const expiresAt = createdAt + AR_PREVIEW_TTL_MS;
        const name = sanitizePreviewName(payload.name);
        const glb = parseDataUrl(payload.glb, "model/gltf-binary");
        const usdz = parseDataUrl(payload.usdz, "model/vnd.usdz+zip");

        arPreviewAssets.set(id, { id, name, glb, usdz, createdAt, expiresAt });
        sendJson(res, 200, buildArPreviewResponse(req, id));
        return;
      }

      const metadataMatch = req.url.match(/^\/__3forge_ar_preview\/metadata\/([^/?#]+)/);
      if (req.method === "GET" && metadataMatch) {
        const id = decodeURIComponent(metadataMatch[1]);
        if (!arPreviewAssets.has(id)) {
          sendJson(res, 404, { error: "Preview not found or expired." });
          return;
        }
        sendJson(res, 200, buildArPreviewResponse(req, id));
        return;
      }

      const assetMatch = req.url.match(/^\/__3forge_ar_preview\/assets\/([^/]+)\/model\.(glb|usdz)(?:[?#].*)?$/);
      if (req.method === "GET" && assetMatch) {
        const id = decodeURIComponent(assetMatch[1]);
        const format = assetMatch[2];
        const asset = arPreviewAssets.get(id);
        if (!asset) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Preview not found or expired.");
          return;
        }

        const file = format === "glb" ? asset.glb : asset.usdz;
        res.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-disposition": `inline; filename="${asset.name}.${format}"`,
          "content-length": String(file.length),
          "content-type": format === "glb" ? "model/gltf-binary" : "model/vnd.usdz+zip",
        });
        res.end(file);
        return;
      }

      sendJson(res, 404, { error: "Unknown AR preview endpoint." });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Unable to process AR preview request." });
    }
  });
}

function buildArPreviewResponse(req, id) {
  const asset = arPreviewAssets.get(id);
  const baseUrl = resolvePublicBaseUrl(req);
  const viewerUrls = resolvePublicBaseUrls(req).map((url) => `${url}/ar-preview/${encodeURIComponent(id)}`);
  return {
    id,
    name: asset.name,
    expiresAt: asset.expiresAt,
    viewerUrl: `${baseUrl}/ar-preview/${encodeURIComponent(id)}`,
    viewerUrls,
    glbUrl: `${baseUrl}/__3forge_ar_preview/assets/${encodeURIComponent(id)}/model.glb`,
    usdzUrl: `${baseUrl}/__3forge_ar_preview/assets/${encodeURIComponent(id)}/model.usdz`,
  };
}

function resolvePublicBaseUrl(req) {
  return resolvePublicBaseUrls(req)[0];
}

function resolvePublicBaseUrls(req) {
  const hostHeader = req.headers.host ?? "localhost:5173";
  const [host, port] = hostHeader.split(":");
  const hosts = host === "localhost" || host === "127.0.0.1" || host === "::1"
    ? [...findLanAddresses(), host]
    : [host, ...findLanAddresses()];
  return Array.from(new Set(hosts)).map((publicHost) => `http://${publicHost}${port ? `:${port}` : ""}`);
}

function findLanAddresses() {
  const candidates = [];
  for (const [interfaceName, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        candidates.push({
          address: address.address,
          score: scoreLanAddress(interfaceName, address.address),
        });
      }
    }
  }
  return candidates
    .sort((left, right) => left.score - right.score)
    .map((candidate) => candidate.address);
}

function scoreLanAddress(interfaceName, address) {
  const name = interfaceName.toLowerCase();
  let score = 0;
  if (!address.startsWith("192.168.")) score += 10;
  if (!address.startsWith("10.") && !address.startsWith("192.168.")) score += 10;
  if (/(\.255|\.0)$/.test(address)) score += 20;
  if (/(wsl|hyper-v|vethernet|vmware|virtualbox|vpn|nord|openvpn|tunnel)/.test(name)) score += 50;
  return score;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 300 * 1024 * 1024) {
        reject(new Error("AR preview payload is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseDataUrl(value, expectedMimeType) {
  if (typeof value !== "string") {
    throw new Error("AR preview payload is missing model data.");
  }
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match[1] !== expectedMimeType) {
    throw new Error(`Expected ${expectedMimeType} model data.`);
  }
  return Buffer.from(match[2], "base64");
}

function createArPreviewId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizePreviewName(name) {
  const fallback = "3forge-preview";
  if (typeof name !== "string") {
    return fallback;
  }
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function pruneExpiredArPreviewAssets() {
  const now = Date.now();
  for (const [id, asset] of arPreviewAssets) {
    if (asset.expiresAt <= now) {
      arPreviewAssets.delete(id);
    }
  }
}

function sendJson(res, status, body) {
  const content = JSON.stringify(body);
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(content),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(content);
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    arPreviewPlugin(),
    {
      name: "3forge-pwa-head",
      transformIndexHtml() {
        return createPwaHeadTags();
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: [
        "assets/web/logo-32x32.png",
        "assets/web/logo.png",
        "assets/web/logo.png",
        "assets/ios/icons/ios-icon-180.png",
        "assets/android/icons/android-icon-192.png",
        "assets/android/icons/android-icon-512.png",
      ],
      manifest: pwaManifest,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});

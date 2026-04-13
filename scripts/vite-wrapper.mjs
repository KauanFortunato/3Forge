import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const esbuildBinaryPath = ensureAllowedEsbuildBinary(projectRoot);
const viteBinPath = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const viteArgs = process.argv.slice(2);

const child = spawn(process.execPath, [viteBinPath, ...viteArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ESBUILD_BINARY_PATH: esbuildBinaryPath,
  },
  windowsHide: false,
});

child.on("error", (error) => {
  console.error("[vite-wrapper] Falha ao iniciar o Vite.", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function ensureAllowedEsbuildBinary(root) {
  const sourceBinary = findEsbuildBinary(root);
  const targetDirectory = join(root, ".local-tools");
  const targetBinary = join(targetDirectory, process.platform === "win32" ? "esbuild.exe" : "esbuild");

  mkdirSync(targetDirectory, { recursive: true });

  const shouldCopy = !existsSync(targetBinary)
    || statSync(sourceBinary).mtimeMs > statSync(targetBinary).mtimeMs;

  if (shouldCopy) {
    copyFileSync(sourceBinary, targetBinary);
  }

  return targetBinary;
}

function findEsbuildBinary(root) {
  const esbuildPackagesDir = join(root, "node_modules", "@esbuild");
  const candidateFiles = [];

  for (const entry of readdirSync(esbuildPackagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = process.platform === "win32"
      ? join(esbuildPackagesDir, entry.name, "esbuild.exe")
      : join(esbuildPackagesDir, entry.name, "bin", "esbuild");

    candidateFiles.push(candidate);
  }

  const resolvedBinary = candidateFiles.find((candidate) => existsSync(candidate));
  if (!resolvedBinary) {
    throw new Error(`Nao encontrei o binario do esbuild em ${esbuildPackagesDir}.`);
  }

  return resolvedBinary;
}

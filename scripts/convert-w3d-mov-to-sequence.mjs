#!/usr/bin/env node
/*
 * CLI wrapper around runMovConversion. Used both by humans
 * (`npm run convert:mov -- "<folder>"`) and by the Vite dev plugin
 * indirectly (the plugin calls runMovConversion directly).
 *
 * Exit codes:
 *   0  no .mov to convert OR all converted/skipped successfully
 *   1  partial failure (some converted, some failed)
 *   2  ffmpeg not installed
 */
import process from "node:process";
import { runMovConversion } from "./movConversion.mjs";

function printInstallHint() {
  console.error("");
  console.error("ffmpeg is required to convert .mov assets but was not found on PATH.");
  console.error("Install it:");
  console.error("  Windows : winget install ffmpeg   (or download from https://ffmpeg.org/)");
  console.error("  macOS   : brew install ffmpeg");
  console.error("  Linux   : apt-get install ffmpeg / dnf install ffmpeg");
  console.error("");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const folderPath = positional[0];
  if (!folderPath) {
    console.error('Usage: node scripts/convert-w3d-mov-to-sequence.mjs "<absolute folder path>" [--force]');
    process.exit(2);
  }
  const result = await runMovConversion({
    folderPath,
    force,
    onProgress: ({ index, total, filename }) => {
      console.log(`Converting ${index + 1}/${total}: ${filename}`);
    },
  });
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`warning: ${w}`);
  }
  console.log("");
  console.log(`converted: ${result.converted.length} (${result.converted.join(", ")})`);
  console.log(`skipped:   ${result.skipped.length} (${result.skipped.join(", ")})`);
  console.log(`failed:    ${result.failed.length}`);
  for (const f of result.failed) console.log(`  - ${f.filename}: ${f.error}`);
  const ffmpegMissing = result.failed.some((f) => f.error === "FFMPEG_NOT_INSTALLED");
  if (ffmpegMissing) {
    printInstallHint();
    process.exit(2);
  }
  if (result.failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

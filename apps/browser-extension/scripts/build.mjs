#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const entryPoint = path.resolve(pkgRoot, "src/content/index.ts");
const outdir = path.resolve(pkgRoot, "dist");
const outfile = path.resolve(outdir, "content.bundle.js");

fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: false,
  minify: false,
});

// Copy manifest.dev.json to dist/manifest.json for unpacked extension loading
const manifestSrc = path.resolve(pkgRoot, "manifest.dev.json");
const manifestDest = path.resolve(outdir, "manifest.json");
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
}

console.log("[build] Extension content script bundled successfully to:", outfile);

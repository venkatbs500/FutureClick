#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const outdir = path.resolve(pkgRoot, "dist");

fs.mkdirSync(outdir, { recursive: true });

const sharedBuildOptions = {
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: false,
  minify: false,
};

const fc005Entry = path.resolve(pkgRoot, "src/content/index.ts");
const fc005Outfile = path.resolve(outdir, "content.bundle.js");

await esbuild.build({
  ...sharedBuildOptions,
  entryPoints: [fc005Entry],
  outfile: fc005Outfile,
});

const fc006Entry = path.resolve(pkgRoot, "src/fc006/index.ts");
const fc006Outfile = path.resolve(outdir, "fc006-interception.bundle.js");

await esbuild.build({
  ...sharedBuildOptions,
  entryPoints: [fc006Entry],
  outfile: fc006Outfile,
});

const manifestSrc = path.resolve(pkgRoot, "manifest.dev.json");
const manifestDest = path.resolve(outdir, "manifest.json");
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
}

console.log("[build] FC-005 content script bundled successfully to:", fc005Outfile);
console.log("[build] FC-006 interception bundle successfully to:", fc006Outfile);

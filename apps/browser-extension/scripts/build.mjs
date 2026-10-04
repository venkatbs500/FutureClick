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

const fc007Entry = path.resolve(pkgRoot, "src/fc007/index.ts");
const fc007Outfile = path.resolve(outdir, "fc007-observation.bundle.js");

await esbuild.build({
  ...sharedBuildOptions,
  entryPoints: [fc007Entry],
  outfile: fc007Outfile,
});

console.log("[build] FC-005 content script bundled successfully to:", fc005Outfile);
console.log("[build] FC-006 interception bundle successfully to:", fc006Outfile);
console.log("[build] FC-007 observation bundle successfully to:", fc007Outfile);

// Smoke-only bundle: emitted only when explicitly requested (test harness).
// Never written into normal production packaging by default.
if (process.env.FC007_BUILD_SMOKE === "1") {
  const smokeOutdir = process.env.FC007_SMOKE_OUTDIR
    ? path.resolve(process.env.FC007_SMOKE_OUTDIR)
    : path.join(outdir, "smoke");
  fs.mkdirSync(smokeOutdir, { recursive: true });
  const fc007SmokeEntry = path.resolve(pkgRoot, "src/fc007/smoke-entry.ts");
  const fc007SmokeOutfile = path.resolve(smokeOutdir, "fc007-observation-smoke.bundle.js");
  await esbuild.build({
    ...sharedBuildOptions,
    entryPoints: [fc007SmokeEntry],
    outfile: fc007SmokeOutfile,
  });
  console.log("[build] FC-007 smoke-only observation bundle to:", fc007SmokeOutfile);
}

// Sprint 3B dedicated smoke — isolated release proof; never production bootstrap.
if (process.env.FC007_BUILD_SMOKE_3B === "1") {
  const smokeOutdir = process.env.FC007_SMOKE_OUTDIR
    ? path.resolve(process.env.FC007_SMOKE_OUTDIR)
    : path.join(outdir, "smoke");
  fs.mkdirSync(smokeOutdir, { recursive: true });
  const fc007Smoke3bEntry = path.resolve(pkgRoot, "src/fc007/sprint3b-smoke-entry.ts");
  const fc007Smoke3bOutfile = path.resolve(smokeOutdir, "fc007-sprint3b-smoke.bundle.js");
  await esbuild.build({
    ...sharedBuildOptions,
    entryPoints: [fc007Smoke3bEntry],
    outfile: fc007Smoke3bOutfile,
  });
  console.log("[build] FC-007 Sprint 3B smoke-only bundle to:", fc007Smoke3bOutfile);
}

if (process.env.FC007_BUILD_SMOKE_ACQ === "1") {
  const smokeOutdir = process.env.FC007_SMOKE_OUTDIR
    ? path.resolve(process.env.FC007_SMOKE_OUTDIR)
    : path.join(outdir, "smoke");
  fs.mkdirSync(smokeOutdir, { recursive: true });
  const entry = path.resolve(pkgRoot, "src/fc007/acquisition-smoke-entry.ts");
  const outfile = path.resolve(smokeOutdir, "fc007-acquisition-smoke.bundle.js");
  await esbuild.build({
    ...sharedBuildOptions,
    entryPoints: [entry],
    outfile,
  });
  console.log("[build] FC-007 acquisition smoke bundle to:", outfile);
}

if (
  process.env.FC007_BUILD_SMOKE !== "1" &&
  process.env.FC007_BUILD_SMOKE_3B !== "1" &&
  process.env.FC007_BUILD_SMOKE_ACQ !== "1"
) {
  // Remove any stale smoke artifact from a prior smoke build in dist/.
  for (const staleName of [
    "fc007-observation-smoke.bundle.js",
    "fc007-sprint3b-smoke.bundle.js",
    "fc007-acquisition-smoke.bundle.js",
  ]) {
    const stale = path.join(outdir, staleName);
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true });
    }
  }
  const staleDir = path.join(outdir, "smoke");
  if (fs.existsSync(staleDir)) {
    fs.rmSync(staleDir, { recursive: true, force: true });
  }
}

const manifestSrc = path.resolve(pkgRoot, "manifest.dev.json");
const manifestDest = path.resolve(outdir, "manifest.json");
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
}

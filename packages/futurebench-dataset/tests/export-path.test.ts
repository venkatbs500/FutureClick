/**
 * The official export must write to one canonical repository location.
 *
 * The default output path was previously resolved against the working directory, so
 * running the export from the repository root instead of the package directory wrote the
 * corpus to a sibling of the repository. It failed silently: the frozen-hash assertions
 * run before the write and passed either way, so the only symptom was a trainer reading
 * a stale file while a fresh one sat outside the repo.
 *
 * These tests spawn the real script rather than importing a helper, because the defect
 * was in runtime path resolution. Importing the module would execute it anyway, and a
 * source-level assertion would not have caught the original bug.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/canonical.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_DIR, "../..");
const SCRIPT = resolve(PACKAGE_DIR, "scripts/export-development-corpus.ts");
const CANONICAL_CORPUS = resolve(
  REPOSITORY_ROOT,
  "research/futurebench/data/fc008-development-corpus.json",
);

/** The Sprint-2 frozen export identity. Must not move for a path fix. */
const FROZEN_EXPORT_SHA256 = "e0bd031aa42ba66b82322ec73df2a22eba562007c943fbc98d27af132e7efdbf";
const FROZEN_EXPORT_BYTES = 190069;
const FROZEN_EXPORT_ROWS = 429;

interface ExportSummary {
  outputPath: string;
  bytes: number;
  exportSha256: string;
  rows: number;
}

function runExportFrom(cwd: string): ExportSummary {
  const stdout = execFileSync("npx", ["tsx", SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout) as ExportSummary;
}

describe("development corpus export path", () => {
  it("targets the same canonical file from the repository root and the package directory", () => {
    const fromRoot = runExportFrom(REPOSITORY_ROOT);
    const fromPackage = runExportFrom(PACKAGE_DIR);

    expect(fromRoot.outputPath).toBe(CANONICAL_CORPUS);
    expect(fromPackage.outputPath).toBe(CANONICAL_CORPUS);
    expect(fromRoot.outputPath).toBe(fromPackage.outputPath);
  });

  it("writes inside the repository regardless of where it is invoked", () => {
    // The original bug produced a path that merely looked plausible. Containment is
    // asserted directly so a future refactor cannot reintroduce an outside-the-repo
    // target that happens to end with the right filename.
    const summary = runExportFrom(REPOSITORY_ROOT);
    expect(summary.outputPath.startsWith(`${REPOSITORY_ROOT}/`)).toBe(true);
    expect(summary.outputPath).not.toContain("/../");
  });

  it("leaves the frozen export identity unchanged", () => {
    const summary = runExportFrom(PACKAGE_DIR);
    expect(summary.exportSha256).toBe(FROZEN_EXPORT_SHA256);
    expect(summary.bytes).toBe(FROZEN_EXPORT_BYTES);
    expect(summary.rows).toBe(FROZEN_EXPORT_ROWS);
    expect(sha256Hex(readFileSync(CANONICAL_CORPUS, "utf8"))).toBe(FROZEN_EXPORT_SHA256);
  });

  it("still honours an explicit output path", () => {
    // The anchoring removed the caller's control over the DEFAULT, not the ability to
    // export a scratch copy deliberately.
    const scratch = resolve(REPOSITORY_ROOT, "node_modules/.tmp-fc008-export.json");
    const stdout = execFileSync("npx", ["tsx", SCRIPT, scratch], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const summary = JSON.parse(stdout) as ExportSummary;
    expect(summary.outputPath).toBe(scratch);
    expect(summary.exportSha256).toBe(FROZEN_EXPORT_SHA256);
  });
});

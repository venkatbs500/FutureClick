/**
 * FC-007 Sprint 3C release-capability audit —
 * Production release is expected ONLY through the exact Continue → releaseOnce path.
 * Forbidden: page API, FC-006 reuse, selector recovery, submit/API mutation, generic executor.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../manifest.dev.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "../src/fc007");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(p));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("FC-007 Sprint 3C release capability audit", () => {
  it("release modules exist and production Continue path imports them exactly once", () => {
    const files = listTsFiles(srcRoot).map((f) => path.relative(srcRoot, f));
    expect(files).toContain("verified-decision.ts");
    expect(files).toContain("continue-validator.ts");
    expect(files).toContain("native-click-executor.ts");
    expect(files).toContain("release-attempt.ts");
    expect(files).toContain("release-interceptor.ts");
    expect(files).toContain("passive-controller.ts");
    expect(files).toContain("index.ts");

    const controller = fs.readFileSync(path.join(srcRoot, "passive-controller.ts"), "utf8");
    expect(controller).toMatch(/from\s+["']\.\/release-attempt\.js["']/);
    expect(controller).toMatch(/releaseOnce\s*\(/);
    expect(controller).toMatch(/ACTION_ADMITTED_ONCE/);
    expect(controller).not.toMatch(/CONTINUE_VALIDATED_NO_RELEASE/);
    expect(controller).not.toMatch(/betweenValidationAndReleaseForTest/);
    expect(controller).not.toMatch(/testNativeExecutorForTest/);
    expect(controller).not.toMatch(/from\s+["'].*fc006\//);
    expect(controller).not.toMatch(/form\.submit\s*\(/);
    expect(controller).not.toMatch(/requestSubmit\s*\(/);
    expect(controller).not.toMatch(/\bfetch\s*\(/);
    expect(controller).not.toMatch(/XMLHttpRequest/);
    // Production path uses releaseOnce only — not test arm gap.
    expect(controller).not.toMatch(/armForTest/);
    expect(controller).not.toMatch(/executeArmedForTest/);
    expect(controller).not.toMatch(/HTMLButtonElement\.prototype\.click/);
    expect(controller).not.toMatch(/Reflect\.apply/);
    // L1: inertContinue must not precede validateContinueSameDecision in Continue handler.
    const continueFn = controller.slice(
      controller.indexOf("private handlePreviewContinue"),
      controller.indexOf("private handleCaptureClick"),
    );
    const inertIdx = continueFn.indexOf("inertContinue");
    const validateIdx = continueFn.indexOf("validateContinueSameDecision");
    const releaseIdx = continueFn.indexOf("releaseOnce");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(validateIdx);
    // Only post-failure inertContinue is allowed (after validation fail branch).
    if (inertIdx !== -1) {
      expect(inertIdx).toBeGreaterThan(validateIdx);
    }

    const index = fs.readFileSync(path.join(srcRoot, "index.ts"), "utf8");
    expect(index).toMatch(/bootstrapFc007Observation/);
    expect(index).toMatch(/Fc007IsolatedReleaseComponent/);
    expect(index).toMatch(/native-click-executor/);
    expect(index).toMatch(/releaseComponent:\s*release/);
    // Must NOT export page-usable release APIs.
    expect(index).not.toMatch(/export\s+\{[^}]*releaseOnce/);
    expect(index).not.toMatch(/export\s+\{[^}]*Fc007IsolatedReleaseComponent/);
    expect(index).not.toMatch(/export\s+\{[^}]*invokeCapturedNativeClick/);
    expect(index).not.toMatch(/armForTest/);
    expect(index).not.toMatch(/from\s+["'].*fc006\//);
    // M3: no production global controller/release authority surface.
    expect(index).not.toMatch(/__FC007_CTRL__/);
    expect(index).not.toMatch(/__FC007_SMOKE_CTRL__/);
    expect(index).not.toMatch(/__FC007_CONTROLLER__/);
    expect(index).not.toMatch(/__FC007_RELEASE__/);
    expect(index).not.toMatch(/__FC007_DEBUG__/);
    expect(index).not.toMatch(/__FC007_TEST__/);
    expect(index).not.toMatch(/globalThis\s*\.\s*__FC007_/);
    expect(index).not.toMatch(/globalThis\s*\[\s*["']__FC007_/);
    expect(index).not.toMatch(/FutureClick\s*\.\s*controller/);
    expect(index).not.toMatch(/FutureClick\s*\.\s*release/);
    expect(index).not.toMatch(/invokeTrustedContinueForTest/);
    expect(index).not.toMatch(/getReleaseComponentForTest/);
    expect(index).not.toMatch(/setTestExecutorForTest/);
    expect(index).not.toMatch(/releaseOnce\s*\(/);

    // Preview / validator / interception must not directly invoke release.
    for (const prod of [
      "continue-validator.ts",
      "verified-decision.ts",
      "preview.ts",
      "interception.ts",
    ]) {
      const text = fs.readFileSync(path.join(srcRoot, prod), "utf8");
      expect(text).not.toMatch(/releaseOnce/);
      expect(text).not.toMatch(/Fc007IsolatedReleaseComponent/);
      expect(text).not.toMatch(/invokeCapturedNativeClick/);
      expect(text).not.toMatch(/from\s+["'].*fc006\//);
    }

    const smoke = fs.readFileSync(path.join(srcRoot, "smoke-entry.ts"), "utf8");
    expect(smoke).toMatch(/Fc007IsolatedReleaseComponent/);
    expect(smoke).toMatch(/releaseComponent:\s*release/);
    expect(smoke).not.toMatch(/from\s+["'].*fc006\//);
  });

  it("3B release modules retain native executor + two-lifetime state; no FC-006", () => {
    for (const f of ["native-click-executor.ts", "release-attempt.ts", "release-interceptor.ts"]) {
      expect(fs.existsSync(path.join(srcRoot, f))).toBe(true);
    }
    const attempt = fs.readFileSync(path.join(srcRoot, "release-attempt.ts"), "utf8");
    expect(attempt).toMatch(/dispatchGuardActive/);
    expect(attempt).toMatch(/permission/);
    expect(attempt).toMatch(/releaseGeneration/);
    expect(attempt).toMatch(/DISPATCH_ACTIVE/);
    expect(attempt).toMatch(/releaseOnce/);
    expect(attempt).toMatch(/isTrusted === false/);
    expect(attempt).toMatch(/executorThrew/);
    expect(attempt).toMatch(/uninstallRequested/);
    expect(attempt).not.toMatch(/from\s+["'].*fc006\//);
    expect(attempt).not.toMatch(/seenEvents/);
    expect(attempt).not.toMatch(/WeakSet/);

    const native = fs.readFileSync(path.join(srcRoot, "native-click-executor.ts"), "utf8");
    expect(native).toMatch(/HTMLButtonElement\.prototype\.click/);
    expect(native).toMatch(/Reflect\.apply/);
    expect(native).not.toMatch(/\.requestSubmit\s*\(/);
    expect(native).not.toMatch(/form\.submit\s*\(/);
    expect(native).not.toMatch(/\bfetch\s*\(/);
  });

  it("built production observation bundle includes Continue→releaseOnce only on expected path", () => {
    const bundlePath = path.resolve(__dirname, "../dist/fc007-observation.bundle.js");
    expect(fs.existsSync(bundlePath), "run package build before this gate").toBe(true);
    const bundle = fs.readFileSync(bundlePath, "utf8");
    expect(bundle).toMatch(/Continue/);
    expect(bundle).toMatch(/VALID_SAME_DECISION|SAME_REVIEWED_DECISION/);
    expect(bundle).toMatch(/ACTION_ADMITTED_ONCE/);
    expect(bundle).toMatch(/releaseOnce/);
    expect(bundle).toMatch(/HTMLButtonElement\.prototype\.click/);
    expect(bundle).not.toMatch(/CONTINUE_VALIDATED_NO_RELEASE/);
    expect(bundle).not.toMatch(/betweenValidationAndReleaseForTest/);
    expect(bundle).not.toMatch(/testNativeExecutorForTest/);
    expect(bundle).not.toMatch(/ArmedContinuation/);
    expect(bundle).not.toMatch(/ArmedRelease/);
    expect(bundle).not.toMatch(/continueDecision/);
    expect(bundle).not.toMatch(/requestSubmit/);
    expect(bundle.includes("XMLHttpRequest")).toBe(false);
    expect(bundle).not.toMatch(/\bfetch\s*\(/);
    expect(bundle).not.toMatch(/from\s+["'].*fc006\/native-click/);
    expect(bundle).not.toMatch(/sprint3b-smoke-entry/);
    expect(bundle).not.toMatch(/__FC007_3B_HARNESS__/);
    // Production Continue path must call releaseOnce — not the test arm gap helpers.
    expect(bundle).toMatch(/releaseOnce/);
    const controllerSrc = fs.readFileSync(path.join(srcRoot, "passive-controller.ts"), "utf8");
    expect(controllerSrc).not.toMatch(/armForTest/);
    expect(controllerSrc).not.toMatch(/executeArmedForTest/);
    expect(controllerSrc).not.toMatch(/betweenValidationAndReleaseForTest/);
    expect(controllerSrc).not.toMatch(/testNativeExecutorForTest/);

    // M3: normal production bundle must not assign or name a controller/release global.
    expect(bundle).not.toMatch(/__FC007_CTRL__/);
    expect(bundle).not.toMatch(/__FC007_SMOKE_CTRL__/);
    expect(bundle).not.toMatch(/__FC007_CONTROLLER__/);
    expect(bundle).not.toMatch(/__FC007_RELEASE__/);
    expect(bundle).not.toMatch(/__FC007_DEBUG__/);
    expect(bundle).not.toMatch(/__FC007_TEST__/);
    expect(bundle).not.toMatch(/globalThis\s*\.\s*__FC007_/);
    expect(bundle).not.toMatch(/globalThis\s*\[\s*["']__FC007_/);
    expect(bundle).not.toMatch(/FutureClick\s*\.\s*controller/);
    expect(bundle).not.toMatch(/FutureClick\s*\.\s*release/);
    // Approved Sprint-3B test helper *names* may remain as method strings inside frozen
    // modules. Security condition: no production/global path that reaches them.
    // Reachability is enforced by absence of globals above + Chrome isolated-world probe.
  });

  it("rejects production-global paths to controller/release/test authority", () => {
    const index = fs.readFileSync(path.join(srcRoot, "index.ts"), "utf8");
    const forbiddenGlobalAssignments = [
      /globalThis\s*\.\s*\w*(controller|release|decision|FC007)\w*\s*=/i,
      /(?:window|self)\s*\.\s*\w*(controller|release|FC007)\w*\s*=/i,
      /document\s*\.\s*\w*FC007\w*\s*=/i,
    ];
    for (const re of forbiddenGlobalAssignments) {
      expect(index).not.toMatch(re);
    }
    // Exact allowed consequential release path remains Continue → validator → releaseOnce.
    const controller = fs.readFileSync(path.join(srcRoot, "passive-controller.ts"), "utf8");
    const continueFn = controller.slice(
      controller.indexOf("private handlePreviewContinue"),
      controller.indexOf("private handleCaptureClick"),
    );
    expect(continueFn).toMatch(/validateContinueSameDecision/);
    expect(continueFn).toMatch(/releaseOnce\s*\(/);
    expect(continueFn.indexOf("releaseOnce")).toBeGreaterThan(
      continueFn.indexOf("validateContinueSameDecision"),
    );
  });
});

describe("FC-007 manifest", () => {
  it("preserves FC-005/FC-006 and FC-007 document_start entry (production only)", () => {
    expect(manifest.permissions).toEqual([]);
    expect((manifest as Record<string, unknown>).host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toHaveLength(3);
    const fc007 = manifest.content_scripts[2];
    expect(fc007?.js).toEqual(["fc007-observation.bundle.js"]);
    expect(fc007?.run_at).toBe("document_start");
    expect(fc007?.world).toBe("ISOLATED");
    expect(fc007?.all_frames).toBe(false);
    expect(fc007?.matches).toEqual(["https://github.com/*/*/settings*"]);
  });
});

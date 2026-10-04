/**
 * Dependency and security isolation.
 *
 * These tests inspect the package source and manifest directly, so a future
 * edit that imports a release authority, reaches FC-007, mutates the authoritative
 * ActionGraph, or pulls a research dependency into the runtime fails here rather
 * than at review time.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as actionUnderstanding from "../src/index.js";
import { PROHIBITED_PRIMARY_FEATURE_INPUTS } from "../src/feature-policy.js";
import { isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { collectReachableKeys } from "../src/validation.js";
import { buildObservationInput, buildRuntimeDeps } from "./helpers.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

const sourceFiles = listSourceFiles(sourceRoot);
const sources = sourceFiles.map((path) => ({
  path: path.slice(packageRoot.length),
  text: readFileSync(path, "utf8"),
}));

/**
 * Strips comments and string literals, leaving only executable code.
 *
 * Needed because `feature-policy.ts` legitimately NAMES forbidden inputs as
 * denylist strings, and `support-matrix.ts` names `"document"` as a supported
 * object kind. A quoted name is data; only an unquoted identifier is a usage.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const codeSources = sources.map(({ path, text }) => ({ path, code: codeOnly(text) }));

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Module specifiers imported anywhere in the package source. */
const importSpecifiers = sources.flatMap(({ text }) =>
  [...text.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1] as string),
);

describe("the package source exists and is non-trivial", () => {
  it("found the Sprint 1 modules", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(15);
    expect(sources.some((s) => s.path.endsWith("runtime.ts"))).toBe(true);
    expect(importSpecifiers.length).toBeGreaterThan(0);
  });
});

describe("FC-007 isolation", () => {
  it("imports no FC-007 module", () => {
    for (const specifier of importSpecifiers) {
      expect(specifier, specifier).not.toMatch(/fc007/i);
      expect(specifier, specifier).not.toMatch(/browser-extension/);
    }
  });

  it("imports no release authority", () => {
    // Named explicitly so a rename in FC-007 does not silently defeat the check.
    const forbidden = [
      "release-attempt",
      "release-interceptor",
      "native-click-executor",
      "release-authority",
      "decision-fingerprint",
      "verified-decision",
    ];
    for (const specifier of importSpecifiers) {
      for (const name of forbidden) {
        expect(specifier.includes(name), `${specifier} contains ${name}`).toBe(false);
      }
    }
  });

  it("references no release or execution authority identifier in source", () => {
    const forbiddenIdentifiers = [
      "ReleaseAttempt",
      "ReleaseInterceptor",
      "NativeClickExecutor",
      "Fc007VerifiedDecision",
      "dispatchEvent",
      "requestSubmit",
      "preventDefault",
      "stopPropagation",
    ];
    // Prose in a comment may name FC-007 for contrast; code may not use it.
    for (const { path, code } of codeSources) {
      for (const identifier of forbiddenIdentifiers) {
        expect(code.includes(identifier), `${path} uses ${identifier}`).toBe(false);
      }
    }
  });
});

describe("ActionGraph isolation", () => {
  it("imports no ActionGraph package", () => {
    for (const specifier of importSpecifiers) {
      expect(specifier, specifier).not.toContain("action-graph");
    }
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@futureclick/action-graph");
    expect(manifest.devDependencies ?? {}).not.toHaveProperty("@futureclick/action-graph");
  });

  it("declares no node type, relation, or graph mutation", () => {
    const forbidden = [
      "ActionGraph",
      "addNode",
      "addRelation",
      "upsertNode",
      "NodeType",
      "RelationType",
      "GraphMutation",
    ];
    for (const { path, code } of codeSources) {
      for (const name of forbidden) {
        expect(code.includes(name), `${path} uses ${name}`).toBe(false);
      }
    }
  });

  it("exports nothing that writes to a graph", () => {
    for (const name of Object.keys(actionUnderstanding)) {
      expect(name).not.toMatch(/^(add|insert|upsert|attach|link|persist|commit|write)/i);
    }
  });
});

describe("the package depends only on inert contract packages", () => {
  it("declares exactly the two workspace dependencies", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@futureclick/action-schema",
      "@futureclick/shared",
    ]);
  });

  it("declares no runtime dependency on a research or numeric library", () => {
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const name of Object.keys(all)) {
      for (const forbidden of [
        "numpy",
        "scikit",
        "sklearn",
        "scipy",
        "pandas",
        "torch",
        "tensorflow",
        "onnx",
        "pyodide",
      ]) {
        expect(name.toLowerCase(), name).not.toContain(forbidden);
      }
    }
  });

  it("imports no Node built-in, network, filesystem, or process API in src", () => {
    for (const specifier of importSpecifiers) {
      expect(specifier, specifier).not.toMatch(/^node:/);
      expect(specifier, specifier).not.toMatch(/^(fs|path|http|https|net|child_process|os)$/);
    }
    for (const { path, code } of codeSources) {
      for (const api of [
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "chrome.",
        "browser.",
        "process.env",
        "require(",
        "eval(",
        "new Function",
        "setTimeout",
        "setInterval",
      ]) {
        expect(code.includes(api), `${path} uses ${api}`).toBe(false);
      }
    }
  });

  it("names no DOM or observation API in src", () => {
    // `tsconfig.base.json` sets lib to ES2022, so DOM types are not even
    // nameable here. This asserts the intent as well as the configuration.
    for (const { path, code } of codeSources) {
      for (const api of [
        "document",
        "window",
        "HTMLElement",
        "MutationObserver",
        "IntersectionObserver",
        "querySelector",
        "getBoundingClientRect",
        "shadowRoot",
        "navigator",
      ]) {
        expect(code.includes(api), `${path} uses ${api}`).toBe(false);
      }
    }
  });

  it("confirms the ES2022 library setting that makes DOM types unnameable", () => {
    const base = readFileSync(join(packageRoot, "..", "..", "tsconfig.base.json"), "utf8");
    expect(base).toContain('"lib"');
    expect(base).toMatch(/"lib":\s*\[\s*"ES2022"\s*\]/);
    expect(base).not.toContain('"DOM"');
  });
});

describe("the public surface exposes no capability", () => {
  it("exports no function whose name implies acting on a page", () => {
    for (const name of Object.keys(actionUnderstanding)) {
      expect(name).not.toMatch(/^(click|submit|navigate|release|execute|perform|dispatch|apply)/i);
    }
  });

  it("exports no value that is not a plain contract, policy, or pure function", () => {
    for (const [name, value] of Object.entries(actionUnderstanding)) {
      const kind = typeof value;
      expect(["function", "object", "string", "number", "boolean"], name).toContain(kind);
      if (kind === "object" && value !== null && !(value instanceof RegExp)) {
        expect(Object.isFrozen(value), name).toBe(true);
      }
    }
  });

  it("exports no stateful regular expression", () => {
    // A `g` or `y` flag makes `lastIndex` persist between calls, so a shared
    // validator regex would give different answers for the same input.
    for (const [name, value] of Object.entries(actionUnderstanding)) {
      if (value instanceof RegExp) {
        expect(value.global, name).toBe(false);
        expect(value.sticky, name).toBe(false);
        expect(value.lastIndex, name).toBe(0);
      }
    }
  });

  it("gives every exported validator regex a stable answer across repeated calls", () => {
    for (const [name, value] of Object.entries(actionUnderstanding)) {
      if (value instanceof RegExp) {
        const probe = "make-public";
        const first = value.test(probe);
        for (let i = 0; i < 5; i++) {
          expect(value.test(probe), name).toBe(first);
        }
      }
    }
  });

  it("exposes no prohibited feature-input name on any exported object", () => {
    const reachable = new Set<string>();
    for (const value of Object.values(actionUnderstanding)) {
      if (typeof value === "object" && value !== null) {
        collectReachableKeys(value, reachable);
      }
    }
    const prohibited = PROHIBITED_PRIMARY_FEATURE_INPUTS.filter((name) => reachable.has(name));
    expect(prohibited).toEqual([]);
  });
});

describe("Sprint 1 produces no user-facing prediction and no side effect", () => {
  it("returns a value and performs no observable effect", () => {
    // The default provider cannot score, so the only reachable outcome is an
    // operational failure. Sprint 1 therefore cannot surface a prediction.
    const result = evaluateObservation(buildObservationInput(), {
      ...buildRuntimeDeps(),
      artifact: null,
    });
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
    expect(isHypothesisResult(result)).toBe(false);
  });

  it("never mutates the input it was given", () => {
    const input = buildObservationInput();
    const before = JSON.stringify(input);
    evaluateObservation(input, buildRuntimeDeps());
    expect(JSON.stringify(input)).toBe(before);
  });

  it("ships no persistence, telemetry, or remote inference path", () => {
    for (const name of Object.keys(actionUnderstanding)) {
      expect(name).not.toMatch(/(persist|store|save|load|telemetry|report|upload|remote|fetch)/i);
    }
  });
});

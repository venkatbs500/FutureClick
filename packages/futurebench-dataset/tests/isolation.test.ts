/**
 * Static proofs that the extractor and the feature projector cannot reach oracle
 * information.
 *
 * These read source text rather than calling functions, because the property under
 * test is about REACHABILITY, not behaviour. A runtime test can only show that the
 * label did not leak on the inputs it tried; a source scan shows that there is no
 * path by which it could.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const datasetRoot = join(here, "..");
const understandingSrc = join(datasetRoot, "..", "action-understanding", "src");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Removes comments while preserving string literals.
 *
 * A single-pass state machine rather than a regex: a naive `//.*$` strip would also
 * eat the tail of any string containing `//`, and stripping string literals instead
 * would destroy the import specifiers this scan exists to find.
 */
function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;
  while (i < text.length) {
    const char = text[i] as string;
    const next = text[i + 1];
    if (inString !== null) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Every module specifier imported by a file. */
function importSpecifiers(source: string): string[] {
  const code = withoutComments(source);
  const specifiers: string[] = [];
  const pattern = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let match = pattern.exec(code);
  while (match !== null) {
    specifiers.push((match[1] ?? match[2]) as string);
    match = pattern.exec(code);
  }
  return specifiers;
}

describe("the extractor cannot reach the oracle", () => {
  const extractor = read(join(understandingSrc, "extraction.ts"));
  const projector = read(join(understandingSrc, "projection.ts"));
  const surface = read(join(understandingSrc, "surface.ts"));

  it("imports nothing from the dataset package", () => {
    // The dependency direction is the structural guarantee: the dataset package
    // imports action-understanding, so the reverse import would be a cycle. This
    // asserts the direction holds at the file level rather than only in manifests.
    for (const [name, source] of [
      ["extraction.ts", extractor],
      ["projection.ts", projector],
      ["surface.ts", surface],
    ] as const) {
      for (const specifier of importSpecifiers(source)) {
        expect(specifier, `${name} imports ${specifier}`).not.toContain("futurebench");
        expect(specifier, `${name} imports ${specifier}`).not.toContain("oracle");
        expect(specifier, `${name} imports ${specifier}`).not.toContain("scenario");
      }
    }
  });

  it("names no oracle, ground-truth, or partition identifier anywhere in its code", () => {
    const forbidden = [
      "resolveOracleLabel",
      "OracleResolution",
      "groundTruth",
      "classNumber",
      "supportedTuple",
      "AuthoredIntent",
      "ScenarioSpecification",
      "templateLineageId",
      "applicationFamilyId",
    ];
    for (const [name, source] of [
      ["extraction.ts", extractor],
      ["projection.ts", projector],
    ] as const) {
      const code = withoutComments(source);
      for (const symbol of forbidden) {
        expect(code, `${name} mentions ${symbol}`).not.toContain(symbol);
      }
    }
  });

  it("projects features from a signature that cannot name anything but Layer B", () => {
    // Signature-level isolation: a function can only read what its parameters give
    // it. `projectPrimaryFeatures` receives semantics, a vocabulary, and a policy —
    // none of which contains identity or a label — so there is no oracle data in
    // scope to leak, whatever the body does.
    const code = withoutComments(projector);
    const signature = /export function projectPrimaryFeatures\(([^)]*)\)/.exec(code);
    expect(signature).not.toBeNull();
    const parameters = (signature?.[1] ?? "").replace(/\s+/g, " ");
    expect(parameters).toContain("ObservationSemantics");
    expect(parameters).not.toContain("ActionObservation");
    expect(parameters).not.toContain("BenchmarkMetadata");
    expect(parameters).not.toContain("Oracle");
  });
});

describe("the oracle cannot reach the surface", () => {
  const oracle = read(join(datasetRoot, "src", "oracle.ts"));

  it("resolves from a signature that cannot name the surface", () => {
    // The mirror image of the projector test. The oracle reads the authored intent
    // and nothing else, so it cannot be influenced by rendered page text — which is
    // what makes adversarial on-page content unable to move ground truth.
    const code = withoutComments(oracle);
    const signature = /export function resolveOracleLabel\(([^)]*)\)/.exec(code);
    expect(signature).not.toBeNull();
    const parameters = (signature?.[1] ?? "").replace(/\s+/g, " ");
    expect(parameters).toContain("AuthoredIntent");
    expect(parameters).not.toContain("RawSurface");
    expect(parameters).not.toContain("ObservationSemantics");
    expect(parameters).not.toContain("ActionObservation");
  });

  it("names no surface, token, or feature symbol", () => {
    const code = withoutComments(oracle);
    for (const symbol of [
      "RawSurface",
      "ObservationSemantics",
      "projectPrimaryFeatures",
      "SemanticToken",
      "sanitizeFields",
    ]) {
      expect(code, `oracle.ts mentions ${symbol}`).not.toContain(symbol);
    }
  });
});

describe("browser and release safety", () => {
  /**
   * Sprint 2 uses no browser, and this is the evidence for the zero-submit,
   * zero-navigation, zero-network, zero-release claims.
   *
   * Those properties hold STRUCTURALLY rather than because a test run observed
   * them: there is no capability present to exercise. A test that drove a real
   * Chromium and counted zero navigations would be weaker evidence, since it would
   * only cover the paths it happened to walk.
   */
  const datasetSources = [
    "audit.ts",
    "authoring.ts",
    "canonical.ts",
    "dataset.ts",
    "manifest.ts",
    "oracle.ts",
    "partition.ts",
    "record.ts",
    "scenario.ts",
    "sealed-source.ts",
    "variants.ts",
    "vocabulary.ts",
  ].map((name) => [name, read(join(datasetRoot, "src", name))] as const);

  const runtimeSources = ["extraction.ts", "projection.ts", "surface.ts", "partitions.ts"].map(
    (name) => [name, read(join(understandingSrc, name))] as const,
  );

  it("references no network capability", () => {
    for (const [name, source] of [...datasetSources, ...runtimeSources]) {
      const code = withoutComments(source);
      for (const capability of [
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "navigator.sendBeacon",
        "node:http",
        "node:https",
        "node:net",
        "axios",
      ]) {
        expect(code, `${name} references ${capability}`).not.toContain(capability);
      }
    }
  });

  it("references no navigation, submission, or click capability", () => {
    for (const [name, source] of [...datasetSources, ...runtimeSources]) {
      const code = withoutComments(source);
      for (const capability of [
        ".submit(",
        ".click(",
        "location.href",
        "location.assign",
        "location.replace",
        "window.open",
        "history.pushState",
        "dispatchEvent",
      ]) {
        expect(code, `${name} references ${capability}`).not.toContain(capability);
      }
    }
  });

  it("references no FC-007 release authority", () => {
    for (const [name, source] of [...datasetSources, ...runtimeSources]) {
      const code = withoutComments(source);
      for (const authority of [
        "releaseAttempt",
        "ReleaseAttempt",
        "releaseInterceptor",
        "nativeClickExecutor",
        "VerifiedDecision",
        "fc007",
      ]) {
        expect(code, `${name} references ${authority}`).not.toContain(authority);
      }
    }
  });

  it("reads no file and writes none", () => {
    // The dataset is assembled in memory and returned. Nothing here persists, which
    // is what keeps AI-24 true while a research corpus exists.
    for (const [name, source] of datasetSources) {
      const code = withoutComments(source);
      for (const capability of ["node:fs", "readFileSync", "writeFileSync", "node:child_process"]) {
        expect(code, `${name} references ${capability}`).not.toContain(capability);
      }
    }
  });

  it("uses only the one node builtin it needs", () => {
    // `node:crypto` for SHA-256, and nothing else. A hash is the only thing in this
    // package that cannot be computed from pure TypeScript.
    const builtins = new Set<string>();
    for (const [, source] of datasetSources) {
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith("node:")) {
          builtins.add(specifier);
        }
      }
    }
    expect([...builtins]).toEqual(["node:crypto"]);
  });
});

describe("package dependency allowlists", () => {
  it("declares exactly the four workspace dependencies the dataset package needs", () => {
    const manifest = JSON.parse(read(join(datasetRoot, "package.json"))) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@futureclick/action-schema",
      "@futureclick/action-understanding",
      "@futureclick/privacy",
      "@futureclick/shared",
    ]);
  });

  it("keeps the runtime package free of any dependency on the dataset package", () => {
    const manifest = JSON.parse(
      read(join(datasetRoot, "..", "action-understanding", "package.json")),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(all)).not.toContain("@futureclick/futurebench-dataset");
  });

  it("exports no vocabulary-fitting capability from the browser-bound package", async () => {
    // AI-12: the runtime must not be able to fit anything. The fitter lives in this
    // offline package precisely so that the shipped surface has no such function,
    // and this asserts the shipped surface rather than trusting the file layout.
    const runtime = (await import("@futureclick/action-understanding")) as Record<string, unknown>;
    for (const name of Object.keys(runtime)) {
      expect(name).not.toMatch(/^fit/);
      expect(name).not.toMatch(/^train/);
      expect(name).not.toMatch(/Corpus$/);
    }
  });
});

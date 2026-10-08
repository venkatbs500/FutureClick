/**
 * FC-008 Sprint 4A — the runtime boundary, proven structurally rather than asserted.
 *
 * Sprint 4A needs a module that reads artifact bytes and hashes them. That is a
 * capability this package's whole claim rules out, so it lives in the Node-only
 * `@futureclick/futurebench-dataset` instead, and the separation needs evidence
 * rather than a comment:
 *
 * 1. NO module in `src/` imports a Node builtin — no exclusions, no exceptions —
 *    so a browser bundle importing `@futureclick/action-understanding` can never
 *    pull `node:fs` or `node:crypto` in.
 * 2. Nothing in `src/` so much as names the Node-only loader as an import, so it
 *    is unreachable from the package root rather than merely unexported.
 * 3. Nothing in `src/` imports or shells out to Python, NumPy, scikit-learn, or
 *    any other part of the training stack. The TypeScript inference path is a
 *    port, not a bridge.
 * 4. The manifest declares no dependency through which a model runtime, a native
 *    ML library, or a model download could arrive.
 *
 * The scans below operate on IMPORT AND CALL SYNTAX, never on prose. Several
 * modules legitimately discuss `node:fs` and the Python reference implementation
 * in doc comments — that is the documentation doing its job — so a scan that read
 * comments would either fail on correct code or be silenced into uselessness.
 *
 * The second half proves the behavioural half of the same boundary: the new
 * provider returns scores and nothing else.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Fc008ModelFamily } from "../src/hypothesis.js";
import {
  type ArtifactBundle,
  type FactorizedModelArtifact,
  type JointModelArtifact,
  parseArtifactBundle,
} from "../src/inference/artifact.js";
import { createProviderScoringContext, validateProviderOutcome } from "../src/provider.js";
import { createFrozenArtifactProvider } from "../src/providers/frozen-artifact-provider.js";
import { buildSemantics } from "./helpers.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

/** The module that was moved out of this package, which must stay out of it. */
const RELOCATED_NODE_ONLY_MODULE = join("inference", "artifact-source.ts");

function listTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      found.push(...listTypeScriptFiles(full));
    } else if (name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

const sourceFiles = listTypeScriptFiles(sourceRoot);

/**
 * Removes comments while preserving string literals.
 *
 * A single-pass state machine rather than a regex pair: `//.*$` would eat the
 * tail of any string containing `//`, and stripping string literals instead would
 * destroy the very specifiers these scans look for. Doc-comment prose that
 * contains the word `from` followed by a quoted phrase would otherwise be read as
 * an import clause, which is exactly the false positive this file must avoid.
 */
function withoutComments(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index] as string;
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      out += " ";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      out += character;
      index += 1;
      while (index < text.length) {
        const inner = text[index] as string;
        out += inner;
        index += 1;
        if (inner === "\\") {
          out += text[index] ?? "";
          index += 1;
          continue;
        }
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?<!["'\w])from\s*["']([^"']+)["']/g,
  /(?<!["'\w])import\s*["']([^"']+)["']/g,
  /(?<!["'\w])import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /(?<!["'\w])require\s*\(\s*["']([^"']+)["']\s*\)/g,
]);

/** Every module specifier the file imports, re-exports, or requires. */
function collectSpecifiers(text: string): string[] {
  const code = withoutComments(text);
  const found: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      found.push(match[1] as string);
    }
  }
  return found;
}

interface ScannedSource {
  readonly relativePath: string;
  readonly text: string;
  readonly specifiers: readonly string[];
}

const scanned: readonly ScannedSource[] = sourceFiles.map((path) => {
  const text = readFileSync(path, "utf8");
  return {
    relativePath: relative(sourceRoot, path),
    text,
    specifiers: collectSpecifiers(text),
  };
});

/** Node builtins that would make this package unusable in a browser bundle. */
const FORBIDDEN_SPECIFIERS: readonly string[] = Object.freeze([
  "node:fs",
  "node:fs/promises",
  "node:crypto",
  "node:path",
  "node:url",
  "node:child_process",
  "node:os",
  "fs",
  "path",
  "crypto",
  "child_process",
]);

describe("the scan has something to scan", () => {
  it("walked the real source tree and found the Sprint-4A modules", () => {
    // A walk that silently found nothing would make every assertion below vacuous.
    expect(scanned.length).toBeGreaterThanOrEqual(25);
    const paths = scanned.map((file) => file.relativePath);
    expect(paths).toContain(join("inference", "artifact.ts"));
    expect(paths).toContain(join("inference", "scoring.ts"));
    expect(paths).toContain(join("providers", "frozen-artifact-provider.ts"));
  });

  it("uses no computed specifier, so the collected set is complete", () => {
    for (const file of scanned) {
      const code = withoutComments(file.text);
      expect(code, file.relativePath).not.toMatch(/\bimport\s*\(\s*[^"')]/);
      expect(code, file.relativePath).not.toMatch(/\brequire\s*\(\s*[^"')]/);
      expect(code, file.relativePath).not.toMatch(/\bcreateRequire\b/);
    }
  });
});

describe("the package root does not reach the Node-only loader", () => {
  it("re-exports the pure inference modules and no byte-reading loader", () => {
    const index = scanned.find((file) => file.relativePath === "index.ts");
    if (index === undefined) {
      throw new Error("src/index.ts was not found by the source walk");
    }
    // Checked against the collected specifiers rather than the raw text, so a
    // comment explaining where the loader went cannot fail this.
    for (const specifier of index.specifiers) {
      expect(specifier, `index.ts re-exports ${specifier}`).not.toContain("artifact-source");
    }
    expect(index.specifiers).toContain("./inference/artifact.js");
    expect(index.specifiers).toContain("./inference/scoring.js");
    expect(index.specifiers).toContain("./providers/frozen-artifact-provider.js");
  });

  it("names the Node-only loader nowhere in src", () => {
    // Reachability, not mention: no module may import it, so the only way into it
    // is a deliberate import from Node-only code in `futurebench-dataset`.
    for (const file of scanned) {
      for (const specifier of file.specifiers) {
        expect(specifier, file.relativePath).not.toContain("artifact-source");
      }
    }
  });
});

describe("no module in src imports a Node builtin", () => {
  it("finds no Node builtin import anywhere in src, with no file excluded", () => {
    for (const file of scanned) {
      for (const specifier of file.specifiers) {
        expect(FORBIDDEN_SPECIFIERS, `${file.relativePath} imports ${specifier}`).not.toContain(
          specifier,
        );
        expect(specifier.startsWith("node:"), `${file.relativePath} imports ${specifier}`).toBe(
          false,
        );
      }
    }
  });

  it("counts zero offenders across the whole tree, and no longer holds the loader", () => {
    // Stated as a count rather than only as a per-file loop, so the scan cannot
    // pass by having walked nothing. There is no exemption list to consult: the
    // byte-reading loader moved to `@futureclick/futurebench-dataset`, so the
    // honest assertion is that this package's `src/` has no Node import at all.
    const offenders = scanned
      .filter((file) => file.specifiers.some((specifier) => specifier.startsWith("node:")))
      .map((file) => file.relativePath);
    expect(offenders).toEqual([]);
    expect(scanned.map((file) => file.relativePath)).not.toContain(RELOCATED_NODE_ONLY_MODULE);
  });

  it("keeps the pure inference and provider modules free of any Node import", () => {
    const pure = [
      join("inference", "artifact.ts"),
      join("inference", "scoring.ts"),
      join("providers", "frozen-artifact-provider.ts"),
    ];
    for (const relativePath of pure) {
      const file = scanned.find((candidate) => candidate.relativePath === relativePath);
      if (file === undefined) {
        throw new Error(`${relativePath} was not found by the source walk`);
      }
      expect(file.specifiers.length, relativePath).toBeGreaterThan(0);
      for (const specifier of file.specifiers) {
        expect(specifier.startsWith("node:"), `${relativePath} imports ${specifier}`).toBe(false);
        expect(FORBIDDEN_SPECIFIERS, `${relativePath} imports ${specifier}`).not.toContain(
          specifier,
        );
      }
    }
  });
});

describe("the TypeScript inference path is a port, not a bridge to Python", () => {
  /** Names from the training stack. Matched against syntax only, never prose. */
  const TRAINING_STACK_TOKENS: readonly string[] = Object.freeze([
    "python",
    "numpy",
    "scikit",
    "sklearn",
    "scipy",
    "joblib",
    "threadpoolctl",
    "child_process",
  ]);

  it("imports no module whose specifier names the training stack", () => {
    for (const file of scanned) {
      for (const specifier of file.specifiers) {
        const lowered = specifier.toLowerCase();
        for (const token of TRAINING_STACK_TOKENS) {
          expect(lowered, `${file.relativePath} imports ${specifier}`).not.toContain(token);
        }
      }
    }
  });

  it("invokes no subprocess, so no interpreter can be started", () => {
    // Scoped to call syntax. `invariants.ts` and several doc comments discuss the
    // Python reference implementation deliberately, and that prose is expected and
    // allowed; only an executable call expression would be a capability.
    //
    // The leading lookbehind excludes property access, because `regex.exec(text)`
    // is `RegExp.prototype.exec` and carries no capability at all. Dotted access
    // to a real subprocess API is not left unguarded: the binding would have to be
    // imported, and the specifier scans above reject `node:child_process` under
    // every import form, including a namespace import.
    for (const file of scanned) {
      const code = withoutComments(file.text);
      for (const pattern of [
        /(?<![\w$.])spawn(?:Sync)?\s*\(/,
        /(?<![\w$.])exec(?:Sync|File|FileSync)?\s*\(/,
        /(?<![\w$.])fork\s*\(/,
        /\bprocess\s*\.\s*binding\b/,
      ]) {
        expect(code, `${file.relativePath} matches ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });
});

describe("the manifest admits nothing through which a model runtime could arrive", () => {
  interface PackageManifest {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
  }

  function readManifest(path: string): PackageManifest {
    return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
  }

  const manifest = readManifest(join(packageRoot, "package.json"));

  it("declares only @futureclick workspace packages as runtime dependencies", () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    expect(dependencies.length).toBeGreaterThan(0);
    for (const name of dependencies) {
      expect(name.startsWith("@futureclick/"), name).toBe(true);
    }
    for (const specifier of Object.values(manifest.dependencies ?? {})) {
      expect(specifier).toBe("workspace:*");
    }
  });

  it("declares no Python bridge, native ML library, or model download", () => {
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ].join(" ");
    for (const forbidden of [
      "python",
      "pyodide",
      "pyright-python",
      "numpy",
      "scikit",
      "sklearn",
      "scipy",
      "onnx",
      "tensorflow",
      "tfjs",
      "torch",
      "transformers",
      "huggingface",
      "node-gyp",
      "node-addon-api",
      "axios",
      "node-fetch",
      "undici",
      "got",
    ]) {
      expect(declared).not.toContain(forbidden);
    }
  });

  it("lets the extension import the browser-safe package but not the Node loader", () => {
    // Sprint 5B wires the headless runtime into the extension. The dependency
    // must be this package (no node:fs) and must not pull the dataset loader.
    const extension = readManifest(
      join(packageRoot, "..", "..", "apps", "browser-extension", "package.json"),
    );
    const dependencies = Object.keys(extension.dependencies ?? {});
    expect(dependencies).toContain("@futureclick/action-understanding");
    expect(dependencies).not.toContain("@futureclick/futurebench-dataset");
  });

  it("resolved the extension manifest from inside the repository", () => {
    // Guards the path arithmetic above: a typo would make `readManifest` throw,
    // but a path that resolved to some other package would silently pass.
    const extensionPath = join(
      packageRoot,
      "..",
      "..",
      "apps",
      "browser-extension",
      "package.json",
    );
    const parsed = JSON.parse(readFileSync(extensionPath, "utf8")) as { name?: string };
    expect(parsed.name).toBe("@futureclick/browser-extension");
    expect(extensionPath.split(sep)).toContain("browser-extension");
  });
});

// ============================================================================
// THE PROVIDER CONTRACT: SCORES ONLY
// ============================================================================

/**
 * Reads and hash-verifies one family's artifacts, locally.
 *
 * The Node loader lives in `@futureclick/futurebench-dataset`, which depends on
 * THIS package; importing it here would invert that and create a workspace
 * cycle. So the few lines of reading and hashing are repeated here instead,
 * feeding the same `parseArtifactBundle` the real loader feeds. A test file may
 * use `node:fs` and `node:crypto` freely — the scans above cover `src/` only,
 * which is exactly the boundary this file exists to prove.
 */
const ARTIFACT_DIRECTORY = join(packageRoot, "..", "..", "research", "futurebench", "artifacts");

const BUNDLE_FILE_NAMES = Object.freeze({
  "joint-logistic": Object.freeze({
    model: "fc008-joint-logistic-model.json",
    calibration: "fc008-joint-logistic-calibration.json",
    policy: "fc008-joint-logistic-policy.json",
  }),
  "factorized-logistic": Object.freeze({
    model: "fc008-factorized-logistic-model.json",
    calibration: "fc008-factorized-logistic-calibration.json",
    policy: "fc008-factorized-logistic-policy.json",
  }),
});

function readHashedArtifact(fileName: string): { sha256: string; value: unknown } {
  const bytes = readFileSync(join(ARTIFACT_DIRECTORY, fileName));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8")) as unknown,
  };
}

function loadBundle(modelFamily: Fc008ModelFamily): ArtifactBundle {
  const names = BUNDLE_FILE_NAMES[modelFamily];
  const model = readHashedArtifact(names.model);
  const calibration = readHashedArtifact(names.calibration);
  const policy = readHashedArtifact(names.policy);
  return parseArtifactBundle({
    modelFamily,
    model: model.value,
    calibration: calibration.value,
    policy: policy.value,
    modelSha256: model.sha256,
    calibrationSha256: calibration.sha256,
    policySha256: policy.sha256,
  });
}

const frozen = Object.freeze({
  joint: loadBundle("joint-logistic") as ArtifactBundle<JointModelArtifact>,
  factorized: loadBundle("factorized-logistic") as ArtifactBundle<FactorizedModelArtifact>,
});

/** Every key appearing anywhere in a value, at any depth. */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, into);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
}

/**
 * Fields through which a provider could assert authority it does not have.
 *
 * A hypothesis or an evidence mode would be an epistemic claim; an acceptance
 * flag, a policy, or a threshold would be a runtime decision; a calibrated
 * confidence or a probability vector would mean the provider had applied the
 * temperature the runtime owns; a support record would be input-support evidence
 * the provider is structurally unable to assess.
 */
const RUNTIME_ONLY_KEYS: readonly string[] = Object.freeze([
  "hypothesis",
  "evidenceMode",
  "accepted",
  "policy",
  "calibratedConfidence",
  "threshold",
  "support",
  "probabilities",
]);

describe("the frozen-artifact provider returns scores and nothing else", () => {
  it("produces an outcome that validates at the provider boundary", () => {
    const provider = createFrozenArtifactProvider({ bundle: frozen.joint });
    const outcome = provider.score(buildSemantics(), createProviderScoringContext());
    expect(outcome.status).toBe("scored");

    const validated = validateProviderOutcome(outcome);
    expect(
      validated.valid ? [] : validated.issues,
      "closed-shape validation of the provider outcome",
    ).toEqual([]);
    expect(validated.valid).toBe(true);
  });

  it("carries no runtime-only field at any depth", () => {
    for (const bundle of [frozen.joint, frozen.factorized]) {
      const provider = createFrozenArtifactProvider({ bundle });
      const outcome = provider.score(buildSemantics(), createProviderScoringContext());
      const keys = new Set<string>();
      collectKeys(outcome, keys);
      expect(keys.size).toBeGreaterThan(0);
      for (const forbidden of RUNTIME_ONLY_KEYS) {
        expect([...keys], `${bundle.modelFamily} outcome keys`).not.toContain(forbidden);
      }
    }
  });

  it("returns 13 tuple logits for the joint family", () => {
    const provider = createFrozenArtifactProvider({ bundle: frozen.joint });
    const outcome = provider.score(buildSemantics(), createProviderScoringContext());
    if (outcome.status !== "scored") {
      throw new Error(`expected a scored outcome, received ${outcome.status}`);
    }
    const scores = outcome.scores.scores;
    if (scores.family !== "joint-logistic") {
      throw new Error(`expected the joint family, received ${scores.family}`);
    }
    expect(scores.tupleLogits).toHaveLength(13);
    for (const logit of scores.tupleLogits) {
      expect(Number.isFinite(logit)).toBe(true);
    }
  });

  it("returns 10/9/10 uncomposed heads for the factorized family", () => {
    // Uncomposed on purpose. Composition restricts the 900 verb x object x
    // property combinations to the 13 supported tuples, and that restriction is a
    // runtime-side decision informed by the support matrix.
    const provider = createFrozenArtifactProvider({ bundle: frozen.factorized });
    const outcome = provider.score(buildSemantics(), createProviderScoringContext());
    if (outcome.status !== "scored") {
      throw new Error(`expected a scored outcome, received ${outcome.status}`);
    }
    const scores = outcome.scores.scores;
    if (scores.family !== "factorized-logistic") {
      throw new Error(`expected the factorized family, received ${scores.family}`);
    }
    expect(scores.verbLogits).toHaveLength(10);
    expect(scores.objectLogits).toHaveLength(9);
    expect(scores.transitionLogits).toHaveLength(10);
    expect(Object.keys(scores).sort()).toEqual([
      "family",
      "objectLogits",
      "transitionLogits",
      "verbLogits",
    ]);
  });
});

describe("the scoring context gives a provider nothing to act on", () => {
  it("carries versions only, with no threshold and no timeout", () => {
    // Structural rather than conventional: there is no field to read, so no
    // provider body change could start applying a threshold or extending a
    // deadline.
    const context = createProviderScoringContext();
    const keys = Object.keys(context).sort();
    expect(keys).toEqual(["featurePolicyVersion", "supportMatrixVersion"]);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("threshold");
      expect(key.toLowerCase()).not.toContain("timeout");
      expect(key.toLowerCase()).not.toContain("deadline");
    }
  });

  it("matches the identity the frozen artifacts were fitted under", () => {
    const context = createProviderScoringContext();
    expect(context.supportMatrixVersion).toBe(frozen.joint.model.identity.supportMatrixVersion);
    expect(context.featurePolicyVersion).toBe(frozen.joint.model.identity.featurePolicyVersion);
  });
});

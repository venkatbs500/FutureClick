/**
 * Isolation evidence beyond source-string scanning (AI-9, AI-10, AI-11, AI-12,
 * AI-17, AI-18, AI-24).
 *
 * A source scan alone is weak evidence: it can be defeated by an alias, a
 * computed specifier, or a dependency that arrives transitively. The checks here
 * are layered instead, and each layer is independent of the others:
 *
 * 1. CLOSED MANIFEST ALLOWLIST   every declared dependency is named explicitly.
 * 2. CLOSED IMPORT ALLOWLIST     every import specifier in src is named.
 * 3. CLOSED EXPORT ALLOWLIST     every public export name is named.
 * 4. BUILT-PACKAGE INSPECTION    the emitted JavaScript is checked, not the TS.
 * 5. TYPE-LEVEL NEGATIVES        forbidden shapes are compile errors.
 * 6. RUNTIME NEGATIVE CAPABILITY the shipped objects cannot act.
 *
 * Adding a dependency, an import, or an export is therefore a deliberate edit to
 * an allowlist rather than something that can slip in unnoticed.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as actionUnderstanding from "../src/index.js";
import { createEphemeralDisplayContext } from "../src/display.js";
import type { ActionObservation, ObservationSemantics } from "../src/observation.js";
import { createNullScoringProvider } from "../src/providers/null-provider.js";
import type { ProviderOutcome, ProviderScoringContext, ScoringProvider } from "../src/provider.js";
import { evaluateObservation } from "../src/runtime.js";
import type { UnderstandingRuntimeDeps } from "../src/runtime.js";
import { isFailedResult, isHypothesisResult } from "../src/result.js";
import { buildObservationInput, buildRuntimeDeps, buildSemantics } from "./helpers.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

function listFiles(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listFiles(full, extension));
    } else if (name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

// ============================================================================
// 1. CLOSED MANIFEST ALLOWLIST
// ============================================================================

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** Every runtime dependency FC-008 Sprint 1 is permitted to declare. */
const ALLOWED_RUNTIME_DEPENDENCIES = [
  "@futureclick/action-schema",
  // Sprint 2. The privacy package is the sole sanitization authority and is itself
  // inert: pure functions over strings, no capability, no network, no DOM.
  "@futureclick/privacy",
  "@futureclick/shared",
];

/** Every development dependency, which ships in no bundle. */
const ALLOWED_DEV_DEPENDENCIES = ["@biomejs/biome", "typescript", "vitest"];

describe("the manifest declares a closed set of dependencies", () => {
  it("declares exactly the allowed runtime dependencies", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...ALLOWED_RUNTIME_DEPENDENCIES].sort(),
    );
  });

  it("declares exactly the allowed development dependencies", () => {
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(
      [...ALLOWED_DEV_DEPENDENCIES].sort(),
    );
  });

  it("declares no peer or optional dependency through which anything could arrive", () => {
    expect(manifest.peerDependencies ?? {}).toEqual({});
    expect(manifest.optionalDependencies ?? {}).toEqual({});
  });

  it("names no FC-007, browser-extension, graph, numeric, or network package", () => {
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ].join(" ");
    for (const forbidden of [
      "fc007",
      "fc-007",
      "browser-extension",
      "action-graph",
      "puppeteer",
      "playwright",
      "jsdom",
      "happy-dom",
      "axios",
      "node-fetch",
      "undici",
      "onnx",
      "tensorflow",
      "torch",
      "sklearn",
      "numpy",
      "webextension",
    ]) {
      expect(declared).not.toContain(forbidden);
    }
  });
});

// ============================================================================
// 2. CLOSED IMPORT ALLOWLIST
// ============================================================================

const sourceFiles = listFiles(sourceRoot, ".ts");

/**
 * Collects import and export specifiers, including side-effect imports, bare
 * re-exports, and dynamic `import()` calls, so an alias cannot hide one.
 *
 * The leading lookbehind matters: without it, a quoted occurrence of the word
 * `from` inside a string literal (as in `fields.get("from")`) is mistaken for
 * an import clause and the scan reports nonsense specifiers.
 */
/**
 * Removes comments while preserving string literals.
 *
 * A single-pass state machine rather than a regex: a naive `//.*$` strip would
 * also eat the tail of any string containing `//`, and stripping string literals
 * (as `codeOnly` does) would destroy the specifiers this scan is looking for.
 * Needed because prose in a doc comment can legitimately contain the word `from`
 * followed by a quoted phrase, which the specifier patterns would otherwise read
 * as an import.
 */
function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        const inner = text[i] as string;
        out += inner;
        i += 1;
        if (inner === "\\") {
          out += text[i] ?? "";
          i += 1;
          continue;
        }
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function collectSpecifiers(text: string): string[] {
  const patterns = [
    /(?<!["'\w])from\s*["']([^"']+)["']/g,
    /(?<!["'\w])import\s*["']([^"']+)["']/g,
    /(?<!["'\w])import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?<!["'\w])require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const scanned = withoutComments(text);
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of scanned.matchAll(pattern)) {
      found.push(match[1] as string);
    }
  }
  return found;
}

/**
 * Strips comments and string literals, leaving executable code.
 *
 * Required for the emitted-code scan because `feature-policy.ts` legitimately
 * NAMES forbidden inputs such as `localStorage` as denylist strings. A quoted
 * name is data; only an unquoted identifier is a usage.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** Splits an identifier into lowercase word segments. */
function wordSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

const sourceSpecifiers = [
  ...new Set(sourceFiles.flatMap((path) => collectSpecifiers(readFileSync(path, "utf8")))),
].sort();

describe("src imports only relative modules and the inert contract packages", () => {
  it("found specifiers to inspect", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(15);
    expect(sourceSpecifiers.length).toBeGreaterThan(0);
  });

  it("states how many contract packages the allowlist actually permits", () => {
    // The title used to say "two", which was true until Sprint 2 added the privacy
    // package. Asserting the size here means the count cannot silently drift again,
    // and the title no longer carries a number that has to be maintained by hand.
    expect(ALLOWED_RUNTIME_DEPENDENCIES).toHaveLength(3);
  });

  it("resolves every specifier to a relative module or an allowed package", () => {
    const unexpected = sourceSpecifiers.filter(
      (specifier) =>
        !specifier.startsWith("./") &&
        !specifier.startsWith("../") &&
        !ALLOWED_RUNTIME_DEPENDENCIES.includes(specifier),
    );
    expect(unexpected).toEqual([]);
  });

  it("imports no node: builtin, bare builtin, or absolute path anywhere in src", () => {
    for (const specifier of sourceSpecifiers) {
      expect(specifier.startsWith("node:")).toBe(false);
      expect(specifier.startsWith("/")).toBe(false);
      expect([
        "fs",
        "path",
        "os",
        "http",
        "https",
        "net",
        "child_process",
        "worker_threads",
      ]).not.toContain(specifier);
    }
  });

  it("uses no computed or dynamic specifier, so the set above is complete", () => {
    for (const path of sourceFiles) {
      const text = readFileSync(path, "utf8");
      // A dynamic import with anything other than a literal would evade the scan.
      expect(text).not.toMatch(/\bimport\s*\(\s*[^"')]/);
      expect(text).not.toMatch(/\brequire\s*\(\s*[^"')]/);
      expect(text).not.toMatch(/\bcreateRequire\b/);
      expect(text).not.toMatch(/\bimport\s*\.\s*meta\s*\.\s*resolve\b/);
    }
  });
});

// ============================================================================
// 3. CLOSED EXPORT ALLOWLIST
// ============================================================================

/**
 * Every name the package exposes. A new export must be added here deliberately,
 * which is the point: the public surface cannot grow by accident.
 */
const ALLOWED_EXPORTS = [
  "ACTION_HYPOTHESIS_SCHEMA_VERSION",
  "ACTION_OBSERVATION_SCHEMA_VERSION",
  "ALLOWED_PRIMARY_FEATURE_FAMILIES",
  "ARTIFACT_IDENTITY_FIELDS",
  "ARTIFACT_LOAD_REFUSALS",
  "ArtifactLoadError",
  "CALIBRATION_METHOD",
  "CHANNEL_FILL_ORDER",
  "CONTROL_KINDS",
  "CONTROL_ROLES",
  "DISPLAY_RETENTION_POLICY",
  "EPISTEMIC_ABSTENTION_REASONS",
  "EXTRACTION_REFUSALS",
  "FAILURE_REASONS",
  "FAILURE_STAGES",
  "FC008_ARTIFACT_SCHEMA_VERSION",
  "FC008_BOUNDS_VERSION",
  "FC008_DATASET_PARTITIONS",
  "FC008_EVIDENCE_MODE",
  "FC008_EXTRACTOR_ID",
  "FC008_EXTRACTOR_VERSION",
  "FC008_FEATURE_POLICY",
  "FC008_FEATURE_POLICY_VERSION",
  "FC008_FINGERPRINT_VERSION",
  "FC008_FITTABLE_PARTITION",
  "FC008_FROZEN_CLASS_ORDER",
  "FC008_FROZEN_FEATURE_COUNT",
  "FC008_ID_REGEX",
  "FC008_INVARIANTS",
  "FC008_INVARIANT_COUNT",
  "FC008_LEAST_SPECIFIC_CLASS_INDEX",
  "FC008_LEAST_SPECIFIC_CLASS_NUMBER",
  "FC008_MATRIX_OBJECT_KINDS",
  "FC008_MATRIX_OBJECT_KIND_COUNT",
  "FC008_MATRIX_TRANSITION_PROPERTIES",
  "FC008_MATRIX_TRANSITION_PROPERTY_COUNT",
  "FC008_MATRIX_VERBS",
  "FC008_MATRIX_VERB_COUNT",
  "FC008_MEASURE_THEN_FREEZE_TARGETS",
  "FC008_MODEL_FAMILIES",
  "FC008_PARTITION_RULES",
  "FC008_PRECEDENCE",
  "FC008_PRECEDENCE_STEP_COUNT",
  "FC008_PROJECTOR_ID",
  "FC008_PROJECTOR_VERSION",
  "FC008_SAFETY_CAPS",
  "FC008_SPECIFICITY_ORACLE_EXAMPLE",
  "FC008_SPECIFICITY_ORACLE_RULE",
  "FC008_SPECIFICITY_ORACLE_RULE_VERSION",
  "FC008_SUPPORTED_TUPLE_COUNT",
  "FC008_SUPPORT_MATRIX",
  "FC008_SUPPORT_MATRIX_VERSION",
  "FC008_SUPPORT_OUTCOME_MAPPING",
  "FC008_VALIDATION_CODES",
  "FORM_METHODS",
  "FP_MAX_SEQUENCE_LENGTH",
  "FP_MAX_STRING_UNITS",
  "FRESHNESS_CHECKPOINTS",
  "FROZEN_ARTIFACT_PROVIDER_ID",
  "INFERENCE_REFUSALS",
  "INTERACTION_KINDS",
  "InferenceDeadline",
  "InferenceError",
  "LOCALE_TAG_REGEX",
  "MAX_ABSOLUTE_COEFFICIENT",
  "MAX_ABSOLUTE_LOGIT",
  "MAX_FAILURE_MEASUREMENT",
  "MAX_FRESHNESS_COUNTER",
  "MAX_NORMALIZED_TOKEN_CHARS",
  "MAX_OPAQUE_ID_CHARS",
  "MAX_TOKEN_SEGMENT_CHARS",
  "NORMALIZED_TOKEN_REGEX",
  "NOVELTY_CHECK_CODES",
  "NULL_PROVIDER_DETAIL",
  "NULL_PROVIDER_ID",
  "OBSERVATION_FORBIDDEN_KEYS",
  "OBSERVATION_LAYER_KEYS",
  "OBSERVATION_SEMANTICS_VERSION",
  "OPAQUE_ID_REGEX",
  "OPERATIONAL_FAILURE_CODES",
  "PRE_INFERENCE_MAX_STEP",
  "PROBABILITY_SUM_TOLERANCE",
  "PROHIBITED_PRIMARY_FEATURE_INPUTS",
  "PROVIDER_DIAGNOSTICS",
  "PROVIDER_OUTCOME_STATUSES",
  "RAW_SURFACE_FORBIDDEN_KEYS",
  "REQUIRED_SEMANTIC_FEATURE_GROUPS",
  "REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT",
  "SHA256_HEX_REGEX",
  "STATE_TOKEN_REGEX",
  "SUPPORTED_TRANSITION_PROPERTIES",
  "SUPPORT_CHECK_CODES",
  "SURFACE_KINDS",
  "TOKEN_CHANNELS",
  "UNDERSTANDING_OUTCOMES",
  "applyTemperature",
  "artifactIdentityDivergence",
  "artifactIdentityMatches",
  "assertSharedFeatureOrder",
  "assertUnreachableOutcome",
  "assessSupport",
  "buildObservationFromSurface",
  "captureBoundedArray",
  "classIndexToNumber",
  "classNumberToIndex",
  "collectReachableKeys",
  "composeFactorizedLogits",
  "computeFeatureCoverage",
  "computeObservationInputFingerprint",
  "countBucket",
  "countUnknownCategoricals",
  "createAbstainedResult",
  "createEphemeralDisplayContext",
  "createFailedResult",
  "createFailureDetail",
  "createFrozenArtifactProvider",
  "createHypothesisResult",
  "createNullScoringProvider",
  "createProviderScoringContext",
  "createScriptedClock",
  "densifyFeatures",
  "enumerateCandidateFeatures",
  "evaluateObservation",
  "extractObservationSemantics",
  "factorizedHeadLogits",
  "factorizedRawLogits",
  "findNonInertPath",
  "findSupportMatrixEntry",
  "findUnfrozenPath",
  "firstFailingSupportCheck",
  "freshnessBindingsEqual",
  "getInvariant",
  "getSupportMatrixEntry",
  "getSupportMatrixEntryByClassNumber",
  "hasMinimumSemanticEvidence",
  "inferFactorized",
  "inferJoint",
  "inspectClosedObject",
  "invalid",
  "invariantsWithStatus",
  "isAbstainedResult",
  "isEpistemicAbstentionReason",
  "isFailedResult",
  "isFailureReason",
  "isFailureStage",
  "isHypothesisResult",
  "isOperationalFailureCode",
  "isSupportedTuple",
  "isFittablePartition",
  "isWithinStringCaps",
  "issue",
  "jointRawLogits",
  "nameLikeText",
  "outcomeForSupportCheck",
  "parseArtifactBundle",
  "parseCalibrationArtifact",
  "parseFactorizedModelArtifact",
  "parseJointModelArtifact",
  "parsePolicyArtifact",
  "partitionRule",
  "participatesInSelectiveStatistics",
  "precedenceStepForEpistemicReason",
  "precedenceStepForOperationalCode",
  "predictionDiagnostics",
  "projectPrimaryFeatures",
  "readBoolean",
  "readBoundedInteger",
  "readBoundedNumber",
  "readEnum",
  "readString",
  "representedRequiredGroups",
  "resolveSupportedTuple",
  "safeFormatValue",
  "semanticText",
  "stableSoftmax",
  "stateFeatureName",
  "structuralCountFeatureName",
  "supportedTupleKey",
  "tokenFeatureName",
  "utf8ByteLength",
  "valid",
  "validateAbstentionPolicy",
  "validateActionHypothesis",
  "validateActionObservation",
  "validateFreshnessBinding",
  "validateProviderOutcome",
  "verifyInvariantNumbering",
  "verifyOutcomeMapping",
  "verifyPartitionRules",
  "verifySupportMatrixIntegrity",
  "vocabularyFromModelArtifact",
];

describe("the public surface is a closed allowlist", () => {
  it("exports exactly the allowed names", () => {
    const actual = Object.keys(actionUnderstanding).sort();
    const allowed = [...new Set(ALLOWED_EXPORTS)].sort();
    expect(actual).toEqual(allowed);
  });

  it("exports no name suggesting execution, capture, persistence, or transmission", () => {
    // Compared on whole word segments, not substrings, so `evaluateObservation`
    // is not mistaken for `eval`.
    const forbidden = new Set([
      "execute",
      "exec",
      "eval",
      "click",
      "dispatch",
      "release",
      "intercept",
      "navigate",
      "fetch",
      "send",
      "upload",
      "download",
      "persist",
      "save",
      "store",
      "storage",
      "telemetry",
      "screenshot",
      "capture",
      "train",
      "fit",
    ]);
    /**
     * Named exemptions, each with the reason it is not a capability. Listing
     * them keeps the check strict: a new offending export is a failure unless
     * someone justifies it here.
     */
    const EXEMPT = new Map([
      [
        "captureBoundedArray",
        "reads a bounded array out of untrusted input; it captures no screen, input, or page content",
      ],
    ]);

    for (const name of Object.keys(actionUnderstanding)) {
      if (EXEMPT.has(name)) {
        continue;
      }
      const offending = wordSegments(name).filter((segment) => forbidden.has(segment));
      expect(offending, `${name} must not imply a capability`).toEqual([]);
    }

    // Every exemption must still correspond to a real export, so the list
    // cannot rot into a blanket excuse.
    for (const name of EXEMPT.keys()) {
      expect(Object.keys(actionUnderstanding)).toContain(name);
    }
  });
});

// ============================================================================
// 4. BUILT-PACKAGE INSPECTION
// ============================================================================

/**
 * Builds the package into a temporary directory and inspects the EMITTED
 * JavaScript. This is the artifact a consumer would actually load, so it is
 * stronger evidence than inspecting TypeScript that might have been stripped,
 * aliased, or transformed on the way out.
 */
const buildDir = mkdtempSync(join(tmpdir(), "fc008-build-"));
let emitted: { path: string; text: string }[] = [];
let buildError: string | null = null;

try {
  execFileSync(
    process.execPath,
    [
      join(packageRoot, "node_modules", "typescript", "lib", "tsc.js"),
      "-p",
      join(packageRoot, "tsconfig.build.json"),
      "--outDir",
      buildDir,
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--sourceMap",
      "false",
    ],
    { cwd: packageRoot, stdio: "pipe" },
  );
  emitted = listFiles(buildDir, ".js").map((path) => ({
    path: path.slice(buildDir.length),
    text: readFileSync(path, "utf8"),
  }));
} catch (error) {
  buildError = error instanceof Error ? error.message : String(error);
}

afterAll(() => {
  rmSync(buildDir, { recursive: true, force: true });
});

describe("the built package carries no capability", () => {
  it("built successfully, so the emitted output is real evidence", () => {
    // A skipped build would silently remove this whole layer of evidence.
    expect(buildError).toBeNull();
    expect(emitted.length).toBeGreaterThanOrEqual(15);
    expect(emitted.some((f) => f.path.endsWith("runtime.js"))).toBe(true);
  });

  it("imports only relative modules and the allowed packages", () => {
    for (const file of emitted) {
      for (const specifier of collectSpecifiers(file.text)) {
        const allowed =
          specifier.startsWith("./") ||
          specifier.startsWith("../") ||
          ALLOWED_RUNTIME_DEPENDENCIES.includes(specifier);
        expect(allowed, `${file.path} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("names no network, storage, process, or DOM global in the emitted code", () => {
    for (const file of emitted) {
      const code = codeOnly(file.text);
      for (const forbidden of [
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "navigator",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.",
        "window.",
        "globalThis.process",
        "process.env",
        "child_process",
        "require(",
        "eval(",
        "Function(",
        "chrome.",
        "browser.runtime",
      ]) {
        expect(code, `${file.path} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("contains no http or https URL outside a documentation comment", () => {
    for (const file of emitted) {
      expect(codeOnly(file.text)).not.toMatch(/https?:\/\//);
    }
  });
});

// ============================================================================
// 5. TYPE-LEVEL NEGATIVES
// ============================================================================

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;

// A provider receives inert data and returns inert data. There is no slot for a
// capability on either side, so smuggling one is a compile error, not a runtime
// check that could be forgotten.
type _ProviderTakesSemantics = AssertTrue<
  Parameters<ScoringProvider["score"]>[0] extends ObservationSemantics ? true : false
>;
type _ProviderContextHasNoClock = AssertFalse<HasKey<ProviderScoringContext, "clock">>;
type _ProviderContextHasNoDeadline = AssertFalse<HasKey<ProviderScoringContext, "deadline">>;
type _ProviderOutcomeHasNoExecute = AssertFalse<HasKey<ProviderOutcome, "execute">>;
type _ProviderOutcomeHasNoRelease = AssertFalse<HasKey<ProviderOutcome, "releaseToken">>;

// The runtime's dependency record names no page, element, or release authority.
type _DepsHaveNoDocument = AssertFalse<HasKey<UnderstandingRuntimeDeps, "document">>;
type _DepsHaveNoElement = AssertFalse<HasKey<UnderstandingRuntimeDeps, "element">>;
type _DepsHaveNoReleaser = AssertFalse<HasKey<UnderstandingRuntimeDeps, "releaseInterceptor">>;
type _DepsHaveNoNetwork = AssertFalse<HasKey<UnderstandingRuntimeDeps, "fetch">>;
type _DepsHaveNoStorage = AssertFalse<HasKey<UnderstandingRuntimeDeps, "storage">>;

// The observation is data, not a handle onto a page.
type _ObservationHasNoElement = AssertFalse<HasKey<ActionObservation, "element">>;
type _ObservationHasNoNode = AssertFalse<HasKey<ActionObservation, "node">>;
type _ObservationHasNoEvent = AssertFalse<HasKey<ActionObservation, "event">>;

describe("type-level negatives compile", () => {
  it("records that the forbidden shapes are compile errors, not runtime checks", () => {
    const witness: ObservationSemantics = buildSemantics();
    expect(witness.semanticsVersion).toBe("1.0");
  });
});

// ============================================================================
// 6. RUNTIME NEGATIVE CAPABILITY
// ============================================================================

describe("the shipped objects cannot act, even when asked to", () => {
  it("gives the null provider no method other than scoring", () => {
    const provider = createNullScoringProvider();
    expect(Object.keys(provider).sort()).toEqual(["providerId", "score"]);
    expect(Object.isFrozen(provider)).toBe(true);
  });

  it("hands the provider nothing callable", () => {
    let callable: string[] = [];
    evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: {
          providerId: "capability-prober",
          score(semantics, context): ProviderOutcome {
            const inspect = (value: object) =>
              Object.entries(value)
                .filter(([, v]) => typeof v === "function")
                .map(([k]) => k);
            callable = [...inspect(semantics), ...inspect(context)];
            return { status: "unavailable", detail: "not-implemented" };
          },
        },
      }),
    );
    expect(callable).toEqual([]);
  });

  it("ignores a provider that tries to mutate the semantics it was given", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: {
          providerId: "mutating-provider",
          score(semantics): ProviderOutcome {
            // Frozen input, so this silently fails or throws; either way the
            // provider cannot change what the runtime decides on.
            try {
              (semantics as { controlKind: string }).controlKind = "other";
            } catch {
              /* expected under strict mode on a frozen object */
            }
            return { status: "unavailable", detail: "not-implemented" };
          },
        },
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
    expect(isHypothesisResult(result)).toBe(false);
  });

  it("produces a result that exposes no method at all", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    const walk = (value: unknown, depth = 0): void => {
      if (depth > 6 || value === null || typeof value !== "object") {
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        expect(typeof nested, `${key} must not be callable`).not.toBe("function");
        walk(nested, depth + 1);
      }
    };
    walk(result);
  });

  it("refuses to let the display context reach a log or a serializer", () => {
    const display = createEphemeralDisplayContext({
      objectLabel: "venky/private",
      surfaceTitle: null,
      retentionPolicy: "ephemeral-memory-only",
    });
    expect(display.valid).toBe(true);
    if (!display.valid) {
      return;
    }
    // Serializing it is a TypeError rather than a silent disclosure.
    expect(() => JSON.stringify({ display: display.value })).toThrow(TypeError);
  });
});

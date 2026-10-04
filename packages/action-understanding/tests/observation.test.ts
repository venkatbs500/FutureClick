import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS, isWithinStringCaps, utf8ByteLength } from "../src/bounds.js";
import {
  ACTION_OBSERVATION_SCHEMA_VERSION,
  validateActionObservation,
} from "../src/observation.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import { buildBenchmarkInput, buildObservationInput, buildSemantics } from "./helpers.js";

function expectInvalid(input: unknown): readonly string[] {
  const result = validateActionObservation(input);
  expect(result.valid).toBe(false);
  return result.issues.map((i) => i.code);
}

describe("ActionObservation acceptance", () => {
  it("accepts a well-formed observation", () => {
    const result = validateActionObservation(buildObservationInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.schemaVersion).toBe(ACTION_OBSERVATION_SCHEMA_VERSION);
    expect(result.value.semantics.controlKind).toBe("button");
    expect(result.value.benchmark).toBeNull();
  });

  it("accepts a populated benchmark layer", () => {
    const result = validateActionObservation(
      buildObservationInput({ benchmark: buildBenchmarkInput() }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.benchmark?.applicationFamilyId).toBe("app-family-a");
    expect(result.value.benchmark?.templateLineageId).toBe("lineage-01");
  });

  it("returns a deeply frozen, fully inert observation", () => {
    const result = validateActionObservation(
      buildObservationInput({ benchmark: buildBenchmarkInput() }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(findUnfrozenPath(result.value)).toBeNull();
    expect(findNonInertPath(result.value)).toBeNull();
  });

  it("detaches the validated observation from the mutable input", () => {
    const input = buildObservationInput();
    const result = validateActionObservation(input);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    (input.semantics as Record<string, unknown>).controlKind = "link";
    expect(result.value.semantics.controlKind).toBe("button");
  });
});

describe("ActionObservation closed-shape and hostile-input rejection", () => {
  it("rejects non-plain objects", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(expectInvalid(bad)).toContain("FC008_NOT_PLAIN_OBJECT");
    }
  });

  it("rejects a non-Object prototype (prototype pollution attempt)", () => {
    class Hostile {}
    const hostile = Object.assign(new Hostile(), buildObservationInput());
    expect(expectInvalid(hostile)).toContain("FC008_NOT_PLAIN_OBJECT");
  });

  it("accepts a null-prototype object, matching repository convention", () => {
    const input = Object.assign(Object.create(null), buildObservationInput());
    expect(validateActionObservation(input).valid).toBe(true);
  });

  it("rejects unknown own keys at the root and inside semantics", () => {
    const root = buildObservationInput();
    root.extraneous = "x";
    expect(expectInvalid(root)).toContain("FC008_UNKNOWN_KEY");

    const nested = buildObservationInput();
    (nested.semantics as Record<string, unknown>).hostname = "github.com";
    expect(expectInvalid(nested)).toContain("FC008_UNKNOWN_KEY");
  });

  it("rejects symbol-keyed properties", () => {
    const input = buildObservationInput();
    (input as Record<PropertyKey, unknown>)[Symbol("evil")] = "x";
    expect(expectInvalid(input)).toContain("FC008_SYMBOL_KEY");
  });

  it("rejects accessor properties and never invokes a throwing getter twice", () => {
    let reads = 0;
    const input = buildObservationInput();
    Object.defineProperty(input, "id", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("hostile getter");
      },
    });
    expect(expectInvalid(input)).toContain("FC008_ACCESSOR_PROPERTY");
    expect(reads).toBe(0);
  });

  it("rejects a required key present with value undefined", () => {
    const input = buildObservationInput();
    input.id = undefined;
    expect(expectInvalid(input)).toContain("FC008_UNDEFINED_VALUE");
  });

  it("rejects a missing required key", () => {
    const input = buildObservationInput();
    // biome-ignore lint/performance/noDelete: an absent key is a different input than a present undefined key, and both are tested
    delete input.redaction;
    expect(expectInvalid(input)).toContain("FC008_MISSING_KEY");
  });

  it("rejects a sparse tokens array", () => {
    const input = buildObservationInput();
    const sparse = [{ channel: "ctl", value: "make" }];
    sparse.length = 3;
    (input.semantics as Record<string, unknown>).tokens = sparse;
    expect(expectInvalid(input)).toContain("FC008_SPARSE_ARRAY");
  });

  it("rejects an unsupported schema version", () => {
    const input = buildObservationInput();
    input.schemaVersion = "2.0";
    expect(expectInvalid(input)).toContain("FC008_ENUM_VIOLATION");
  });
});

describe("ActionObservation bounds enforcement", () => {
  it("rejects more than the total token cap", () => {
    const tokens = Array.from({ length: FC008_SAFETY_CAPS.maxTotalTokens + 1 }, (_, i) => ({
      channel: "ctl" as const,
      value: `t${i}`,
    }));
    const input = buildObservationInput({ semantics: { tokens } });
    expect(expectInvalid(input)).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects more than the per-channel token cap", () => {
    const tokens = Array.from({ length: FC008_SAFETY_CAPS.maxTokensPerChannel + 1 }, (_, i) => ({
      channel: "ctl" as const,
      value: `t${i}`,
    }));
    const input = buildObservationInput({ semantics: { tokens } });
    expect(expectInvalid(input)).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects more than the state-token cap", () => {
    const stateTokens = Array.from(
      { length: FC008_SAFETY_CAPS.maxStateTokens + 1 },
      (_, i) => `status:s${i}`,
    );
    const input = buildObservationInput({ semantics: { stateTokens } });
    expect(expectInvalid(input)).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects more than the object-kind evidence cap", () => {
    const input = buildObservationInput({
      semantics: {
        objectKindEvidence: ["file", "folder", "document", "repository", "message"],
      },
    });
    expect(expectInvalid(input)).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects structural counts above their caps", () => {
    const base = buildSemantics();
    const input = buildObservationInput({
      semantics: {
        structuralCounts: {
          ...base.structuralCounts,
          surfaceDepth: FC008_SAFETY_CAPS.maxTraversalDepth + 1,
        },
      },
    });
    expect(expectInvalid(input)).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects a display layer on the observation outright", () => {
    // Layer D is not observation data at all, so a caller offering one is
    // rejected rather than having its label length checked. See display.ts.
    const input = buildObservationInput();
    input.display = {
      objectLabel: "a".repeat(FC008_SAFETY_CAPS.maxLabelChars + 1),
      surfaceTitle: null,
      retentionPolicy: "ephemeral-memory-only",
    };
    expect(expectInvalid(input)).toContain("FC008_UNKNOWN_KEY");
  });

  it("counts UTF-8 bytes rather than code units for the byte cap", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("中")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);

    // 200 three-byte characters occupy 200 code units but 600 bytes, so the byte
    // cap is independently binding rather than redundant with the character cap.
    const cjk = "中".repeat(200);
    expect(cjk.length).toBeLessThanOrEqual(FC008_SAFETY_CAPS.maxLabelChars);
    expect(utf8ByteLength(cjk)).toBeGreaterThan(FC008_SAFETY_CAPS.maxStringUtf8Bytes);
    expect(isWithinStringCaps(cjk)).toBe(false);

    // Astral characters are counted as four bytes, not six.
    expect(utf8ByteLength("😀".repeat(10))).toBe(40);
    expect(isWithinStringCaps("中".repeat(100))).toBe(true);
  });
});

describe("ObservationSemantics token grammar as a privacy control", () => {
  function tokenInput(value: string): Record<string, unknown> {
    return buildObservationInput({
      semantics: {
        tokens: [
          { channel: "ctl", value },
          { channel: "acc", value: "ok" },
        ],
      },
    });
  }

  it("rejects structured leakage by grammar: URLs, paths, emails, selectors, XPath, case, whitespace", () => {
    const structured = [
      "github.com",
      "https://github.com/venky/secret",
      "/users/venky/private.txt",
      "venky@example.com",
      "div#main > button.danger",
      "//button[@id='x']",
      "Make This Public",
      "secret project",
      "token=abc123",
      "../../etc/passwd",
      "C:\\Users\\venky",
      "#shadow-root",
    ];
    for (const token of structured) {
      expect(expectInvalid(tokenInput(token))).toContain("FC008_PATTERN_VIOLATION");
    }
  });

  it("rejects long opaque alphanumeric runs by word-shape cap", () => {
    // These satisfy the character grammar, so the segment cap is what stops them.
    const opaque = [
      "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "0123456789012345678901234567890123456789",
      "eyjhbgcioijiuzi1niisinr5cci6ikpxvcj9",
    ];
    for (const token of opaque) {
      expect(expectInvalid(tokenInput(token))).toContain("FC008_BOUND_EXCEEDED");
    }
  });

  it("still accepts realistic word-shaped UI tokens", () => {
    for (const token of ["public", "make-public", "change-visibility", "danger-zone", "repo2"]) {
      expect(validateActionObservation(tokenInput(token)).valid).toBe(true);
    }
  });

  it("documents that high-entropy secret detection belongs to the Sprint 2 sanitizer", () => {
    // A short lowercase run is indistinguishable from a word by shape alone and
    // is therefore accepted here. Credential and high-entropy detection is the
    // exclusive responsibility of the sanitizer, which runs BEFORE these
    // semantics are constructed. The grammar is defence in depth, not the
    // primary secret control.
    expect(validateActionObservation(tokenInput("a1b2c3")).valid).toBe(true);
  });

  it("rejects duplicate tokens within a channel but allows the same token across channels", () => {
    const duplicate = buildObservationInput({
      semantics: {
        tokens: [
          { channel: "ctl", value: "public" },
          { channel: "ctl", value: "public" },
          { channel: "acc", value: "ok" },
        ],
      },
    });
    expect(expectInvalid(duplicate)).toContain("FC008_DUPLICATE_VALUE");

    const crossChannel = buildObservationInput({
      semantics: {
        tokens: [
          { channel: "ctl", value: "public" },
          { channel: "nb", value: "public" },
          { channel: "acc", value: "ok" },
        ],
      },
    });
    expect(validateActionObservation(crossChannel).valid).toBe(true);
  });

  it("rejects an unknown token channel", () => {
    const input = buildObservationInput();
    (input.semantics as Record<string, unknown>).tokens = [{ channel: "raw", value: "x" }];
    expect(expectInvalid(input)).toContain("FC008_ENUM_VIOLATION");
  });

  it("names the payload field 'value', keeping the name 'token' out of Layer B", () => {
    // `token` is a prohibited feature-input name in its credential sense, so the
    // semantic-token payload must not reuse it.
    const input = buildObservationInput();
    (input.semantics as Record<string, unknown>).tokens = [{ channel: "ctl", token: "public" }];
    const codes = expectInvalid(input);
    expect(codes).toContain("FC008_UNKNOWN_KEY");
    expect(codes).toContain("FC008_MISSING_KEY");
  });
});

describe("ObservationSemantics state-token grammar", () => {
  it("accepts a namespace drawn from the frozen transition properties", () => {
    const input = buildObservationInput({ semantics: { stateTokens: ["visibility:private"] } });
    expect(validateActionObservation(input).valid).toBe(true);
  });

  it("rejects an undeclared namespace, preventing free-text growth", () => {
    const input = buildObservationInput({ semantics: { stateTokens: ["hostname:github-com"] } });
    expect(expectInvalid(input)).toContain("FC008_ENUM_VIOLATION");
  });

  it("rejects a malformed state token", () => {
    for (const bad of ["visibility", "visibility:", ":private", "Visibility:Private"]) {
      const input = buildObservationInput({ semantics: { stateTokens: [bad] } });
      expect(expectInvalid(input)).toContain("FC008_PATTERN_VIOLATION");
    }
  });

  it("rejects duplicate state tokens", () => {
    const input = buildObservationInput({
      semantics: { stateTokens: ["visibility:private", "visibility:private"] },
    });
    expect(expectInvalid(input)).toContain("FC008_DUPLICATE_VALUE");
  });
});

describe("ObservationSemantics cross-field invariants", () => {
  it("requires stateTokenCount to equal the state token array length", () => {
    const base = buildSemantics();
    const input = buildObservationInput({
      semantics: {
        structuralCounts: { ...base.structuralCounts, stateTokenCount: 5 },
      },
    });
    expect(expectInvalid(input)).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("requires missingness flags to agree with the data they describe", () => {
    const base = buildSemantics();
    const input = buildObservationInput({
      semantics: {
        missingness: { ...base.missingness, stateTokensMissing: true },
      },
    });
    expect(expectInvalid(input)).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("requires accessibleNameMissing to agree with the acc channel", () => {
    const base = buildSemantics();
    const input = buildObservationInput({
      semantics: {
        tokens: [{ channel: "ctl", value: "make" }],
        missingness: { ...base.missingness, accessibleNameMissing: false },
      },
    });
    expect(expectInvalid(input)).toContain("FC008_INVARIANT_VIOLATION");
  });
});

describe("ActionObservation benchmark layer constraints", () => {
  it("requires opaque identifiers rather than human-readable names", () => {
    const input = buildObservationInput({
      benchmark: { ...buildBenchmarkInput(), applicationFamilyId: "GitHub Enterprise" },
    });
    expect(expectInvalid(input)).toContain("FC008_PATTERN_VIOLATION");
  });

  it("rejects an oracle class smuggled into the benchmark layer", () => {
    const input = buildObservationInput({
      benchmark: { ...buildBenchmarkInput(), oracleClass: "7" },
    });
    expect(expectInvalid(input)).toContain("FC008_UNKNOWN_KEY");
  });
});

describe("ActionObservation fingerprint integrity", () => {
  it("rejects a declared fingerprint that does not match the content", () => {
    const input = buildObservationInput({ inputFingerprint: "FP1|forged" });
    expect(expectInvalid(input)).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("is unaffected by the benchmark layer", () => {
    const plain = validateActionObservation(buildObservationInput());
    const decorated = validateActionObservation(
      buildObservationInput({ benchmark: buildBenchmarkInput() }),
    );
    expect(plain.valid && decorated.valid).toBe(true);
    if (!plain.valid || !decorated.valid) {
      return;
    }
    expect(decorated.value.inputFingerprint).toBe(plain.value.inputFingerprint);
  });
});

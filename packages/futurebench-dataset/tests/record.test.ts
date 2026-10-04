import {
  FC008_EXTRACTOR_ID,
  FC008_EXTRACTOR_VERSION,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
} from "@futureclick/action-understanding";
import { TEXT_SANITIZER_VERSION } from "@futureclick/privacy";
import { describe, expect, it } from "vitest";
import { control, semanticText, state, surfaceSnapshot } from "../src/authoring.js";
import {
  CANONICAL_REFUSALS,
  CanonicalizationError,
  canonicalByteLength,
  canonicalJson,
  canonicalSha256,
  hashChain,
  sha256Hex,
} from "../src/canonical.js";
import {
  FUTUREBENCH_RECORD_KEYS,
  FUTUREBENCH_RECORD_SCHEMA_VERSION,
  MAX_CANONICAL_RECORD_BYTES,
  OBSERVATION_FORBIDDEN_RECORD_KEYS,
  SEMANTICS_FORBIDDEN_IDENTITY_KEYS,
  buildFutureBenchRecord,
  canonicalRecordText,
} from "../src/record.js";
import { buildTestObservation } from "./helpers.js";

function observation() {
  return buildTestObservation(
    surfaceSnapshot({
      headings: [semanticText("Delete this file?")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file"],
      candidates: [
        control({ ownText: semanticText("Delete file"), destructiveStyle: true }),
        control({ ownText: semanticText("Cancel") }),
      ],
    }),
    { observationId: "obs-record-0001" },
  );
}

function recordInput() {
  return {
    recordId: "rec-test-0001",
    observation: observation(),
    oracle: {
      oracleId: "fc008-specificity-oracle",
      oracleVersion: "1.0",
      classNumber: 1,
      supportedTuple: {
        verb: "delete",
        objectKind: "file" as const,
        property: "existence",
        from: "present",
        to: "absent",
      },
      disposition: "resolved" as const,
      reason: "sole-specific-transition",
    },
    benchmark: {
      datasetVersion: "fb-ds-1-0",
      generatorVersion: "fb-gen-1-0",
      extractorId: FC008_EXTRACTOR_ID,
      extractorVersion: FC008_EXTRACTOR_VERSION,
      sanitizerVersion: TEXT_SANITIZER_VERSION,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      provenanceClass: "synthetic-by-construction" as const,
    },
    partition: "train" as const,
    lineage: {
      applicationFamilyId: "family-test",
      templateLineageId: "lineage-test",
      parentLineageId: "lineage-test",
      scenarioId: "scenario-test",
      wordingVariantId: "w0",
      layoutVariantId: "l0",
      variantKind: "canonical" as const,
    },
    consequence: null,
  };
}

describe("FutureBench record schema", () => {
  it("is versioned and has exactly the declared top-level sections", () => {
    const built = buildFutureBenchRecord(recordInput());
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.record.schemaVersion).toBe(FUTUREBENCH_RECORD_SCHEMA_VERSION);
    expect(Object.keys(built.record).sort()).toEqual([...FUTUREBENCH_RECORD_KEYS].sort());
  });

  it("keeps the oracle beside the observation, never inside it", () => {
    const built = buildFutureBenchRecord(recordInput());
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    // The separation that the whole design rests on: ground truth is a sibling
    // section, so no consumer handed an ActionObservation can read the answer.
    expect(built.record.oracle.classNumber).toBe(1);
    expect(JSON.stringify(built.record.observation)).not.toContain("classNumber");
    expect(JSON.stringify(built.record.observation)).not.toContain("supportedTuple");
  });

  it("refuses an observation carrying ground truth", () => {
    const polluted = recordInput();
    const built = buildFutureBenchRecord({
      ...polluted,
      observation: {
        ...polluted.observation,
        // Exactly the "convenient" refactor the check exists to stop.
        groundTruth: { classNumber: 1 },
      } as never,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.refusal).toBe("observation-contains-forbidden-key");
    }
  });

  it("refuses identity smuggled into the semantics", () => {
    const polluted = recordInput();
    const built = buildFutureBenchRecord({
      ...polluted,
      observation: {
        ...polluted.observation,
        semantics: {
          ...polluted.observation.semantics,
          templateLineageId: "lineage-test",
        },
      } as never,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.refusal).toBe("semantics-contains-identity-key");
    }
  });

  it("permits benchmark identity in Layer C, which is where it belongs", () => {
    // The counterpart to the previous test. Identity in Layer C is required for the
    // dataset to be auditable; what matters is that Layer B cannot see it, and the
    // projector's signature is what guarantees that.
    const built = buildFutureBenchRecord(recordInput());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.record.observation.benchmark?.templateLineageId).toBe("lineage-test");
    }
  });

  it("declares disjoint forbidden-key sets with documented scopes", () => {
    const groundTruth = new Set<string>(OBSERVATION_FORBIDDEN_RECORD_KEYS);
    for (const identityKey of SEMANTICS_FORBIDDEN_IDENTITY_KEYS) {
      // `lineage` and `partition` are scoped to the semantics rather than the whole
      // observation; the two lists must not contradict each other.
      if (groundTruth.has(identityKey)) {
        expect(identityKey).toBe("lineage");
      }
    }
  });

  it("enforces the canonical size cap as a refusal", () => {
    const input = recordInput();
    const oversized = buildFutureBenchRecord({
      ...input,
      recordId: "rec-oversized",
      consequence: {
        reversibility: "irreversible",
        riskBand: "high",
        // Authored annotation large enough to breach the cap.
        rationale: "x".repeat(MAX_CANONICAL_RECORD_BYTES),
      } as never,
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.refusal).toBe("canonical-size-exceeds-cap");
    }
  });

  it("stays well inside the cap for an ordinary record", () => {
    const built = buildFutureBenchRecord(recordInput());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.canonicalBytes).toBeLessThan(MAX_CANONICAL_RECORD_BYTES);
      expect(canonicalByteLength(canonicalRecordText(built.record))).toBeLessThan(
        MAX_CANONICAL_RECORD_BYTES,
      );
    }
  });

  it("changes the record hash when any field changes", () => {
    const first = buildFutureBenchRecord(recordInput());
    const second = buildFutureBenchRecord({ ...recordInput(), partition: "test-id" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.record.recordHash).not.toBe(second.record.recordHash);
    }
  });

  it("reproduces the same hash from the same input", () => {
    const first = buildFutureBenchRecord(recordInput());
    const second = buildFutureBenchRecord(recordInput());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.record.recordHash).toBe(second.record.recordHash);
    }
  });

  it("marks provenance as synthetic by construction", () => {
    const built = buildFutureBenchRecord(recordInput());
    expect(built.ok).toBe(true);
    if (built.ok) {
      // Carried on every record so that no downstream consumer can mistake this
      // corpus for evidence about real users.
      expect(built.record.benchmark.provenanceClass).toBe("synthetic-by-construction");
    }
  });
});

describe("canonical JSON", () => {
  it("sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("produces identical text regardless of insertion order", () => {
    const first = canonicalJson({ z: [1, 2], a: { n: null, m: "x" } });
    const second = canonicalJson({ a: { m: "x", n: null }, z: [1, 2] });
    expect(first).toBe(second);
  });

  it("preserves array order, which is semantic", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("refuses lossy values rather than silently normalizing them", () => {
    // A manifest that hashed after quietly dropping a field would be worse than one
    // that failed: the hash would look authoritative and describe different data.
    const cases: readonly [string, unknown][] = [
      ["undefined-value", { a: undefined }],
      ["function-value", { a: () => 1 }],
      ["symbol-value", { a: Symbol("s") }],
      ["bigint-value", { a: 1n }],
      ["non-finite-number", { a: Number.POSITIVE_INFINITY }],
      ["unsafe-integer", { a: Number.MAX_SAFE_INTEGER + 2 }],
    ];
    for (const [, value] of cases) {
      expect(() => canonicalJson(value)).toThrow(CanonicalizationError);
    }
  });

  it("refuses a cycle", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalizationError);
  });

  it("names the refusal and the path without revealing the value", () => {
    try {
      canonicalJson({ outer: { secret: 1n } });
      expect.unreachable("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      const message = (error as CanonicalizationError).message;
      expect(message).toContain("outer.secret");
      // The path is useful for debugging; the value could be a credential.
      expect(message).not.toContain("1n");
    }
  });

  it("declares a closed refusal set", () => {
    expect(CANONICAL_REFUSALS.length).toBeGreaterThan(0);
    expect(new Set(CANONICAL_REFUSALS).size).toBe(CANONICAL_REFUSALS.length);
  });
});

describe("hashing", () => {
  it("is stable and sensitive", () => {
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
    expect(sha256Hex("a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes canonical objects independently of key order", () => {
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(canonicalSha256({ b: 2, a: 1 }));
  });

  it("joins a hash chain unambiguously", () => {
    // Newline-joined rather than concatenated: ["ab","c"] and ["a","bc"] must not
    // produce the same chain hash.
    expect(hashChain(["ab", "c"])).not.toBe(hashChain(["a", "bc"]));
  });

  it("depends on chain order", () => {
    expect(hashChain(["a", "b"])).not.toBe(hashChain(["b", "a"]));
  });
});

import { describe, expect, it } from "vitest";
import {
  FAILURE_REASONS,
  FAILURE_STAGES,
  type FailureDetail,
  MAX_FAILURE_MEASUREMENT,
  createFailureDetail,
} from "../src/failure-detail.js";
import {
  type AbstainedResult,
  EPISTEMIC_ABSTENTION_REASONS,
  type FailedResult,
  type HypothesisResult,
  OPERATIONAL_FAILURE_CODES,
  UNDERSTANDING_OUTCOMES,
  type UnderstandingResult,
  assertUnreachableOutcome,
  createAbstainedResult,
  createFailedResult,
  createHypothesisResult,
  isAbstainedResult,
  isEpistemicAbstentionReason,
  isFailedResult,
  isHypothesisResult,
  isOperationalFailureCode,
  participatesInSelectiveStatistics,
} from "../src/result.js";
import { validateActionHypothesis } from "../src/hypothesis.js";
import { buildHypothesisInput } from "./helpers.js";

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// Exactly three outcomes, discriminated by a literal tag.
type _ThreeOutcomes = AssertTrue<
  Equals<UnderstandingResult["outcome"], "hypothesis" | "abstained" | "failed">
>;

// The two kinds of non-answer are structurally distinct: an abstention has no
// operational code, and a failure has no epistemic reason.
type _AbstainedHasNoCode = AssertFalse<HasKey<AbstainedResult, "code">>;
type _FailedHasNoReason = AssertFalse<HasKey<FailedResult, "reason">>;
type _AbstainedHasReason = AssertTrue<HasKey<AbstainedResult, "reason">>;
type _FailedHasCode = AssertTrue<HasKey<FailedResult, "code">>;

// A failure carries no hypothesis and no support diagnostics, so it cannot be
// mistaken for a model judgement.
type _FailedHasNoHypothesis = AssertFalse<HasKey<FailedResult, "hypothesis">>;
type _FailedHasNoSupport = AssertFalse<HasKey<FailedResult, "support">>;
type _FailedHasNoConfidence = AssertFalse<HasKey<FailedResult, "confidence">>;
type _AbstainedHasNoHypothesis = AssertFalse<HasKey<AbstainedResult, "hypothesis">>;

// Only the hypothesis outcome carries a hypothesis.
type _HypothesisHasHypothesis = AssertTrue<HasKey<HypothesisResult, "hypothesis">>;

function validHypothesis() {
  const result = validateActionHypothesis(buildHypothesisInput());
  if (!result.valid) {
    throw new Error("fixture hypothesis invalid");
  }
  return result.value;
}

describe("UnderstandingResult outcome vocabulary", () => {
  it("declares exactly three outcomes", () => {
    expect(UNDERSTANDING_OUTCOMES).toEqual(["hypothesis", "abstained", "failed"]);
  });

  it("declares exactly seven epistemic abstention reasons", () => {
    expect(EPISTEMIC_ABSTENTION_REASONS).toEqual([
      "LOW_CONFIDENCE",
      "AMBIGUOUS_ACTION",
      "NOVEL_OR_UNSUPPORTED_INPUT",
      "INSUFFICIENT_CONTEXT",
      "UNSUPPORTED_OBJECT",
      "PRIVACY_REDACTION_TOO_HIGH",
      "OBSERVATION_STALE",
    ]);
  });

  it("declares exactly five operational failure codes", () => {
    expect(OPERATIONAL_FAILURE_CODES).toEqual([
      "SCHEMA_INVALID",
      "MODEL_UNAVAILABLE",
      "MODEL_TIMEOUT",
      "MODEL_VERSION_MISMATCH",
      "INTERNAL_ERROR",
    ]);
  });

  it("names the novelty reason without claiming statistical OOD detection", () => {
    // FC-008 makes no robust statistical out-of-distribution claim, so the
    // reason is named for the deterministic check that produced it.
    expect(EPISTEMIC_ABSTENTION_REASONS).toContain("NOVEL_OR_UNSUPPORTED_INPUT");
    expect(EPISTEMIC_ABSTENTION_REASONS).not.toContain("OUT_OF_DISTRIBUTION");
  });

  it("keeps the two vocabularies disjoint", () => {
    const overlap = EPISTEMIC_ABSTENTION_REASONS.filter((reason) =>
      (OPERATIONAL_FAILURE_CODES as readonly string[]).includes(reason),
    );
    expect(overlap).toEqual([]);
  });

  it("classifies each vocabulary member only under its own predicate", () => {
    for (const reason of EPISTEMIC_ABSTENTION_REASONS) {
      expect(isEpistemicAbstentionReason(reason)).toBe(true);
      expect(isOperationalFailureCode(reason)).toBe(false);
    }
    for (const code of OPERATIONAL_FAILURE_CODES) {
      expect(isOperationalFailureCode(code)).toBe(true);
      expect(isEpistemicAbstentionReason(code)).toBe(false);
    }
  });

  it("rejects non-string and unknown values in both predicates", () => {
    for (const bad of [null, undefined, 0, {}, [], "low_confidence", "OUT_OF_DISTRIBUTION"]) {
      expect(isEpistemicAbstentionReason(bad)).toBe(false);
      expect(isOperationalFailureCode(bad)).toBe(false);
    }
  });
});

describe("UnderstandingResult construction", () => {
  it("builds a frozen hypothesis result with no diagnostics by default", () => {
    const result = createHypothesisResult(validHypothesis());
    expect(result.outcome).toBe("hypothesis");
    expect(result.diagnostics).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("builds a frozen abstained result that nulls unknown context", () => {
    const result = createAbstainedResult({ reason: "LOW_CONFIDENCE" });
    expect(result).toEqual({
      outcome: "abstained",
      reason: "LOW_CONFIDENCE",
      observationId: null,
      inputFingerprint: null,
      support: null,
      provenance: null,
      diagnostics: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("builds a frozen failed result and detaches the detail record", () => {
    const detail = createFailureDetail("provider", "provider-unavailable", 3);
    const result = createFailedResult("MODEL_UNAVAILABLE", null, detail);
    expect(result.detail).toEqual({
      stage: "provider",
      reason: "provider-unavailable",
      measurement: 3,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.detail)).toBe(true);
    // The detail is reconstructed, so a caller holding a mutable literal cannot
    // reach into a published result.
    expect(result.detail).not.toBe(detail);
  });
});

/** A valid detail for tests whose subject is the result, not the detail. */
function anyDetail(): FailureDetail {
  return createFailureDetail("runtime", "unhandled-exception");
}

describe("failure detail is closed and bounded", () => {
  it("carries no free-text field at all", () => {
    const detail = createFailureDetail("provider", "provider-timeout", 42);
    expect(Object.keys(detail).sort()).toEqual(["measurement", "reason", "stage"]);
    for (const value of Object.values(detail)) {
      expect(typeof value === "string" || typeof value === "number").toBe(true);
    }
  });

  it("accepts only declared stages and reasons, failing closed otherwise", () => {
    // An unknown stage or reason cannot be smuggled through as a label, which is
    // what keeps page- and model-derived text out of every failure path.
    const bogus = createFailureDetail(
      "page-content" as never,
      "Error: unexpected token < in JSON" as never,
    );
    expect(FAILURE_STAGES).toContain(bogus.stage);
    expect(FAILURE_REASONS).toContain(bogus.reason);
    expect(bogus.stage).toBe("runtime");
    expect(bogus.reason).toBe("unhandled-exception");
  });

  it("freezes both vocabularies", () => {
    expect(Object.isFrozen(FAILURE_STAGES)).toBe(true);
    expect(Object.isFrozen(FAILURE_REASONS)).toBe(true);
  });

  it("bounds and sanitizes the numeric measurement", () => {
    expect(createFailureDetail("provider", "deadline-exceeded", 10).measurement).toBe(10);
    expect(createFailureDetail("provider", "deadline-exceeded").measurement).toBeNull();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, MAX_FAILURE_MEASUREMENT + 1]) {
      expect(createFailureDetail("provider", "deadline-exceeded", bad).measurement).toBeNull();
    }
  });

  it("returns a frozen detail", () => {
    expect(Object.isFrozen(createFailureDetail("runtime", "clock-invalid"))).toBe(true);
  });
});

describe("UnderstandingResult discrimination", () => {
  const results: readonly UnderstandingResult[] = [
    createHypothesisResult(validHypothesis()),
    createAbstainedResult({ reason: "AMBIGUOUS_ACTION" }),
    createFailedResult("INTERNAL_ERROR", null, anyDetail()),
  ];

  it("matches exactly one type guard per result", () => {
    for (const result of results) {
      const matches = [
        isHypothesisResult(result),
        isAbstainedResult(result),
        isFailedResult(result),
      ].filter(Boolean);
      expect(matches).toHaveLength(1);
    }
  });

  it("narrows exhaustively in a switch, with the guard unreachable", () => {
    for (const result of results) {
      switch (result.outcome) {
        case "hypothesis":
          expect(result.hypothesis.evidenceMode).toBe("predicted");
          break;
        case "abstained":
          expect(isEpistemicAbstentionReason(result.reason)).toBe(true);
          break;
        case "failed":
          expect(isOperationalFailureCode(result.code)).toBe(true);
          break;
        default:
          assertUnreachableOutcome(result);
      }
    }
  });

  it("throws if an unknown outcome ever reaches the exhaustiveness guard", () => {
    expect(() => assertUnreachableOutcome({ outcome: "invented" } as never)).toThrow(
      /Unhandled UnderstandingResult outcome/,
    );
  });
});

describe("operational failure is excluded from research statistics", () => {
  it("counts hypothesis and abstained results, never failures", () => {
    expect(participatesInSelectiveStatistics(createHypothesisResult(validHypothesis()))).toBe(true);
    for (const reason of EPISTEMIC_ABSTENTION_REASONS) {
      expect(participatesInSelectiveStatistics(createAbstainedResult({ reason }))).toBe(true);
    }
    for (const code of OPERATIONAL_FAILURE_CODES) {
      expect(participatesInSelectiveStatistics(createFailedResult(code, null, anyDetail()))).toBe(
        false,
      );
    }
  });

  it("means a crash cannot inflate the measured abstention rate", () => {
    const batch: UnderstandingResult[] = [
      createHypothesisResult(validHypothesis()),
      createAbstainedResult({ reason: "LOW_CONFIDENCE" }),
      createFailedResult("MODEL_TIMEOUT", null, anyDetail()),
      createFailedResult("INTERNAL_ERROR", null, anyDetail()),
    ];
    const considered = batch.filter(participatesInSelectiveStatistics);
    expect(considered).toHaveLength(2);

    const coverage = considered.filter(isHypothesisResult).length / considered.length;
    expect(coverage).toBe(0.5);

    // The two failures are reported separately as a reliability defect.
    expect(batch.filter(isFailedResult)).toHaveLength(2);
  });

  it("gives a timeout an operational code, never an epistemic reason", () => {
    const timeout = createFailedResult("MODEL_TIMEOUT", null, anyDetail());
    expect(timeout.outcome).toBe("failed");
    expect(isEpistemicAbstentionReason(timeout.code)).toBe(false);
  });
});

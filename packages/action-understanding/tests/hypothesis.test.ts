import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import {
  ACTION_HYPOTHESIS_SCHEMA_VERSION,
  type ActionHypothesis,
  CALIBRATION_METHOD,
  FC008_EVIDENCE_MODE,
  FC008_MODEL_FAMILIES,
  type InferenceDiagnostics,
  validateActionHypothesis,
} from "../src/hypothesis.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import { buildAlternative, buildHypothesisInput } from "./helpers.js";

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// There is no VERIFIED path: the evidence mode is a literal type.
type _EvidenceModeIsLiteral = AssertTrue<Equals<ActionHypothesis["evidenceMode"], "predicted">>;
type _EvidenceModeIsNotString = AssertFalse<Equals<ActionHypothesis["evidenceMode"], string>>;

// No capability, authority, or DOM field is reachable from the hypothesis.
type _NoElement = AssertFalse<HasKey<ActionHypothesis, "element">>;
type _NoNode = AssertFalse<HasKey<ActionHypothesis, "node">>;
type _NoTarget = AssertFalse<HasKey<ActionHypothesis, "target">>;
type _NoEvent = AssertFalse<HasKey<ActionHypothesis, "event">>;
type _NoExecute = AssertFalse<HasKey<ActionHypothesis, "execute">>;
type _NoExecutor = AssertFalse<HasKey<ActionHypothesis, "executor">>;
type _NoRelease = AssertFalse<HasKey<ActionHypothesis, "release">>;
type _NoReleaseToken = AssertFalse<HasKey<ActionHypothesis, "releaseToken">>;
type _NoClick = AssertFalse<HasKey<ActionHypothesis, "click">>;
type _NoCapability = AssertFalse<HasKey<ActionHypothesis, "capability">>;
type _NoTool = AssertFalse<HasKey<ActionHypothesis, "tool">>;
type _NoCallback = AssertFalse<HasKey<ActionHypothesis, "callback">>;
type _NoOnAccept = AssertFalse<HasKey<ActionHypothesis, "onAccept">>;
type _NoApprove = AssertFalse<HasKey<ActionHypothesis, "approve">>;
type _NoVerified = AssertFalse<HasKey<ActionHypothesis, "verified">>;
type _NoDecision = AssertFalse<HasKey<ActionHypothesis, "decision">>;
type _NoAuthority = AssertFalse<HasKey<ActionHypothesis, "authority">>;
type _NoPolicy = AssertFalse<HasKey<ActionHypothesis, "policy">>;
type _NoThresholds = AssertFalse<HasKey<ActionHypothesis, "thresholds">>;

// Research diagnostics are a separate type, not fields on the hypothesis.
type _NoModelConfidence = AssertFalse<HasKey<ActionHypothesis, "modelConfidence">>;
type _NoMargin = AssertFalse<HasKey<ActionHypothesis, "margin">>;
type _NoEntropy = AssertFalse<HasKey<ActionHypothesis, "entropy">>;
type _NoLogits = AssertFalse<HasKey<ActionHypothesis, "logits">>;
type _NoProbabilities = AssertFalse<HasKey<ActionHypothesis, "probabilities">>;
type _NoLatency = AssertFalse<HasKey<ActionHypothesis, "latencyMs">>;
type _DiagnosticsHoldMargin = AssertTrue<HasKey<InferenceDiagnostics, "margin">>;
type _DiagnosticsHoldEntropy = AssertTrue<HasKey<InferenceDiagnostics, "entropy">>;

// Confidence exposes the calibrated value only.
type _NoRawConfidence = AssertFalse<HasKey<ActionHypothesis["confidence"], "modelConfidence">>;
type _NoRawLogitsOnConfidence = AssertFalse<HasKey<ActionHypothesis["confidence"], "logits">>;

function expectInvalid(input: unknown): readonly string[] {
  const result = validateActionHypothesis(input);
  expect(result.valid).toBe(false);
  return result.issues.map((i) => i.code);
}

describe("ActionHypothesis constants", () => {
  it("declares predicted as the only evidence mode", () => {
    expect(FC008_EVIDENCE_MODE).toBe("predicted");
    expect(ACTION_HYPOTHESIS_SCHEMA_VERSION).toBe("1.0");
  });

  it("declares temperature scaling as the only calibration method", () => {
    expect(CALIBRATION_METHOD).toBe("temperature-scaling");
  });

  it("declares exactly the two research model families", () => {
    expect(FC008_MODEL_FAMILIES).toEqual(["factorized-logistic", "joint-logistic"]);
  });
});

describe("ActionHypothesis acceptance", () => {
  it("accepts a well-formed hypothesis", () => {
    const result = validateActionHypothesis(buildHypothesisInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.evidenceMode).toBe("predicted");
    expect(result.value.tuple.verb).toBe("change-access");
    expect(result.value.actor.kind).toBe("human");
  });

  it("returns a deeply frozen, fully inert record", () => {
    const result = validateActionHypothesis(
      buildHypothesisInput({ alternatives: [buildAlternative(2, 0.05)] }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(findUnfrozenPath(result.value)).toBeNull();
    expect(findNonInertPath(result.value)).toBeNull();
  });

  it("is JSON-serializable with no loss, proving it carries no live reference", () => {
    const result = validateActionHypothesis(buildHypothesisInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const roundTripped = JSON.parse(JSON.stringify(result.value));
    const revalidated = validateActionHypothesis(roundTripped);
    expect(revalidated.valid).toBe(true);
  });
});

describe("ActionHypothesis rejects any non-PREDICTED evidence mode", () => {
  it("rejects verified", () => {
    expect(expectInvalid(buildHypothesisInput({ evidenceMode: "verified" }))).toContain(
      "FC008_ENUM_VIOLATION",
    );
  });

  it("rejects simulated, inferred, case variants, and non-string modes", () => {
    for (const mode of ["simulated", "inferred", "PREDICTED", "", null, 1, true]) {
      expect(expectInvalid(buildHypothesisInput({ evidenceMode: mode }))).toContain(
        "FC008_ENUM_VIOLATION",
      );
    }
  });

  it("rejects a present-but-undefined mode before the enum check", () => {
    expect(expectInvalid(buildHypothesisInput({ evidenceMode: undefined }))).toContain(
      "FC008_UNDEFINED_VALUE",
    );
  });

  it("rejects an absent mode", () => {
    const input = buildHypothesisInput();
    // biome-ignore lint/performance/noDelete: an absent key is a different input than a present undefined key, and both are tested
    delete input.evidenceMode;
    expect(expectInvalid(input)).toContain("FC008_MISSING_KEY");
  });
});

describe("ActionHypothesis requires a supported tuple", () => {
  it("rejects a tuple outside the frozen matrix", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          tuple: {
            verb: "delete",
            objectKind: "repository",
            transition: { property: "existence", from: "present", to: "absent" },
          },
        }),
      ),
    ).toContain("FC008_ENUM_VIOLATION");
  });

  it("rejects an invented verb or object kind", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          tuple: {
            verb: "exfiltrate",
            objectKind: "file",
            transition: { property: "existence", from: "present", to: "absent" },
          },
        }),
      ),
    ).toContain("FC008_ENUM_VIOLATION");
  });

  it("rejects an extra field smuggled into the tuple", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          tuple: {
            verb: "change-access",
            objectKind: "repository",
            transition: { property: "visibility", from: "private", to: "public" },
            objectLabel: "venky/secret",
          },
        }),
      ),
    ).toContain("FC008_UNKNOWN_KEY");
  });
});

describe("ActionHypothesis alternatives", () => {
  it("accepts up to the frozen alternative cap", () => {
    const alternatives = [
      buildAlternative(2, 0.05),
      buildAlternative(3, 0.02),
      buildAlternative(4, 0.01),
    ];
    expect(alternatives).toHaveLength(FC008_SAFETY_CAPS.maxAlternatives);
    const result = validateActionHypothesis(buildHypothesisInput({ alternatives }));
    expect(result.valid).toBe(true);
  });

  it("rejects more than the frozen alternative cap", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          alternatives: [
            buildAlternative(2, 0.05),
            buildAlternative(3, 0.04),
            buildAlternative(4, 0.03),
            buildAlternative(5, 0.02),
          ],
        }),
      ),
    ).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects an alternative equal to the primary tuple", () => {
    expect(
      expectInvalid(buildHypothesisInput({ alternatives: [buildAlternative(7, 0.05)] })),
    ).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("rejects duplicate alternatives", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          alternatives: [buildAlternative(2, 0.05), buildAlternative(2, 0.04)],
        }),
      ),
    ).toContain("FC008_DUPLICATE_VALUE");
  });

  it("rejects alternatives ordered by increasing confidence", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          alternatives: [buildAlternative(2, 0.02), buildAlternative(3, 0.05)],
        }),
      ),
    ).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("rejects an alternative more confident than the primary", () => {
    expect(
      expectInvalid(buildHypothesisInput({ alternatives: [buildAlternative(2, 0.99)] })),
    ).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("rejects an out-of-range alternative confidence", () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
      expect(
        expectInvalid(
          buildHypothesisInput({
            alternatives: [{ tuple: buildAlternative(2, 0.1), calibratedConfidence: bad }],
          }),
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("ActionHypothesis actor is inherited, never predicted", () => {
  it("accepts a canonical actor kind", () => {
    expect(validateActionHypothesis(buildHypothesisInput({ actor: { kind: "agent" } })).valid).toBe(
      true,
    );
  });

  it("rejects an invented actor kind", () => {
    expect(expectInvalid(buildHypothesisInput({ actor: { kind: "model" } }))).toContain(
      "FC008_ENUM_VIOLATION",
    );
  });

  it("rejects extra fields on the actor", () => {
    expect(
      expectInvalid(buildHypothesisInput({ actor: { kind: "human", confidence: 0.9 } })),
    ).toContain("FC008_UNKNOWN_KEY");
  });
});

describe("ActionHypothesis confidence and provenance", () => {
  it("rejects a calibration method other than temperature scaling", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          confidence: {
            calibratedConfidence: 0.9,
            calibrationMethod: "isotonic",
            calibrationArtifactVersion: "cal-1",
          },
        }),
      ),
    ).toContain("FC008_ENUM_VIOLATION");
  });

  it("rejects an uncalibrated confidence field on the confidence record", () => {
    expect(
      expectInvalid(
        buildHypothesisInput({
          confidence: {
            calibratedConfidence: 0.9,
            calibrationMethod: "temperature-scaling",
            calibrationArtifactVersion: "cal-1",
            modelConfidence: 0.99,
          },
        }),
      ),
    ).toContain("FC008_UNKNOWN_KEY");
  });

  it("rejects a provenance source other than model", () => {
    const base = buildHypothesisInput();
    const provenance = { ...(base.provenance as Record<string, unknown>), source: "dom" };
    expect(expectInvalid(buildHypothesisInput({ provenance }))).toContain("FC008_ENUM_VIOLATION");
  });

  it("rejects a model family outside the two research families", () => {
    const base = buildHypothesisInput();
    const provenance = {
      ...(base.provenance as Record<string, unknown>),
      modelFamily: "transformer",
    };
    expect(expectInvalid(buildHypothesisInput({ provenance }))).toContain("FC008_ENUM_VIOLATION");
  });

  it("requires a 64-character lowercase hex artifact digest", () => {
    const base = buildHypothesisInput();
    for (const bad of ["A".repeat(64), "a".repeat(63), "", "not-a-hash"]) {
      const provenance = { ...(base.provenance as Record<string, unknown>), artifactSha256: bad };
      expect(expectInvalid(buildHypothesisInput({ provenance })).length).toBeGreaterThan(0);
    }
  });

  it("rejects a stale support matrix or feature policy version", () => {
    const base = buildHypothesisInput();
    for (const key of ["supportMatrixVersion", "featurePolicyVersion"]) {
      const provenance = { ...(base.provenance as Record<string, unknown>), [key]: "0.9" };
      expect(expectInvalid(buildHypothesisInput({ provenance }))).toContain("FC008_ENUM_VIOLATION");
    }
  });
});

describe("ActionHypothesis hostile-input handling", () => {
  it("rejects unknown top-level keys, including capability-shaped ones", () => {
    for (const key of ["execute", "releaseToken", "element", "onAccept", "verified"]) {
      expect(expectInvalid(buildHypothesisInput({ [key]: "x" }))).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("rejects a function placed in any field", () => {
    expect(expectInvalid(buildHypothesisInput({ id: () => "x" })).length).toBeGreaterThan(0);
  });

  it("fails closed rather than throwing on a hostile getter", () => {
    const input = buildHypothesisInput();
    Object.defineProperty(input, "tuple", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("hostile");
      },
    });
    expect(expectInvalid(input)).toContain("FC008_ACCESSOR_PROPERTY");
  });

  it("fails closed rather than throwing on a self-referential structure", () => {
    const input = buildHypothesisInput();
    (input.provenance as Record<string, unknown>).self = input;
    const result = validateActionHypothesis(input);
    expect(result.valid).toBe(false);
  });
});

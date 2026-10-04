import { describe, expect, it } from "vitest";
import {
  FC008_PRECEDENCE,
  FC008_PRECEDENCE_STEP_COUNT,
  precedenceStepForEpistemicReason,
  precedenceStepForOperationalCode,
} from "../src/precedence.js";
import {
  EPISTEMIC_ABSTENTION_REASONS,
  OPERATIONAL_FAILURE_CODES,
  isAbstainedResult,
  isFailedResult,
  isHypothesisResult,
} from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import {
  at,
  ambiguousLogits,
  buildObservationInput,
  buildPolicy,
  buildRuntimeDeps,
  confidentLogits,
  createStubFreshness,
  createStubProvider,
} from "./helpers.js";

describe("the precedence ladder is declarative data", () => {
  it("declares exactly thirteen steps numbered one to thirteen", () => {
    expect(FC008_PRECEDENCE_STEP_COUNT).toBe(13);
    expect(FC008_PRECEDENCE.map((s) => s.step)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("is deeply frozen so the order cannot be mutated at runtime", () => {
    expect(Object.isFrozen(FC008_PRECEDENCE)).toBe(true);
    for (const s of FC008_PRECEDENCE) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.operationalCodes)).toBe(true);
    }
  });

  it("assigns every operational code to exactly one step", () => {
    for (const code of OPERATIONAL_FAILURE_CODES) {
      const owners = FC008_PRECEDENCE.filter((s) => s.operationalCodes.includes(code));
      expect(owners).toHaveLength(1);
      expect(precedenceStepForOperationalCode(code)).toBe(at(owners, 0).step);
    }
  });

  it("assigns every epistemic reason to at least one step", () => {
    for (const reason of EPISTEMIC_ABSTENTION_REASONS) {
      expect(precedenceStepForEpistemicReason(reason)).toBeGreaterThan(0);
    }
  });

  it("emits OBSERVATION_STALE at both the pre-inference and final steps", () => {
    const staleSteps = FC008_PRECEDENCE.filter(
      (s) => s.epistemicReason === "OBSERVATION_STALE",
    ).map((s) => s.step);
    expect(staleSteps).toEqual([5, 13]);
    expect(precedenceStepForEpistemicReason("OBSERVATION_STALE")).toBe(5);
  });

  it("gives epistemic and accept steps no operational codes", () => {
    for (const s of FC008_PRECEDENCE) {
      if (s.category !== "operational") {
        expect(s.operationalCodes).toEqual([]);
      } else {
        expect(s.operationalCodes.length).toBeGreaterThan(0);
        expect(s.epistemicReason).toBeNull();
      }
    }
  });

  it("has exactly one accept step, placed at step twelve", () => {
    const accepts = FC008_PRECEDENCE.filter((s) => s.category === "accept");
    expect(accepts).toHaveLength(1);
    expect(at(accepts, 0).step).toBe(12);
  });

  it("documents that step 13 does not replace an operational failure", () => {
    const final = at(FC008_PRECEDENCE, 12);
    expect(final.phase).toBe("final");
    expect(final.condition).toContain("Operational failures are not replaced");
  });

  it("orders phases so that no pre-inference step follows a post-inference step it outranks", () => {
    // Step 4 is the one post-inference operational step that sits above the
    // pre-inference epistemic steps, because an operational defect always
    // outranks uncertainty when it is encountered.
    expect(at(FC008_PRECEDENCE, 3).step).toBe(4);
    expect(at(FC008_PRECEDENCE, 3).phase).toBe("post-inference");
    expect(at(FC008_PRECEDENCE, 3).condition).toContain("when encountered");

    const laterPreInference = FC008_PRECEDENCE.slice(4).filter((s) => s.phase === "pre-inference");
    expect(laterPreInference.map((s) => s.step)).toEqual([5, 6, 7, 8]);
    for (const s of laterPreInference) {
      expect(s.category).toBe("epistemic");
    }
  });
});

describe("the runtime returns at the first satisfied step", () => {
  it("step 1 wins: a malformed observation fails as SCHEMA_INVALID", () => {
    const provider = createStubProvider();
    const result = evaluateObservation({ not: "an observation" }, buildRuntimeDeps({ provider }));
    expect(isFailedResult(result) && result.code).toBe("SCHEMA_INVALID");
    expect(provider.calls.count).toBe(0);
  });

  it("step 1 outranks every later condition simultaneously", () => {
    // The observation is invalid AND stale AND over-redacted AND has no artifact.
    const result = evaluateObservation(
      buildObservationInput({ inputFingerprint: "forged", retainedRatio: 0 }),
      buildRuntimeDeps({
        artifact: null,
        freshnessValidator: createStubFreshness([false, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("SCHEMA_INVALID");
  });

  it("step 2 wins over step 3: a version mismatch outranks a missing artifact", () => {
    const result = evaluateObservation(
      buildObservationInput({ freshness: { supportMatrixVersion: "0.9" } }),
      buildRuntimeDeps({ artifact: null }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("step 3 wins over step 5: a missing artifact outranks a stale observation", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: null,
        freshnessValidator: createStubFreshness([false, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
  });

  it("step 5 wins over step 6: staleness outranks excessive redaction", () => {
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput({ retainedRatio: 0 }),
      buildRuntimeDeps({ provider, freshnessValidator: createStubFreshness([false, false]) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
    // A stale observation short-circuits before the provider runs, which is why
    // no timeout can be "encountered" at step 4 on this path.
    expect(provider.calls.count).toBe(0);
  });

  it("step 6 wins over step 7: excessive redaction outranks thin context", () => {
    const result = evaluateObservation(
      buildObservationInput({
        retainedRatio: 0,
        semantics: {
          tokens: [{ channel: "ctl", value: "x" }],
          stateTokens: [],
          objectKindEvidence: [],
        },
      }),
      buildRuntimeDeps(),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("PRIVACY_REDACTION_TOO_HIGH");
  });

  it("step 7 wins over step 8: thin context outranks an unsupported object", () => {
    const result = evaluateObservation(
      buildObservationInput({
        semantics: {
          tokens: [{ channel: "ctl", value: "x" }],
          stateTokens: [],
          objectKindEvidence: ["other"],
        },
      }),
      buildRuntimeDeps({ policy: buildPolicy({ minFeatureCoverage: 0.9 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("INSUFFICIENT_CONTEXT");
  });

  it("step 8 wins over step 9: an unsupported object outranks novelty", () => {
    // Both conditions hold: the object kind is unsupported AND a categorical
    // resolved to the escape hatch. Step 8 must win, and the provider must not
    // be reached at all.
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput({
        semantics: { objectKindEvidence: ["other"], interactionKind: "other" },
      }),
      buildRuntimeDeps({ provider }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("UNSUPPORTED_OBJECT");
    expect(provider.calls.count).toBe(0);
  });

  it("step 9 wins over step 10: novelty outranks ambiguity", () => {
    // Support evidence is runtime-owned, so novelty is established from the
    // observation itself rather than from anything the provider reports.
    const result = evaluateObservation(
      buildObservationInput({ semantics: { interactionKind: "other" } }),
      buildRuntimeDeps({ provider: createStubProvider({ logits: ambiguousLogits() }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("NOVEL_OR_UNSUPPORTED_INPUT");
  });

  it("step 10 wins over step 11: ambiguity outranks low confidence", () => {
    // Two nearly tied classes: the margin fails and the top probability is also
    // below the confidence floor, so step 10 must win.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ provider: createStubProvider({ logits: ambiguousLogits() }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("AMBIGUOUS_ACTION");
  });

  it("step 11 wins when the margin passes but confidence does not", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({ logits: confidentLogits() }),
        policy: buildPolicy({ minCalibratedConfidence: 0.999999, minMargin: 0 }),
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("LOW_CONFIDENCE");
  });

  it("step 12 accepts when every gate passes", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
  });
});

describe("step 13 replaces unpublished epistemic and accepted results only", () => {
  it("replaces an otherwise accepted hypothesis with OBSERVATION_STALE", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      // Fresh before inference, stale after.
      buildRuntimeDeps({ freshnessValidator: createStubFreshness([true, false]) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
  });

  it("replaces a post-inference epistemic abstention with OBSERVATION_STALE", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({ logits: ambiguousLogits() }),
        freshnessValidator: createStubFreshness([true, false]),
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
  });

  it("does NOT replace an operational failure, so a defect stays visible", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({
          outcome: { status: "timeout", detail: "deadline-exceeded" },
        }),
        freshnessValidator: createStubFreshness([true, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
  });

  it("does not replace a crash with a stale label either", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({ throws: true }),
        freshnessValidator: createStubFreshness([true, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });

  it("carries support and provenance on the final stale abstention", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: createStubFreshness([true, false]) }),
    );
    expect(isAbstainedResult(result)).toBe(true);
    if (!isAbstainedResult(result)) {
      return;
    }
    expect(result.support).not.toBeNull();
    expect(result.provenance?.source).toBe("model");
  });
});

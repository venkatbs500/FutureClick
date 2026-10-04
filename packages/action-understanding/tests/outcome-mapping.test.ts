/**
 * Support-condition to outcome mapping, support ownership, and deep freezing
 * (AI-13, AI-19, AI-20, AI-21, AI-1).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FC008_SUPPORT_OUTCOME_MAPPING,
  NOVELTY_CHECK_CODES,
  PRE_INFERENCE_MAX_STEP,
  SUPPORT_CHECK_CODES,
  type SupportCheckCode,
  firstFailingSupportCheck,
  outcomeForSupportCheck,
  verifyOutcomeMapping,
} from "../src/outcome-mapping.js";
import { type ObservationSemantics, validateActionObservation } from "../src/observation.js";
import { FC008_PRECEDENCE } from "../src/precedence.js";
import { isAbstainedResult, isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { assessSupport } from "../src/support.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import {
  buildArtifact,
  buildObservationInput,
  buildPolicy,
  buildRuntimeDeps,
  confidentLogits,
  createStubProvider,
} from "./helpers.js";

/** The expected outcome for each of the nine checks, declared independently. */
const EXPECTED: ReadonlyArray<readonly [SupportCheckCode, string]> = [
  ["SCHEMA_VERSION_MISMATCH", "SCHEMA_INVALID"],
  ["FEATURE_POLICY_MISMATCH", "MODEL_VERSION_MISMATCH"],
  ["EXCESSIVE_PRIVACY_REDACTION", "PRIVACY_REDACTION_TOO_HIGH"],
  ["MISSING_REQUIRED_FEATURE_GROUPS", "INSUFFICIENT_CONTEXT"],
  ["MISSING_MINIMUM_SEMANTIC_EVIDENCE", "INSUFFICIENT_CONTEXT"],
  ["UNSUPPORTED_OBJECT_KIND", "UNSUPPORTED_OBJECT"],
  ["UNKNOWN_CATEGORICAL_TOKEN", "NOVEL_OR_UNSUPPORTED_INPUT"],
  ["UNKNOWN_TOKEN_RATIO_EXCEEDED", "NOVEL_OR_UNSUPPORTED_INPUT"],
  ["UNSUPPORTED_SEMANTIC_TUPLE", "NOVEL_OR_UNSUPPORTED_INPUT"],
];

describe("the support outcome mapping is frozen, total, and consistent", () => {
  it("passes its own structural self-check", () => {
    expect(verifyOutcomeMapping()).toEqual([]);
  });

  it("declares exactly nine checks and freezes the vocabulary", () => {
    expect(SUPPORT_CHECK_CODES).toHaveLength(9);
    expect(Object.isFrozen(SUPPORT_CHECK_CODES)).toBe(true);
    expect(Object.isFrozen(FC008_SUPPORT_OUTCOME_MAPPING)).toBe(true);
    for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.outcome)).toBe(true);
    }
  });

  it("maps each check to exactly the required outcome", () => {
    for (const [code, expected] of EXPECTED) {
      const outcome = outcomeForSupportCheck(code);
      const actual = outcome.category === "operational" ? outcome.code : outcome.reason;
      expect(actual).toBe(expected);
    }
  });

  it("covers every declared code exactly once", () => {
    expect(EXPECTED.map(([code]) => code)).toEqual([...SUPPORT_CHECK_CODES]);
    for (const code of SUPPORT_CHECK_CODES) {
      expect(FC008_SUPPORT_OUTCOME_MAPPING.filter((m) => m.code === code)).toHaveLength(1);
    }
  });

  it("throws rather than guessing for a code with no declared outcome", () => {
    expect(() => outcomeForSupportCheck("INVENTED" as SupportCheckCode)).toThrow(
      /has no declared outcome/,
    );
  });

  it("keeps the novelty alias pointing at the same frozen codes", () => {
    expect(NOVELTY_CHECK_CODES).toBe(SUPPORT_CHECK_CODES);
  });

  it("names no distance or density measure, so no statistical OOD claim is made", () => {
    const joined = [
      ...SUPPORT_CHECK_CODES,
      ...FC008_SUPPORT_OUTCOME_MAPPING.map((m) => m.description),
    ]
      .join(" ")
      .toLowerCase();
    for (const forbidden of ["mahalanobis", "distance", "density", "likelihood", "ood"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("assigns each check a precedence step that exists in the frozen ladder", () => {
    const steps = new Set(FC008_PRECEDENCE.map((s) => s.step));
    for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
      expect(steps.has(entry.precedenceStep)).toBe(true);
    }
  });

  it("agrees with the ladder on which phase each check belongs to", () => {
    // A check at or below the pre-inference bound must be a pre-inference step in
    // the ladder, and a check above it must not be.
    for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
      const step = FC008_PRECEDENCE.find((s) => s.step === entry.precedenceStep);
      expect(step).toBeDefined();
      if (step === undefined) {
        continue;
      }
      if (entry.precedenceStep <= PRE_INFERENCE_MAX_STEP) {
        expect(step.phase).toBe("pre-inference");
      } else {
        expect(step.phase).toBe("post-inference");
      }
    }
  });
});

describe("the mapping is evaluated in precedence order", () => {
  function supportFor(semanticsOverrides: Partial<ObservationSemantics> = {}) {
    const input = buildObservationInput({ semantics: semanticsOverrides });
    const observation = validateActionObservation(input);
    if (!observation.valid) {
      throw new Error("fixture observation invalid");
    }
    return {
      observation: observation.value,
      support: assessSupport(observation.value.semantics, {
        vocabulary: null,
        schemaVersionsMatched: true,
        supportedTupleResolved: true,
      }),
    };
  }

  it("returns null when nothing fails", () => {
    const { observation, support } = supportFor();
    expect(firstFailingSupportCheck(observation, support, buildPolicy())).toBeNull();
  });

  it("prefers the unsupported object over an unknown categorical", () => {
    const { observation, support } = supportFor({
      objectKindEvidence: ["other"],
      interactionKind: "other",
    });
    expect(firstFailingSupportCheck(observation, support, buildPolicy())).toBe(
      "UNSUPPORTED_OBJECT_KIND",
    );
  });

  it("prefers absent semantic evidence over an unsupported object", () => {
    // Only a heading token, so there is no control text and no accessible name.
    // Coverage still passes at 5/6, so the minimum-evidence check is the one
    // that fires; both are step 7 and both map to INSUFFICIENT_CONTEXT.
    const { observation, support } = supportFor({
      tokens: [{ channel: "hd", value: "x" }],
      objectKindEvidence: ["other"],
    });
    expect(firstFailingSupportCheck(observation, support, buildPolicy())).toBe(
      "MISSING_MINIMUM_SEMANTIC_EVIDENCE",
    );
  });

  it("prefers missing coverage over absent semantic evidence", () => {
    const { observation, support } = supportFor({
      tokens: [{ channel: "hd", value: "x" }],
      stateTokens: [],
      objectKindEvidence: [],
    });
    expect(
      firstFailingSupportCheck(observation, support, buildPolicy({ minFeatureCoverage: 0.9 })),
    ).toBe("MISSING_REQUIRED_FEATURE_GROUPS");
  });

  it("does not consult a step-9 check in the pre-inference phase", () => {
    const { observation, support } = supportFor({ interactionKind: "other" });
    const policy = buildPolicy();
    expect(
      firstFailingSupportCheck(observation, support, policy, PRE_INFERENCE_MAX_STEP),
    ).toBeNull();
    expect(firstFailingSupportCheck(observation, support, policy)).toBe(
      "UNKNOWN_CATEGORICAL_TOKEN",
    );
  });

  it("lets a step-9 condition still reach the provider, as the ladder requires", () => {
    // Novelty is a post-inference step, so the provider is invoked even though
    // the result will be an abstention.
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput({ semantics: { interactionKind: "other" } }),
      buildRuntimeDeps({ provider }),
    );
    expect(provider.calls.count).toBe(1);
    expect(isAbstainedResult(result) && result.reason).toBe("NOVEL_OR_UNSUPPORTED_INPUT");
  });
});

describe("each mapped condition produces its mapped outcome end to end", () => {
  it("maps excessive redaction to PRIVACY_REDACTION_TOO_HIGH", () => {
    const result = evaluateObservation(
      buildObservationInput({ retainedRatio: 0.1 }),
      buildRuntimeDeps({ policy: buildPolicy({ minRetainedRedactionRatio: 0.5 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("PRIVACY_REDACTION_TOO_HIGH");
  });

  it("maps missing feature groups to INSUFFICIENT_CONTEXT", () => {
    const result = evaluateObservation(
      buildObservationInput({
        semantics: {
          tokens: [{ channel: "ctl", value: "go" }],
          stateTokens: [],
          objectKindEvidence: [],
        },
      }),
      buildRuntimeDeps({ policy: buildPolicy({ minFeatureCoverage: 0.9 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("INSUFFICIENT_CONTEXT");
  });

  it("maps absent semantic evidence to INSUFFICIENT_CONTEXT", () => {
    const result = evaluateObservation(
      buildObservationInput({ semantics: { tokens: [{ channel: "hd", value: "danger" }] } }),
      buildRuntimeDeps({ policy: buildPolicy({ minFeatureCoverage: 0 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("INSUFFICIENT_CONTEXT");
  });

  it("maps an unsupported object kind to UNSUPPORTED_OBJECT", () => {
    const result = evaluateObservation(
      buildObservationInput({ semantics: { objectKindEvidence: ["other"] } }),
      buildRuntimeDeps(),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("UNSUPPORTED_OBJECT");
  });

  it("maps an unknown categorical to NOVEL_OR_UNSUPPORTED_INPUT", () => {
    const result = evaluateObservation(
      buildObservationInput({ semantics: { surfaceKind: "other" } }),
      buildRuntimeDeps(),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("NOVEL_OR_UNSUPPORTED_INPUT");
  });

  it("never maps a support condition to an operational crash code", () => {
    for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
      if (entry.outcome.category === "operational") {
        expect(["SCHEMA_INVALID", "MODEL_VERSION_MISMATCH"]).toContain(entry.outcome.code);
      }
    }
  });
});

describe("support evidence is runtime-owned and provider-proof", () => {
  it("gives a hostile provider no way to alter the support evidence", () => {
    const honest = evaluateObservation(buildObservationInput(), buildRuntimeDeps());

    // A provider that tries to assert full coverage and zero unknown tokens.
    const hostile = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: {
          providerId: "hostile-support",
          score() {
            return {
              status: "scored",
              scores: {
                scores: { family: "joint-logistic", tupleLogits: confidentLogits() },
                artifact: { ...buildArtifact() },
                support: {
                  featureCoverage: 1,
                  unknownTokenRatio: 0,
                  supportedTupleResolved: true,
                },
              },
            } as never;
          },
        },
      }),
    );
    // The hostile payload is refused outright rather than partially believed.
    expect(isFailedResult(hostile) && hostile.code).toBe("INTERNAL_ERROR");
    // And the honest path's support evidence came from the observation.
    expect(isHypothesisResult(honest)).toBe(true);
    if (!isHypothesisResult(honest)) {
      return;
    }
    expect(honest.hypothesis.support.unknownTokenRatioAvailable).toBe(false);
  });

  it("cannot be convinced to accept an unsupported object by any provider", () => {
    // Step 8 is pre-inference, so the provider is never even consulted.
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput({ semantics: { objectKindEvidence: ["other"] } }),
      buildRuntimeDeps({ provider }),
    );
    expect(provider.calls.count).toBe(0);
    expect(isHypothesisResult(result)).toBe(false);
  });

  it("derives identical support evidence regardless of which provider is used", () => {
    const supports = [
      createStubProvider(),
      createStubProvider({ artifact: buildArtifact() }),
      createStubProvider({ logits: confidentLogits(3) }),
    ].map((provider) => {
      const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps({ provider }));
      return isHypothesisResult(result) ? result.hypothesis.support : null;
    });
    expect(supports[0]).toEqual(supports[1]);
    expect(supports[1]).toEqual(supports[2]);
    expect(supports[0]).not.toBeNull();
  });
});

describe("every published result is deeply frozen and inert", () => {
  const scenarios: ReadonlyArray<readonly [string, () => unknown]> = [
    ["accepted hypothesis", () => evaluateObservation(buildObservationInput(), buildRuntimeDeps())],
    [
      "research-mode hypothesis",
      () => evaluateObservation(buildObservationInput(), buildRuntimeDeps({ researchMode: true })),
    ],
    [
      "epistemic abstention with diagnostics",
      () =>
        evaluateObservation(
          buildObservationInput({ semantics: { surfaceKind: "other" } }),
          buildRuntimeDeps({ researchMode: true }),
        ),
    ],
    [
      "pre-inference abstention",
      () =>
        evaluateObservation(
          buildObservationInput({ semantics: { objectKindEvidence: ["other"] } }),
          buildRuntimeDeps(),
        ),
    ],
    [
      "operational failure",
      () => evaluateObservation(buildObservationInput(), buildRuntimeDeps({ artifact: null })),
    ],
    ["schema failure", () => evaluateObservation({ bogus: true }, buildRuntimeDeps())],
  ];

  for (const [name, run] of scenarios) {
    it(`freezes every nested record of a ${name}`, () => {
      const result = run();
      expect(findUnfrozenPath(result)).toBeNull();
      expect(findNonInertPath(result)).toBeNull();
    });
  }

  it("detaches nested records so a later mutation cannot reach a published result", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ researchMode: true }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    for (const nested of [
      result.hypothesis.support,
      result.hypothesis.provenance,
      result.hypothesis.confidence,
      result.hypothesis.freshness,
      result.hypothesis.tuple,
      result.hypothesis.alternatives,
      result.diagnostics,
    ]) {
      expect(Object.isFrozen(nested)).toBe(true);
    }
    for (const alternative of result.hypothesis.alternatives) {
      expect(Object.isFrozen(alternative)).toBe(true);
      expect(Object.isFrozen(alternative.tuple)).toBe(true);
    }
  });

  it("freezes the failure detail of every operational path", () => {
    for (const deps of [
      buildRuntimeDeps({ artifact: null }),
      buildRuntimeDeps({ provider: createStubProvider({ throws: true }) }),
      buildRuntimeDeps({ clock: { nowMs: () => Number.NaN } }),
    ]) {
      const result = evaluateObservation(buildObservationInput(), deps);
      expect(isFailedResult(result)).toBe(true);
      if (!isFailedResult(result)) {
        continue;
      }
      expect(Object.isFrozen(result.detail)).toBe(true);
      expect(Object.keys(result.detail).sort()).toEqual(["measurement", "reason", "stage"]);
    }
  });
});

/**
 * The frozen mapping is the only place that decides what a support condition
 * produces. A second, hard-coded answer in the runtime is a latent contradiction:
 * it keeps working until the mapping changes, and then the two disagree silently.
 */
describe("the runtime consumes the centralized outcome mapping", () => {
  const RUNTIME_SOURCE = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8");

  it("names MODEL_VERSION_MISMATCH as the operational outcome of a feature policy mismatch", () => {
    expect(outcomeForSupportCheck("FEATURE_POLICY_MISMATCH")).toEqual({
      category: "operational",
      code: "MODEL_VERSION_MISMATCH",
    });
  });

  it("emits the code the mapping specifies for a feature policy divergence", () => {
    // The expectation is computed from the mapping rather than written as a
    // literal, so runtime behaviour is asserted against the single source of
    // truth instead of against a copy of it.
    const expected = outcomeForSupportCheck("FEATURE_POLICY_MISMATCH");
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact: buildArtifact({ featurePolicyVersion: "9.9" }) }),
    );
    expect(isFailedResult(result)).toBe(true);
    if (!isFailedResult(result) || expected.category !== "operational") {
      return;
    }
    expect(result.code).toBe(expected.code);
  });

  it("does not restate an operational code at either support-assessment site", () => {
    // Defence in depth for the two branches that an end-to-end test cannot reach:
    // the step-2 version check pre-empts the operational support condition, so
    // only source inspection can show those branches hold no duplicate literal.
    const sites = RUNTIME_SOURCE.split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.includes('"support-assessment"'));
    expect(sites.length).toBe(2);
    for (const { line, number } of sites) {
      for (const code of ["MODEL_VERSION_MISMATCH", "SCHEMA_INVALID", "MODEL_UNAVAILABLE"]) {
        expect(line.includes(`"${code}"`), `line ${number} restates ${code}`).toBe(false);
      }
    }
    expect(RUNTIME_SOURCE).toContain("outcome.code");
  });

  it("keeps every operational code in the mapping reachable only through the mapping", () => {
    const operational = FC008_SUPPORT_OUTCOME_MAPPING.filter(
      (entry) => entry.outcome.category === "operational",
    );
    expect(operational.length).toBeGreaterThan(0);
    for (const entry of operational) {
      expect(outcomeForSupportCheck(entry.code)).toEqual(entry.outcome);
    }
  });
});

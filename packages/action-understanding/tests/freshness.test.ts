import { describe, expect, it } from "vitest";
import {
  FRESHNESS_CHECKPOINTS,
  type FreshnessBinding,
  type FreshnessValidator,
  freshnessBindingsEqual,
  validateFreshnessBinding,
} from "../src/freshness.js";
import { isAbstainedResult, isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import {
  at,
  buildFreshness,
  buildObservationInput,
  buildRuntimeDeps,
  createStubFreshness,
  createStubProvider,
} from "./helpers.js";

type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;

// The binding is data. It holds no live handle to whatever determined currency.
type _NoObserver = AssertFalse<HasKey<FreshnessBinding, "observer">>;
type _NoElement = AssertFalse<HasKey<FreshnessBinding, "element">>;
type _NoDocument = AssertFalse<HasKey<FreshnessBinding, "document">>;
type _NoRefresh = AssertFalse<HasKey<FreshnessBinding, "refresh">>;
type _NoIsCurrent = AssertFalse<HasKey<FreshnessBinding, "isCurrent">>;

function expectInvalid(input: unknown): readonly string[] {
  const result = validateFreshnessBinding(input);
  expect(result.valid).toBe(false);
  return result.issues.map((i) => i.code);
}

describe("FreshnessBinding is immutable data", () => {
  it("declares exactly the two checkpoints the runtime evaluates", () => {
    expect(FRESHNESS_CHECKPOINTS).toEqual(["pre-inference", "post-inference"]);
  });

  it("returns a deeply frozen, fully inert binding", () => {
    const result = validateFreshnessBinding(buildFreshness());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(findUnfrozenPath(result.value)).toBeNull();
    expect(findNonInertPath(result.value)).toBeNull();
    expect(() => {
      (result.value as unknown as Record<string, number>).epoch = 99;
    }).toThrow(TypeError);
  });

  it("detaches from the caller's object", () => {
    const input = { ...buildFreshness() } as Record<string, unknown>;
    const result = validateFreshnessBinding(input);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    input.epoch = 99;
    expect(result.value.epoch).toBe(1);
  });

  it("rejects a non-integer, negative, or non-numeric counter", () => {
    for (const key of ["epoch", "observationSequence"]) {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
        expect(
          expectInvalid({ ...buildFreshness(), [key]: bad }).length,
          `${key}=${String(bad)}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("rejects a malformed capture timestamp", () => {
    for (const bad of ["", "yesterday", "2026-13-40T00:00:00.000Z", 0, null]) {
      expect(expectInvalid({ ...buildFreshness(), capturedAt: bad }).length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown keys and a live callback", () => {
    expect(expectInvalid({ ...buildFreshness(), isCurrent: () => true })).toContain(
      "FC008_UNKNOWN_KEY",
    );
    expect(expectInvalid({ ...buildFreshness(), observer: {} })).toContain("FC008_UNKNOWN_KEY");
  });

  it("rejects a missing version field, so a binding is always fully versioned", () => {
    for (const key of ["featurePolicyVersion", "supportMatrixVersion", "abstentionPolicyVersion"]) {
      const input = { ...buildFreshness() } as Record<string, unknown>;
      delete input[key];
      expect(expectInvalid(input)).toContain("FC008_MISSING_KEY");
    }
  });
});

describe("freshness binding equality", () => {
  it("treats identical bindings as equal regardless of key order", () => {
    const a = buildFreshness();
    const b = Object.fromEntries(Object.entries(buildFreshness()).reverse()) as FreshnessBinding;
    expect(freshnessBindingsEqual(a, b)).toBe(true);
  });

  it("treats any differing field as unequal", () => {
    const base = buildFreshness();
    const variants: Partial<FreshnessBinding>[] = [
      { epoch: 2 },
      { observationSequence: 2 },
      { capturedAt: "2026-10-04T06:00:00.000Z" as FreshnessBinding["capturedAt"] },
      { abstentionPolicyVersion: "other" },
    ];
    for (const patch of variants) {
      expect(freshnessBindingsEqual(base, buildFreshness(patch))).toBe(false);
    }
  });
});

describe("the runtime checks freshness at both checkpoints", () => {
  it("calls the validator twice on an otherwise accepted path", () => {
    const freshness = createStubFreshness([true, true]);
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: freshness }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    expect(freshness.calls.count).toBe(FRESHNESS_CHECKPOINTS.length);
  });

  it("abstains at the pre-inference checkpoint without invoking the provider", () => {
    const freshness = createStubFreshness([false, true]);
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: freshness, provider }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
    expect(provider.calls.count).toBe(0);
    expect(freshness.calls.count).toBe(1);
  });

  it("abstains at the post-inference checkpoint after the provider has run", () => {
    const freshness = createStubFreshness([true, false]);
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: freshness, provider }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
    expect(provider.calls.count).toBe(1);
    expect(freshness.calls.count).toBe(2);
  });

  it("passes the binding and the input fingerprint to the validator", () => {
    const seen: { binding: unknown; fingerprint: unknown }[] = [];
    const validator: FreshnessValidator = {
      isCurrent(binding, inputFingerprint) {
        seen.push({ binding, fingerprint: inputFingerprint });
        return true;
      },
    };
    evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: validator }),
    );
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect((call.binding as FreshnessBinding).epoch).toBe(1);
      expect(String(call.fingerprint).startsWith("FP1|")).toBe(true);
    }
    // Both checkpoints see the identical immutable binding.
    expect(at(seen, 0).binding).toBe(at(seen, 1).binding);
  });

  it("treats a validator that throws as an operational defect", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        freshnessValidator: {
          isCurrent() {
            throw new Error("state authority failed");
          },
        },
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });

  it("echoes the binding onto an accepted hypothesis so a consumer can re-verify", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(freshnessBindingsEqual(result.hypothesis.freshness, buildFreshness())).toBe(true);
    expect(Object.isFrozen(result.hypothesis.freshness)).toBe(true);
  });
});

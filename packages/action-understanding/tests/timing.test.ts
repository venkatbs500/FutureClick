/**
 * Timeout enforcement and measured latency (AI-6, AI-8, AI-20).
 *
 * Timing is driven by an injected deterministic clock, so every assertion here
 * is exactly reproducible and none of it depends on wall-clock speed.
 */

import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import { isAbstainedResult, isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { validateAbstentionPolicy } from "../src/policy.js";
import { InferenceDeadline, type RuntimeClock, createScriptedClock } from "../src/timing.js";
import {
  buildObservationInput,
  buildPolicy,
  buildPolicyInput,
  buildRuntimeDeps,
  createStubProvider,
} from "./helpers.js";

describe("the injected clock is the only time source", () => {
  it("imports no platform clock, so the package stays platform-neutral", async () => {
    // `lib: ["ES2022"]` already makes DOM types unnameable. This additionally
    // records that no Node or browser timing API is referenced by name.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/timing.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const forbidden of [
      "performance.now",
      "node:perf_hooks",
      "Date.now",
      "new Date",
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
      "process.hrtime",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("holds the final scripted reading once the sequence is exhausted", () => {
    const clock = createScriptedClock([5, 7]);
    expect([clock.nowMs(), clock.nowMs(), clock.nowMs(), clock.nowMs()]).toEqual([5, 7, 7, 7]);
  });
});

describe("InferenceDeadline refuses to open on an invalid budget", () => {
  const clock = createScriptedClock([0]);

  it("rejects a non-positive, fractional, or non-integer timeout", () => {
    for (const timeout of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(InferenceDeadline.open(clock, timeout)).toBeNull();
    }
  });

  it("rejects a timeout above the absolute ceiling", () => {
    const ceiling = FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs;
    expect(InferenceDeadline.open(createScriptedClock([0]), ceiling)).not.toBeNull();
    expect(InferenceDeadline.open(createScriptedClock([0]), ceiling + 1)).toBeNull();
  });

  it("rejects a clock that throws or returns an unusable reading", () => {
    const throwing: RuntimeClock = {
      nowMs() {
        throw new Error("no clock");
      },
    };
    expect(InferenceDeadline.open(throwing, 50)).toBeNull();

    for (const bad of [Number.NaN, -1, "0" as unknown as number]) {
      expect(InferenceDeadline.open({ nowMs: () => bad }, 50)).toBeNull();
    }
  });
});

describe("InferenceDeadline measures elapsed time and the budget boundary", () => {
  it("accepts a span that finishes one millisecond inside the budget", () => {
    // budget - 1. Stated as its own case rather than inferred from a general
    // inside-budget span, so the three adjacent integers around the boundary are
    // each pinned: budget - 1, budget, budget + 1.
    const deadline = InferenceDeadline.open(createScriptedClock([100, 149]), 50);
    expect(deadline?.elapsed()).toEqual({ ok: true, elapsedMs: 49, deadlineExceeded: false });
  });

  it("decides the whole boundary neighbourhood by a strictly-greater comparison", () => {
    // The budget is inclusive: deadlineExceeded is elapsedMs > timeoutMs. Driving
    // all three cases from one table makes the operator itself the subject of the
    // test, so flipping it to >= cannot pass.
    const timeoutMs = 50;
    const cases = [
      { elapsedMs: timeoutMs - 1, deadlineExceeded: false },
      { elapsedMs: timeoutMs, deadlineExceeded: false },
      { elapsedMs: timeoutMs + 1, deadlineExceeded: true },
    ];
    for (const { elapsedMs, deadlineExceeded } of cases) {
      const deadline = InferenceDeadline.open(
        createScriptedClock([100, 100 + elapsedMs]),
        timeoutMs,
      );
      expect(deadline?.elapsed(), `elapsed ${elapsedMs}`).toEqual({
        ok: true,
        elapsedMs,
        deadlineExceeded,
      });
    }
  });

  it("accepts a span that finishes exactly on the budget", () => {
    const deadline = InferenceDeadline.open(createScriptedClock([100, 150]), 50);
    expect(deadline).not.toBeNull();
    const elapsed = deadline?.elapsed();
    expect(elapsed).toEqual({ ok: true, elapsedMs: 50, deadlineExceeded: false });
  });

  it("marks a span one millisecond over the budget as exceeded", () => {
    const deadline = InferenceDeadline.open(createScriptedClock([100, 151]), 50);
    expect(deadline?.elapsed()).toEqual({ ok: true, elapsedMs: 51, deadlineExceeded: true });
  });

  it("fails closed when the clock runs backwards", () => {
    const deadline = InferenceDeadline.open(createScriptedClock([100, 90]), 50);
    expect(deadline?.elapsed()).toEqual({ ok: false, reason: "clock-invalid" });
  });

  it("fails closed when the clock throws mid-span", () => {
    let call = 0;
    const flaky: RuntimeClock = {
      nowMs() {
        call += 1;
        if (call > 1) {
          throw new Error("clock died");
        }
        return 0;
      },
    };
    const deadline = InferenceDeadline.open(flaky, 50);
    expect(deadline?.elapsed()).toEqual({ ok: false, reason: "clock-invalid" });
  });
});

describe("the runtime enforces the policy inference timeout", () => {
  it("applies the inclusive budget at the runtime boundary too", () => {
    // budget - 1 and budget both reach a decision; budget + 1 does not. The
    // scripted clock holds its final reading, so every later elapsed() call in
    // the run observes the same elapsed value and the boundary is exact.
    const timeoutMs = 50;
    for (const elapsedMs of [timeoutMs - 1, timeoutMs]) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          policy: buildPolicy({ inferenceTimeoutMs: timeoutMs }),
          clock: createScriptedClock([0, elapsedMs]),
        }),
      );
      expect(isFailedResult(result), `elapsed ${elapsedMs}`).toBe(false);
      expect(isHypothesisResult(result), `elapsed ${elapsedMs}`).toBe(true);
    }

    const overrun = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: timeoutMs }),
        clock: createScriptedClock([0, timeoutMs + 1]),
      }),
    );
    expect(isFailedResult(overrun) && overrun.code).toBe("MODEL_TIMEOUT");
  });

  it("returns MODEL_TIMEOUT when the provider overruns the budget", () => {
    // Policy budget is 50ms; the clock reports 60ms elapsed after scoring.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 50 }),
        clock: createScriptedClock([0, 60]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
  });

  it("discards an over-budget score instead of accepting it", () => {
    // The provider returns a perfectly confident score, yet no hypothesis is
    // produced: an over-budget result cannot reach a decision.
    const provider = createStubProvider();
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider,
        policy: buildPolicy({ inferenceTimeoutMs: 10 }),
        clock: createScriptedClock([0, 11]),
      }),
    );
    expect(provider.calls.count).toBe(1);
    expect(isHypothesisResult(result)).toBe(false);
    expect(isAbstainedResult(result)).toBe(false);
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
  });

  it("records the overrun as an operational timeout, never as an abstention", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 20 }),
        clock: createScriptedClock([0, 100]),
      }),
    );
    expect(isFailedResult(result)).toBe(true);
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("provider");
    expect(result.detail.reason).toBe("deadline-exceeded");
    expect(result.detail.measurement).toBe(100);
  });

  it("times out when calibration pushes the total over the budget", () => {
    // Scoring finishes inside the budget; calibration does not.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 30 }),
        clock: createScriptedClock([0, 10, 45]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("calibration");
  });

  it("accepts a result that completes inside the budget", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 50 }),
        clock: createScriptedClock([0, 10, 20]),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
  });

  it("fails closed when the clock is unusable rather than skipping the timeout", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ clock: { nowMs: () => Number.NaN } }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.reason).toBe("clock-invalid");
  });
});

describe("a timeout above 250ms is impossible to configure", () => {
  it("caps the absolute ceiling at 250ms", () => {
    expect(FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs).toBe(250);
  });

  it("rejects a policy whose timeout exceeds the ceiling", () => {
    const ceiling = FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs;
    expect(validateAbstentionPolicy(buildPolicyInput({ inferenceTimeoutMs: ceiling })).valid).toBe(
      true,
    );
    for (const timeout of [ceiling + 1, 1_000, 60_000]) {
      const result = validateAbstentionPolicy(buildPolicyInput({ inferenceTimeoutMs: timeout }));
      expect(result.valid).toBe(false);
      if (result.valid) {
        return;
      }
      expect(result.issues.map((i) => i.code)).toContain("FC008_BOUND_EXCEEDED");
    }
  });

  it("gives a provider no means of altering the budget", () => {
    // The scoring context carries versions only, so there is no field through
    // which a provider could read, extend, or replace the deadline.
    let seenKeys: readonly string[] = [];
    evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: {
          providerId: "budget-prober",
          score(_semantics, context) {
            seenKeys = Object.keys(context);
            return { status: "unavailable", detail: "not-implemented" };
          },
        },
      }),
    );
    expect([...seenKeys].sort()).toEqual(["featurePolicyVersion", "supportMatrixVersion"]);
    for (const key of ["timeoutMs", "inferenceTimeoutMs", "deadline", "budget", "clock"]) {
      expect(seenKeys).not.toContain(key);
    }
  });
});

describe("latency is measured, never hard-coded", () => {
  it("reports the elapsed time the clock actually described", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        researchMode: true,
        policy: buildPolicy({ inferenceTimeoutMs: 200 }),
        clock: createScriptedClock([1_000, 1_007, 1_013]),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    // 1013 - 1000, measured from the injected monotonic clock.
    expect(result.diagnostics?.latencyMs).toBe(13);
  });

  it("reports a different latency for a different clock, so it is not a constant", () => {
    const latencies = [
      [0, 1, 2],
      [0, 5, 40],
      [500, 505, 530],
    ].map((readings) => {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          researchMode: true,
          policy: buildPolicy({ inferenceTimeoutMs: 200 }),
          clock: createScriptedClock(readings),
        }),
      );
      return isHypothesisResult(result) ? result.diagnostics?.latencyMs : null;
    });
    expect(latencies).toEqual([2, 40, 30]);
    expect(latencies).not.toContain(0);
  });

  it("reports a zero latency only when the clock genuinely did not advance", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ researchMode: true, clock: createScriptedClock([42]) }),
    );
    expect(isHypothesisResult(result) && result.diagnostics?.latencyMs).toBe(0);
  });
});

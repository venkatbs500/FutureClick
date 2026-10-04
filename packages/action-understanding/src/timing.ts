/**
 * FC-008 Sprint 1 — platform-neutral monotonic timing.
 *
 * The runtime must enforce `AbstentionPolicy.inferenceTimeoutMs` and must report
 * a measured latency rather than a hard-coded zero. It must do so without
 * importing `performance`, `Date`, `node:perf_hooks`, or any browser API,
 * because this package compiles with `lib: ["ES2022"]` and is used by both a
 * browser bundle and a Node test process.
 *
 * So the clock is injected. The runtime reads elapsed time only through
 * `RuntimeClock`, and the tests supply a deterministic fake so that timeout and
 * latency behaviour is exactly reproducible rather than wall-clock dependent.
 *
 * HONEST LIMITATION
 *
 * `ScoringProvider.score` is synchronous, and JavaScript cannot preempt
 * synchronous code. No wrapper can interrupt a provider mid-computation, so the
 * enforcement here is a DEADLINE CHECK: the runtime measures the elapsed time
 * across the provider call and across calibration, and if the deadline was
 * exceeded it discards the work and returns `MODEL_TIMEOUT`. An over-budget
 * score therefore cannot reach a decision, which is the property that matters,
 * but the work is not cancelled.
 *
 * Wrapping a synchronous provider in a promise race would look like
 * cancellation while delivering none, so it is deliberately not done. When the
 * provider boundary becomes asynchronous for browser integration, true
 * cancellation attaches to this same interface without changing its callers.
 */

import { FC008_SAFETY_CAPS } from "./bounds.js";

/**
 * Monotonic millisecond clock.
 *
 * `nowMs` must be non-decreasing. A clock that goes backwards, returns a
 * non-finite value, or returns a non-number is treated as a runtime defect and
 * fails closed; it is never allowed to produce a negative latency or to mask a
 * timeout.
 */
export interface RuntimeClock {
  nowMs(): number;
}

export type ElapsedResult =
  | { readonly ok: true; readonly elapsedMs: number; readonly deadlineExceeded: boolean }
  | { readonly ok: false; readonly reason: "clock-invalid" };

/** True when a reading is usable as a monotonic millisecond value. */
function isUsableReading(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * A single timed span, opened before the work and closed after it.
 *
 * Holds the start reading and the deadline so that neither can be recomputed
 * from a later clock reading, and so that a provider — which never receives the
 * span — cannot move the deadline.
 */
export class InferenceDeadline {
  private readonly startedAt: number;

  private constructor(
    private readonly clock: RuntimeClock,
    startedAt: number,
    readonly timeoutMs: number,
  ) {
    this.startedAt = startedAt;
  }

  /**
   * Opens a span. Returns null when the clock is unusable or the timeout is not
   * a valid policy value, so the caller fails closed instead of timing nothing.
   */
  static open(clock: RuntimeClock, timeoutMs: number): InferenceDeadline | null {
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs
    ) {
      return null;
    }
    let startedAt: unknown;
    try {
      startedAt = clock.nowMs();
    } catch {
      return null;
    }
    if (!isUsableReading(startedAt)) {
      return null;
    }
    return new InferenceDeadline(clock, startedAt, timeoutMs);
  }

  /**
   * Reads elapsed time and whether the deadline has passed.
   *
   * The comparison is `elapsedMs > timeoutMs`: STRICTLY GREATER. The budget is
   * therefore inclusive, and the three adjacent cases are:
   *
   * - `elapsedMs === timeoutMs - 1`  within budget, accepted
   * - `elapsedMs === timeoutMs`      exactly on budget, accepted
   * - `elapsedMs === timeoutMs + 1`  over budget, exceeded
   *
   * Inclusive is the honest reading of "a budget of N milliseconds": work that
   * finishes at exactly N has not overrun it. All three cases are tested
   * explicitly so the operator cannot be changed without a test failing.
   */
  elapsed(): ElapsedResult {
    let now: unknown;
    try {
      now = this.clock.nowMs();
    } catch {
      return { ok: false, reason: "clock-invalid" };
    }
    if (!isUsableReading(now) || now < this.startedAt) {
      return { ok: false, reason: "clock-invalid" };
    }
    const elapsedMs = now - this.startedAt;
    return { ok: true, elapsedMs, deadlineExceeded: elapsedMs > this.timeoutMs };
  }
}

/**
 * Deterministic clock driven by an explicit sequence of readings.
 *
 * Exported from `src` rather than confined to tests because it is the only
 * clock Sprint 1 ships: there is no production integration yet, and a caller
 * that needs real time supplies its own platform clock. Exhausting the sequence
 * holds the final reading, so a caller cannot accidentally depend on how many
 * times the runtime reads the clock.
 */
export function createScriptedClock(readings: readonly number[]): RuntimeClock {
  let index = 0;
  const sequence = readings.length > 0 ? readings : [0];
  return {
    nowMs(): number {
      const value = sequence[Math.min(index, sequence.length - 1)] as number;
      index += 1;
      return value;
    },
  };
}

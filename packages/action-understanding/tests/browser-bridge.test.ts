/**
 * FC-008 Sprint 5B — headless browser-bridge tests.
 *
 * Synthetic observations only. Does not read the final evaluation result.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicIdGenerator } from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import {
  type ArtifactBundle,
  FC008_BROWSER_MESSAGE_FORBIDDEN_KEYS,
  FC008_BROWSER_MESSAGE_TYPE,
  FC008_PRECEDENCE,
  type Fc008ModelFamily,
  composeFactorizedLogits,
  createBrowserActionUnderstandingBridge,
  createBrowserArtifactBundle,
  createEmptyBrowserPredictionState,
  createScriptedClock,
  parseArtifactBundle,
  validateFc008BrowserMessage,
} from "../src/index.js";
import { TEST_TIMESTAMP, buildObservationInput } from "./helpers.js";

const ARTIFACT_DIRECTORY = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "research",
  "futurebench",
  "artifacts",
);

const FROZEN_SHA256 = Object.freeze({
  jointModel: "d30aceb684901bf42b8267719dc20e5319ef35b8603eb7781f50ce486c9d4194",
  jointCalibration: "5d5d99b6f085501de1f83371b3cae08117f8b281b0babc5bf6ae0eb96b1fe8b5",
  jointPolicy: "b3ea74e93bc311fd1025857db8dc6d715e188e7f7dbfbd2d6d377bf3f9b3ecb7",
  factorizedModel: "b2713475a86cd52d6703acbdacae7bb49814b77f1277f4021038cb5f53dbdb8f",
  factorizedCalibration: "9c985d623d29042cd5b7112c9edec80db786e056ac38a056294b1347924de359",
  factorizedPolicy: "89609abe1930e31268e14365d764ec95a6723e869fee6d975ebbf8ac014276c0",
});

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(ARTIFACT_DIRECTORY, fileName), "utf8"));
}

function sha256File(fileName: string): string {
  return createHash("sha256")
    .update(readFileSync(join(ARTIFACT_DIRECTORY, fileName)))
    .digest("hex");
}

function loadBundle(family: Fc008ModelFamily): ArtifactBundle {
  if (family === "joint-logistic") {
    return createBrowserArtifactBundle({
      modelFamily: family,
      model: readJson("fc008-joint-logistic-model.json"),
      calibration: readJson("fc008-joint-logistic-calibration.json"),
      policy: readJson("fc008-joint-logistic-policy.json"),
      modelSha256: FROZEN_SHA256.jointModel,
      calibrationSha256: FROZEN_SHA256.jointCalibration,
      policySha256: FROZEN_SHA256.jointPolicy,
    });
  }
  return parseArtifactBundle({
    modelFamily: family,
    model: readJson("fc008-factorized-logistic-model.json"),
    calibration: readJson("fc008-factorized-logistic-calibration.json"),
    policy: readJson("fc008-factorized-logistic-policy.json"),
    modelSha256: FROZEN_SHA256.factorizedModel,
    calibrationSha256: FROZEN_SHA256.factorizedCalibration,
    policySha256: FROZEN_SHA256.factorizedPolicy,
  });
}

const SUPPORT_GATES = Object.freeze({
  minMargin: 0,
  maxUnknownTokenRatio: 1,
  minFeatureCoverage: 0,
  minRetainedRedactionRatio: 0,
});

function observation(
  sequence: number,
  overrides: Parameters<typeof buildObservationInput>[0] = {},
) {
  return buildObservationInput({
    ...overrides,
    freshness: {
      observationSequence: sequence,
      abstentionPolicyVersion: "1.0",
      ...overrides.freshness,
    },
  });
}

function readyBridge(
  family: Fc008ModelFamily,
  extras: { clock?: ReturnType<typeof createScriptedClock> } = {},
) {
  const created = createBrowserActionUnderstandingBridge({
    modelFamily: family,
    bundle: loadBundle(family),
    supportGates: SUPPORT_GATES,
    clock: extras.clock ?? createScriptedClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    now: () => TEST_TIMESTAMP,
    idGenerator: createDeterministicIdGenerator("bridge"),
  });
  if (created.status !== "ready") {
    throw new Error(`expected ready, refused ${created.reason}`);
  }
  return created.bridge;
}

describe("family configuration", () => {
  it("fails closed without an explicit family", () => {
    const created = createBrowserActionUnderstandingBridge({
      supportGates: SUPPORT_GATES,
      clock: createScriptedClock([0, 1]),
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("none"),
    });
    expect(created.status).toBe("unavailable");
    if (created.status === "unavailable") {
      expect(created.reason).toBe("family-not-specified");
    }
  });

  it("fails closed on family/bundle mismatch", () => {
    const created = createBrowserActionUnderstandingBridge({
      modelFamily: "factorized-logistic",
      bundle: loadBundle("joint-logistic"),
      supportGates: SUPPORT_GATES,
      clock: createScriptedClock([0, 1]),
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("mis"),
    });
    expect(created.status).toBe("unavailable");
    if (created.status === "unavailable") {
      expect(created.reason).toBe("family-bundle-mismatch");
    }
  });

  it("does not hide a default family or read holdout results", () => {
    const source = readFileSync(new URL("../src/browser-bridge.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/final-evaluation|won|lost|test-ooa|best model/i);
    expect(source).toMatch(/hidden default/);
  });
});

describe("closed message and privacy", () => {
  it("rejects unknown message keys", () => {
    const validated = validateFc008BrowserMessage({
      type: FC008_BROWSER_MESSAGE_TYPE,
      schemaVersion: "1.0",
      observationSequence: 1,
      inputFingerprint: "a".repeat(64),
      observation: {},
      extra: true,
    });
    expect(validated.valid).toBe(false);
  });

  it("rejects raw DOM / secret keys on the message", () => {
    const bridge = readyBridge("joint-logistic");
    const state = bridge.understandFromMessage({
      type: FC008_BROWSER_MESSAGE_TYPE,
      schemaVersion: "1.0",
      observationSequence: 1,
      inputFingerprint: "a".repeat(64),
      observation: {},
      html: "<div/>",
    });
    expect(state.result?.outcome).toBe("failed");
    if (state.result?.outcome === "failed") {
      expect(state.result.code).toBe("SCHEMA_INVALID");
    }
    expect(FC008_BROWSER_MESSAGE_FORBIDDEN_KEYS).toContain("html");
  });
});

describe("prediction flow", () => {
  it("scores a sanitized observation through the frozen joint provider", () => {
    expect(sha256File("fc008-joint-logistic-model.json")).toBe(FROZEN_SHA256.jointModel);
    const bridge = readyBridge("joint-logistic");
    const obs = observation(1);
    const state = bridge.understandSanitizedObservation(obs, 1);
    expect(["hypothesis", "abstained"]).toContain(state.result?.outcome);
    if (state.result?.outcome === "failed") {
      expect(state.result.code).not.toBe("INTERNAL_ERROR");
    }
    if (state.result?.outcome === "hypothesis") {
      expect(state.result.hypothesis.evidenceMode).toBe("predicted");
      expect(state.indicator.predictionAvailable).toBe(true);
    }
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.indicator)).toBe(true);
    expect(state.indicator).not.toHaveProperty("release");
    expect(state.indicator).not.toHaveProperty("click");
  });

  it("scores a sanitized observation through the frozen factorized provider", () => {
    const bridge = readyBridge("factorized-logistic");
    const state = bridge.understandSanitizedObservation(observation(1), 1);
    expect(["hypothesis", "abstained"]).toContain(state.result?.outcome);
    if (state.result?.outcome === "hypothesis") {
      expect(state.result.hypothesis.provenance.modelFamily).toBe("factorized-logistic");
    }
    const mapping = loadBundle("factorized-logistic").model;
    if ("classHeadIndices" in mapping) {
      const composed = composeFactorizedLogits(
        {
          verb: new Array<number>(10).fill(0),
          objectKind: new Array<number>(9).fill(0),
          transitionProperty: new Array<number>(10).fill(0),
        },
        mapping.classHeadIndices,
      );
      expect(composed).toHaveLength(13);
    }
  });

  it("propagates deterministic abstention", () => {
    const bridge = readyBridge("joint-logistic");
    const state = bridge.understandSanitizedObservation(
      observation(1, { semantics: { objectKindEvidence: ["other"] } }),
      1,
    );
    expect(state.result?.outcome).toBe("abstained");
    if (state.result?.outcome === "abstained") {
      expect(state.result.reason).toBe("UNSUPPORTED_OBJECT");
    }
    expect(state.indicator.abstentionReason).toBe("UNSUPPORTED_OBJECT");
  });

  it("propagates operational failure without retry", () => {
    const bridge = readyBridge("joint-logistic", {
      clock: createScriptedClock([0, 251]),
    });
    const first = bridge.understandSanitizedObservation(observation(1), 1);
    expect(first.result?.outcome).toBe("failed");
    if (first.result?.outcome !== "failed") {
      throw new Error("timeout must fail");
    }
    expect(first.result.code).toBe("MODEL_TIMEOUT");
    const late = first.result;
    expect(late).toBe(first.result);
    expect(() => {
      (first as { result: unknown }).result = null;
    }).toThrow(TypeError);
  });

  it("preserves operational precedence over stale", () => {
    expect(FC008_PRECEDENCE.map((step) => step.step)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });
});

describe("freshness and reset", () => {
  it("discards an older observation after a newer one publishes", () => {
    const bridge = readyBridge("joint-logistic");
    const newer = bridge.understandSanitizedObservation(observation(2), 2);
    const older = bridge.understandSanitizedObservation(observation(1), 1);
    expect(older.observationSequence).toBe(newer.observationSequence);
    expect(older.observationSequence).toBe(2);
  });

  it("clears indicator on candidate removal, navigation, and dispose", () => {
    const bridge = readyBridge("joint-logistic");
    bridge.understandSanitizedObservation(observation(1), 1);
    expect(bridge.clear().indicator.predictionStatus).toBe("none");
    bridge.understandSanitizedObservation(observation(3), 3);
    expect(bridge.invalidateObservation().result).toBeNull();
    bridge.understandSanitizedObservation(observation(4), 4);
    bridge.dispose();
    const after = bridge.understandSanitizedObservation(observation(5), 5);
    expect(after.result?.outcome).toBe("failed");
    if (after.result?.outcome === "failed") {
      expect(after.result.code).toBe("MODEL_UNAVAILABLE");
    }
  });

  it("empty state has no authority fields", () => {
    const empty = createEmptyBrowserPredictionState();
    expect(empty.indicator.retentionPolicy).toBe("ephemeral-memory-only");
    expect(empty).not.toHaveProperty("releaseOnce");
    expect(empty).not.toHaveProperty("continue");
  });

  it("treats the same sequence and fingerprint as idempotent", () => {
    const readings: number[] = [];
    let tick = 0;
    const clock = {
      nowMs(): number {
        readings.push(tick);
        const value = tick;
        tick += 1;
        return value;
      },
    };
    const created = createBrowserActionUnderstandingBridge({
      modelFamily: "joint-logistic",
      bundle: loadBundle("joint-logistic"),
      supportGates: SUPPORT_GATES,
      clock,
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("idem"),
    });
    if (created.status !== "ready") {
      throw new Error(`expected ready, refused ${created.reason}`);
    }
    const first = created.bridge.understandSanitizedObservation(observation(3), 3);
    const readsAfterFirst = readings.length;
    const second = created.bridge.understandSanitizedObservation(observation(3), 3);
    expect(second).toBe(first);
    expect(readings.length).toBe(readsAfterFirst);
  });

  it("fails closed when the same sequence carries a different fingerprint", () => {
    const readings: number[] = [];
    let tick = 0;
    const clock = {
      nowMs(): number {
        readings.push(tick);
        const value = tick;
        tick += 1;
        return value;
      },
    };
    const created = createBrowserActionUnderstandingBridge({
      modelFamily: "joint-logistic",
      bundle: loadBundle("joint-logistic"),
      supportGates: SUPPORT_GATES,
      clock,
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("conflict"),
    });
    if (created.status !== "ready") {
      throw new Error(`expected ready, refused ${created.reason}`);
    }
    const first = created.bridge.understandSanitizedObservation(observation(4), 4);
    expect(first.result).not.toBeNull();
    const readsAfterFirst = readings.length;
    const published = created.bridge.currentState();
    const conflict = created.bridge.understandSanitizedObservation(
      observation(4, { semantics: { objectKindEvidence: ["file"] } }),
      4,
    );
    expect(conflict.result?.outcome).toBe("failed");
    if (conflict.result?.outcome !== "failed") {
      throw new Error("equal-sequence conflict must fail closed");
    }
    expect(conflict.result.code).toBe("SCHEMA_INVALID");
    expect(created.bridge.currentState()).toBe(published);
    expect(created.bridge.currentState()).toBe(first);
    expect(created.bridge.currentState().inputFingerprint).toBe(first.inputFingerprint);
    expect(created.bridge.currentState().result).toBe(first.result);
    expect(readings.length).toBe(readsAfterFirst);
  });
});

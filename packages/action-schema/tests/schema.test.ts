import { createDeterministicIdGenerator, currentIsoTimestamp } from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import type {
  ActionConsequence,
  ActionId,
  ConsequenceId,
  EnvironmentState,
  EvidenceId,
  ProposedAction,
  StateId,
  TargetId,
} from "../src/index.js";
import { createConfidenceScore, isValidConfidenceScore } from "../src/index.js";

describe("action-schema/types", () => {
  it("validates confidence scores within [0.0, 1.0]", () => {
    expect(isValidConfidenceScore(0.0)).toBe(true);
    expect(isValidConfidenceScore(0.85)).toBe(true);
    expect(isValidConfidenceScore(1.0)).toBe(true);
    expect(isValidConfidenceScore(-0.1)).toBe(false);
    expect(isValidConfidenceScore(1.05)).toBe(false);
    expect(isValidConfidenceScore(Number.NaN)).toBe(false);
    expect(isValidConfidenceScore(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidConfidenceScore(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isValidConfidenceScore("0.5")).toBe(false);
    expect(isValidConfidenceScore(null)).toBe(false);
  });

  it("safely constructs ConfidenceScore or throws RangeError on invalid values", () => {
    expect(createConfidenceScore(0.0)).toBe(0.0);
    expect(createConfidenceScore(0.5)).toBe(0.5);
    expect(createConfidenceScore(1.0)).toBe(1.0);

    expect(() => createConfidenceScore(-0.01)).toThrow(RangeError);
    expect(() => createConfidenceScore(1.01)).toThrow(RangeError);
    expect(() => createConfidenceScore(Number.NaN)).toThrow(RangeError);
    expect(() => createConfidenceScore(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("constructs type-checked schema objects adhering to contract", () => {
    const idGen = createDeterministicIdGenerator("schema-test");
    const stateId = idGen.generate<"StateId">("state");
    const actionId = idGen.generate<"ActionId">("act");
    const targetId = idGen.generate<"TargetId">("tgt");
    const consequenceId = idGen.generate<"ConsequenceId">("csq");
    const evidenceId = idGen.generate<"EvidenceId">("ev");
    const ts = currentIsoTimestamp();

    const state: EnvironmentState = {
      id: stateId,
      timestamp: ts,
      platform: "browser",
      applicationName: "CloudStorageApp",
    };

    const action: ProposedAction = {
      id: actionId,
      category: "delete",
      target: {
        id: targetId,
        kind: "button",
        label: "Delete Project",
      },
      timestamp: ts,
      stateId: state.id,
    };

    const consequence: ActionConsequence = {
      id: consequenceId,
      actionId: action.id,
      kind: "verified",
      summary: "Permanently removes cloud project and all associated datasets",
      reversibility: "irreversible",
      confidence: createConfidenceScore(1.0),
      evidence: [
        {
          id: evidenceId,
          source: "deterministic_rule",
          summary: "API contract specifies immediate, non-recoverable deletion",
        },
      ],
      provenance: {
        engineVersion: "0.1.0",
        evaluationTimestamp: ts,
        deterministic: true,
      },
    };

    expect(state.platform).toBe("browser");
    expect(action.category).toBe("delete");
    expect(consequence.kind).toBe("verified");
    expect(consequence.reversibility).toBe("irreversible");
    expect(consequence.confidence).toBe(1.0);
  });
});

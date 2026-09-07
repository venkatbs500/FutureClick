import { createDeterministicIdGenerator, currentIsoTimestamp } from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import type {
  ActionId,
  Consequence,
  ConsequenceId,
  EntityId,
  EvidenceId,
  ProposedAction,
  StateSnapshot,
  StateSnapshotId,
} from "../src/index.js";
import {
  FUTURECLICK_SCHEMA_VERSION,
  createConfidenceScore,
  isValidConfidenceScore,
} from "../src/index.js";

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

  it("constructs type-checked canonical schema objects adhering to contract", () => {
    const idGen = createDeterministicIdGenerator("schema-test");
    const stateId = idGen.generate<"StateSnapshotId">("state");
    const actionId = idGen.generate<"ActionId">("act");
    const targetEntityId = idGen.generate<"EntityId">("ent");
    const consequenceId = idGen.generate<"ConsequenceId">("csq");
    const evidenceId = idGen.generate<"EvidenceId">("ev");
    const ts = currentIsoTimestamp();

    const env = {
      environmentId: "env-cloud",
      kind: "service" as const,
      platform: "web" as const,
      application: { name: "CloudStorageApp" },
    };

    const state: StateSnapshot = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: stateId,
      observedAt: ts,
      environment: env,
      entities: [
        {
          id: targetEntityId,
          kind: "resource",
          label: "Cloud Project",
        },
      ],
      facts: [],
    };

    const action: ProposedAction = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: actionId,
      proposedAt: ts,
      environment: env,
      actor: { kind: "human", id: "user-123" },
      intent: { verb: "delete", domain: "cloud" },
      targets: [{ entityId: targetEntityId, role: "primary" }],
      parameters: { permanent: true },
      executionStatus: "proposed",
    };

    const consequence: Consequence = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: consequenceId,
      actionId: action.id,
      kind: "data-loss",
      summary: "Permanently removes cloud project and all associated datasets",
      affectedEntities: [targetEntityId],
      stateChanges: [],
      reversibility: { level: "irreversible" },
      risk: { severity: "high", categories: ["data-loss"] },
      confidence: createConfidenceScore(1.0),
      evidence: [
        {
          id: evidenceId,
          mode: "verified",
          source: "rule",
          observedAt: ts,
          scope: "cloud-deletion-api",
          assumptions: [],
          summary: "API contract specifies immediate, non-recoverable deletion",
        },
      ],
      temporal: { timing: "immediate", frequency: "once" },
    };

    expect(state.environment.platform).toBe("web");
    expect(action.intent.verb).toBe("delete");
    expect(consequence.kind).toBe("data-loss");
    expect(consequence.reversibility.level).toBe("irreversible");
    expect(consequence.confidence).toBe(1.0);
  });
});

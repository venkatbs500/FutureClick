/**
 * ConsequenceEngine tests verifying canonical ActionEvaluationContext orchestration,
 * authoritative input validation, ConsequenceAssessment envelope binding, exception safety,
 * evaluator call count guarantees on invalid input, and validated snapshot delivery.
 */

import {
  type ActionEvaluationContext,
  type ActionId,
  type Consequence,
  type EntityId,
  createActionEvaluationContext,
  createCanonicalEntity,
  createConfidenceScore,
  createConsequence,
  createProposedAction,
  createStateSnapshot,
} from "@futureclick/action-schema";
import {
  createDeterministicIdGenerator,
  err,
  isErr,
  isOk,
  type IsoTimestamp,
  ok,
  unwrapResult,
} from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import { ConsequenceEngine, type IConsequenceEvaluator } from "../src/index.js";

const testIdGen = createDeterministicIdGenerator("engine-test");

function createValidContext(): ActionEvaluationContext {
  const env = {
    environmentId: "env-test-1",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { id: "app-test", name: "TestApp", version: "1.0.0" },
  };

  const fileEntity = createCanonicalEntity({
    id: testIdGen.generate<"EntityId">("ent"),
    kind: "file",
    label: "test.txt",
  });

  const state = createStateSnapshot({
    environment: env,
    entities: [fileEntity],
    observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
  });

  const action = createProposedAction({
    environment: env,
    proposedAt: "2026-09-06T20:00:01.000Z" as IsoTimestamp,
    actor: { kind: "human", id: "user-1" },
    intent: { verb: "delete", domain: "filesystem" },
    targets: [{ entityId: fileEntity.id, role: "primary" }],
  });

  return createActionEvaluationContext({ state, action });
}

function createDummyConsequence(actionId: ActionId, summary: string): Consequence {
  return createConsequence({
    actionId,
    kind: "state-change",
    summary,
    affectedEntities: [],
    stateChanges: [],
    evidence: [],
    confidence: createConfidenceScore(0.9),
    reversibility: { level: "reversible" },
    risk: { severity: "low", categories: ["data-loss"] },
    temporal: { timing: "immediate", frequency: "once" },
  });
}

describe("consequence-engine/ConsequenceEngine (Canonical FC-002B)", () => {
  it("returns assessment with zero consequences when zero evaluators are registered", async () => {
    const engine = new ConsequenceEngine();
    expect(engine.evaluatorCount).toBe(0);

    const context = createValidContext();
    const result = await engine.evaluate(context);

    expect(isOk(result)).toBe(true);
    const assessment = unwrapResult(result);
    expect(assessment.evaluationContextId).toBe(context.id);
    expect(assessment.actionId).toBe(context.action.id);
    expect(assessment.consequences).toEqual([]);
    expect(assessment.provenance.source).toBe("engine");
  });

  it("orchestrates a single evaluator successfully and produces canonical ConsequenceAssessment", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();
    const dummy = createDummyConsequence(context.action.id, "Consequence 1");

    let evaluatorCallCount = 0;
    const evaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => {
        evaluatorCallCount++;
        return ok({ consequences: [dummy] });
      },
    };

    engine.registerEvaluator(evaluator);
    expect(engine.evaluatorCount).toBe(1);

    const result = await engine.evaluate(context);

    expect(isOk(result)).toBe(true);
    expect(evaluatorCallCount).toBe(1);
    const assessment = unwrapResult(result);
    expect(assessment.evaluationContextId).toBe(context.id);
    expect(assessment.actionId).toBe(context.action.id);
    expect(assessment.consequences.length).toBe(1);
    expect(assessment.consequences[0]?.summary).toBe("Consequence 1");
  });

  it("aggregates consequences from multiple evaluators preserving registration order", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();
    const dummy1 = createDummyConsequence(context.action.id, "First Evaluator Consequence");
    const dummy2 = createDummyConsequence(context.action.id, "Second Evaluator Consequence");

    const eval1: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => ok({ consequences: [dummy1] }),
    };
    const eval2: IConsequenceEvaluator = {
      mode: "simulated",
      evaluate: async () => ok({ consequences: [dummy2] }),
    };

    engine.registerEvaluator(eval1);
    engine.registerEvaluator(eval2);

    const result = await engine.evaluate(context);
    expect(isOk(result)).toBe(true);
    const assessment = unwrapResult(result);
    expect(assessment.consequences.length).toBe(2);
    expect(assessment.consequences[0]?.summary).toBe("First Evaluator Consequence");
    expect(assessment.consequences[1]?.summary).toBe("Second Evaluator Consequence");
  });

  it("rejects structurally invalid ActionEvaluationContext with evaluator call count = 0", async () => {
    const engine = new ConsequenceEngine();
    let evaluatorCallCount = 0;
    const evaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => {
        evaluatorCallCount++;
        return ok({ consequences: [] });
      },
    };
    engine.registerEvaluator(evaluator);

    // Context with invalid schemaVersion
    const invalidContext = {
      schemaVersion: "0.9",
      id: "eval-invalid",
      state: {},
      action: {},
      createdAt: "not-a-timestamp",
    } as unknown as ActionEvaluationContext;

    const result = await engine.evaluate(invalidContext);
    expect(isErr(result)).toBe(true);
    expect(evaluatorCallCount).toBe(0);
    if (isErr(result)) {
      expect(result.error.message).toContain("Invalid ActionEvaluationContext");
    }
  });

  it("rejects semantically invalid ActionEvaluationContext with evaluator call count = 0", async () => {
    const engine = new ConsequenceEngine();
    let evaluatorCallCount = 0;
    const evaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => {
        evaluatorCallCount++;
        return ok({ consequences: [] });
      },
    };
    engine.registerEvaluator(evaluator);

    const validContext = createValidContext();
    // Tamper context to have conflicting environmentId between state and action
    const conflictingContext: ActionEvaluationContext = {
      ...validContext,
      action: {
        ...validContext.action,
        environment: {
          ...validContext.action.environment,
          environmentId: "env-conflicting-other",
        },
      },
    };

    const result = await engine.evaluate(conflictingContext);
    expect(isErr(result)).toBe(true);
    expect(evaluatorCallCount).toBe(0);
    if (isErr(result)) {
      expect(result.error.message).toContain("ENVIRONMENT_MISMATCH");
    }
  });

  it("passes validated, normalized ActionEvaluationContext snapshot to evaluators, neutralizing dynamic getters", async () => {
    const engine = new ConsequenceEngine();
    const baseContext = createValidContext();

    // Create a hostile context where a getter changes between reads
    let readCount = 0;
    const hostileState = {
      ...baseContext.state,
    };
    Object.defineProperty(hostileState, "observedAt", {
      get() {
        readCount++;
        // First read during validation yields valid timestamp, subsequent read yields invalid
        return readCount === 1 ? "2026-09-06T20:00:00.000Z" : "INVALID_TIMESTAMP";
      },
      enumerable: true,
      configurable: true,
    });

    const hostileContext: ActionEvaluationContext = {
      ...baseContext,
      state: hostileState,
    };

    let receivedContext: ActionEvaluationContext | undefined;
    const evaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async (ctx) => {
        receivedContext = ctx;
        return ok({ consequences: [] });
      },
    };

    engine.registerEvaluator(evaluator);
    const result = await engine.evaluate(hostileContext);

    expect(isOk(result)).toBe(true);
    expect(receivedContext).toBeDefined();
    // The evaluator must see the normalized snapshot value, NOT the hostile getter
    expect(receivedContext?.state.observedAt).toBe("2026-09-06T20:00:00.000Z");
  });

  it("preserves typed failure when an evaluator returns an error Result", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const failingEvaluator: IConsequenceEvaluator = {
      mode: "predicted",
      evaluate: async () => err(new Error("Evaluator failed deterministically")),
    };

    engine.registerEvaluator(failingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("Evaluator failed deterministically");
    }
  });

  it("safely handles thrown standard Error from hostile evaluators without crashing", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const throwingEvaluator: IConsequenceEvaluator = {
      mode: "simulated",
      evaluate: async () => {
        throw new TypeError("Hostile evaluator threw an unhandled exception");
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("Hostile evaluator threw an unhandled exception");
    }
  });

  it("safely handles string thrown from hostile evaluator", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const throwingEvaluator: IConsequenceEvaluator = {
      mode: "predicted",
      evaluate: async () => {
        throw "String error from evaluator";
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("String error from evaluator");
    }
  });

  it("safely handles Object.create(null) thrown from hostile evaluator", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const throwingEvaluator: IConsequenceEvaluator = {
      mode: "predicted",
      evaluate: async () => {
        const nullProto = Object.create(null);
        nullProto.reason = "null proto error";
        throw nullProto;
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("Evaluator execution failed");
    }
  });

  it("safely handles { toString: null } thrown from hostile evaluator", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const throwingEvaluator: IConsequenceEvaluator = {
      mode: "predicted",
      evaluate: async () => {
        throw { toString: null };
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("Evaluator execution failed");
    }
  });

  it("safely handles null thrown from hostile evaluator", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const throwingEvaluator: IConsequenceEvaluator = {
      mode: "predicted",
      evaluate: async () => {
        throw null;
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe("Evaluator execution failed");
    }
  });

  it("halts execution on first error and never fabricates consequences", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();
    let secondEvaluatorCalled = false;

    const eval1: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => err(new Error("First evaluator failed")),
    };
    const eval2: IConsequenceEvaluator = {
      mode: "simulated",
      evaluate: async () => {
        secondEvaluatorCalled = true;
        return ok({ consequences: [] });
      },
    };

    engine.registerEvaluator(eval1);
    engine.registerEvaluator(eval2);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    expect(secondEvaluatorCalled).toBe(false);
  });

  it("Probe 19, 20, 21, 22: evaluator mutation cannot change context.id, action.id, nested environment, or assessment lineage", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();
    const originalContextId = context.id;
    const originalActionId = context.action.id;
    const originalEnvId = context.state.environment.environmentId;

    let secondEvaluatorSawContextId = "";
    let secondEvaluatorSawActionId = "";
    let secondEvaluatorSawEnvId = "";

    const mutatingEvaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async (ctx) => {
        // Attempt mutating context.id
        try {
          (ctx as unknown as Record<string, unknown>).id = "mutated-context-id";
        } catch {
          // Expected to throw in strict mode on frozen object
        }
        // Attempt mutating context.action.id
        try {
          (ctx.action as unknown as Record<string, unknown>).id = "mutated-action-id";
        } catch {}
        // Attempt mutating nested state environment
        try {
          (ctx.state.environment as unknown as Record<string, unknown>).environmentId =
            "mutated-env-id";
        } catch {}
        // Attempt mutating action parameters
        try {
          (ctx.action.parameters as Record<string, unknown>).injected = true;
        } catch {}

        return ok({ consequences: [] });
      },
    };

    const observingEvaluator: IConsequenceEvaluator = {
      mode: "simulated",
      evaluate: async (ctx) => {
        secondEvaluatorSawContextId = ctx.id;
        secondEvaluatorSawActionId = ctx.action.id;
        secondEvaluatorSawEnvId = ctx.state.environment.environmentId;
        return ok({ consequences: [] });
      },
    };

    engine.registerEvaluator(mutatingEvaluator);
    engine.registerEvaluator(observingEvaluator);

    const result = await engine.evaluate(context);
    expect(isOk(result)).toBe(true);

    // Probe 19: context.id was not changed by evaluator 1 mutation attempt
    expect(secondEvaluatorSawContextId).toBe(originalContextId);

    // Probe 20: action.id was not changed by evaluator 1 mutation attempt
    expect(secondEvaluatorSawActionId).toBe(originalActionId);

    // Probe 21: nested context environment was not changed for evaluator 2
    expect(secondEvaluatorSawEnvId).toBe(originalEnvId);

    // Probe 22: final ConsequenceAssessment retains original authoritative IDs
    const assessment = unwrapResult(result);
    expect(assessment.evaluationContextId).toBe(originalContextId);
    expect(assessment.actionId).toBe(originalActionId);

    // Original caller context also remains unchanged
    expect(context.id).toBe(originalContextId);
    expect(context.action.id).toBe(originalActionId);
    expect(context.state.environment.environmentId).toBe(originalEnvId);
  });

  it("Probe 23: wrong evaluator consequence actionId causes engine failure", async () => {
    const engine = new ConsequenceEngine();
    const context = createValidContext();

    const maliciousEvaluator: IConsequenceEvaluator = {
      mode: "verified",
      evaluate: async () => {
        const fraudulentConsequence = createDummyConsequence(
          "act-fraudulent-id" as ActionId,
          "Malicious consequence with mismatched actionId",
        );
        return ok({ consequences: [fraudulentConsequence] });
      },
    };

    engine.registerEvaluator(maliciousEvaluator);

    const result = await engine.evaluate(context);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("ACTION_ID_MISMATCH");
    }
  });
});

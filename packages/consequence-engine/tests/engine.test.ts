import {
  type ActionConsequence,
  type EnvironmentState,
  type ProposedAction,
  createConfidenceScore,
} from "@futureclick/action-schema";
import {
  createDeterministicIdGenerator,
  currentIsoTimestamp,
  err,
  isErr,
  isOk,
  ok,
  unwrapResult,
} from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import { ConsequenceEngine, type IConsequenceEvaluator } from "../src/index.js";

const testIdGen = createDeterministicIdGenerator("engine-test");

function createMockRequest(): { action: ProposedAction; state: EnvironmentState } {
  const ts = currentIsoTimestamp();
  const actionId = testIdGen.generate<"ActionId">("act");
  const stateId = testIdGen.generate<"StateId">("state");

  const state: EnvironmentState = {
    id: stateId,
    timestamp: ts,
    platform: "browser",
    applicationName: "TestApp",
  };

  const action: ProposedAction = {
    id: actionId,
    category: "submit",
    target: {
      id: testIdGen.generate<"TargetId">("tgt"),
      kind: "button",
    },
    timestamp: ts,
    stateId,
  };

  return { action, state };
}

function createDummyConsequence(
  summary: string,
  kind: "verified" | "simulated" | "predicted" = "verified",
): ActionConsequence {
  return {
    id: testIdGen.generate<"ConsequenceId">("csq"),
    actionId: testIdGen.generate<"ActionId">("act"),
    kind,
    summary,
    reversibility: "fully_reversible",
    confidence: createConfidenceScore(1.0),
    evidence: [],
    provenance: {
      engineVersion: "0.1.0",
      evaluationTimestamp: currentIsoTimestamp(),
      deterministic: true,
    },
  };
}

describe("consequence-engine/ConsequenceEngine", () => {
  it("returns empty consequence array when zero evaluators are registered", async () => {
    const engine = new ConsequenceEngine();
    expect(engine.evaluatorCount).toBe(0);

    const request = createMockRequest();
    const result = await engine.evaluate(request);

    expect(isOk(result)).toBe(true);
    expect(unwrapResult(result)).toEqual([]);
  });

  it("orchestrates a single evaluator successfully", async () => {
    const engine = new ConsequenceEngine();
    const dummy = createDummyConsequence("Consequence 1", "verified");

    const evaluator: IConsequenceEvaluator = {
      kind: "verified",
      evaluate: async () => ok({ consequences: [dummy] }),
    };

    engine.registerEvaluator(evaluator);
    expect(engine.evaluatorCount).toBe(1);

    const request = createMockRequest();
    const result = await engine.evaluate(request);

    expect(isOk(result)).toBe(true);
    const evaluated = unwrapResult(result);
    expect(evaluated.length).toBe(1);
    expect(evaluated[0]?.summary).toBe("Consequence 1");
  });

  it("aggregates consequences from multiple evaluators preserving registration order", async () => {
    const engine = new ConsequenceEngine();
    const order: string[] = [];

    const dummy1 = createDummyConsequence("Verified consequence", "verified");
    const dummy2 = createDummyConsequence("Simulated consequence", "simulated");

    const eval1: IConsequenceEvaluator = {
      kind: "verified",
      evaluate: async () => {
        order.push("eval1");
        return ok({ consequences: [dummy1] });
      },
    };

    const eval2: IConsequenceEvaluator = {
      kind: "simulated",
      evaluate: async () => {
        order.push("eval2");
        return ok({ consequences: [dummy2] });
      },
    };

    engine.registerEvaluator(eval1);
    engine.registerEvaluator(eval2);

    const result = await engine.evaluate(createMockRequest());
    expect(isOk(result)).toBe(true);

    const evaluated = unwrapResult(result);
    expect(evaluated.length).toBe(2);
    expect(evaluated[0]?.kind).toBe("verified");
    expect(evaluated[1]?.kind).toBe("simulated");
    expect(order).toEqual(["eval1", "eval2"]);
  });

  it("propagates typed failure result without fabricating consequences", async () => {
    const engine = new ConsequenceEngine();
    const expectedError = new Error("Static analysis assertion failed");

    const failingEvaluator: IConsequenceEvaluator = {
      kind: "verified",
      evaluate: async () => err(expectedError),
    };

    let secondCalled = false;
    const secondEvaluator: IConsequenceEvaluator = {
      kind: "simulated",
      evaluate: async () => {
        secondCalled = true;
        return ok({ consequences: [createDummyConsequence("Should not run")] });
      },
    };

    engine.registerEvaluator(failingEvaluator);
    engine.registerEvaluator(secondEvaluator);

    const result = await engine.evaluate(createMockRequest());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(expectedError);
    }
    expect(secondCalled).toBe(false);
  });

  it("catches thrown exceptions in evaluators and safely returns err(Error)", async () => {
    const engine = new ConsequenceEngine();

    const throwingEvaluator: IConsequenceEvaluator = {
      kind: "predicted",
      evaluate: async () => {
        throw new Error("Network timeout connecting to evaluation daemon");
      },
    };

    engine.registerEvaluator(throwingEvaluator);

    const result = await engine.evaluate(createMockRequest());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("Network timeout connecting to evaluation daemon");
    }
  });
});

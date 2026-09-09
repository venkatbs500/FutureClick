import { describe, expect, it } from "vitest";
import {
  type BrowserObservation,
  BrowserAdapterEngine,
  createBrowserObservation,
} from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";

function createSyntheticVisibilityObservation(
  overrides?: Partial<BrowserObservation["metadata"]>,
): BrowserObservation {
  return createBrowserObservation({
    id: "obs-e2e-valid-01" as import("@futureclick/browser-adapter").BrowserObservationId,
    capturedAt: "2026-09-08T16:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
    page: {
      origin: "http://127.0.0.1:4173",
      routeId: "synthetic.repository-visibility",
    },
    element: {
      kind: "button",
      role: "button",
      buttonType: "button",
    },
    metadata: {
      fixtureContract: "fc005.repository-visibility.v1",
      operation: "repository.visibility.change",
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
      ...overrides,
    },
  });
}

describe("ConsequenceEngine End-to-End Vertical Slice (FC-005)", () => {
  it("Probe 1: Valid synthetic observation produces exactly one VERIFIED repository visibility consequence", async () => {
    // 1. Setup adapter engine and consequence engine
    const adapterEngine = new BrowserAdapterEngine();
    const consequenceEngine = new ConsequenceEngine();
    consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());

    // 2. Adapt observation to canonical context
    const observation = createSyntheticVisibilityObservation();
    const outcome = adapterEngine.adapt(observation);

    expect(outcome.status).toBe("matched");
    if (outcome.status !== "matched") return;

    const context = outcome.context;
    expect(context.state.facts[0]?.value).toBe("private");
    expect(context.action.parameters.newVisibility).toBe("public");

    // 3. Evaluate context with ConsequenceEngine
    const assessmentResult = await consequenceEngine.evaluate(context);
    expect(assessmentResult.ok).toBe(true);
    if (!assessmentResult.ok) return;

    const assessment = assessmentResult.value;
    expect(assessment.consequences.length).toBe(1);

    const csq = assessment.consequences[0];
    expect(csq).toBeDefined();
    if (!csq) return;

    // Consequence invariants
    expect(csq.kind).toBe("security");
    expect(csq.summary).toContain("visibility will change from private to public");
    expect(csq.confidence).toBe(1.0);
    expect(csq.reversibility?.level).toBe("partially_reversible");
    expect(csq.risk?.severity).toBe("high");
    expect(csq.risk?.categories).toContain("security");
    expect(csq.risk?.categories).toContain("privacy");

    // State change verification
    expect(csq.stateChanges?.length).toBe(1);
    const change = csq.stateChanges?.[0];
    expect(change?.property).toBe("repository.visibility");
    expect(change?.before.status).toBe("known");
    if (change?.before.status === "known") {
      expect(change.before.value).toBe("private");
    }
    expect(change?.after.status).toBe("known");
    if (change?.after.status === "known") {
      expect(change.after.value).toBe("public");
    }

    // Evidence & lineage verification
    expect(csq.evidence.length).toBe(1);
    const ev = csq.evidence[0];
    expect(ev?.mode).toBe("verified");
    expect(assessment.evaluationContextId).toBe(context.id);
    expect(assessment.actionId).toBe(context.action.id);
  });

  describe("Abstentions & Negative Controls (Section 81)", () => {
    it("Probe 2: Missing current visibility abstains with INSUFFICIENT_EVIDENCE (0 consequences)", async () => {
      const adapterEngine = new BrowserAdapterEngine();
      const observation = createBrowserObservation({
        id: "obs-neg-missing-cur" as import("@futureclick/browser-adapter").BrowserObservationId,
        capturedAt: "2026-09-08T16:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
        page: {
          origin: "http://127.0.0.1:4173",
          routeId: "synthetic.repository-visibility",
        },
        metadata: {
          fixtureContract: "fc005.repository-visibility.v1",
          operation: "repository.visibility.change",
          entityKey: "fixture-repository",
          requestedVisibility: "public",
        },
      });

      const outcome = adapterEngine.adapt(observation);
      expect(outcome.status).toBe("insufficient-evidence");
      if (outcome.status !== "insufficient-evidence") return;
      expect(outcome.reasonCode).toBe("MISSING_CURRENT_VISIBILITY");
    });

    it("Probe 3: Unsupported visibility transition (internal -> public) produces unsupported result (0 consequences)", () => {
      const adapterEngine = new BrowserAdapterEngine();
      const observation = createSyntheticVisibilityObservation({
        currentVisibility: "internal",
      });

      const outcome = adapterEngine.adapt(observation);
      expect(outcome.status).toBe("unsupported");
    });

    it("Probe 4: Unrelated operation (repository.archive) produces unsupported result (0 consequences)", () => {
      const adapterEngine = new BrowserAdapterEngine();
      const observation = createSyntheticVisibilityObservation({
        operation: "repository.archive",
      });

      const outcome = adapterEngine.adapt(observation);
      expect(outcome.status).toBe("unsupported");
    });

    it("Probe 5: Unrelated fixture contract produces unsupported result (0 consequences)", () => {
      const adapterEngine = new BrowserAdapterEngine();
      const observation = createSyntheticVisibilityObservation({
        fixtureContract: "unrelated.contract.v1",
      });

      const outcome = adapterEngine.adapt(observation);
      expect(outcome.status).toBe("unsupported");
    });
  });
});

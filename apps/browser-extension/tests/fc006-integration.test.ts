/**
 * FC-006 Capture → Local Adapter → Canonical Context → ConsequenceEngine
 * Integration Tests (Sprint 1)
 */

import { describe, expect, it } from "vitest";
import {
  type BrowserObservationId,
  BrowserAdapterEngine,
  createBrowserObservation,
} from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import type { IsoTimestamp } from "@futureclick/shared";
import {
  FC006_ADAPTER_ID,
  FC006_ADAPTER_VERSION,
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
  syntheticRepositoryInterceptionAdapter,
} from "../src/fc006/synthetic-repository-interception-adapter.js";

function createFc006Observation() {
  return createBrowserObservation({
    id: "obs-fc006-integration-01" as BrowserObservationId,
    capturedAt: "2026-09-08T23:30:00.000Z" as IsoTimestamp,
    page: {
      origin: FC006_ORIGIN,
      routeId: FC006_ROUTE_ID,
    },
    element: {
      kind: "button",
      role: "button",
      buttonType: "button",
    },
    metadata: {
      fixtureContract: FC006_FIXTURE_CONTRACT,
      operation: FC006_OPERATION,
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

describe("FC-006 Adapter Engine + Consequence Integration", () => {
  it("local adapter through BrowserAdapterEngine yields expected canonical context provenance", () => {
    const engine = new BrowserAdapterEngine({
      registry: [syntheticRepositoryInterceptionAdapter],
    });
    const outcome = engine.adapt(createFc006Observation());

    expect(outcome.status).toBe("matched");
    if (outcome.status !== "matched") return;

    expect(outcome.adapterId).toBe(FC006_ADAPTER_ID);
    expect(outcome.adapterId).not.toBe("browser.synthetic.repository-visibility");

    const context = outcome.context;
    expect(context.state.entities[0]?.kind).toBe("repository");
    expect(context.state.entities[0]?.label).toBe("Synthetic Repository");
    expect(context.state.facts[0]?.key).toBe("repository.visibility");
    expect(context.state.facts[0]?.value).toBe("private");
    expect(context.action.intent.domain).toBe("version_control");
    expect(context.action.intent.verb).toBe("change-access");
    expect(context.action.targets[0]?.role).toBe("primary");
    expect(context.action.parameters.newVisibility).toBe("public");
    expect(context.action.executionStatus).toBe("proposed");

    expect(context.state.environment.kind).toBe("browser");
    expect(context.state.environment.platform).toBe("web");

    const provenance = context.action.provenance;
    expect(provenance).toBeDefined();
    if (!provenance) return;
    expect(provenance.source).toBe("adapter");
    expect(provenance.details?.adapterId).toBe(FC006_ADAPTER_ID);
    expect(provenance.details?.adapterVersion).toBe(FC006_ADAPTER_VERSION);
    expect(provenance.details?.synthetic).toBe(true);
    expect(provenance.details?.evidenceBasis).toBe("synthetic-page-metadata");
  });

  it("FC-006 context produces exactly one VERIFIED private→public consequence", async () => {
    const adapterEngine = new BrowserAdapterEngine({
      registry: [syntheticRepositoryInterceptionAdapter],
    });
    const consequenceEngine = new ConsequenceEngine();
    consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());

    const outcome = adapterEngine.adapt(createFc006Observation());
    expect(outcome.status).toBe("matched");
    if (outcome.status !== "matched") return;

    const assessmentResult = await consequenceEngine.evaluate(outcome.context);
    expect(assessmentResult.ok).toBe(true);
    if (!assessmentResult.ok) return;

    const assessment = assessmentResult.value;
    expect(assessment.consequences.length).toBe(1);

    const csq = assessment.consequences[0];
    expect(csq).toBeDefined();
    if (!csq) return;

    expect(csq.evidence.some((e) => e.mode === "verified")).toBe(true);
    expect(csq.confidence).toBe(1.0);
    expect(csq.risk?.severity).toBe("high");
    expect(csq.risk?.categories).toContain("security");
    expect(csq.risk?.categories).toContain("privacy");
    expect(csq.reversibility?.level).toBe("partially_reversible");

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

    expect(assessment.evaluationContextId).toBe(outcome.context.id);
    expect(assessment.actionId).toBe(outcome.context.action.id);
  });

  it("default FC-005 engine does not match truthful FC-006 observation", () => {
    const defaultEngine = new BrowserAdapterEngine();
    const outcome = defaultEngine.adapt(createFc006Observation());
    expect(outcome.status).toBe("unsupported");
  });
});

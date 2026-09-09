import { describe, expect, it } from "vitest";
import {
  type AdapterDecision,
  type AdapterId,
  type AdapterVersion,
  BROWSER_ADAPTER_ERROR_CODES,
  type BrowserActionAdapter,
  BrowserAdapterEngine,
  createBrowserAdapterRegistry,
  createBrowserObservation,
  syntheticRepositoryVisibilityAdapter,
} from "../src/index.js";

function getBaseObservation() {
  return createBrowserObservation({
    id: "obs-integration-01" as import("../src/types.js").BrowserObservationId,
    capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
    page: {
      origin: "http://127.0.0.1:4173",
      routeId: "synthetic.repository-visibility",
    },
    metadata: {
      fixtureContract: "fc005.repository-visibility.v1",
      operation: "repository.visibility.change",
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

describe("BrowserAdapterEngine Integration & Ambiguity", () => {
  it("Probe 1: Valid synthetic observation matches default registry and produces canonical context", () => {
    const engine = new BrowserAdapterEngine();
    const obs = getBaseObservation();

    const outcome = engine.adapt(obs);
    expect(outcome.status).toBe("matched");
    if (outcome.status !== "matched") return;

    expect(outcome.adapterId).toBe(syntheticRepositoryVisibilityAdapter.id);
    expect(outcome.context.schemaVersion).toBe("1.0");
    expect(outcome.context.state.facts[0]?.value).toBe("private");
    expect(outcome.context.action.parameters.newVisibility).toBe("public");
  });

  it("Probe 2: Missing currentVisibility produces INSUFFICIENT_EVIDENCE abstention", () => {
    const engine = new BrowserAdapterEngine();
    const obs = createBrowserObservation({
      id: "obs-missing-cur" as import("../src/types.js").BrowserObservationId,
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "synthetic.repository-visibility",
      },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        // currentVisibility intentionally omitted
        requestedVisibility: "public",
      },
    });

    const outcome = engine.adapt(obs);
    expect(outcome.status).toBe("insufficient-evidence");
    if (outcome.status !== "insufficient-evidence") return;
    expect(outcome.reasonCode).toBe("MISSING_CURRENT_VISIBILITY");
    expect(outcome.missing).toEqual(["metadata.currentVisibility"]);
  });

  it("Probe 3: Missing requestedVisibility produces INSUFFICIENT_EVIDENCE abstention", () => {
    const engine = new BrowserAdapterEngine();
    const obs = createBrowserObservation({
      id: "obs-missing-req" as import("../src/types.js").BrowserObservationId,
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "synthetic.repository-visibility",
      },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        // requestedVisibility intentionally omitted
      },
    });

    const outcome = engine.adapt(obs);
    expect(outcome.status).toBe("insufficient-evidence");
    if (outcome.status !== "insufficient-evidence") return;
    expect(outcome.reasonCode).toBe("MISSING_REQUESTED_VISIBILITY");
    expect(outcome.missing).toEqual(["metadata.requestedVisibility"]);
  });

  it("Probe 4: Unsupported visibility transition produces unsupported result", () => {
    const engine = new BrowserAdapterEngine();
    const obs = createBrowserObservation({
      id: "obs-unsupported-vis" as import("../src/types.js").BrowserObservationId,
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "synthetic.repository-visibility",
      },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: "internal",
        requestedVisibility: "public",
      },
    });

    const outcome = engine.adapt(obs);
    expect(outcome.status).toBe("unsupported");
  });

  it("Probe 5: Unrelated operation produces unsupported result", () => {
    const engine = new BrowserAdapterEngine();
    const obs = createBrowserObservation({
      id: "obs-unrelated-op" as import("../src/types.js").BrowserObservationId,
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "synthetic.repository-visibility",
      },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.delete",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    });

    const outcome = engine.adapt(obs);
    expect(outcome.status).toBe("unsupported");
  });

  describe("Ambiguity Detection & Order Independence", () => {
    const competingAdapterA: BrowserActionAdapter = Object.freeze({
      id: "competing.adapter.a" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Competing adapter A",
      assess: (): AdapterDecision => ({
        status: "matched",
        draft: {
          kind: "synthetic.repository-visibility",
          entityKey: "fixture-repository",
          entityKind: "repository",
          currentVisibility: "private",
          requestedVisibility: "public",
          intent: {
            verb: "change-access",
            domain: "version_control",
          },
          targetRole: "primary",
        },
      }),
    });

    const competingAdapterB: BrowserActionAdapter = Object.freeze({
      id: "competing.adapter.b" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Competing adapter B",
      assess: (): AdapterDecision => ({
        status: "matched",
        draft: {
          kind: "synthetic.repository-visibility",
          entityKey: "fixture-repository",
          entityKind: "repository",
          currentVisibility: "private",
          requestedVisibility: "public",
          intent: {
            verb: "change-access",
            domain: "version_control",
          },
          targetRole: "primary",
        },
      }),
    });

    const insufficientAdapter: BrowserActionAdapter = Object.freeze({
      id: "insufficient.adapter" as AdapterId,
      version: "1.0" as AdapterVersion,
      description: "Insufficient adapter",
      assess: (): AdapterDecision => ({
        status: "insufficient-evidence",
        reasonCode: "TEST_INSUFFICIENT",
        missing: ["test.param"],
      }),
    });

    it("Probe 6: Two MATCHED claims -> AMBIGUOUS_ADAPTER", () => {
      const regAB = createBrowserAdapterRegistry([competingAdapterA, competingAdapterB]);
      const engineAB = new BrowserAdapterEngine({ registry: regAB });
      const outcomeAB = engineAB.adapt(getBaseObservation());

      expect(outcomeAB.status).toBe("error");
      if (outcomeAB.status !== "error") return;
      expect(outcomeAB.code).toBe(BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER);

      // Reverse order: B then A
      const regBA = createBrowserAdapterRegistry([competingAdapterB, competingAdapterA]);
      const engineBA = new BrowserAdapterEngine({ registry: regBA });
      const outcomeBA = engineBA.adapt(getBaseObservation());

      expect(outcomeBA.status).toBe("error");
      if (outcomeBA.status !== "error") return;
      expect(outcomeBA.code).toBe(BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER);
    });

    it("Probe 7: One MATCHED + One INSUFFICIENT -> AMBIGUOUS_ADAPTER", () => {
      const reg = createBrowserAdapterRegistry([competingAdapterA, insufficientAdapter]);
      const engine = new BrowserAdapterEngine({ registry: reg });
      const outcome = engine.adapt(getBaseObservation());

      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER);

      // Reverse order
      const regRev = createBrowserAdapterRegistry([insufficientAdapter, competingAdapterA]);
      const engineRev = new BrowserAdapterEngine({ registry: regRev });
      const outcomeRev = engineRev.adapt(getBaseObservation());

      expect(outcomeRev.status).toBe("error");
      if (outcomeRev.status !== "error") return;
      expect(outcomeRev.code).toBe(BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER);
    });

    it("Probe 8: Two INSUFFICIENT claims -> AMBIGUOUS_ADAPTER", () => {
      const insufficient2: BrowserActionAdapter = Object.freeze({
        id: "insufficient.adapter.two" as AdapterId,
        version: "1.0" as AdapterVersion,
        description: "Insufficient adapter 2",
        assess: (): AdapterDecision => ({
          status: "insufficient-evidence",
          reasonCode: "TEST_INSUFFICIENT_2",
          missing: ["test.param2"],
        }),
      });

      const reg = createBrowserAdapterRegistry([insufficientAdapter, insufficient2]);
      const engine = new BrowserAdapterEngine({ registry: reg });
      const outcome = engine.adapt(getBaseObservation());

      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.code).toBe(BROWSER_ADAPTER_ERROR_CODES.AMBIGUOUS_ADAPTER);
    });
  });
});

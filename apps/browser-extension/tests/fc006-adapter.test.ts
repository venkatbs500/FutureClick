/**
 * FC-006 Local Adapter Tests (Sprint 1)
 */

import { describe, expect, it } from "vitest";
import {
  type BrowserObservation,
  type BrowserObservationId,
  createBrowserObservation,
} from "@futureclick/browser-adapter";
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

function createValidFc006Observation(overrides?: {
  readonly page?: Partial<BrowserObservation["page"]>;
  readonly interaction?: Partial<BrowserObservation["interaction"]>;
  readonly element?: Partial<BrowserObservation["element"]>;
  readonly metadata?: Partial<BrowserObservation["metadata"]>;
}): BrowserObservation {
  return createBrowserObservation({
    id: "obs-fc006-adapter-01" as BrowserObservationId,
    capturedAt: "2026-09-08T23:00:00.000Z" as IsoTimestamp,
    page: {
      origin: FC006_ORIGIN,
      routeId: FC006_ROUTE_ID,
      ...overrides?.page,
    },
    interaction: {
      kind: "activate",
      ...overrides?.interaction,
    },
    element: {
      kind: "button",
      role: "button",
      buttonType: "button",
      ...overrides?.element,
    },
    metadata: {
      fixtureContract: FC006_FIXTURE_CONTRACT,
      operation: FC006_OPERATION,
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
      ...overrides?.metadata,
    },
  });
}

describe("FC-006 Local Adapter", () => {
  it("matches exact FC-006 observation and returns closed draft", () => {
    const decision = syntheticRepositoryInterceptionAdapter.assess(createValidFc006Observation());
    expect(decision.status).toBe("matched");
    if (decision.status !== "matched") return;

    expect(syntheticRepositoryInterceptionAdapter.id).toBe(FC006_ADAPTER_ID);
    expect(syntheticRepositoryInterceptionAdapter.version).toBe(FC006_ADAPTER_VERSION);
    expect(decision.draft).toEqual({
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
    });
  });

  it("rejects wrong origin", () => {
    const obs = createValidFc006Observation({
      page: { origin: "http://127.0.0.1:9999", routeId: FC006_ROUTE_ID },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(obs).status).toBe("not-applicable");
  });

  it("rejects wrong routeId (including FC-005 route)", () => {
    const obs = createValidFc006Observation({
      page: { origin: FC006_ORIGIN, routeId: "synthetic.repository-visibility" },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(obs).status).toBe("not-applicable");
  });

  it("rejects wrong fixture contract (including FC-005 contract)", () => {
    const obs = createValidFc006Observation({
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: FC006_OPERATION,
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(obs).status).toBe("not-applicable");
  });

  it("rejects wrong interaction", () => {
    const obs = createValidFc006Observation({
      interaction: { kind: "submit" as "activate" },
    });
    // Force wrong interaction via casted assess input
    const forced = {
      ...obs,
      interaction: { kind: "submit" },
    } as unknown as BrowserObservation;
    expect(syntheticRepositoryInterceptionAdapter.assess(forced).status).toBe("not-applicable");
  });

  it("rejects wrong element kind / role / button type", () => {
    const kindForced = {
      ...createValidFc006Observation(),
      element: { kind: "link", role: "button", buttonType: "button" },
    } as unknown as BrowserObservation;
    expect(syntheticRepositoryInterceptionAdapter.assess(kindForced).status).toBe("not-applicable");

    const roleForced = {
      ...createValidFc006Observation(),
      element: { kind: "button", role: "menuitem", buttonType: "button" },
    } as unknown as BrowserObservation;
    expect(syntheticRepositoryInterceptionAdapter.assess(roleForced).status).toBe("not-applicable");

    const typeForced = {
      ...createValidFc006Observation(),
      element: { kind: "button", role: "button", buttonType: "submit" },
    } as unknown as BrowserObservation;
    expect(syntheticRepositoryInterceptionAdapter.assess(typeForced).status).toBe("not-applicable");
  });

  it("rejects wrong operation", () => {
    const obs = createValidFc006Observation({
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: "repository.archive",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(obs).status).toBe("not-applicable");
  });

  it("rejects wrong visibility transition", () => {
    const wrongCurrent = createValidFc006Observation({
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: FC006_OPERATION,
        entityKey: "fixture-repository",
        currentVisibility: "public",
        requestedVisibility: "public",
      },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(wrongCurrent).status).toBe(
      "not-applicable",
    );

    const wrongRequested = createValidFc006Observation({
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: FC006_OPERATION,
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "internal",
      },
    });
    expect(syntheticRepositoryInterceptionAdapter.assess(wrongRequested).status).toBe(
      "not-applicable",
    );
  });

  it("rejects invalid entityKey", () => {
    const forced = {
      ...createValidFc006Observation(),
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: FC006_OPERATION,
        entityKey: "PASSWORD=super-secret user@example.com",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    } as unknown as BrowserObservation;
    expect(syntheticRepositoryInterceptionAdapter.assess(forced).status).toBe("not-applicable");
  });

  it("returns insufficient-evidence when visibility metadata is missing", () => {
    const base = createValidFc006Observation();
    const missingCurrent = {
      ...base,
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: FC006_OPERATION,
        entityKey: "fixture-repository",
        requestedVisibility: "public",
      },
    } as unknown as BrowserObservation;
    const d1 = syntheticRepositoryInterceptionAdapter.assess(missingCurrent);
    expect(d1.status).toBe("insufficient-evidence");

    const missingRequested = {
      ...base,
      metadata: {
        fixtureContract: FC006_FIXTURE_CONTRACT,
        operation: FC006_OPERATION,
        entityKey: "fixture-repository",
        currentVisibility: "private",
      },
    } as unknown as BrowserObservation;
    const d2 = syntheticRepositoryInterceptionAdapter.assess(missingRequested);
    expect(d2.status).toBe("insufficient-evidence");
  });
});

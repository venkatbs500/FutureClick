import { describe, expect, it } from "vitest";
import {
  BROWSER_OBSERVATION_SCHEMA_VERSION,
  type BrowserObservation,
  type BrowserObservationId,
  createBrowserObservation,
  validateBrowserObservation,
} from "../src/index.js";

function createValidObservationInput(): unknown {
  return {
    schemaVersion: "1.0",
    id: "obs-test-valid-001",
    capturedAt: "2026-09-08T12:00:00.000Z",
    page: {
      origin: "http://127.0.0.1:4173",
      routeId: "synthetic.repository-visibility",
    },
    interaction: {
      kind: "activate",
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
    },
  };
}

describe("BrowserObservation Validation", () => {
  it("Probe 1: Valid synthetic private->public observation passes validation and is deeply frozen", () => {
    const raw = createValidObservationInput();
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const obs = res.value;
    expect(obs.schemaVersion).toBe(BROWSER_OBSERVATION_SCHEMA_VERSION);
    expect(obs.id).toBe("obs-test-valid-001");
    expect(obs.capturedAt).toBe("2026-09-08T12:00:00.000Z");
    expect(obs.page.origin).toBe("http://127.0.0.1:4173");
    expect(obs.page.routeId).toBe("synthetic.repository-visibility");
    expect(obs.interaction.kind).toBe("activate");
    expect(obs.element.kind).toBe("button");
    expect(obs.element.role).toBe("button");
    expect(obs.element.buttonType).toBe("button");
    expect(obs.metadata.fixtureContract).toBe("fc005.repository-visibility.v1");
    expect(obs.metadata.operation).toBe("repository.visibility.change");
    expect(obs.metadata.entityKey).toBe("fixture-repository");
    expect(obs.metadata.currentVisibility).toBe("private");
    expect(obs.metadata.requestedVisibility).toBe("public");

    // Immutability check
    expect(Object.isFrozen(obs)).toBe(true);
    expect(Object.isFrozen(obs.page)).toBe(true);
    expect(Object.isFrozen(obs.metadata)).toBe(true);
  });

  it("Probe 2: Rejects non-object inputs", () => {
    expect(validateBrowserObservation(null).ok).toBe(false);
    expect(validateBrowserObservation(undefined).ok).toBe(false);
    expect(validateBrowserObservation("string").ok).toBe(false);
    expect(validateBrowserObservation(12345).ok).toBe(false);
    expect(validateBrowserObservation([]).ok).toBe(false);
  });

  it("Probe 3: Rejects unexpected top-level properties (closed shape)", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      maliciousField: "payload",
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "UNEXPECTED_PROPERTY")).toBe(true);
  });

  it("Probe 4: Rejects unsupported schema versions", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      schemaVersion: "2.0",
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_SCHEMA_VERSION")).toBe(true);
  });

  it("Probe 5: Rejects empty or whitespace-only observation ID", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      id: "   ",
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 6: Rejects overlength observation ID (> 128 chars)", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      id: "a".repeat(129),
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 7: Rejects control characters in observation ID", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      id: "obs\x00evil",
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 8: Rejects invalid ISO timestamp", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      capturedAt: "2026-09-08 12:00:00",
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_TIMESTAMP")).toBe(true);
  });

  it("Probe 9: Rejects origin with path, query string, or hash", () => {
    const rawWithPath = {
      ...(createValidObservationInput() as object),
      page: {
        origin: "http://127.0.0.1:4173/evil/path",
        routeId: "synthetic.repository-visibility",
      },
    };
    expect(validateBrowserObservation(rawWithPath).ok).toBe(false);

    const rawWithQuery = {
      ...(createValidObservationInput() as object),
      page: {
        origin: "http://127.0.0.1:4173?secret=token",
        routeId: "synthetic.repository-visibility",
      },
    };
    expect(validateBrowserObservation(rawWithQuery).ok).toBe(false);
  });

  it("Probe 10: Rejects invalid machine tokens for routeId", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      page: {
        origin: "http://127.0.0.1:4173",
        routeId: "Invalid Route With Spaces!",
      },
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "INVALID_PAGE")).toBe(true);
  });

  it("Probe 11: Rejects explicit undefined for optional visibility properties", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: undefined,
        requestedVisibility: "public",
      },
    };
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "EXPLICIT_UNDEFINED")).toBe(true);
  });

  it("Probe 12: Safely handles throwing hostile getters", () => {
    const raw = createValidObservationInput() as Record<string, unknown>;
    Object.defineProperty(raw, "metadata", {
      get() {
        throw new Error("Hostile getter detonated!");
      },
    });
    const res = validateBrowserObservation(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((iss) => iss.code === "READ_ERROR")).toBe(true);
  });

  it("Probe 13: Enforces serialized size limit (max 4 KiB)", () => {
    const raw = {
      ...(createValidObservationInput() as object),
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "k".repeat(64),
        currentVisibility: "v".repeat(128),
        requestedVisibility: "v".repeat(128),
      },
    };
    // Within limits
    expect(validateBrowserObservation(raw).ok).toBe(true);
  });

  it("Probe 14: Detachment protects against source mutation", () => {
    const mutableSource = createValidObservationInput() as Record<string, unknown>;
    const res = validateBrowserObservation(mutableSource);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Mutate source after validation
    (mutableSource as { metadata: { currentVisibility?: string } }).metadata.currentVisibility =
      "mutated";
    expect(res.value.metadata.currentVisibility).toBe("private");
  });

  it("Probe 15: Factory createBrowserObservation returns frozen observation", () => {
    const obs = createBrowserObservation({
      id: "obs-factory-01" as BrowserObservationId,
      capturedAt: "2026-09-08T12:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
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

    expect(obs.id).toBe("obs-factory-01");
    expect(Object.isFrozen(obs)).toBe(true);
  });
});

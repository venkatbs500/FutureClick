/**
 * FC-008 Sprint 5B — extension prediction-host tests.
 *
 * Does not import FC-007. Does not read the final evaluation result.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FC008_BROWSER_MESSAGE_SCHEMA_VERSION,
  FC008_BROWSER_MESSAGE_TYPE,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
  buildObservationFromSurface,
  createScriptedClock,
  semanticText,
} from "@futureclick/action-understanding";
import type { BrowserObservation } from "@futureclick/browser-adapter";
import { createBrowserObservation } from "@futureclick/browser-adapter";
import type { IsoTimestamp } from "@futureclick/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../manifest.dev.json" with { type: "json" };
import * as capture from "../src/content/capture.js";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
} from "../src/content/capture.js";
import {
  type ActionUnderstandingSidecar,
  BrowserExtensionController,
} from "../src/content/controller.js";
import { readFrozenBrowserArtifactJson } from "../src/fc008/frozen-artifact-json.js";
import {
  FC008_DEVELOPMENT_SUPPORT_GATES,
  FROZEN_BROWSER_ARTIFACT_SHA256,
  createExtensionHostClock,
  createFc008ExtensionRuntime,
  loadBundledArtifactBundle,
  mapBrowserObservationToMessage,
  readFc008HostConfig,
  tryCreateFc008ActionUnderstandingSidecar,
} from "../src/fc008/index.js";

const ARTIFACT_DIRECTORY = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "research",
  "futurebench",
  "artifacts",
);

const FROZEN_DIRECTORY = fileURLToPath(new URL("../src/fc008/frozen", import.meta.url));

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(ARTIFACT_DIRECTORY, fileName), "utf8"));
}

function sha256File(directory: string, fileName: string): string {
  return createHash("sha256")
    .update(readFileSync(join(directory, fileName)))
    .digest("hex");
}

function jointBundle() {
  return loadBundledArtifactBundle({
    modelFamily: "joint-logistic",
    model: readJson("fc008-joint-logistic-model.json"),
    calibration: readJson("fc008-joint-logistic-calibration.json"),
    policy: readJson("fc008-joint-logistic-policy.json"),
  });
}

function factorizedBundle() {
  return loadBundledArtifactBundle({
    modelFamily: "factorized-logistic",
    model: readJson("fc008-factorized-logistic-model.json"),
    calibration: readJson("fc008-factorized-logistic-calibration.json"),
    policy: readJson("fc008-factorized-logistic-policy.json"),
  });
}

function capturedObservation(
  overrides: {
    interaction?: { kind: string };
    element?: { kind: string; role: string; buttonType: string };
    metadata?: Partial<{
      fixtureContract: string;
      operation: string;
      entityKey: string;
      currentVisibility: string;
      requestedVisibility: string;
    }>;
  } = {},
) {
  return createBrowserObservation({
    capturedAt: "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    page: { origin: "http://127.0.0.1:4173", routeId: "synthetic.repository-visibility" },
    interaction: overrides.interaction ?? { kind: "activate" },
    element: overrides.element ?? { kind: "button", role: "button", buttonType: "button" },
    metadata: {
      fixtureContract: "synthetic-repository-visibility",
      operation: "change-visibility",
      entityKey: "secret-repo-name",
      currentVisibility: "private",
      requestedVisibility: "public",
      ...overrides.metadata,
    },
  });
}

function deleteFileLinkObservation() {
  return capturedObservation({
    interaction: { kind: "activate" },
    element: { kind: "link", role: "link", buttonType: "button" },
    metadata: {
      fixtureContract: "synthetic-delete-file",
      operation: "delete-file",
      entityKey: "secret-repo-name",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

function trapFixtureMetadata(observation: BrowserObservation): BrowserObservation {
  const metadata = new Proxy(observation.metadata, {
    get(target, key, receiver) {
      if (
        key === "operation" ||
        key === "currentVisibility" ||
        key === "requestedVisibility" ||
        key === "fixtureContract" ||
        key === "entityKey"
      ) {
        throw new Error(`mapper-read-trap:${String(key)}`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const page = new Proxy(observation.page, {
    get(target, key, receiver) {
      if (key === "origin" || key === "routeId") {
        throw new Error(`mapper-read-trap:${String(key)}`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return new Proxy(observation, {
    get(target, key, receiver) {
      if (key === "metadata") {
        return metadata;
      }
      if (key === "page") {
        return page;
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

function syntheticUnderstandMessage(sequence: number) {
  const assembled = buildObservationFromSurface({
    observationId: `obs-${sequence}`,
    surface: {
      surfaceKind: "page",
      headings: [semanticText("settings")],
      stateSignals: [],
      objectKindEvidence: ["repository"],
      candidates: [
        {
          ownText: semanticText("make-public"),
          accessibleName: semanticText("visible-control"),
          controlKind: "button",
          controlRole: "button",
          interactionKind: "activate",
          formMethod: "none",
          destructiveStyle: false,
          nearbyLabels: [],
          ancestorDepth: 1,
        },
      ],
      targetIndex: 0,
    },
    acquisition: {
      actor: { kind: "human" },
      platform: "web",
      environmentKind: "browser",
      localeTag: "und",
      topFrame: true,
      acquisitionAuthorized: true,
    },
    benchmark: null,
    freshness: {
      epoch: 1,
      observationSequence: sequence,
      capturedAt: "2026-10-08T00:00:00.000Z" as IsoTimestamp,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      abstentionPolicyVersion: "1.0",
    },
  });
  if (!assembled.ok) {
    throw new Error("synthetic observation assembly refused");
  }
  const fingerprint = assembled.observation.inputFingerprint;
  if (typeof fingerprint !== "string") {
    throw new Error("synthetic fingerprint unavailable");
  }
  return {
    type: FC008_BROWSER_MESSAGE_TYPE,
    schemaVersion: FC008_BROWSER_MESSAGE_SCHEMA_VERSION,
    observationSequence: sequence,
    inputFingerprint: fingerprint,
    observation: assembled.observation,
  };
}

function readyRuntime(family: "joint-logistic" | "factorized-logistic" = "joint-logistic") {
  return createFc008ExtensionRuntime({
    modelFamily: family,
    bundle: family === "joint-logistic" ? jointBundle() : factorizedBundle(),
    supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
    now: () => "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    clock: createScriptedClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  });
}

describe("host configuration", () => {
  it("has no hidden family and no holdout-derived default", () => {
    const config = readFc008HostConfig();
    expect(config.modelFamily).toBeUndefined();
    expect(config.supportGates).toBeUndefined();
    const source = readFileSync(new URL("../src/fc008/host-config.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/final-evaluation|won|lost|best model/i);
    const sidecarSource = readFileSync(
      new URL("../src/fc008/production-sidecar.ts", import.meta.url),
      "utf8",
    );
    expect(sidecarSource).not.toMatch(/frozen-artifact-json/);
    const bootstrap = readFileSync(new URL("../src/content/index.ts", import.meta.url), "utf8");
    expect(bootstrap).not.toMatch(/frozen-artifact-json|readFrozenBrowserArtifactJson/);
    expect(createFc008ExtensionRuntime().available).toBe(false);
    expect(createFc008ExtensionRuntime().unavailableReason).toBe("family-not-specified");
    expect(tryCreateFc008ActionUnderstandingSidecar()).toBeUndefined();
  });

  it("requires explicit support gates when a family is supplied", () => {
    const runtime = createFc008ExtensionRuntime({
      modelFamily: "joint-logistic",
      bundle: jointBundle(),
    });
    expect(runtime.available).toBe(false);
    expect(runtime.unavailableReason).toBe("policy-invalid");
  });

  it("fails closed on family/bundle mismatch", () => {
    const runtime = createFc008ExtensionRuntime({
      modelFamily: "factorized-logistic",
      bundle: jointBundle(),
      supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
    });
    expect(runtime.available).toBe(false);
    expect(runtime.unavailableReason).toBe("family-bundle-mismatch");
    const failed = runtime.understandMessage({}).result;
    expect(failed?.outcome).toBe("failed");
    if (failed?.outcome === "failed") {
      expect(failed.code).toBe("MODEL_UNAVAILABLE");
    }
  });
});

describe("honest mapper", () => {
  const now = "2026-10-08T00:00:00.000Z" as IsoTimestamp;

  it("does not read fixture metadata into primary ML features", () => {
    expect(() =>
      mapBrowserObservationToMessage(trapFixtureMetadata(deleteFileLinkObservation()), 1, now),
    ).not.toThrow();
    expect(() =>
      mapBrowserObservationToMessage(trapFixtureMetadata(capturedObservation()), 1, now),
    ).not.toThrow();
  });

  it("does not produce delete/file ctl tokens from operation=delete-file", () => {
    const mapped = mapBrowserObservationToMessage(deleteFileLinkObservation(), 1, now);
    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      throw new Error("delete-file operation must not produce a primary observation");
    }
  });

  it("does not produce repository/visibility/change tokens from fixture operation", () => {
    const mapped = mapBrowserObservationToMessage(
      capturedObservation({
        metadata: { operation: "repository.visibility.change" },
      }),
      1,
      now,
    );
    expect(mapped.ok).toBe(false);
  });

  it("leaves the refused mapping unchanged when only metadata.operation changes", () => {
    const first = mapBrowserObservationToMessage(capturedObservation(), 1, now);
    const second = mapBrowserObservationToMessage(
      capturedObservation({ metadata: { operation: "delete-file" } }),
      1,
      now,
    );
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
  });

  it("does not emit visibility state from currentVisibility", () => {
    const privateState = mapBrowserObservationToMessage(
      capturedObservation({ metadata: { currentVisibility: "private" } }),
      1,
      now,
    );
    const publicState = mapBrowserObservationToMessage(
      capturedObservation({ metadata: { currentVisibility: "public" } }),
      1,
      now,
    );
    expect(privateState).toEqual(publicState);
    expect(privateState.ok).toBe(false);
  });

  it("does not emit a fabricated ancestorDepth/surfaceDepth observation", () => {
    const mapped = mapBrowserObservationToMessage(capturedObservation(), 1, now);
    expect(mapped.ok).toBe(false);
    const source = readFileSync(
      new URL("../src/fc008/browser-observation-map.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    expect(code).not.toMatch(/ancestorDepth/);
    expect(code).not.toMatch(/surfaceDepth/);
    expect(source).toMatch(/surface-depth:0/);
  });
});

describe("sanitized observation path", () => {
  const ARTIFACT_FILES = [
    ["fc008-joint-logistic-model.json", FROZEN_BROWSER_ARTIFACT_SHA256.jointModel],
    ["fc008-joint-logistic-calibration.json", FROZEN_BROWSER_ARTIFACT_SHA256.jointCalibration],
    ["fc008-joint-logistic-policy.json", FROZEN_BROWSER_ARTIFACT_SHA256.jointPolicy],
    ["fc008-factorized-logistic-model.json", FROZEN_BROWSER_ARTIFACT_SHA256.factorizedModel],
    [
      "fc008-factorized-logistic-calibration.json",
      FROZEN_BROWSER_ARTIFACT_SHA256.factorizedCalibration,
    ],
    ["fc008-factorized-logistic-policy.json", FROZEN_BROWSER_ARTIFACT_SHA256.factorizedPolicy],
  ] as const;

  it("attests all six browser frozen artifact copies against Sprint-3 bytes", () => {
    for (const [fileName, expected] of ARTIFACT_FILES) {
      expect(sha256File(ARTIFACT_DIRECTORY, fileName)).toBe(expected);
      expect(sha256File(FROZEN_DIRECTORY, fileName)).toBe(expected);
      expect(sha256File(FROZEN_DIRECTORY, fileName)).toBe(sha256File(ARTIFACT_DIRECTORY, fileName));
    }
  });

  it("maps a browser observation without private fields and refuses invented semantics", () => {
    const captured = capturedObservation();
    const mapped = mapBrowserObservationToMessage(
      captured,
      1,
      "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    );
    expect(mapped.ok).toBe(false);
    const runtime = readyRuntime("joint-logistic");
    expect(runtime.available).toBe(true);
    const state = runtime.understandBrowserObservation(captured, 1);
    expect(state.result?.outcome).not.toBe("failed");
    expect(state.result).toBeNull();
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("exercises the factorized family through the same honest path", () => {
    const runtime = readyRuntime("factorized-logistic");
    const state = runtime.understandBrowserObservation(capturedObservation(), 1);
    expect(state.result?.outcome).not.toBe("failed");
    expect(state.result).toBeNull();
  });

  it("propagates timeout without retry and asserts MODEL_TIMEOUT on every call", () => {
    let providerSpans = 0;
    const clock = {
      nowMs(): number {
        providerSpans += 1;
        return providerSpans % 2 === 1 ? 0 : 251;
      },
    };
    const runtime = createFc008ExtensionRuntime({
      modelFamily: "joint-logistic",
      bundle: jointBundle(),
      supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
      clock,
      now: () => "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    });
    const first = runtime.understandMessage(syntheticUnderstandMessage(1));
    expect(first.result?.outcome).toBe("failed");
    if (first.result?.outcome !== "failed") {
      throw new Error("first timeout must fail");
    }
    expect(first.result.code).toBe("MODEL_TIMEOUT");
    const readsAfterFirst = providerSpans;
    const second = runtime.understandMessage(syntheticUnderstandMessage(2));
    expect(second.result?.outcome).toBe("failed");
    if (second.result?.outcome !== "failed") {
      throw new Error("second timeout must fail");
    }
    expect(second.result.code).toBe("MODEL_TIMEOUT");
    expect(providerSpans - readsAfterFirst).toBe(readsAfterFirst);
    expect(readsAfterFirst).toBe(2);
  });

  it("uses Date.now when performance.now is unavailable so the deadline can fire", () => {
    const readings = [0, 251];
    let index = 0;
    const clock = createExtensionHostClock(null, () => {
      const value = readings[Math.min(index, readings.length - 1)] as number;
      index += 1;
      return value;
    });
    const runtime = createFc008ExtensionRuntime({
      modelFamily: "joint-logistic",
      bundle: jointBundle(),
      supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
      clock,
      now: () => "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    });
    const state = runtime.understandMessage(syntheticUnderstandMessage(1));
    expect(state.result?.outcome).toBe("failed");
    if (state.result?.outcome !== "failed") {
      throw new Error("fallback-clock timeout must fail");
    }
    expect(state.result.code).toBe("MODEL_TIMEOUT");
  });
});

describe("supersession and reset", () => {
  it("keeps a newer observation and clears on removal, navigation, and dispose", () => {
    const runtime = readyRuntime();
    runtime.understandMessage(syntheticUnderstandMessage(2));
    const older = runtime.understandMessage(syntheticUnderstandMessage(1));
    expect(older.observationSequence).toBe(2);
    expect(runtime.clear().indicator.predictionStatus).toBe("none");
    runtime.understandMessage(syntheticUnderstandMessage(4));
    expect(runtime.invalidateObservation().result).toBeNull();
    runtime.understandMessage(syntheticUnderstandMessage(5));
    runtime.dispose();
    const after = runtime.understandMessage(syntheticUnderstandMessage(6));
    expect(after.result?.outcome).toBe("failed");
  });

  it("keeps clear() and currentState() coherent when the host is unavailable", () => {
    const runtime = createFc008ExtensionRuntime();
    expect(runtime.available).toBe(false);
    expect(runtime.currentState().result?.outcome).toBe("failed");
    const cleared = runtime.clear();
    expect(cleared.result).toBeNull();
    expect(cleared.indicator.predictionStatus).toBe("none");
    expect(runtime.currentState()).toBe(cleared);
    expect(runtime.currentState().result).toBeNull();
  });
});

describe("production FC-005 handoff", () => {
  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
  }
  class MockElement extends MockNode {
    tagName = "BUTTON";
    parentElement: MockElement | null = null;
    getAttribute(_name: string): string | null {
      return null;
    }
  }
  class MockHTMLButtonElement extends MockElement {
    type = "button";
    disabled = false;
    id = "";
    name = "";
    className = "";
    override getAttribute(attr: string): string | null {
      if (attr === ATTR_FIXTURE_CONTRACT) return "fc005.repository-visibility.v1";
      if (attr === ATTR_OPERATION) return "repository.visibility.change";
      if (attr === ATTR_ENTITY_KEY) return "fixture-repository";
      if (attr === ATTR_CURRENT_VISIBILITY) return "private";
      if (attr === ATTR_REQUESTED_VISIBILITY) return "public";
      return null;
    }
  }

  let origWindow: unknown;
  let origNode: unknown;
  let origElement: unknown;
  let origHTMLButtonElement: unknown;
  let origDocument: unknown;

  beforeEach(() => {
    origWindow = globalThis.window;
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origDocument = globalThis.document;
    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = {};
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  function mockButton(): MockHTMLButtonElement {
    const button = new MockHTMLButtonElement();
    button.ownerDocument = globalThis.document;
    button.isConnected = true;
    return button;
  }

  it("hands the exact captured BrowserObservation to an optional sidecar", () => {
    const received: unknown[] = [];
    const sidecar: ActionUnderstandingSidecar = {
      observe(observation) {
        received.push(observation);
      },
      clear() {},
    };
    const captureSpy = vi.spyOn(capture, "captureButtonObservation");
    const controller = new BrowserExtensionController(undefined, undefined, undefined, sidecar);
    controller.start();
    const button = mockButton();
    controller.handleDocumentClick({ target: button as unknown as EventTarget } as MouseEvent);
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(captureSpy.mock.results[0]?.value);
    captureSpy.mockRestore();
  });

  it("leaves FC-005 behavior unchanged when the sidecar is absent", () => {
    const controller = new BrowserExtensionController();
    const startCalls: number[] = [];
    controller.start();
    startCalls.push(controller.getRequestSequence());
    controller.handleDocumentClick({
      target: mockButton() as unknown as EventTarget,
    } as MouseEvent);
    expect(controller.getRequestSequence()).toBe(1);
    expect(tryCreateFc008ActionUnderstandingSidecar()).toBeUndefined();
  });

  it("constructs a local frozen runtime only when family and gates are explicit", () => {
    expect(tryCreateFc008ActionUnderstandingSidecar()).toBeUndefined();
    expect(
      tryCreateFc008ActionUnderstandingSidecar({
        hostConfig: {
          modelFamily: "joint-logistic",
          supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
        },
      }),
    ).toBeUndefined();
    const sidecar = tryCreateFc008ActionUnderstandingSidecar({
      hostConfig: {
        modelFamily: "joint-logistic",
        supportGates: FC008_DEVELOPMENT_SUPPORT_GATES,
      },
      artifactJson: readFrozenBrowserArtifactJson("joint-logistic"),
      clock: createScriptedClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      now: () => "2026-10-08T00:00:00.000Z" as IsoTimestamp,
    });
    expect(sidecar).toBeDefined();
    if (sidecar === undefined) {
      return;
    }
    expect(sidecar.runtime.available).toBe(true);
    const received: unknown[] = [];
    const wrapped = {
      runtime: sidecar.runtime,
      observe(observation: BrowserObservation) {
        received.push(observation);
        sidecar.observe(observation);
      },
      clear() {
        sidecar.clear();
      },
    };
    const controller = new BrowserExtensionController(undefined, undefined, undefined, wrapped);
    controller.start();
    const captureSpy = vi.spyOn(capture, "captureButtonObservation");
    controller.handleDocumentClick({
      target: mockButton() as unknown as EventTarget,
    } as MouseEvent);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(captureSpy.mock.results[0]?.value);
    expect(sidecar.runtime.currentState().result?.outcome).not.toBe("failed");
    captureSpy.mockRestore();
  });
});

describe("isolation, permissions, and persistence", () => {
  it("does not expand extension permissions", () => {
    expect(manifest.permissions).toEqual([]);
    expect((manifest as Record<string, unknown>).host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toHaveLength(3);
    expect(manifest.content_scripts[0]?.js).toEqual(["content.bundle.js"]);
    expect(
      manifest.content_scripts.some((script) => script.js.includes("fc008-bridge.bundle.js")),
    ).toBe(false);
    const forbidden = [
      "tabs",
      "history",
      "downloads",
      "clipboardRead",
      "clipboardWrite",
      "webRequest",
      "nativeMessaging",
      "storage",
    ];
    for (const permission of forbidden) {
      expect(manifest.permissions).not.toContain(permission);
    }
  });

  it("imports no FC-007 authority and writes no storage or network", () => {
    const files = [
      "index.ts",
      "host-config.ts",
      "bundled-source.ts",
      "browser-observation-map.ts",
      "extension-host.ts",
      "production-sidecar.ts",
      "frozen-artifact-json.ts",
    ];
    const importLines = files
      .map((name) => readFileSync(new URL(`../src/fc008/${name}`, import.meta.url), "utf8"))
      .join("\n")
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(
      /fc007|verified-decision|continue-validator|release-attempt|release-interceptor|native-click/i,
    );
    const source = files
      .map((name) => readFileSync(new URL(`../src/fc008/${name}`, import.meta.url), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|chrome\.storage/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/\beval\s*\(|new Function/);
    expect(source).not.toMatch(/requestSubmit|form\.submit|dispatchEvent/);
    expect(source).not.toMatch(/final-evaluation|won|lost|best model/i);
  });

  it("FC-007 sources do not import FC-008 prediction as VERIFIED truth", () => {
    const fc007 = [
      "verified-decision.ts",
      "continue-validator.ts",
      "release-attempt.ts",
      "release-interceptor.ts",
      "native-click-executor.ts",
      "passive-controller.ts",
    ]
      .map((name) => readFileSync(new URL(`../src/fc007/${name}`, import.meta.url), "utf8"))
      .join("\n");
    expect(fc007).not.toMatch(/action-understanding|fc008|BrowserActionUnderstandingBridge/);
  });

  it("content controller does not import FC-008 policy", () => {
    const controller = readFileSync(
      new URL("../src/content/controller.ts", import.meta.url),
      "utf8",
    );
    expect(controller).not.toMatch(/action-understanding|createFc008|modelFamily/);
    const importLines = controller
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/fc008|action-understanding/);
  });
});

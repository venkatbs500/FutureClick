/**
 * FC-007 Sprint 1C — current-state freshness guard regressions.
 */

import { describe, expect, it } from "vitest";
import type { ConsequenceAssessment } from "@futureclick/action-schema";
import { MAIN_MAX_ELEMENTS } from "../src/fc007/budget.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { CURRENT_PRIVATE_TEXT } from "../src/fc007/visibility-section.js";
import { createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

const fakeAssessment = {
  consequences: [{ evidence: [{ mode: "verified" }] }],
} as unknown as ConsequenceAssessment;

async function reachEvaluated(options?: {
  readonly locationProvider?: () => {
    protocol: string;
    hostname: string;
    port: string;
    pathname: string;
  };
}): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly evalCount: { n: number };
}> {
  const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
  const evalCount = { n: 0 };
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    ...(options?.locationProvider ? { locationProvider: options.locationProvider } : {}),
    requireTopFrame: false,
    recognitionVersion: "v1",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    evaluateFn: async () => {
      evalCount.n += 1;
      return { ok: true, value: fakeAssessment };
    },
  });
  controller.start();
  await controller.attemptFullRecognition();
  expect(controller.getState().kind).toBe("evaluated");
  expect(controller.getLastObservation()).not.toBeNull();
  expect(controller.getLastEvaluation()).not.toBeNull();
  return { controller, document: doc, evalCount };
}

function privateTextNode(doc: Document): Text {
  const priv = Array.from(doc.querySelectorAll("div")).find(
    (d) => d.textContent?.trim() === CURRENT_PRIVATE_TEXT,
  );
  if (!priv) throw new Error("missing private div");
  const text = Array.from(priv.childNodes).find((n) => n.nodeType === 3);
  if (!text || text.nodeType !== 3) throw new Error("missing private text node");
  return text as Text;
}

describe("FC-007 Sprint 1C current-state freshness", () => {
  it("Text.data mutation → getState() first invalidates", async () => {
    const { controller, document: doc } = await reachEvaluated();
    privateTextNode(doc).data = "This repository is currently PUBLIC.";
    // No manual attemptFullRecognition / invalidate.
    expect(controller.getState().kind === "evaluated").toBe(false);
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });

  it("Text.data mutation → getLastObservation() first invalidates", async () => {
    const { controller, document: doc } = await reachEvaluated();
    privateTextNode(doc).data = "This repository is currently PUBLIC.";
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("Text.data mutation → getLastEvaluation() first invalidates", async () => {
    const { controller, document: doc } = await reachEvaluated();
    privateTextNode(doc).data = "This repository is currently PUBLIC.";
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("button.disabled = true → current getter clears evaluation", async () => {
    const { controller, document: doc } = await reachEvaluated();
    const button = doc.getElementById("final-make-public");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing button");
    button.disabled = true;
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("disabled attribute via setAttribute → current getter clears", async () => {
    const { controller, document: doc } = await reachEvaluated();
    const button = doc.getElementById("final-make-public");
    if (!button) throw new Error("missing button");
    button.setAttribute("disabled", "");
    expect(controller.getState().kind === "evaluated").toBe(false);
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    controller.stop();
  });

  it("append <confirm-widget> → current getter clears", async () => {
    const { controller, document: doc } = await reachEvaluated();
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    dialog.appendChild(doc.createElement("confirm-widget"));
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("unmutated evaluated: repeated getters keep state; no evaluation storm", async () => {
    const { controller, evalCount } = await reachEvaluated();
    const afterRecognize = evalCount.n;
    expect(afterRecognize).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 5; i += 1) {
      expect(controller.getState().kind).toBe("evaluated");
      expect(controller.getLastObservation()).not.toBeNull();
      expect(controller.getLastEvaluation()).not.toBeNull();
    }
    expect(evalCount.n).toBe(afterRecognize);
    controller.stop();
  });

  it("over-budget fresh capture on current read invalidates", async () => {
    const { controller, document: doc } = await reachEvaluated();
    const main = doc.querySelector("main");
    if (!main) throw new Error("missing main");
    // Pad main beyond MAIN_MAX_ELEMENTS with a single-child chain.
    let cur: Element = main;
    for (let i = 0; i < MAIN_MAX_ELEMENTS + 8; i += 1) {
      const d = doc.createElement("div");
      cur.appendChild(d);
      cur = d;
    }
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("route change → current getter rejects stale", async () => {
    let pathname = "/fixture-owner/fixture-repo/settings";
    const { controller } = await reachEvaluated({
      locationProvider: () => ({
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname,
      }),
    });
    pathname = "/fixture-owner/fixture-repo/settings/actions";
    expect(controller.getLastObservation()).toBeNull();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("locale fr → current getter rejects stale", async () => {
    const { controller, document: doc } = await reachEvaluated();
    doc.documentElement.lang = "fr";
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });
});

/**
 * FC-007H V2 current-state freshness — scoped acquisition.
 */

import { describe, expect, it } from "vitest";
import type { ConsequenceAssessment } from "@futureclick/action-schema";
import { MAIN_MAX_ELEMENTS_V2 } from "../src/fc007/budget.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { CURRENT_PRIVATE_TEXT } from "../src/fc007/visibility-section.js";
import {
  countElementVisits,
  createFc007V2SettingsWindow,
  testMatchesModal,
} from "./fc007-test-dom.js";

const fakeAssessment = {
  consequences: [{ evidence: [{ mode: "verified" }] }],
} as unknown as ConsequenceAssessment;

async function reachV2Evaluated(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    evaluateFn: async () => ({ ok: true, value: fakeAssessment }),
  });
  controller.start();
  await controller.attemptFullRecognition();
  expect(controller.getState().kind).toBe("evaluated");
  expect(controller.getLastObservation()).not.toBeNull();
  return { controller, document: doc };
}

describe("FC-007H V2 scoped freshness", () => {
  it("anchor removal invalidates via current getter", async () => {
    const { controller, document: doc } = await reachV2Evaluated();
    doc.querySelector("#visibility-section strong")?.remove();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("private signal removal invalidates", async () => {
    const { controller, document: doc } = await reachV2Evaluated();
    const priv = Array.from(doc.querySelectorAll("#visibility-section div")).find(
      (d) => d.childNodes.length === 1 && d.textContent?.trim() === CURRENT_PRIVATE_TEXT,
    );
    expect(priv).toBeTruthy();
    priv?.remove();
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    controller.stop();
  });

  it("LI relationship change invalidates", async () => {
    const { controller, document: doc } = await reachV2Evaluated();
    const strong = doc.querySelector("#visibility-section strong");
    const main = doc.querySelector("main");
    expect(strong && main).toBeTruthy();
    if (!strong || !main) return;
    // Move anchor outside any LI.
    const orphan = doc.createElement("div");
    orphan.appendChild(strong);
    main.appendChild(orphan);
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("main exceeding MAIN_MAX_ELEMENTS_V2 invalidates", async () => {
    const { controller, document: doc } = await reachV2Evaluated();
    const main = doc.querySelector("main");
    expect(main).toBeTruthy();
    if (!main) return;
    let visits = countElementVisits(main);
    while (visits < MAIN_MAX_ELEMENTS_V2 + 1) {
      main.appendChild(doc.createElement("span"));
      visits += 1;
    }
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getLastObservation()).toBeNull();
    expect(["contract-recognized", "evaluated"]).not.toContain(controller.getState().kind);
    controller.stop();
  });

  it("does not fall back to V1 on V2 abstain", async () => {
    const { controller, document: doc } = await reachV2Evaluated();
    doc.querySelector("#visibility-section strong")?.remove();
    // Compact V1-shaped residual would still lack STRONG; ensure state cleared and version stays V2.
    expect(controller.getLastObservation()).toBeNull();
    expect((controller as unknown as { recognitionVersion: string }).recognitionVersion).toBe("v2");
    controller.stop();
  });
});

/**
 * FC-007 V2 stage B/C/D contract recognition tests.
 */

import { describe, expect, it } from "vitest";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { FC007_V2_CONTRACT_ID } from "../src/fc007/v2/github-observation-v2.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 V2 stage recognition", () => {
  it("Stage A — settings-private without modal", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "a",
      openDialog: false,
    });
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.value.stage).toBe("settings-private");
    expect(result.value.observation.stage).toBe("settings-private");
    expect(result.value.observation.contractId).toBe(FC007_V2_CONTRACT_ID);
    expect(result.value.dialog).toBeUndefined();
  });

  it("Stage B — intent confirmation", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "b" });
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.value.stage).toBe("intent-confirmation");
    expect(result.value.observation.buttonSemantics).toBe("acknowledgement");
  });

  it("Stage C — effects acknowledgement", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "c" });
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.value.stage).toBe("effects-acknowledgement");
  });

  it("Stage D — final confirmation with form refs", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.value.stage).toBe("final-confirmation");
    expect(result.value.finalButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.value.form).toBeInstanceOf(HTMLFormElement);
    expect(result.value.observation.readiness).toBe("enabled");
  });

  it("A/B/C/D all use scoped acquisition with target after old 512 boundary", () => {
    for (const stage of ["a", "b", "c", "d"] as const) {
      const { document: doc, location } = createFc007V2SettingsWindow({
        stage,
        openDialog: stage !== "a",
      });
      const main = doc.querySelector("main");
      expect(main).toBeTruthy();
      if (!main) return;
      const strong = main.querySelector("#visibility-section strong");
      expect(strong).toBeTruthy();
      let visits = 0;
      const walker = doc.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
      let node: Node | null = walker.currentNode;
      while (node) {
        if (node instanceof Element) {
          visits += 1;
          if (node === strong) break;
        }
        node = walker.nextNode();
      }
      expect(visits).toBeGreaterThan(512);

      const result = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      });
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        const heading = result.value.session.visibilitySection.querySelector("strong");
        expect(heading?.tagName.toUpperCase()).toBe("STRONG");
        expect(result.value.session.privateStateElement).toBeInstanceOf(HTMLDivElement);
      }
    }
  });

  it("abstains when modal open but stage unmatched", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "b" });
    const dialog = doc.getElementById("visibility-dialog");
    dialog?.querySelector("#stage-b-ack")?.remove();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(result.status).toBe("abstain");
  });
});

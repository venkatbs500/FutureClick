/**
 * FC-007 V2 dialog inventory tests.
 */

import { describe, expect, it } from "vitest";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { inventorySoleActualModal, recognizeStageD } from "../src/fc007/v2/dialog-inventory-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  testMatchesModal,
} from "./fc007-test-dom.js";

describe("FC-007 V2 dialog inventory", () => {
  it("finds exactly one actual modal among four dialogs", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const result = inventorySoleActualModal(doc, testMatchesModal);
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.value.id).toBe("visibility-dialog");
  });

  it("abstains when five dialogs exceed collection cap", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    doc.body.appendChild(doc.createElement("dialog"));
    const result = inventorySoleActualModal(doc, testMatchesModal);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
    }
  });

  it("abstains MULTIPLE_ACTUAL_MODALS when two dialogs are open", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    doc.getElementById("empty-dialog-2")?.remove();
    const extra = doc.createElement("dialog");
    extra.setAttribute("aria-modal", "true");
    extra.setAttribute("open", "");
    extra.open = true;
    doc.body.appendChild(extra);
    expect(doc.getElementsByTagName("dialog").length).toBe(4);
    const result = inventorySoleActualModal(doc, testMatchesModal);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("MULTIPLE_ACTUAL_MODALS");
    }
  });

  it("returns settings-private when no actual modal is open", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "a",
      openDialog: false,
    });
    const modal = inventorySoleActualModal(doc, testMatchesModal);
    expect(modal.status).toBe("abstain");
    if (modal.status === "abstain") {
      expect(modal.reason).toBe("NO_ACTUAL_MODAL");
    }
    const contract = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(contract.status).toBe("matched");
    if (contract.status === "matched") {
      expect(contract.value.stage).toBe("settings-private");
    }
  });

  it("allows inactive dialogs within cap alongside one actual modal", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const inactive = doc.getElementById("empty-dialog-0");
    expect(inactive instanceof HTMLDialogElement).toBe(true);
    if (inactive instanceof HTMLDialogElement) {
      expect(inactive.open).toBe(false);
    }
    const result = inventorySoleActualModal(doc, testMatchesModal);
    expect(result.status).toBe("matched");
    expect(doc.getElementsByTagName("dialog").length).toBe(4);
  });

  it("Stage D requires effects region inside modal", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const modal = inventorySoleActualModal(doc, testMatchesModal);
    expect(modal.status).toBe("matched");
    if (modal.status !== "matched") return;
    doc.querySelector('[aria-label="Effects of making this repository public"]')?.remove();
    const stageD = recognizeStageD(modal.value, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
  });

  it("Stage-D still rejects unknown custom interactive controls", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const modal = inventorySoleActualModal(doc, testMatchesModal);
    expect(modal.status).toBe("matched");
    if (modal.status !== "matched") return;
    const form = doc.getElementById("visibility-form");
    // insertBefore(form): happy-dom dialog.appendChild after <form> breaks nextSibling.
    modal.value.insertBefore(doc.createElement("confirm-widget"), form);
    const stageD = recognizeStageD(modal.value, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_UNSUPPORTED_INTERACTIVE");
    }
  });
});

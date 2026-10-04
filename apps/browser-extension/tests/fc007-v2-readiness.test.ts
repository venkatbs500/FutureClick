/**
 * FC-007 V2 Stage D readiness / final-button tests.
 */

import { describe, expect, it } from "vitest";
import { recognizeFormContractV2 } from "../src/fc007/v2/form-contract-v2.js";
import { recognizeStageD } from "../src/fc007/v2/dialog-inventory-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  getStageDFormRefs,
  testMatchesModal,
} from "./fc007-test-dom.js";

describe("FC-007 V2 Stage D readiness", () => {
  it("abstains when final submit is disabled", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const { form, final, close } = getStageDFormRefs(doc);
    final.disabled = true;
    const disabledResult = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(disabledResult.status).toBe("abstain");
    if (disabledResult.status === "abstain") {
      expect(disabledResult.reason).toBe("BUTTON_DISABLED");
    }
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
  });

  it("abstains when final submit has aria-disabled", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const { form, final, close } = getStageDFormRefs(doc);
    final.setAttribute("aria-disabled", "true");
    const ariaResult = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(ariaResult.status).toBe("abstain");
    if (ariaResult.status === "abstain") {
      expect(ariaResult.reason).toBe("BUTTON_ARIA_DISABLED");
    }
  });

  it("abstains when final control is type=button not submit", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const final = doc.getElementById("final-make-public");
    if (final instanceof HTMLButtonElement) {
      final.type = "button";
    }
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_FINAL_BUTTON_COUNT");
    }
  });

  it("abstains on duplicate final submit buttons in dialog walk", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const final = doc.getElementById("final-make-public");
    if (!(final instanceof HTMLButtonElement)) throw new Error("missing final");
    const dup = final.cloneNode(true) as HTMLButtonElement;
    dup.id = "final-dup";
    final.parentElement?.appendChild(dup);
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_FINAL_BUTTON_COUNT");
    }
  });
});

/**
 * FC-007 form contract + readiness + inventory tests (M2).
 */

import { describe, expect, it } from "vitest";
import { inventorySupportedVisibilityDialog } from "../src/fc007/dialog-inventory.js";
import { isButtonEffectivelyEnabled, recognizeFormContract } from "../src/fc007/form-contract.js";
import { FIXTURE_IDENTITY, createFc007SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

describe("FC-007 button readiness", () => {
  it("requires disabled false, :disabled false, aria-disabled not true", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    expect(isButtonEffectivelyEnabled(button).ok).toBe(true);

    button.disabled = true;
    expect(isButtonEffectivelyEnabled(button).ok).toBe(false);
    button.disabled = false;

    button.setAttribute("aria-disabled", "true");
    expect(isButtonEffectivelyEnabled(button).ok).toBe(false);
  });
});

describe("FC-007 form contract", () => {
  it("accepts supported POST set_visibility form", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    const r = recognizeFormContract(button, form, FIXTURE_IDENTITY, doc);
    expect(r.status).toBe("matched");
  });

  it("rejects GET, wrong path, query, fragment, overrides, novalidate, submitter name", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const form = doc.getElementById("visibility-form") as HTMLFormElement;

    form.setAttribute("method", "get");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.setAttribute("method", "post");

    form.setAttribute(
      "action",
      "https://github.com/fixture-owner/fixture-repo/settings/set_visibility?x=1",
    );
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.setAttribute(
      "action",
      "https://github.com/fixture-owner/fixture-repo/settings/set_visibility",
    );

    form.setAttribute("target", "_blank");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.removeAttribute("target");

    form.noValidate = true;
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.noValidate = false;

    button.setAttribute("formaction", "https://github.com/x");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.removeAttribute("formaction");

    button.name = "commit";
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.name = "";
  });

  it("rejects nonempty base target", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const base = doc.createElement("base");
    base.setAttribute("target", "_blank");
    doc.head.appendChild(base);
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
  });

  it("rejects unsupported form controls and never reads hidden values", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const text = doc.createElement("input");
    text.type = "text";
    form.appendChild(text);
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    text.remove();

    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("matched");
    expect(JSON.stringify(r)).not.toContain("dummy-not-read");
  });

  it("rejects form.elements length > 24", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    for (let i = 0; i < 24; i += 1) {
      const h = doc.createElement("input");
      h.type = "hidden";
      form.appendChild(h);
    }
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
  });

  it("rejects confirmation text input inside dialog", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog") as HTMLDialogElement;
    const input = doc.createElement("input");
    input.setAttribute("type", "text");
    input.setAttribute("name", "confirm");
    dialog.appendChild(input);
    expect(dialog.querySelector('input[type="text"]')).not.toBeNull();
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status, JSON.stringify(r)).toBe("abstain");
  });

  it("rejects password confirmation variant inside form inventory", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    const pw = doc.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    const r = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(r.status).toBe("abstain");
  });

  it("rejects textarea, select, contenteditable, and duplicate final submit", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog") as HTMLDialogElement;

    const ta = doc.createElement("textarea");
    dialog.appendChild(ta);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
    ta.remove();

    const sel = doc.createElement("select");
    dialog.appendChild(sel);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
    sel.remove();

    const editable = doc.createElement("div");
    editable.setAttribute("contenteditable", "true");
    dialog.appendChild(editable);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
    editable.remove();

    const dup = doc.createElement("button");
    dup.type = "submit";
    dup.textContent = "Make this repository public";
    const form = doc.getElementById("visibility-form") as HTMLFormElement;
    form.appendChild(dup);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
  });

  it("rejects wrong enctype, credentials in action, formmethod/formtarget/formenctype, formNoValidate", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const form = doc.getElementById("visibility-form") as HTMLFormElement;

    form.setAttribute("enctype", "multipart/form-data");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.setAttribute("enctype", "application/x-www-form-urlencoded");

    form.setAttribute(
      "action",
      "https://user:pass@github.com/fixture-owner/fixture-repo/settings/set_visibility",
    );
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    form.setAttribute(
      "action",
      "https://github.com/fixture-owner/fixture-repo/settings/set_visibility",
    );

    button.setAttribute("formmethod", "post");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.removeAttribute("formmethod");

    button.setAttribute("formtarget", "_self");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.removeAttribute("formtarget");

    button.setAttribute("formenctype", "application/x-www-form-urlencoded");
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.removeAttribute("formenctype");

    button.formNoValidate = true;
    expect(recognizeFormContract(button, form, FIXTURE_IDENTITY, doc).status).toBe("abstain");
    button.formNoValidate = false;
  });

  it("abstains when :disabled matching throws", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const button = doc.getElementById("final-make-public") as HTMLButtonElement;
    const original = button.matches.bind(button);
    button.matches = ((sel: string) => {
      if (sel === ":disabled") throw new Error("unsupported");
      return original(sel);
    }) as typeof button.matches;
    expect(isButtonEffectivelyEnabled(button).ok).toBe(false);
    expect(isButtonEffectivelyEnabled(button).reason).toBe("DISABLED_PSEUDO_UNSUPPORTED");
  });
});

/**
 * FC-007 V2 form contract + Close V2 tests.
 */

import { describe, expect, it } from "vitest";
import { isApprovedCloseControlV2 } from "../src/fc007/v2/close-v2.js";
import { recognizeFormContractV2 } from "../src/fc007/v2/form-contract-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  getStageDFormRefs,
} from "./fc007-test-dom.js";

function loadStageD(): {
  doc: Document;
  form: HTMLFormElement;
  final: HTMLButtonElement;
  close: HTMLButtonElement;
} {
  const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
  const { form, final, close } = getStageDFormRefs(doc);
  return { doc, form, final, close };
}

describe("FC-007 V2 form + Close", () => {
  it("requires Close.form === retainedForm", () => {
    const { doc, form, final, close } = loadStageD();
    expect(isApprovedCloseControlV2(close, doc, form, final)).toBe(true);
    form.removeChild(close);
    doc.body.appendChild(close);
    expect(isApprovedCloseControlV2(close, doc, form, final)).toBe(false);
  });

  it("passes with zero hidden inputs", () => {
    const { doc, form, final, close } = loadStageD();
    for (const input of Array.from(form.querySelectorAll('input[type="hidden"]'))) {
      input.remove();
    }
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.value.hiddenInputCount).toBe(0);
    }
  });

  it("passes with eight hidden inputs", () => {
    const { doc, form, final, close } = loadStageD();
    for (let i = 0; i < 5; i += 1) {
      const hidden = doc.createElement("input");
      hidden.type = "hidden";
      hidden.name = `pad-${i}`;
      form.insertBefore(hidden, final);
    }
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.value.hiddenInputCount).toBe(8);
    }
  });

  it("rejects nine hidden inputs", () => {
    const { doc, form, final, close } = loadStageD();
    for (let i = 0; i < 6; i += 1) {
      const hidden = doc.createElement("input");
      hidden.type = "hidden";
      hidden.name = `extra-${i}`;
      form.insertBefore(hidden, final);
    }
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_HIDDEN_TOO_MANY");
    }
  });

  it("rejects more than 24 form elements", () => {
    const { doc, form, final, close } = loadStageD();
    for (let i = 0; i < 20; i += 1) {
      const hidden = doc.createElement("input");
      hidden.type = "hidden";
      hidden.name = `bulk-${i}`;
      form.insertBefore(hidden, final);
    }
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_ELEMENTS_TOO_MANY");
    }
  });

  it("rejects visible text input", () => {
    const { doc, form, final, close } = loadStageD();
    const visible = doc.createElement("input");
    visible.type = "text";
    form.insertBefore(visible, final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects textarea", () => {
    const { doc, form, final, close } = loadStageD();
    form.insertBefore(doc.createElement("textarea"), final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects select", () => {
    const { doc, form, final, close } = loadStageD();
    form.insertBefore(doc.createElement("select"), final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects fieldset", () => {
    const { doc, form, final, close } = loadStageD();
    form.insertBefore(doc.createElement("fieldset"), final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects object element", () => {
    const { doc, form, final, close } = loadStageD();
    form.insertBefore(doc.createElement("object"), final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects extra non-Close button", () => {
    const { doc, form, final, close } = loadStageD();
    const extra = doc.createElement("button");
    extra.type = "button";
    extra.textContent = "Extra";
    form.insertBefore(extra, final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects duplicate submit button", () => {
    const { doc, form, final, close } = loadStageD();
    const dup = doc.createElement("button");
    dup.type = "submit";
    dup.textContent = "Make this repository public";
    form.insertBefore(dup, final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("rejects formless Close via CLOSE_V2_REJECTED", () => {
    const { doc, form, final, close } = loadStageD();
    form.removeChild(close);
    doc.body.appendChild(close);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("CLOSE_V2_REJECTED");
    }
  });

  it("rejects Close associated with wrong form", () => {
    const { doc, form, final, close } = loadStageD();
    const other = doc.createElement("form");
    other.id = "other-form";
    doc.body.appendChild(other);
    form.removeChild(close);
    other.appendChild(close);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("CLOSE_V2_REJECTED");
    }
  });

  it("rejects Close with wrong aria-label", () => {
    const { doc, form, final, close } = loadStageD();
    close.setAttribute("aria-label", "Dismiss");
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("CLOSE_V2_REJECTED");
    }
  });

  it("rejects zero Close controls", () => {
    const { doc, form, final, close } = loadStageD();
    close.remove();
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("CLOSE_V2_REJECTED");
    }
  });

  it("rejects two Close controls", () => {
    const { doc, form, final, close } = loadStageD();
    const dupClose = close.cloneNode(true) as HTMLButtonElement;
    dupClose.id = "dialog-close-dup";
    form.insertBefore(dupClose, final);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("FORM_CLOSE_COUNT");
    }
  });

  it("rejects Close with formaction override", () => {
    const { doc, form, final, close } = loadStageD();
    close.setAttribute("formaction", "https://github.com/evil");
    expect(isApprovedCloseControlV2(close, doc, form, final)).toBe(false);
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("CLOSE_V2_REJECTED");
    }
  });

  it("accepts three hidden inputs with form-associated Close", () => {
    const { doc, form, final, close } = loadStageD();
    const result = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.value.hiddenInputCount).toBe(3);
    }
  });
});

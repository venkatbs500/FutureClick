/**
 * FC-007H V2 privacy + passive acquisition traps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { recognizeVisibilitySectionV2 } from "../src/fc007/v2/visibility-section-v2.js";
import { createFc007V2SettingsWindow, createV2VisibilityMainOnly } from "./fc007-test-dom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fc007Root = path.resolve(__dirname, "../src/fc007");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(p));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("FC-007H V2 acquisition privacy", () => {
  it("does not read textContent/innerText on unrelated global DIVs during recognition", () => {
    const doc = createV2VisibilityMainOnly({ leadingPadding: 8 });
    const main = doc.querySelector("main");
    expect(main).toBeTruthy();
    if (!main) return;
    const ul = main.querySelector("ul");
    expect(ul).toBeTruthy();
    if (!ul) return;

    const trap = doc.createElement("div");
    Object.defineProperty(trap, "textContent", {
      configurable: true,
      get() {
        throw new Error("TRAP_TEXT_CONTENT");
      },
    });
    Object.defineProperty(trap, "innerText", {
      configurable: true,
      get() {
        throw new Error("TRAP_INNER_TEXT");
      },
    });
    for (let i = 0; i < 40; i += 1) {
      trap.appendChild(doc.createElement("span"));
    }
    main.insertBefore(trap, ul);

    expect(() => recognizeVisibilitySectionV2(doc)).not.toThrow();
    expect(recognizeVisibilitySectionV2(doc).status).toBe("matched");
  });

  it("does not scan every text node / hidden values / button.value", () => {
    const { document: doc } = createFc007V2SettingsWindow({
      stage: "a",
      openDialog: false,
      denseProse: false,
      leadingPadding: 8,
    });
    const hidden = doc.createElement("input");
    hidden.type = "hidden";
    hidden.value = "secret-token-must-not-be-read";
    Object.defineProperty(hidden, "value", {
      configurable: true,
      get() {
        throw new Error("TRAP_HIDDEN_VALUE");
      },
    });
    doc.body.appendChild(hidden);

    const btn = doc.querySelector("#visibility-section button");
    if (btn instanceof HTMLButtonElement) {
      Object.defineProperty(btn, "value", {
        configurable: true,
        get() {
          throw new Error("TRAP_BUTTON_VALUE");
        },
      });
    }

    expect(() => recognizeVisibilitySectionV2(doc)).not.toThrow();
    expect(recognizeVisibilitySectionV2(doc).status).toBe("matched");
  });

  it("production V2 acquisition source avoids textContent/innerText/cookie/network APIs", () => {
    const acq = fs.readFileSync(path.join(fc007Root, "v2/visibility-section-v2.ts"), "utf8");
    expect(acq).not.toMatch(/\.textContent/);
    expect(acq).not.toMatch(/\.innerText/);
    expect(acq).not.toMatch(/cookie/i);
    expect(acq).not.toMatch(/localStorage|sessionStorage/);
    expect(acq).not.toMatch(/\bfetch\s*\(/);
    expect(acq).not.toMatch(/XMLHttpRequest/);
    expect(acq).not.toMatch(/outerHTML|innerHTML/);
  });

  it("V2 tree remains passive-only (no interception / Continue / FC006)", () => {
    const joined = listTsFiles(path.join(fc007Root, "v2"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(joined).not.toMatch(/preventDefault\s*\(/);
    expect(joined).not.toMatch(/stopImmediatePropagation\s*\(/);
    expect(joined).not.toMatch(/requestSubmit\s*\(/);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/XMLHttpRequest/);
    expect(joined).not.toMatch(/fc006/);
    expect(joined).not.toMatch(/Continue/);
    expect(joined).not.toMatch(/releaseCapability|releaseToken/);
  });
});

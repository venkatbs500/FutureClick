/**
 * FC-007 own-text bounds tests (M1-A).
 */

import { describe, expect, it } from "vitest";
import { RecognitionBudget } from "../src/fc007/budget.js";
import { normalizedOwnText } from "../src/fc007/own-text.js";

function el(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  const node = host.firstElementChild;
  if (!node) throw new Error("missing");
  return node;
}

describe("FC-007 normalizedOwnText", () => {
  it("collapses direct text whitespace and ignores nested element text", () => {
    const node = el("<div>  hello   <span>nested</span>  world  </div>");
    const r = normalizedOwnText(node);
    expect(r).toEqual({ status: "ok", text: "hello world" });
  });

  it("accepts 32 direct child nodes and rejects 33", () => {
    const kids32 = Array.from({ length: 32 }, () => "<!--c-->").join("");
    const ok = el(`<div>${kids32}</div>`);
    expect(normalizedOwnText(ok).status).toBe("empty");

    const kids33 = Array.from({ length: 33 }, () => "<!--c-->").join("");
    const over = el(`<div>${kids33}</div>`);
    expect(normalizedOwnText(over)).toEqual({
      status: "over_budget",
      reason: "CHILD_NODES_EXCEEDED",
    });
  });

  it("10_000 children exceed with bounded direct-child walk (no childNodes.length)", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 10_000; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const counter = { count: 0 };
    expect(normalizedOwnText(div, undefined, { inspectionCounter: counter })).toEqual({
      status: "over_budget",
      reason: "CHILD_NODES_EXCEEDED",
    });
    // Cap stop: OWN_TEXT_MAX_CHILD_NODES + 1 overflow-detecting visit.
    expect(counter.count).toBe(33);
  });

  it("accepts 8 text nodes and rejects 9", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 8; i += 1) {
      div.appendChild(document.createTextNode("a"));
      if (i < 7) div.appendChild(document.createComment("x"));
    }
    expect(normalizedOwnText(div).status).toBe("ok");

    const div9 = document.createElement("div");
    for (let i = 0; i < 9; i += 1) {
      div9.appendChild(document.createTextNode("a"));
      div9.appendChild(document.createComment("x"));
    }
    expect(normalizedOwnText(div9).status).toBe("over_budget");
  });

  it("rejects raw text over 160 code units without silent truncation", () => {
    const raw160 = "a".repeat(160);
    const ok = el(`<div>${raw160}</div>`);
    expect(normalizedOwnText(ok)).toEqual({ status: "ok", text: raw160 });

    const raw161 = "a".repeat(161);
    const over = el(`<div>${raw161}</div>`);
    expect(normalizedOwnText(over).status).toBe("over_budget");
  });

  it("counts comment nodes toward child budget and global budget", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 31; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    div.appendChild(document.createTextNode("ok"));
    const budget = new RecognitionBudget(10, 10_000, 100);
    const r = normalizedOwnText(div, budget);
    expect(r.status).toBe("ok");
    expect(budget.elementCount).toBe(0);
  });

  it("does not use subtree textContent for recognition", () => {
    const node = el("<div><span>secret-nested</span></div>");
    expect(normalizedOwnText(node).status).toBe("empty");
    expect((node as HTMLElement).textContent).toContain("secret-nested");
  });
});

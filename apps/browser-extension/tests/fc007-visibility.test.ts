/**
 * FC-007 visibility section recognition tests.
 */

import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_TEXT,
  VISIBILITY_HEADING_TEXT,
  inspectVisibilityLiComplete,
  recognizeVisibilitySection,
} from "../src/fc007/visibility-section.js";
import { createFc007SettingsWindow } from "./fc007-test-dom.js";

function docFromBody(html: string): Document {
  const doc = document.implementation.createHTMLDocument("fc007-vis");
  doc.body.innerHTML = html;
  return doc;
}

describe("FC-007 visibility section", () => {
  it("recognizes exact private signal and heading relationship", () => {
    const { document: doc } = createFc007SettingsWindow();
    const r = recognizeVisibilitySection(doc);
    expect(r.status).toBe("matched");
    if (r.status !== "matched") return;
    expect(r.value.privateStateElement.textContent?.trim()).toBe(CURRENT_PRIVATE_TEXT);
    expect(r.value.headingElement.textContent?.trim()).toBe(VISIBILITY_HEADING_TEXT);
  });

  it("rejects wrong private copy and missing heading", () => {
    expect(
      recognizeVisibilitySection(
        docFromBody(`
      <main><ul><li>
        <h2>Change repository visibility</h2>
        <div>This repository is currently public.</div>
      </li></ul></main>`),
      ).status,
    ).toBe("abstain");

    const r2 = recognizeVisibilitySection(
      docFromBody(`
      <main><ul><li>
        <div>This repository is currently private.</div>
      </li></ul></main>`),
    );
    expect(r2.status).toBe("abstain");
  });

  it("rejects duplicate private signals in different LIs", () => {
    expect(
      recognizeVisibilitySection(
        docFromBody(`
      <main><ul>
        <li><h2>Change repository visibility</h2><div>This repository is currently private.</div></li>
        <li><h2>Change repository visibility</h2><div>This repository is currently private.</div></li>
      </ul></main>`),
      ).status,
    ).toBe("abstain");
  });

  it("rejects private DIV beyond 4 hops to LI", () => {
    const li = document.createElement("li");
    let cur: Element = li;
    for (let i = 0; i < 5; i += 1) {
      const wrap = document.createElement("div");
      cur.appendChild(wrap);
      cur = wrap;
    }
    const heading = document.createElement("h2");
    heading.textContent = VISIBILITY_HEADING_TEXT;
    li.appendChild(heading);
    const priv = document.createElement("div");
    priv.textContent = CURRENT_PRIVATE_TEXT;
    cur.appendChild(priv);
    const r = inspectVisibilityLiComplete(li);
    expect(r.status).toBe("abstain");
  });

  it("partial-scan: early private match cannot accept when section budget would overflow", () => {
    const li = document.createElement("li");
    const heading = document.createElement("h2");
    heading.textContent = VISIBILITY_HEADING_TEXT;
    li.appendChild(heading);
    const priv = document.createElement("div");
    priv.textContent = CURRENT_PRIVATE_TEXT;
    li.appendChild(priv);
    // Balanced tree: ≤8 children per node so own-text child limit is not hit first.
    const queue: Element[] = [li];
    let added = 0;
    while (added < 50) {
      const parent = queue.shift();
      if (!parent) break;
      const room = Math.min(8, 50 - added);
      for (let i = 0; i < room; i += 1) {
        const span = document.createElement("span");
        parent.appendChild(span);
        queue.push(span);
        added += 1;
      }
    }
    const r = inspectVisibilityLiComplete(li);
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") {
      expect(r.reason).toMatch(/BUDGET|INCOMPLETE/);
    }
  });

  it("partial-scan: main traversal exhaustion abstains despite early private signal", () => {
    const doc = document.implementation.createHTMLDocument("fc007-main-budget");
    const main = doc.createElement("main");
    const ul = doc.createElement("ul");
    const li = doc.createElement("li");
    const heading = doc.createElement("h2");
    heading.textContent = VISIBILITY_HEADING_TEXT;
    const priv = doc.createElement("div");
    priv.textContent = CURRENT_PRIVATE_TEXT;
    li.appendChild(heading);
    li.appendChild(priv);
    ul.appendChild(li);
    main.appendChild(ul);
    // Balanced padding beyond MAIN_MAX_ELEMENTS (512) without >32 children/node.
    const queue: Element[] = [main];
    let added = 0;
    while (added < 520) {
      const parent = queue.shift();
      if (!parent) break;
      const room = Math.min(8, 520 - added);
      for (let i = 0; i < room; i += 1) {
        const d = doc.createElement("div");
        parent.appendChild(d);
        queue.push(d);
        added += 1;
      }
    }
    doc.body.appendChild(main);
    const r = recognizeVisibilitySection(doc);
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") {
      expect(r.reason).toMatch(/MAIN_ELEMENT_BUDGET|SETTINGS|INCOMPLETE/);
    }
  });
});

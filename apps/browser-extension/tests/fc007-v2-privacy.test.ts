/**
 * FC-007 V2 passive audit — release capability extensions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(__dirname, "../src/fc007/v2");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(p));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("FC-007 V2 passive audit", () => {
  it("V2 source tree remains passive-only", () => {
    const joined = listTsFiles(v2Root)
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(joined).not.toMatch(/preventDefault\s*\(/);
    expect(joined).not.toMatch(/stopPropagation\s*\(/);
    expect(joined).not.toMatch(/HTMLButtonElement\.prototype\.click/);
    expect(joined).not.toMatch(/requestSubmit\s*\(/);
    expect(joined).not.toMatch(/\.submit\s*\(/);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/XMLHttpRequest/);
    expect(joined).not.toMatch(/fc006/);
  });

  it("includes V2 contract and stage modules", () => {
    const files = listTsFiles(v2Root).map((f) => path.basename(f));
    expect(files).toContain("contract-v2.ts");
    expect(files).toContain("github-observation-v2.ts");
    expect(files).toContain("dialog-inventory-v2.ts");
    expect(files).toContain("visibility-section-v2.ts");
    expect(files).toContain("stages.ts");
  });
});

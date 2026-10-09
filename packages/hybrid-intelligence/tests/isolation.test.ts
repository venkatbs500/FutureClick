import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as hybridIntelligence from "../src/index.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

function listFiles(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listFiles(full, extension));
    } else if (name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ALLOWED_RUNTIME_DEPENDENCIES = [
  "@futureclick/action-schema",
  "@futureclick/action-understanding",
];

const ALLOWED_DEV_DEPENDENCIES = ["@biomejs/biome", "typescript", "vitest"];

const ALLOWED_IMPORT_PREFIXES = ["@futureclick/action-schema", "@futureclick/action-understanding"];

const FORBIDDEN_IMPORT_MARKERS = [
  "native-click",
  "release-interceptor",
  "releaseAttempt",
  "release-attempt",
  "continue-validator",
  "continueValidator",
  "@futureclick/action-graph",
  "apps/browser-extension",
  "fc007",
];

const FORBIDDEN_CAPABILITY_MARKERS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "node:fs",
  "node:net",
  "node:http",
  "node:https",
  "dispatchEvent",
  "requestSubmit",
  ".click(",
];

describe("FC-009 dependency and capability isolation", () => {
  it("32. declares no FC-007 release imports in the manifest", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...ALLOWED_RUNTIME_DEPENDENCIES].sort(),
    );
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(
      [...ALLOWED_DEV_DEPENDENCIES].sort(),
    );
  });

  it("32/33/34. source imports stay inside the closed allowlist", () => {
    const sources = listFiles(sourceRoot, ".ts");
    expect(sources.length).toBeGreaterThan(0);
    const importPattern = /from\s+["']([^"']+)["']/g;
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN_IMPORT_MARKERS) {
        expect(text.toLowerCase()).not.toContain(marker.toLowerCase());
      }
      for (const marker of FORBIDDEN_CAPABILITY_MARKERS) {
        expect(text).not.toContain(marker);
      }
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[1];
        if (specifier === undefined || specifier.startsWith(".")) {
          continue;
        }
        const allowed = ALLOWED_IMPORT_PREFIXES.some(
          (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
        );
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("33. source performs no network I/O", () => {
    for (const file of listFiles(sourceRoot, ".ts")) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toContain("node:http");
      expect(text).not.toContain("node:net");
    }
  });

  it("34. source performs no persistence", () => {
    for (const file of listFiles(sourceRoot, ".ts")) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("localStorage");
      expect(text).not.toContain("indexedDB");
      expect(text).not.toContain("node:fs");
    }
  });

  it("exposes no release or execution capability on the public surface", () => {
    for (const value of Object.values(hybridIntelligence)) {
      if (typeof value === "function") {
        expect(value.name).not.toMatch(/click|release|submit|approve|dispatch/i);
      }
    }
    expect(hybridIntelligence).not.toHaveProperty("releaseAttempt");
    expect(hybridIntelligence).not.toHaveProperty("click");
  });
});

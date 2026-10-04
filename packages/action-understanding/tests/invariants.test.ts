/**
 * The frozen AI-1 … AI-24 identities and the canonical class numbering.
 *
 * These assertions exist so that a renumbering is a test failure rather than a
 * silent documentation drift. A review citing AI-9 must be citing the same
 * invariant the code enforces.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RAW_SURFACE_FORBIDDEN_KEYS } from "../src/surface.js";
import {
  FC008_INVARIANT_COUNT,
  FC008_INVARIANTS,
  getInvariant,
  invariantsWithStatus,
  verifyInvariantNumbering,
} from "../src/invariants.js";
import {
  FC008_LEAST_SPECIFIC_CLASS_INDEX,
  FC008_LEAST_SPECIFIC_CLASS_NUMBER,
  FC008_SPECIFICITY_ORACLE_EXAMPLE,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORTED_TUPLE_COUNT,
  classIndexToNumber,
  classNumberToIndex,
  getSupportMatrixEntryByClassNumber,
} from "../src/support-matrix.js";

/**
 * The canonical frozen mapping, restated here independently of the source so
 * that the two must agree. A short distinguishing phrase per invariant is
 * enough to catch a renumbering while keeping this table readable.
 */
const CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ["AI-1", "inert serializable deeply-frozen data"],
  ["AI-2", "never create, arm, or influence release authority"],
  ["AI-3", "always PREDICTED and never VERIFIED"],
  ["AI-4", "Privacy sanitization completes before fingerprinting"],
  ["AI-5", "Stale inference cannot attach to changed state"],
  ["AI-6", "fails closed without producing a hypothesis"],
  ["AI-7", "untrusted data, never instructions"],
  ["AI-8", "Thresholds and abstention policy are runtime-owned"],
  ["AI-9", "no tool, shell, filesystem, network mutation"],
  ["AI-10", "imports nothing from FC-007 interception/release/native-click paths"],
  ["AI-11", "No remote transmission, remote model download"],
  ["AI-12", "No runtime training or weight mutation"],
  ["AI-13", "Provider cannot accept itself"],
  ["AI-14", "FC-007 remains frozen"],
  ["AI-15", "Site/application identity is excluded"],
  ["AI-16", "Object labels/private object names are excluded"],
  ["AI-17", "does not mutate the authoritative ActionGraph"],
  ["AI-18", "Offline training dependencies are separated"],
  ["AI-19", "structurally unreachable by the primary feature projector"],
  ["AI-20", "Operational failures are never represented as epistemic abstention"],
  ["AI-21", "deterministic support evidence, never probabilities"],
  ["AI-22", "captures no screenshots, images, clipboard, keystrokes"],
  ["AI-23", "research-mode indicator is inert"],
  ["AI-24", "No persistence or production telemetry"],
];

describe("the AI invariant identities are frozen", () => {
  it("passes its own numbering self-check", () => {
    expect(verifyInvariantNumbering()).toEqual([]);
  });

  it("declares exactly twenty-four invariants", () => {
    expect(FC008_INVARIANT_COUNT).toBe(24);
    expect(FC008_INVARIANTS).toHaveLength(24);
  });

  it("numbers them AI-1 through AI-24 with no gap or duplicate", () => {
    expect(FC008_INVARIANTS.map((i) => i.id)).toEqual(
      Array.from({ length: 24 }, (_, i) => `AI-${i + 1}`),
    );
    expect(new Set(FC008_INVARIANTS.map((i) => i.number)).size).toBe(24);
  });

  it("binds each number to its canonical subject matter", () => {
    expect(CANONICAL).toHaveLength(24);
    for (const [id, phrase] of CANONICAL) {
      const entry = getInvariant(id);
      expect(entry, `${id} must exist`).toBeDefined();
      expect(entry?.statement, `${id} must retain its frozen meaning`).toContain(phrase);
    }
  });

  it("introduces no second numbering scheme", () => {
    // Every identifier is `AI-<n>`; no `INV-`, `FC008-AI-`, or re-lettered form.
    for (const entry of FC008_INVARIANTS) {
      expect(entry.id).toMatch(/^AI-\d{1,2}$/);
      expect(entry.id).toBe(`AI-${entry.number}`);
    }
  });

  it("freezes the table and every entry", () => {
    expect(Object.isFrozen(FC008_INVARIANTS)).toBe(true);
    for (const entry of FC008_INVARIANTS) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe("deferred invariants are reported as deferred, not as passing", () => {
  it("advances AI-4 to pass now that the sanitizer exists", () => {
    // Sprint 1 reported this `deferred`, correctly: there was no sanitizer whose
    // ordering could be enforced. Sprint 2 ships one, so the status advances and
    // `statusSince` records which sprint earned it.
    expect(getInvariant("AI-4")?.status).toBe("pass");
    expect(getInvariant("AI-4")?.statusSince).toBe("sprint-2");
  });

  it("advances AI-7 to pass now the adversarial corpus and extractor exist", () => {
    expect(getInvariant("AI-7")?.status).toBe("pass");
    expect(getInvariant("AI-7")?.statusSince).toBe("sprint-2");
  });

  it("marks the Sprint 5 research indicator AI-23 as deferred", () => {
    expect(getInvariant("AI-23")?.status).toBe("deferred");
  });

  it("keeps AI-18 partial until the offline training environment exists", () => {
    // Sprint 2 separated the fitting path into the offline package, which strengthens
    // one side. The Python training environment is Sprint 3, so this is not a pass.
    expect(getInvariant("AI-18")?.status).toBe("partial-structural");
    expect(getInvariant("AI-18")?.basis).toMatch(/Sprint 3/);
  });

  it("keeps the documented forbidden-key count equal to the frozen list", () => {
    // The reported defect: the architecture document said 45 while the list held 46.
    // The invariant basis now interpolates the length, so it cannot drift; this checks
    // the markdown, which cannot interpolate anything and therefore can.
    const docPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "docs",
      "architecture",
      "FUTUREBENCH_SPRINT2.md",
    );
    const doc = readFileSync(docPath, "utf8");
    const actual = RAW_SURFACE_FORBIDDEN_KEYS.length;
    const claims = [...doc.matchAll(/(\d+)\s+forbidden raw-surface keys/g)].map((m) => m[1]);
    const nameClaims = [...doc.matchAll(/RAW_SURFACE_FORBIDDEN_KEYS` names (\d+)/g)].map(
      (m) => m[1],
    );
    expect(claims.length + nameClaims.length).toBeGreaterThan(0);
    for (const claim of [...claims, ...nameClaims]) {
      expect(Number(claim)).toBe(actual);
    }
    expect(getInvariant("AI-22")?.basis).toContain(`${actual} forbidden keys`);
  });

  it("records a milestone for every invariant, and only known milestones", () => {
    for (const entry of FC008_INVARIANTS) {
      expect(["sprint-1", "sprint-2"]).toContain(entry.statusSince);
    }
  });

  it("has exactly the Sprint-2 expected status for all 24 invariants", () => {
    // The whole table in one assertion, so a silent status drift in either direction
    // fails here rather than being noticed by a reviewer reading prose.
    const expected: Record<string, string> = {
      "AI-1": "pass",
      "AI-2": "pass",
      "AI-3": "pass",
      "AI-4": "pass",
      "AI-5": "pass",
      "AI-6": "pass",
      "AI-7": "pass",
      "AI-8": "pass",
      "AI-9": "pass",
      "AI-10": "pass",
      "AI-11": "pass",
      "AI-12": "pass",
      "AI-13": "pass",
      "AI-14": "pass",
      "AI-15": "pass",
      "AI-16": "pass",
      "AI-17": "pass",
      "AI-18": "partial-structural",
      "AI-19": "pass",
      "AI-20": "pass",
      "AI-21": "pass",
      "AI-22": "pass",
      "AI-23": "deferred",
      "AI-24": "pass",
    };
    const actual = Object.fromEntries(FC008_INVARIANTS.map((entry) => [entry.id, entry.status]));
    expect(actual).toEqual(expected);
  });

  it("claims a pass only for invariants the shipped surface actually satisfies", () => {
    for (const id of ["AI-11", "AI-22", "AI-24"]) {
      expect(getInvariant(id)?.status).toBe("pass");
    }
  });

  it("gives every non-passing invariant a basis that names what is missing", () => {
    const outstanding = [
      ...invariantsWithStatus("deferred"),
      ...invariantsWithStatus("partial-structural"),
    ];
    expect(outstanding.length).toBeGreaterThan(0);
    for (const entry of outstanding) {
      expect(entry.basis.length).toBeGreaterThan(40);
      expect(entry.basis).toMatch(/Sprint \d/);
    }
  });

  it("uses only the three declared status values", () => {
    for (const entry of FC008_INVARIANTS) {
      expect(["pass", "partial-structural", "deferred"]).toContain(entry.status);
    }
  });
});

describe("class numbering is 1 through 13 externally", () => {
  it("numbers every matrix row from one", () => {
    expect(FC008_SUPPORTED_TUPLE_COUNT).toBe(13);
    expect(FC008_SUPPORT_MATRIX.map((e) => e.classNumber)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
  });

  it("relates the number and the index as classNumber = index + 1", () => {
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(entry.classNumber).toBe(entry.classIndex + 1);
    }
  });

  it("has no class zero", () => {
    expect(FC008_SUPPORT_MATRIX.some((e) => e.classNumber === 0)).toBe(false);
    expect(classIndexToNumber(0)).toBe(1);
    expect(classNumberToIndex(0)).toBeUndefined();
  });

  it("converts in both directions across the whole range", () => {
    for (let index = 0; index < 13; index++) {
      const number = classIndexToNumber(index);
      expect(number).toBe(index + 1);
      expect(classNumberToIndex(number as number)).toBe(index);
    }
  });

  it("refuses out-of-range or non-integer values in either direction", () => {
    for (const bad of [-1, 13, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(classIndexToNumber(bad)).toBeUndefined();
    }
    for (const bad of [0, 14, 1.5, Number.NaN, -3]) {
      expect(classNumberToIndex(bad)).toBeUndefined();
    }
  });

  it("looks a row up by its external class number", () => {
    const first = getSupportMatrixEntryByClassNumber(1);
    expect(first?.classIndex).toBe(0);
    expect(first).toBe(FC008_SUPPORT_MATRIX[0]);
    expect(getSupportMatrixEntryByClassNumber(13)?.classIndex).toBe(12);
    expect(getSupportMatrixEntryByClassNumber(14)).toBeUndefined();
  });

  it("numbers the least specific class 13 at index 12", () => {
    expect(FC008_LEAST_SPECIFIC_CLASS_NUMBER).toBe(13);
    expect(FC008_LEAST_SPECIFIC_CLASS_INDEX).toBe(12);
    const entry = getSupportMatrixEntryByClassNumber(FC008_LEAST_SPECIFIC_CLASS_NUMBER);
    expect(entry?.tuple.verb).toBe("submit");
    expect(entry?.tuple.objectKind).toBe("form");
  });

  it("states the GitHub visibility example as class 8 at index 7", () => {
    expect(FC008_SPECIFICITY_ORACLE_EXAMPLE.correctClassNumber).toBe(8);
    expect(FC008_SPECIFICITY_ORACLE_EXAMPLE.correctClassIndex).toBe(7);
    const entry = getSupportMatrixEntryByClassNumber(8);
    expect(entry?.tuple.verb).toBe("change-access");
    expect(entry?.tuple.objectKind).toBe("repository");
  });

  it("uses no zero-based class language in the oracle rule", () => {
    const text = JSON.stringify(FC008_SPECIFICITY_ORACLE_EXAMPLE);
    expect(text).not.toContain("0..11");
    expect(text).not.toContain("class 0");
  });
});

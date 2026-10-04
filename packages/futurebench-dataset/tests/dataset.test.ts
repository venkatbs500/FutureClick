/**
 * End-to-end dataset assembly.
 *
 * The ordering of this pipeline is the architecture, so these tests check the
 * pipeline's PROPERTIES rather than its steps: that partitioning happened before
 * fitting, that the vocabulary saw train only, that the corpus covers what it claims
 * to cover, and that everything it produces is reproducible.
 */

import {
  FC008_FEATURE_POLICY,
  FC008_SUPPORT_MATRIX,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { FAMILY_A } from "../src/apps/family-a.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import { semanticText } from "../src/authoring.js";
import {
  FUTUREBENCH_DATASET_VERSION,
  FUTUREBENCH_GENERATOR_VERSION,
  buildDataset,
} from "../src/dataset.js";
import { resolveOracleLabel } from "../src/oracle.js";
import { VARIANT_KINDS } from "../src/scenario.js";
import { canonicalRecordText } from "../src/record.js";

const FAMILIES = FUTUREBENCH_FAMILIES;
const HELD_OUT = FAMILY_C.applicationFamilyId;

function build() {
  const result = buildDataset({ families: FAMILIES, outOfApplicationFamilyIds: [HELD_OUT] });
  if (!result.ok) {
    throw new Error(`dataset refused: ${result.reason} ${result.detail}`);
  }
  return result;
}

/** The class an authored intent establishes, or null when the oracle declines. */
function labelOf(intent: Parameters<typeof resolveOracleLabel>[0]): number | null {
  const resolution = resolveOracleLabel(intent);
  return resolution.disposition === "resolved" ? resolution.classNumber : null;
}

const BUILT = build();

describe("the pipeline completes without skipping anything", () => {
  it("turns every scenario into a record", () => {
    // A skip means a scenario was authored that the extractor or validator rejected.
    // That is worth knowing about explicitly rather than discovering as a quietly
    // smaller dataset.
    expect(BUILT.diagnostics.skipped).toEqual([]);
    const authored = FAMILIES.reduce((sum, family) => sum + family.scenarios.length, 0);
    expect(BUILT.diagnostics.recordCount).toBe(authored);
  });

  it("produces a non-trivial corpus", () => {
    expect(BUILT.records.length).toBeGreaterThan(100);
    expect(BUILT.vocabulary.size).toBeGreaterThan(50);
  });
});

describe("class coverage", () => {
  it("covers all thirteen frozen classes", () => {
    const covered = BUILT.diagnostics.perClassCounts.map((entry) => entry.classNumber);
    expect(covered).toEqual(FC008_SUPPORT_MATRIX.map((entry) => entry.classNumber));
    expect(covered).toHaveLength(13);
  });

  it("gives every class at least two independently authored lineages", () => {
    // The minimum for any claim about generalizing within a class. One lineage plus
    // its paraphrases is one piece of evidence wearing several hats.
    const perClass = new Map<number, Set<string>>();
    for (const record of BUILT.records) {
      if (record.oracle.classNumber === null) {
        continue;
      }
      const bucket = perClass.get(record.oracle.classNumber);
      if (bucket === undefined) {
        perClass.set(record.oracle.classNumber, new Set([record.lineage.parentLineageId]));
      } else {
        bucket.add(record.lineage.parentLineageId);
      }
    }
    for (const entry of FC008_SUPPORT_MATRIX) {
      const lineages = perClass.get(entry.classNumber);
      expect(lineages?.size ?? 0, `class ${entry.classNumber}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every class at least two application families", () => {
    const perClass = new Map<number, Set<string>>();
    for (const record of BUILT.records) {
      if (record.oracle.classNumber === null) {
        continue;
      }
      const bucket = perClass.get(record.oracle.classNumber);
      if (bucket === undefined) {
        perClass.set(record.oracle.classNumber, new Set([record.lineage.applicationFamilyId]));
      } else {
        bucket.add(record.lineage.applicationFamilyId);
      }
    }
    // Two families for EVERY class. A and B each cover all thirteen, so a class
    // that fell to one family would mean one of them had quietly lost coverage.
    for (const entry of FC008_SUPPORT_MATRIX) {
      const families = perClass.get(entry.classNumber);
      expect(families?.size ?? 0, `class ${entry.classNumber}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every out-of-application class three families", () => {
    // Classes measured out of application carry a heavier load: one family is held
    // out, so without a third the remaining evidence for that class is a single
    // product's conventions and the comparison has nothing to stand on.
    const perClass = new Map<number, Set<string>>();
    for (const record of BUILT.records) {
      if (record.oracle.classNumber === null) {
        continue;
      }
      const bucket = perClass.get(record.oracle.classNumber);
      if (bucket === undefined) {
        perClass.set(record.oracle.classNumber, new Set([record.lineage.applicationFamilyId]));
      } else {
        bucket.add(record.lineage.applicationFamilyId);
      }
    }
    const ooaClasses = new Set(
      BUILT.records
        .filter((record) => record.partition === "test-ooa")
        .map((record) => record.oracle.classNumber),
    );
    expect(ooaClasses.size).toBeGreaterThan(0);
    for (const classNumber of ooaClasses) {
      if (classNumber === null) {
        continue;
      }
      expect(perClass.get(classNumber)?.size ?? 0, `class ${classNumber}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("gives every in-distribution class four lineages, one per in-distribution partition", () => {
    // Four is what it takes to populate train, calibration, policy-validation, and
    // test-id without a class going missing from any of them.
    const perClass = new Map<number, Set<string>>();
    for (const record of BUILT.records) {
      if (record.oracle.classNumber === null || record.partition === "test-ooa") {
        continue;
      }
      const bucket = perClass.get(record.oracle.classNumber);
      if (bucket === undefined) {
        perClass.set(record.oracle.classNumber, new Set([record.lineage.parentLineageId]));
      } else {
        bucket.add(record.lineage.parentLineageId);
      }
    }
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(
        perClass.get(entry.classNumber)?.size ?? 0,
        `class ${entry.classNumber}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("represents every class in all four in-distribution partitions", () => {
    const perPartition = new Map<string, Set<number>>();
    for (const record of BUILT.records) {
      if (record.oracle.classNumber === null) {
        continue;
      }
      const bucket = perPartition.get(record.partition);
      if (bucket === undefined) {
        perPartition.set(record.partition, new Set([record.oracle.classNumber]));
      } else {
        bucket.add(record.oracle.classNumber);
      }
    }
    for (const partition of ["train", "calibration", "policy-validation", "test-id"] as const) {
      expect(perPartition.get(partition)?.size ?? 0, partition).toBe(13);
    }
  });

  it("includes novelty records the oracle declines to label", () => {
    const unlabelled = BUILT.records.filter((record) => record.oracle.classNumber === null);
    expect(unlabelled.length).toBeGreaterThan(0);
    expect(BUILT.diagnostics.rejectedByOracleCount).toBe(unlabelled.length);
    for (const record of unlabelled) {
      expect(record.partition).toBe("test-novelty");
      expect(record.oracle.disposition).toBe("rejected");
      expect(record.oracle.supportedTuple).toBeNull();
    }
  });
});

describe("variant coverage", () => {
  it("exercises every declared variant kind somewhere in the corpus", () => {
    const present = new Set(BUILT.records.map((record) => record.lineage.variantKind));
    const missing = VARIANT_KINDS.filter((kind) => !present.has(kind));
    expect(missing).toEqual([]);
  });

  it("includes the adversarial and secret-shaped variants", () => {
    const present = new Set(BUILT.records.map((record) => record.lineage.variantKind));
    expect(present.has("prompt-like-injection")).toBe(true);
    expect(present.has("secret-like-text")).toBe(true);
    expect(present.has("private-name-like-text")).toBe(true);
  });
});

describe("the vocabulary was fitted from train only", () => {
  it("names only features some train record produces", () => {
    // The audit proves this independently; this asserts the pipeline actually wired
    // it that way, since the fit happens after partitioning and consumes only the
    // train slice.
    const report = BUILT.audit.findings.map((finding) => finding.code);
    expect(report).not.toContain("TRAIN_VOCABULARY_CONTAMINATED");
  });

  it("carries the policy version it was fitted under", () => {
    expect(BUILT.vocabulary.featurePolicyVersion.length).toBeGreaterThan(0);
    expect(BUILT.vocabulary.size).toBe(BUILT.vocabulary.entries.size);
  });
});

describe("audits", () => {
  it("reports no blockers on the real corpus", () => {
    const blockers = BUILT.audit.findings.filter((finding) => finding.severity === "blocker");
    expect(blockers.map((finding) => `${finding.code}: ${finding.detail}`)).toEqual([]);
  });

  it("surfaces the strongest feature-label associations for review", () => {
    expect(BUILT.audit.topAssociatedFeatures.length).toBeGreaterThan(0);
  });
});

describe("provenance and reproducibility", () => {
  it("stamps every record as synthetic by construction", () => {
    for (const record of BUILT.records) {
      expect(record.benchmark.provenanceClass).toBe("synthetic-by-construction");
      expect(record.benchmark.datasetVersion).toBe(FUTUREBENCH_DATASET_VERSION);
      expect(record.benchmark.generatorVersion).toBe(FUTUREBENCH_GENERATOR_VERSION);
    }
  });

  it("produces byte-identical records on a rebuild", () => {
    const rebuilt = build();
    const first = BUILT.records.map(canonicalRecordText).join("\n");
    const second = rebuilt.records.map(canonicalRecordText).join("\n");
    expect(second).toBe(first);
  });

  it("produces an identical vocabulary on a rebuild", () => {
    const rebuilt = build();
    expect([...rebuilt.vocabulary.entries.entries()]).toEqual([
      ...BUILT.vocabulary.entries.entries(),
    ]);
  });

  it("records no wall-clock time in any record", () => {
    // Capture time is fixed rather than real, so the corpus hash does not change on
    // every build. Timestamps are context, never research content.
    const corpus = BUILT.records.map(canonicalRecordText).join("\n");
    const timestamps = corpus.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? [];
    expect(new Set(timestamps).size).toBeLessThanOrEqual(1);
  });

  it("gives every record a unique id and hash", () => {
    const ids = BUILT.records.map((record) => record.recordId);
    expect(new Set(ids).size).toBe(ids.length);
    const hashes = BUILT.records.map((record) => record.recordHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("the build fails closed on audit blockers", () => {
  it("returns ok because there are zero blockers, not in spite of them", () => {
    // The distinction matters: a green build must be green because the audit is clean.
    expect(BUILT.audit.blockerCount).toBe(0);
    expect(BUILT.audit.findings.filter((entry) => entry.severity === "blocker")).toEqual([]);
  });

  it("refuses when a lineage is split across partitions", () => {
    // Injected by corrupting a family's scenarios so one variant claims a different
    // parent, which is what produces the leakage the audit must block.
    const [first, ...rest] = FAMILY_A.scenarios;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    const duplicated = {
      ...first,
      scenarioId: `${first.scenarioId}-leak`,
      templateLineageId: `${first.templateLineageId}-leak`,
      parentLineageId: `${first.parentLineageId}-leak`,
    };
    const result = buildDataset({
      families: [
        { ...FAMILY_A, scenarios: [first, ...rest, duplicated] },
        ...FAMILIES.filter((family) => family.applicationFamilyId !== FAMILY_A.applicationFamilyId),
      ],
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    // A verbatim copy under a new lineage id is a cross-partition duplicate.
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("audit-blockers-present");
    expect(result.audit).not.toBeNull();
    expect(result.audit?.blockerCount ?? 0).toBeGreaterThan(0);
  });

  // The full path for an oracle proxy: authored text, through the real sanitizer and
  // extractor, into the audit, out as a refusal. Mutating the AUTHORED SURFACE rather
  // than a built record is what makes this meaningful — it proves normalization does
  // not launder the proxy on the way in, which is exactly the gap that let
  // `b-c08-repo-open` and `change-access/repository/visibility` through before.
  // `change-access repository visibility` rather than the slash-delimited spelling
  // because the slash form never gets this far: the sanitizer classifies it as a
  // filesystem path and drops the field. That is defense in depth working as intended,
  // but it also means a build test using the slash form would pass without the audit
  // doing anything. The space-delimited form is the one that survives sanitization,
  // so it is the one that has to be caught here.
  for (const leaked of [
    "b-c08-repo-open",
    "support-row-8",
    "ground-truth",
    "change-access repository visibility",
  ]) {
    it(`refuses the build when a surface renders "${leaked}"`, () => {
      const [first, ...rest] = FAMILY_A.scenarios;
      expect(first).toBeDefined();
      if (first === undefined) {
        return;
      }
      const result = buildDataset({
        families: [
          {
            ...FAMILY_A,
            scenarios: [
              {
                ...first,
                surface: {
                  ...first.surface,
                  headings: [...first.surface.headings, semanticText(leaked)],
                },
              },
              ...rest,
            ],
          },
          ...FAMILIES.filter(
            (family) => family.applicationFamilyId !== FAMILY_A.applicationFamilyId,
          ),
        ],
        outOfApplicationFamilyIds: [HELD_OUT],
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.reason).toBe("audit-blockers-present");
      expect(result.audit?.blockerCount ?? 0).toBeGreaterThan(0);
      expect(result.audit?.findings.map((finding) => finding.code) ?? []).toContain(
        "ORACLE_PROXY_TEXT_INJECTED",
      );
    });
  }

  it("still builds when the same surface renders ordinary product copy", () => {
    // The control. If the test above passed for any mutation at all it would prove
    // nothing, so the identical edit with human wording must leave the build green.
    const [first, ...rest] = FAMILY_A.scenarios;
    if (first === undefined) {
      return;
    }
    const result = buildDataset({
      families: [
        {
          ...FAMILY_A,
          scenarios: [
            {
              ...first,
              surface: {
                ...first.surface,
                headings: [
                  ...first.surface.headings,
                  semanticText("Change who can see this repository"),
                ],
              },
            },
            ...rest,
          ],
        },
        ...FAMILIES.filter((family) => family.applicationFamilyId !== FAMILY_A.applicationFamilyId),
      ],
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(result.ok).toBe(true);
  });

  it("exposes no records on the failure branch", () => {
    // The point of failing closed: a leakage-invalid corpus must not be reachable
    // through a branch a reader scans as success.
    const result = buildDataset({
      families: [{ ...FAMILY_A, scenarios: [] }],
      outOfApplicationFamilyIds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect("records" in result).toBe(false);
    expect("vocabulary" in result).toBe(false);
  });

  it("names the offending audit codes in the refusal reason", () => {
    const [first] = FAMILY_A.scenarios;
    if (first === undefined) {
      return;
    }
    const result = buildDataset({
      families: [
        {
          ...FAMILY_A,
          scenarios: [
            ...FAMILY_A.scenarios,
            {
              ...first,
              scenarioId: `${first.scenarioId}-dup`,
              templateLineageId: `${first.templateLineageId}-dup`,
              parentLineageId: `${first.parentLineageId}-dup`,
            },
          ],
        },
        ...FAMILIES.filter((family) => family.applicationFamilyId !== FAMILY_A.applicationFamilyId),
      ],
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    // Actionable from the return value alone, without re-running the build.
    expect(result.detail).toMatch(/[A-Z_]{8,}/);
  });
});

describe("lineage class coherence participates in the build decision", () => {
  it("reports no coherence problems for the authored corpus", () => {
    expect(BUILT.diagnostics.lineageCoherenceProblems).toEqual([]);
  });

  it("refuses when one variant of a lineage establishes a different class", () => {
    // A paraphrase is supposed to change wording, never meaning. Here one variant's
    // intent is swapped for another class's intent while it keeps its parent lineage,
    // so the lineage would carry two labels into one partition.
    const canonical = FAMILY_A.scenarios.find((entry) => entry.variantKind === "canonical");
    const sibling = FAMILY_A.scenarios.find(
      (entry) =>
        entry.variantKind !== "canonical" && entry.parentLineageId === canonical?.parentLineageId,
    );
    // The donor must establish a DIFFERENT class, not merely belong to a different
    // lineage. Family A authors two lineages per class consecutively, so "the next
    // lineage" is usually the same class and swapping its intent changes nothing.
    const canonicalClass = canonical === undefined ? null : labelOf(canonical.intent);
    const donor = FAMILY_A.scenarios.find(
      (entry) => entry.variantKind === "canonical" && labelOf(entry.intent) !== canonicalClass,
    );
    expect(canonical).toBeDefined();
    expect(sibling).toBeDefined();
    expect(donor).toBeDefined();
    if (canonical === undefined || sibling === undefined || donor === undefined) {
      return;
    }
    const mutated = FAMILY_A.scenarios.map((entry) =>
      entry.scenarioId === sibling.scenarioId ? { ...entry, intent: donor.intent } : entry,
    );
    const result = buildDataset({
      families: [
        { ...FAMILY_A, scenarios: mutated },
        ...FAMILIES.filter((family) => family.applicationFamilyId !== FAMILY_A.applicationFamilyId),
      ],
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("lineage-class-incoherent");
    expect(result.detail).toContain("LINEAGE_SPANS_MULTIPLE_CLASSES");
  });
});

describe("the GET search form is novelty-only", () => {
  const getRecords = BUILT.records.filter(
    (record) => record.observation.semantics.formMethod === "get",
  );

  it("exists in the corpus", () => {
    // A realistic retrieval form. Every supported class is a state transition, and a
    // state-changing GET would be implausible product copy, so this is the only shape
    // in which `get` legitimately appears.
    expect(getRecords.length).toBeGreaterThan(0);
  });

  it("is never assigned a supported class", () => {
    for (const record of getRecords) {
      expect(record.oracle.classNumber).toBeNull();
      expect(record.oracle.disposition).toBe("rejected");
    }
  });

  it("lives only in test-novelty", () => {
    expect([...new Set(getRecords.map((record) => record.partition))]).toEqual(["test-novelty"]);
  });

  it("is absent from the train-fitted vocabulary", () => {
    // The value exists only outside train, so the fitted feature space cannot contain
    // it. This is the property that makes the next assertion meaningful.
    expect([...BUILT.vocabulary.entries.keys()]).not.toContain("fm:get");
  });

  it("projects without crashing, with fm:get simply unseen", () => {
    for (const record of getRecords) {
      const projection = projectPrimaryFeatures(
        record.observation.semantics,
        BUILT.vocabulary,
        FC008_FEATURE_POLICY,
      );
      expect(projection.ok).toBe(true);
      if (!projection.ok) {
        continue;
      }
      // Unseen features are ignored, not guessed at and not mapped onto a known value.
      const names = [...BUILT.vocabulary.entries.entries()]
        .filter(([, index]) => projection.projection.vector.indices.includes(index))
        .map(([name]) => name);
      expect(names).not.toContain("fm:get");
      expect(names.filter((name) => name.startsWith("fm:"))).toEqual([]);
      // And the record still projects something, so abstention has features to work on.
      expect(projection.projection.vector.indices.length).toBeGreaterThan(0);
    }
  });
});

describe("categorical train coverage", () => {
  it("covers fm:other in the train-fitted vocabulary", () => {
    // Reported finding: fm:other existed on eleven records that were all Family-B
    // policy-validation, so the train vocabulary never saw it. Balanced assignment
    // fixed that, and this is the regression test.
    expect([...BUILT.vocabulary.entries.keys()]).toContain("fm:other");
  });

  it("reports any remaining uncovered categorical value as a diagnostic, not a blocker", () => {
    const uncovered = BUILT.audit.findings.filter(
      (entry) => entry.code === "CATEGORICAL_VALUE_ABSENT_FROM_TRAIN",
    );
    for (const entry of uncovered) {
      expect(entry.severity).toBe("diagnostic");
    }
  });
});

describe("refusal reporting", () => {
  it("explains an empty train corpus in terms of what was skipped", () => {
    // An "empty-corpus" refusal on its own sends a reader looking in the wrong
    // place; the cause is almost always upstream refusals.
    const result = buildDataset({
      families: [FAMILY_C],
      outOfApplicationFamilyIds: [],
    });
    expect(result.ok).toBe(true);
    const heldOutEverything = buildDataset({
      families: [FAMILY_C],
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(heldOutEverything.ok).toBe(false);
    if (!heldOutEverything.ok) {
      expect(heldOutEverything.reason).toBe("all-families-held-out");
    }
  });
});

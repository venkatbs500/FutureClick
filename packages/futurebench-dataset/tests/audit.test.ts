/**
 * Every audit is tested by INJECTING the violation it exists to catch.
 *
 * An audit that has only ever been run on clean data is untested: a passing report
 * is indistinguishable from a no-op. So each case here builds the real dataset,
 * breaks one specific property, and asserts the corresponding code appears.
 */

import { FC008_FEATURE_POLICY, FC008_SAFETY_CAPS } from "@futureclick/action-understanding";
import { normalizeToTokens, sanitizeFields } from "@futureclick/privacy";
import { describe, expect, it } from "vitest";
import { FAMILY_A } from "../src/apps/family-a.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import {
  type AuditCode,
  type AuditInput,
  auditDataset,
  computeFeatureLabelAssociation,
  normalizeProxyText,
  normalizedObservationKey,
} from "../src/audit.js";
import { buildDataset } from "../src/dataset.js";
import type { FutureBenchRecord } from "../src/record.js";

function cleanDataset() {
  const built = buildDataset({
    families: FUTUREBENCH_FAMILIES,
    outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
  });
  if (!built.ok) {
    throw new Error(`dataset refused: ${built.reason} ${built.detail}`);
  }
  return built;
}

const CLEAN = cleanDataset();

function inputWith(records: readonly FutureBenchRecord[]): AuditInput {
  return { records, vocabulary: CLEAN.vocabulary, policy: FC008_FEATURE_POLICY };
}

function codes(records: readonly FutureBenchRecord[]): AuditCode[] {
  return auditDataset(inputWith(records)).findings.map((finding) => finding.code);
}

/** A record from `partition`, for building a targeted violation. */
function pick(partition: string, skip = 0): FutureBenchRecord {
  const matches = CLEAN.records.filter((record) => record.partition === partition);
  const found = matches[skip];
  if (found === undefined) {
    throw new Error(`no record ${skip} in ${partition}`);
  }
  return found;
}

describe("the real dataset passes every audit", () => {
  it("reports no blockers", () => {
    const report = auditDataset(inputWith(CLEAN.records));
    const blockers = report.findings.filter((finding) => finding.severity === "blocker");
    expect(blockers.map((finding) => `${finding.code}: ${finding.detail}`)).toEqual([]);
    expect(report.blockerCount).toBe(0);
  });

  it("reports no finding whose detail contains observation text", () => {
    // Findings name identifiers and counts. A finding that quoted the offending
    // text would turn the audit report itself into a disclosure channel.
    const report = auditDataset(inputWith(CLEAN.records));
    for (const finding of report.findings) {
      expect(finding.detail).not.toMatch(/@|https?:\/\//);
    }
  });
});

describe("duplication audits", () => {
  it("detects an exact record duplicated across partitions", () => {
    const trainRecord = pick("train");
    const smuggled: FutureBenchRecord = { ...trainRecord, partition: "test-id" };
    // Same canonical content, two partitions: the test input was already trained on.
    expect(codes([...CLEAN.records, smuggled])).toContain(
      "EXACT_RECORD_DUPLICATE_ACROSS_PARTITIONS",
    );
  });

  it("detects an exact record duplicated inside one partition", () => {
    const trainRecord = pick("train");
    expect(codes([...CLEAN.records, trainRecord])).toContain(
      "EXACT_RECORD_DUPLICATE_WITHIN_PARTITION",
    );
  });

  it("detects the same semantics appearing in two partitions under different ids", () => {
    const trainRecord = pick("train");
    const disguised: FutureBenchRecord = {
      ...trainRecord,
      recordId: "rec-disguised",
      recordHash: `${trainRecord.recordHash.slice(0, 63)}0`,
      partition: "test-ooa",
      lineage: { ...trainRecord.lineage, templateLineageId: "lineage-disguised" },
    };
    const found = codes([...CLEAN.records, disguised]);
    // Renaming the record does not change what the model sees, which is the point.
    expect(found).toContain("NORMALIZED_OBSERVATION_DUPLICATE_ACROSS_PARTITIONS");
    expect(found).toContain("FEATURE_VECTOR_DUPLICATE_ACROSS_PARTITIONS");
  });

  it("keys normalized duplicates on the semantics alone", () => {
    const record = pick("train");
    const renamed: FutureBenchRecord = { ...record, recordId: "rec-renamed" };
    expect(normalizedObservationKey(renamed)).toBe(normalizedObservationKey(record));
  });
});

describe("partition integrity audits", () => {
  it("detects a lineage spanning two partitions", () => {
    const record = pick("calibration");
    const moved: FutureBenchRecord = {
      ...record,
      recordId: "rec-moved",
      recordHash: `${record.recordHash.slice(0, 63)}1`,
      partition: "train",
    };
    expect(codes([...CLEAN.records, moved])).toContain("LINEAGE_SPANS_PARTITIONS");
  });

  it("detects a variant sibling separated from its parent", () => {
    const record = pick("calibration");
    const split: FutureBenchRecord = {
      ...record,
      recordId: "rec-split",
      recordHash: `${record.recordHash.slice(0, 63)}2`,
      partition: "train",
      // A distinct lineage id, so only the PARENT linkage reveals the leak.
      lineage: { ...record.lineage, templateLineageId: "lineage-sibling-split" },
    };
    expect(codes([...CLEAN.records, split])).toContain("VARIANT_SIBLING_SPANS_PARTITIONS");
  });

  it("detects a held-out application family appearing in train", () => {
    const ooaRecord = pick("test-ooa");
    const leaked: FutureBenchRecord = {
      ...ooaRecord,
      recordId: "rec-leaked-family",
      recordHash: `${ooaRecord.recordHash.slice(0, 63)}3`,
      partition: "train",
      lineage: {
        ...ooaRecord.lineage,
        templateLineageId: "lineage-leak",
        parentLineageId: "parent-leak",
      },
    };
    expect(codes([...CLEAN.records, leaked])).toContain("APPLICATION_FAMILY_LEAKS_INTO_OOA");
  });

  it("detects a class measured out-of-application but absent from train", () => {
    // Drop every train record for the class, leaving it measurable but untrained.
    const ooaClass = pick("test-ooa").oracle.classNumber;
    const thinned = CLEAN.records.filter(
      (record) => !(record.partition === "train" && record.oracle.classNumber === ooaClass),
    );
    expect(codes(thinned)).toContain("OOA_CLASS_ABSENT_FROM_TRAIN");
  });

  it("reports an empty partition as a diagnostic rather than a blocker", () => {
    const withoutNovelty = CLEAN.records.filter((record) => record.partition !== "test-novelty");
    const report = auditDataset(inputWith(withoutNovelty));
    const empty = report.findings.find((finding) => finding.code === "PARTITION_EMPTY");
    expect(empty?.severity).toBe("diagnostic");
  });
});

describe("oracle proxy and prohibited feature audits", () => {
  it("detects a feature family outside the permitted set", () => {
    const polluted = new Map(CLEAN.vocabulary.entries);
    polluted.set("host:github-com", polluted.size);
    const report = auditDataset({
      records: CLEAN.records,
      vocabulary: { ...CLEAN.vocabulary, entries: polluted, size: polluted.size },
      policy: FC008_FEATURE_POLICY,
    });
    expect(report.findings.map((f) => f.code)).toContain("PROHIBITED_FEATURE_NAME_PRESENT");
  });

  it("detects a label-shaped feature family", () => {
    const polluted = new Map(CLEAN.vocabulary.entries);
    polluted.set("oracle:class-8", polluted.size);
    const report = auditDataset({
      records: CLEAN.records,
      vocabulary: { ...CLEAN.vocabulary, entries: polluted, size: polluted.size },
      policy: FC008_FEATURE_POLICY,
    });
    const found = report.findings.map((f) => f.code);
    expect(
      found.some(
        (code) =>
          code === "ORACLE_PROXY_REACHABLE_IN_FEATURES" ||
          code === "PROHIBITED_FEATURE_NAME_PRESENT",
      ),
    ).toBe(true);
  });

  it("does not flag an ordinary English word that happens to appear on a prohibited-input list", () => {
    // "storage" is a prohibited data SOURCE and also a perfectly normal heading in
    // a file product. Flagging `tok:hd:storage` would be a false positive, and false
    // positives are how audits get ignored.
    const report = auditDataset(inputWith(CLEAN.records));
    expect(report.findings.map((f) => f.detail).join(" ")).not.toContain("storage");
  });
});

describe("generator self-leakage audit", () => {
  it("detects a surface that renders the whole canonical tuple as text", () => {
    // The failure mode that would make the benchmark measure string matching: a
    // button reading "change-access repository visibility private public".
    const record = pick("train");
    const tuple = record.oracle.supportedTuple;
    expect(tuple).not.toBeNull();
    if (tuple === null) {
      return;
    }
    const injected: FutureBenchRecord = {
      ...record,
      recordId: "rec-label-injected",
      observation: {
        ...record.observation,
        semantics: {
          ...record.observation.semantics,
          tokens: [
            ...record.observation.semantics.tokens,
            ...[tuple.verb, tuple.objectKind, tuple.property, tuple.from, tuple.to]
              .join(" ")
              .split(/[^a-z0-9]+/i)
              .filter((part) => part.length > 0)
              .map((value) => ({ channel: "ctl" as const, value: value.toLowerCase() })),
          ],
        },
      },
    };
    expect(codes([injected])).toContain("CANONICAL_LABEL_TEXT_INJECTED");
  });

  it("does not flag a surface that merely uses the canonical verb", () => {
    // A delete dialog containing the word "delete" is the task, not a defect. Only
    // the FULL tuple is evidence of the generator leaking its answer key.
    const deleteRecords = CLEAN.records.filter((record) => record.oracle.classNumber === 1);
    expect(deleteRecords.length).toBeGreaterThan(0);
    expect(codes(deleteRecords)).not.toContain("CANONICAL_LABEL_TEXT_INJECTED");
  });
});

describe("direct oracle proxies are blocked in every model-facing text channel", () => {
  /**
   * Injects RAW text into one channel, normalized exactly as the pipeline would.
   *
   * Taking raw strings is the point. The previous version of these tests passed
   * already-joined tokens like `["class8"]` and `["groundtruth"]`, so they proved only
   * that the audit matched the one shape real leakage never has: normalization splits
   * on every separator, so `ground-truth` reaches the audit as two tokens and the
   * joined pattern could not fire. The tests were green and the audit was blind.
   * Going through the normalizer means a test can no longer pass by describing text
   * that the pipeline would never produce.
   */
  function withRawText(
    record: FutureBenchRecord,
    channel: "ctl" | "acc" | "hd" | "nb",
    raw: string,
  ): FutureBenchRecord {
    return {
      ...record,
      recordId: `rec-proxy-${channel}`,
      observation: {
        ...record.observation,
        semantics: {
          ...record.observation.semantics,
          tokens: [
            ...record.observation.semantics.tokens,
            ...normalizeProxyText(raw).map((value) => ({ channel, value })),
          ],
        },
      },
    };
  }

  function proxyCaught(raw: string, channel: "ctl" | "acc" | "hd" | "nb" = "ctl"): boolean {
    return codes([withRawText(pick("train"), channel, raw)]).includes("ORACLE_PROXY_TEXT_INJECTED");
  }

  it("normalizes identically to the sanitizer the pipeline actually uses", () => {
    // The audit reimplements the grammar so it does not inherit the pipeline's blind
    // spots, which only helps if the two agree about what the text says. Pinning them
    // here turns future drift into a failure instead of a silent gap.
    for (const raw of [
      "support-row-8",
      "support_row_8",
      "support/row/8",
      "support row 8",
      "ground-truth",
      "b-c08-repo-open",
      "change-access/repository/visibility",
      "Change repository visibility",
      "Make repository public",
    ]) {
      expect(normalizeProxyText(raw)).toEqual(normalizeToTokens(raw));
    }
  });

  // Every channel, not just button text. A proxy in an accessible name is exactly as
  // reachable by the model as one in a label, so an audit that read only `ctl` would
  // be trivially evadable.
  for (const channel of ["ctl", "acc", "hd", "nb"] as const) {
    it(`blocks the real Family-B generator id on the ${channel} channel`, () => {
      // The current authored convention, verbatim. `b-c08-repo-open` names class 8 to
      // anything that can correlate a token, and it is the exact string a generator
      // would leak if it ever rendered a lineage id into display text.
      expect(proxyCaught("b-c08-repo-open", channel)).toBe(true);
    });

    it(`blocks a separator-written class number on the ${channel} channel`, () => {
      expect(proxyCaught("class-8", channel)).toBe(true);
    });
  }

  it("blocks other class-indexed generator ids in the same convention", () => {
    expect(proxyCaught("a-c01-delete-file")).toBe(true);
    expect(proxyCaught("family-c13-submit-form")).toBe(true);
  });

  // Separators must not decide the outcome. These are the same proxy written five
  // ways, and an audit that caught some of them would be an audit anyone could evade
  // by changing a punctuation character.
  const separatorMatrix: readonly { name: string; variants: readonly string[] }[] = [
    {
      name: "support-matrix row id",
      variants: ["support-row-8", "support_row_8", "support/row/8", "support row 8"],
    },
    {
      name: "ground-truth field name",
      variants: ["ground-truth", "ground_truth", "ground/truth", "ground truth", "groundtruth"],
    },
    { name: "class number", variants: ["class-8", "class_8", "class/8", "class 8", "class8"] },
    { name: "canonical row id", variants: ["tuple-8", "tuple_8", "tuple/8", "tuple 8", "tuple8"] },
    { name: "matrix row id", variants: ["matrix-row-8", "matrix_row_8", "matrix/row/8"] },
    { name: "oracle field name", variants: ["oracle-class", "oracle_class", "oracle/class"] },
  ];

  for (const { name, variants } of separatorMatrix) {
    for (const variant of variants) {
      it(`blocks a ${name} written as "${variant}"`, () => {
        expect(proxyCaught(variant)).toBe(true);
      });
    }
  }

  it("blocks oracle and support-matrix identities in their remaining spellings", () => {
    for (const raw of [
      "oracle-label",
      "resolved-oracle-class",
      "resolved_oracle_class",
      "support-matrix-8",
      "fc008-class-8",
      "fc008-row-8",
      "class-number",
      "label-id",
      "scenario-id",
      "lineage-id",
    ]) {
      expect(proxyCaught(raw), raw).toBe(true);
    }
  });

  // The finding B2 specifically identified: a canonical tuple key serialized into
  // display text. Each is a real row of the frozen matrix.
  for (const raw of [
    "change-access/repository/visibility",
    "delete/file/existence",
    "share/document/access",
  ]) {
    it(`blocks the serialized canonical tuple key "${raw}"`, () => {
      expect(proxyCaught(raw)).toBe(true);
    });
  }

  it("blocks a serialized tuple key regardless of separator", () => {
    expect(proxyCaught("change_access/repository/visibility")).toBe(true);
    expect(proxyCaught("change-access repository visibility")).toBe(true);
    expect(proxyCaught("change.access.repository.visibility")).toBe(true);
  });

  it("records that the sanitizer already drops slash-delimited tuple keys upstream", () => {
    // Worth pinning because it changes what the audit is for. A slash-delimited key
    // looks like a filesystem path, so the sanitizer drops the whole field and the
    // text never becomes a token at all — two independent layers refuse it. The
    // consequence for testing is that a build-level test using the slash form would
    // pass whether or not the audit worked, so the end-to-end tests use the
    // space-delimited form that genuinely survives sanitization.
    expect(normalizeToTokens("change-access/repository/visibility")).toEqual([
      "change",
      "access",
      "repository",
      "visibility",
    ]);
    const dropped = sanitizeFields(
      [{ text: "change-access/repository/visibility", disposition: "semantic" }],
      { maxStringUtf8Bytes: FC008_SAFETY_CAPS.maxStringUtf8Bytes, maxTokens: 64 },
    );
    expect(dropped.fields[0]?.fieldDropped).toBe(true);
    expect(dropped.fields[0]?.tokens).toEqual([]);
  });

  it("does not flag the whole clean corpus", () => {
    expect(codes(CLEAN.records)).not.toContain("ORACLE_PROXY_TEXT_INJECTED");
  });

  it("does not flag legitimate object and state semantics", () => {
    // The distinction the audit exists to make. `obj:repository`,
    // `st:visibility:private`, and `st:name:current` are genuine observations of a
    // surface, and the model is supposed to see them. Being predictive is the task.
    const record = pick("train");
    const legitimate: FutureBenchRecord = {
      ...record,
      recordId: "rec-legitimate-semantics",
      observation: {
        ...record.observation,
        semantics: {
          ...record.observation.semantics,
          objectKindEvidence: ["repository"],
          stateTokens: ["visibility:private", "name:current"],
          tokens: [
            ...record.observation.semantics.tokens,
            { channel: "hd" as const, value: "visibility" },
            { channel: "ctl" as const, value: "private" },
            { channel: "nb" as const, value: "repository" },
          ],
        },
      },
    };
    expect(codes([legitimate])).not.toContain("ORACLE_PROXY_TEXT_INJECTED");
  });

  it("does not flag an ordinary word that merely contains a digit-like suffix", () => {
    // `classroom` is not `class8`; the patterns are anchored to whole windows.
    const injected = withRawText(pick("train"), "hd", "classroom subclass firstclass");
    expect(codes([injected])).not.toContain("ORACLE_PROXY_TEXT_INJECTED");
  });

  // The control half of the check, and the half that decides whether anyone keeps the
  // audit switched on. Every phrase here is ordinary product copy about exactly the
  // transitions the corpus is built from, so each one is a plausible way for a
  // too-eager detector to start flagging authored surfaces. A broad substring search
  // over "class", "row", "oracle", "delete", or "visibility" fails most of these.
  for (const raw of [
    "Make repository public",
    "Delete this file",
    "Share document",
    "Visibility is private",
    "Rename file",
    "Move folder",
    "Move file to another folder",
    "Send message to the team",
    "Install application from marketplace",
    "Submit the form",
    "Grant permission to this user",
    "Subscribe to updates",
    "Share this document with your team",
    "Delete the selected file permanently",
    "Change who can see this repository",
  ]) {
    it(`does not flag ordinary product copy: "${raw}"`, () => {
      expect(proxyCaught(raw)).toBe(false);
    });
  }

  it("does not flag a human phrase that merely names the same concepts as a tuple", () => {
    // The sharpest case, and the reason the check requires CONTIGUITY in canonical
    // order rather than co-occurrence. "Change repository visibility" mentions the
    // verb, the object, and the property of class 8 and is still just a menu item;
    // the canonical verb is `change-access`, so the serialized form demands `access`
    // immediately after `change` and the human wording puts `repository` there.
    expect(proxyCaught("Change repository visibility")).toBe(false);
    expect(proxyCaught("Delete this file from the folder")).toBe(false);
    expect(proxyCaught("Share the document and set access")).toBe(false);
  });

  it("does not flag legitimate projected object and state features", () => {
    // `obj:repository`, `st:visibility:private`, and `st:name:current` are closed
    // categorical vocabularies describing what the surface genuinely shows. Being
    // highly predictive is the task, not leakage.
    const vocabularyNames = [...CLEAN.vocabulary.entries.keys()];
    const semantic = vocabularyNames.filter(
      (name) => name.startsWith("obj:") || name.startsWith("st:"),
    );
    expect(semantic.length).toBeGreaterThan(0);
    const report = auditDataset(inputWith(CLEAN.records));
    expect(report.findings.map((finding) => finding.code)).not.toContain(
      "ORACLE_PROXY_REACHABLE_IN_FEATURES",
    );
  });

  it("blocks a class-encoding token that reached the fitted vocabulary", () => {
    // The vocabulary is the second place a proxy has to survive. `tok:ctl:c08` has the
    // permitted family `tok`, so family screening alone passes it straight through and
    // the class-encoding value lands in the feature space.
    const poisoned = {
      ...CLEAN.vocabulary,
      entries: new Map([...CLEAN.vocabulary.entries, ["tok:ctl:c08", 9999]]),
    } as typeof CLEAN.vocabulary;
    const report = auditDataset({
      records: CLEAN.records,
      vocabulary: poisoned,
      policy: FC008_FEATURE_POLICY,
    });
    expect(report.findings.map((finding) => finding.code)).toContain(
      "ORACLE_PROXY_REACHABLE_IN_FEATURES",
    );
  });

  it("makes a proxy fail the whole build, not just the report", () => {
    const report = auditDataset(inputWith([withRawText(pick("train"), "nb", "class-8")]));
    const proxy = report.findings.filter(
      (finding) => finding.code === "ORACLE_PROXY_TEXT_INJECTED",
    );
    expect(proxy.length).toBeGreaterThan(0);
    for (const finding of proxy) {
      expect(finding.severity).toBe("blocker");
    }
    expect(report.blockerCount).toBeGreaterThan(0);
  });

  // The whole path, not the helper. A regex that matches while the build still returns
  // a validated dataset would be a finding nobody acts on.
  for (const raw of ["b-c08-repo-open", "ground-truth", "change-access/repository/visibility"]) {
    it(`refuses the build outright when "${raw}" is injected`, () => {
      const mutated = CLEAN.records.map((record, index) =>
        index === 0 ? withRawText(record, "ctl", raw) : record,
      );
      const report = auditDataset(inputWith(mutated));
      expect(report.blockerCount).toBeGreaterThan(0);
      expect(report.findings.map((finding) => finding.code)).toContain(
        "ORACLE_PROXY_TEXT_INJECTED",
      );
    });
  }

  it("builds the clean corpus successfully with zero blockers", () => {
    expect(CLEAN.ok).toBe(true);
    expect(CLEAN.records.length).toBe(666);
    expect(CLEAN.audit.blockerCount).toBe(0);
  });
});

describe("projection failures are reported, never silently skipped", () => {
  it("raises an explicit blocker when a record cannot be projected", () => {
    // Previously the duplicate audit caught the failure and `continue`d, so the record
    // was never examined and the report still said clean — the one failure mode an
    // audit must not have.
    const record = pick("train");
    const broken: FutureBenchRecord = {
      ...record,
      recordId: "rec-unprojectable",
      observation: {
        ...record.observation,
        semantics: {
          ...record.observation.semantics,
          // An unknown policy version is refused by the projector.
          semanticsVersion: "0.0" as typeof record.observation.semantics.semanticsVersion,
        },
      },
    };
    const report = auditDataset({
      records: [broken],
      vocabulary: CLEAN.vocabulary,
      policy: { ...FC008_FEATURE_POLICY, version: "9.9" as typeof FC008_FEATURE_POLICY.version },
    });
    const failures = report.findings.filter(
      (finding) => finding.code === "FEATURE_PROJECTION_FAILED",
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((finding) => finding.severity === "blocker")).toBe(true);
    expect(report.blockerCount).toBeGreaterThan(0);
  });

  it("names the record and the refusal without leaking observation text", () => {
    const report = auditDataset({
      records: [pick("train")],
      vocabulary: CLEAN.vocabulary,
      policy: { ...FC008_FEATURE_POLICY, version: "9.9" as typeof FC008_FEATURE_POLICY.version },
    });
    const failure = report.findings.find((finding) => finding.code === "FEATURE_PROJECTION_FAILED");
    expect(failure).toBeDefined();
    expect(failure?.detail).toMatch(/^rec-/);
    expect(failure?.detail).toMatch(/could not be projected/);
  });

  it("reports none for the clean corpus", () => {
    expect(codes(CLEAN.records)).not.toContain("FEATURE_PROJECTION_FAILED");
  });
});

describe("partition/family aliasing audit", () => {
  it("passes on the balanced corpus", () => {
    const found = codes(CLEAN.records);
    expect(found).not.toContain("APPLICATION_FAMILY_ALIASES_PARTITION");
    expect(found).not.toContain("ID_PARTITION_FAMILY_ABSENT_FROM_TRAIN");
    expect(found).not.toContain("CLASS_ABSENT_FROM_TRAIN");
  });

  it("detects a family confined to one in-distribution partition", () => {
    // Reconstructs the reported defect directly: every Family-B record forced into
    // policy-validation, so family perfectly predicts partition.
    const familyB = FUTUREBENCH_FAMILIES.map((f) => f.applicationFamilyId).find(
      (id) => id !== FAMILY_A.applicationFamilyId && id !== FAMILY_C.applicationFamilyId,
    ) as string;
    const aliased = CLEAN.records.map((record) =>
      record.lineage.applicationFamilyId === familyB &&
      ["train", "calibration", "policy-validation", "test-id"].includes(record.partition)
        ? { ...record, partition: "policy-validation" as const }
        : record,
    );
    expect(codes(aliased)).toContain("APPLICATION_FAMILY_ALIASES_PARTITION");
  });

  it("detects an in-distribution family that never appears in train", () => {
    const familyB = FUTUREBENCH_FAMILIES.map((f) => f.applicationFamilyId).find(
      (id) => id !== FAMILY_A.applicationFamilyId && id !== FAMILY_C.applicationFamilyId,
    ) as string;
    // Move Family B out of train entirely, spreading it over the other three so it is
    // not merely confined to one.
    let rotation = 0;
    const moved = CLEAN.records.map((record) => {
      if (record.lineage.applicationFamilyId !== familyB || record.partition !== "train") {
        return record;
      }
      const destinations = ["calibration", "policy-validation", "test-id"] as const;
      const destination = destinations[
        rotation % destinations.length
      ] as (typeof destinations)[number];
      rotation += 1;
      return { ...record, partition: destination };
    });
    expect(codes(moved)).toContain("ID_PARTITION_FAMILY_ABSENT_FROM_TRAIN");
  });

  it("detects a class that occurs in the corpus but never in train", () => {
    const starved = CLEAN.records.map((record) =>
      record.partition === "train" && record.oracle.classNumber === 1
        ? { ...record, partition: "test-id" as const }
        : record,
    );
    expect(codes(starved)).toContain("CLASS_ABSENT_FROM_TRAIN");
  });
});

describe("lineage class coherence audit", () => {
  it("passes on the clean corpus", () => {
    expect(codes(CLEAN.records)).not.toContain("LINEAGE_SPANS_MULTIPLE_CLASSES");
  });

  it("detects one variant of a lineage carrying a different label", () => {
    const record = pick("train");
    const sibling = CLEAN.records.find(
      (candidate) =>
        candidate.lineage.parentLineageId === record.lineage.parentLineageId &&
        candidate.recordId !== record.recordId,
    );
    expect(sibling).toBeDefined();
    if (sibling === undefined) {
      return;
    }
    const mutated = CLEAN.records.map((candidate) =>
      candidate.recordId === sibling.recordId
        ? {
            ...candidate,
            oracle: {
              ...candidate.oracle,
              classNumber: (candidate.oracle.classNumber ?? 1) === 1 ? 2 : 1,
            },
          }
        : candidate,
    );
    expect(codes(mutated)).toContain("LINEAGE_SPANS_MULTIPLE_CLASSES");
  });
});

describe("train vocabulary contamination audit", () => {
  it("detects a vocabulary entry no train record can produce", () => {
    const polluted = new Map(CLEAN.vocabulary.entries);
    polluted.set("tok:ctl:zzzneverseen", polluted.size);
    const report = auditDataset({
      records: CLEAN.records,
      vocabulary: { ...CLEAN.vocabulary, entries: polluted, size: polluted.size },
      policy: FC008_FEATURE_POLICY,
    });
    expect(report.findings.map((f) => f.code)).toContain("TRAIN_VOCABULARY_CONTAMINATED");
  });
});

describe("feature-label association is diagnostic, not a leakage verdict", () => {
  it("ranks features by mutual information without calling any of them leakage", () => {
    const top = computeFeatureLabelAssociation(inputWith(CLEAN.records), 10);
    expect(top.length).toBeGreaterThan(0);
    for (const entry of top) {
      expect(entry.bits).toBeGreaterThanOrEqual(0);
      expect(entry.classNumbers.length).toBeGreaterThan(0);
    }
    // Sorted descending, so a reviewer reads the strongest associations first.
    for (let i = 1; i < top.length; i += 1) {
      expect((top[i - 1] as { bits: number }).bits).toBeGreaterThanOrEqual(
        (top[i] as { bits: number }).bits,
      );
    }
  });

  it("emits no blocker merely because a feature predicts a class well", () => {
    // High association is the task. In a corpus about deleting things, "delete" will
    // predict the delete class, and reporting that as leakage would be a category
    // error. Only the generator having inserted the label itself is a blocker.
    const report = auditDataset(inputWith(CLEAN.records));
    const strongest = report.topAssociatedFeatures[0];
    expect(strongest).toBeDefined();
    expect(report.blockerCount).toBe(0);
  });

  it("marks a single-class feature as perfectly predictive without failing", () => {
    const top = computeFeatureLabelAssociation(inputWith(CLEAN.records), 200);
    const perfect = top.filter((entry) => entry.perfectlyPredictive);
    // Whether any exist is a property of the corpus; what matters is that the flag
    // is reported for human judgement rather than enforced.
    for (const entry of perfect) {
      expect(entry.classNumbers).toHaveLength(1);
    }
    expect(auditDataset(inputWith(CLEAN.records)).blockerCount).toBe(0);
  });
});

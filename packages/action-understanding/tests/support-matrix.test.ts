import { ACTION_VERBS, KNOWN_ENTITY_KINDS } from "@futureclick/action-schema";
import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import {
  FC008_LEAST_SPECIFIC_CLASS_INDEX,
  FC008_MATRIX_OBJECT_KINDS,
  FC008_MATRIX_TRANSITION_PROPERTIES,
  FC008_MATRIX_VERBS,
  FC008_SPECIFICITY_ORACLE_EXAMPLE,
  FC008_SPECIFICITY_ORACLE_RULE,
  FC008_SPECIFICITY_ORACLE_RULE_VERSION,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
  FC008_SUPPORTED_TUPLE_COUNT,
  findSupportMatrixEntry,
  getSupportMatrixEntry,
  isSupportedTuple,
  resolveSupportedTuple,
  supportedTupleKey,
  verifySupportMatrixIntegrity,
} from "../src/support-matrix.js";

describe("FC-008 frozen support matrix", () => {
  it("declares version 1.0", () => {
    expect(FC008_SUPPORT_MATRIX_VERSION).toBe("1.0");
  });

  it("contains exactly 13 tuples", () => {
    expect(FC008_SUPPORT_MATRIX).toHaveLength(13);
    expect(FC008_SUPPORTED_TUPLE_COUNT).toBe(13);
    expect(FC008_SAFETY_CAPS.jointModelClasses).toBe(13);
  });

  it("passes full integrity verification", () => {
    expect(verifySupportMatrixIntegrity()).toEqual([]);
  });

  it("holds exactly the thirteen approved tuples in frozen class order", () => {
    const rendered = FC008_SUPPORT_MATRIX.map(
      (e) =>
        `${e.classIndex}:${e.tuple.verb}/${e.tuple.objectKind}/${e.tuple.transition.property}:${e.tuple.transition.from}->${e.tuple.transition.to}`,
    );
    expect(rendered).toEqual([
      "0:delete/file/existence:present->absent",
      "1:delete/document/existence:present->absent",
      "2:share/file/access:private->shared",
      "3:share/document/access:private->shared",
      "4:rename/file/name:current->replaced",
      "5:move/file/container:source->destination",
      "6:move/folder/container:source->destination",
      "7:change-access/repository/visibility:private->public",
      "8:grant/permission/grant-state:absent->granted",
      "9:subscribe/subscription/status:inactive->active",
      "10:install/application/installation:absent->installed",
      "11:send/message/delivery:draft->sent",
      "12:submit/form/submission:ready->submitted",
    ]);
  });

  it("uses only canonical ActionVerb values and never 'unknown'", () => {
    const canonical = new Set<string>(ACTION_VERBS);
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(canonical.has(entry.tuple.verb)).toBe(true);
      expect(entry.tuple.verb).not.toBe("unknown");
    }
  });

  it("uses only canonical KnownEntityKind values and never 'other'", () => {
    const canonical = new Set<string>(KNOWN_ENTITY_KINDS);
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(canonical.has(entry.tuple.objectKind)).toBe(true);
      expect(entry.tuple.objectKind).not.toBe("other");
    }
  });

  it("does not add 'unknown' to the learned object kinds", () => {
    // KNOWN_ENTITY_KINDS has no "unknown" member; the matrix must not invent one.
    expect(KNOWN_ENTITY_KINDS).not.toContain("unknown");
    expect(FC008_MATRIX_OBJECT_KINDS).not.toContain("unknown");
  });

  it("produces the frozen factorized head shapes", () => {
    expect(FC008_MATRIX_VERBS).toHaveLength(FC008_SAFETY_CAPS.factorizedVerbRows);
    expect(FC008_MATRIX_OBJECT_KINDS).toHaveLength(FC008_SAFETY_CAPS.factorizedObjectRows);
    expect(FC008_MATRIX_TRANSITION_PROPERTIES).toHaveLength(
      FC008_SAFETY_CAPS.factorizedTransitionRows,
    );
    expect(FC008_MATRIX_VERBS).toHaveLength(10);
    expect(FC008_MATRIX_OBJECT_KINDS).toHaveLength(9);
    expect(FC008_MATRIX_TRANSITION_PROPERTIES).toHaveLength(10);
  });

  it("has unique tuples and injective tuple keys", () => {
    const keys = FC008_SUPPORT_MATRIX.map((e) => supportedTupleKey(e.tuple));
    expect(new Set(keys).size).toBe(13);
  });

  it("determines the transition uniquely from verb and object kind", () => {
    // Material to RQ1 interpretation: the factorized transition head carries no
    // information beyond verb and object on the supported set.
    const pairs = FC008_SUPPORT_MATRIX.map((e) => `${e.tuple.verb}/${e.tuple.objectKind}`);
    expect(new Set(pairs).size).toBe(13);
    for (const entry of FC008_SUPPORT_MATRIX) {
      const found = findSupportMatrixEntry(entry.tuple.verb, entry.tuple.objectKind);
      expect(found?.classIndex).toBe(entry.classIndex);
    }
  });

  it("looks up entries by class index and rejects out-of-range indices", () => {
    expect(getSupportMatrixEntry(0)?.tuple.verb).toBe("delete");
    expect(getSupportMatrixEntry(12)?.tuple.verb).toBe("submit");
    expect(getSupportMatrixEntry(13)).toBeUndefined();
    expect(getSupportMatrixEntry(-1)).toBeUndefined();
    expect(getSupportMatrixEntry(1.5)).toBeUndefined();
  });

  it("accepts every supported tuple and rejects unsupported combinations", () => {
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(isSupportedTuple(entry.tuple)).toBe(true);
      expect(resolveSupportedTuple(structuredClone(entry.tuple))).toEqual(entry.tuple);
    }

    // Valid canonical vocabulary, combination absent from the matrix.
    expect(
      isSupportedTuple({
        verb: "delete",
        objectKind: "repository",
        transition: { property: "existence", from: "present", to: "absent" },
      }),
    ).toBe(false);

    // Correct verb and object, wrong transition.
    expect(
      isSupportedTuple({
        verb: "delete",
        objectKind: "file",
        transition: { property: "access", from: "private", to: "shared" },
      }),
    ).toBe(false);

    // 'unknown' is never a learned class.
    expect(
      isSupportedTuple({
        verb: "unknown",
        objectKind: "file",
        transition: { property: "existence", from: "present", to: "absent" },
      }),
    ).toBe(false);
  });

  it("rejects malformed tuple candidates without throwing", () => {
    for (const bad of [
      null,
      undefined,
      "delete/file",
      42,
      {},
      { verb: "delete" },
      { verb: "delete", objectKind: "file" },
      { verb: "delete", objectKind: "file", transition: null },
      { verb: "delete", objectKind: "file", transition: { property: "existence" } },
    ]) {
      expect(isSupportedTuple(bad)).toBe(false);
      expect(resolveSupportedTuple(bad)).toBeUndefined();
    }
  });

  it("produces collision-free keys for adversarial field values", () => {
    // Length-prefixed encoding means a delimiter inside a value cannot forge a key.
    const a = supportedTupleKey({
      verb: "delete",
      objectKind: "file",
      transition: { property: "existence", from: "present", to: "absent" },
    });
    const b = supportedTupleKey({
      verb: "delete",
      objectKind: "file",
      transition: { property: "existence", from: "present|6:absent", to: "" },
    });
    expect(a).not.toBe(b);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(FC008_SUPPORT_MATRIX)).toBe(true);
    for (const entry of FC008_SUPPORT_MATRIX) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.tuple)).toBe(true);
      expect(Object.isFrozen(entry.tuple.transition)).toBe(true);
    }
  });
});

describe("FC-008 specificity oracle rule", () => {
  it("is frozen, versioned, and states all seven clauses", () => {
    expect(FC008_SPECIFICITY_ORACLE_RULE_VERSION).toBe("1.0");
    expect(FC008_SPECIFICITY_ORACLE_RULE).toHaveLength(7);
    expect(Object.isFrozen(FC008_SPECIFICITY_ORACLE_RULE)).toBe(true);
  });

  it("names submit/form as the least specific class", () => {
    expect(FC008_LEAST_SPECIFIC_CLASS_INDEX).toBe(12);
    const entry = getSupportMatrixEntry(FC008_LEAST_SPECIFIC_CLASS_INDEX);
    expect(entry?.tuple.verb).toBe("submit");
    expect(entry?.tuple.objectKind).toBe("form");
  });

  it("requires ambiguity rejection rather than arbitrary choice", () => {
    expect(FC008_SPECIFICITY_ORACLE_RULE[4]).toContain("reject the sample as ambiguous");
  });

  it("forbids the oracle class and its proxies from becoming features", () => {
    expect(FC008_SPECIFICITY_ORACLE_RULE[6]).toContain("must never enter model features");
  });

  it("resolves the GitHub visibility example to class 8 rather than class 13", () => {
    expect(FC008_SPECIFICITY_ORACLE_EXAMPLE.correctClassIndex).toBe(7);
    expect(FC008_SPECIFICITY_ORACLE_EXAMPLE.incorrectClassIndex).toBe(12);

    const correct = getSupportMatrixEntry(FC008_SPECIFICITY_ORACLE_EXAMPLE.correctClassIndex);
    expect(correct?.tuple).toEqual({
      verb: "change-access",
      objectKind: "repository",
      transition: { property: "visibility", from: "private", to: "public" },
    });
  });
});

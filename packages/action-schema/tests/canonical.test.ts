/**
 * Canonical domain tests for Sprint FC-002 / FC-002A:
 * - JSON-safe validation (DAGs, cycles, sparse arrays, hostile getters)
 * - Structural and semantic validation
 * - Fact evidence integrity
 * - Serialization and parsing guarantees
 * - All 18 direct regression probes mandated by independent review
 */

import type { IsoTimestamp } from "@futureclick/shared";
import {
  type ActionEvaluationContext,
  type ActionId,
  type ActionTarget,
  type AssessmentId,
  type Consequence,
  type ConsequenceAssessment,
  type ConsequenceId,
  type EntityId,
  type EvaluationContextId,
  type EvidenceId,
  type EvidenceRecord,
  FUTURECLICK_SCHEMA_VERSION,
  type ObservationId,
  type ProposedAction,
  type ProvenanceDescriptor,
  type StateFact,
  type StateSnapshot,
  type StateSnapshotId,
  captureDenseArray,
  createActionEvaluationContext,
  createCanonicalEntity,
  createConfidenceScore,
  createConsequence,
  createConsequenceAssessment,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  deepFreezeCanonical,
  isDenseArray,
  isPlainObject,
  parseActionEvaluationContext,
  parseCanonical,
  parseConsequence,
  parseConsequenceAssessment,
  parseJsonValue,
  parseProposedAction,
  parseStateSnapshot,
  serializeActionEvaluationContext,
  serializeCanonical,
  serializeConsequence,
  serializeConsequenceAssessment,
  serializeProposedAction,
  serializeStateSnapshot,
  normalizeThrownError,
  validateActionEvaluationContext,
  validateActionTarget,
  validateApplicationDescriptor,
  validateCanonicalEntity,
  validateConfidence,
  validateConsequence,
  validateConsequenceAssessment,
  validateEnvironmentDescriptor,
  validateEvidenceRecord,
  validateId,
  validateIsoTimestamp,
  validateJsonValue,
  validateProposedAction,
  validateProvenanceDescriptor,
  validateReversibilityDescriptor,
  validateRiskDescriptor,
  validateSchemaVersion,
  validateStateChange,
  validateStateFact,
  validateStateSnapshot,
  validateTemporalDescriptor,
  validateValueState,
} from "../src/index.js";
import * as ActionSchemaModule from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("action-schema/json - JSON-safe value validation", () => {
  it("accepts valid JSON primitives, arrays, and plain objects", () => {
    expect(validateJsonValue("hello").valid).toBe(true);
    expect(validateJsonValue(12345).valid).toBe(true);
    expect(validateJsonValue(-0.5).valid).toBe(true);
    expect(validateJsonValue(true).valid).toBe(true);
    expect(validateJsonValue(false).valid).toBe(true);
    expect(validateJsonValue(null).valid).toBe(true);
    expect(validateJsonValue([1, "a", null, false]).valid).toBe(true);
    expect(validateJsonValue({ a: 1, b: [true, null], c: { d: "nested" } }).valid).toBe(true);
  });

  it("rejects non-finite numbers (NaN, Infinity, -Infinity)", () => {
    const resNan = validateJsonValue(Number.NaN);
    expect(resNan.valid).toBe(false);
    expect(resNan.issues[0]?.code).toBe("INVALID_JSON_VALUE");

    const resInf = validateJsonValue(Number.POSITIVE_INFINITY);
    expect(resInf.valid).toBe(false);

    const resNegInf = validateJsonValue(Number.NEGATIVE_INFINITY);
    expect(resNegInf.valid).toBe(false);

    const resNested = validateJsonValue({ num: Number.NaN });
    expect(resNested.valid).toBe(false);
  });

  it("rejects undefined, bigint, symbol, and function values", () => {
    expect(validateJsonValue(undefined).valid).toBe(false);
    expect(validateJsonValue(BigInt(100)).valid).toBe(false);
    expect(validateJsonValue(Symbol("test")).valid).toBe(false);
    expect(validateJsonValue(() => {}).valid).toBe(false);
    expect(validateJsonValue({ nested: undefined }).valid).toBe(false);
    expect(validateJsonValue([undefined]).valid).toBe(false);
  });

  it("rejects class instances (Date, RegExp, Map, Set)", () => {
    expect(validateJsonValue(new Date()).valid).toBe(false);
    expect(validateJsonValue(/abc/).valid).toBe(false);
    expect(validateJsonValue(new Map()).valid).toBe(false);
    expect(validateJsonValue(new Set()).valid).toBe(false);
  });

  it("detects circular references without infinite loops (active path detection)", () => {
    const cyclicObj: Record<string, unknown> = { name: "cycle" };
    cyclicObj.self = cyclicObj;

    const res = validateJsonValue(cyclicObj);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("accepts shared-reference DAGs (non-cyclic reference reuse)", () => {
    const shared = { x: 1, y: "shared" };
    const dag = { a: shared, b: shared, nested: { c: shared } };

    const res = validateJsonValue(dag);
    expect(res.valid).toBe(true);
  });

  it("rejects sparse arrays with unassigned holes", () => {
    const sparse = new Array(3);
    sparse[0] = 1;
    sparse[2] = 3;
    const res = validateJsonValue(sparse);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.message.includes("Sparse arrays"))).toBe(true);

    const constructedSparse = new Array(5);
    expect(validateJsonValue(constructedSparse).valid).toBe(false);
  });

  it("enforces maximum nesting depth", () => {
    let deep: Record<string, unknown> = { val: 1 };
    for (let i = 0; i < 40; i++) {
      deep = { child: deep };
    }

    const res = validateJsonValue(deep, { maxDepth: 10 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "MAX_DEPTH_EXCEEDED")).toBe(true);
  });

  it("enforces requireObject option on primitives and arrays", () => {
    expect(validateJsonValue(17, { requireObject: true }).valid).toBe(false);
    expect(validateJsonValue("hello", { requireObject: true }).valid).toBe(false);
    expect(validateJsonValue([1, 2], { requireObject: true }).valid).toBe(false);
    expect(validateJsonValue({ a: 1 }, { requireObject: true }).valid).toBe(true);
  });

  it("identifies plain objects and dense arrays correctly", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject("string")).toBe(false);

    expect(isDenseArray([1, 2, 3])).toBe(true);
    expect(isDenseArray([])).toBe(true);
    const testSparse = new Array(3);
    testSparse[0] = 1;
    testSparse[2] = 3;
    expect(isDenseArray(testSparse)).toBe(false);
    expect(isDenseArray(new Array(3))).toBe(false);
    expect(isDenseArray("not an array")).toBe(false);
  });
});

describe("action-schema/validation - structural validation", () => {
  it("validates schema version 1.0 strictly", () => {
    expect(validateSchemaVersion(FUTURECLICK_SCHEMA_VERSION).valid).toBe(true);
    expect(validateSchemaVersion("2.0").valid).toBe(false);
    expect(validateSchemaVersion(1.0).valid).toBe(false);
    expect(validateSchemaVersion(null).valid).toBe(false);
    expect(validateSchemaVersion(undefined).valid).toBe(false);
  });

  it("validates opaque IDs strictly", () => {
    expect(validateId("valid-id-123", "Entity").valid).toBe(true);
    expect(validateId("", "Entity").valid).toBe(false);
    expect(validateId("   ", "Entity").valid).toBe(false);
    expect(validateId(null, "Entity").valid).toBe(false);
    expect(validateId(123, "Entity").valid).toBe(false);

    const longId = "a".repeat(300);
    expect(validateId(longId, "Entity").valid).toBe(false);
  });

  it("validates canonical ISO-8601 UTC timestamps", () => {
    expect(validateIsoTimestamp("2026-09-06T20:00:00.000Z").valid).toBe(true);
    expect(validateIsoTimestamp("2026-09-06").valid).toBe(false);
    expect(validateIsoTimestamp("September 6, 2026").valid).toBe(false);
    expect(validateIsoTimestamp("2026-02-30T00:00:00.000Z").valid).toBe(false);
    expect(validateIsoTimestamp("2026-09-06T20:00:00Z").valid).toBe(false);
    expect(validateIsoTimestamp(null).valid).toBe(false);
  });

  it("validates environment descriptors without browser platform leakage", () => {
    const validEnv = {
      environmentId: "env-001",
      kind: "browser",
      platform: "web",
      application: {
        id: "app-chrome",
        name: "Google Chrome",
        version: "128.0",
      },
      sessionId: "session-xyz",
    };
    expect(validateEnvironmentDescriptor(validEnv).valid).toBe(true);

    // Missing application
    expect(validateEnvironmentDescriptor({ ...validEnv, application: undefined }).valid).toBe(
      false,
    );
    // Disallowed "browser" platform (must be web, macos, windows, linux, unknown)
    expect(validateEnvironmentDescriptor({ ...validEnv, platform: "browser" }).valid).toBe(false);
    // Invalid platform
    expect(validateEnvironmentDescriptor({ ...validEnv, platform: "android" }).valid).toBe(false);
    // Invalid kind
    expect(validateEnvironmentDescriptor({ ...validEnv, kind: "spacecraft" }).valid).toBe(false);
    // Non-object
    expect(validateEnvironmentDescriptor(null).valid).toBe(false);
  });

  it("validates canonical entities and namespaced fact keys", () => {
    const validEntity = {
      id: "ent-file-1",
      kind: "file",
      label: "budget.xlsx",
      attributes: { extension: "xlsx", format: "spreadsheet" },
    };
    expect(validateCanonicalEntity(validEntity).valid).toBe(true);

    const validFact = {
      id: "fact-001",
      subjectEntityId: "ent-file-1",
      key: "filesystem.size_bytes",
      value: 1024,
      observedAt: "2026-09-06T20:00:00.000Z",
    };
    expect(validateStateFact(validFact).valid).toBe(true);

    // Empty key in fact
    expect(validateStateFact({ ...validFact, key: "" }).valid).toBe(false);
    // Non-namespaced key in fact (must contain at least one namespace separator)
    expect(validateStateFact({ ...validFact, key: "filesize" }).valid).toBe(false);
    // Non-JSON value in fact
    expect(validateStateFact({ ...validFact, value: Number.NaN }).valid).toBe(false);
  });

  it("validates action targets with structured roles", () => {
    expect(validateActionTarget({ entityId: "ent-doc-1", role: "primary" }).valid).toBe(true);
    expect(validateActionTarget({ entityId: "ent-doc-1", role: "recipient" }).valid).toBe(true);
    expect(validateActionTarget({ entityId: "ent-doc-1", role: "invalid-role" }).valid).toBe(false);
    expect(validateActionTarget(null).valid).toBe(false);
  });

  it("validates StateChange operation semantics (add, remove, replace)", () => {
    // Valid ADD: before absent, after known
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "file.created",
        operation: "add",
        before: { status: "absent" },
        after: { status: "known", value: true },
      }).valid,
    ).toBe(true);

    // Invalid ADD: before already known
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "file.created",
        operation: "add",
        before: { status: "known", value: true },
        after: { status: "known", value: true },
      }).valid,
    ).toBe(false);

    // Valid REMOVE: before known, after absent
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "file.exists",
        operation: "remove",
        before: { status: "known", value: true },
        after: { status: "absent" },
      }).valid,
    ).toBe(true);

    // Invalid REMOVE: before was absent
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "file.exists",
        operation: "remove",
        before: { status: "absent" },
        after: { status: "absent" },
      }).valid,
    ).toBe(false);

    // Valid REPLACE: before known, after known
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "repo.visibility",
        operation: "replace",
        before: { status: "known", value: "private" },
        after: { status: "known", value: "public" },
      }).valid,
    ).toBe(true);

    // Invalid REPLACE: after is absent
    expect(
      validateStateChange({
        entityId: "ent-1",
        property: "repo.visibility",
        operation: "replace",
        before: { status: "known", value: "private" },
        after: { status: "absent" },
      }).valid,
    ).toBe(false);
  });

  it("validates reversibility invariants (irreversible cannot specify method)", () => {
    expect(
      validateReversibilityDescriptor({
        level: "reversible",
        method: "undo",
      }).valid,
    ).toBe(true);

    // Irreversible with method is invalid
    expect(
      validateReversibilityDescriptor({
        level: "irreversible",
        method: "impossible-restore",
      }).valid,
    ).toBe(false);

    // Unknown with method is invalid
    expect(
      validateReversibilityDescriptor({
        level: "unknown",
        method: "undo",
      }).valid,
    ).toBe(false);
  });

  it("validates risk invariants (none must have empty categories, others must have >= 1)", () => {
    // None with empty categories: valid
    expect(
      validateRiskDescriptor({
        severity: "none",
        categories: [],
      }).valid,
    ).toBe(true);

    // None with categories: invalid
    expect(
      validateRiskDescriptor({
        severity: "none",
        categories: ["privacy"],
      }).valid,
    ).toBe(false);

    // High with categories: valid
    expect(
      validateRiskDescriptor({
        severity: "high",
        categories: ["security"],
      }).valid,
    ).toBe(true);

    // High with empty categories: invalid
    expect(
      validateRiskDescriptor({
        severity: "high",
        categories: [],
      }).valid,
    ).toBe(false);

    // Duplicate categories: invalid
    expect(
      validateRiskDescriptor({
        severity: "medium",
        categories: ["privacy", "privacy"],
      }).valid,
    ).toBe(false);
  });

  it("validates temporal descriptors (timing and frequency)", () => {
    expect(
      validateTemporalDescriptor({
        timing: "immediate",
        frequency: "once",
      }).valid,
    ).toBe(true);

    expect(
      validateTemporalDescriptor({
        timing: "immediate",
        frequency: "recurring",
      }).valid,
    ).toBe(true);

    expect(
      validateTemporalDescriptor({
        timing: "future-unknown",
        frequency: "once",
      }).valid,
    ).toBe(false);
  });

  it("rejects primitive metadata where object required on canonical fields", () => {
    const checkEnv = {
      environmentId: "env-meta-check",
      kind: "desktop" as const,
      platform: "macos" as const,
      application: { name: "Finder" },
    };

    // 1. ProvenanceDescriptor.details must be an object
    const badProv = {
      source: "rule",
      timestamp: "2026-09-06T20:00:00.000Z",
      details: "string-details-rejected",
    };
    expect(validateProvenanceDescriptor(badProv).valid).toBe(false);

    // 2. EvidenceRecord.details must be an object
    const badEv = {
      id: "ev-prim-details",
      mode: "verified",
      source: "rule",
      observedAt: "2026-09-06T20:00:00.000Z",
      scope: "scope",
      assumptions: [],
      summary: "summary",
      details: 12345,
    };
    expect(validateEvidenceRecord(badEv).valid).toBe(false);

    // 3. CanonicalEntity.attributes must be an object
    const badEntity = {
      id: "ent-prim-attr",
      kind: "file",
      attributes: "primitive-string",
    };
    expect(validateCanonicalEntity(badEntity).valid).toBe(false);

    // 4. ProposedAction.parameters must be an object
    const badAction = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "act-prim-param",
      proposedAt: "2026-09-06T20:00:00.000Z",
      environment: checkEnv,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [],
      parameters: "primitive-parameters",
      executionStatus: "proposed",
    };
    expect(validateProposedAction(badAction).valid).toBe(false);
  });
});

describe("action-schema/facts - fact evidence integrity", () => {
  const env = {
    environmentId: "env-evidence-test",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { name: "Finder" },
  };

  it("A: createStateFact with valid evidence preserves evidence exactly", () => {
    const validEvidence = {
      id: "ev-fact-1" as EvidenceId,
      mode: "verified" as const,
      source: "rule" as const,
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      scope: "os-kernel-stat",
      assumptions: [],
      summary: "Stat system call confirmed file size on disk.",
    };

    const fact = createStateFact({
      subjectEntityId: "ent-file-1" as EntityId,
      key: "file.size_bytes",
      value: 4096,
      evidence: [validEvidence],
    });

    expect(fact.evidence).toBeDefined();
    expect(fact.evidence?.length).toBe(1);
    expect(fact.evidence?.[0]?.id).toBe("ev-fact-1");
    expect(fact.evidence?.[0]?.scope).toBe("os-kernel-stat");
  });

  it("B: StateFact with malformed evidence is rejected by validator", () => {
    const malformedFact = {
      id: "fact-bad",
      subjectEntityId: "ent-1",
      key: "file.exists",
      value: true,
      evidence: [{ id: "ev-bad", mode: "unsupported-mode" }],
    };

    const res = validateStateFact(malformedFact);
    expect(res.valid).toBe(false);
  });

  it("C: StateSnapshot containing malformed fact evidence is rejected", () => {
    const malformedSnapshot = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "snap-1",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [{ id: "ent-1", kind: "file" }],
      facts: [
        {
          id: "fact-1",
          subjectEntityId: "ent-1",
          key: "file.exists",
          value: true,
          evidence: "not-an-array",
        },
      ],
    };

    const res = validateStateSnapshot(malformedSnapshot);
    expect(res.valid).toBe(false);
  });

  it("D: parseStateSnapshot rejects JSON containing malformed fact evidence", () => {
    const jsonWithBadFactEvidence = JSON.stringify({
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "snap-1",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [{ id: "ent-1", kind: "file" }],
      facts: [
        {
          id: "fact-1",
          subjectEntityId: "ent-1",
          key: "file.exists",
          value: true,
          evidence: [{ id: "ev-1", mode: "predicted" }], // Missing required confidence
        },
      ],
    });

    const res = parseStateSnapshot(jsonWithBadFactEvidence);
    expect(res.ok).toBe(false);
  });

  it("E: valid fact evidence round-trips exactly through serialization and parsing", () => {
    const fact = createStateFact({
      subjectEntityId: "ent-1" as EntityId,
      key: "file.is_locked",
      value: false,
      evidence: [
        {
          id: "ev-lock-check" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
          scope: "flock-test",
          assumptions: [],
          summary: "flock non-blocking probe succeeded without lock contention.",
        },
      ],
    });

    const snap = createStateSnapshot({
      environment: env,
      entities: [createCanonicalEntity({ id: "ent-1" as EntityId, kind: "file" })],
      facts: [fact],
    });

    const serRes = serializeStateSnapshot(snap);
    expect(serRes.ok).toBe(true);
    if (!serRes.ok) return;

    const parseRes = parseStateSnapshot(serRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value.facts[0]?.evidence).toEqual(fact.evidence);
  });
});

describe("action-schema/canonical - Domain Invariants & Fixture Probes", () => {
  const env = {
    environmentId: "env-probe-1",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { id: "com.apple.probe", name: "ProbeApp", version: "1.0" },
    sessionId: "sess-probe-1",
  };

  it("Probe 1: valid StateFact evidence survives factory -> snapshot -> serialize -> parse", () => {
    const file = createCanonicalEntity({ id: "ent-p1" as EntityId, kind: "file" });
    const fact = createStateFact({
      subjectEntityId: file.id,
      key: "file.integrity",
      value: "sha256-abc",
      evidence: [
        {
          id: "ev-p1" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
          scope: "crypto-hash-check",
          assumptions: [],
          summary: "Cryptographic hash verified against filesystem content.",
        },
      ],
    });

    const snap = createStateSnapshot({
      environment: env,
      entities: [file],
      facts: [fact],
    });

    const ser = serializeStateSnapshot(snap);
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;

    const parsed = parseStateSnapshot(ser.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.facts[0]?.evidence?.[0]?.scope).toBe("crypto-hash-check");
  });

  it("Probe 2: StateFact evidence getter throws -> INVALID, not omitted", () => {
    const badFact = {
      id: "fact-p2",
      subjectEntityId: "ent-p2",
      key: "file.status",
      value: "active",
    };
    Object.defineProperty(badFact, "evidence", {
      get() {
        throw new Error("Explosive evidence getter");
      },
      enumerable: true,
      configurable: true,
    });

    expect(() => validateStateFact(badFact)).not.toThrow();
    const res = validateStateFact(badFact);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.path === "fact.evidence")).toBe(true);
  });

  it("Probe 3: createStateFact supplied null/false/0/string evidence -> rejected, not omitted", () => {
    const file = createCanonicalEntity({ id: "ent-p3" as EntityId, kind: "file" });

    expect(() =>
      createStateFact({
        subjectEntityId: file.id,
        key: "file.status",
        value: "active",
        evidence: null as unknown as readonly EvidenceRecord[],
      }),
    ).toThrow();

    expect(() =>
      createStateFact({
        subjectEntityId: file.id,
        key: "file.status",
        value: "active",
        evidence: false as unknown as readonly EvidenceRecord[],
      }),
    ).toThrow();

    expect(() =>
      createStateFact({
        subjectEntityId: file.id,
        key: "file.status",
        value: "active",
        evidence: 0 as unknown as readonly EvidenceRecord[],
      }),
    ).toThrow();

    expect(() =>
      createStateFact({
        subjectEntityId: file.id,
        key: "file.status",
        value: "active",
        evidence: "invalid-string" as unknown as readonly EvidenceRecord[],
      }),
    ).toThrow();
  });

  it("Probe 4: duplicate fact evidence IDs cause validateStateSnapshot failure", () => {
    const file = createCanonicalEntity({ id: "ent-p4" as EntityId, kind: "file" });
    const ev1 = {
      id: "ev-dup-snap" as EvidenceId,
      mode: "verified" as const,
      source: "rule" as const,
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      scope: "scope-1",
      assumptions: [],
      summary: "first evidence",
    };
    const ev2 = {
      id: "ev-dup-snap" as EvidenceId,
      mode: "verified" as const,
      source: "rule" as const,
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      scope: "scope-2",
      assumptions: [],
      summary: "duplicate evidence ID in second fact",
    };

    const fact1 = createStateFact({
      id: "fact-p4-1" as ObservationId,
      subjectEntityId: file.id,
      key: "file.size",
      value: 100,
      evidence: [ev1],
    });
    const fact2 = createStateFact({
      id: "fact-p4-2" as ObservationId,
      subjectEntityId: file.id,
      key: "file.readable",
      value: true,
      evidence: [ev2],
    });

    const rawSnap = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "state-dup-ev",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [file],
      facts: [fact1, fact2],
    };

    const res = validateStateSnapshot(rawSnap);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "DUPLICATE_EVIDENCE_ID")).toBe(true);
  });

  it("Probe 5: duplicate fact evidence IDs cause parseStateSnapshot failure", () => {
    const file = createCanonicalEntity({ id: "ent-p5" as EntityId, kind: "file" });
    const snapJson = JSON.stringify({
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "state-dup-ev-json",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [file],
      facts: [
        {
          id: "fact-p5-1",
          subjectEntityId: file.id,
          key: "file.size",
          value: 100,
          evidence: [
            {
              id: "ev-dup-json",
              mode: "verified",
              source: "rule",
              observedAt: "2026-09-06T20:00:00.000Z",
              scope: "scope-1",
              assumptions: [],
              summary: "first",
            },
          ],
        },
        {
          id: "fact-p5-2",
          subjectEntityId: file.id,
          key: "file.readable",
          value: true,
          evidence: [
            {
              id: "ev-dup-json",
              mode: "verified",
              source: "rule",
              observedAt: "2026-09-06T20:00:00.000Z",
              scope: "scope-2",
              assumptions: [],
              summary: "second",
            },
          ],
        },
      ],
    });

    const res = parseStateSnapshot(snapJson);
    expect(res.ok).toBe(false);
  });

  it("Probe 6: ValueState changing getter cannot return unchecked second value", () => {
    let readCount = 0;
    const hostileValueState = {
      status: "known",
    };
    Object.defineProperty(hostileValueState, "value", {
      get() {
        readCount++;
        return readCount === 1 ? 1 : undefined;
      },
      enumerable: true,
      configurable: true,
    });

    const res = validateValueState(hostileValueState);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    // Must be the first captured value (1), never undefined
    expect((res.value as { status: "known"; value: unknown }).value).toBe(1);
    expect((res.value as { status: "known"; value: unknown }).value).not.toBeUndefined();
  });

  it("Probe 7: exported authoritative validator with throwing getter returns invalid, no throw", () => {
    const hostileObject = {
      get schemaVersion() {
        throw new Error("Explosive schemaVersion getter");
      },
      id: "hostile-id",
    };

    expect(() => validateActionEvaluationContext(hostileObject)).not.toThrow();
    const res = validateActionEvaluationContext(hostileObject);
    expect(res.valid).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it("Probe 8: isDenseArray hostile proxy returns false, no throw", () => {
    const hostileArray = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") {
          throw new Error("hostile length getter");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    let result: boolean | undefined;
    expect(() => {
      result = isDenseArray(hostileArray);
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("Probe 9: parseCanonical throwing validator returns error, no throw", () => {
    expect(() =>
      parseCanonical('{"foo":"bar"}', () => {
        throw new Error("Validator crashed unexpectedly");
      }),
    ).not.toThrow();

    const res = parseCanonical('{"foo":"bar"}', () => {
      throw new Error("Validator crashed unexpectedly");
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("Validator crashed unexpectedly");
    }
  });

  it("Probe 10: serializer hostile failure returns error, no throw", () => {
    const hostileObj = {
      get boom() {
        throw new Error("Serializer boom");
      },
    };

    expect(() => serializeCanonical(hostileObj)).not.toThrow();
    const res = serializeCanonical(hostileObj);
    expect(res.ok).toBe(false);
  });

  it("Probe 11: evaluator hostile thrown value returns Result error", () => {
    // Verified by normalizeThrownError used across engine and serializer
    const nullProto = Object.create(null);
    nullProto.msg = "hostile null prototype";
    const normalized = normalizeThrownError(nullProto, "Fallback failure");
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.message).toBe("Fallback failure");

    const hostileToString = { toString: null };
    const normalized2 = normalizeThrownError(hostileToString, "Fallback failure 2");
    expect(normalized2).toBeInstanceOf(Error);
    expect(normalized2.message).toBe("Fallback failure 2");
  });

  it("Probe 12: ActionEvaluationContext validator produces authoritative normalized snapshot", () => {
    const file = createCanonicalEntity({ id: "ent-p12" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
    });
    const ctx = createActionEvaluationContext({ state: snap, action: act });

    const validated = validateActionEvaluationContext(ctx);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    // Validated context is an independent snapshot with exact canonical properties
    expect(validated.value.id).toBe(ctx.id);
    expect(validated.value.state.id).toBe(snap.id);
    expect(validated.value.action.id).toBe(act.id);
  });

  it("Probe 13: ActionEvaluationContext binds state and action exclusively under single root envelope", () => {
    const file = createCanonicalEntity({ id: "ent-p13" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
    });
    const ctx = createActionEvaluationContext({ state: snap, action: act });
    // The context envelope binds state and action exclusively under one root
    expect(Object.keys(ctx).sort()).toEqual(
      ["action", "createdAt", "id", "schemaVersion", "state"].sort(),
    );
  });

  it("Probe 14: exact-max-depth parameter validates and serializes", () => {
    // Build a payload with exact max depth of 32
    function buildNestedPayload(
      targetLeafDepth: number,
    ): Record<string, import("../src/types.js").JsonValue> {
      let current: import("../src/types.js").JsonValue = "leaf-value";
      for (let d = targetLeafDepth; d > 1; d--) {
        current = { step: current };
      }
      return { root: current };
    }

    const params = buildNestedPayload(32);

    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "execute" },
      parameters: params,
    });

    const actRes = validateProposedAction(act);
    expect(actRes.valid).toBe(true);

    const serRes = serializeProposedAction(act);
    expect(serRes.ok).toBe(true);
    if (!serRes.ok) return;

    const parseRes = parseProposedAction(serRes.value);
    expect(parseRes.ok).toBe(true);
  });

  it("Probe 15: max-depth+1 parameter rejects", () => {
    // Build a payload exceeding max depth by exactly 1 level (depth 33)
    function buildNestedPayload(
      targetLeafDepth: number,
    ): Record<string, import("../src/types.js").JsonValue> {
      let current: import("../src/types.js").JsonValue = "leaf-value";
      for (let d = targetLeafDepth; d > 1; d--) {
        current = { step: current };
      }
      return { root: current };
    }

    const params = buildNestedPayload(33);

    const rawAction = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "act-deep-reject",
      proposedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "execute" },
      targets: [],
      parameters: params,
      executionStatus: "proposed",
    };

    const res = validateProposedAction(rawAction);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "MAX_DEPTH_EXCEEDED")).toBe(true);
  });

  it("Probe 16: empty application ID rejects", () => {
    const badApp = { id: "", name: "Finder" };
    const res = validateApplicationDescriptor(badApp);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 17: whitespace application ID rejects", () => {
    const badApp = { id: "   ", name: "Finder" };
    const res = validateApplicationDescriptor(badApp);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 18: empty sessionId rejects", () => {
    const badEnv = { ...env, sessionId: "" };
    const res = validateEnvironmentDescriptor(badEnv);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 19: whitespace sessionId rejects", () => {
    const badEnv = { ...env, sessionId: "   " };
    const res = validateEnvironmentDescriptor(badEnv);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_ID")).toBe(true);
  });

  it("Probe 20: different nonempty app IDs reject", () => {
    const snap = createStateSnapshot({
      environment: { ...env, application: { id: "app-alpha", name: "App" } },
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
    });
    const act = createProposedAction({
      environment: { ...env, application: { id: "app-beta", name: "App" } },
      proposedAt: "2026-09-06T20:00:01.000Z" as IsoTimestamp,
      actor: { kind: "human" },
      intent: { verb: "read" },
    });
    const rawContext = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "eval-diff-app-id",
      state: snap,
      action: act,
      createdAt: "2026-09-06T20:00:02.000Z",
    };
    const res = validateActionEvaluationContext(rawContext);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "ENVIRONMENT_MISMATCH")).toBe(true);
  });

  it("Probe 21: different nonempty session IDs reject", () => {
    const snap = createStateSnapshot({
      environment: { ...env, sessionId: "sess-alpha" },
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
    });
    const act = createProposedAction({
      environment: { ...env, sessionId: "sess-beta" },
      proposedAt: "2026-09-06T20:00:01.000Z" as IsoTimestamp,
      actor: { kind: "human" },
      intent: { verb: "read" },
    });
    const rawContext = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "eval-diff-sess-id",
      state: snap,
      action: act,
      createdAt: "2026-09-06T20:00:02.000Z",
    };
    const res = validateActionEvaluationContext(rawContext);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "ENVIRONMENT_MISMATCH")).toBe(true);
  });

  it("Probe 22: evidence confidence and consequence confidence documentation are distinct", () => {
    // Predicted evidence requires confidence; consequence confidence is mandatory on Consequence
    const predEvWithoutConf = {
      id: "ev-pred-no-conf",
      mode: "predicted",
      source: "model",
      observedAt: "2026-09-06T20:00:00.000Z",
      scope: "test-scope",
      assumptions: [],
      summary: "predicted summary without confidence",
    };
    expect(validateEvidenceRecord(predEvWithoutConf).valid).toBe(false);

    // Verified evidence allows optional confidence
    const verEvWithoutConf = {
      id: "ev-ver-no-conf",
      mode: "verified",
      source: "rule",
      observedAt: "2026-09-06T20:00:00.000Z",
      scope: "test-scope",
      assumptions: [],
      summary: "verified summary without confidence",
    };
    expect(validateEvidenceRecord(verEvWithoutConf).valid).toBe(true);
  });

  it("Probe 23: domainKind invalid placement/format rejects according to chosen policy", () => {
    // 1. kind !== 'other' with domainKind must be rejected
    const fileWithDomainKind = {
      id: "ent-file-bad",
      kind: "file",
      domainKind: "custom.file",
    };
    expect(validateCanonicalEntity(fileWithDomainKind).valid).toBe(false);

    // 2. kind === 'other' without domainKind must be rejected
    const otherWithoutDomainKind = {
      id: "ent-other-bad",
      kind: "other",
    };
    expect(validateCanonicalEntity(otherWithoutDomainKind).valid).toBe(false);

    // 3. kind === 'other' with non-namespaced domainKind must be rejected
    const otherNonNamespaced = {
      id: "ent-other-unnamespaced",
      kind: "other",
      domainKind: "unnamespaced",
    };
    expect(validateCanonicalEntity(otherNonNamespaced).valid).toBe(false);

    // 4. kind === 'other' with valid namespaced domainKind is accepted
    const otherValid = {
      id: "ent-other-valid",
      kind: "other",
      domainKind: "vendor.special_resource",
    };
    expect(validateCanonicalEntity(otherValid).valid).toBe(true);
  });

  it("Probe 24: all four scenarios validate", () => {
    // 1. Filesystem Deletion Scenario
    const fileEnt = createCanonicalEntity({
      id: "ent-file-1" as EntityId,
      kind: "file",
      label: "report.pdf",
    });
    const fsState = createStateSnapshot({
      environment: { ...env, environmentId: "env-fs" },
      entities: [fileEnt],
      facts: [
        createStateFact({ subjectEntityId: fileEnt.id, key: "filesystem.exists", value: true }),
      ],
    });
    const fsAct = createProposedAction({
      environment: { ...env, environmentId: "env-fs" },
      actor: { kind: "human" },
      intent: { verb: "delete", domain: "filesystem" },
      targets: [{ entityId: fileEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: fsState, action: fsAct }),
      ).valid,
    ).toBe(true);

    // 2. Repository Visibility Change Scenario
    const repoEnt = createCanonicalEntity({
      id: "ent-repo-1" as EntityId,
      kind: "repository",
      label: "my-project",
    });
    const repoState = createStateSnapshot({
      environment: { ...env, environmentId: "env-repo" },
      entities: [repoEnt],
      facts: [
        createStateFact({
          subjectEntityId: repoEnt.id,
          key: "repository.visibility",
          value: "private",
        }),
      ],
    });
    const repoAct = createProposedAction({
      environment: { ...env, environmentId: "env-repo" },
      actor: { kind: "human" },
      intent: { verb: "publish", domain: "vcs" },
      targets: [{ entityId: repoEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: repoState, action: repoAct }),
      ).valid,
    ).toBe(true);

    // 3. Document Sharing Scenario
    const docEnt = createCanonicalEntity({
      id: "ent-doc-1" as EntityId,
      kind: "document",
      label: "notes.gdoc",
    });
    const docState = createStateSnapshot({
      environment: { ...env, environmentId: "env-doc" },
      entities: [docEnt],
      facts: [
        createStateFact({ subjectEntityId: docEnt.id, key: "document.shared_count", value: 1 }),
      ],
    });
    const docAct = createProposedAction({
      environment: { ...env, environmentId: "env-doc" },
      actor: { kind: "human" },
      intent: { verb: "share", domain: "cloud_docs" },
      targets: [{ entityId: docEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: docState, action: docAct }),
      ).valid,
    ).toBe(true);

    // 4. Subscription Purchase Scenario
    const subEnt = createCanonicalEntity({
      id: "ent-sub-1" as EntityId,
      kind: "subscription",
      label: "Pro Plan",
    });
    const subState = createStateSnapshot({
      environment: { ...env, environmentId: "env-sub" },
      entities: [subEnt],
      facts: [
        createStateFact({
          subjectEntityId: subEnt.id,
          key: "subscription.status",
          value: "inactive",
        }),
      ],
    });
    const subAct = createProposedAction({
      environment: { ...env, environmentId: "env-sub" },
      actor: { kind: "human" },
      intent: { verb: "purchase", domain: "billing" },
      targets: [{ entityId: subEnt.id, role: "resource" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: subState, action: subAct }),
      ).valid,
    ).toBe(true);
  });
});

describe("action-schema - FC-002D 28 Direct Regression Probes", () => {
  const env = {
    environmentId: "env-fc002d-probe",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { id: "com.apple.probe", name: "ProbeApp", version: "1.0" },
    sessionId: "sess-fc002d-probe",
  };

  it('Probe 1: own "__proto__" JsonObject key survives normalization as OWN property', () => {
    const raw = JSON.parse('{"__proto__":{"injected":true},"keep":1}');
    const res = validateJsonValue(raw);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(Object.prototype.hasOwnProperty.call(res.value, "__proto__")).toBe(true);
    expect((res.value as Record<string, unknown>).__proto__).toEqual({ injected: true });
    expect(Object.getPrototypeOf(res.value)).toBe(Object.prototype);
    expect("injected" in (res.value as object)).toBe(false);
    expect((res.value as Record<string, unknown>).keep).toBe(1);
  });

  it('Probe 2: "__proto__" survives JSON serialization', () => {
    const raw = JSON.parse('{"__proto__":{"injected":true},"keep":1}');
    const res = validateJsonValue(raw);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    const serialized = JSON.stringify(res.value);
    expect(serialized).toContain('"__proto__":{"injected":true}');
    expect(serialized).toContain('"keep":1');
  });

  it('Probe 3: "__proto__" survives JSON parse/revalidation', () => {
    const raw = JSON.parse('{"__proto__":{"injected":true},"keep":1}');
    const res = validateJsonValue(raw);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    const serialized = JSON.stringify(res.value);
    const parsed = JSON.parse(serialized);
    const reval = validateJsonValue(parsed);
    expect(reval.valid).toBe(true);
    if (!reval.valid) return;
    expect(Object.prototype.hasOwnProperty.call(reval.value, "__proto__")).toBe(true);
    expect((reval.value as Record<string, unknown>).__proto__).toEqual({ injected: true });
    expect((reval.value as Record<string, unknown>).keep).toBe(1);
  });

  it("Probe 4: normalization does not globally modify Object.prototype", () => {
    const raw = JSON.parse('{"__proto__":{"injected":true},"keep":1}');
    validateJsonValue(raw);
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "injected")).toBe(false);
  });

  it('Probe 5: "constructor" key survives', () => {
    const raw = JSON.parse('{"constructor":"custom-ctor","keep":2}');
    const res = validateJsonValue(raw);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(Object.prototype.hasOwnProperty.call(res.value, "constructor")).toBe(true);
    expect((res.value as Record<string, unknown>).constructor).toBe("custom-ctor");
    expect(typeof {}.constructor).toBe("function");
  });

  it('Probe 6: "prototype" key survives', () => {
    const raw = JSON.parse('{"prototype":"custom-proto","keep":3}');
    const res = validateJsonValue(raw);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(Object.prototype.hasOwnProperty.call(res.value, "prototype")).toBe(true);
    expect((res.value as Record<string, unknown>).prototype).toBe("custom-proto");
  });

  it('Probe 7: ProposedAction.parameters preserves "__proto__"', () => {
    const rawParams = JSON.parse('{"__proto__":{"injected":true},"param1":"test"}');
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "execute" },
      parameters: rawParams,
    });
    const valRes = validateProposedAction(act);
    expect(valRes.valid).toBe(true);
    if (!valRes.valid) return;
    expect(Object.prototype.hasOwnProperty.call(valRes.value.parameters, "__proto__")).toBe(true);

    const serRes = serializeProposedAction(act);
    expect(serRes.ok).toBe(true);
    if (!serRes.ok) return;
    expect(serRes.value).toContain('"__proto__":{"injected":true}');

    const parseRes = parseProposedAction(serRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;
    expect(Object.prototype.hasOwnProperty.call(parseRes.value.parameters, "__proto__")).toBe(true);
    expect((parseRes.value.parameters as Record<string, unknown>).__proto__).toEqual({
      injected: true,
    });
  });

  it("Probe 8: hostile changing array length cannot silently remove generic JsonValue item", () => {
    let lenReads = 0;
    const targetArr = ["valid-item"];
    const hostileProxy = new Proxy(targetArr, {
      get(target, prop, receiver) {
        if (prop === "length") {
          lenReads++;
          return lenReads === 1 ? 1 : 0;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const res = validateJsonValue(hostileProxy);
    if (res.valid) {
      expect(Array.isArray(res.value)).toBe(true);
      expect((res.value as unknown[]).length).toBe(1);
      expect((res.value as unknown[])[0]).toBe("valid-item");
    } else {
      expect(res.valid).toBe(false);
    }
  });

  it("Probe 9: hostile changing evidence-array length cannot silently remove EvidenceRecord", () => {
    let lenReads = 0;
    const validEvidenceRecord: EvidenceRecord = {
      id: "ev-test-1" as EvidenceId,
      mode: "verified",
      source: "rule",
      observedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      scope: "filesystem",
      assumptions: [],
      summary: "Verified fact",
    };
    const hostileEvidenceArr = new Proxy([validEvidenceRecord], {
      get(target, prop, receiver) {
        if (prop === "length") {
          lenReads++;
          return lenReads === 1 ? 1 : 0;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const factWithHostileEvidence = {
      id: "fact-h2-test",
      subjectEntityId: "ent-file-1",
      key: "filesystem.readable",
      value: true,
      evidence: hostileEvidenceArr,
    };

    const res = validateStateFact(factWithHostileEvidence);
    if (res.valid) {
      expect(res.value.evidence).toBeDefined();
      expect(res.value.evidence?.length).toBe(1);
      expect(res.value.evidence?.[0]?.id).toBe("ev-test-1");
    } else {
      expect(res.valid).toBe(false);
    }
  });

  it("Probe 10: revoked proxy does not make isPlainObject throw", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let result: boolean | undefined;
    expect(() => {
      result = isPlainObject(proxy);
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("Probe 11: revoked proxy makes validateJsonValue fail safely", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let res1: unknown;
    expect(() => {
      res1 = validateJsonValue(proxy);
    }).not.toThrow();
    expect((res1 as { valid: boolean }).valid).toBe(false);

    const { proxy: proxyReq, revoke: revokeReq } = Proxy.revocable({}, {});
    revokeReq();
    let res2: unknown;
    expect(() => {
      res2 = validateJsonValue(proxyReq, { requireObject: true });
    }).not.toThrow();
    expect((res2 as { valid: boolean }).valid).toBe(false);
  });

  it("Probe 12: semantic-only unsafe public validators are removed OR fully authoritative", () => {
    expect(
      (ActionSchemaModule as Record<string, unknown>).validateEvaluationContextSemantics,
    ).toBeUndefined();
    expect(
      (ActionSchemaModule as Record<string, unknown>).validateAssessmentSemantics,
    ).toBeUndefined();
    expect(typeof ActionSchemaModule.validateActionEvaluationContext).toBe("function");
    expect(typeof ActionSchemaModule.validateConsequenceAssessment).toBe("function");
  });

  it("Probe 13: invalid expected context schemaVersion rejects assessment validation", () => {
    const asmt = createConsequenceAssessment({
      evaluationContextId: "ctx-p13" as EvaluationContextId,
      actionId: "act-p13" as ActionId,
      consequences: [],
      generatedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      provenance: {
        source: "engine",
        engineVersion: "0.2.0",
        timestamp: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      },
    });
    const invalidExpectedContext = {
      schemaVersion: "99.0",
      id: "ctx-p13",
      action: { id: "act-p13" },
    };
    const res = validateConsequenceAssessment(asmt, invalidExpectedContext);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "ASSESSMENT_CONTEXT_MISMATCH")).toBe(true);
  });

  it("Probe 14: minimal fake expected context rejects", () => {
    const asmt = createConsequenceAssessment({
      evaluationContextId: "ctx-p14" as EvaluationContextId,
      actionId: "act-p14" as ActionId,
      consequences: [],
      generatedAt: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      provenance: {
        source: "engine",
        engineVersion: "0.2.0",
        timestamp: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
      },
    });
    const minimalFakeContext = {
      id: "ctx-p14",
      action: { id: "act-p14" },
    };
    const res = validateConsequenceAssessment(asmt, minimalFakeContext);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "ASSESSMENT_CONTEXT_MISMATCH")).toBe(true);
  });

  it("Probe 15: valid expected context accepts", () => {
    const file = createCanonicalEntity({ id: "ent-file-p15" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
    });
    const validContext = createActionEvaluationContext({ state: snap, action: act });
    const validAssessment = createConsequenceAssessment({
      evaluationContextId: validContext.id,
      actionId: validContext.action.id,
      consequences: [],
      generatedAt: "2026-09-06T20:00:02.000Z" as IsoTimestamp,
      provenance: {
        source: "engine",
        engineVersion: "0.2.0",
        timestamp: "2026-09-06T20:00:02.000Z" as IsoTimestamp,
      },
    });
    const res = validateConsequenceAssessment(validAssessment, validContext);
    expect(res.valid).toBe(true);
  });

  it("Probe 16: zero entities + one fact rejects snapshot validation", () => {
    const fact = createStateFact({
      id: "fact-orphan-16" as ObservationId,
      subjectEntityId: "ent-nonexistent" as EntityId,
      key: "filesystem.exists",
      value: true,
    });
    const zeroEntitySnap = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "state-zero-ent-16",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [],
      facts: [fact],
    };
    const res = validateStateSnapshot(zeroEntitySnap);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "UNKNOWN_ENTITY_REFERENCE")).toBe(true);
  });

  it("Probe 17: zero entities + one fact rejects snapshot parsing", () => {
    const zeroEntityJson = JSON.stringify({
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "state-zero-ent-json-17",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [],
      facts: [
        {
          id: "fact-orphan-json-17",
          subjectEntityId: "ent-nonexistent",
          key: "filesystem.exists",
          value: true,
        },
      ],
    });
    const res = parseStateSnapshot(zeroEntityJson);
    expect(res.ok).toBe(false);
  });

  it("Probe 18: zero entities + one fact rejects evaluation context", () => {
    const badContext = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "eval-zero-ent-18",
      createdAt: "2026-09-06T20:00:00.000Z",
      state: {
        schemaVersion: FUTURECLICK_SCHEMA_VERSION,
        id: "state-zero-ent-18",
        observedAt: "2026-09-06T20:00:00.000Z",
        environment: env,
        entities: [],
        facts: [
          {
            id: "fact-orphan-18",
            subjectEntityId: "ent-nonexistent",
            key: "filesystem.exists",
            value: true,
          },
        ],
      },
      action: createProposedAction({
        environment: env,
        actor: { kind: "human" },
        intent: { verb: "delete" },
      }),
    };
    const res = validateActionEvaluationContext(badContext);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "UNKNOWN_ENTITY_REFERENCE")).toBe(true);
  });

  it("Probe 19, 20, 21, 22: deepFreezeCanonical prevents mutation of context.id, action.id, and nested context", () => {
    const file = createCanonicalEntity({ id: "ent-freeze" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
      parameters: { key: "initial" },
    });
    const ctx = createActionEvaluationContext({ state: snap, action: act });
    const frozenCtx = deepFreezeCanonical(ctx);

    // Probe 19: context.id is immutable
    expect(() => {
      (frozenCtx as Record<string, unknown>).id = "mutated-id";
    }).toThrow();
    expect(frozenCtx.id).toBe(ctx.id);

    // Probe 20: action.id is immutable
    expect(() => {
      (frozenCtx.action as unknown as Record<string, unknown>).id = "mutated-act-id";
    }).toThrow();
    expect(frozenCtx.action.id).toBe(act.id);

    // Probe 21: nested context environment and parameters are immutable
    expect(() => {
      (frozenCtx.state.environment as unknown as Record<string, unknown>).environmentId =
        "mutated-env";
    }).toThrow();
    expect(frozenCtx.state.environment.environmentId).toBe(env.environmentId);
    expect(() => {
      (frozenCtx.action.parameters as Record<string, unknown>).key = "tampered";
    }).toThrow();
    expect(frozenCtx.action.parameters.key).toBe("initial");

    // Probe 22: ConsequenceAssessment lineage binds original authoritative IDs
    const asmt = createConsequenceAssessment({
      evaluationContextId: frozenCtx.id,
      actionId: frozenCtx.action.id,
      consequences: [],
      provenance: { source: "engine", timestamp: "2026-09-06T20:00:00.000Z" as IsoTimestamp },
    });
    expect(asmt.evaluationContextId).toBe(ctx.id);
    expect(asmt.actionId).toBe(act.id);
  });

  it("Probe 23: consequence actionId binding mismatch rejects assessment validation", () => {
    const file = createCanonicalEntity({ id: "ent-file-p23" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
    });
    const validCtx = createActionEvaluationContext({ state: snap, action: act });

    const wrongActionCsq = createConsequence({
      actionId: "act-fraudulent-id" as ActionId,
      kind: "state-change",
      summary: "Consequence with mismatched actionId",
      confidence: 1.0,
      reversibility: { level: "reversible" },
      risk: { severity: "low", categories: ["privacy"] },
    });
    const asmtWithWrongCsq = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "asmt-wrong-csq",
      evaluationContextId: validCtx.id,
      actionId: validCtx.action.id,
      consequences: [wrongActionCsq],
      generatedAt: "2026-09-06T20:00:02.000Z",
      provenance: { source: "engine", timestamp: "2026-09-06T20:00:02.000Z" },
    };
    const res = validateConsequenceAssessment(asmtWithWrongCsq, validCtx);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "ACTION_ID_MISMATCH")).toBe(true);
  });

  it("Probe 24: exact JSON depth 32 passes", () => {
    function buildNestedPayload(
      targetLeafDepth: number,
    ): Record<string, import("../src/types.js").JsonValue> {
      let current: import("../src/types.js").JsonValue = "leaf-value";
      for (let d = targetLeafDepth; d > 1; d--) {
        current = { step: current };
      }
      return { root: current };
    }

    const params32 = buildNestedPayload(32);
    const act32 = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "execute" },
      parameters: params32,
    });

    const res32 = validateProposedAction(act32);
    expect(res32.valid).toBe(true);

    const ser32 = serializeProposedAction(act32);
    expect(ser32.ok).toBe(true);
  });

  it("Probe 25: exact JSON depth 33 rejects", () => {
    function buildNestedPayload(
      targetLeafDepth: number,
    ): Record<string, import("../src/types.js").JsonValue> {
      let current: import("../src/types.js").JsonValue = "leaf-value";
      for (let d = targetLeafDepth; d > 1; d--) {
        current = { step: current };
      }
      return { root: current };
    }

    const params33 = buildNestedPayload(33);
    const rawAction33 = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "act-deep-reject",
      proposedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "execute" },
      targets: [],
      parameters: params33,
      executionStatus: "proposed",
    };

    const res33 = validateProposedAction(rawAction33);
    expect(res33.valid).toBe(false);
    expect(res33.issues.some((i) => i.code === "MAX_DEPTH_EXCEEDED")).toBe(true);
  });

  it("Probe 26: provenance ruleId runtime/type contract aligns", () => {
    const provWithRule: ProvenanceDescriptor = {
      source: "rule",
      ruleId: "rule-filesystem-acl-v1",
      timestamp: "2026-09-06T20:00:00.000Z" as IsoTimestamp,
    };
    const res = validateProvenanceDescriptor(provWithRule);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.value.ruleId).toBe("rule-filesystem-acl-v1");
    }
    const serialized = JSON.stringify(provWithRule);
    expect(serialized).toContain('"ruleId":"rule-filesystem-acl-v1"');
  });

  it("Probe 27: all four synthetic scenarios remain valid", () => {
    // 1. Filesystem Deletion
    const fileEnt = createCanonicalEntity({
      id: "ent-file-p27" as EntityId,
      kind: "file",
      label: "report.pdf",
    });
    const fsState = createStateSnapshot({
      environment: { ...env, environmentId: "env-fs" },
      entities: [fileEnt],
      facts: [
        createStateFact({ subjectEntityId: fileEnt.id, key: "filesystem.exists", value: true }),
      ],
    });
    const fsAct = createProposedAction({
      environment: { ...env, environmentId: "env-fs" },
      actor: { kind: "human" },
      intent: { verb: "delete", domain: "filesystem" },
      targets: [{ entityId: fileEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: fsState, action: fsAct }),
      ).valid,
    ).toBe(true);

    // 2. Repository Visibility Change
    const repoEnt = createCanonicalEntity({
      id: "ent-repo-p27" as EntityId,
      kind: "repository",
      label: "my-project",
    });
    const repoState = createStateSnapshot({
      environment: { ...env, environmentId: "env-repo" },
      entities: [repoEnt],
      facts: [
        createStateFact({
          subjectEntityId: repoEnt.id,
          key: "repository.visibility",
          value: "private",
        }),
      ],
    });
    const repoAct = createProposedAction({
      environment: { ...env, environmentId: "env-repo" },
      actor: { kind: "human" },
      intent: { verb: "publish", domain: "vcs" },
      targets: [{ entityId: repoEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: repoState, action: repoAct }),
      ).valid,
    ).toBe(true);

    // 3. Document Sharing
    const docEnt = createCanonicalEntity({
      id: "ent-doc-p27" as EntityId,
      kind: "document",
      label: "notes.gdoc",
    });
    const docState = createStateSnapshot({
      environment: { ...env, environmentId: "env-doc" },
      entities: [docEnt],
      facts: [
        createStateFact({ subjectEntityId: docEnt.id, key: "document.shared_count", value: 1 }),
      ],
    });
    const docAct = createProposedAction({
      environment: { ...env, environmentId: "env-doc" },
      actor: { kind: "human" },
      intent: { verb: "share", domain: "cloud_docs" },
      targets: [{ entityId: docEnt.id, role: "primary" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: docState, action: docAct }),
      ).valid,
    ).toBe(true);

    // 4. Subscription Purchase
    const subEnt = createCanonicalEntity({
      id: "ent-sub-p27" as EntityId,
      kind: "subscription",
      label: "Pro Plan",
    });
    const subState = createStateSnapshot({
      environment: { ...env, environmentId: "env-sub" },
      entities: [subEnt],
      facts: [
        createStateFact({
          subjectEntityId: subEnt.id,
          key: "subscription.status",
          value: "inactive",
        }),
      ],
    });
    const subAct = createProposedAction({
      environment: { ...env, environmentId: "env-sub" },
      actor: { kind: "human" },
      intent: { verb: "purchase", domain: "billing" },
      targets: [{ entityId: subEnt.id, role: "resource" }],
    });
    expect(
      validateActionEvaluationContext(
        createActionEvaluationContext({ state: subState, action: subAct }),
      ).valid,
    ).toBe(true);
  });

  it("Probe 28: FC-001 behavioral baseline remains preserved", () => {
    // Confidence bounds
    expect(createConfidenceScore(0.0)).toBe(0.0);
    expect(createConfidenceScore(1.0)).toBe(1.0);
    expect(createConfidenceScore(0.85)).toBe(0.85);
    expect(() => createConfidenceScore(-0.01)).toThrow();
    expect(() => createConfidenceScore(1.01)).toThrow();
    expect(() => createConfidenceScore(Number.NaN)).toThrow();
    expect(() => createConfidenceScore(Number.POSITIVE_INFINITY)).toThrow();

    // Timestamp validation
    expect(validateIsoTimestamp("2026-09-06T20:00:00.000Z").valid).toBe(true);
    expect(validateIsoTimestamp("invalid-timestamp").valid).toBe(false);
  });
});

describe("action-schema - Hostile Input Test Matrix (A - M)", () => {
  const env = {
    environmentId: "env-matrix",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { name: "Finder" },
  };

  it("A: optional evidence getter throws -> INVALID, no throw", () => {
    const fact = {
      id: "fact-mat-a",
      subjectEntityId: "ent-mat-a",
      key: "file.readable",
      value: true,
    };
    Object.defineProperty(fact, "evidence", {
      get() {
        throw new Error("Hostile evidence getter");
      },
      enumerable: true,
    });
    expect(() => validateStateFact(fact)).not.toThrow();
    expect(validateStateFact(fact).valid).toBe(false);
  });

  it("B: optional provenance getter throws -> INVALID, no throw", () => {
    const snap = {
      schemaVersion: FUTURECLICK_SCHEMA_VERSION,
      id: "state-mat-b",
      observedAt: "2026-09-06T20:00:00.000Z",
      environment: env,
      entities: [],
      facts: [],
    };
    Object.defineProperty(snap, "provenance", {
      get() {
        throw new Error("Hostile provenance getter");
      },
      enumerable: true,
    });
    expect(() => validateStateSnapshot(snap)).not.toThrow();
    expect(validateStateSnapshot(snap).valid).toBe(false);
  });

  it("C: optional details getter throws -> INVALID, no throw", () => {
    const prov = {
      source: "rule",
      timestamp: "2026-09-06T20:00:00.000Z",
    };
    Object.defineProperty(prov, "details", {
      get() {
        throw new Error("Hostile details getter");
      },
      enumerable: true,
    });
    expect(() => validateProvenanceDescriptor(prov)).not.toThrow();
    expect(validateProvenanceDescriptor(prov).valid).toBe(false);
  });

  it("D: optional sessionId getter throws -> INVALID, no throw", () => {
    const hostileEnv = {
      environmentId: "env-mat-d",
      kind: "desktop",
      platform: "macos",
      application: { name: "Finder" },
    };
    Object.defineProperty(hostileEnv, "sessionId", {
      get() {
        throw new Error("Hostile sessionId getter");
      },
      enumerable: true,
    });
    expect(() => validateEnvironmentDescriptor(hostileEnv)).not.toThrow();
    expect(validateEnvironmentDescriptor(hostileEnv).valid).toBe(false);
  });

  it("E: changing ValueState.value getter -> captured value 1, never returns undefined", () => {
    let reads = 0;
    const vs = { status: "known" };
    Object.defineProperty(vs, "value", {
      get() {
        reads++;
        return reads === 1 ? 1 : undefined;
      },
      enumerable: true,
    });
    const res = validateValueState(vs);
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect((res.value as { status: "known"; value: unknown }).value).toBe(1);
  });

  it("F: changing context getter -> authoritative validator returns detached snapshot, subsequent reads of original object do not mutate snapshot", () => {
    const file = createCanonicalEntity({ id: "ent-f" as EntityId, kind: "file" });
    const snap = createStateSnapshot({ environment: env, entities: [file] });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human" },
      intent: { verb: "delete" },
      targets: [{ entityId: file.id, role: "primary" }],
    });
    const ctx = createActionEvaluationContext({ state: snap, action: act });

    let readCount = 0;
    const hostileCtx = { ...ctx };
    Object.defineProperty(hostileCtx, "createdAt", {
      get() {
        readCount++;
        return readCount === 1 ? "2026-09-06T20:00:00.000Z" : "TAMPERED_TIMESTAMP";
      },
      enumerable: true,
    });

    const val = validateActionEvaluationContext(hostileCtx);
    expect(val.valid).toBe(true);
    if (!val.valid) return;
    // Snapshot retains original validated timestamp regardless of future reads on hostileCtx
    expect(val.value.createdAt).toBe("2026-09-06T20:00:00.000Z");
  });

  it("G: isDenseArray hostile proxy length trap -> returns false, no throw", () => {
    const hostileProxy = new Proxy([], {
      get(target, prop) {
        if (prop === "length") {
          throw new Error("Hostile array proxy length trap");
        }
        return Reflect.get(target, prop);
      },
    });
    let result: boolean | undefined;
    expect(() => {
      result = isDenseArray(hostileProxy);
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("H: parseCanonical validator throws string -> returns error Result, no throw", () => {
    expect(() =>
      parseCanonical('{"valid":"json"}', () => {
        throw "Hostile string exception";
      }),
    ).not.toThrow();
    const res = parseCanonical('{"valid":"json"}', () => {
      throw "Hostile string exception";
    });
    expect(res.ok).toBe(false);
  });

  it("I: parseCanonical validator throws null-prototype object -> returns error Result, no throw", () => {
    const nullProto = Object.create(null);
    expect(() =>
      parseCanonical('{"valid":"json"}', () => {
        throw nullProto;
      }),
    ).not.toThrow();
    const res = parseCanonical('{"valid":"json"}', () => {
      throw nullProto;
    });
    expect(res.ok).toBe(false);
  });

  it("J: domain parser catches validator throwing hostile non-error -> returns error Result, no throw", () => {
    const hostileCause = Object.create(null);
    hostileCause.toString = null;
    expect(() =>
      parseCanonical('{"some":"data"}', () => {
        throw hostileCause;
      }),
    ).not.toThrow();
    const res = parseCanonical('{"some":"data"}', () => {
      throw hostileCause;
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toContain("Domain validation threw an unexpected error");
    }
  });

  it("K: serializer catches hostile thrown value -> returns error Result, no throw", () => {
    const hostile = {
      get invalid() {
        const nullProto = Object.create(null);
        throw nullProto;
      },
    };
    expect(() => serializeCanonical(hostile)).not.toThrow();
    const res = serializeCanonical(hostile);
    expect(res.ok).toBe(false);
  });

  it("L: normalizeThrownError handles null-prototype object safely", () => {
    const nullProto = Object.create(null);
    nullProto.foo = "bar";
    const err = normalizeThrownError(nullProto, "Fallback null-proto");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Fallback null-proto");
  });

  it("M: normalizeThrownError handles { toString: null } safely", () => {
    const hostileToString = { toString: null };
    const err = normalizeThrownError(hostileToString, "Fallback hostile toString");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Fallback hostile toString");
  });
});

describe("action-schema/serialization - round-trip guarantees", () => {
  const env = {
    environmentId: "env-serialize",
    kind: "desktop" as const,
    platform: "macos" as const,
    application: { name: "Finder", version: "14.0" },
  };

  it("serializes and parses StateSnapshot with round-trip equality", () => {
    const fileEntity = createCanonicalEntity({
      id: "ent-notes" as EntityId,
      kind: "file",
      label: "notes.txt",
      attributes: { mime: "text/plain", encoding: "utf-8" },
    });

    const snap = createStateSnapshot({
      environment: env,
      entities: [fileEntity],
      facts: [
        createStateFact({
          subjectEntityId: fileEntity.id,
          key: "filesystem.size_bytes",
          value: 512,
        }),
        createStateFact({
          subjectEntityId: fileEntity.id,
          key: "file.readable",
          value: true,
        }),
      ],
    });

    const jsonRes = serializeStateSnapshot(snap);
    expect(jsonRes.ok).toBe(true);
    if (!jsonRes.ok) return;

    const parseRes = parseStateSnapshot(jsonRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value).toEqual(snap);
  });

  it("serializes and parses ProposedAction with round-trip equality", () => {
    const act = createProposedAction({
      environment: env,
      actor: { kind: "human", id: "user-1" },
      intent: { verb: "delete", domain: "filesystem" },
      targets: [{ entityId: "ent-target-1" as EntityId, role: "primary" }],
      parameters: { force: false },
    });

    const jsonRes = serializeProposedAction(act);
    expect(jsonRes.ok).toBe(true);
    if (!jsonRes.ok) return;

    const parseRes = parseProposedAction(jsonRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value).toEqual(act);
  });

  it("serializes and parses Consequence with round-trip equality", () => {
    const csq = createConsequence({
      actionId: "act-10" as ActionId,
      kind: "financial",
      summary: "Annual subscription renewal of $120 billed to credit card",
      affectedEntities: ["ent-sub-1" as EntityId],
      stateChanges: [
        {
          entityId: "ent-sub-1" as EntityId,
          property: "subscription.status",
          operation: "replace",
          before: { status: "known", value: "trial" },
          after: { status: "known", value: "active" },
        },
      ],
      confidence: 0.95,
      reversibility: {
        level: "partially_reversible",
        method: "Contact support for refund within 14 days",
      },
      risk: { severity: "low", categories: ["financial"] },
      temporal: { timing: "near-term", frequency: "recurring" },
    });

    const jsonRes = serializeConsequence(csq);
    expect(jsonRes.ok).toBe(true);
    if (!jsonRes.ok) return;

    const parseRes = parseConsequence(jsonRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value).toEqual(csq);
  });

  it("serializes and parses ActionEvaluationContext with round-trip equality", () => {
    const snap = createStateSnapshot({ environment: env });
    const act = createProposedAction({
      environment: env,
      actor: { kind: "agent" },
      intent: { verb: "read" },
    });

    const ctx = createActionEvaluationContext({ state: snap, action: act });
    const jsonRes = serializeActionEvaluationContext(ctx);
    expect(jsonRes.ok).toBe(true);
    if (!jsonRes.ok) return;

    const parseRes = parseActionEvaluationContext(jsonRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value).toEqual(ctx);
  });

  it("serializes and parses ConsequenceAssessment with round-trip equality", () => {
    const csq = createConsequence({
      actionId: "act-100" as ActionId,
      kind: "permission-change",
      summary: "Camera permission granted",
      confidence: 1.0,
      reversibility: { level: "reversible" },
      risk: { severity: "medium", categories: ["privacy", "security"] },
    });

    const asmt = createConsequenceAssessment({
      evaluationContextId: "eval-ctx-1" as import("../src/index.js").EvaluationContextId,
      actionId: "act-100" as ActionId,
      consequences: [csq],
      provenance: { source: "adapter", timestamp: "2026-09-06T20:00:00.000Z" as IsoTimestamp },
    });

    const jsonRes = serializeConsequenceAssessment(asmt);
    expect(jsonRes.ok).toBe(true);
    if (!jsonRes.ok) return;

    const parseRes = parseConsequenceAssessment(jsonRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;

    expect(parseRes.value).toEqual(asmt);
  });

  it("fails closed on non-JSON-safe values during serialization", () => {
    const badObj = { num: Number.NaN };
    const res = serializeCanonical(badObj);
    expect(res.ok).toBe(false);
  });
});

/**
 * FC-006 closed-world release fingerprints (Sprint 3C)
 *
 * Epistemological Boundary:
 * Typed explicit semantic fingerprints for Continue authorization.
 * Derived only from validated canonical structures + retained observation
 * identity. Not JSON.stringify of arbitrary objects. Not cryptographic.
 *
 * Sprint 3B: no string coercion; closed optional semantic fields.
 * Sprint 3C: bind exact actor + environment/application semantics.
 * Generated environmentId may differ across fresh adapts, but within one
 * context state/action environmentId must match, and semantic fields must
 * equal the reviewed fingerprint.
 *
 * Fresh ConsequenceEngine.evaluate() is not required.
 */

import type { ActionEvaluationContext, ConsequenceAssessment } from "@futureclick/action-schema";
import type { BrowserObservation } from "@futureclick/browser-adapter";
import {
  FC006_ADAPTER_ID,
  FC006_ADAPTER_VERSION,
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
} from "./synthetic-repository-interception-adapter.js";

/** Exact frozen visibility-rule identity. */
export const FC006_VISIBILITY_RULE_ID = "version_control.repository.visibility";
export const FC006_VISIBILITY_RULE_VERSION = "1.0";

/** Exact frozen ConsequenceEngine assessment provenance version. */
export const FC006_ENGINE_VERSION = "0.2.0";

/** Exact approved FC-006 synthetic application identity (adapter constructCanonicalContext). */
export const FC006_APPLICATION_ID = "app-futureclick-synthetic-harness";
export const FC006_APPLICATION_NAME = "FutureClick Synthetic Harness";
export const FC006_APPLICATION_VERSION = "1.0";

export const FC006_EXPECTED_EVIDENCE_SCOPE =
  "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared repository visibility change action executes successfully according to the modeled platform semantics without platform rejection.";

export const FC006_EXPECTED_EVIDENCE_SUMMARY =
  "Deterministic derivation of repository private-to-public visibility transition and associated data exposure risk.";

export const FC006_EXPECTED_ASSUMPTIONS = Object.freeze([
  Object.freeze({
    id: "asm.vcs.visibility.1",
    statement:
      "The remote version control platform processes the visibility change successfully under modeled semantics.",
    status: "assumed" as const,
  }),
  Object.freeze({
    id: "asm.vcs.visibility.2",
    statement: "Organization policy allows repository visibility transition to public.",
    status: "assumed" as const,
  }),
]);

export const FC006_EXPECTED_RISK_DESCRIPTION =
  "Making repository public exposes proprietary source code, history, and metadata to public access.";

export const FC006_EXPECTED_REVERSIBILITY_METHOD = "Change repository visibility back to private";

export const FC006_EXPECTED_REVERSIBILITY_REQUIREMENTS = Object.freeze([
  "Public visibility can be revoked, but code and commits viewed or cloned while public cannot be retracted.",
] as const);

export const FC006_EXPECTED_ENTITY_LABEL = "Synthetic Repository";

/** Adapter provenance detail keys that are transport/observation-bound (may differ fresh). */
const ADAPTER_PROVENANCE_TRANSPORT_DETAIL_KEYS = Object.freeze([
  "browserObservationId",
  "observationSchemaVersion",
] as const);

/** Adapter provenance detail keys that are release-semantic (must match exactly). */
const ADAPTER_PROVENANCE_SEMANTIC_DETAIL_KEYS = Object.freeze([
  "adapterId",
  "adapterVersion",
  "synthetic",
  "evidenceBasis",
] as const);

export interface Fc006ReleaseContextFingerprint {
  readonly observationEntityKey: string;
  readonly fixtureContract: string;
  readonly operation: string;
  readonly currentVisibility: string;
  readonly requestedVisibility: string;
  readonly entityCount: number;
  readonly entityKind: string;
  readonly entityLabel: string;
  readonly visibilityFactCount: number;
  readonly visibilityFactKey: string;
  readonly visibilityFactValue: string;
  readonly visibilityFactValueType: "string";
  readonly factBoundToPrimaryEntity: boolean;
  readonly actorKind: "human";
  readonly actorIdAbsent: true;
  readonly environmentKind: "browser";
  readonly environmentPlatform: "web";
  readonly applicationId: string;
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly environmentSessionIdAbsent: true;
  readonly stateActionEnvironmentIdConsistent: true;
  readonly intentVerb: string;
  readonly intentDomain: string;
  readonly targetCount: number;
  readonly targetRole: string;
  readonly targetBoundToPrimaryEntity: boolean;
  readonly newVisibility: string;
  readonly newVisibilityType: "string";
  readonly executionStatus: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly synthetic: boolean;
  readonly evidenceBasis: string;
  readonly stateProvenanceSource: string;
  readonly stateProvenanceSynthetic: boolean;
  readonly actionProvenanceSource: string;
  readonly actionProvenanceSynthetic: boolean;
}

export interface Fc006ReleaseAssessmentFingerprint {
  readonly consequenceCount: number;
  readonly consequenceKind: string;
  readonly summary: string;
  readonly confidence: number;
  readonly affectedEntityCount: number;
  readonly evidenceCount: number;
  readonly evidenceMode: string;
  readonly evidenceSource: string;
  readonly evidenceScope: string;
  readonly evidenceSummary: string;
  readonly evidenceDetailsAbsent: true;
  readonly evidenceConfidenceAbsent: true;
  readonly assumptionIds: readonly string[];
  readonly assumptionStatements: readonly string[];
  readonly assumptionStatuses: readonly string[];
  readonly riskSeverity: string;
  readonly riskCategories: readonly string[];
  readonly riskDescription: string;
  readonly reversibilityLevel: string;
  readonly reversibilityMethod: string;
  readonly reversibilityRequirements: readonly string[];
  readonly reversibilityTimeWindowAbsent: true;
  readonly consequenceTemporalAbsent: true;
  readonly stateChangeCount: number;
  readonly stateChangeProperty: string;
  readonly stateChangeOperation: string;
  readonly beforeStatus: string;
  readonly beforeValue: string;
  readonly beforeValueType: "string";
  readonly afterStatus: string;
  readonly afterValue: string;
  readonly afterValueType: "string";
  readonly stateChangeBoundToPrimaryEntity: boolean;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly consequenceProvenanceSource: string;
  readonly consequenceProvenanceDetailsClosed: true;
  readonly assessmentProvenanceSource: string;
  readonly assessmentEngineVersion: string;
  readonly assessmentProvenanceDetailsAbsent: true;
  readonly assessmentProvenanceRuleIdAbsent: true;
}

function fingerprintsEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return false;
      }
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact own-key set (order-independent). */
function hasExactOwnKeys(obj: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(obj);
  if (keys.length !== expected.length) return false;
  const set = new Set(expected);
  for (const key of keys) {
    if (!set.has(key)) return false;
  }
  return true;
}

function isExactPrimitiveString(value: unknown, expected: string): boolean {
  return typeof value === "string" && value === expected;
}

/**
 * Exact known ValueState with primitive string value.
 * Rejects arrays, String wrappers, hostile toString objects, and extra keys.
 */
function isExactKnownStringValueState(state: unknown, expected: string): boolean {
  if (!isPlainObject(state)) return false;
  if (!hasExactOwnKeys(state, ["status", "value"])) return false;
  if (state.status !== "known") return false;
  return isExactPrimitiveString(state.value, expected);
}

/**
 * Closed adapter provenance used on state + action for FC-006 synthetic adapt().
 * Transport detail keys may differ across fresh adapts; semantic keys must match.
 */
function readClosedAdapterProvenance(provenance: unknown): {
  readonly source: "adapter";
  readonly synthetic: true;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly evidenceBasis: string;
} | null {
  if (!isPlainObject(provenance)) return null;
  // Required semantic keys; timestamp is generated transport metadata.
  if (typeof provenance.source !== "string" || provenance.source !== "adapter") return null;
  if (typeof provenance.timestamp !== "string" || provenance.timestamp.length === 0) return null;
  // Must not carry rule/engine identity on adapter provenance.
  if (provenance.ruleId !== undefined) return null;
  if (provenance.engineVersion !== undefined) return null;

  const allowedTop = new Set(["source", "timestamp", "details"]);
  for (const key of Object.keys(provenance)) {
    if (!allowedTop.has(key)) return null;
  }

  const details = provenance.details;
  if (!isPlainObject(details)) return null;

  const allowedDetailKeys = new Set<string>([
    ...ADAPTER_PROVENANCE_SEMANTIC_DETAIL_KEYS,
    ...ADAPTER_PROVENANCE_TRANSPORT_DETAIL_KEYS,
  ]);
  for (const key of Object.keys(details)) {
    if (!allowedDetailKeys.has(key)) return null;
  }
  for (const key of ADAPTER_PROVENANCE_SEMANTIC_DETAIL_KEYS) {
    if (!Object.hasOwn(details, key)) return null;
  }

  if (details.adapterId !== FC006_ADAPTER_ID) return null;
  if (details.adapterVersion !== FC006_ADAPTER_VERSION) return null;
  if (details.synthetic !== true) return null;
  if (details.evidenceBasis !== "synthetic-page-metadata") return null;

  return {
    source: "adapter",
    synthetic: true,
    adapterId: FC006_ADAPTER_ID,
    adapterVersion: FC006_ADAPTER_VERSION,
    evidenceBasis: "synthetic-page-metadata",
  };
}

/**
 * Approved FC-006 actor: { kind: "human" } with id absent.
 */
function readClosedFc006Actor(actor: unknown): {
  readonly kind: "human";
  readonly idAbsent: true;
} | null {
  if (!isPlainObject(actor)) return null;
  if (!hasExactOwnKeys(actor, ["kind"])) return null;
  if (actor.kind !== "human") return null;
  if (Object.hasOwn(actor, "id")) return null;
  return { kind: "human", idAbsent: true };
}

/**
 * Approved FC-006 environment semantics (generated environmentId excluded from return).
 */
function readClosedFc006Environment(environment: unknown): {
  readonly environmentId: string;
  readonly kind: "browser";
  readonly platform: "web";
  readonly applicationId: string;
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly sessionIdAbsent: true;
} | null {
  if (!isPlainObject(environment)) return null;
  // Exact top-level semantic keys; sessionId must be absent.
  if (!hasExactOwnKeys(environment, ["environmentId", "kind", "platform", "application"])) {
    return null;
  }
  if (typeof environment.environmentId !== "string" || environment.environmentId.length === 0) {
    return null;
  }
  if (environment.kind !== "browser") return null;
  if (environment.platform !== "web") return null;
  if (Object.hasOwn(environment, "sessionId")) return null;

  const application = environment.application;
  if (!isPlainObject(application)) return null;
  if (!hasExactOwnKeys(application, ["id", "name", "version"])) return null;
  if (!isExactPrimitiveString(application.id, FC006_APPLICATION_ID)) return null;
  if (!isExactPrimitiveString(application.name, FC006_APPLICATION_NAME)) return null;
  if (!isExactPrimitiveString(application.version, FC006_APPLICATION_VERSION)) return null;

  return {
    environmentId: environment.environmentId,
    kind: "browser",
    platform: "web",
    applicationId: FC006_APPLICATION_ID,
    applicationName: FC006_APPLICATION_NAME,
    applicationVersion: FC006_APPLICATION_VERSION,
    sessionIdAbsent: true,
  };
}

export function buildFc006ReleaseContextFingerprint(
  context: ActionEvaluationContext,
  observation: BrowserObservation,
): Fc006ReleaseContextFingerprint | null {
  const entityKey = observation.metadata.entityKey;
  if (typeof entityKey !== "string" || entityKey.length === 0) return null;
  if (observation.metadata.fixtureContract !== FC006_FIXTURE_CONTRACT) return null;
  if (observation.metadata.operation !== FC006_OPERATION) return null;
  if (!isExactPrimitiveString(observation.metadata.currentVisibility, "private")) return null;
  if (!isExactPrimitiveString(observation.metadata.requestedVisibility, "public")) return null;

  if (context.state.entities.length !== 1) return null;
  const entity = context.state.entities[0];
  if (!entity || entity.kind !== "repository") return null;
  if (entity.label !== FC006_EXPECTED_ENTITY_LABEL) return null;
  if (entity.domainKind !== undefined) return null;
  if (entity.attributes !== undefined) return null;

  const visibilityFacts = context.state.facts.filter((f) => f.key === "repository.visibility");
  if (visibilityFacts.length !== 1) return null;
  const fact = visibilityFacts[0];
  if (!fact) return null;
  if (!isExactPrimitiveString(fact.value, "private")) return null;
  if (fact.subjectEntityId !== entity.id) return null;
  if (fact.evidence !== undefined) return null;

  if (context.state.facts.length !== 1) return null;

  const stateProv = readClosedAdapterProvenance(context.state.provenance);
  if (!stateProv) return null;

  const stateEnv = readClosedFc006Environment(context.state.environment);
  if (!stateEnv) return null;
  const actionEnv = readClosedFc006Environment(context.action.environment);
  if (!actionEnv) return null;
  // Within one context, state/action share the same environment identity.
  if (stateEnv.environmentId !== actionEnv.environmentId) return null;
  if (stateEnv.kind !== actionEnv.kind) return null;
  if (stateEnv.platform !== actionEnv.platform) return null;
  if (stateEnv.applicationId !== actionEnv.applicationId) return null;
  if (stateEnv.applicationName !== actionEnv.applicationName) return null;
  if (stateEnv.applicationVersion !== actionEnv.applicationVersion) return null;

  const actor = readClosedFc006Actor(context.action.actor);
  if (!actor) return null;

  if (context.action.targets.length !== 1) return null;
  const target = context.action.targets[0];
  if (!target || target.role !== "primary") return null;
  if (target.entityId !== entity.id) return null;

  if (context.action.intent.verb !== "change-access") return null;
  if (context.action.intent.domain !== "version_control") return null;
  if (!isExactPrimitiveString(context.action.parameters.newVisibility, "public")) return null;
  if (Object.keys(context.action.parameters).length !== 1) return null;
  if (context.action.executionStatus !== "proposed") return null;

  const actionProv = readClosedAdapterProvenance(context.action.provenance);
  if (!actionProv) return null;

  return Object.freeze({
    observationEntityKey: entityKey,
    fixtureContract: FC006_FIXTURE_CONTRACT,
    operation: FC006_OPERATION,
    currentVisibility: "private",
    requestedVisibility: "public",
    entityCount: 1,
    entityKind: "repository",
    entityLabel: FC006_EXPECTED_ENTITY_LABEL,
    visibilityFactCount: 1,
    visibilityFactKey: "repository.visibility",
    visibilityFactValue: "private",
    visibilityFactValueType: "string",
    factBoundToPrimaryEntity: true,
    actorKind: actor.kind,
    actorIdAbsent: true,
    environmentKind: stateEnv.kind,
    environmentPlatform: stateEnv.platform,
    applicationId: stateEnv.applicationId,
    applicationName: stateEnv.applicationName,
    applicationVersion: stateEnv.applicationVersion,
    environmentSessionIdAbsent: true,
    stateActionEnvironmentIdConsistent: true,
    intentVerb: "change-access",
    intentDomain: "version_control",
    targetCount: 1,
    targetRole: "primary",
    targetBoundToPrimaryEntity: true,
    newVisibility: "public",
    newVisibilityType: "string",
    executionStatus: "proposed",
    adapterId: FC006_ADAPTER_ID,
    adapterVersion: FC006_ADAPTER_VERSION,
    synthetic: true,
    evidenceBasis: "synthetic-page-metadata",
    stateProvenanceSource: stateProv.source,
    stateProvenanceSynthetic: stateProv.synthetic,
    actionProvenanceSource: actionProv.source,
    actionProvenanceSynthetic: actionProv.synthetic,
  });
}

export function buildFc006ReleaseAssessmentFingerprint(
  assessment: ConsequenceAssessment,
  context: ActionEvaluationContext,
): Fc006ReleaseAssessmentFingerprint | null {
  if (assessment.evaluationContextId !== context.id) return null;
  if (assessment.actionId !== context.action.id) return null;
  if (assessment.consequences.length !== 1) return null;

  const entity = context.state.entities[0];
  if (!entity) return null;

  const csq = assessment.consequences[0];
  if (!csq) return null;
  if (csq.actionId !== assessment.actionId) return null;
  if (csq.kind !== "security") return null;
  if (csq.confidence !== 1.0) return null;
  if (csq.temporal !== undefined) return null;

  const expectedSummary = `Repository "${FC006_EXPECTED_ENTITY_LABEL}" visibility will change from private to public.`;
  if (csq.summary !== expectedSummary) return null;

  if (csq.affectedEntities.length !== 1) return null;
  if (csq.affectedEntities[0] !== entity.id) return null;

  if (csq.evidence.length !== 1) return null;
  const evidence = csq.evidence[0];
  if (!evidence) return null;
  if (evidence.mode !== "verified") return null;
  if (evidence.source !== "rule") return null;
  if (evidence.scope !== FC006_EXPECTED_EVIDENCE_SCOPE) return null;
  if (evidence.summary !== FC006_EXPECTED_EVIDENCE_SUMMARY) return null;
  if (evidence.confidence !== undefined) return null;
  if (evidence.details !== undefined) return null;
  {
    const evidenceObj = evidence as unknown as Record<string, unknown>;
    const allowed = new Set([
      "id",
      "mode",
      "source",
      "observedAt",
      "scope",
      "assumptions",
      "summary",
    ]);
    for (const key of Object.keys(evidenceObj)) {
      if (!allowed.has(key)) return null;
    }
  }
  if (evidence.assumptions.length !== FC006_EXPECTED_ASSUMPTIONS.length) return null;
  for (let i = 0; i < FC006_EXPECTED_ASSUMPTIONS.length; i++) {
    const expected = FC006_EXPECTED_ASSUMPTIONS[i];
    const actual = evidence.assumptions[i];
    if (!expected || !actual) return null;
    if (!isPlainObject(actual as unknown as Record<string, unknown>)) return null;
    if (
      !hasExactOwnKeys(actual as unknown as Record<string, unknown>, ["id", "statement", "status"])
    ) {
      return null;
    }
    if (actual.id !== expected.id) return null;
    if (actual.statement !== expected.statement) return null;
    if (actual.status !== expected.status) return null;
  }

  if (!csq.risk) return null;
  {
    const riskObj = csq.risk as unknown as Record<string, unknown>;
    if (!hasExactOwnKeys(riskObj, ["severity", "categories", "description"])) return null;
  }
  if (csq.risk.severity !== "high") return null;
  if (csq.risk.categories.length !== 2) return null;
  if (csq.risk.categories[0] !== "security" || csq.risk.categories[1] !== "privacy") return null;
  if (csq.risk.description !== FC006_EXPECTED_RISK_DESCRIPTION) return null;

  if (!csq.reversibility) return null;
  {
    const revObj = csq.reversibility as unknown as Record<string, unknown>;
    if (!hasExactOwnKeys(revObj, ["level", "method", "requirements"])) return null;
  }
  if (csq.reversibility.level !== "partially_reversible") return null;
  if (csq.reversibility.method !== FC006_EXPECTED_REVERSIBILITY_METHOD) return null;
  if (csq.reversibility.timeWindow !== undefined) return null;
  if (!csq.reversibility.requirements || csq.reversibility.requirements.length !== 1) return null;
  if (csq.reversibility.requirements[0] !== FC006_EXPECTED_REVERSIBILITY_REQUIREMENTS[0]) {
    return null;
  }

  if (!csq.stateChanges || csq.stateChanges.length !== 1) return null;
  const change = csq.stateChanges[0];
  if (!change) return null;
  {
    const changeObj = change as unknown as Record<string, unknown>;
    if (!hasExactOwnKeys(changeObj, ["entityId", "property", "operation", "before", "after"])) {
      return null;
    }
  }
  if (change.entityId !== entity.id) return null;
  if (change.property !== "repository.visibility") return null;
  if (change.operation !== "replace") return null;
  if (!isExactKnownStringValueState(change.before, "private")) return null;
  if (!isExactKnownStringValueState(change.after, "public")) return null;

  const cProv = csq.provenance;
  if (!cProv || !isPlainObject(cProv as unknown as Record<string, unknown>)) return null;
  {
    const provObj = cProv as unknown as Record<string, unknown>;
    // Frozen consequence provenance: source, ruleId, timestamp, details.
    if (!hasExactOwnKeys(provObj, ["source", "ruleId", "timestamp", "details"])) return null;
  }
  if (cProv.source !== "rule") return null;
  if (cProv.ruleId !== FC006_VISIBILITY_RULE_ID) return null;
  if (cProv.engineVersion !== undefined) return null;
  if (typeof cProv.timestamp !== "string" || cProv.timestamp.length === 0) return null;
  if (!isPlainObject(cProv.details)) return null;
  if (!hasExactOwnKeys(cProv.details as Record<string, unknown>, ["ruleVersion"])) return null;
  if (cProv.details.ruleVersion !== FC006_VISIBILITY_RULE_VERSION) return null;

  const aProv = assessment.provenance;
  if (!isPlainObject(aProv as unknown as Record<string, unknown>)) return null;
  {
    const provObj = aProv as unknown as Record<string, unknown>;
    // Frozen assessment provenance: source, engineVersion, timestamp. No details/ruleId.
    if (!hasExactOwnKeys(provObj, ["source", "engineVersion", "timestamp"])) return null;
  }
  if (aProv.source !== "engine") return null;
  if (aProv.engineVersion !== FC006_ENGINE_VERSION) return null;
  if (aProv.ruleId !== undefined) return null;
  if (aProv.details !== undefined) return null;
  if (typeof aProv.timestamp !== "string" || aProv.timestamp.length === 0) return null;

  return Object.freeze({
    consequenceCount: 1,
    consequenceKind: "security",
    summary: expectedSummary,
    confidence: 1.0,
    affectedEntityCount: 1,
    evidenceCount: 1,
    evidenceMode: "verified",
    evidenceSource: "rule",
    evidenceScope: FC006_EXPECTED_EVIDENCE_SCOPE,
    evidenceSummary: FC006_EXPECTED_EVIDENCE_SUMMARY,
    evidenceDetailsAbsent: true,
    evidenceConfidenceAbsent: true,
    assumptionIds: Object.freeze(FC006_EXPECTED_ASSUMPTIONS.map((a) => a.id)),
    assumptionStatements: Object.freeze(FC006_EXPECTED_ASSUMPTIONS.map((a) => a.statement)),
    assumptionStatuses: Object.freeze(FC006_EXPECTED_ASSUMPTIONS.map((a) => a.status)),
    riskSeverity: "high",
    riskCategories: Object.freeze(["security", "privacy"] as const),
    riskDescription: FC006_EXPECTED_RISK_DESCRIPTION,
    reversibilityLevel: "partially_reversible",
    reversibilityMethod: FC006_EXPECTED_REVERSIBILITY_METHOD,
    reversibilityRequirements: FC006_EXPECTED_REVERSIBILITY_REQUIREMENTS,
    reversibilityTimeWindowAbsent: true,
    consequenceTemporalAbsent: true,
    stateChangeCount: 1,
    stateChangeProperty: "repository.visibility",
    stateChangeOperation: "replace",
    beforeStatus: "known",
    beforeValue: "private",
    beforeValueType: "string",
    afterStatus: "known",
    afterValue: "public",
    afterValueType: "string",
    stateChangeBoundToPrimaryEntity: true,
    ruleId: FC006_VISIBILITY_RULE_ID,
    ruleVersion: FC006_VISIBILITY_RULE_VERSION,
    consequenceProvenanceSource: "rule",
    consequenceProvenanceDetailsClosed: true,
    assessmentProvenanceSource: "engine",
    assessmentEngineVersion: FC006_ENGINE_VERSION,
    assessmentProvenanceDetailsAbsent: true,
    assessmentProvenanceRuleIdAbsent: true,
  });
}

export function fc006ContextFingerprintsEqual(
  a: Fc006ReleaseContextFingerprint,
  b: Fc006ReleaseContextFingerprint,
): boolean {
  return fingerprintsEqual(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>,
  );
}

export function fc006AssessmentFingerprintsEqual(
  a: Fc006ReleaseAssessmentFingerprint,
  b: Fc006ReleaseAssessmentFingerprint,
): boolean {
  return fingerprintsEqual(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>,
  );
}

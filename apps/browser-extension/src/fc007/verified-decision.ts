/**
 * FC-007 Sprint 3A — immutable VerifiedDecision authority (review only).
 *
 * Authority record is fully frozen. Eligibility/lifecycle lives on the controller.
 * NO release / arm / executor capability.
 */

import type {
  ActionEvaluationContext,
  Assumption,
  Consequence,
  ConsequenceAssessment,
  EvidenceMode,
  EvidenceRecord,
  ProposedAction,
  StateChange,
  StateFact,
  StateSnapshot,
  ValueState,
} from "@futureclick/action-schema";
import {
  encodeNumber,
  encodeOptionalNumber,
  encodeOptionalString,
  encodePrimitiveValue,
  encodeSeq,
  encodeString,
  type TypedFpError,
} from "./decision-fingerprint.js";
import {
  fingerprintEffectsSemantics,
  projectEffectsSemantics,
  type Fc007EffectsSnapshot,
} from "./effects-semantics.js";
import {
  FC007_V2_ADAPTER_ID,
  FC007_V2_ADAPTER_VERSION,
  FC007_V2_CONTRACT_ID,
  FC007_V2_CONTRACT_VERSION,
  type GitHubVisibilityObservationV2,
} from "./v2/github-observation-v2.js";

/** Strict singleton shape for FC-007 V2 visibility action. */
export const DECISION_MAX_ENTITIES = 1;
export const DECISION_MAX_FACTS = 1;
export const DECISION_MAX_TARGETS = 1;
export const DECISION_MAX_CONSEQUENCES = 4;
export const DECISION_MAX_EVIDENCE = 8;
export const DECISION_MAX_ASSUMPTIONS = 8;
export const DECISION_MAX_AFFECTED = 4;
export const DECISION_MAX_STATE_CHANGES = 4;
export const DECISION_MAX_RISK_CATEGORIES = 8;
export const DECISION_MAX_REV_REQUIREMENTS = 8;
export const DECISION_MAX_STRING = 2_048;

const EVIDENCE_MODES = new Set(["verified", "simulated", "predicted"]);
const STATE_CHANGE_OPS = new Set(["add", "remove", "replace", "unknown"]);
const VALUE_STATE_STATUSES = new Set(["known", "absent", "unknown"]);
const RISK_SEVERITIES = new Set(["none", "low", "medium", "high", "critical", "unknown"]);
const RISK_CATEGORIES = new Set([
  "privacy",
  "security",
  "financial",
  "data-loss",
  "availability",
  "reputation",
  "other",
]);
const REVERSIBILITY_LEVELS = new Set([
  "reversible",
  "partially_reversible",
  "irreversible",
  "unknown",
]);
const TEMPORAL_TIMINGS = new Set(["immediate", "near-term", "long-term", "unknown"]);
const TEMPORAL_FREQUENCIES = new Set(["once", "recurring", "continuous", "unknown"]);
const CONSEQUENCE_KINDS = new Set([
  "state-change",
  "data-loss",
  "data-exposure",
  "permission-change",
  "financial",
  "communication",
  "execution",
  "availability",
  "security",
  "privacy",
  "dependency-impact",
  "unknown",
]);
const ASSUMPTION_STATUSES = new Set(["assumed", "verified", "violated", "unknown"]);
const PROVENANCE_SOURCES = new Set([
  "adapter",
  "rule",
  "simulation",
  "model",
  "user",
  "system",
  "external-service",
  "engine",
  "unknown",
]);

/** Owned plain-data projection of reviewed canonical context (no page getters). */
export interface Fc007CanonicalContextSnapshot {
  readonly actorKind: "human";
  readonly environmentKind: "browser";
  readonly environmentPlatform: "web";
  readonly applicationId: string;
  readonly applicationName: string;
  readonly intentVerb: string;
  readonly intentDomain: string;
  readonly executionStatus: "proposed";
  readonly entityKind: "repository";
  readonly entityLabel: string;
  /** Creation-time lineage only — not part of Continue semantic fingerprint. */
  readonly entityId: string;
  readonly visibilityFactKey: "repository.visibility";
  readonly visibilityFactValue: "private";
  readonly visibilityFactSubjectEntityId: string;
  readonly requestedVisibility: "public";
  readonly primaryTargetRole: "primary";
  readonly primaryTargetEntityId: string;
}

export interface Fc007AssumptionSnapshot {
  readonly id: string;
  readonly statement: string;
  readonly status: string;
}

export interface Fc007EvidenceSnapshot {
  readonly mode: EvidenceMode;
  readonly source: string;
  readonly scope: string;
  readonly summary: string;
  /** Optional evidence confidence; absence encoded distinctly from presence. */
  readonly confidence: number | undefined;
  readonly assumptions: readonly Fc007AssumptionSnapshot[];
}

/** Type-preserving known/absent/unknown state projection. */
export type Fc007ValueStateSnapshot =
  | { readonly status: "known"; readonly value: string | number | boolean | null }
  | { readonly status: "absent" }
  | { readonly status: "unknown" };

export interface Fc007StateChangeSnapshot {
  readonly entityId: string;
  readonly property: string;
  readonly operation: string;
  readonly before: Fc007ValueStateSnapshot;
  readonly after: Fc007ValueStateSnapshot;
}

export interface Fc007ConsequenceSnapshot {
  readonly kind: string;
  readonly summary: string;
  readonly actionId: string;
  readonly affectedEntityIds: readonly string[];
  readonly stateChanges: readonly Fc007StateChangeSnapshot[];
  readonly evidence: readonly Fc007EvidenceSnapshot[];
  readonly confidence: number;
  readonly riskSeverity: string;
  readonly riskCategories: readonly string[];
  readonly riskDescription: string | undefined;
  readonly reversibilityLevel: string;
  readonly reversibilityMethod: string | undefined;
  readonly reversibilityTimeWindow: string | undefined;
  readonly reversibilityRequirements: readonly string[];
  readonly provenanceSource: string | undefined;
  readonly provenanceRuleId: string | undefined;
  readonly provenanceRuleVersion: string | undefined;
  /** Optional temporal; absence encoded distinctly from presence. */
  readonly temporalTiming: string | undefined;
  readonly temporalFrequency: string | undefined;
}

/** Owned plain-data projection of reviewed assessment semantics. */
export interface Fc007AssessmentSnapshot {
  readonly evaluationContextId: string;
  readonly actionId: string;
  readonly provenanceSource: string;
  readonly provenanceRuleId: string | undefined;
  readonly provenanceEngineVersion: string | undefined;
  readonly provenanceRuleVersion: string | undefined;
  readonly consequences: readonly Fc007ConsequenceSnapshot[];
}

/**
 * Fully immutable VerifiedDecision authority.
 * Eligibility is NOT stored here — controller owns lifecycle state.
 */
export interface Fc007VerifiedDecision {
  readonly decisionId: string;
  /** Issuance generation — changes only when a new decision is created. */
  readonly decisionGeneration: number;
  readonly document: Document;
  readonly controllerEpoch: number;
  readonly interceptEvalSeq: number;
  /** Preview generation at issuance (stable while this decision remains active). */
  readonly issuancePreviewGeneration: number;
  readonly modal: HTMLDialogElement;
  readonly form: HTMLFormElement;
  readonly finalButton: HTMLButtonElement;
  readonly ownedHost: HTMLDivElement;
  readonly continueControl: HTMLButtonElement;
  readonly origin: string;
  readonly pathnameCanonical: string;
  readonly ownerNormalized: string;
  readonly repoNormalized: string;
  readonly ownerDisplay: string;
  readonly repoDisplay: string;
  readonly supportedLocale: "en" | "en-US";
  readonly contractId: typeof FC007_V2_CONTRACT_ID;
  readonly contractVersion: typeof FC007_V2_CONTRACT_VERSION;
  readonly adapterId: typeof FC007_V2_ADAPTER_ID;
  readonly adapterVersion: typeof FC007_V2_ADAPTER_VERSION;
  readonly stage: "final-confirmation";
  readonly currentVisibility: "private";
  readonly requestedVisibility: "public";
  readonly observationFingerprint: string;
  readonly effectsSemantics: Fc007EffectsSnapshot;
  readonly effectsFingerprint: string;
  readonly canonicalContext: Fc007CanonicalContextSnapshot;
  readonly contextFingerprint: string;
  readonly assessment: Fc007AssessmentSnapshot;
  readonly assessmentFingerprint: string;
  readonly lineageActionId: string;
  readonly lineageEvaluationContextId: string;
  readonly lineageEntityId: string;
  readonly lineageEntityLabel: string;
}

export type Fc007DecisionLifecycleStatus = "eligible" | "accepted" | "retired";

let decisionSeq = 0;
let decisionGenerationSeq = 0;

function deepFreezeOwned<T extends object>(value: T): T {
  if (Object.isFrozen(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child !== null && typeof child === "object") {
      deepFreezeOwned(child as object);
    }
  }
  return Object.freeze(value);
}

function requireString(value: unknown, reason: string): string | { error: string } {
  if (typeof value !== "string") return { error: reason };
  if (value.length === 0) return { error: reason };
  if (value.length > DECISION_MAX_STRING) return { error: `${reason}_OVERFLOW` };
  return value;
}

function requireExactString<T extends string>(
  value: unknown,
  expected: T,
  reason: string,
): T | { error: string } {
  if (value !== expected) return { error: reason };
  return expected;
}

function requireOneOf(
  value: unknown,
  allowed: ReadonlySet<string>,
  reason: string,
): string | { error: string } {
  if (typeof value !== "string" || !allowed.has(value)) return { error: reason };
  if (value.length > DECISION_MAX_STRING) return { error: `${reason}_OVERFLOW` };
  return value;
}

function requireConfidence(value: unknown): number | { error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "CONFIDENCE_TYPE" };
  }
  if (value < 0 || value > 1) return { error: "CONFIDENCE_RANGE" };
  return value;
}

function valueStateProjection(state: ValueState): Fc007ValueStateSnapshot | { error: string } {
  if (typeof state !== "object" || state === null) return { error: "VALUE_STATE_TYPE" };
  const status = (state as { status?: unknown }).status;
  if (typeof status !== "string" || !VALUE_STATE_STATUSES.has(status)) {
    return { error: "VALUE_STATE_STATUS" };
  }
  if (status === "known") {
    const value = (state as { value?: unknown }).value;
    if (value === null) return { status: "known", value: null };
    if (typeof value === "string") {
      if (value.length > DECISION_MAX_STRING) return { error: "VALUE_STATE_VALUE_OVERFLOW" };
      return { status: "known", value };
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return { error: "VALUE_STATE_VALUE_NUMBER" };
      return { status: "known", value };
    }
    if (typeof value === "boolean") return { status: "known", value };
    return { error: "VALUE_STATE_VALUE_TYPE" };
  }
  if (status === "absent") return { status: "absent" };
  return { status: "unknown" };
}

function encodeValueState(vs: Fc007ValueStateSnapshot): string | TypedFpError {
  if (vs.status === "absent") return encodeSeq(["absent"]);
  if (vs.status === "unknown") return encodeSeq(["unknown"]);
  const v = encodePrimitiveValue(vs.value);
  if (typeof v !== "string") return v;
  return encodeSeq(["known", v]);
}

function projectAssumptions(
  assumptions: readonly Assumption[],
): readonly Fc007AssumptionSnapshot[] | { error: string } {
  if (!Array.isArray(assumptions)) return { error: "ASSUMPTIONS_NOT_ARRAY" };
  if (assumptions.length > DECISION_MAX_ASSUMPTIONS) return { error: "ASSUMPTIONS_OVERFLOW" };
  const out: Fc007AssumptionSnapshot[] = [];
  for (const a of assumptions) {
    if (typeof a !== "object" || a === null) return { error: "ASSUMPTION_TYPE" };
    const id = requireString(a.id, "ASSUMPTION_ID");
    if (typeof id === "object") return id;
    const statement = requireString(a.statement, "ASSUMPTION_STATEMENT");
    if (typeof statement === "object") return statement;
    const status = requireOneOf(a.status, ASSUMPTION_STATUSES, "ASSUMPTION_STATUS");
    if (typeof status === "object") return status;
    out.push(deepFreezeOwned({ id, statement, status }));
  }
  return Object.freeze(out);
}

function projectEvidence(
  evidence: readonly EvidenceRecord[],
): readonly Fc007EvidenceSnapshot[] | { error: string } {
  if (!Array.isArray(evidence)) return { error: "EVIDENCE_NOT_ARRAY" };
  if (evidence.length > DECISION_MAX_EVIDENCE) return { error: "EVIDENCE_OVERFLOW" };
  const out: Fc007EvidenceSnapshot[] = [];
  for (const ev of evidence) {
    if (typeof ev !== "object" || ev === null) return { error: "EVIDENCE_TYPE" };
    const mode = requireOneOf(ev.mode, EVIDENCE_MODES, "EVIDENCE_MODE");
    if (typeof mode === "object") return mode;
    const source = requireOneOf(ev.source, PROVENANCE_SOURCES, "EVIDENCE_SOURCE");
    if (typeof source === "object") return source;
    const scope = requireString(ev.scope, "EVIDENCE_SCOPE");
    if (typeof scope === "object") return scope;
    const summary = requireString(ev.summary, "EVIDENCE_SUMMARY");
    if (typeof summary === "object") return summary;
    let confidence: number | undefined;
    if (ev.confidence !== undefined) {
      const c = requireConfidence(ev.confidence);
      if (typeof c === "object") return c;
      confidence = c;
    }
    if (!Array.isArray(ev.assumptions)) return { error: "EVIDENCE_ASSUMPTIONS" };
    const assumptions = projectAssumptions(ev.assumptions);
    if ("error" in assumptions) return assumptions;
    out.push(
      deepFreezeOwned({
        mode: mode as EvidenceMode,
        source,
        scope,
        summary,
        confidence,
        assumptions,
      }),
    );
  }
  return Object.freeze(out);
}

function projectStateChanges(
  changes: readonly StateChange[],
): readonly Fc007StateChangeSnapshot[] | { error: string } {
  if (!Array.isArray(changes)) return { error: "STATE_CHANGES_NOT_ARRAY" };
  if (changes.length > DECISION_MAX_STATE_CHANGES) return { error: "STATE_CHANGES_OVERFLOW" };
  const out: Fc007StateChangeSnapshot[] = [];
  for (const sc of changes) {
    if (typeof sc !== "object" || sc === null) return { error: "STATE_CHANGE_TYPE" };
    const entityId = requireString(sc.entityId, "STATE_CHANGE_ENTITY");
    if (typeof entityId === "object") return entityId;
    const property = requireString(sc.property, "STATE_CHANGE_PROPERTY");
    if (typeof property === "object") return property;
    const operation = requireOneOf(sc.operation, STATE_CHANGE_OPS, "STATE_CHANGE_OPERATION");
    if (typeof operation === "object") return operation;
    const before = valueStateProjection(sc.before);
    if ("error" in before) return before;
    const after = valueStateProjection(sc.after);
    if ("error" in after) return after;
    out.push(
      deepFreezeOwned({
        entityId,
        property,
        operation,
        before: deepFreezeOwned(before),
        after: deepFreezeOwned(after),
      }),
    );
  }
  return Object.freeze(out);
}

function readOptionalString(
  value: unknown,
  reason: string,
): string | undefined | { error: string } {
  if (value === undefined) return undefined;
  return requireString(value, reason);
}

function readDetailsRuleVersion(details: unknown): string | undefined | { error: string } {
  if (details === undefined) return undefined;
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return { error: "PROVENANCE_DETAILS_TYPE" };
  }
  const ruleVersion = (details as { ruleVersion?: unknown }).ruleVersion;
  if (ruleVersion === undefined) return undefined;
  return requireString(ruleVersion, "PROVENANCE_RULE_VERSION");
}

export function snapshotCanonicalContext(
  context: ActionEvaluationContext,
):
  | { readonly status: "ok"; readonly value: Fc007CanonicalContextSnapshot }
  | { readonly status: "invalid"; readonly reason: string } {
  if (typeof context !== "object" || context === null) {
    return { status: "invalid", reason: "CONTEXT_TYPE" };
  }
  const action: ProposedAction = context.action;
  const state: StateSnapshot = context.state;
  if (typeof action !== "object" || action === null) {
    return { status: "invalid", reason: "ACTION_TYPE" };
  }
  if (typeof state !== "object" || state === null) {
    return { status: "invalid", reason: "STATE_TYPE" };
  }
  if (!Array.isArray(state.entities)) {
    return { status: "invalid", reason: "ENTITIES_MISSING" };
  }
  if (state.entities.length !== 1) {
    return { status: "invalid", reason: "ENTITIES_NOT_SINGLETON" };
  }
  if (!Array.isArray(state.facts)) {
    return { status: "invalid", reason: "FACTS_MISSING" };
  }
  if (state.facts.length !== 1) {
    return { status: "invalid", reason: "FACTS_NOT_SINGLETON" };
  }
  if (!Array.isArray(action.targets)) {
    return { status: "invalid", reason: "TARGETS_MISSING" };
  }
  if (action.targets.length !== 1) {
    return { status: "invalid", reason: "TARGETS_NOT_SINGLETON" };
  }

  const entity = state.entities[0];
  const fact = state.facts[0] as StateFact;
  const target = action.targets[0];
  if (!entity || !fact || !target) return { status: "invalid", reason: "CONTEXT_SHAPE" };

  const actorKind = requireExactString(action.actor?.kind, "human", "ACTOR_KIND");
  if (typeof actorKind === "object") return { status: "invalid", reason: actorKind.error };
  const environmentKind = requireExactString(
    action.environment?.kind,
    "browser",
    "ENVIRONMENT_KIND",
  );
  if (typeof environmentKind === "object") {
    return { status: "invalid", reason: environmentKind.error };
  }
  const environmentPlatform = requireExactString(
    action.environment?.platform,
    "web",
    "ENVIRONMENT_PLATFORM",
  );
  if (typeof environmentPlatform === "object") {
    return { status: "invalid", reason: environmentPlatform.error };
  }
  const applicationId = requireString(action.environment?.application?.id, "APPLICATION_ID");
  if (typeof applicationId === "object") {
    return { status: "invalid", reason: applicationId.error };
  }
  const applicationName = requireString(action.environment?.application?.name, "APPLICATION_NAME");
  if (typeof applicationName === "object") {
    return { status: "invalid", reason: applicationName.error };
  }
  const intentVerb = requireString(action.intent?.verb, "INTENT_VERB");
  if (typeof intentVerb === "object") return { status: "invalid", reason: intentVerb.error };
  const intentDomain = requireString(action.intent?.domain, "INTENT_DOMAIN");
  if (typeof intentDomain === "object") return { status: "invalid", reason: intentDomain.error };
  const executionStatus = requireExactString(
    action.executionStatus,
    "proposed",
    "EXECUTION_STATUS",
  );
  if (typeof executionStatus === "object") {
    return { status: "invalid", reason: executionStatus.error };
  }
  const entityKind = requireExactString(entity.kind, "repository", "ENTITY_KIND");
  if (typeof entityKind === "object") return { status: "invalid", reason: entityKind.error };
  const entityLabel = requireString(entity.label, "ENTITY_LABEL");
  if (typeof entityLabel === "object") return { status: "invalid", reason: entityLabel.error };
  const entityId = requireString(entity.id, "ENTITY_ID");
  if (typeof entityId === "object") return { status: "invalid", reason: entityId.error };
  const visibilityFactKey = requireExactString(fact.key, "repository.visibility", "FACT_KEY");
  if (typeof visibilityFactKey === "object") {
    return { status: "invalid", reason: visibilityFactKey.error };
  }
  const visibilityFactValue = requireExactString(fact.value, "private", "FACT_VALUE");
  if (typeof visibilityFactValue === "object") {
    return { status: "invalid", reason: visibilityFactValue.error };
  }
  const visibilityFactSubjectEntityId = requireString(fact.subjectEntityId, "FACT_SUBJECT");
  if (typeof visibilityFactSubjectEntityId === "object") {
    return { status: "invalid", reason: visibilityFactSubjectEntityId.error };
  }
  const requestedVisibility = requireExactString(
    action.parameters?.newVisibility,
    "public",
    "REQUESTED_VISIBILITY",
  );
  if (typeof requestedVisibility === "object") {
    return { status: "invalid", reason: requestedVisibility.error };
  }
  const primaryTargetRole = requireExactString(target.role, "primary", "TARGET_ROLE");
  if (typeof primaryTargetRole === "object") {
    return { status: "invalid", reason: primaryTargetRole.error };
  }
  const primaryTargetEntityId = requireString(target.entityId, "TARGET_ENTITY");
  if (typeof primaryTargetEntityId === "object") {
    return { status: "invalid", reason: primaryTargetEntityId.error };
  }

  if (primaryTargetEntityId !== entityId) {
    return { status: "invalid", reason: "LINEAGE_TARGET_ENTITY" };
  }
  if (visibilityFactSubjectEntityId !== entityId) {
    return { status: "invalid", reason: "LINEAGE_FACT_ENTITY" };
  }
  if (intentVerb !== "change-access") {
    return { status: "invalid", reason: "INTENT_VERB_UNSUPPORTED" };
  }
  if (intentDomain !== "version_control") {
    return { status: "invalid", reason: "INTENT_DOMAIN_UNSUPPORTED" };
  }
  if (applicationId !== "app-github") {
    return { status: "invalid", reason: "APPLICATION_ID_UNSUPPORTED" };
  }
  if (applicationName !== "GitHub") {
    return { status: "invalid", reason: "APPLICATION_NAME_UNSUPPORTED" };
  }

  const snap: Fc007CanonicalContextSnapshot = {
    actorKind,
    environmentKind,
    environmentPlatform,
    applicationId,
    applicationName,
    intentVerb,
    intentDomain,
    executionStatus,
    entityKind,
    entityLabel,
    entityId,
    visibilityFactKey,
    visibilityFactValue,
    visibilityFactSubjectEntityId,
    requestedVisibility,
    primaryTargetRole,
    primaryTargetEntityId,
  };
  return { status: "ok", value: deepFreezeOwned(snap) };
}

/**
 * Semantic fingerprint — excludes incidental generated entity IDs.
 * Collision-safe typed encoding; includes applicationName.
 */
export function fingerprintCanonicalContext(snap: Fc007CanonicalContextSnapshot): string {
  const parts = [
    encodeString(snap.actorKind),
    encodeString(snap.environmentKind),
    encodeString(snap.environmentPlatform),
    encodeString(snap.applicationId),
    encodeString(snap.applicationName),
    encodeString(snap.intentVerb),
    encodeString(snap.intentDomain),
    encodeString(snap.executionStatus),
    encodeString(snap.entityKind),
    encodeString(snap.entityLabel),
    encodeString(snap.visibilityFactKey),
    encodeString(snap.visibilityFactValue),
    encodeString(snap.requestedVisibility),
    encodeString(snap.primaryTargetRole),
  ];
  for (const p of parts) {
    if (typeof p !== "string") return `INVALID:${p.error}`;
  }
  const enc = encodeSeq(parts as string[]);
  return typeof enc === "string" ? enc : `INVALID:${enc.error}`;
}

function projectConsequence(
  csq: Consequence,
  expectedActionId: string,
  expectedEntityId: string,
): Fc007ConsequenceSnapshot | { error: string } {
  if (typeof csq !== "object" || csq === null) return { error: "CONSEQUENCE_TYPE" };
  const kind = requireOneOf(csq.kind, CONSEQUENCE_KINDS, "CONSEQUENCE_KIND");
  if (typeof kind === "object") return kind;
  const summary = requireString(csq.summary, "CONSEQUENCE_SUMMARY");
  if (typeof summary === "object") return summary;
  const actionId = requireString(csq.actionId, "CONSEQUENCE_ACTION_ID");
  if (typeof actionId === "object") return actionId;
  if (actionId !== expectedActionId) return { error: "LINEAGE_CONSEQUENCE_ACTION" };

  const confidence = requireConfidence(csq.confidence);
  if (typeof confidence === "object") return confidence;

  if (!Array.isArray(csq.affectedEntities)) return { error: "AFFECTED_NOT_ARRAY" };
  if (csq.affectedEntities.length > DECISION_MAX_AFFECTED) {
    return { error: "AFFECTED_OVERFLOW" };
  }
  const affectedEntityIds: string[] = [];
  for (const id of csq.affectedEntities) {
    const eid = requireString(id, "AFFECTED_ENTITY_ID");
    if (typeof eid === "object") return eid;
    if (eid !== expectedEntityId) return { error: "LINEAGE_AFFECTED_ENTITY" };
    affectedEntityIds.push(eid);
  }

  const stateChanges = projectStateChanges(csq.stateChanges ?? []);
  if ("error" in stateChanges) return stateChanges;
  for (const sc of stateChanges) {
    if (sc.entityId !== expectedEntityId) return { error: "LINEAGE_STATE_CHANGE_ENTITY" };
  }

  const evidence = projectEvidence(csq.evidence);
  if ("error" in evidence) return evidence;

  if (typeof csq.risk !== "object" || csq.risk === null) return { error: "RISK_TYPE" };
  const riskSeverity = requireOneOf(csq.risk.severity, RISK_SEVERITIES, "RISK_SEVERITY");
  if (typeof riskSeverity === "object") return riskSeverity;
  if (!Array.isArray(csq.risk.categories)) return { error: "RISK_CATEGORIES" };
  if (csq.risk.categories.length > DECISION_MAX_RISK_CATEGORIES) {
    return { error: "RISK_CATEGORIES_OVERFLOW" };
  }
  const riskCategories: string[] = [];
  for (const cat of csq.risk.categories) {
    const c = requireOneOf(cat, RISK_CATEGORIES, "RISK_CATEGORY");
    if (typeof c === "object") return c;
    riskCategories.push(c);
  }
  const riskDescription = readOptionalString(csq.risk.description, "RISK_DESCRIPTION");
  if (typeof riskDescription === "object") return riskDescription;

  if (typeof csq.reversibility !== "object" || csq.reversibility === null) {
    return { error: "REVERSIBILITY_TYPE" };
  }
  const reversibilityLevel = requireOneOf(
    csq.reversibility.level,
    REVERSIBILITY_LEVELS,
    "REVERSIBILITY_LEVEL",
  );
  if (typeof reversibilityLevel === "object") return reversibilityLevel;
  const reversibilityMethod = readOptionalString(csq.reversibility.method, "REVERSIBILITY_METHOD");
  if (typeof reversibilityMethod === "object") return reversibilityMethod;
  const reversibilityTimeWindow = readOptionalString(
    csq.reversibility.timeWindow,
    "REVERSIBILITY_TIME_WINDOW",
  );
  if (typeof reversibilityTimeWindow === "object") return reversibilityTimeWindow;
  const reqs = csq.reversibility.requirements ?? [];
  if (!Array.isArray(reqs)) return { error: "REVERSIBILITY_REQUIREMENTS" };
  if (reqs.length > DECISION_MAX_REV_REQUIREMENTS) {
    return { error: "REVERSIBILITY_REQUIREMENTS_OVERFLOW" };
  }
  const reversibilityRequirements: string[] = [];
  for (const r of reqs) {
    const s = requireString(r, "REVERSIBILITY_REQUIREMENT");
    if (typeof s === "object") return s;
    reversibilityRequirements.push(s);
  }

  let provenanceSource: string | undefined;
  let provenanceRuleId: string | undefined;
  let provenanceRuleVersion: string | undefined;
  if (csq.provenance !== undefined) {
    if (typeof csq.provenance !== "object" || csq.provenance === null) {
      return { error: "CSQ_PROVENANCE_TYPE" };
    }
    const src = requireOneOf(csq.provenance.source, PROVENANCE_SOURCES, "CSQ_PROVENANCE_SOURCE");
    if (typeof src === "object") return src;
    provenanceSource = src;
    const ruleId = readOptionalString(csq.provenance.ruleId, "CSQ_PROVENANCE_RULE");
    if (typeof ruleId === "object") return ruleId;
    provenanceRuleId = ruleId;
    const ruleVersion = readDetailsRuleVersion(csq.provenance.details);
    if (typeof ruleVersion === "object") return ruleVersion;
    provenanceRuleVersion = ruleVersion;
  }

  let temporalTiming: string | undefined;
  let temporalFrequency: string | undefined;
  if (csq.temporal !== undefined) {
    if (typeof csq.temporal !== "object" || csq.temporal === null) {
      return { error: "TEMPORAL_TYPE" };
    }
    const timing = requireOneOf(csq.temporal.timing, TEMPORAL_TIMINGS, "TEMPORAL_TIMING");
    if (typeof timing === "object") return timing;
    const frequency = requireOneOf(
      csq.temporal.frequency,
      TEMPORAL_FREQUENCIES,
      "TEMPORAL_FREQUENCY",
    );
    if (typeof frequency === "object") return frequency;
    temporalTiming = timing;
    temporalFrequency = frequency;
  }

  return deepFreezeOwned({
    kind,
    summary,
    actionId,
    affectedEntityIds: Object.freeze(affectedEntityIds),
    stateChanges,
    evidence,
    confidence,
    riskSeverity,
    riskCategories: Object.freeze(riskCategories),
    riskDescription,
    reversibilityLevel,
    reversibilityMethod,
    reversibilityTimeWindow,
    reversibilityRequirements: Object.freeze(reversibilityRequirements),
    provenanceSource,
    provenanceRuleId,
    provenanceRuleVersion,
    temporalTiming,
    temporalFrequency,
  });
}

export function snapshotAssessment(
  assessment: ConsequenceAssessment,
  expectedEntityId: string,
):
  | { readonly status: "ok"; readonly value: Fc007AssessmentSnapshot }
  | { readonly status: "invalid"; readonly reason: string } {
  if (typeof assessment !== "object" || assessment === null) {
    return { status: "invalid", reason: "ASSESSMENT_TYPE" };
  }
  const evaluationContextId = requireString(
    assessment.evaluationContextId,
    "ASSESSMENT_CONTEXT_ID",
  );
  if (typeof evaluationContextId === "object") {
    return { status: "invalid", reason: evaluationContextId.error };
  }
  const actionId = requireString(assessment.actionId, "ASSESSMENT_ACTION_ID");
  if (typeof actionId === "object") return { status: "invalid", reason: actionId.error };

  if (typeof assessment.provenance !== "object" || assessment.provenance === null) {
    return { status: "invalid", reason: "ASSESSMENT_PROVENANCE" };
  }
  const provenanceSource = requireOneOf(
    assessment.provenance.source,
    PROVENANCE_SOURCES,
    "ASSESSMENT_PROVENANCE_SOURCE",
  );
  if (typeof provenanceSource === "object") {
    return { status: "invalid", reason: provenanceSource.error };
  }
  const provenanceRuleId = readOptionalString(
    assessment.provenance.ruleId,
    "ASSESSMENT_PROVENANCE_RULE",
  );
  if (typeof provenanceRuleId === "object") {
    return { status: "invalid", reason: provenanceRuleId.error };
  }
  const provenanceEngineVersion = readOptionalString(
    assessment.provenance.engineVersion,
    "ASSESSMENT_ENGINE_VERSION",
  );
  if (typeof provenanceEngineVersion === "object") {
    return { status: "invalid", reason: provenanceEngineVersion.error };
  }
  const provenanceRuleVersion = readDetailsRuleVersion(assessment.provenance.details);
  if (typeof provenanceRuleVersion === "object") {
    return { status: "invalid", reason: provenanceRuleVersion.error };
  }

  if (!Array.isArray(assessment.consequences)) {
    return { status: "invalid", reason: "CONSEQUENCES_NOT_ARRAY" };
  }
  if (assessment.consequences.length === 0) {
    return { status: "invalid", reason: "CONSEQUENCES_EMPTY" };
  }
  if (assessment.consequences.length > DECISION_MAX_CONSEQUENCES) {
    return { status: "invalid", reason: "CONSEQUENCES_OVERFLOW" };
  }

  const consequences: Fc007ConsequenceSnapshot[] = [];
  for (const csq of assessment.consequences) {
    const projected = projectConsequence(csq, actionId, expectedEntityId);
    if ("error" in projected) return { status: "invalid", reason: projected.error };
    consequences.push(projected);
  }

  return {
    status: "ok",
    value: deepFreezeOwned({
      evaluationContextId,
      actionId,
      provenanceSource,
      provenanceRuleId,
      provenanceEngineVersion,
      provenanceRuleVersion,
      consequences: Object.freeze(consequences),
    }),
  };
}

function encodeEvidence(ev: Fc007EvidenceSnapshot): string | TypedFpError {
  const mode = encodeString(ev.mode);
  if (typeof mode !== "string") return mode;
  const source = encodeString(ev.source);
  if (typeof source !== "string") return source;
  const scope = encodeString(ev.scope);
  if (typeof scope !== "string") return scope;
  const summary = encodeString(ev.summary);
  if (typeof summary !== "string") return summary;
  const confidence = encodeOptionalNumber(ev.confidence);
  if (typeof confidence !== "string") return confidence;
  const asms: string[] = [];
  for (const a of ev.assumptions) {
    const id = encodeString(a.id);
    if (typeof id !== "string") return id;
    const statement = encodeString(a.statement);
    if (typeof statement !== "string") return statement;
    const status = encodeString(a.status);
    if (typeof status !== "string") return status;
    const enc = encodeSeq([id, statement, status]);
    if (typeof enc !== "string") return enc;
    asms.push(enc);
  }
  const asmEnc = encodeSeq(asms);
  if (typeof asmEnc !== "string") return asmEnc;
  return encodeSeq([mode, source, scope, summary, confidence, asmEnc]);
}

export function fingerprintAssessment(snap: Fc007AssessmentSnapshot): string {
  const head: Array<string | TypedFpError> = [
    encodeString(snap.evaluationContextId),
    encodeString(snap.actionId),
    encodeString(snap.provenanceSource),
    encodeOptionalString(snap.provenanceRuleId),
    encodeOptionalString(snap.provenanceEngineVersion),
    encodeOptionalString(snap.provenanceRuleVersion),
  ];
  const csqParts: string[] = [];
  for (const csq of snap.consequences) {
    const kind = encodeString(csq.kind);
    if (typeof kind !== "string") return `INVALID:${kind.error}`;
    const summary = encodeString(csq.summary);
    if (typeof summary !== "string") return `INVALID:${summary.error}`;
    const actionId = encodeString(csq.actionId);
    if (typeof actionId !== "string") return `INVALID:${actionId.error}`;
    const conf = encodeNumber(csq.confidence);
    if (typeof conf !== "string") return `INVALID:${conf.error}`;
    const affected: string[] = [];
    for (const id of csq.affectedEntityIds) {
      const e = encodeString(id);
      if (typeof e !== "string") return `INVALID:${e.error}`;
      affected.push(e);
    }
    const affectedEnc = encodeSeq(affected);
    if (typeof affectedEnc !== "string") return `INVALID:${affectedEnc.error}`;

    const scParts: string[] = [];
    for (const sc of csq.stateChanges) {
      const entityId = encodeString(sc.entityId);
      if (typeof entityId !== "string") return `INVALID:${entityId.error}`;
      const property = encodeString(sc.property);
      if (typeof property !== "string") return `INVALID:${property.error}`;
      const operation = encodeString(sc.operation);
      if (typeof operation !== "string") return `INVALID:${operation.error}`;
      const before = encodeValueState(sc.before);
      if (typeof before !== "string") return `INVALID:${before.error}`;
      const after = encodeValueState(sc.after);
      if (typeof after !== "string") return `INVALID:${after.error}`;
      const scEnc = encodeSeq([entityId, property, operation, before, after]);
      if (typeof scEnc !== "string") return `INVALID:${scEnc.error}`;
      scParts.push(scEnc);
    }
    const scEnc = encodeSeq(scParts);
    if (typeof scEnc !== "string") return `INVALID:${scEnc.error}`;

    const evParts: string[] = [];
    for (const ev of csq.evidence) {
      const e = encodeEvidence(ev);
      if (typeof e !== "string") return `INVALID:${e.error}`;
      evParts.push(e);
    }
    const evEnc = encodeSeq(evParts);
    if (typeof evEnc !== "string") return `INVALID:${evEnc.error}`;

    const riskSeverity = encodeString(csq.riskSeverity);
    if (typeof riskSeverity !== "string") return `INVALID:${riskSeverity.error}`;
    const cats: string[] = [];
    for (const c of csq.riskCategories) {
      const enc = encodeString(c);
      if (typeof enc !== "string") return `INVALID:${enc.error}`;
      cats.push(enc);
    }
    const catsEnc = encodeSeq(cats);
    if (typeof catsEnc !== "string") return `INVALID:${catsEnc.error}`;
    const riskDesc = encodeOptionalString(csq.riskDescription);
    if (typeof riskDesc !== "string") return `INVALID:${riskDesc.error}`;

    const revLevel = encodeString(csq.reversibilityLevel);
    if (typeof revLevel !== "string") return `INVALID:${revLevel.error}`;
    const revMethod = encodeOptionalString(csq.reversibilityMethod);
    if (typeof revMethod !== "string") return `INVALID:${revMethod.error}`;
    const revWindow = encodeOptionalString(csq.reversibilityTimeWindow);
    if (typeof revWindow !== "string") return `INVALID:${revWindow.error}`;
    const reqs: string[] = [];
    for (const r of csq.reversibilityRequirements) {
      const enc = encodeString(r);
      if (typeof enc !== "string") return `INVALID:${enc.error}`;
      reqs.push(enc);
    }
    const reqsEnc = encodeSeq(reqs);
    if (typeof reqsEnc !== "string") return `INVALID:${reqsEnc.error}`;

    const provSrc = encodeOptionalString(csq.provenanceSource);
    if (typeof provSrc !== "string") return `INVALID:${provSrc.error}`;
    const provRule = encodeOptionalString(csq.provenanceRuleId);
    if (typeof provRule !== "string") return `INVALID:${provRule.error}`;
    const provRuleVer = encodeOptionalString(csq.provenanceRuleVersion);
    if (typeof provRuleVer !== "string") return `INVALID:${provRuleVer.error}`;
    const tempTiming = encodeOptionalString(csq.temporalTiming);
    if (typeof tempTiming !== "string") return `INVALID:${tempTiming.error}`;
    const tempFreq = encodeOptionalString(csq.temporalFrequency);
    if (typeof tempFreq !== "string") return `INVALID:${tempFreq.error}`;

    const csqEnc = encodeSeq([
      kind,
      summary,
      actionId,
      conf,
      affectedEnc,
      scEnc,
      evEnc,
      riskSeverity,
      catsEnc,
      riskDesc,
      revLevel,
      revMethod,
      revWindow,
      reqsEnc,
      provSrc,
      provRule,
      provRuleVer,
      tempTiming,
      tempFreq,
    ]);
    if (typeof csqEnc !== "string") return `INVALID:${csqEnc.error}`;
    csqParts.push(csqEnc);
  }

  for (const p of head) {
    if (typeof p !== "string") return `INVALID:${p.error}`;
  }
  const csqEnc = encodeSeq(csqParts);
  if (typeof csqEnc !== "string") return `INVALID:${csqEnc.error}`;
  const full = encodeSeq([...(head as string[]), csqEnc]);
  return typeof full === "string" ? full : `INVALID:${full.error}`;
}

export function validateDecisionLineage(args: {
  readonly observation: GitHubVisibilityObservationV2;
  readonly context: ActionEvaluationContext;
  readonly assessment: ConsequenceAssessment;
  readonly contextSnap: Fc007CanonicalContextSnapshot;
}): string | null {
  const { observation, context, assessment, contextSnap } = args;
  if (assessment.actionId !== context.action.id) return "LINEAGE_ACTION_ID";
  if (assessment.evaluationContextId !== context.id) return "LINEAGE_CONTEXT_ID";
  if (contextSnap.entityLabel !== `${observation.ownerDisplay}/${observation.repoDisplay}`) {
    return "LINEAGE_ENTITY_LABEL";
  }
  if (contextSnap.visibilityFactValue !== "private") return "LINEAGE_CURRENT_VISIBILITY";
  if (contextSnap.requestedVisibility !== "public") return "LINEAGE_REQUESTED_VISIBILITY";
  if (observation.currentVisibility !== "private") return "LINEAGE_OBS_CURRENT";
  if (observation.requestedVisibility !== "public") return "LINEAGE_OBS_REQUESTED";
  if (observation.stage !== "final-confirmation") return "LINEAGE_STAGE";
  return null;
}

export function createVerifiedDecision(args: {
  readonly document: Document;
  readonly controllerEpoch: number;
  readonly interceptEvalSeq: number;
  readonly issuancePreviewGeneration: number;
  readonly modal: HTMLDialogElement;
  readonly form: HTMLFormElement;
  readonly finalButton: HTMLButtonElement;
  readonly ownedHost: HTMLDivElement;
  readonly continueControl: HTMLButtonElement;
  readonly effectsRegion: HTMLDivElement;
  readonly observation: GitHubVisibilityObservationV2;
  readonly observationFingerprint: string;
  readonly context: ActionEvaluationContext;
  readonly assessment: ConsequenceAssessment;
}):
  | { readonly status: "ok"; readonly value: Fc007VerifiedDecision }
  | { readonly status: "invalid"; readonly reason: string } {
  if (!(args.continueControl instanceof HTMLButtonElement)) {
    return { status: "invalid", reason: "CONTINUE_CONTROL" };
  }
  if (!(args.effectsRegion instanceof HTMLDivElement)) {
    return { status: "invalid", reason: "EFFECTS_REGION" };
  }
  if (!args.modal.contains(args.effectsRegion)) {
    return { status: "invalid", reason: "EFFECTS_NOT_IN_MODAL" };
  }

  const contextRes = snapshotCanonicalContext(args.context);
  if (contextRes.status !== "ok") return contextRes;

  const lineage = validateDecisionLineage({
    observation: args.observation,
    context: args.context,
    assessment: args.assessment,
    contextSnap: contextRes.value,
  });
  if (lineage) return { status: "invalid", reason: lineage };

  const assessmentRes = snapshotAssessment(args.assessment, contextRes.value.entityId);
  if (assessmentRes.status !== "ok") return assessmentRes;

  const effectsRes = projectEffectsSemantics(args.effectsRegion);
  if (effectsRes.status !== "ok") {
    return { status: "invalid", reason: effectsRes.reason };
  }

  decisionSeq += 1;
  decisionGenerationSeq += 1;
  const contextFingerprint = fingerprintCanonicalContext(contextRes.value);
  const assessmentFingerprint = fingerprintAssessment(assessmentRes.value);

  const decision: Fc007VerifiedDecision = {
    decisionId: `fc007-decision-${decisionSeq}`,
    decisionGeneration: decisionGenerationSeq,
    document: args.document,
    controllerEpoch: args.controllerEpoch,
    interceptEvalSeq: args.interceptEvalSeq,
    issuancePreviewGeneration: args.issuancePreviewGeneration,
    modal: args.modal,
    form: args.form,
    finalButton: args.finalButton,
    ownedHost: args.ownedHost,
    continueControl: args.continueControl,
    origin: args.observation.routeIdentity.origin,
    pathnameCanonical: args.observation.routeIdentity.pathnameCanonical,
    ownerNormalized: args.observation.ownerNormalized,
    repoNormalized: args.observation.repoNormalized,
    ownerDisplay: args.observation.ownerDisplay,
    repoDisplay: args.observation.repoDisplay,
    supportedLocale: args.observation.supportedLocale,
    contractId: FC007_V2_CONTRACT_ID,
    contractVersion: FC007_V2_CONTRACT_VERSION,
    adapterId: FC007_V2_ADAPTER_ID,
    adapterVersion: FC007_V2_ADAPTER_VERSION,
    stage: "final-confirmation",
    currentVisibility: "private",
    requestedVisibility: "public",
    observationFingerprint: args.observationFingerprint,
    effectsSemantics: effectsRes.snapshot,
    effectsFingerprint: effectsRes.fingerprint,
    canonicalContext: contextRes.value,
    contextFingerprint,
    assessment: assessmentRes.value,
    assessmentFingerprint,
    lineageActionId: args.context.action.id,
    lineageEvaluationContextId: args.context.id,
    lineageEntityId: contextRes.value.entityId,
    lineageEntityLabel: contextRes.value.entityLabel,
  };
  return { status: "ok", value: Object.freeze(decision) };
}

export function isDecisionAuthorityFrozen(decision: Fc007VerifiedDecision): boolean {
  return Object.isFrozen(decision);
}

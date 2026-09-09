/**
 * Canonical Context Construction (Sprint FC-005)
 *
 * Epistemological Boundary:
 * The central adapter engine converts a semantic BrowserContextDraft and BrowserObservation
 * into an authoritative, validated ActionEvaluationContext conforming strictly to FC-002 contracts.
 *
 * Invariants:
 * - Canonical IDs are generated centrally via injected deterministic/cryptographic providers.
 * - Local DOM references (entityKey) are NOT used as canonical EntityIds.
 * - Single timestamp ownership: observation.capturedAt is consistently propagated across context,
 *   state snapshot, facts, action, and provenance.
 * - Canonical environment kind is 'browser', platform is 'web', shared across state and action.
 * - Provenance source is 'adapter' with bounded machine metadata (synthetic: true).
 * - Complete context passes validateActionEvaluationContext before return.
 */

import {
  type ActionEvaluationContext,
  type ActionId,
  type CanonicalEntity,
  type EntityId,
  type EnvironmentDescriptor,
  type EvaluationContextId,
  FUTURECLICK_SCHEMA_VERSION,
  type ObservationId,
  type ProposedAction,
  type ProvenanceDescriptor,
  type StateFact,
  type StateSnapshot,
  type StateSnapshotId,
  deepFreezeCanonical,
  validateActionEvaluationContext,
  validateId,
} from "@futureclick/action-schema";
import { type IdGenerator, type Result, err, generateEntityId, ok } from "@futureclick/shared";
import type { BrowserActionAdapter, BrowserContextDraft, BrowserObservation } from "./types.js";

export interface ContextConstructionOptions {
  readonly idGenerator?: IdGenerator | undefined;
}

export const SYNTHETIC_APP_NAME = "FutureClick Synthetic Harness";
export const SYNTHETIC_APP_ID = "app-futureclick-synthetic-harness";

/**
 * Constructs an authoritative ActionEvaluationContext from an adapter draft and observation.
 */
export function constructCanonicalContext(
  draft: BrowserContextDraft,
  observation: BrowserObservation,
  adapter: BrowserActionAdapter,
  options?: ContextConstructionOptions,
): Result<ActionEvaluationContext, Error> {
  // 1. Allocate canonical IDs
  const idGen = options?.idGenerator;
  const normalizedSeen = new Set<string>();

  function generateAndValidateId(prefix: string): Result<string, Error> {
    let raw: unknown;
    try {
      raw = idGen ? idGen.generate(prefix) : generateEntityId(prefix);
    } catch {
      return err(
        new Error(
          "[INVALID_CONFIGURATION] ID generator failed during canonical context allocation.",
        ),
      );
    }

    if (typeof raw !== "string") {
      return err(new Error("[INVALID_CONFIGURATION] ID generator must return a string."));
    }

    const valRes = validateId<string>(raw, "CanonicalId", "id");
    if (!valRes.valid) {
      return err(new Error("[INVALID_CONFIGURATION] Allocated canonical ID is invalid."));
    }

    const norm = valRes.value;
    if (normalizedSeen.has(norm)) {
      return err(
        new Error(
          "[INVALID_CONFIGURATION] Normalized ID collision detected during context allocation.",
        ),
      );
    }
    normalizedSeen.add(norm);

    return ok(norm);
  }

  const ctxIdRes = generateAndValidateId("ctx");
  if (!ctxIdRes.ok) return err(ctxIdRes.error);
  const ctxId = ctxIdRes.value as EvaluationContextId;

  const actIdRes = generateAndValidateId("act");
  if (!actIdRes.ok) return err(actIdRes.error);
  const actId = actIdRes.value as ActionId;

  const stateIdRes = generateAndValidateId("state");
  if (!stateIdRes.ok) return err(stateIdRes.error);
  const stateId = stateIdRes.value as StateSnapshotId;

  const repoEntityIdRes = generateAndValidateId("ent");
  if (!repoEntityIdRes.ok) return err(repoEntityIdRes.error);
  const repoEntityId = repoEntityIdRes.value as EntityId;

  const factIdRes = generateAndValidateId("obs");
  if (!factIdRes.ok) return err(factIdRes.error);
  const factId = factIdRes.value as ObservationId;

  let envId: string;
  if (idGen) {
    envId = "env-deterministic-browser";
    if (normalizedSeen.has(envId)) {
      return err(
        new Error(
          "[INVALID_CONFIGURATION] Normalized ID collision detected during context allocation.",
        ),
      );
    }
    normalizedSeen.add(envId);
  } else {
    const envIdRes = generateAndValidateId("env");
    if (!envIdRes.ok) return err(envIdRes.error);
    envId = envIdRes.value;
  }

  // 2. Canonical Environment (Browser / Web)
  const environment: EnvironmentDescriptor = {
    environmentId: envId,
    kind: "browser",
    platform: "web",
    application: {
      id: SYNTHETIC_APP_ID,
      name: SYNTHETIC_APP_NAME,
      version: "1.0",
    },
  };

  // 3. Provenance Descriptor
  const provenance: ProvenanceDescriptor = {
    source: "adapter",
    timestamp: observation.capturedAt,
    details: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      browserObservationId: observation.id,
      observationSchemaVersion: observation.schemaVersion,
      synthetic: true,
      evidenceBasis: "synthetic-page-metadata",
    },
  };

  // 4. Canonical Repository Entity (Finding H2: Predefined trusted canonical label)
  const repositoryEntity: CanonicalEntity = {
    id: repoEntityId,
    kind: draft.entityKind,
    label: "Synthetic Repository",
  };

  // 5. Canonical State Fact (repository.visibility = private)
  const visibilityFact: StateFact = {
    id: factId,
    subjectEntityId: repoEntityId,
    key: "repository.visibility",
    value: draft.currentVisibility,
    observedAt: observation.capturedAt,
  };

  // 6. State Snapshot
  const state: StateSnapshot = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: stateId,
    observedAt: observation.capturedAt,
    environment,
    entities: [repositoryEntity],
    facts: [visibilityFact],
    provenance,
  };

  // 7. Proposed Action (domain: version_control, verb: change-access)
  const action: ProposedAction = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: actId,
    proposedAt: observation.capturedAt,
    environment,
    actor: {
      kind: "human",
    },
    intent: {
      verb: draft.intent.verb,
      domain: draft.intent.domain,
    },
    targets: [
      {
        entityId: repoEntityId,
        role: draft.targetRole,
      },
    ],
    parameters: {
      newVisibility: draft.requestedVisibility,
    },
    executionStatus: "proposed",
    provenance,
  };

  // 8. Evaluation Context
  const contextCandidate: ActionEvaluationContext = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: ctxId,
    createdAt: observation.capturedAt,
    state,
    action,
  };

  // 9. Authoritative validation
  const validation = validateActionEvaluationContext(contextCandidate);
  if (!validation.valid) {
    const issueSummary = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    return err(
      new Error(
        `[INVALID_ADAPTER_OUTPUT] Generated ActionEvaluationContext failed canonical validation: ${issueSummary}`,
      ),
    );
  }

  return ok(deepFreezeCanonical(validation.value));
}

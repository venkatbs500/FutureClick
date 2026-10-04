/**
 * FC-007 Sprint 1 — local GitHub observation → frozen ActionEvaluationContext.
 *
 * Single adaptation path. Does NOT use synthetic BrowserActionAdapter.
 */

import {
  type ActionEvaluationContext,
  type EnvironmentDescriptor,
  type ProvenanceDescriptor,
  createActionEvaluationContext,
  createCanonicalEntity,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  validateActionEvaluationContext,
} from "@futureclick/action-schema";
import { currentIsoTimestamp, generateEntityId } from "@futureclick/shared";
import {
  FC007_ADAPTER_ID,
  FC007_ADAPTER_VERSION,
  FC007_EVIDENCE_BASIS,
  type GitHubVisibilityObservation,
  validateFc007GitHubVisibilityObservation,
} from "./github-observation.js";

export const FC007_APPLICATION_ID = "app-github";
export const FC007_APPLICATION_NAME = "GitHub";

export type AdaptResult =
  | { readonly status: "ok"; readonly context: ActionEvaluationContext }
  | { readonly status: "invalid"; readonly reason: string };

export function adaptGithubVisibilityObservationToCanonicalContext(
  observationInput: unknown,
): AdaptResult {
  const validated = validateFc007GitHubVisibilityObservation(observationInput);
  if (validated.status !== "ok") {
    return { status: "invalid", reason: validated.reason };
  }
  const observation: GitHubVisibilityObservation = validated.value;

  const observedAt =
    observation.observedAt.length > 0
      ? (observation.observedAt as import("@futureclick/shared").IsoTimestamp)
      : currentIsoTimestamp();

  const environmentId = generateEntityId("env");
  const environment: EnvironmentDescriptor = {
    environmentId,
    kind: "browser",
    platform: "web",
    application: {
      id: FC007_APPLICATION_ID,
      name: FC007_APPLICATION_NAME,
      // version intentionally absent
    },
  };

  const provenance: ProvenanceDescriptor = {
    source: "adapter",
    timestamp: observedAt,
    details: {
      adapterId: FC007_ADAPTER_ID,
      adapterVersion: FC007_ADAPTER_VERSION,
      synthetic: false,
      evidenceBasis: FC007_EVIDENCE_BASIS,
    },
  };

  const entity = createCanonicalEntity({
    kind: "repository",
    label: `${observation.ownerDisplay}/${observation.repoDisplay}`,
  });

  const fact = createStateFact({
    subjectEntityId: entity.id,
    key: "repository.visibility",
    value: "private",
    observedAt,
  });

  const state = createStateSnapshot({
    observedAt,
    environment,
    entities: [entity],
    facts: [fact],
    provenance,
  });

  const action = createProposedAction({
    proposedAt: observedAt,
    environment,
    actor: { kind: "human" },
    intent: {
      verb: "change-access",
      domain: "version_control",
    },
    targets: [{ entityId: entity.id, role: "primary" }],
    parameters: { newVisibility: "public" },
    executionStatus: "proposed",
    provenance,
  });

  let context: ActionEvaluationContext;
  try {
    context = createActionEvaluationContext({
      state,
      action,
      createdAt: observedAt,
    });
  } catch (e) {
    return {
      status: "invalid",
      reason: e instanceof Error ? e.message : "CONTEXT_CREATE_FAILED",
    };
  }

  const revalidate = validateActionEvaluationContext(context);
  if (!revalidate.valid) {
    return { status: "invalid", reason: "CONTEXT_VALIDATION_FAILED" };
  }

  return { status: "ok", context: revalidate.value };
}

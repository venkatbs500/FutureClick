/**
 * Built-in Rule: Repository Visibility Change (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Pure deterministic derivation based on verified canonical pre-state and explicit
 * requested parameters. Does NOT claim or interact with live GitHub, GitLab, or remote APIs.
 */

import { type EntityId, type StateChange, createConfidenceScore } from "@futureclick/action-schema";
import { findNodeBySubject, getOutgoingEdges } from "@futureclick/action-graph";
import { resolveUniqueFact, resolveUniqueTargetByRole } from "../helpers.js";
import type {
  ConsequenceDraft,
  DeterministicRule,
  DeterministicRuleInput,
  EvidenceDraft,
  RuleDecision,
  RuleId,
  RuleVersion,
} from "../types.js";

export const REPOSITORY_VISIBILITY_RULE_ID = "version_control.repository.visibility" as RuleId;
export const REPOSITORY_VISIBILITY_RULE_VERSION = "1.0" as RuleVersion;

export const repositoryVisibilityRule: DeterministicRule = Object.freeze({
  id: REPOSITORY_VISIBILITY_RULE_ID,
  version: REPOSITORY_VISIBILITY_RULE_VERSION,
  description:
    "Derives deterministic repository visibility transitions and security/privacy consequences for private-to-public changes.",

  evaluate(input: DeterministicRuleInput): RuleDecision {
    const { context, graph } = input;
    const { action, state } = context;

    // 1. Check verb & domain
    const isApplicableVerb =
      action.intent.verb === "change-access" || action.intent.verb === "update";
    if (!isApplicableVerb) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_VERB" };
    }

    const isApplicableDomain =
      action.intent.domain === "version_control" || action.intent.domain === "repository";
    if (!isApplicableDomain) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_DOMAIN" };
    }

    // 2. Resolve primary target with strict singular cardinality (Finding H2)
    const targetRes = resolveUniqueTargetByRole(action, "primary");
    if (targetRes.status === "missing") {
      return { status: "not-applicable", reasonCode: "NO_PRIMARY_TARGET" };
    }
    if (targetRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MULTIPLE_PRIMARY_TARGETS",
        missing: ["action.target.primary"],
      };
    }

    const primaryTarget = targetRes.target;
    const entityId = primaryTarget.entityId;

    // Verify ActionGraph correspondence
    const actionNode = findNodeBySubject(graph, {
      kind: "proposed-action",
      actionId: action.id,
    });
    if (!actionNode) {
      return { status: "not-applicable", reasonCode: "ACTION_NODE_NOT_FOUND" };
    }

    const outgoing = getOutgoingEdges(graph, actionNode.id);
    const hasGraphEdge = outgoing.some(
      (e) =>
        e.relation === "action-targets-entity" &&
        e.targetRole === "primary" &&
        graph.nodes.some(
          (n) =>
            n.id === e.targetNodeId &&
            n.subject &&
            (n.subject as { entityId?: EntityId }).entityId === entityId,
        ),
    );

    if (!hasGraphEdge) {
      return { status: "not-applicable", reasonCode: "TARGET_EDGE_NOT_FOUND" };
    }

    // 3. Inspect target entity metadata (Section 11)
    const entity = state.entities.find((e) => e.id === entityId);
    if (!entity) {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_TARGET_ENTITY_METADATA",
        missing: ["entity.metadata"],
      };
    }

    if (entity.kind !== "repository") {
      return { status: "not-applicable", reasonCode: "PRIMARY_TARGET_NOT_A_REPOSITORY" };
    }

    // 4. Check action parameter for newVisibility
    const params = action.parameters;
    const hasNewVisibility = Object.prototype.hasOwnProperty.call(params, "newVisibility");
    if (!hasNewVisibility || typeof params.newVisibility !== "string") {
      // Unrelated repository update vs access action (Finding Section 18)
      if (action.intent.verb === "update") {
        return { status: "not-applicable", reasonCode: "UNRELATED_REPOSITORY_UPDATE" };
      }
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_VISIBILITY_PARAMETER",
        missing: ["action.parameters.new_visibility"],
      };
    }

    const newVisibility = params.newVisibility;

    // 5. Resolve current visibility fact with strict uniqueness (Finding H1)
    const factRes = resolveUniqueFact({
      context,
      subjectEntityId: entityId,
      property: "repository.visibility",
    });

    if (factRes.status === "missing") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_VISIBILITY_FACT",
        missing: ["repository.visibility"],
      };
    }
    if (factRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "AMBIGUOUS_STATE_FACT",
        missing: ["state.fact.unique"],
      };
    }

    const currentVisibility = factRes.fact.value;

    // Specifically model the private -> public transition
    if (currentVisibility !== "private" || newVisibility !== "public") {
      return {
        status: "not-applicable",
        reasonCode: "UNMATCHED_VISIBILITY_TRANSITION",
      };
    }

    const stateChange: StateChange = {
      entityId,
      property: "repository.visibility",
      operation: "replace",
      before: { status: "known", value: "private" },
      after: { status: "known", value: "public" },
    };

    const evidenceDraft: EvidenceDraft = {
      scope:
        "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared repository visibility change action executes successfully according to the modeled platform semantics without platform rejection.",
      assumptions: [
        {
          id: "asm.vcs.visibility.1",
          statement:
            "The remote version control platform processes the visibility change successfully under modeled semantics.",
          status: "assumed",
        },
        {
          id: "asm.vcs.visibility.2",
          statement: "Organization policy allows repository visibility transition to public.",
          status: "assumed",
        },
      ],
      summary:
        "Deterministic derivation of repository private-to-public visibility transition and associated data exposure risk.",
    };

    const draft: ConsequenceDraft = {
      kind: "security",
      summary: `Repository "${entity.label ?? entityId}" visibility will change from private to public.`,
      affectedEntities: [entityId],
      stateChanges: [stateChange],
      evidence: [evidenceDraft],
      confidence: createConfidenceScore(1.0),
      reversibility: {
        level: "partially_reversible",
        method: "Change repository visibility back to private",
        requirements: [
          "Public visibility can be revoked, but code and commits viewed or cloned while public cannot be retracted.",
        ],
      },
      risk: {
        severity: "high",
        categories: ["security", "privacy"],
        description:
          "Making repository public exposes proprietary source code, history, and metadata to public access.",
      },
    };

    return {
      status: "matched",
      drafts: [draft],
    };
  },
});

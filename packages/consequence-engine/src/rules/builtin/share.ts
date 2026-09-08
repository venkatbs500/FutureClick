/**
 * Built-in Rule: Document Access Grant / Sharing (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Pure deterministic derivation based on verified canonical pre-state and explicit
 * requested targets. Does NOT claim or interact with live Google Docs, Notion, or remote APIs.
 */

import { type EntityId, type StateChange, createConfidenceScore } from "@futureclick/action-schema";
import { findNodeBySubject, getOutgoingEdges } from "@futureclick/action-graph";
import {
  resolveUniqueFact,
  resolveUniqueTargetByRole,
  validateSharedWithArray,
} from "../helpers.js";
import type {
  ConsequenceDraft,
  DeterministicRule,
  DeterministicRuleInput,
  EvidenceDraft,
  RuleDecision,
  RuleId,
  RuleVersion,
} from "../types.js";

export const DOCUMENT_SHARE_RULE_ID = "collaboration.document.share" as RuleId;
export const DOCUMENT_SHARE_RULE_VERSION = "1.0" as RuleVersion;

export const documentShareRule: DeterministicRule = Object.freeze({
  id: DOCUMENT_SHARE_RULE_ID,
  version: DOCUMENT_SHARE_RULE_VERSION,
  description:
    "Derives deterministic document access grant and sharing consequences for primary documents and designated recipients.",

  evaluate(input: DeterministicRuleInput): RuleDecision {
    const { context, graph } = input;
    const { action, state } = context;

    // 1. Check verb & domain
    const isApplicableVerb = action.intent.verb === "share" || action.intent.verb === "grant";
    if (!isApplicableVerb) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_VERB" };
    }

    const isApplicableDomain =
      action.intent.domain === "collaboration" || action.intent.domain === "document";
    if (!isApplicableDomain) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_DOMAIN" };
    }

    // 2. Resolve primary document target with strict singular cardinality (Finding H2)
    const primaryRes = resolveUniqueTargetByRole(action, "primary");
    if (primaryRes.status === "missing") {
      return { status: "not-applicable", reasonCode: "NO_PRIMARY_TARGET" };
    }
    if (primaryRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MULTIPLE_PRIMARY_TARGETS",
        missing: ["action.target.primary"],
      };
    }

    const docEntityId = primaryRes.target.entityId;

    // Resolve recipient target with strict singular cardinality (Finding H2)
    const recipientRes = resolveUniqueTargetByRole(action, "recipient");
    if (recipientRes.status === "missing") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_RECIPIENT_TARGET",
        missing: ["action.target.recipient"],
      };
    }
    if (recipientRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MULTIPLE_RECIPIENT_TARGETS",
        missing: ["action.target.recipient"],
      };
    }

    const recipientEntityId = recipientRes.target.entityId;

    // Verify ActionGraph correspondence
    const actionNode = findNodeBySubject(graph, {
      kind: "proposed-action",
      actionId: action.id,
    });
    if (!actionNode) {
      return { status: "not-applicable", reasonCode: "ACTION_NODE_NOT_FOUND" };
    }

    const outgoing = getOutgoingEdges(graph, actionNode.id);
    const hasPrimaryEdge = outgoing.some(
      (e) =>
        e.relation === "action-targets-entity" &&
        e.targetRole === "primary" &&
        graph.nodes.some(
          (n) =>
            n.id === e.targetNodeId &&
            n.subject &&
            (n.subject as { entityId?: EntityId }).entityId === docEntityId,
        ),
    );
    const hasRecipientEdge = outgoing.some(
      (e) =>
        e.relation === "action-targets-entity" &&
        e.targetRole === "recipient" &&
        graph.nodes.some(
          (n) =>
            n.id === e.targetNodeId &&
            n.subject &&
            (n.subject as { entityId?: EntityId }).entityId === recipientEntityId,
        ),
    );

    if (!hasPrimaryEdge || !hasRecipientEdge) {
      return { status: "not-applicable", reasonCode: "TARGET_EDGE_NOT_FOUND" };
    }

    // 3. Inspect target entity metadata for document (Section 11)
    const docEntity = state.entities.find((e) => e.id === docEntityId);
    if (!docEntity) {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_TARGET_ENTITY_METADATA",
        missing: ["entity.metadata"],
      };
    }

    if (docEntity.kind !== "document") {
      return { status: "not-applicable", reasonCode: "PRIMARY_TARGET_NOT_A_DOCUMENT" };
    }

    // Recipient does NOT need CanonicalEntity metadata if only EntityId is used (Section 11)

    // 4. Resolve sharing precondition fact on document (Findings H1 & H5)
    const factRes = resolveUniqueFact({
      context,
      subjectEntityId: docEntityId,
      property: "document.shared_with",
    });

    if (factRes.status === "missing") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_SHARING_PRECONDITION",
        missing: ["document.shared_with"],
      };
    }
    if (factRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "AMBIGUOUS_STATE_FACT",
        missing: ["state.fact.unique"],
      };
    }

    // Validate semantic state shape of shared_with (Finding H5)
    const validSharedRes = validateSharedWithArray(factRes.fact.value);
    if (!validSharedRes.valid) {
      return {
        status: "insufficient-evidence",
        reasonCode: "MALFORMED_SHARED_WITH",
        missing: ["document.shared_with"],
      };
    }

    const currentList = validSharedRes.recipients;
    if (currentList.includes(recipientEntityId)) {
      return {
        status: "not-applicable",
        reasonCode: "ALREADY_SHARED",
      };
    }

    const updatedList = [...currentList, recipientEntityId];

    const stateChange: StateChange = {
      entityId: docEntityId,
      property: "document.shared_with",
      operation: "replace",
      before: { status: "known", value: [...currentList] },
      after: { status: "known", value: updatedList },
    };

    const evidenceDraft: EvidenceDraft = {
      scope:
        "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared document sharing action executes successfully according to the modeled collaboration semantics without platform rejection.",
      assumptions: [
        {
          id: "asm.share.1",
          statement: "The collaboration service grants access without policy or quota violations.",
          status: "assumed",
        },
        {
          id: "asm.share.2",
          statement: "The recipient identifier is valid and active on the platform.",
          status: "assumed",
        },
      ],
      summary:
        "Deterministic derivation based on verified document sharing list and explicit recipient role target.",
    };

    const draft: ConsequenceDraft = {
      kind: "privacy",
      summary: `Document "${docEntity.label ?? docEntityId}" shared with recipient "${recipientEntityId}".`,
      affectedEntities: [docEntityId, recipientEntityId],
      stateChanges: [stateChange],
      evidence: [evidenceDraft],
      confidence: createConfidenceScore(1.0),
      reversibility: {
        level: "reversible",
        method: "Revoke recipient document access from document sharing settings",
        timeWindow: "anytime",
      },
      risk: {
        severity: "low",
        categories: ["privacy"],
        description: "Recipient is granted access to view and collaborate on document.",
      },
    };

    return {
      status: "matched",
      drafts: [draft],
    };
  },
});

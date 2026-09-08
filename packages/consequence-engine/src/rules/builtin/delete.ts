/**
 * Built-in Rule: Filesystem File Delete (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Pure deterministic derivation based on verified canonical facts and explicit
 * requested parameters. Does NOT claim or interact with live operating systems.
 */

import { type EntityId, type StateChange, createConfidenceScore } from "@futureclick/action-schema";
import { findNodeBySubject, getOutgoingEdges } from "@futureclick/action-graph";
import {
  readExplicitBooleanParameter,
  resolveUniqueFact,
  resolveUniqueTargetByRole,
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

export const FILE_DELETE_RULE_ID = "filesystem.delete.file" as RuleId;
export const FILE_DELETE_RULE_VERSION = "1.0" as RuleVersion;

export const fileDeleteRule: DeterministicRule = Object.freeze({
  id: FILE_DELETE_RULE_ID,
  version: FILE_DELETE_RULE_VERSION,
  description:
    "Derives deterministic file deletion consequences and state transitions for files moving to trash or being permanently deleted.",

  evaluate(input: DeterministicRuleInput): RuleDecision {
    const { context, graph } = input;
    const { action, state } = context;

    // 1. Check verb & domain
    if (action.intent.verb !== "delete") {
      return { status: "not-applicable", reasonCode: "UNMATCHED_VERB" };
    }
    if (action.intent.domain !== "filesystem") {
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
      // Graph reference exists but CanonicalEntity metadata is missing
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_TARGET_ENTITY_METADATA",
        missing: ["entity.metadata"],
      };
    }

    if (entity.kind !== "file") {
      return { status: "not-applicable", reasonCode: "PRIMARY_TARGET_NOT_A_FILE" };
    }

    // 4. Resolve existence fact with strict uniqueness (Finding H1)
    const factRes = resolveUniqueFact({
      context,
      subjectEntityId: entityId,
      property: "filesystem.exists",
    });

    if (factRes.status === "missing") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_FILE_EXISTENCE",
        missing: ["filesystem.exists"],
      };
    }
    if (factRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "AMBIGUOUS_STATE_FACT",
        missing: ["state.fact.unique"],
      };
    }

    if (factRes.fact.value !== true) {
      return {
        status: "insufficient-evidence",
        reasonCode: "FILE_DOES_NOT_EXIST",
        missing: ["filesystem.exists"],
      };
    }

    // 5. Check action parameters for permanence / trash semantics (Finding H4)
    const trashRes = readExplicitBooleanParameter(action.parameters, "moveToTrash");
    const permRes = readExplicitBooleanParameter(action.parameters, "permanent");

    if (trashRes.status === "absent" || permRes.status === "absent") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_DELETE_PARAMETERS",
        missing: ["action.parameters.move_to_trash", "action.parameters.permanent"],
      };
    }

    if (trashRes.status === "invalid_type" || permRes.status === "invalid_type") {
      return {
        status: "insufficient-evidence",
        reasonCode: "INVALID_DELETE_PARAMETERS",
        missing: ["action.parameters.move_to_trash", "action.parameters.permanent"],
      };
    }

    const moveToTrash = trashRes.value;
    const permanent = permRes.value;

    // Supported combinations: true/false (trash) or false/true (permanent)
    if (moveToTrash === true && permanent === true) {
      return {
        status: "insufficient-evidence",
        reasonCode: "CONTRADICTORY_DELETE_PARAMETERS",
        missing: ["action.parameters.move_to_trash", "action.parameters.permanent"],
      };
    }
    if (moveToTrash === false && permanent === false) {
      return {
        status: "insufficient-evidence",
        reasonCode: "CONTRADICTORY_DELETE_PARAMETERS",
        missing: ["action.parameters.move_to_trash", "action.parameters.permanent"],
      };
    }

    const isReversible = moveToTrash && !permanent;

    const stateChange: StateChange = {
      entityId,
      property: "filesystem.exists",
      operation: "replace",
      before: { status: "known", value: true },
      after: { status: "known", value: false },
    };

    const evidenceDraft: EvidenceDraft = {
      scope: isReversible
        ? "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared file deletion to trash executes successfully according to modeled filesystem trash semantics without filesystem errors."
        : "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared permanent file deletion executes successfully according to modeled filesystem deletion semantics without filesystem errors.",
      assumptions: [
        {
          id: "asm.fs.delete.1",
          statement:
            "The filesystem driver executes the delete operation successfully under modeled semantics.",
          status: "assumed",
        },
        {
          id: "asm.fs.delete.2",
          statement: "The target file is not locked or open by an exclusive process.",
          status: "assumed",
        },
      ],
      summary: isReversible
        ? "Deterministic derivation of file move-to-trash transition and reversible risk."
        : "Deterministic derivation of permanent file deletion transition and irreversible risk.",
    };

    const draft: ConsequenceDraft = {
      kind: "data-loss",
      summary: isReversible
        ? `File "${entity.label ?? entityId}" will be moved to trash.`
        : `File "${entity.label ?? entityId}" will be permanently deleted.`,
      affectedEntities: [entityId],
      stateChanges: [stateChange],
      evidence: [evidenceDraft],
      confidence: createConfidenceScore(1.0),
      reversibility: isReversible
        ? {
            level: "reversible",
            method: "Restore from trash",
            timeWindow: "until trash is emptied",
            requirements: ["file must remain in trash"],
          }
        : {
            level: "irreversible",
          },
      risk: isReversible
        ? {
            severity: "low",
            categories: ["data-loss"],
            description: "File is moved to trash and can be restored before trash is emptied.",
          }
        : {
            severity: "medium",
            categories: ["data-loss"],
            description: "File is permanently deleted under ordinary application semantics.",
          },
    };

    return {
      status: "matched",
      drafts: [draft],
    };
  },
});

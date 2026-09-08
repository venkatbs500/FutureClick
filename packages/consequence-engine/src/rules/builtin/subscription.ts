/**
 * Built-in Rule: Subscription Activation (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Pure deterministic derivation based on verified canonical pre-state and explicit
 * requested parameters. Does NOT claim or interact with live Stripe, payment gateways, or banks.
 */

import { type EntityId, type StateChange, createConfidenceScore } from "@futureclick/action-schema";
import { findNodeBySubject, getOutgoingEdges } from "@futureclick/action-graph";
import {
  isSupportedBillingInterval,
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

export const SUBSCRIPTION_ACTIVATE_RULE_ID = "billing.subscription.activate" as RuleId;
export const SUBSCRIPTION_ACTIVATE_RULE_VERSION = "1.0" as RuleVersion;

export const subscriptionActivationRule: DeterministicRule = Object.freeze({
  id: SUBSCRIPTION_ACTIVATE_RULE_ID,
  version: SUBSCRIPTION_ACTIVATE_RULE_VERSION,
  description:
    "Derives deterministic subscription activation consequences and recurring billing obligations for inactive subscriptions.",

  evaluate(input: DeterministicRuleInput): RuleDecision {
    const { context, graph } = input;
    const { action, state } = context;

    // 1. Check verb & domain
    const isApplicableVerb =
      action.intent.verb === "subscribe" ||
      action.intent.verb === "purchase" ||
      action.intent.verb === "create";
    if (!isApplicableVerb) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_VERB" };
    }

    const isApplicableDomain =
      action.intent.domain === "billing" || action.intent.domain === "subscription";
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

    const entityId = targetRes.target.entityId;

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

    if (entity.kind !== "subscription") {
      return { status: "not-applicable", reasonCode: "PRIMARY_TARGET_NOT_A_SUBSCRIPTION" };
    }

    // 4. Resolve current subscription status fact with strict uniqueness (Finding H1)
    const factRes = resolveUniqueFact({
      context,
      subjectEntityId: entityId,
      property: "subscription.status",
    });

    if (factRes.status === "missing") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_SUBSCRIPTION_STATUS",
        missing: ["subscription.status"],
      };
    }
    if (factRes.status === "ambiguous") {
      return {
        status: "insufficient-evidence",
        reasonCode: "AMBIGUOUS_STATE_FACT",
        missing: ["state.fact.unique"],
      };
    }

    if (factRes.fact.value !== "inactive") {
      return {
        status: "not-applicable",
        reasonCode: "SUBSCRIPTION_NOT_INACTIVE",
      };
    }

    // 5. Check recurrence parameters (Finding H3: no invented recurrence)
    const autoRenewRes = readExplicitBooleanParameter(action.parameters, "autoRenew");
    if (autoRenewRes.status === "absent") {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_RECURRENCE_PARAMETERS",
        missing: ["action.parameters.auto_renew"],
      };
    }
    if (autoRenewRes.status === "invalid_type") {
      return {
        status: "insufficient-evidence",
        reasonCode: "INVALID_RECURRENCE_PARAMETERS",
        missing: ["action.parameters.auto_renew"],
      };
    }

    // If autoRenew is false, this recurring subscription rule does not apply
    if (autoRenewRes.value === false) {
      return {
        status: "not-applicable",
        reasonCode: "NON_RECURRING_SUBSCRIPTION",
      };
    }

    const params = action.parameters;
    const hasInterval = Object.prototype.hasOwnProperty.call(params, "billingInterval");
    if (!hasInterval || params.billingInterval === undefined) {
      return {
        status: "insufficient-evidence",
        reasonCode: "MISSING_RECURRENCE_PARAMETERS",
        missing: ["action.parameters.billing_interval"],
      };
    }

    if (typeof params.billingInterval !== "string" || params.billingInterval.trim().length === 0) {
      return {
        status: "insufficient-evidence",
        reasonCode: "INVALID_RECURRENCE_PARAMETERS",
        missing: ["action.parameters.billing_interval"],
      };
    }

    const billingInterval = params.billingInterval.trim();
    if (!isSupportedBillingInterval(billingInterval)) {
      return {
        status: "insufficient-evidence",
        reasonCode: "UNSUPPORTED_BILLING_INTERVAL",
        missing: ["action.parameters.billing_interval"],
      };
    }

    const stateChange: StateChange = {
      entityId,
      property: "subscription.status",
      operation: "replace",
      before: { status: "known", value: "inactive" },
      after: { status: "known", value: "active" },
    };

    const evidenceDraft: EvidenceDraft = {
      scope:
        "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared subscription activation executes successfully according to the modeled billing platform semantics without payment rejection.",
      assumptions: [
        {
          id: "asm.sub.1",
          statement:
            "The billing platform processes subscription activation without payment gateway rejection.",
          status: "assumed",
        },
        {
          id: "asm.sub.2",
          statement:
            "The requested subscription tier and pricing terms remain valid at activation time.",
          status: "assumed",
        },
      ],
      summary:
        "Deterministic derivation based on verified inactive subscription status and explicit activation parameters.",
      details: {
        billingInterval,
      },
    };

    // Do NOT invent price/currency when absent from action parameters (Finding Section 27)
    const priceText =
      typeof params.price === "number" || typeof params.price === "string"
        ? ` at ${params.price}`
        : "";

    const draft: ConsequenceDraft = {
      kind: "financial",
      summary: `Subscription "${entity.label ?? entityId}" activated with ${billingInterval} recurring billing obligation${priceText}.`,
      affectedEntities: [entityId],
      stateChanges: [stateChange],
      evidence: [evidenceDraft],
      confidence: createConfidenceScore(1.0),
      reversibility: {
        level: "reversible",
        method: "Cancel subscription via account billing settings before next renewal",
        timeWindow: "until next billing renewal",
      },
      risk: {
        severity: "low",
        categories: ["financial"],
        description: "Activating subscription incurs recurring billing obligations.",
      },
      temporal: {
        timing: "immediate",
        frequency: "recurring",
      },
    };

    return {
      status: "matched",
      drafts: [draft],
    };
  },
});

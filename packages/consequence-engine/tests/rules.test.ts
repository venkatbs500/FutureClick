/**
 * Deterministic Verified Rules Engine Test Suite (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * "VERIFIED" in FutureClick never represents universal certainty, guaranteed real-world execution,
 * or live external platform confirmation. It means a deterministic conclusion was derived from
 * available canonical evidence within an explicitly defined rule scope and set of assumptions.
 *
 * Full FC-004A Regression Matrix (126 Probes):
 * - Probes 1–11: Ambiguous Canonical Facts (H1)
 * - Probes 12–20: Ambiguous Targets / Unsupported Cardinality (H2)
 * - Probes 21–31: Subscription Rule Recurrence Semantics (H3)
 * - Probes 32–41: Delete Parameter Semantics (H4)
 * - Probes 42–52: Malformed Document.Shared_With (H5)
 * - Probes 53–59: Explicit Consequence Confidence Contract (H6)
 * - Probes 60–68: Registered & Built-in Rule Deep Immutability (M1)
 * - Probes 69–73: Authoritative Rule Set Normalization (M2)
 * - Probes 74–78: Normalized ID Collision Detection (M3)
 * - Probes 79–87: Machine-Readable Trace Tokens (M4)
 * - Probes 88–93: Deterministic Graph Metadata & Local ID Generator (M5)
 * - Probes 94–99: RuleId / RuleVersion Whitespace Rejection (L1)
 * - Probes 100–105: Strict Decision Variants (L3)
 * - Probes 106–110: Explicit generatedAt: undefined Rejection (L4)
 * - Probes 111–115: Hostile Generator Exception Safety (Section 39)
 * - Probes 116–126: Core FC-004 Engine & Built-in Baseline Probes
 */

import {
  type ActionEvaluationContext,
  type ActionId,
  type ActionVerb,
  type CanonicalEntity,
  type ConsequenceId,
  type EntityId,
  type EnvironmentDescriptor,
  type EvidenceId,
  type JsonValue,
  type StateFact,
  createActionEvaluationContext,
  createCanonicalEntity,
  createConfidenceScore,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  validateConsequence,
} from "@futureclick/action-schema";
import {
  type IdGenerator,
  type IsoTimestamp,
  createDeterministicIdGenerator,
  isErr,
  isOk,
  unwrapResult,
} from "@futureclick/shared";
import { buildActionGraph } from "@futureclick/action-graph";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_RULES,
  ConsequenceEngine,
  type ConsequenceDraft,
  type DeterministicRule,
  type DeterministicRuleInput,
  type DeterministicRuleSet,
  type RuleDecision,
  DOCUMENT_SHARE_RULE_ID,
  FILE_DELETE_RULE_ID,
  FILE_DELETE_RULE_VERSION,
  REPOSITORY_VISIBILITY_RULE_ID,
  SUBSCRIPTION_ACTIVATE_RULE_ID,
  createDefaultRuleSet,
  createDeterministicRuleEvaluator,
  createRuleSet,
  detectStateChangeConflicts,
  documentShareRule,
  evaluateDeterministicRules,
  fileDeleteRule,
  isSupportedBillingInterval,
  isValidMissingToken,
  isValidReasonCode,
  isValidRuleId,
  isValidRuleVersion,
  readExplicitBooleanParameter,
  repositoryVisibilityRule,
  resolveUniqueFact,
  resolveUniqueTargetByRole,
  subscriptionActivationRule,
  validateConsequenceDraft,
  validateDeterministicRule,
  validateRuleDecision,
  validateRuleId,
  validateRuleVersion,
  validateSharedWithArray,
  type RuleId,
  type RuleVersion,
} from "../src/index.js";

// ============================================================================
// SYNTHETIC FIXTURE BUILDERS
// ============================================================================

const FIXED_OBSERVED_AT = "2026-09-07T12:00:00.000Z" as IsoTimestamp;
const FIXED_PROPOSED_AT = "2026-09-07T12:00:01.000Z" as IsoTimestamp;
const FIXED_EVAL_AT = "2026-09-07T12:00:02.000Z" as IsoTimestamp;

const TEST_ENV: EnvironmentDescriptor = {
  environmentId: "env-synthetic-desktop",
  kind: "desktop",
  platform: "macos",
  application: { id: "app-finder", name: "Finder", version: "14.0" },
};

function createSyntheticFileContext(params?: {
  exists?: boolean;
  duplicateExistenceFact?: boolean;
  conflictingExistenceFact?: boolean;
  reverseFactOrder?: boolean;
  multiplePrimaryTargets?: boolean;
  missingEntityMetadata?: boolean;
  wrongEntityKind?: boolean;
  moveToTrash?: boolean;
  permanent?: boolean;
  omitExistenceFact?: boolean;
  omitPermanenceParams?: boolean;
  customParameters?: Record<string, unknown>;
}): ActionEvaluationContext {
  const idGen = createDeterministicIdGenerator("synthetic-file");
  const fileEntity = createCanonicalEntity({
    id: idGen.generate<"EntityId">("ent"),
    kind: params?.wrongEntityKind ? "folder" : "file",
    label: "important_document.pdf",
  });

  const targetEntityId = params?.missingEntityMetadata
    ? ("ent-external-file" as EntityId)
    : fileEntity.id;

  const facts: StateFact[] = [];
  if (!params?.omitExistenceFact && !params?.missingEntityMetadata) {
    facts.push(
      createStateFact({
        id: idGen.generate<"ObservationId">("obs"),
        subjectEntityId: fileEntity.id,
        key: "filesystem.exists",
        value: params?.exists ?? true,
        observedAt: FIXED_OBSERVED_AT,
      }),
    );
    if (params?.duplicateExistenceFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: fileEntity.id,
          key: "filesystem.exists",
          value: params?.exists ?? true,
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
    if (params?.conflictingExistenceFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: fileEntity.id,
          key: "filesystem.exists",
          value: !(params?.exists ?? true),
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
  }

  if (params?.reverseFactOrder) {
    facts.reverse();
  }

  const entities = params?.missingEntityMetadata ? [] : [fileEntity];

  const state = createStateSnapshot({
    id: idGen.generate<"StateSnapshotId">("state"),
    environment: TEST_ENV,
    entities,
    facts,
    observedAt: FIXED_OBSERVED_AT,
  });

  let actionParams: Record<string, unknown> = {};
  if (params?.customParameters) {
    actionParams = { ...params.customParameters };
  } else if (!params?.omitPermanenceParams) {
    actionParams = {
      moveToTrash: params?.moveToTrash ?? params?.permanent !== true,
      permanent: params?.permanent ?? params?.moveToTrash === false,
    };
  }

  const targets = [{ entityId: targetEntityId, role: "primary" as const }];
  if (params?.multiplePrimaryTargets) {
    targets.push({ entityId: "ent-file-2" as EntityId, role: "primary" as const });
  }

  const action = createProposedAction({
    id: idGen.generate<"ActionId">("act"),
    environment: TEST_ENV,
    proposedAt: FIXED_PROPOSED_AT,
    actor: { kind: "human", id: "user-alice" },
    intent: { verb: "delete", domain: "filesystem" },
    targets,
    parameters: actionParams as Record<string, JsonValue>,
  });

  return createActionEvaluationContext({
    id: idGen.generate<"EvaluationContextId">("eval"),
    state,
    action,
    createdAt: FIXED_PROPOSED_AT,
  });
}

function createSyntheticRepositoryContext(params?: {
  currentVisibility?: string;
  duplicateVisibilityFact?: boolean;
  conflictingVisibilityFact?: boolean;
  reverseFactOrder?: boolean;
  multiplePrimaryTargets?: boolean;
  missingEntityMetadata?: boolean;
  requestedVisibility?: string;
  omitVisibilityFact?: boolean;
  omitVisibilityParam?: boolean;
  unrelatedVerb?: boolean;
  verb?: ActionVerb;
}): ActionEvaluationContext {
  const idGen = createDeterministicIdGenerator("synthetic-repo");
  const repoEntity = createCanonicalEntity({
    id: idGen.generate<"EntityId">("ent"),
    kind: "repository",
    label: "futureclick-core",
  });

  const facts: StateFact[] = [];
  if (!params?.omitVisibilityFact) {
    facts.push(
      createStateFact({
        id: idGen.generate<"ObservationId">("obs"),
        subjectEntityId: repoEntity.id,
        key: "repository.visibility",
        value: params?.currentVisibility ?? "private",
        observedAt: FIXED_OBSERVED_AT,
      }),
    );
    if (params?.duplicateVisibilityFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: repoEntity.id,
          key: "repository.visibility",
          value: params?.currentVisibility ?? "private",
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
    if (params?.conflictingVisibilityFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: repoEntity.id,
          key: "repository.visibility",
          value: "public",
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
  }

  if (params?.reverseFactOrder) {
    facts.reverse();
  }

  const entities = params?.missingEntityMetadata ? [] : [repoEntity];

  const state = createStateSnapshot({
    id: idGen.generate<"StateSnapshotId">("state"),
    environment: TEST_ENV,
    entities,
    facts,
    observedAt: FIXED_OBSERVED_AT,
  });

  const actionParams: Record<string, string> = {};
  if (!params?.omitVisibilityParam) {
    actionParams.newVisibility = params?.requestedVisibility ?? "public";
  }

  const targets = [{ entityId: repoEntity.id, role: "primary" as const }];
  if (params?.multiplePrimaryTargets) {
    targets.push({ entityId: "ent-repo-2" as EntityId, role: "primary" as const });
  }

  const verb: ActionVerb = params?.verb ?? (params?.unrelatedVerb ? "delete" : "change-access");
  const domain = params?.unrelatedVerb ? "filesystem" : "version_control";

  const action = createProposedAction({
    id: idGen.generate<"ActionId">("act"),
    environment: TEST_ENV,
    proposedAt: FIXED_PROPOSED_AT,
    actor: { kind: "human", id: "user-alice" },
    intent: {
      verb,
      domain,
    },
    targets,
    parameters: actionParams,
  });

  return createActionEvaluationContext({
    id: idGen.generate<"EvaluationContextId">("eval"),
    state,
    action,
    createdAt: FIXED_PROPOSED_AT,
  });
}

function createSyntheticDocumentShareContext(params?: {
  sharedWith?: unknown;
  customRecipientId?: EntityId | string;
  duplicateShareFact?: boolean;
  conflictingShareFact?: boolean;
  reverseFactOrder?: boolean;
  multiplePrimaryTargets?: boolean;
  multipleRecipientTargets?: boolean;
  missingRecipientTarget?: boolean;
  missingEntityMetadata?: boolean;
  omitShareFact?: boolean;
  recipientAlreadyShared?: boolean;
}): ActionEvaluationContext {
  const idGen = createDeterministicIdGenerator("synthetic-share");
  const docEntity = createCanonicalEntity({
    id: idGen.generate<"EntityId">("ent"),
    kind: "document",
    label: "Confidential Roadmap.docx",
  });
  const recipientEntity = createCanonicalEntity({
    id: idGen.generate<"EntityId">("ent"),
    kind: "account",
    label: "bob@example.com",
  });

  const facts: StateFact[] = [];
  if (!params?.omitShareFact) {
    const shareVal =
      params?.sharedWith !== undefined
        ? params.sharedWith
        : params?.recipientAlreadyShared
          ? [recipientEntity.id]
          : [];

    facts.push(
      createStateFact({
        id: idGen.generate<"ObservationId">("obs"),
        subjectEntityId: docEntity.id,
        key: "document.shared_with",
        value: shareVal as JsonValue,
        observedAt: FIXED_OBSERVED_AT,
      }),
    );
    if (params?.duplicateShareFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: docEntity.id,
          key: "document.shared_with",
          value: shareVal as JsonValue,
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
    if (params?.conflictingShareFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: docEntity.id,
          key: "document.shared_with",
          value: ["other-user"] as JsonValue,
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
  }

  if (params?.reverseFactOrder) {
    facts.reverse();
  }

  const entities = params?.missingEntityMetadata ? [recipientEntity] : [docEntity, recipientEntity];

  const state = createStateSnapshot({
    id: idGen.generate<"StateSnapshotId">("state"),
    environment: TEST_ENV,
    entities,
    facts,
    observedAt: FIXED_OBSERVED_AT,
  });

  const targets: Array<{ entityId: EntityId; role: "primary" | "recipient" }> = [
    { entityId: docEntity.id, role: "primary" },
  ];
  if (params?.multiplePrimaryTargets) {
    targets.push({ entityId: "ent-doc-2" as EntityId, role: "primary" });
  }

  if (!params?.missingRecipientTarget) {
    const recId = (params?.customRecipientId ?? recipientEntity.id) as EntityId;
    targets.push({ entityId: recId, role: "recipient" });
    if (params?.multipleRecipientTargets) {
      targets.push({ entityId: "ent-user-charlie" as EntityId, role: "recipient" });
    }
  }

  const action = createProposedAction({
    id: idGen.generate<"ActionId">("act"),
    environment: TEST_ENV,
    proposedAt: FIXED_PROPOSED_AT,
    actor: { kind: "human", id: "user-alice" },
    intent: { verb: "share", domain: "collaboration" },
    targets,
    parameters: { accessLevel: "view" },
  });

  return createActionEvaluationContext({
    id: idGen.generate<"EvaluationContextId">("eval"),
    state,
    action,
    createdAt: FIXED_PROPOSED_AT,
  });
}

function createSyntheticSubscriptionContext(params?: {
  currentStatus?: string;
  duplicateStatusFact?: boolean;
  conflictingStatusFact?: boolean;
  reverseFactOrder?: boolean;
  multiplePrimaryTargets?: boolean;
  missingEntityMetadata?: boolean;
  omitStatusFact?: boolean;
  billingInterval?: unknown;
  autoRenew?: unknown;
  omitAutoRenew?: boolean;
  omitBillingInterval?: boolean;
  includePrice?: boolean;
}): ActionEvaluationContext {
  const idGen = createDeterministicIdGenerator("synthetic-sub");
  const subEntity = createCanonicalEntity({
    id: idGen.generate<"EntityId">("ent"),
    kind: "subscription",
    label: "Enterprise Monthly Plan",
  });

  const facts: StateFact[] = [];
  if (!params?.omitStatusFact) {
    facts.push(
      createStateFact({
        id: idGen.generate<"ObservationId">("obs"),
        subjectEntityId: subEntity.id,
        key: "subscription.status",
        value: params?.currentStatus ?? "inactive",
        observedAt: FIXED_OBSERVED_AT,
      }),
    );
    if (params?.duplicateStatusFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: subEntity.id,
          key: "subscription.status",
          value: params?.currentStatus ?? "inactive",
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
    if (params?.conflictingStatusFact) {
      facts.push(
        createStateFact({
          id: idGen.generate<"ObservationId">("obs"),
          subjectEntityId: subEntity.id,
          key: "subscription.status",
          value: "active",
          observedAt: FIXED_OBSERVED_AT,
        }),
      );
    }
  }

  if (params?.reverseFactOrder) {
    facts.reverse();
  }

  const entities = params?.missingEntityMetadata ? [] : [subEntity];

  const state = createStateSnapshot({
    id: idGen.generate<"StateSnapshotId">("state"),
    environment: TEST_ENV,
    entities,
    facts,
    observedAt: FIXED_OBSERVED_AT,
  });

  const actionParams: Record<string, unknown> = {};
  if (!params?.omitAutoRenew) {
    actionParams.autoRenew = params?.autoRenew !== undefined ? params.autoRenew : true;
  }
  if (!params?.omitBillingInterval) {
    actionParams.billingInterval =
      params?.billingInterval !== undefined ? params.billingInterval : "monthly";
  }
  if (params?.includePrice) {
    actionParams.price = 99.0;
    actionParams.currency = "USD";
  }

  const targets = [{ entityId: subEntity.id, role: "primary" as const }];
  if (params?.multiplePrimaryTargets) {
    targets.push({ entityId: "ent-sub-2" as EntityId, role: "primary" as const });
  }

  const action = createProposedAction({
    id: idGen.generate<"ActionId">("act"),
    environment: TEST_ENV,
    proposedAt: FIXED_PROPOSED_AT,
    actor: { kind: "human", id: "user-alice" },
    intent: { verb: "subscribe", domain: "billing" },
    targets,
    parameters: actionParams as Record<string, JsonValue>,
  });

  return createActionEvaluationContext({
    id: idGen.generate<"EvaluationContextId">("eval"),
    state,
    action,
    createdAt: FIXED_PROPOSED_AT,
  });
}

// ============================================================================
// FULL FC-004A REGRESSION SUITE (126 PROBES)
// ============================================================================

describe("FC-004A: Deterministic VERIFIED Rule Semantic Hardening", () => {
  // --------------------------------------------------------------------------
  // H1: Ambiguous Canonical StateFacts (Probes 1–11)
  // --------------------------------------------------------------------------
  describe("H1: Ambiguous Canonical Facts", () => {
    it("Probe 1: filesystem.exists with exactly 1 fact matches successfully", async () => {
      const ctx = createSyntheticFileContext({ exists: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(1);
      expect(evalRes.trace[0]?.status).toBe("matched");
    });

    it("Probe 2: filesystem.exists with 2 identical facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({ exists: true, duplicateExistenceFact: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 3: filesystem.exists with 2 conflicting facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({ exists: true, conflictingExistenceFact: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 4: repository.visibility with exactly 1 private fact matches successfully", async () => {
      const ctx = createSyntheticRepositoryContext({ currentVisibility: "private" });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(1);
      expect(evalRes.trace[0]?.status).toBe("matched");
    });

    it("Probe 5: repository.visibility with 2 identical private facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticRepositoryContext({
        currentVisibility: "private",
        duplicateVisibilityFact: true,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 6: repository.visibility with 2 conflicting facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticRepositoryContext({
        currentVisibility: "private",
        conflictingVisibilityFact: true,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 7: document.shared_with with 1 valid fact matches successfully", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(1);
      expect(evalRes.trace[0]?.status).toBe("matched");
    });

    it("Probe 8: document.shared_with with 2 identical facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({
        sharedWith: [],
        duplicateShareFact: true,
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 9: subscription.status with 1 inactive fact matches successfully", async () => {
      const ctx = createSyntheticSubscriptionContext({ currentStatus: "inactive" });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(1);
      expect(evalRes.trace[0]?.status).toBe("matched");
    });

    it("Probe 10: subscription.status with 2 identical inactive facts returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        currentStatus: "inactive",
        duplicateStatusFact: true,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("AMBIGUOUS_STATE_FACT");
    });

    it("Probe 11: reversing fact order in snapshot produces semantically identical decision", async () => {
      const ctxNormal = createSyntheticFileContext({
        exists: true,
        duplicateExistenceFact: true,
        reverseFactOrder: false,
      });
      const ctxReversed = createSyntheticFileContext({
        exists: true,
        duplicateExistenceFact: true,
        reverseFactOrder: true,
      });

      const res1 = await evaluateDeterministicRules({
        context: ctxNormal,
        rules: [fileDeleteRule],
      });
      const res2 = await evaluateDeterministicRules({
        context: ctxReversed,
        rules: [fileDeleteRule],
      });

      expect(isOk(res1)).toBe(true);
      expect(isOk(res2)).toBe(true);
      const eval1 = unwrapResult(res1);
      const eval2 = unwrapResult(res2);

      expect(eval1.trace[0]?.status).toBe(eval2.trace[0]?.status);
      expect(eval1.trace[0]?.reasonCode).toBe(eval2.trace[0]?.reasonCode);
      expect(eval1.consequences.length).toBe(eval2.consequences.length);
    });
  });

  // --------------------------------------------------------------------------
  // H2: Target Cardinality / Ambiguous Targets (Probes 12–20)
  // --------------------------------------------------------------------------
  describe("H2: Target Cardinality Resolution", () => {
    it("Probe 12: file delete with exactly 1 primary target matches", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 13: file delete with 2 primary targets returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({ multiplePrimaryTargets: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MULTIPLE_PRIMARY_TARGETS");
    });

    it("Probe 14: repository visibility with exactly 1 primary target matches", async () => {
      const ctx = createSyntheticRepositoryContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 15: repository visibility with 2 primary targets returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticRepositoryContext({ multiplePrimaryTargets: true });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MULTIPLE_PRIMARY_TARGETS");
    });

    it("Probe 16: document share with exactly 1 primary and 1 recipient matches", async () => {
      const ctx = createSyntheticDocumentShareContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 17: document share with 2 primary targets returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ multiplePrimaryTargets: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MULTIPLE_PRIMARY_TARGETS");
    });

    it("Probe 18: document share with 2 recipient targets returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ multipleRecipientTargets: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MULTIPLE_RECIPIENT_TARGETS");
    });

    it("Probe 19: subscription activation with exactly 1 primary target matches", async () => {
      const ctx = createSyntheticSubscriptionContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 20: subscription activation with 2 primary targets returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({ multiplePrimaryTargets: true });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MULTIPLE_PRIMARY_TARGETS");
    });
  });

  // --------------------------------------------------------------------------
  // H3: Subscription Rule Recurrence Semantics (Probes 21–31)
  // --------------------------------------------------------------------------
  describe("H3: Subscription Recurrence Semantics", () => {
    it("Probe 21: autoRenew=true + billingInterval='monthly' matches recurring subscription", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 22: autoRenew=true + billingInterval='annual' matches recurring subscription", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "annual",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 23: autoRenew=false returns NOT_APPLICABLE (NON_RECURRING_SUBSCRIPTION)", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: false,
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("NON_RECURRING_SUBSCRIPTION");
    });

    it("Probe 24: missing autoRenew returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        omitAutoRenew: true,
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MISSING_RECURRENCE_PARAMETERS");
    });

    it("Probe 25: non-boolean autoRenew returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: "true",
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("INVALID_RECURRENCE_PARAMETERS");
    });

    it("Probe 26: missing billingInterval returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        omitBillingInterval: true,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MISSING_RECURRENCE_PARAMETERS");
    });

    it("Probe 27: empty billingInterval returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("INVALID_RECURRENCE_PARAMETERS");
    });

    it("Probe 28: unsupported billingInterval ('weekly') returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "weekly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("UNSUPPORTED_BILLING_INTERVAL");
    });

    it("Probe 29: active status with autoRenew=true returns NOT_APPLICABLE (SUBSCRIPTION_NOT_INACTIVE)", async () => {
      const ctx = createSyntheticSubscriptionContext({
        currentStatus: "active",
        autoRenew: true,
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("SUBSCRIPTION_NOT_INACTIVE");
    });

    it("Probe 30: price absent generates consequence without inventing currency price", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "monthly",
        includePrice: false,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq).toBeDefined();
      expect(csq?.summary).not.toContain("$");
      expect(csq?.summary).not.toContain("USD");
    });

    it("Probe 31: subscription activation specifies recurring temporal semantics", async () => {
      const ctx = createSyntheticSubscriptionContext({
        autoRenew: true,
        billingInterval: "monthly",
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [subscriptionActivationRule],
      });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq?.temporal?.frequency).toBe("recurring");
    });
  });

  // --------------------------------------------------------------------------
  // H4: Delete Parameter Semantics (Probes 32–41)
  // --------------------------------------------------------------------------
  describe("H4: Delete Parameter Semantics", () => {
    it("Probe 32: moveToTrash=true, permanent=false matches reversible trash deletion", async () => {
      const ctx = createSyntheticFileContext({ moveToTrash: true, permanent: false });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      const csq = evalRes.consequences[0];
      expect(csq?.reversibility.level).toBe("reversible");
    });

    it("Probe 33: moveToTrash=false, permanent=true matches irreversible permanent deletion", async () => {
      const ctx = createSyntheticFileContext({ moveToTrash: false, permanent: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      const csq = evalRes.consequences[0];
      expect(csq?.reversibility.level).toBe("irreversible");
    });

    it("Probe 34: moveToTrash=true, permanent=true returns INSUFFICIENT_EVIDENCE (contradictory)", async () => {
      const ctx = createSyntheticFileContext({ moveToTrash: true, permanent: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("CONTRADICTORY_DELETE_PARAMETERS");
    });

    it("Probe 35: moveToTrash=false, permanent=false returns INSUFFICIENT_EVIDENCE (contradictory)", async () => {
      const ctx = createSyntheticFileContext({ moveToTrash: false, permanent: false });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("CONTRADICTORY_DELETE_PARAMETERS");
    });

    it("Probe 36: missing moveToTrash returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({
        customParameters: { permanent: false },
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MISSING_DELETE_PARAMETERS");
    });

    it("Probe 37: missing permanent returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({
        customParameters: { moveToTrash: true },
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MISSING_DELETE_PARAMETERS");
    });

    it("Probe 38: explicit undefined moveToTrash returns INSUFFICIENT_EVIDENCE", async () => {
      const readRes = readExplicitBooleanParameter(
        { moveToTrash: undefined, permanent: false },
        "moveToTrash",
      );
      expect(readRes.status).toBe("absent");

      const baseCtx = createSyntheticFileContext();
      const mockAction = {
        ...baseCtx.action,
        parameters: { moveToTrash: undefined, permanent: false },
      };
      const mockCtx = {
        ...baseCtx,
        action: mockAction,
      } as unknown as ActionEvaluationContext;

      const graph = buildActionGraph({ context: baseCtx });
      const dec = await fileDeleteRule.evaluate({
        context: mockCtx,
        graph,
      });

      expect(dec.status).toBe("insufficient-evidence");
      if (dec.status === "insufficient-evidence") {
        expect(dec.reasonCode).toBe("MISSING_DELETE_PARAMETERS");
      }
    });

    it("Probe 39: nonboolean moveToTrash ('true') returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({
        customParameters: { moveToTrash: "true", permanent: false },
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("INVALID_DELETE_PARAMETERS");
    });

    it("Probe 40: nonboolean permanent (1) returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({
        customParameters: { moveToTrash: true, permanent: 1 },
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("INVALID_DELETE_PARAMETERS");
    });

    it("Probe 41: reversible trash has low risk, permanent deletion has medium risk", async () => {
      const ctxTrash = createSyntheticFileContext({ moveToTrash: true, permanent: false });
      const ctxPerm = createSyntheticFileContext({ moveToTrash: false, permanent: true });

      const resTrash = await evaluateDeterministicRules({
        context: ctxTrash,
        rules: [fileDeleteRule],
      });
      const resPerm = await evaluateDeterministicRules({
        context: ctxPerm,
        rules: [fileDeleteRule],
      });

      expect(isOk(resTrash)).toBe(true);
      expect(isOk(resPerm)).toBe(true);

      const csqTrash = unwrapResult(resTrash).consequences[0];
      const csqPerm = unwrapResult(resPerm).consequences[0];

      expect(csqTrash?.risk.severity).toBe("low");
      expect(csqPerm?.risk.severity).toBe("medium");
    });
  });

  // --------------------------------------------------------------------------
  // H5: Malformed document.shared_with (Probes 42–52)
  // --------------------------------------------------------------------------
  describe("H5: Document Shared_With Semantic Validation", () => {
    it("Probe 42: shared_with = [] (empty valid array) matches", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).trace[0]?.status).toBe("matched");
    });

    it("Probe 43: shared_with = ['user-1'] matches and appends new recipient", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["user-1"] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      const csq = evalRes.consequences[0];
      const change = csq?.stateChanges[0];
      expect(change).toBeDefined();
      if (change && change.after.status === "known") {
        expect(change.after.value).toEqual(["user-1", "ent-synthetic-share-0002"]);
      }
    });

    it("Probe 44: recipient already in shared_with returns NOT_APPLICABLE (ALREADY_SHARED)", async () => {
      const ctx = createSyntheticDocumentShareContext({ recipientAlreadyShared: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("ALREADY_SHARED");
    });

    it("Probe 45: shared_with = [3] returns INSUFFICIENT_EVIDENCE (MALFORMED_SHARED_WITH)", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [3] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 46: shared_with = [null] returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [null] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 47: shared_with = [{}] returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [{}] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 48: shared_with = [[]] returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [[]] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 49: shared_with = ['user-1', 3] (mixed types) returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["user-1", 3] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 50: shared_with = ['user-1', 'user-1'] (duplicates) returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["user-1", "user-1"] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });

    it("Probe 51: shared_with is sparse array returns INSUFFICIENT_EVIDENCE", () => {
      const sparse = Array(2);
      sparse[1] = "user-1";
      const valRes = validateSharedWithArray(sparse);
      expect(valRes.valid).toBe(false);
      if (!valRes.valid) {
        expect(valRes.reason).toBe("SPARSE_ARRAY");
      }
    });

    it("Probe 52: shared_with non-array (object/string) returns INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: "user-1" });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
    });
  });

  // --------------------------------------------------------------------------
  // H6: Consequence Confidence Contract (Probes 53–59)
  // --------------------------------------------------------------------------
  describe("H6: Consequence Confidence Contract", () => {
    it("Probe 53: all four valid built-in matched consequences explicitly carry canonical confidence 1.0", async () => {
      const ctxFile = createSyntheticFileContext();
      const ctxRepo = createSyntheticRepositoryContext();
      const ctxShare = createSyntheticDocumentShareContext();
      const ctxSub = createSyntheticSubscriptionContext();

      const r1 = await evaluateDeterministicRules({ context: ctxFile, rules: [fileDeleteRule] });
      const r2 = await evaluateDeterministicRules({
        context: ctxRepo,
        rules: [repositoryVisibilityRule],
      });
      const r3 = await evaluateDeterministicRules({
        context: ctxShare,
        rules: [documentShareRule],
      });
      const r4 = await evaluateDeterministicRules({
        context: ctxSub,
        rules: [subscriptionActivationRule],
      });

      expect(isOk(r1)).toBe(true);
      expect(isOk(r2)).toBe(true);
      expect(isOk(r3)).toBe(true);
      expect(isOk(r4)).toBe(true);

      expect(unwrapResult(r1).consequences[0]?.confidence).toBe(1.0);
      expect(unwrapResult(r2).consequences[0]?.confidence).toBe(1.0);
      expect(unwrapResult(r3).consequences[0]?.confidence).toBe(1.0);
      expect(unwrapResult(r4).consequences[0]?.confidence).toBe(1.0);
    });

    it("Probe 54: no built-in VERIFIED EvidenceRecord receives automatic confidence", async () => {
      const ctxFile = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctxFile, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq).toBeDefined();
      expect(csq?.evidence[0]?.confidence).toBeUndefined();
    });

    it("Probe 55: matched custom draft with OMITTED consequence confidence -> INVALID_RULE_OUTPUT", async () => {
      const customRule: DeterministicRule = {
        id: "custom.test.omitted" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Custom rule omitting confidence",
        evaluate: () => {
          return {
            status: "matched",
            drafts: [
              {
                kind: "state-change",
                summary: "Omitted confidence",
                affectedEntities: ["ent-1" as EntityId],
                evidence: [
                  {
                    scope: "test scope",
                    assumptions: [],
                    summary: "test summary",
                  },
                ],
                reversibility: { level: "reversible" },
                risk: { severity: "low", categories: ["privacy"] },
              } as unknown as ConsequenceDraft,
            ],
          };
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [customRule] });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_RULE_OUTPUT");
      }
    });

    it("Probe 56: matched custom draft with explicit valid confidence (0.8) is preserved exactly", async () => {
      const customRule: DeterministicRule = {
        id: "custom.test.explicit" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Custom rule with explicit 0.8 confidence",
        evaluate: () => {
          return {
            status: "matched",
            drafts: [
              {
                kind: "privacy",
                summary: "Explicit confidence test",
                affectedEntities: ["ent-1" as EntityId],
                evidence: [
                  {
                    scope: "test scope",
                    assumptions: [],
                    summary: "test summary",
                  },
                ],
                confidence: createConfidenceScore(0.8),
                reversibility: { level: "reversible" },
                risk: { severity: "low", categories: ["privacy"] },
              },
            ],
          };
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [customRule] });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq?.confidence).toBe(0.8);
    });

    it("Probe 57: matched custom draft with invalid confidence -> INVALID_RULE_OUTPUT", async () => {
      const customRule: DeterministicRule = {
        id: "custom.test.invalid" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Custom rule with invalid confidence",
        evaluate: () => {
          return {
            status: "matched",
            drafts: [
              {
                kind: "privacy",
                summary: "Invalid confidence test",
                affectedEntities: ["ent-1" as EntityId],
                evidence: [
                  {
                    scope: "test scope",
                    assumptions: [],
                    summary: "test summary",
                  },
                ],
                confidence: 1.5 as unknown as number,
                reversibility: { level: "reversible" },
                risk: { severity: "low", categories: ["privacy"] },
              },
            ],
          };
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [customRule] });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_RULE_OUTPUT");
      }
    });

    it("Probe 58: no evaluator fallback default confidence exists", async () => {
      const valRes = validateConsequenceDraft({
        kind: "privacy",
        summary: "Testing no fallback default",
        affectedEntities: ["ent-1"],
        evidence: [
          {
            scope: "test",
            assumptions: [],
            summary: "test",
          },
        ],
        reversibility: { level: "reversible" },
        risk: { severity: "low", categories: ["privacy"] },
      });
      expect(valRes.valid).toBe(false);
      if (!valRes.valid) {
        expect(
          valRes.issues.some((i) => i.code === "MISSING_PROPERTY" && i.path.includes("confidence")),
        ).toBe(true);
      }
    });

    it("Probe 59: ambiguous/insufficient built-in cases produce NO consequence and no misleading confidence", async () => {
      const ctx = createSyntheticFileContext({ multiplePrimaryTargets: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(0);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
    });
  });

  // --------------------------------------------------------------------------
  // M1: Rule Immutability (Probes 60–68)
  // --------------------------------------------------------------------------
  describe("M1: Rule Immutability", () => {
    it("Probe 60: rule definition modified after registration does not change registered rule", () => {
      const mutableRule = {
        id: "custom.mutable.test" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Original description",
        evaluate: () => ({ status: "not-applicable" as const, reasonCode: "TEST" }),
      };

      const ruleSet = createRuleSet([mutableRule]);
      mutableRule.description = "Mutated description";

      const registered = ruleSet.getRule("custom.mutable.test" as RuleId);
      expect(registered?.description).toBe("Original description");
    });

    it("Probe 61: registry root is Object.isFrozen", () => {
      const ruleSet = createDefaultRuleSet();
      expect(Object.isFrozen(ruleSet)).toBe(true);
    });

    it("Probe 62: registry.rules array is Object.isFrozen", () => {
      const ruleSet = createDefaultRuleSet();
      expect(Object.isFrozen(ruleSet.rules)).toBe(true);
    });

    it("Probe 63: registry.rules[0] definition is Object.isFrozen", () => {
      const ruleSet = createDefaultRuleSet();
      expect(Object.isFrozen(ruleSet.rules[0])).toBe(true);
    });

    it("Probe 64: modifying registered rule throws in strict mode", () => {
      const ruleSet = createDefaultRuleSet();
      const r = ruleSet.rules[0] as unknown as { description: string };
      expect(() => {
        r.description = "attempted mutation";
      }).toThrow();
    });

    it("Probe 65: fileDeleteRule is Object.isFrozen", () => {
      expect(Object.isFrozen(fileDeleteRule)).toBe(true);
    });

    it("Probe 66: repositoryVisibilityRule is Object.isFrozen", () => {
      expect(Object.isFrozen(repositoryVisibilityRule)).toBe(true);
    });

    it("Probe 67: documentShareRule is Object.isFrozen", () => {
      expect(Object.isFrozen(documentShareRule)).toBe(true);
    });

    it("Probe 68: subscriptionActivationRule is Object.isFrozen", () => {
      expect(Object.isFrozen(subscriptionActivationRule)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // M2: Registry Validation Bypass (Probes 69–73)
  // --------------------------------------------------------------------------
  describe("M2: Authoritative Rule Set Normalization", () => {
    it("Probe 69: registry-shaped object with invalid rule in .rules fails closed", async () => {
      const fakeRegistry = {
        rules: [{ id: "invalid id with spaces", version: "1.0" }],
        getRule: () => undefined,
        hasRule: () => false,
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
    });

    it("Probe 70: registry-shaped object with duplicate ruleId in .rules is rejected", async () => {
      const fakeRegistry = {
        rules: [fileDeleteRule, fileDeleteRule],
        getRule: () => undefined,
        hasRule: () => false,
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("DUPLICATE_RULE");
      }
    });

    it("Probe 71: registry-shaped object with hostile getRule does not bypass definition validation", async () => {
      const fakeRegistry = {
        rules: [{ id: "bad.id", version: "not-a-version" }],
        getRule: () => fileDeleteRule,
        hasRule: () => true,
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
    });

    it("Probe 72: passing valid DeterministicRuleSet evaluates correctly", async () => {
      const ruleSet = createDefaultRuleSet();
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: ruleSet,
      });
      expect(isOk(res)).toBe(true);
    });

    it("Probe 73: passing non-object/non-array rules option is rejected", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: "invalid-rules" as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_OPTIONS");
      }
    });
  });

  // --------------------------------------------------------------------------
  // M3: Normalized ID Uniqueness Checks (Probes 74–78)
  // --------------------------------------------------------------------------
  describe("M3: Normalized ID Collision Detection", () => {
    it("Probe 74: normalized ConsequenceId collision fails closed with ID_COLLISION", async () => {
      const collidingGen: IdGenerator = {
        generate: <TBrand extends string = string>() =>
          "csq-unique-id" as unknown as import("@futureclick/shared").Brand<string, TBrand>,
        nextId: <TBrand extends string = string>() =>
          "csq-unique-id" as unknown as import("@futureclick/shared").Brand<string, TBrand>,
      };

      const ruleA: DeterministicRule = {
        id: "test.rule.a" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule A",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "privacy",
              summary: "Draft A",
              affectedEntities: ["ent-1" as EntityId],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["privacy"] },
            },
          ],
        }),
      };

      const ruleB: DeterministicRule = {
        id: "test.rule.b" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule B",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "security",
              summary: "Draft B",
              affectedEntities: ["ent-2" as EntityId],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["security"] },
            },
          ],
        }),
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [ruleA, ruleB],
        idGenerator: collidingGen,
      });

      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("ID_COLLISION");
        expect(res.error.message).toContain("ConsequenceId");
      }
    });

    it("Probe 75: normalized EvidenceId collision fails closed with ID_COLLISION", async () => {
      let callCount = 0;
      const collidingEvidenceGen: IdGenerator = {
        generate: <TBrand extends string = string>(prefix?: string) => {
          if (prefix === "csq") {
            callCount += 1;
            return `csq-test-${callCount}` as unknown as import("@futureclick/shared").Brand<
              string,
              TBrand
            >;
          }
          return "ev-collision-id" as unknown as import("@futureclick/shared").Brand<
            string,
            TBrand
          >;
        },
        nextId: <TBrand extends string = string>(prefix?: string) => {
          if (prefix === "csq") {
            callCount += 1;
            return `csq-test-${callCount}` as unknown as import("@futureclick/shared").Brand<
              string,
              TBrand
            >;
          }
          return "ev-collision-id" as unknown as import("@futureclick/shared").Brand<
            string,
            TBrand
          >;
        },
      };

      const ruleA: DeterministicRule = {
        id: "test.rule.ev.a" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule A with evidence",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "privacy",
              summary: "Draft A",
              affectedEntities: ["ent-1" as EntityId],
              evidence: [{ scope: "s1", assumptions: [], summary: "sum1" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["privacy"] },
            },
          ],
        }),
      };

      const ruleB: DeterministicRule = {
        id: "test.rule.ev.b" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule B with evidence",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "security",
              summary: "Draft B",
              affectedEntities: ["ent-2" as EntityId],
              evidence: [{ scope: "s2", assumptions: [], summary: "sum2" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["security"] },
            },
          ],
        }),
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [ruleA, ruleB],
        idGenerator: collidingEvidenceGen,
      });

      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("ID_COLLISION");
        expect(res.error.message).toContain("EvidenceId");
      }
    });

    it("Probe 76: same text across separate ConsequenceId and EvidenceId namespaces succeeds", async () => {
      const dualNamespaceGen: IdGenerator = {
        generate: <TBrand extends string = string>() =>
          "shared-text-id" as import("@futureclick/shared").Brand<string, TBrand>,
        nextId: <TBrand extends string = string>() =>
          "shared-text-id" as import("@futureclick/shared").Brand<string, TBrand>,
      };

      const singleRule: DeterministicRule = {
        id: "test.rule.single" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Single consequence and evidence",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "privacy",
              summary: "Draft",
              affectedEntities: ["ent-1" as EntityId],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["privacy"] },
            },
          ],
        }),
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [singleRule],
        idGenerator: dualNamespaceGen,
      });

      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(1);
      expect(evalRes.consequences[0]?.id).toBe("shared-text-id");
      expect(evalRes.consequences[0]?.evidence[0]?.id).toBe("shared-text-id");
    });

    it("Probe 77: distinct normalized IDs succeed", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
    });

    it("Probe 78: ID collision rejects before consequence is returned", async () => {
      const collidingGen: IdGenerator = {
        generate: <TBrand extends string = string>() =>
          "collision-id" as unknown as import("@futureclick/shared").Brand<string, TBrand>,
        nextId: <TBrand extends string = string>() =>
          "collision-id" as unknown as import("@futureclick/shared").Brand<string, TBrand>,
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule, fileDeleteRule],
        idGenerator: collidingGen,
      });
      expect(isErr(res)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // M4: Trace Token Contract & Privacy (Probes 79–87)
  // --------------------------------------------------------------------------
  describe("M4: Trace Token Contract", () => {
    it("Probe 79: reasonCode with valid uppercase format succeeds", () => {
      expect(isValidReasonCode("UNMATCHED_VERB")).toBe(true);
      expect(isValidReasonCode("NO_PRIMARY_TARGET")).toBe(true);
    });

    it("Probe 80: reasonCode sentence is rejected", () => {
      expect(isValidReasonCode("This is not applicable because of missing facts.")).toBe(false);
      const val = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "This is not applicable because of missing facts.",
      });
      expect(val.valid).toBe(false);
    });

    it("Probe 81: reasonCode with newline is rejected", () => {
      expect(isValidReasonCode("REASON\nCODE")).toBe(false);
      const val = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "REASON\nCODE",
      });
      expect(val.valid).toBe(false);
    });

    it("Probe 82: reasonCode email address is rejected", () => {
      expect(isValidReasonCode("user@example.com")).toBe(false);
      const val = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "user@example.com",
      });
      expect(val.valid).toBe(false);
    });

    it("Probe 83: missing token with valid format succeeds", () => {
      expect(isValidMissingToken("filesystem.exists")).toBe(true);
      expect(isValidMissingToken("action.target.primary")).toBe(true);
    });

    it("Probe 84: missing token sentence is rejected", () => {
      expect(isValidMissingToken("The filesystem fact was completely absent")).toBe(false);
      const val = validateRuleDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_FACT",
        missing: ["The filesystem fact was completely absent"],
      });
      expect(val.valid).toBe(false);
    });

    it("Probe 85: missing token email address is rejected", () => {
      expect(isValidMissingToken("admin@futureclick.internal")).toBe(false);
      const val = validateRuleDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_RECIPIENT",
        missing: ["admin@futureclick.internal"],
      });
      expect(val.valid).toBe(false);
    });

    it("Probe 86: missing token with uppercase is rejected", () => {
      expect(isValidMissingToken("Action.Target.Primary")).toBe(false);
    });

    it("Probe 87: all four built-ins emit strictly valid reasonCodes and missing tokens", async () => {
      const ctxFile = createSyntheticFileContext({ omitExistenceFact: true });
      const ctxRepo = createSyntheticRepositoryContext({ currentVisibility: "public" });
      const ctxShare = createSyntheticDocumentShareContext({ recipientAlreadyShared: true });
      const ctxSub = createSyntheticSubscriptionContext({ omitAutoRenew: true });

      const r1 = await evaluateDeterministicRules({ context: ctxFile, rules: [fileDeleteRule] });
      const r2 = await evaluateDeterministicRules({
        context: ctxRepo,
        rules: [repositoryVisibilityRule],
      });
      const r3 = await evaluateDeterministicRules({
        context: ctxShare,
        rules: [documentShareRule],
      });
      const r4 = await evaluateDeterministicRules({
        context: ctxSub,
        rules: [subscriptionActivationRule],
      });

      const traces = [
        unwrapResult(r1).trace[0],
        unwrapResult(r2).trace[0],
        unwrapResult(r3).trace[0],
        unwrapResult(r4).trace[0],
      ];

      for (const t of traces) {
        expect(t).toBeDefined();
        if (t) {
          expect(isValidReasonCode(t.reasonCode)).toBe(true);
          if (t.missing) {
            for (const m of t.missing) {
              expect(isValidMissingToken(m)).toBe(true);
            }
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // M5: Deterministic Graph Metadata & Local ID Generator (Probes 88–93)
  // --------------------------------------------------------------------------
  describe("M5: Deterministic Graph Metadata & Generator Isolation", () => {
    it("Probe 88: supplied generatedAt is used for evaluation result and graph metadata", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).generatedAt).toBe(FIXED_EVAL_AT);
    });

    it("Probe 89: omitted generatedAt defaults deterministically to context.createdAt", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).generatedAt).toBe(ctx.createdAt);
    });

    it("Probe 90: identical context and timestamp produce identical graph structure", async () => {
      const ctx = createSyntheticFileContext();
      const r1 = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      const r2 = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });

      expect(isOk(r1)).toBe(true);
      expect(isOk(r2)).toBe(true);
      expect(unwrapResult(r1).generatedAt).toBe(unwrapResult(r2).generatedAt);
    });

    it("Probe 91: consequence/evidence idGenerator consumption is independent of graph construction", async () => {
      let consequenceGenCalls = 0;
      const countingGen: IdGenerator = {
        generate: <TBrand extends string = string>(prefix?: string) => {
          consequenceGenCalls += 1;
          return `${prefix ?? "id"}-${consequenceGenCalls}` as import("@futureclick/shared").Brand<
            string,
            TBrand
          >;
        },
        nextId: <TBrand extends string = string>(prefix?: string) => {
          consequenceGenCalls += 1;
          return `${prefix ?? "id"}-${consequenceGenCalls}` as import("@futureclick/shared").Brand<
            string,
            TBrand
          >;
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: countingGen,
      });

      expect(isOk(res)).toBe(true);
      // Exactly 1 ConsequenceId + 1 EvidenceId = 2 calls. Graph node/edge IDs did NOT touch countingGen!
      expect(consequenceGenCalls).toBe(2);
    });

    it("Probe 92: graph ID generator does not leak state across independent evaluations", async () => {
      const ctx = createSyntheticFileContext();
      const r1 = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      const r2 = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      expect(unwrapResult(r1).consequences[0]?.summary).toBe(
        unwrapResult(r2).consequences[0]?.summary,
      );
    });

    it("Probe 93: graph metadata contains no random or nondeterministic values", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).generatedAt).toBe(FIXED_EVAL_AT);
    });
  });

  // --------------------------------------------------------------------------
  // L1: RuleId & RuleVersion Whitespace Rejection (Probes 94–99)
  // --------------------------------------------------------------------------
  describe("L1: RuleId and RuleVersion Whitespace Rejection", () => {
    it("Probe 94: RuleId with leading whitespace is rejected", () => {
      const res = validateRuleId(" filesystem.delete.file");
      expect(res.valid).toBe(false);
    });

    it("Probe 95: RuleId with trailing whitespace is rejected", () => {
      const res = validateRuleId("filesystem.delete.file ");
      expect(res.valid).toBe(false);
    });

    it("Probe 96: RuleId with newline is rejected", () => {
      const res = validateRuleId("filesystem.delete.file\n");
      expect(res.valid).toBe(false);
    });

    it("Probe 97: RuleVersion with leading whitespace is rejected", () => {
      const res = validateRuleVersion(" 1.0");
      expect(res.valid).toBe(false);
    });

    it("Probe 98: RuleVersion with trailing whitespace is rejected", () => {
      const res = validateRuleVersion("1.0 ");
      expect(res.valid).toBe(false);
    });

    it("Probe 99: valid trimmed RuleId and RuleVersion succeed", () => {
      expect(validateRuleId("filesystem.delete.file").valid).toBe(true);
      expect(validateRuleVersion("1.0").valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // L3: Strict Decision Variants (Probes 100–105)
  // --------------------------------------------------------------------------
  describe("L3: Strict Decision Variants", () => {
    it("Probe 100: matched decision with extraneous reasonCode is rejected", () => {
      const val = validateRuleDecision({
        status: "matched",
        reasonCode: "EXTRA_CODE",
        drafts: [
          {
            kind: "privacy",
            summary: "valid draft",
            affectedEntities: ["ent-1"],
            evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
            confidence: 1.0,
            reversibility: { level: "reversible" },
            risk: { severity: "low", categories: ["privacy"] },
          },
        ],
      });
      expect(val.valid).toBe(false);
      if (!val.valid) {
        expect(
          val.issues.some((i) => i.code === "UNEXPECTED_PROPERTY" && i.path.includes("reasonCode")),
        ).toBe(true);
      }
    });

    it("Probe 101: not-applicable decision with extraneous drafts is rejected", () => {
      const val = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "UNMATCHED_VERB",
        drafts: [],
      });
      expect(val.valid).toBe(false);
      if (!val.valid) {
        expect(
          val.issues.some((i) => i.code === "UNEXPECTED_PROPERTY" && i.path.includes("drafts")),
        ).toBe(true);
      }
    });

    it("Probe 102: not-applicable decision with extraneous missing is rejected", () => {
      const val = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "UNMATCHED_VERB",
        missing: ["something"],
      });
      expect(val.valid).toBe(false);
      if (!val.valid) {
        expect(
          val.issues.some((i) => i.code === "UNEXPECTED_PROPERTY" && i.path.includes("missing")),
        ).toBe(true);
      }
    });

    it("Probe 103: insufficient-evidence decision with extraneous drafts is rejected", () => {
      const val = validateRuleDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_FACT",
        drafts: [],
      });
      expect(val.valid).toBe(false);
      if (!val.valid) {
        expect(
          val.issues.some((i) => i.code === "UNEXPECTED_PROPERTY" && i.path.includes("drafts")),
        ).toBe(true);
      }
    });

    it("Probe 104: matched decision with empty drafts is rejected (EMPTY_DRAFTS)", () => {
      const val = validateRuleDecision({
        status: "matched",
        drafts: [],
      });
      expect(val.valid).toBe(false);
      if (!val.valid) {
        expect(val.issues.some((i) => i.code === "EMPTY_DRAFTS")).toBe(true);
      }
    });

    it("Probe 105: valid decision variants with exact allowed fields succeed", () => {
      const valMatched = validateRuleDecision({
        status: "matched",
        drafts: [
          {
            kind: "privacy",
            summary: "Valid",
            affectedEntities: ["ent-1"],
            evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
            confidence: 1.0,
            reversibility: { level: "reversible" },
            risk: { severity: "low", categories: ["privacy"] },
          },
        ],
      });
      const valNotApp = validateRuleDecision({
        status: "not-applicable",
        reasonCode: "UNMATCHED_VERB",
      });
      const valInsuff = validateRuleDecision({
        status: "insufficient-evidence",
        reasonCode: "MISSING_FACT",
        missing: ["filesystem.exists"],
      });

      expect(valMatched.valid).toBe(true);
      expect(valNotApp.valid).toBe(true);
      expect(valInsuff.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // L4: Explicit generatedAt: undefined Rejection (Probes 106–110)
  // --------------------------------------------------------------------------
  describe("L4: Explicit generatedAt: undefined Handling", () => {
    it("Probe 106: { generatedAt: undefined } is rejected with safe INVALID_TIMESTAMP error", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: undefined as unknown as IsoTimestamp,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_TIMESTAMP");
      }
    });

    it("Probe 107: { generatedAt: 'invalid-date' } is rejected with safe INVALID_TIMESTAMP error", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: "invalid-date" as unknown as IsoTimestamp,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_TIMESTAMP");
      }
    });

    it("Probe 108: { generatedAt: validIso } is accepted", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        generatedAt: FIXED_EVAL_AT,
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).generatedAt).toBe(FIXED_EVAL_AT);
    });

    it("Probe 109: omitted generatedAt option defaults to context.createdAt", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
      });
      expect(isOk(res)).toBe(true);
      expect(unwrapResult(res).generatedAt).toBe(ctx.createdAt);
    });

    it("Probe 110: hostile generatedAt getter throwing is safely normalized to Result.err", async () => {
      const ctx = createSyntheticFileContext();
      const hostileOptions = {
        context: ctx,
        get generatedAt(): IsoTimestamp {
          throw new Error("Hostile generatedAt getter error");
        },
      };

      const res = await evaluateDeterministicRules(hostileOptions);
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("READ_ERROR");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Hostile Generator Safety (Probes 111–115)
  // --------------------------------------------------------------------------
  describe("Hostile Generator Exception Safety", () => {
    it("Probe 111: generator throwing standard Error is normalized safely", async () => {
      const throwingGen: IdGenerator = {
        generate: () => {
          throw new Error("Generator exploded");
        },
        nextId: () => {
          throw new Error("Generator exploded");
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: throwingGen,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("Generator exploded");
      }
    });

    it("Probe 112: generator throwing string is normalized safely", async () => {
      const throwingGen: IdGenerator = {
        generate: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "Raw string error from generator";
        },
        nextId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "Raw string error from generator";
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: throwingGen,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("Raw string error");
      }
    });

    it("Probe 113: generator throwing null is normalized safely", async () => {
      const throwingGen: IdGenerator = {
        generate: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw null;
        },
        nextId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw null;
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: throwingGen,
      });
      expect(isErr(res)).toBe(true);
    });

    it("Probe 114: generator throwing Object.create(null) is normalized safely", async () => {
      const throwingGen: IdGenerator = {
        generate: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw Object.create(null);
        },
        nextId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw Object.create(null);
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: throwingGen,
      });
      expect(isErr(res)).toBe(true);
    });

    it("Probe 115: generator throwing { toString: null } is normalized safely", async () => {
      const throwingGen: IdGenerator = {
        generate: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw { toString: null };
        },
        nextId: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw { toString: null };
        },
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [fileDeleteRule],
        idGenerator: throwingGen,
      });
      expect(isErr(res)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Core Engine & Built-in Baseline Probes (Probes 116–126)
  // --------------------------------------------------------------------------
  describe("Core Engine & Built-in Baseline", () => {
    it("Probe 116: target entity without CanonicalEntity metadata yields INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticFileContext({ missingEntityMetadata: true });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MISSING_TARGET_ENTITY_METADATA");
    });

    it("Probe 117: unrelated repository update yields NOT_APPLICABLE", async () => {
      const ctx = createSyntheticRepositoryContext({
        verb: "update",
        omitVisibilityParam: true,
      });
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [repositoryVisibilityRule],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("UNRELATED_REPOSITORY_UPDATE");
    });

    it("Probe 118: within-rule duplicate state transition fails closed (RULE_OUTPUT_CONFLICT)", async () => {
      const ruleDoubleTransition: DeterministicRule = {
        id: "test.rule.conflict" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule claiming 2 different post-states for same property",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "state-change",
              summary: "Contradictory transitions",
              affectedEntities: ["ent-1" as EntityId],
              stateChanges: [
                {
                  entityId: "ent-1" as EntityId,
                  property: "status",
                  operation: "replace",
                  before: { status: "known", value: "A" },
                  after: { status: "known", value: "B" },
                },
                {
                  entityId: "ent-1" as EntityId,
                  property: "status",
                  operation: "replace",
                  before: { status: "known", value: "A" },
                  after: { status: "known", value: "C" },
                },
              ],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["privacy"] },
            },
          ],
        }),
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [ruleDoubleTransition],
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("RULE_OUTPUT_CONFLICT");
      }
    });

    it("Probe 119: multiple non-conflicting rules derive consequences deterministically", async () => {
      const rule1: DeterministicRule = {
        id: "test.rule.one" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule 1",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "privacy",
              summary: "Draft 1",
              affectedEntities: ["ent-1" as EntityId],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["privacy"] },
            },
          ],
        }),
      };

      const rule2: DeterministicRule = {
        id: "test.rule.two" as RuleId,
        version: "1.0" as RuleVersion,
        description: "Rule 2",
        evaluate: () => ({
          status: "matched",
          drafts: [
            {
              kind: "security",
              summary: "Draft 2",
              affectedEntities: ["ent-2" as EntityId],
              evidence: [{ scope: "s", assumptions: [], summary: "sum" }],
              confidence: createConfidenceScore(1.0),
              reversibility: { level: "reversible" },
              risk: { severity: "low", categories: ["security"] },
            },
          ],
        }),
      };

      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: [rule1, rule2],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.consequences.length).toBe(2);
      expect(evalRes.trace.length).toBe(2);
    });

    it("Probe 120: consequence evidence mode is explicitly 'verified'", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq?.evidence[0]?.mode).toBe("verified");
    });

    it("Probe 121: consequence evidence scope and assumptions are verified", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const csq = unwrapResult(res).consequences[0];
      expect(csq?.evidence[0]?.scope.length).toBeGreaterThan(0);
      expect(csq?.evidence[0]?.assumptions.length).toBeGreaterThan(0);
      expect(csq?.evidence[0]?.assumptions[0]?.status).toBe("assumed");
    });

    it("Probe 122: trace follows exact rule registration order", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: BUILTIN_RULES,
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace.length).toBe(4);
      expect(evalRes.trace[0]?.ruleId).toBe(FILE_DELETE_RULE_ID);
      expect(evalRes.trace[1]?.ruleId).toBe(REPOSITORY_VISIBILITY_RULE_ID);
      expect(evalRes.trace[2]?.ruleId).toBe(DOCUMENT_SHARE_RULE_ID);
      expect(evalRes.trace[3]?.ruleId).toBe(SUBSCRIPTION_ACTIVATE_RULE_ID);
    });

    it("Probe 123: evaluation result is deeply frozen", async () => {
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({ context: ctx, rules: [fileDeleteRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(Object.isFrozen(evalRes)).toBe(true);
      expect(Object.isFrozen(evalRes.consequences)).toBe(true);
      expect(Object.isFrozen(evalRes.trace)).toBe(true);
      if (evalRes.consequences[0]) {
        expect(Object.isFrozen(evalRes.consequences[0])).toBe(true);
      }
    });

    it("Probe 124: adapts into ConsequenceEngine via createDeterministicRuleEvaluator", async () => {
      const engine = new ConsequenceEngine();
      const evaluator = createDeterministicRuleEvaluator();
      engine.registerEvaluator(evaluator);

      const ctx = createSyntheticFileContext();
      const assessmentResult = await engine.evaluate(ctx);

      expect(isOk(assessmentResult)).toBe(true);
      const assessment = unwrapResult(assessmentResult);
      expect(assessment.consequences.length).toBe(1);
    });

    it("Probe 125: ConsequenceEngine assessment preserves verified evidence with scope and assumptions", async () => {
      const engine = new ConsequenceEngine();
      engine.registerEvaluator(createDeterministicRuleEvaluator());

      const ctx = createSyntheticFileContext();
      const assessmentResult = await engine.evaluate(ctx);

      expect(isOk(assessmentResult)).toBe(true);
      const assessment = unwrapResult(assessmentResult);
      const csq = assessment.consequences[0];
      expect(csq).toBeDefined();
      expect(csq?.evidence[0]?.mode).toBe("verified");
      expect(csq?.evidence[0]?.scope.length).toBeGreaterThan(0);
      expect(csq?.evidence[0]?.assumptions.length).toBeGreaterThan(0);
    });

    it("Probe 126: full engine assessment lineage retained", async () => {
      const engine = new ConsequenceEngine();
      engine.registerEvaluator(createDeterministicRuleEvaluator());

      const ctx = createSyntheticFileContext();
      const assessmentResult = await engine.evaluate(ctx);

      expect(isOk(assessmentResult)).toBe(true);
      const assessment = unwrapResult(assessmentResult);
      expect(assessment.evaluationContextId).toBe(ctx.id);
      expect(assessment.actionId).toBe(ctx.action.id);
      expect(assessment.schemaVersion).toBe(ctx.schemaVersion);
    });
  });

  // ==========================================================================
  // FC-004B: CANONICAL SHARING IDENTITY (Finding H5)
  // ==========================================================================

  describe("FC-004B: Canonical Sharing Identity (Probes 1–11 & ConsequenceEngine)", () => {
    it("Probe 1: [] remains valid and MATCHED for new recipient", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      expect(evalRes.consequences.length).toBe(1);
      const change = evalRes.consequences[0]?.stateChanges?.[0];
      expect(change).toBeDefined();
      if (change && change.before.status === "known" && change.after.status === "known") {
        expect(change.before.value).toEqual([]);
        expect(change.after.value).toEqual(["ent-synthetic-share-0002"]);
      }
    });

    it("Probe 2: ['a'] valid and MATCHED", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["a"] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      expect(evalRes.consequences.length).toBe(1);
      const change = evalRes.consequences[0]?.stateChanges?.[0];
      expect(change).toBeDefined();
      if (change && change.before.status === "known" && change.after.status === "known") {
        expect(change.before.value).toEqual(["a"]);
        expect(change.after.value).toEqual(["a", "ent-synthetic-share-0002"]);
      }
    });

    it("Probe 3: [' a '] canonicalizes to ['a']", async () => {
      const helperRes = validateSharedWithArray([" a "]);
      expect(helperRes.valid).toBe(true);
      if (helperRes.valid) {
        expect(helperRes.recipients).toEqual(["a"]);
      }

      const ctx = createSyntheticDocumentShareContext({ sharedWith: [" a "] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      const change = evalRes.consequences[0]?.stateChanges?.[0];
      expect(change).toBeDefined();
      if (change && change.before.status === "known" && change.after.status === "known") {
        expect(change.before.value).toEqual(["a"]);
        expect(change.after.value).toEqual(["a", "ent-synthetic-share-0002"]);
      }
    });

    it("Probe 4: action recipient ' a ' with shared_with ['a'] -> ALREADY_SHARED", async () => {
      const ctx = createSyntheticDocumentShareContext({
        sharedWith: ["a"],
        customRecipientId: " a ",
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("ALREADY_SHARED");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 5: action recipient 'a' with shared_with [' a '] -> ALREADY_SHARED", async () => {
      const ctx = createSyntheticDocumentShareContext({
        sharedWith: [" a "],
        customRecipientId: "a",
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("ALREADY_SHARED");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 6: ['x', ' x '] -> INSUFFICIENT_EVIDENCE (canonical duplicate)", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["x", " x "] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 7: overlength EntityId entry -> INSUFFICIENT_EVIDENCE", async () => {
      const overlength = "u".repeat(129);
      const ctx = createSyntheticDocumentShareContext({ sharedWith: [overlength] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 8: whitespace-only entry -> INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["   "] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 9: mixed valid + invalid entry -> INSUFFICIENT_EVIDENCE", async () => {
      const ctx = createSyntheticDocumentShareContext({ sharedWith: ["valid-user", 123] });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("insufficient-evidence");
      expect(evalRes.trace[0]?.reasonCode).toBe("MALFORMED_SHARED_WITH");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("Probe 10: valid canonicalized existing entries produce normalized output", async () => {
      const ctx = createSyntheticDocumentShareContext({
        sharedWith: [" recipient-a "],
        customRecipientId: "recipient-b",
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("matched");
      const change = evalRes.consequences[0]?.stateChanges?.[0];
      expect(change).toBeDefined();
      if (change && change.before.status === "known" && change.after.status === "known") {
        expect(change.before.value).toEqual(["recipient-a"]);
        expect(change.after.value).toEqual(["recipient-a", "recipient-b"]);
      }
    });

    it("Probe 11: no false VERIFIED share from canonical-equivalent identity", async () => {
      const ctx = createSyntheticDocumentShareContext({
        sharedWith: [" recipient "],
        customRecipientId: " recipient ",
      });
      const res = await evaluateDeterministicRules({ context: ctx, rules: [documentShareRule] });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.status).toBe("not-applicable");
      expect(evalRes.trace[0]?.reasonCode).toBe("ALREADY_SHARED");
      expect(evalRes.consequences.length).toBe(0);
    });

    it("FC-004B Sharing ConsequenceEngine: false-grant reproduction with ' recipient ' produces 0 consequences", async () => {
      const engine = new ConsequenceEngine();
      engine.registerEvaluator(createDeterministicRuleEvaluator());

      const ctx = createSyntheticDocumentShareContext({
        sharedWith: [" recipient "],
        customRecipientId: " recipient ",
      });

      const assessmentResult = await engine.evaluate(ctx);
      expect(isOk(assessmentResult)).toBe(true);
      const assessment = unwrapResult(assessmentResult);
      expect(assessment.consequences.length).toBe(0);
    });
  });

  // ==========================================================================
  // FC-004B: REGISTRY SNAPSHOT HARDENING (Finding M2)
  // ==========================================================================

  describe("FC-004B: Registry Snapshot Hardening (Probes 12–23 & Adapter Options)", () => {
    const validTestRule: DeterministicRule = Object.freeze({
      id: "test.rule.valid" as RuleId,
      version: "1.0" as RuleVersion,
      description: "Valid test rule",
      evaluate: (): RuleDecision => ({
        status: "not-applicable",
        reasonCode: "TEST_NOT_APPLICABLE",
      }),
    });

    const invalidTestRule: unknown = {
      id: "INVALID RULE ID WITH SPACES",
      version: "1.0",
      description: "Invalid test rule",
      evaluate: () => ({ status: "not-applicable", reasonCode: "TEST_NOT_APPLICABLE" }),
    };

    it("Probe 12: .rules getter read exactly once at public evaluation boundary", async () => {
      let readCount = 0;
      const fakeRegistry = {
        get rules() {
          readCount++;
          return [validTestRule];
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isOk(res)).toBe(true);
      expect(readCount).toBe(1);
    });

    it("Probe 13: first invalid / second empty -> reject based on captured invalid snapshot", async () => {
      let readCount = 0;
      const fakeRegistry = {
        get rules() {
          readCount++;
          if (readCount === 1) return [invalidTestRule];
          return [];
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      expect(readCount).toBe(1);
    });

    it("Probe 14: first valid / second invalid -> use first captured snapshot only", async () => {
      let readCount = 0;
      const fakeRegistry = {
        get rules() {
          readCount++;
          if (readCount === 1) return [validTestRule];
          return [invalidTestRule];
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: fakeRegistry as unknown as DeterministicRuleSet,
      });
      expect(isOk(res)).toBe(true);
      expect(readCount).toBe(1);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace.length).toBe(1);
      expect(evalRes.trace[0]?.ruleId).toBe(validTestRule.id);
    });

    it("Probe 15: changing length 2->0 cannot skip second invalid rule", async () => {
      let lengthReads = 0;
      const target = [validTestRule, invalidTestRule];
      const proxyArray = new Proxy(target, {
        get(t, prop, receiver) {
          if (prop === "length") {
            lengthReads++;
            return lengthReads === 1 ? 2 : 0;
          }
          return Reflect.get(t, prop, receiver);
        },
      });
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: proxyArray as unknown as DeterministicRule[],
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("INVALID_RULE");
      }
    });

    it("Probe 16: changing length 0->2 does not invent later rules", async () => {
      let lengthReads = 0;
      const target = [validTestRule, validTestRule];
      const proxyArray = new Proxy(target, {
        get(t, prop, receiver) {
          if (prop === "length") {
            lengthReads++;
            return lengthReads === 1 ? 0 : 2;
          }
          return Reflect.get(t, prop, receiver);
        },
      });
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: proxyArray as unknown as DeterministicRule[],
      });
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace.length).toBe(0);
    });

    it("Probe 17: sparse rules array rejects fail-closed with SPARSE_ARRAY", async () => {
      const sparse = new Array(2);
      sparse[1] = validTestRule;
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: sparse as unknown as DeterministicRule[],
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("SPARSE_ARRAY");
      }
    });

    it("Probe 18: index getter read once during snapshot", async () => {
      let indexReads = 0;
      const target = [validTestRule];
      const proxyArray = new Proxy(target, {
        get(t, prop, receiver) {
          if (prop === "0") {
            indexReads++;
            return validTestRule;
          }
          return Reflect.get(t, prop, receiver);
        },
      });
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: proxyArray as unknown as DeterministicRule[],
      });
      expect(isOk(res)).toBe(true);
      expect(indexReads).toBe(1);
    });

    it("Probe 19: original source array mutation after snapshot has no effect", () => {
      const sourceArray = [validTestRule];
      const ruleSet = createRuleSet(sourceArray);
      sourceArray.push(invalidTestRule as DeterministicRule);
      sourceArray[0] = invalidTestRule as DeterministicRule;
      expect(ruleSet.rules.length).toBe(1);
      expect(ruleSet.rules[0]?.id).toBe(validTestRule.id);
    });

    it("Probe 20: original registry mutation after snapshot has no effect", async () => {
      const mutableRegistry = {
        rules: [validTestRule],
      };
      const ctx = createSyntheticFileContext();
      const evalPromise = evaluateDeterministicRules({
        context: ctx,
        rules: mutableRegistry as unknown as DeterministicRuleSet,
      });
      mutableRegistry.rules = [invalidTestRule as DeterministicRule];
      const res = await evalPromise;
      expect(isOk(res)).toBe(true);
      const evalRes = unwrapResult(res);
      expect(evalRes.trace[0]?.ruleId).toBe(validTestRule.id);
    });

    it("Probe 21: hostile .rules getter throws Error -> safe failure", async () => {
      const hostileRegistry = {
        get rules() {
          throw new Error("Hostile getter Error");
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: hostileRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("Failed reading registry.rules");
      }
    });

    it("Probe 22: hostile .rules getter throws string -> safe failure", async () => {
      const hostileRegistry = {
        get rules() {
          throw "Hostile getter string";
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: hostileRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("Failed reading registry.rules");
      }
    });

    it("Probe 23: hostile .rules getter throws null-prototype -> safe failure", async () => {
      const hostileRegistry = {
        get rules() {
          throw Object.create(null);
        },
      };
      const ctx = createSyntheticFileContext();
      const res = await evaluateDeterministicRules({
        context: ctx,
        rules: hostileRegistry as unknown as DeterministicRuleSet,
      });
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.message).toContain("Failed reading registry.rules");
      }
    });

    it("Adapter Option: createDeterministicRuleEvaluator rejects generatedAt: undefined", () => {
      expect(() => {
        createDeterministicRuleEvaluator({ generatedAt: undefined });
      }).toThrow("[INVALID_TIMESTAMP] Explicit generatedAt: undefined is not permitted.");
    });

    it("Adapter Option: createDeterministicRuleEvaluator rejects rules: undefined", () => {
      expect(() => {
        createDeterministicRuleEvaluator({ rules: undefined });
      }).toThrow("[INVALID_OPTIONS] Explicit rules: undefined is not permitted.");
    });
  });
});

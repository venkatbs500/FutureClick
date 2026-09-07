/**
 * Heterogeneous domain test scenarios for Sprint FC-002 / FC-002A:
 * Demonstrates that the canonical domain model cleanly represents diverse domains
 * without baking platform-specific concepts into the core schema.
 *
 * SCENARIOS:
 * A: Filesystem deletion
 * B: Repository visibility change
 * C: Document sharing
 * D: Subscription purchase
 *
 * NOTE: These are synthetic domain test representations only. No platform APIs, AI predictions,
 * or live external systems are executed or claimed as existing functionality.
 */

import type { IsoTimestamp } from "@futureclick/shared";
import {
  type ActionEvaluationContext,
  type ActionId,
  type Consequence,
  type ConsequenceAssessment,
  type ConsequenceId,
  type EntityId,
  type EvidenceId,
  type ObservationId,
  createActionEvaluationContext,
  createCanonicalEntity,
  createConfidenceScore,
  createConsequence,
  createConsequenceAssessment,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  validateActionEvaluationContext,
  validateConsequenceAssessment,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("Scenario A: Filesystem Deletion (Synthetic Test Representation)", () => {
  it("constructs representative state, action, and consequence models for file deletion", () => {
    const desktopEnv = {
      environmentId: "env-macos-finder",
      kind: "filesystem" as const,
      platform: "macos" as const,
      application: { id: "com.apple.finder", name: "Finder", version: "14.5" },
    };

    const fileEntity = createCanonicalEntity({
      id: "ent-file-report-pdf" as EntityId,
      kind: "file",
      label: "Q3_Financial_Report.pdf",
      attributes: {
        path: "/Users/alice/Documents/Q3_Financial_Report.pdf",
        extension: "pdf",
      },
    });

    const fileFact = createStateFact({
      id: "fact-file-exists" as ObservationId,
      subjectEntityId: fileEntity.id,
      key: "filesystem.exists",
      value: true,
      observedAt: "2026-09-06T21:00:00.000Z" as IsoTimestamp,
    });

    const state = createStateSnapshot({
      environment: desktopEnv,
      entities: [fileEntity],
      facts: [fileFact],
      observedAt: "2026-09-06T21:00:00.000Z" as IsoTimestamp,
    });

    const deleteAction = createProposedAction({
      id: "act-delete-file" as ActionId,
      proposedAt: "2026-09-06T21:00:01.000Z" as IsoTimestamp,
      environment: desktopEnv,
      actor: { kind: "human", id: "user-alice" },
      intent: { verb: "delete", domain: "filesystem" },
      targets: [{ entityId: fileEntity.id, role: "primary" }],
      parameters: { moveToTrash: true, permanent: false },
      executionStatus: "proposed",
    });

    const context: ActionEvaluationContext = createActionEvaluationContext({
      state,
      action: deleteAction,
    });

    const semRes = validateActionEvaluationContext(context);
    expect(semRes.valid).toBe(true);
    expect(semRes.issues).toEqual([]);

    // Consequence representing deletion: data-loss, before=known, after=absent, reversible via Trash
    const consequence: Consequence = createConsequence({
      id: "csq-file-deleted" as ConsequenceId,
      actionId: deleteAction.id,
      kind: "data-loss",
      summary:
        "File 'Q3_Financial_Report.pdf' will be moved to the Trash and removed from its directory.",
      affectedEntities: [fileEntity.id],
      stateChanges: [
        {
          entityId: fileEntity.id,
          property: "filesystem.exists",
          operation: "remove",
          before: { status: "known", value: true },
          after: { status: "absent" },
        },
      ],
      evidence: [
        {
          id: "ev-verified-trash" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T21:00:02.000Z" as IsoTimestamp,
          scope: "local-macos-gui-trash",
          assumptions: [
            {
              id: "asmp-trash-enabled",
              statement:
                "User has write access to the Trash folder and filesystem is not read-only.",
              status: "assumed",
            },
          ],
          confidence: createConfidenceScore(1.0),
          summary:
            "Deterministic OS rule: GUI deletion without modifier keys relocates files to ~/.Trash.",
        },
        {
          id: "ev-simulated-space" as EvidenceId,
          mode: "simulated",
          source: "simulation",
          observedAt: "2026-09-06T21:00:02.000Z" as IsoTimestamp,
          scope: "sandbox-inode-check",
          assumptions: [],
          confidence: createConfidenceScore(0.99),
          summary:
            "Dry-run sandbox check confirmed directory inode availability and absence of file locks.",
        },
        {
          id: "ev-predicted-restore" as EvidenceId,
          mode: "predicted",
          source: "model",
          observedAt: "2026-09-06T21:00:02.000Z" as IsoTimestamp,
          scope: "statistical-restore-model",
          assumptions: [],
          confidence: createConfidenceScore(0.88),
          summary:
            "Probabilistic prediction: user retains 92% likelihood of file recovery from Trash within 30 days.",
        },
      ],
      confidence: createConfidenceScore(0.98),
      reversibility: {
        level: "reversible",
        method: "Restore from Trash / Put Back",
        timeWindow: "Until Trash is emptied",
      },
      risk: {
        severity: "medium",
        categories: ["data-loss"],
        description: "File will become inaccessible to local applications until restored.",
      },
      temporal: {
        timing: "immediate",
        frequency: "once",
      },
    });

    const assessment: ConsequenceAssessment = createConsequenceAssessment({
      evaluationContextId: context.id,
      actionId: deleteAction.id,
      consequences: [consequence],
      provenance: {
        source: "adapter",
        engineVersion: "0.2.0",
        timestamp: "2026-09-06T21:00:03.000Z" as IsoTimestamp,
      },
    });

    const asmtSemRes = validateConsequenceAssessment(assessment, context);
    expect(asmtSemRes.valid).toBe(true);
    expect(consequence.evidence.length).toBe(3);
    expect(consequence.evidence[0]?.mode).toBe("verified");
    expect(consequence.evidence[1]?.mode).toBe("simulated");
    expect(consequence.evidence[2]?.mode).toBe("predicted");
    expect(consequence.stateChanges[0]?.after.status).toBe("absent");
  });
});

describe("Scenario B: Repository Visibility Change (Synthetic Test Representation)", () => {
  it("constructs representative state, action, and consequence models for visibility change", () => {
    const webEnv = {
      environmentId: "env-github-web",
      kind: "browser" as const,
      platform: "web" as const,
      application: { id: "github-web", name: "GitHub Web", version: "2026.09" },
    };

    const repoEntity = createCanonicalEntity({
      id: "ent-repo-core" as EntityId,
      kind: "repository",
      label: "acme-corp/secret-algo",
      attributes: {
        organization: "acme-corp",
        repositoryName: "secret-algo",
      },
    });

    const visibilityFact = createStateFact({
      id: "fact-repo-vis" as ObservationId,
      subjectEntityId: repoEntity.id,
      key: "repository.visibility",
      value: "private",
    });

    const state = createStateSnapshot({
      environment: webEnv,
      entities: [repoEntity],
      facts: [visibilityFact],
      observedAt: "2026-09-06T21:05:00.000Z" as IsoTimestamp,
    });

    const publishAction = createProposedAction({
      id: "act-publish-repo" as ActionId,
      proposedAt: "2026-09-06T21:05:01.000Z" as IsoTimestamp,
      environment: webEnv,
      actor: { kind: "human", id: "user-admin" },
      intent: { verb: "publish", domain: "version_control" },
      targets: [{ entityId: repoEntity.id, role: "primary" }],
      parameters: { newVisibility: "public" },
      executionStatus: "proposed",
    });

    const context = createActionEvaluationContext({ state, action: publishAction });
    expect(validateActionEvaluationContext(context).valid).toBe(true);

    const consequence = createConsequence({
      actionId: publishAction.id,
      kind: "data-exposure",
      summary:
        "Repository visibility will change from private to public, exposing codebase to the public internet.",
      affectedEntities: [repoEntity.id],
      stateChanges: [
        {
          entityId: repoEntity.id,
          property: "repository.visibility",
          operation: "replace",
          before: { status: "known", value: "private" },
          after: { status: "known", value: "public" },
        },
      ],
      evidence: [
        {
          id: "ev-rule-repo" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T21:05:02.000Z" as IsoTimestamp,
          scope: "github-access-control-spec",
          assumptions: [],
          confidence: createConfidenceScore(1.0),
          summary:
            "Version control platform API specification indicates public visibility permits unauthenticated reads.",
        },
      ],
      confidence: createConfidenceScore(1.0),
      reversibility: {
        level: "partially_reversible",
        method: "Set repository back to private",
        requirements: ["Any git clones or web archives created while public cannot be revoked."],
      },
      risk: {
        severity: "critical",
        categories: ["privacy", "security", "data-loss"],
        description:
          "Proprietary source code, commit history, and potential credentials will become world-readable.",
      },
      temporal: {
        timing: "immediate",
        frequency: "once",
      },
    });

    expect(consequence.kind).toBe("data-exposure");
    expect(consequence.risk.severity).toBe("critical");
    expect(consequence.reversibility.level).toBe("partially_reversible");
  });
});

describe("Scenario C: Document Sharing (Synthetic Test Representation)", () => {
  it("constructs representative state, action, and consequence models for document sharing", () => {
    const cloudEnv = {
      environmentId: "env-gsuite-web",
      kind: "application" as const,
      platform: "web" as const,
      application: { id: "doc-editor", name: "DocumentEditor", version: "3.1" },
    };

    const docEntity = createCanonicalEntity({
      id: "ent-doc-strategy" as EntityId,
      kind: "document",
      label: "2027_Strategy.gdoc",
      attributes: { mimeType: "application/vnd.google-apps.document" },
    });

    const recipientEntity = createCanonicalEntity({
      id: "ent-user-bob" as EntityId,
      kind: "account",
      label: "bob@contractor.com",
    });

    const shareFact = createStateFact({
      id: "fact-share-count" as ObservationId,
      subjectEntityId: docEntity.id,
      key: "document.shared_user_count",
      value: 1,
    });

    const state = createStateSnapshot({
      environment: cloudEnv,
      entities: [docEntity, recipientEntity],
      facts: [shareFact],
      observedAt: "2026-09-06T21:10:00.000Z" as IsoTimestamp,
    });

    const shareAction = createProposedAction({
      id: "act-share-doc" as ActionId,
      proposedAt: "2026-09-06T21:10:01.000Z" as IsoTimestamp,
      environment: cloudEnv,
      actor: { kind: "human", id: "user-alice" },
      intent: { verb: "share", domain: "collaboration" },
      targets: [
        { entityId: docEntity.id, role: "primary" },
        { entityId: recipientEntity.id, role: "recipient" },
      ],
      parameters: { role: "viewer", sendNotification: true },
      executionStatus: "proposed",
    });

    const context = createActionEvaluationContext({ state, action: shareAction });
    const semRes = validateActionEvaluationContext(context);
    expect(semRes.valid).toBe(true);

    const consequence = createConsequence({
      actionId: shareAction.id,
      kind: "data-exposure",
      summary:
        "Document will be shared with external contractor bob@contractor.com with viewer permissions.",
      affectedEntities: [docEntity.id, recipientEntity.id],
      stateChanges: [
        {
          entityId: docEntity.id,
          property: "document.shared_user_count",
          operation: "replace",
          before: { status: "known", value: 1 },
          after: { status: "known", value: 2 },
        },
      ],
      evidence: [
        {
          id: "ev-doc-policy" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T21:10:02.000Z" as IsoTimestamp,
          scope: "acl-policy-enforcement",
          assumptions: [],
          confidence: createConfidenceScore(1.0),
          summary: "ACL update grants external identity access token upon verification.",
        },
      ],
      confidence: createConfidenceScore(0.99),
      reversibility: {
        level: "reversible",
        method: "Revoke user access in document sharing dialogue",
      },
      risk: {
        severity: "medium",
        categories: ["privacy", "security"],
        description: "External collaborator receives access to confidential internal roadmap.",
      },
      temporal: {
        timing: "immediate",
        frequency: "once",
      },
    });

    expect(consequence.affectedEntities.length).toBe(2);
    expect(consequence.kind).toBe("data-exposure");
  });
});

describe("Scenario D: Subscription Purchase (Synthetic Test Representation)", () => {
  it("constructs representative state, action, and consequence models for subscription", () => {
    const serviceEnv = {
      environmentId: "env-billing-portal",
      kind: "service" as const,
      platform: "web" as const,
      application: { id: "cloud-billing", name: "CloudBillingService", version: "1.0" },
    };

    const subEntity = createCanonicalEntity({
      id: "ent-sub-enterprise" as EntityId,
      kind: "subscription",
      label: "Enterprise AI Tier",
      attributes: { planTier: "enterprise" },
    });

    const subFact = createStateFact({
      id: "fact-sub-status" as ObservationId,
      subjectEntityId: subEntity.id,
      key: "subscription.status",
      value: "inactive",
    });

    const state = createStateSnapshot({
      environment: serviceEnv,
      entities: [subEntity],
      facts: [subFact],
      observedAt: "2026-09-06T21:15:00.000Z" as IsoTimestamp,
    });

    const subAction = createProposedAction({
      id: "act-subscribe" as ActionId,
      proposedAt: "2026-09-06T21:15:01.000Z" as IsoTimestamp,
      environment: serviceEnv,
      actor: { kind: "human", id: "buyer-finance" },
      intent: { verb: "subscribe", domain: "billing" },
      targets: [{ entityId: subEntity.id, role: "resource" }],
      parameters: { billingInterval: "monthly", autoRenew: true },
      executionStatus: "proposed",
    });

    const context = createActionEvaluationContext({ state, action: subAction });
    expect(validateActionEvaluationContext(context).valid).toBe(true);

    const consequence = createConsequence({
      actionId: subAction.id,
      kind: "financial",
      summary:
        "An immediate charge of $499 USD will occur, with automatic recurring monthly renewal.",
      affectedEntities: [subEntity.id],
      stateChanges: [
        {
          entityId: subEntity.id,
          property: "subscription.status",
          operation: "replace",
          before: { status: "known", value: "inactive" },
          after: { status: "known", value: "active" },
        },
      ],
      evidence: [
        {
          id: "ev-pricing-terms" as EvidenceId,
          mode: "verified",
          source: "rule",
          observedAt: "2026-09-06T21:15:02.000Z" as IsoTimestamp,
          scope: "billing-terms-of-service",
          assumptions: [
            {
              id: "asmp-card-valid",
              statement: "Payment method on file has sufficient funds and is active.",
              status: "assumed",
            },
          ],
          confidence: createConfidenceScore(1.0),
          summary: "Stated terms of service and billing schedule mandate recurring monthly debit.",
        },
      ],
      confidence: createConfidenceScore(0.99),
      reversibility: {
        level: "partially_reversible",
        method: "Cancel future renewals; prior billing cycles may require support refund request.",
        timeWindow: "Cancel anytime before next billing cycle",
      },
      risk: {
        severity: "medium",
        categories: ["financial"],
        description: "Commitment to ongoing operational expenditure.",
      },
      temporal: {
        timing: "immediate",
        frequency: "recurring",
      },
    });

    expect(consequence.kind).toBe("financial");
    expect(consequence.temporal?.timing).toBe("immediate");
    expect(consequence.temporal?.frequency).toBe("recurring");
    expect(consequence.reversibility.level).toBe("partially_reversible");
  });
});

/**
 * Deterministic Rule-Set Evaluation & Orchestration (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Executes pure, deterministic rules against an authoritative ActionEvaluationContext
 * and its structurally indexed ActionGraph.
 *
 * Guarantees:
 * - Authoritative input validation: context validated before any rule executes.
 * - Rules receive runtime-frozen, detached context and context-only ActionGraph.
 * - Graph and context are strictly consistent (evaluator constructs graph from context).
 * - ActionGraph metadata is deterministic: resolves to explicit timestamp or context.createdAt.
 * - Graph structural IDs use a local deterministic generator, decoupled from consequence ID generation.
 * - Conservative conflict detection: conflicting or duplicate property changes fail closed.
 * - ID generator injection with normalized post-validation duplicate ID detection.
 * - Consequence drafts must explicitly specify confidence; no evaluator fallback default.
 * - Generated consequences authoritatively validated with validateConsequence.
 * - Exception safety: hostile rule and generator throws normalized to standard Error.
 * - Deterministic ordering: trace and consequences follow rule registration order.
 * - Deep runtime immutability on outputs.
 */

import {
  type ActionEvaluationContext,
  type Consequence,
  type ConsequenceId,
  type EvidenceId,
  type EvidenceRecord,
  FUTURECLICK_SCHEMA_VERSION,
  createConfidenceScore,
  deepFreezeCanonical,
  isPlainObject,
  isValidConfidenceScore,
  normalizeThrownError,
  readOwnProperty,
  validateActionEvaluationContext,
  validateConsequence,
  validateEvidenceRecord,
  validateIsoTimestamp,
} from "@futureclick/action-schema";
import { type ActionGraph, buildActionGraph } from "@futureclick/action-graph";
import {
  type IdGenerator,
  type IsoTimestamp,
  type Result,
  createDeterministicIdGenerator,
  err,
  generateEntityId,
  ok,
} from "@futureclick/shared";
import type { EvaluatorResult, IConsequenceEvaluator } from "../interfaces.js";
import { createDefaultRuleSet } from "./builtin/index.js";
import { type RuleStateChangeEntry, detectStateChangeConflicts } from "./conflicts.js";
import { createRuleSet } from "./registry.js";
import type {
  ConsequenceDraft,
  DeterministicEvaluationResult,
  DeterministicRule,
  DeterministicRuleSet,
  EvaluateDeterministicRulesOptions,
  RuleDecision,
  RuleTraceEntry,
} from "./types.js";
import { validateRuleDecision } from "./validation.js";

/**
 * Evaluates a set of deterministic rules against an ActionEvaluationContext.
 *
 * @param options Evaluation options containing the context and optional rules/idGenerator/generatedAt.
 * @returns Result containing the derived consequences, rule trace, and timestamp, or an Error.
 */
export async function evaluateDeterministicRules(
  options: EvaluateDeterministicRulesOptions,
): Promise<Result<DeterministicEvaluationResult, Error>> {
  try {
    // 1. Validate options object
    if (!isPlainObject(options)) {
      return err(new Error("[INVALID_OPTIONS] Evaluation options must be a plain object."));
    }

    // Safe read of context
    const contextRead = readOwnProperty(options, "context");
    if (contextRead.status === "error") {
      return err(new Error("[READ_ERROR] Failed reading options.context."));
    }
    if (
      contextRead.status === "absent" ||
      contextRead.value === undefined ||
      contextRead.value === null
    ) {
      return err(new Error("[INVALID_CONTEXT] Context must be provided."));
    }

    const rawContext = contextRead.value;

    // 2. Authoritative context validation
    const contextValidation = validateActionEvaluationContext(rawContext);
    if (!contextValidation.valid) {
      const issuesMsg = contextValidation.issues
        .map((iss) => `[${iss.code}] ${iss.path}: ${iss.message}`)
        .join("; ");
      return err(new Error(`[INVALID_CONTEXT] ActionEvaluationContext is invalid: ${issuesMsg}`));
    }

    // Evaluator and rules receive validated, detached, deeply frozen context
    const validContext = deepFreezeCanonical(contextValidation.value);

    // 3. Resolve and validate rule set (Finding M2: Eliminate registry bypass & coherent snapshot)
    const rulesRead = readOwnProperty(options, "rules");
    if (rulesRead.status === "error") {
      return err(new Error("[READ_ERROR] Failed reading options.rules."));
    }

    let ruleSet: DeterministicRuleSet;
    if (rulesRead.status === "absent") {
      ruleSet = createDefaultRuleSet();
    } else if (rulesRead.status === "present" && rulesRead.value === undefined) {
      return err(new Error("[INVALID_OPTIONS] Explicit rules: undefined is not permitted."));
    } else if (Array.isArray(rulesRead.value)) {
      try {
        ruleSet = createRuleSet(rulesRead.value);
      } catch (thrown) {
        return err(normalizeThrownError(thrown, "Failed to create rule set."));
      }
    } else if (isPlainObject(rulesRead.value)) {
      // Capture .rules property exactly ONCE using safe property access (FC-004B M2)
      const regRulesRead = readOwnProperty(rulesRead.value, "rules");
      if (regRulesRead.status === "error") {
        return err(new Error("[READ_ERROR] Failed reading registry.rules property."));
      }
      if (regRulesRead.status === "absent") {
        return err(
          new Error(
            "[INVALID_RULESET] Registry-shaped object is missing required 'rules' property.",
          ),
        );
      }
      if (regRulesRead.status === "present" && regRulesRead.value === undefined) {
        return err(new Error("[INVALID_RULESET] Registry-shaped object has 'rules: undefined'."));
      }
      if (!Array.isArray(regRulesRead.value)) {
        return err(new Error("[INVALID_RULESET] Registry 'rules' property must be an array."));
      }

      // Authoritatively normalize definitions through createRuleSet; do not trust getRule duck typing (Finding M2)
      try {
        ruleSet = createRuleSet(regRulesRead.value);
      } catch (thrown) {
        return err(normalizeThrownError(thrown, "Failed to normalize rule set."));
      }
    } else {
      return err(
        new Error(
          "[INVALID_OPTIONS] 'rules' option must be an array of DeterministicRule or a DeterministicRuleSet.",
        ),
      );
    }

    // 4. Resolve timestamp deterministically (Findings L4 & M5)
    const genAtRead = readOwnProperty(options, "generatedAt");
    if (genAtRead.status === "error") {
      return err(new Error("[READ_ERROR] Failed reading options.generatedAt."));
    }

    let evaluationTime: IsoTimestamp;
    if (genAtRead.status === "present") {
      if (genAtRead.value === undefined) {
        return err(
          new Error("[INVALID_TIMESTAMP] Explicit generatedAt: undefined is not permitted."),
        );
      }
      const tsRes = validateIsoTimestamp(genAtRead.value, "options.generatedAt");
      if (!tsRes.valid) {
        return err(
          new Error(
            `[INVALID_TIMESTAMP] Invalid generatedAt timestamp: ${tsRes.issues.map((i) => i.message).join(", ")}`,
          ),
        );
      }
      evaluationTime = tsRes.value;
    } else {
      // Default deterministically to context timestamp, never system wall-clock (Finding M5)
      evaluationTime = validContext.createdAt;
    }

    // 5. Construct ActionGraph with isolated deterministic ID generator (Finding M5)
    let graph: ActionGraph;
    try {
      const graphIdGenerator = createDeterministicIdGenerator("graph-det");
      graph = buildActionGraph({
        context: validContext,
        idGenerator: graphIdGenerator,
        generatedAt: evaluationTime,
      });
    } catch (thrown) {
      return err(
        normalizeThrownError(thrown, "Failed to build context-only ActionGraph from context."),
      );
    }

    // Read idGenerator for consequences
    const idGenRead = readOwnProperty(options, "idGenerator");
    if (idGenRead.status === "error") {
      return err(new Error("[READ_ERROR] Failed reading options.idGenerator."));
    }
    const idGenerator: IdGenerator | undefined =
      idGenRead.status === "present" && idGenRead.value !== undefined
        ? (idGenRead.value as IdGenerator)
        : undefined;

    // 6. Execute rules sequentially in registration order
    const trace: RuleTraceEntry[] = [];
    const matchedRuleEntries: Array<{
      rule: DeterministicRule;
      drafts: readonly ConsequenceDraft[];
    }> = [];

    for (const rule of ruleSet.rules) {
      let decision: RuleDecision;
      try {
        decision = await rule.evaluate({ context: validContext, graph });
      } catch (thrown) {
        return err(
          normalizeThrownError(
            thrown,
            `Rule "${rule.id}" threw an unhandled exception during evaluation.`,
          ),
        );
      }

      const decisionVal = validateRuleDecision(decision, `rule[${rule.id}].decision`);
      if (!decisionVal.valid) {
        const issuesMsg = decisionVal.issues
          .map((iss) => `[${iss.code}] ${iss.path}: ${iss.message}`)
          .join("; ");
        return err(
          new Error(
            `[INVALID_RULE_OUTPUT] Rule "${rule.id}" returned an invalid decision: ${issuesMsg}`,
          ),
        );
      }

      const validDecision = decisionVal.value;

      if (validDecision.status === "matched") {
        trace.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          status: "matched",
          reasonCode: "MATCHED",
        });
        matchedRuleEntries.push({
          rule,
          drafts: validDecision.drafts,
        });
      } else if (validDecision.status === "not-applicable") {
        trace.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          status: "not-applicable",
          reasonCode: validDecision.reasonCode,
        });
      } else {
        // insufficient-evidence
        trace.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          status: "insufficient-evidence",
          reasonCode: validDecision.reasonCode,
          ...(validDecision.missing ? { missing: validDecision.missing } : {}),
        });
      }
    }

    // 7. Perform conservative state change conflict detection across all matched drafts
    const collectedStateChanges: RuleStateChangeEntry[] = [];
    for (const { rule, drafts } of matchedRuleEntries) {
      for (let draftIndex = 0; draftIndex < drafts.length; draftIndex++) {
        const draft = drafts[draftIndex];
        if (draft?.stateChanges) {
          for (const stateChange of draft.stateChanges) {
            collectedStateChanges.push({
              rule,
              draftIndex,
              stateChange,
            });
          }
        }
      }
    }

    const conflictResult = detectStateChangeConflicts(collectedStateChanges);
    if (!conflictResult.ok) {
      return err(conflictResult.error);
    }

    // 8. Construct canonical consequences from drafts with normalized ID uniqueness check (Findings H6 & M3)
    const consequences: Consequence[] = [];
    const normalizedConsequenceIds = new Set<string>();
    const normalizedEvidenceIds = new Set<string>();

    for (const { rule, drafts } of matchedRuleEntries) {
      for (const draft of drafts) {
        // Generate candidate consequence ID safely
        let csqId: string;
        try {
          csqId = idGenerator
            ? idGenerator.generate<"ConsequenceId">("csq")
            : generateEntityId<"ConsequenceId">("csq");
        } catch (thrown) {
          return err(
            normalizeThrownError(
              thrown,
              "ID generator threw an unhandled exception during ConsequenceId generation.",
            ),
          );
        }

        // Generate candidate evidence records safely
        const evidenceRecords: EvidenceRecord[] = [];
        for (const evDraft of draft.evidence) {
          let evId: string;
          try {
            evId = idGenerator
              ? idGenerator.generate<"EvidenceId">("ev")
              : generateEntityId<"EvidenceId">("ev");
          } catch (thrown) {
            return err(
              normalizeThrownError(
                thrown,
                "ID generator threw an unhandled exception during EvidenceId generation.",
              ),
            );
          }

          const evRecord: EvidenceRecord = {
            id: evId as EvidenceId,
            mode: "verified",
            source: "rule",
            observedAt: evaluationTime,
            scope: evDraft.scope,
            assumptions: evDraft.assumptions,
            summary: evDraft.summary,
            ...(evDraft.confidence !== undefined ? { confidence: evDraft.confidence } : {}),
            ...(evDraft.details !== undefined ? { details: evDraft.details } : {}),
          };

          const evVal = validateEvidenceRecord(evRecord, "consequence.evidence");
          if (!evVal.valid) {
            const issuesMsg = evVal.issues
              .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
              .join("; ");
            return err(
              new Error(
                `[INVALID_RULE_OUTPUT] Generated evidence record failed validation: ${issuesMsg}`,
              ),
            );
          }
          evidenceRecords.push(evVal.value);
        }

        // Consequence confidence is strictly required; no evaluator fallback default (Finding H6)
        if (draft.confidence === undefined) {
          return err(
            new Error(
              `[INVALID_RULE_OUTPUT] Rule "${rule.id}" draft must explicitly specify confidence.`,
            ),
          );
        }

        let confidenceScore: import("@futureclick/action-schema").ConfidenceScore;
        if (isValidConfidenceScore(draft.confidence)) {
          confidenceScore = draft.confidence;
        } else if (typeof draft.confidence === "number") {
          try {
            confidenceScore = createConfidenceScore(draft.confidence);
          } catch {
            return err(
              new Error(
                `[INVALID_RULE_OUTPUT] Rule "${rule.id}" provided an invalid confidence score: ${draft.confidence}.`,
              ),
            );
          }
        } else {
          return err(
            new Error(
              `[INVALID_RULE_OUTPUT] Rule "${rule.id}" draft confidence must be a valid number or ConfidenceScore.`,
            ),
          );
        }

        const candidateConsequence: Consequence = {
          schemaVersion: FUTURECLICK_SCHEMA_VERSION,
          id: csqId as ConsequenceId,
          actionId: validContext.action.id,
          kind: draft.kind,
          summary: draft.summary,
          affectedEntities: draft.affectedEntities,
          stateChanges: draft.stateChanges ?? [],
          evidence: evidenceRecords,
          confidence: confidenceScore,
          reversibility: draft.reversibility,
          risk: draft.risk,
          ...(draft.temporal ? { temporal: draft.temporal } : {}),
          provenance: {
            source: "rule",
            ruleId: rule.id,
            timestamp: evaluationTime,
            details: { ruleVersion: rule.version },
          },
        };

        const csqVal = validateConsequence(candidateConsequence, "consequence");
        if (!csqVal.valid) {
          const issuesMsg = csqVal.issues
            .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
            .join("; ");
          return err(
            new Error(
              `[INVALID_RULE_OUTPUT] Generated consequence failed canonical validation: ${issuesMsg}`,
            ),
          );
        }

        const validatedCsq = csqVal.value;

        // Check uniqueness on NORMALIZED consequence.id (Finding M3)
        if (normalizedConsequenceIds.has(validatedCsq.id)) {
          return err(
            new Error(
              `[ID_COLLISION] Duplicate ConsequenceId "${validatedCsq.id}" after canonical normalization.`,
            ),
          );
        }
        normalizedConsequenceIds.add(validatedCsq.id);

        // Check uniqueness on NORMALIZED evidence.id (Finding M3)
        for (const ev of validatedCsq.evidence) {
          if (normalizedEvidenceIds.has(ev.id)) {
            return err(
              new Error(
                `[ID_COLLISION] Duplicate EvidenceId "${ev.id}" after canonical normalization.`,
              ),
            );
          }
          normalizedEvidenceIds.add(ev.id);
        }

        consequences.push(validatedCsq);
      }
    }

    // 9. Freeze and return result
    const result: DeterministicEvaluationResult = deepFreezeCanonical({
      consequences,
      trace,
      generatedAt: evaluationTime,
    });

    return ok(result);
  } catch (thrown) {
    return err(normalizeThrownError(thrown, "Deterministic rule evaluation failed unexpectedly."));
  }
}

// ============================================================================
// 10. CONSEQUENCE ENGINE ADAPTER
// ============================================================================

export interface CreateDeterministicRuleEvaluatorOptions {
  readonly rules?: readonly DeterministicRule[] | DeterministicRuleSet | undefined;
  readonly idGenerator?: IdGenerator | undefined;
  readonly generatedAt?: IsoTimestamp | undefined;
}

/**
 * Creates an IConsequenceEvaluator backed by the deterministic rules engine.
 *
 * Epistemological Guarantee:
 * - mode is explicitly "verified".
 * - Returns successful empty consequences when no rules match or rules abstain with insufficient evidence.
 * - Does not invent consequences or guess missing facts.
 */
export function createDeterministicRuleEvaluator(
  options?: CreateDeterministicRuleEvaluatorOptions,
): IConsequenceEvaluator {
  if (options !== undefined) {
    if (!isPlainObject(options)) {
      throw new Error("[INVALID_OPTIONS] Evaluator options must be a plain object.");
    }
    const genAtRead = readOwnProperty(options, "generatedAt");
    if (genAtRead.status === "error") {
      throw new Error("[READ_ERROR] Failed reading options.generatedAt.");
    }
    if (genAtRead.status === "present" && genAtRead.value === undefined) {
      throw new Error("[INVALID_TIMESTAMP] Explicit generatedAt: undefined is not permitted.");
    }
    const rulesRead = readOwnProperty(options, "rules");
    if (rulesRead.status === "error") {
      throw new Error("[READ_ERROR] Failed reading options.rules.");
    }
    if (rulesRead.status === "present" && rulesRead.value === undefined) {
      throw new Error("[INVALID_OPTIONS] Explicit rules: undefined is not permitted.");
    }
  }

  return {
    mode: "verified",
    kind: "deterministic-rules",
    async evaluate(context: ActionEvaluationContext): Promise<Result<EvaluatorResult, Error>> {
      let evalRules: readonly DeterministicRule[] | DeterministicRuleSet | undefined;
      let hasRules = false;
      let evalIdGen: IdGenerator | undefined;
      let hasIdGen = false;
      let evalGenAt: IsoTimestamp | undefined;
      let hasGenAt = false;

      if (options !== undefined) {
        const opts = options as CreateDeterministicRuleEvaluatorOptions;
        if (Object.prototype.hasOwnProperty.call(opts, "rules")) {
          evalRules = opts.rules;
          hasRules = true;
        }
        if (Object.prototype.hasOwnProperty.call(opts, "idGenerator")) {
          evalIdGen = opts.idGenerator;
          hasIdGen = true;
        }
        if (Object.prototype.hasOwnProperty.call(opts, "generatedAt")) {
          evalGenAt = opts.generatedAt;
          hasGenAt = true;
        }
      }

      const evalOptions: EvaluateDeterministicRulesOptions = {
        context,
        ...(hasRules ? { rules: evalRules } : {}),
        ...(hasIdGen ? { idGenerator: evalIdGen } : {}),
        ...(hasGenAt ? { generatedAt: evalGenAt } : {}),
      };
      const result = await evaluateDeterministicRules(evalOptions);

      if (!result.ok) {
        return err(result.error);
      }

      return ok({
        consequences: result.value.consequences,
      });
    },
  };
}

/**
 * ConsequenceEngine orchestrator placeholder.
 * Coordinates evaluation across verified, simulated, and predicted pipelines.
 * Enforces authoritative ActionEvaluationContext validation and produces ConsequenceAssessment.
 * Guarantees evaluators receive the validated, runtime-frozen snapshot, not the raw input.
 * Lineage identifiers (evaluationContextId, actionId) are captured before running evaluators
 * and defended via authoritative post-evaluation assessment validation.
 */

import {
  type ActionEvaluationContext,
  type Consequence,
  type ConsequenceAssessment,
  createConsequenceAssessment,
  deepFreezeCanonical,
  validateActionEvaluationContext,
  validateConsequenceAssessment,
} from "@futureclick/action-schema";
import { type Result, currentIsoTimestamp, err, ok } from "@futureclick/shared";
import type { IConsequenceEngine, IConsequenceEvaluator } from "./interfaces.js";

/**
 * Safely normalizes an unknown thrown value into an Error.
 * Protects against hostile prototypes, missing toString, or throwing getters.
 */
export function normalizeThrownError(cause: unknown, fallbackMessage: string): Error {
  try {
    if (cause instanceof Error) {
      return cause;
    }
    if (typeof cause === "string" && cause.trim().length > 0) {
      return new Error(cause);
    }
  } catch {
    return new Error(fallbackMessage);
  }
  return new Error(fallbackMessage);
}

export class ConsequenceEngine implements IConsequenceEngine {
  private readonly evaluators: IConsequenceEvaluator[] = [];

  public registerEvaluator(evaluator: IConsequenceEvaluator): void {
    this.evaluators.push(evaluator);
  }

  public get evaluatorCount(): number {
    return this.evaluators.length;
  }

  /**
   * Orchestrates registered evaluators sequentially against an authoritative ActionEvaluationContext.
   * Enforces structural and semantic validation before evaluating.
   * Freezes the validated snapshot at runtime and captures authoritative lineage IDs before evaluator dispatch.
   * If any evaluator returns or throws an error, evaluation terminates immediately
   * and returns an err(Error) without fabricating consequences.
   * Performs authoritative ConsequenceAssessment validation against the frozen context before returning.
   */
  public async evaluate(
    context: ActionEvaluationContext,
  ): Promise<Result<ConsequenceAssessment, Error>> {
    // 1. Authoritative validation of input context (structural + semantic)
    const contextValidation = validateActionEvaluationContext(context);
    if (!contextValidation.valid) {
      const errorMsg = contextValidation.issues
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
        .join("; ");
      return err(new Error(`Invalid ActionEvaluationContext: ${errorMsg}`));
    }

    // 2. Evaluators receive the validated, runtime-frozen snapshot ONLY (FC-002D)
    const validContext = deepFreezeCanonical(contextValidation.value);

    // 3. Capture authoritative lineage identifiers BEFORE evaluator execution
    const authoritativeContextId = validContext.id;
    const authoritativeActionId = validContext.action.id;

    const consequences: Consequence[] = [];

    // 4. Sequential evaluation
    for (const evaluator of this.evaluators) {
      try {
        const result = await evaluator.evaluate(validContext);
        if (result.ok) {
          consequences.push(...result.value.consequences);
        } else {
          return err(result.error);
        }
      } catch (thrown) {
        return err(normalizeThrownError(thrown, "Evaluator execution failed"));
      }
    }

    // 5. Construct canonical assessment binding captured authoritative IDs
    let assessment: ConsequenceAssessment;
    try {
      assessment = createConsequenceAssessment({
        evaluationContextId: authoritativeContextId,
        actionId: authoritativeActionId,
        consequences,
        generatedAt: currentIsoTimestamp(),
        provenance: {
          source: "engine",
          engineVersion: "0.2.0",
          timestamp: currentIsoTimestamp(),
        },
      });
    } catch (thrown) {
      return err(normalizeThrownError(thrown, "Assessment construction failed"));
    }

    // 6. Authoritative assessment validation against the validated evaluation context
    const assessmentValidation = validateConsequenceAssessment(assessment, validContext);
    if (!assessmentValidation.valid) {
      const errorMsg = assessmentValidation.issues
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
        .join("; ");
      return err(new Error(`Consequence assessment validation failed: ${errorMsg}`));
    }

    return ok(assessmentValidation.value);
  }
}

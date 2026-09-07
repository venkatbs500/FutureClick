/**
 * Interfaces for consequence evaluation and orchestration.
 * Updated for Sprint FC-002 / FC-002A / FC-002B canonical domain integration.
 *
 * Removes the EvaluationRequest wrapper to ensure exactly one source of truth:
 * ActionEvaluationContext.
 */

import type {
  ActionEvaluationContext,
  Consequence,
  ConsequenceAssessment,
  ConsequenceCategory,
  EvidenceMode,
} from "@futureclick/action-schema";
import type { Result } from "@futureclick/shared";

export interface EvaluatorResult {
  readonly consequences: readonly Consequence[];
}

export interface IConsequenceEvaluator {
  readonly mode: EvidenceMode;
  readonly kind?: ConsequenceCategory | string;
  evaluate(context: ActionEvaluationContext): Promise<Result<EvaluatorResult, Error>>;
}

export interface IConsequenceEngine {
  evaluate(context: ActionEvaluationContext): Promise<Result<ConsequenceAssessment, Error>>;
}

/**
 * Interfaces for consequence evaluation and orchestration.
 */

import type {
  ActionConsequence,
  ConsequenceKind,
  EnvironmentState,
  ProposedAction,
} from "@futureclick/action-schema";
import type { Result } from "@futureclick/shared";

export interface EvaluationRequest {
  readonly action: ProposedAction;
  readonly state: EnvironmentState;
}

export interface EvaluationResult {
  readonly consequences: readonly ActionConsequence[];
}

export interface IConsequenceEvaluator {
  readonly kind: ConsequenceKind;
  evaluate(request: EvaluationRequest): Promise<Result<EvaluationResult, Error>>;
}

export interface IConsequenceEngine {
  evaluate(request: EvaluationRequest): Promise<Result<readonly ActionConsequence[], Error>>;
}

/**
 * ConsequenceEngine orchestrator placeholder.
 * Coordinates evaluation across verified, simulated, and predicted pipelines.
 */

import type { ActionConsequence } from "@futureclick/action-schema";
import { type Result, err, ok } from "@futureclick/shared";
import type { EvaluationRequest, IConsequenceEngine, IConsequenceEvaluator } from "./interfaces.js";

export class ConsequenceEngine implements IConsequenceEngine {
  private readonly evaluators: IConsequenceEvaluator[] = [];

  public registerEvaluator(evaluator: IConsequenceEvaluator): void {
    this.evaluators.push(evaluator);
  }

  public get evaluatorCount(): number {
    return this.evaluators.length;
  }

  /**
   * Orchestrates registered evaluators sequentially.
   * If any evaluator returns or throws an error, evaluation terminates immediately
   * and returns an err(Error) without fabricating consequences.
   */
  public async evaluate(
    request: EvaluationRequest,
  ): Promise<Result<readonly ActionConsequence[], Error>> {
    const consequences: ActionConsequence[] = [];

    for (const evaluator of this.evaluators) {
      try {
        const result = await evaluator.evaluate(request);
        if (result.ok) {
          consequences.push(...result.value.consequences);
        } else {
          return result;
        }
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown : new Error(String(thrown));
        return err(error);
      }
    }

    return ok(consequences);
  }
}

/**
 * Deterministic Consequence Output Conflict Detection (Sprint FC-004)
 *
 * Epistemological Guarantee:
 * Deterministic rules provide verified derivations under stated assumptions.
 * When two rules claim the same canonical state transition:
 * - If the claimed post-states conflict: FAIL closed with RULE_OUTPUT_CONFLICT.
 *   Arbitrary selection or precedence ordering is strictly forbidden.
 * - If the claimed post-states are identical: FAIL closed with OVERLAPPING_RULE_TRANSITION.
 *   Overlapping deterministic rule ownership must be made explicit and non-overlapping.
 */

import type { StateChange, ValueState } from "@futureclick/action-schema";
import { type Result, err, ok } from "@futureclick/shared";
import type { DeterministicRule } from "./types.js";

export interface RuleStateChangeEntry {
  readonly rule: DeterministicRule;
  readonly draftIndex: number;
  readonly stateChange: StateChange;
}

function serializeValueState(state: ValueState): string {
  if (state.status === "absent" || state.status === "unknown") {
    return JSON.stringify([state.status]);
  }
  return JSON.stringify([state.status, state.value]);
}

/**
 * Checks a collection of rule-generated StateChanges for conflicts and overlapping ownership.
 *
 * @param entries List of StateChanges tagged with their producing rule.
 * @returns Result.ok if no conflicts exist, or Result.err with a descriptive machine-readable error.
 */
export function detectStateChangeConflicts(
  entries: readonly RuleStateChangeEntry[],
): Result<void, Error> {
  const propertyMap = new Map<string, RuleStateChangeEntry>();

  for (const entry of entries) {
    const { rule, stateChange } = entry;
    const propertyKey = JSON.stringify([stateChange.entityId, stateChange.property]);
    const existing = propertyMap.get(propertyKey);

    if (existing !== undefined) {
      const existingAfter = serializeValueState(existing.stateChange.after);
      const currentAfter = serializeValueState(stateChange.after);

      if (existingAfter !== currentAfter) {
        return err(
          new Error(
            `[RULE_OUTPUT_CONFLICT] Conflicting state changes for entity "${stateChange.entityId}", property "${stateChange.property}". ` +
              `Rule "${existing.rule.id}" produced after-state ${existingAfter}, whereas rule "${rule.id}" produced after-state ${currentAfter}.`,
          ),
        );
      }

      // Identical post-state from distinct rules (or multiple drafts): reject overlapping ownership
      return err(
        new Error(
          `[OVERLAPPING_RULE_TRANSITION] Overlapping state change transition for entity "${stateChange.entityId}", property "${stateChange.property}". ` +
            `Both rule "${existing.rule.id}" and rule "${rule.id}" produced an identical transition. Overlapping deterministic rule ownership must be resolved explicitly.`,
        ),
      );
    }

    propertyMap.set(propertyKey, entry);
  }

  return ok(undefined);
}

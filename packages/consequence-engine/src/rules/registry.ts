/**
 * Deterministic Rule Registry (Sprint FC-004)
 *
 * Provides an immutable, deterministic registry for validated DeterministicRule definitions.
 *
 * Invariants:
 * - Deterministic registration order preserved.
 * - Unique RuleIds enforced (one active version per RuleId in active registry).
 * - No mutable global state; all registries are explicitly created instances.
 * - Runtime frozen to prevent tampering or dynamic rule injection.
 */

import { captureDenseArrayOnce } from "./helpers.js";
import type { DeterministicRule, DeterministicRuleSet, RuleId } from "./types.js";
import { validateDeterministicRule } from "./validation.js";

/**
 * Creates an immutable, validated DeterministicRuleSet from an array of rule definitions.
 *
 * Guarantees (FC-004B M2):
 * - Snapshots caller-supplied array once with captureDenseArrayOnce.
 * - Rejects sparse arrays and unhandled errors fail-closed.
 * - Iterates captured detached array; never rereads caller array.length or indices.
 * - Enforces unique RuleIds.
 * - Freezes every rule snapshot and the registry root.
 *
 * @param rules Array of deterministic rules to register.
 * @throws {Error} if any rule definition is invalid or if duplicate rule identities are detected.
 */
export function createRuleSet(rules: readonly DeterministicRule[]): DeterministicRuleSet {
  if (!Array.isArray(rules)) {
    throw new Error("[INVALID_RULESET] Rules must be provided as an array.");
  }

  const captureRes = captureDenseArrayOnce<DeterministicRule>(rules, "rules");
  if (!captureRes.ok) {
    throw captureRes.error;
  }

  const capturedRules = captureRes.value;
  const registeredRules: DeterministicRule[] = [];
  const ruleMap = new Map<string, DeterministicRule>();

  for (let i = 0; i < capturedRules.length; i++) {
    const rawRule = capturedRules[i];
    const validation = validateDeterministicRule(rawRule, `rules[${i}]`);
    if (!validation.valid) {
      const issuesMsg = validation.issues
        .map((iss) => `[${iss.code}] ${iss.path}: ${iss.message}`)
        .join("; ");
      throw new Error(`[INVALID_RULE] Failed to validate rule at index ${i}: ${issuesMsg}`);
    }

    const rule = validation.value;
    if (ruleMap.has(rule.id)) {
      throw new Error(
        `[DUPLICATE_RULE] Rule with ID "${rule.id}" is already registered. Active registry enforces unique RuleIds.`,
      );
    }

    // Snapshot and freeze each rule definition independently (Finding M1)
    const trustedRule: DeterministicRule = Object.freeze({
      id: rule.id,
      version: rule.version,
      description: rule.description,
      evaluate: rule.evaluate,
    });

    ruleMap.set(trustedRule.id, trustedRule);
    registeredRules.push(trustedRule);
  }

  const frozenRules = Object.freeze([...registeredRules]);

  const ruleSet: DeterministicRuleSet = {
    rules: frozenRules,
    getRule(id: RuleId): DeterministicRule | undefined {
      return ruleMap.get(id);
    },
    hasRule(id: RuleId): boolean {
      return ruleMap.has(id);
    },
  };

  return Object.freeze(ruleSet);
}

/**
 * Built-in Deterministic Rules (Sprint FC-004)
 *
 * Provides statically defined, trusted deterministic rules for:
 * 1. Filesystem delete (to trash or permanent)
 * 2. Repository visibility (private to public)
 * 3. Document sharing (with explicit recipient role)
 * 4. Subscription activation (inactive to active recurring)
 */

import { createRuleSet } from "../registry.js";
import type { DeterministicRule, DeterministicRuleSet } from "../types.js";
import { FILE_DELETE_RULE_ID, FILE_DELETE_RULE_VERSION, fileDeleteRule } from "./delete.js";
import {
  REPOSITORY_VISIBILITY_RULE_ID,
  REPOSITORY_VISIBILITY_RULE_VERSION,
  repositoryVisibilityRule,
} from "./visibility.js";
import { DOCUMENT_SHARE_RULE_ID, DOCUMENT_SHARE_RULE_VERSION, documentShareRule } from "./share.js";
import {
  SUBSCRIPTION_ACTIVATE_RULE_ID,
  SUBSCRIPTION_ACTIVATE_RULE_VERSION,
  subscriptionActivationRule,
} from "./subscription.js";

export * from "./delete.js";
export * from "./visibility.js";
export * from "./share.js";
export * from "./subscription.js";

/**
 * Array of all built-in deterministic rules in canonical registration order.
 */
export const BUILTIN_RULES: readonly DeterministicRule[] = Object.freeze([
  fileDeleteRule,
  repositoryVisibilityRule,
  documentShareRule,
  subscriptionActivationRule,
]);

/**
 * Creates a new DeterministicRuleSet containing the built-in rules.
 */
export function createDefaultRuleSet(): DeterministicRuleSet {
  return createRuleSet(BUILTIN_RULES);
}

/**
 * Deterministic Verified Rules Engine Types (Sprint FC-004)
 *
 * Epistemological Boundary:
 * "VERIFIED" in FutureClick never represents universal certainty, guaranteed real-world execution,
 * or live external platform confirmation. It means a deterministic conclusion was derived from
 * available canonical evidence within an explicitly defined rule scope and set of assumptions.
 */

import type {
  ActionEvaluationContext,
  ActionId,
  Assumption,
  ConfidenceScore,
  Consequence,
  ConsequenceCategory,
  ConsequenceId,
  EntityId,
  EvidenceId,
  EvidenceMode,
  JsonValue,
  ProvenanceSourceKind,
  ReversibilityDescriptor,
  RiskDescriptor,
  StateChange,
  TemporalDescriptor,
} from "@futureclick/action-schema";
import type { ActionGraph } from "@futureclick/action-graph";
import type { Brand, IdGenerator, IsoTimestamp } from "@futureclick/shared";

// ============================================================================
// 1. BRANDED IDENTIFIERS & VERSIONS
// ============================================================================

export type RuleId = Brand<string, "RuleId">;
export type RuleVersion = Brand<string, "RuleVersion">;

export const RULE_ID_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;
export const RULE_VERSION_REGEX = /^[0-9]+(\.[0-9]+)+$/;

export const REASON_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;
export const MISSING_TOKEN_REGEX = /^[a-z][a-z0-9_.-]*$/;
export const MAX_REASON_CODE_LENGTH = 64;
export const MAX_MISSING_TOKEN_LENGTH = 64;

export function isValidRuleId(value: unknown): value is RuleId {
  return typeof value === "string" && value === value.trim() && RULE_ID_REGEX.test(value);
}

export function isValidRuleVersion(value: unknown): value is RuleVersion {
  return typeof value === "string" && value === value.trim() && RULE_VERSION_REGEX.test(value);
}

export function isValidReasonCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REASON_CODE_LENGTH &&
    REASON_CODE_REGEX.test(value)
  );
}

export function isValidMissingToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MISSING_TOKEN_LENGTH &&
    MISSING_TOKEN_REGEX.test(value)
  );
}

// ============================================================================
// 2. RULE EXECUTION INPUT
// ============================================================================

export interface DeterministicRuleInput {
  readonly context: ActionEvaluationContext;
  readonly graph: ActionGraph;
}

// ============================================================================
// 3. EVIDENCE & CONSEQUENCE DRAFTS
// ============================================================================

export interface EvidenceDraft {
  readonly scope: string;
  readonly assumptions: readonly Assumption[];
  readonly summary: string;
  readonly confidence?: ConfidenceScore;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export interface ConsequenceDraft {
  readonly kind: ConsequenceCategory;
  readonly summary: string;
  readonly affectedEntities: readonly EntityId[];
  readonly stateChanges?: readonly StateChange[];
  readonly evidence: readonly EvidenceDraft[];
  readonly confidence: ConfidenceScore | number;
  readonly reversibility: ReversibilityDescriptor;
  readonly risk: RiskDescriptor;
  readonly temporal?: TemporalDescriptor;
}

// ============================================================================
// 4. RULE DECISION MODEL
// ============================================================================

export type RuleDecision =
  | {
      readonly status: "matched";
      readonly drafts: readonly ConsequenceDraft[];
    }
  | {
      readonly status: "not-applicable";
      readonly reasonCode: string;
    }
  | {
      readonly status: "insufficient-evidence";
      readonly reasonCode: string;
      readonly missing?: readonly string[];
    };

// ============================================================================
// 5. DETERMINISTIC RULE CONTRACT
// ============================================================================

export interface DeterministicRule {
  readonly id: RuleId;
  readonly version: RuleVersion;
  readonly description: string;
  evaluate(input: DeterministicRuleInput): RuleDecision | Promise<RuleDecision>;
}

// ============================================================================
// 6. RULE TRACE & EVALUATION RESULT
// ============================================================================

export interface RuleTraceEntry {
  readonly ruleId: RuleId;
  readonly ruleVersion: RuleVersion;
  readonly status: "matched" | "not-applicable" | "insufficient-evidence";
  readonly reasonCode: string;
  readonly missing?: readonly string[];
}

export interface DeterministicEvaluationResult {
  readonly consequences: readonly Consequence[];
  readonly trace: readonly RuleTraceEntry[];
  readonly generatedAt: IsoTimestamp;
}

export interface EvaluateDeterministicRulesOptions {
  readonly context: ActionEvaluationContext;
  readonly rules?: readonly DeterministicRule[] | DeterministicRuleSet | undefined;
  readonly idGenerator?: IdGenerator | undefined;
  readonly generatedAt?: IsoTimestamp | undefined;
}

// ============================================================================
// 7. RULE REGISTRY INTERFACE
// ============================================================================

export interface DeterministicRuleSet {
  readonly rules: readonly DeterministicRule[];
  getRule(id: RuleId): DeterministicRule | undefined;
  hasRule(id: RuleId): boolean;
}

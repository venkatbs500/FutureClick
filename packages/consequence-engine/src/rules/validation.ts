/**
 * Deterministic Verified Rules Engine Validation (Sprint FC-004)
 *
 * Provides fail-closed runtime validation for rule identities, versions,
 * definitions, drafts, and decisions.
 *
 * Guarantees:
 * - Safe property access using readOwnProperty and dense array capture.
 * - Diagnostic safety: no unsafe String(untrustedValue) or value.toString() calls.
 * - Defends against hostile prototypes, getters, and revoked proxies.
 */

import {
  CONSEQUENCE_CATEGORIES,
  type ConsequenceCategory,
  type EntityId,
  type JsonValue,
  type SafePropertyRead,
  type ValidationIssue,
  type ValidationResult,
  captureDenseArray,
  isPlainObject,
  readOwnProperty,
  validateAssumption,
  validateConfidenceScore,
  validateId,
  validateJsonValue,
  validateReversibilityDescriptor,
  validateRiskDescriptor,
  validateStateChange,
  validateTemporalDescriptor,
} from "@futureclick/action-schema";
import {
  type ConsequenceDraft,
  type DeterministicRule,
  type EvidenceDraft,
  MAX_MISSING_TOKEN_LENGTH,
  MAX_REASON_CODE_LENGTH,
  MISSING_TOKEN_REGEX,
  REASON_CODE_REGEX,
  RULE_ID_REGEX,
  RULE_VERSION_REGEX,
  type RuleDecision,
  type RuleId,
  type RuleVersion,
} from "./types.js";

const VALID_CONSEQUENCE_CATEGORIES = new Set<string>(CONSEQUENCE_CATEGORIES);

/**
 * Safely formats an unknown value for inclusion in diagnostic messages
 * without invoking attacker-controlled toString or property accessors.
 */
function safeFormatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return `"${s.length > 50 ? `${s.slice(0, 47)}...` : s}"`;
  }
  if (t === "number" || t === "boolean") {
    return String(value);
  }
  return `[${t}]`;
}

// ============================================================================
// 1. RULE ID & VERSION VALIDATION (Finding L1 hardened)
// ============================================================================

export function validateRuleId(input: unknown, path = "rule.id"): ValidationResult<RuleId> {
  if (typeof input !== "string" || input.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_ID",
          path,
          message: `Rule ID must be a non-empty string, got ${safeFormatValue(input)}.`,
          severity: "error",
        },
      ],
    };
  }

  if (input !== input.trim()) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_ID",
          path,
          message: `Rule ID must not contain leading or trailing whitespace, got ${safeFormatValue(input)}.`,
          severity: "error",
        },
      ],
    };
  }

  if (!RULE_ID_REGEX.test(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_ID",
          path,
          message: `Rule ID "${input}" must be a namespaced identifier consisting of lowercase ASCII segments separated by dots (e.g. "domain.action.rule").`,
          severity: "error",
        },
      ],
    };
  }

  return { valid: true, value: input as RuleId, issues: [] };
}

export function validateRuleVersion(
  input: unknown,
  path = "rule.version",
): ValidationResult<RuleVersion> {
  if (typeof input !== "string" || input.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_VERSION",
          path,
          message: `Rule version must be a non-empty string, got ${safeFormatValue(input)}.`,
          severity: "error",
        },
      ],
    };
  }

  if (input !== input.trim()) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_VERSION",
          path,
          message: `Rule version must not contain leading or trailing whitespace, got ${safeFormatValue(input)}.`,
          severity: "error",
        },
      ],
    };
  }

  if (!RULE_VERSION_REGEX.test(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_RULE_VERSION",
          path,
          message: `Rule version "${input}" must be a dot-separated numeric version (e.g. "1.0" or "1.0.0").`,
          severity: "error",
        },
      ],
    };
  }

  return { valid: true, value: input as RuleVersion, issues: [] };
}

// ============================================================================
// 2. DETERMINISTIC RULE DEFINITION VALIDATION
// ============================================================================

export function validateDeterministicRule(
  input: unknown,
  path = "rule",
): ValidationResult<DeterministicRule> {
  try {
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: `DeterministicRule must be a plain object, got ${safeFormatValue(input)}.`,
            severity: "error",
          },
        ],
      };
    }

    const issues: ValidationIssue[] = [];

    // id
    const idRead = readOwnProperty(input, "id");
    let validId: RuleId | undefined;
    if (idRead.status === "absent" || idRead.status === "error" || idRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.id`,
        message: "Rule must define an own 'id' property.",
        severity: "error",
      });
    } else {
      const idRes = validateRuleId(idRead.value, `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    // version
    const versionRead = readOwnProperty(input, "version");
    let validVersion: RuleVersion | undefined;
    if (
      versionRead.status === "absent" ||
      versionRead.status === "error" ||
      versionRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.version`,
        message: "Rule must define an own 'version' property.",
        severity: "error",
      });
    } else {
      const verRes = validateRuleVersion(versionRead.value, `${path}.version`);
      if (!verRes.valid) {
        issues.push(...verRes.issues);
      } else {
        validVersion = verRes.value;
      }
    }

    // description
    const descRead = readOwnProperty(input, "description");
    let validDesc: string | undefined;
    if (
      descRead.status === "absent" ||
      descRead.status === "error" ||
      descRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.description`,
        message: "Rule must define an own 'description' property.",
        severity: "error",
      });
    } else if (typeof descRead.value !== "string" || descRead.value.trim().length === 0) {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.description`,
        message: "Rule description must be a non-empty string.",
        severity: "error",
      });
    } else {
      validDesc = descRead.value.trim();
    }

    // evaluate
    const evalRead = readOwnProperty(input, "evaluate");
    let validEvaluate: DeterministicRule["evaluate"] | undefined;
    if (
      evalRead.status === "absent" ||
      evalRead.status === "error" ||
      evalRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.evaluate`,
        message: "Rule must define an own 'evaluate' method.",
        severity: "error",
      });
    } else if (typeof evalRead.value !== "function") {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.evaluate`,
        message: "Rule 'evaluate' must be a function.",
        severity: "error",
      });
    } else {
      validEvaluate = evalRead.value as DeterministicRule["evaluate"];
    }

    if (
      issues.length > 0 ||
      validId === undefined ||
      validVersion === undefined ||
      validDesc === undefined ||
      validEvaluate === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      value: {
        id: validId,
        version: validVersion,
        description: validDesc,
        evaluate: validEvaluate,
      },
      issues: [],
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "VALIDATION_ERROR",
          path,
          message: "Failed to validate deterministic rule definition.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 3. EVIDENCE DRAFT VALIDATION
// ============================================================================

export function validateEvidenceDraft(
  input: unknown,
  path = "evidenceDraft",
): ValidationResult<EvidenceDraft> {
  try {
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: `EvidenceDraft must be a plain object, got ${safeFormatValue(input)}.`,
            severity: "error",
          },
        ],
      };
    }

    const issues: ValidationIssue[] = [];

    // scope
    const scopeRead = readOwnProperty(input, "scope");
    let validScope: string | undefined;
    if (
      scopeRead.status === "absent" ||
      scopeRead.status === "error" ||
      scopeRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.scope`,
        message: "Evidence draft must specify scope.",
        severity: "error",
      });
    } else if (typeof scopeRead.value !== "string" || scopeRead.value.trim().length === 0) {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.scope`,
        message: "Evidence draft scope must be a non-empty string defining its boundary.",
        severity: "error",
      });
    } else {
      validScope = scopeRead.value.trim();
    }

    // assumptions
    const assumptions: import("@futureclick/action-schema").Assumption[] = [];
    const asmRead = readOwnProperty(input, "assumptions");
    if (asmRead.status === "absent" || asmRead.status === "error" || asmRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.assumptions`,
        message: "Evidence draft must specify assumptions array.",
        severity: "error",
      });
    } else {
      const capture = captureDenseArray(asmRead.value);
      if (!capture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.assumptions`,
          message: "Evidence draft assumptions must be a dense array.",
          severity: "error",
        });
      } else {
        for (let i = 0; i < capture.values.length; i++) {
          const asmRes = validateAssumption(capture.values[i], `${path}.assumptions[${i}]`);
          if (!asmRes.valid) {
            issues.push(...asmRes.issues);
          } else {
            assumptions.push(asmRes.value);
          }
        }
      }
    }

    // summary
    const sumRead = readOwnProperty(input, "summary");
    let validSummary: string | undefined;
    if (sumRead.status === "absent" || sumRead.status === "error" || sumRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.summary`,
        message: "Evidence draft must specify summary.",
        severity: "error",
      });
    } else if (typeof sumRead.value !== "string" || sumRead.value.trim().length === 0) {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.summary`,
        message: "Evidence draft summary must be a non-empty string.",
        severity: "error",
      });
    } else {
      validSummary = sumRead.value.trim();
    }

    // confidence (optional for verified evidence)
    let validConfidence: import("@futureclick/action-schema").ConfidenceScore | undefined;
    const confRead = readOwnProperty(input, "confidence");
    if (confRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.confidence`,
        message: "Failed reading confidence property.",
        severity: "error",
      });
    } else if (confRead.status === "present") {
      if (confRead.value === undefined) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.confidence`,
          message: "Confidence must not be undefined when present.",
          severity: "error",
        });
      } else {
        const confRes = validateConfidenceScore(confRead.value, `${path}.confidence`);
        if (!confRes.valid) {
          issues.push(...confRes.issues);
        } else {
          validConfidence = confRes.value;
        }
      }
    }

    // details (optional)
    let validDetails: Readonly<Record<string, JsonValue>> | undefined;
    const detailsRead = readOwnProperty(input, "details");
    if (detailsRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.details`,
        message: "Failed reading details property.",
        severity: "error",
      });
    } else if (detailsRead.status === "present") {
      if (detailsRead.value === undefined) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.details`,
          message: "Details must not be undefined when present.",
          severity: "error",
        });
      } else {
        const jsonRes = validateJsonValue(detailsRead.value, {
          requireObject: true,
          path: `${path}.details`,
        });
        if (!jsonRes.valid) {
          issues.push(
            ...jsonRes.issues.map((i) => ({
              code: i.code,
              path: i.path,
              message: i.message,
              severity: "error" as const,
            })),
          );
        } else {
          validDetails = jsonRes.value as Readonly<Record<string, JsonValue>>;
        }
      }
    }

    if (issues.length > 0 || validScope === undefined || validSummary === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      value: {
        scope: validScope,
        assumptions,
        summary: validSummary,
        ...(validConfidence !== undefined ? { confidence: validConfidence } : {}),
        ...(validDetails !== undefined ? { details: validDetails } : {}),
      },
      issues: [],
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "VALIDATION_ERROR",
          path,
          message: "Failed to validate evidence draft.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 4. CONSEQUENCE DRAFT VALIDATION
// ============================================================================

export function validateConsequenceDraft(
  input: unknown,
  path = "consequenceDraft",
): ValidationResult<ConsequenceDraft> {
  try {
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: `ConsequenceDraft must be a plain object, got ${safeFormatValue(input)}.`,
            severity: "error",
          },
        ],
      };
    }

    const issues: ValidationIssue[] = [];

    // Reject unexpected actionId or id on draft (Finding Section 57)
    if (Object.prototype.hasOwnProperty.call(input, "actionId")) {
      issues.push({
        code: "UNEXPECTED_PROPERTY",
        path: `${path}.actionId`,
        message: "Consequence draft must not specify actionId (authoritatively bound by engine).",
        severity: "error",
      });
    }
    if (Object.prototype.hasOwnProperty.call(input, "id")) {
      issues.push({
        code: "UNEXPECTED_PROPERTY",
        path: `${path}.id`,
        message: "Consequence draft must not specify id (assigned by engine).",
        severity: "error",
      });
    }

    // kind
    const kindRead = readOwnProperty(input, "kind");
    let validKind: ConsequenceCategory | undefined;
    if (
      kindRead.status === "absent" ||
      kindRead.status === "error" ||
      kindRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.kind`,
        message: "Consequence draft must specify kind.",
        severity: "error",
      });
    } else if (
      typeof kindRead.value !== "string" ||
      !VALID_CONSEQUENCE_CATEGORIES.has(kindRead.value)
    ) {
      issues.push({
        code: "INVALID_ENUM_VALUE",
        path: `${path}.kind`,
        message: `Consequence draft kind must be a valid ConsequenceCategory, got ${safeFormatValue(kindRead.value)}.`,
        severity: "error",
      });
    } else {
      validKind = kindRead.value as ConsequenceCategory;
    }

    // summary
    const sumRead = readOwnProperty(input, "summary");
    let validSummary: string | undefined;
    if (sumRead.status === "absent" || sumRead.status === "error" || sumRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.summary`,
        message: "Consequence draft must specify summary.",
        severity: "error",
      });
    } else if (typeof sumRead.value !== "string" || sumRead.value.trim().length === 0) {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.summary`,
        message: "Consequence draft summary must be a non-empty string.",
        severity: "error",
      });
    } else {
      validSummary = sumRead.value.trim();
    }

    // affectedEntities
    const affectedEntities: EntityId[] = [];
    const affectedSet = new Set<string>();
    const affRead = readOwnProperty(input, "affectedEntities");
    if (affRead.status === "absent" || affRead.status === "error" || affRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.affectedEntities`,
        message: "Consequence draft must specify affectedEntities array.",
        severity: "error",
      });
    } else {
      const capture = captureDenseArray(affRead.value);
      if (!capture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.affectedEntities`,
          message: "Consequence draft affectedEntities must be a dense array.",
          severity: "error",
        });
      } else {
        for (let i = 0; i < capture.values.length; i++) {
          const idRes = validateId<EntityId>(
            capture.values[i],
            "AffectedEntity",
            `${path}.affectedEntities[${i}]`,
          );
          if (!idRes.valid) {
            issues.push(...idRes.issues);
          } else if (affectedSet.has(idRes.value)) {
            issues.push({
              code: "DUPLICATE_AFFECTED_ENTITY",
              path: `${path}.affectedEntities[${i}]`,
              message: `Duplicate affected entity "${idRes.value}".`,
              severity: "error",
            });
          } else {
            affectedSet.add(idRes.value);
            affectedEntities.push(idRes.value);
          }
        }
      }
    }

    // stateChanges (optional)
    const stateChanges: import("@futureclick/action-schema").StateChange[] = [];
    const scRead = readOwnProperty(input, "stateChanges");
    if (scRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.stateChanges`,
        message: "Failed reading stateChanges property.",
        severity: "error",
      });
    } else if (scRead.status === "present") {
      if (scRead.value === undefined) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.stateChanges`,
          message: "stateChanges must not be undefined when present.",
          severity: "error",
        });
      } else {
        const capture = captureDenseArray(scRead.value);
        if (!capture.valid) {
          issues.push({
            code: "INVALID_TYPE",
            path: `${path}.stateChanges`,
            message: "stateChanges must be a dense array.",
            severity: "error",
          });
        } else {
          for (let i = 0; i < capture.values.length; i++) {
            const scRes = validateStateChange(capture.values[i], `${path}.stateChanges[${i}]`);
            if (!scRes.valid) {
              issues.push(...scRes.issues);
            } else {
              stateChanges.push(scRes.value);
              if (!affectedSet.has(scRes.value.entityId)) {
                issues.push({
                  code: "MISSING_AFFECTED_ENTITY",
                  path: `${path}.stateChanges[${i}].entityId`,
                  message: `Entity "${scRes.value.entityId}" in stateChange must be listed in affectedEntities.`,
                  severity: "error",
                });
              }
            }
          }
        }
      }
    }

    // evidence (at least 1 required)
    const evidence: EvidenceDraft[] = [];
    const evRead = readOwnProperty(input, "evidence");
    if (evRead.status === "absent" || evRead.status === "error" || evRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.evidence`,
        message: "Consequence draft must specify evidence array.",
        severity: "error",
      });
    } else {
      const capture = captureDenseArray(evRead.value);
      if (!capture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.evidence`,
          message: "Consequence draft evidence must be a dense array.",
          severity: "error",
        });
      } else if (capture.values.length === 0) {
        issues.push({
          code: "EMPTY_EVIDENCE",
          path: `${path}.evidence`,
          message: "Consequence draft must include at least one verified evidence record.",
          severity: "error",
        });
      } else {
        for (let i = 0; i < capture.values.length; i++) {
          const evRes = validateEvidenceDraft(capture.values[i], `${path}.evidence[${i}]`);
          if (!evRes.valid) {
            issues.push(...evRes.issues);
          } else {
            evidence.push(evRes.value);
          }
        }
      }
    }

    // confidence (REQUIRED on ConsequenceDraft in FC-004A, Finding H6)
    let validConfidence: import("@futureclick/action-schema").ConfidenceScore | undefined;
    const confRead = readOwnProperty(input, "confidence");
    if (
      confRead.status === "absent" ||
      confRead.status === "error" ||
      confRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.confidence`,
        message: "Consequence draft must specify confidence.",
        severity: "error",
      });
    } else {
      const confRes = validateConfidenceScore(confRead.value, `${path}.confidence`);
      if (!confRes.valid) {
        issues.push(...confRes.issues);
      } else {
        validConfidence = confRes.value;
      }
    }

    // reversibility
    const revRead = readOwnProperty(input, "reversibility");
    let validRev: import("@futureclick/action-schema").ReversibilityDescriptor | undefined;
    if (revRead.status === "absent" || revRead.status === "error" || revRead.value === undefined) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.reversibility`,
        message: "Consequence draft must specify reversibility descriptor.",
        severity: "error",
      });
    } else {
      const revRes = validateReversibilityDescriptor(revRead.value, `${path}.reversibility`);
      if (!revRes.valid) {
        issues.push(...revRes.issues);
      } else {
        validRev = revRes.value;
      }
    }

    // risk
    const riskRead = readOwnProperty(input, "risk");
    let validRisk: import("@futureclick/action-schema").RiskDescriptor | undefined;
    if (
      riskRead.status === "absent" ||
      riskRead.status === "error" ||
      riskRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.risk`,
        message: "Consequence draft must specify risk descriptor.",
        severity: "error",
      });
    } else {
      const riskRes = validateRiskDescriptor(riskRead.value, `${path}.risk`);
      if (!riskRes.valid) {
        issues.push(...riskRes.issues);
      } else {
        validRisk = riskRes.value;
      }
    }

    // temporal (optional)
    let validTemporal: import("@futureclick/action-schema").TemporalDescriptor | undefined;
    const tempRead = readOwnProperty(input, "temporal");
    if (tempRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.temporal`,
        message: "Failed reading temporal property.",
        severity: "error",
      });
    } else if (tempRead.status === "present") {
      if (tempRead.value === undefined) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.temporal`,
          message: "Temporal must not be undefined when present.",
          severity: "error",
        });
      } else {
        const tempRes = validateTemporalDescriptor(tempRead.value, `${path}.temporal`);
        if (!tempRes.valid) {
          issues.push(...tempRes.issues);
        } else {
          validTemporal = tempRes.value;
        }
      }
    }

    if (
      issues.length > 0 ||
      validKind === undefined ||
      validSummary === undefined ||
      validConfidence === undefined ||
      validRev === undefined ||
      validRisk === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      value: {
        kind: validKind,
        summary: validSummary,
        affectedEntities,
        stateChanges,
        evidence,
        confidence: validConfidence,
        reversibility: validRev,
        risk: validRisk,
        ...(validTemporal !== undefined ? { temporal: validTemporal } : {}),
      },
      issues: [],
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "VALIDATION_ERROR",
          path,
          message: "Failed to validate consequence draft.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 5. RULE DECISION VALIDATION
// ============================================================================

export function validateRuleDecision(
  input: unknown,
  path = "decision",
): ValidationResult<RuleDecision> {
  try {
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: `RuleDecision must be a plain object, got ${safeFormatValue(input)}.`,
            severity: "error",
          },
        ],
      };
    }

    const issues: ValidationIssue[] = [];

    const statusRead = readOwnProperty(input, "status");
    if (
      statusRead.status === "absent" ||
      statusRead.status === "error" ||
      statusRead.value === undefined
    ) {
      return {
        valid: false,
        issues: [
          {
            code: "MISSING_PROPERTY",
            path: `${path}.status`,
            message: "RuleDecision must specify status.",
            severity: "error",
          },
        ],
      };
    }

    const status = statusRead.value;
    if (status !== "matched" && status !== "not-applicable" && status !== "insufficient-evidence") {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_ENUM_VALUE",
            path: `${path}.status`,
            message: `Status must be 'matched', 'not-applicable', or 'insufficient-evidence', got ${safeFormatValue(status)}.`,
            severity: "error",
          },
        ],
      };
    }

    const ownKeys = Object.getOwnPropertyNames(input);

    if (status === "matched") {
      // Reject unexpected properties on matched decision (Finding L3)
      for (const k of ownKeys) {
        if (k !== "status" && k !== "drafts") {
          issues.push({
            code: "UNEXPECTED_PROPERTY",
            path: `${path}.${k}`,
            message: `Matched decision must not contain unexpected property "${k}".`,
            severity: "error",
          });
        }
      }

      const draftsRead = readOwnProperty(input, "drafts");
      if (
        draftsRead.status === "absent" ||
        draftsRead.status === "error" ||
        draftsRead.value === undefined
      ) {
        issues.push({
          code: "MISSING_PROPERTY",
          path: `${path}.drafts`,
          message: "Matched decision must specify drafts array.",
          severity: "error",
        });
        return { valid: false, issues };
      }

      const capture = captureDenseArray(draftsRead.value);
      if (!capture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.drafts`,
          message: "Matched decision drafts must be a dense array.",
          severity: "error",
        });
        return { valid: false, issues };
      }

      if (capture.values.length === 0) {
        issues.push({
          code: "EMPTY_DRAFTS",
          path: `${path}.drafts`,
          message: "Matched decision must provide at least one consequence draft.",
          severity: "error",
        });
        return { valid: false, issues };
      }

      const validDrafts: ConsequenceDraft[] = [];
      for (let i = 0; i < capture.values.length; i++) {
        const draftRes = validateConsequenceDraft(capture.values[i], `${path}.drafts[${i}]`);
        if (!draftRes.valid) {
          issues.push(...draftRes.issues);
        } else {
          validDrafts.push(draftRes.value);
        }
      }

      if (issues.length > 0) {
        return { valid: false, issues };
      }

      return {
        valid: true,
        value: { status: "matched", drafts: validDrafts },
        issues: [],
      };
    }

    if (status === "not-applicable") {
      // Reject unexpected properties on not-applicable decision (Finding L3)
      for (const k of ownKeys) {
        if (k !== "status" && k !== "reasonCode") {
          issues.push({
            code: "UNEXPECTED_PROPERTY",
            path: `${path}.${k}`,
            message: `Not-applicable decision must not contain unexpected property "${k}".`,
            severity: "error",
          });
        }
      }

      const codeRead = readOwnProperty(input, "reasonCode");
      let validReasonCode: string | undefined;
      if (
        codeRead.status === "absent" ||
        codeRead.status === "error" ||
        codeRead.value === undefined
      ) {
        issues.push({
          code: "MISSING_PROPERTY",
          path: `${path}.reasonCode`,
          message: "Not-applicable decision must specify reasonCode.",
          severity: "error",
        });
      } else if (typeof codeRead.value !== "string" || codeRead.value.length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.reasonCode`,
          message: "reasonCode must be a non-empty string.",
          severity: "error",
        });
      } else if (
        codeRead.value !== codeRead.value.trim() ||
        codeRead.value.length > MAX_REASON_CODE_LENGTH ||
        !REASON_CODE_REGEX.test(codeRead.value)
      ) {
        issues.push({
          code: "INVALID_REASON_CODE",
          path: `${path}.reasonCode`,
          message: `reasonCode "${codeRead.value}" must be a valid machine-readable token matching ^[A-Z][A-Z0-9_]*$ (max ${MAX_REASON_CODE_LENGTH} chars).`,
          severity: "error",
        });
      } else {
        validReasonCode = codeRead.value;
      }

      if (issues.length > 0 || validReasonCode === undefined) {
        return { valid: false, issues };
      }

      return {
        valid: true,
        value: { status: "not-applicable", reasonCode: validReasonCode },
        issues: [],
      };
    }

    // status === "insufficient-evidence"
    // Reject unexpected properties on insufficient-evidence decision (Finding L3)
    for (const k of ownKeys) {
      if (k !== "status" && k !== "reasonCode" && k !== "missing") {
        issues.push({
          code: "UNEXPECTED_PROPERTY",
          path: `${path}.${k}`,
          message: `Insufficient-evidence decision must not contain unexpected property "${k}".`,
          severity: "error",
        });
      }
    }

    const codeRead = readOwnProperty(input, "reasonCode");
    let validReasonCode: string | undefined;
    if (
      codeRead.status === "absent" ||
      codeRead.status === "error" ||
      codeRead.value === undefined
    ) {
      issues.push({
        code: "MISSING_PROPERTY",
        path: `${path}.reasonCode`,
        message: "Insufficient-evidence decision must specify reasonCode.",
        severity: "error",
      });
    } else if (typeof codeRead.value !== "string" || codeRead.value.length === 0) {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.reasonCode`,
        message: "reasonCode must be a non-empty string.",
        severity: "error",
      });
    } else if (
      codeRead.value !== codeRead.value.trim() ||
      codeRead.value.length > MAX_REASON_CODE_LENGTH ||
      !REASON_CODE_REGEX.test(codeRead.value)
    ) {
      issues.push({
        code: "INVALID_REASON_CODE",
        path: `${path}.reasonCode`,
        message: `reasonCode "${codeRead.value}" must be a valid machine-readable token matching ^[A-Z][A-Z0-9_]*$ (max ${MAX_REASON_CODE_LENGTH} chars).`,
        severity: "error",
      });
    } else {
      validReasonCode = codeRead.value;
    }

    const missingRead = readOwnProperty(input, "missing");
    let validMissing: readonly string[] | undefined;
    if (missingRead.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.missing`,
        message: "Failed reading missing property.",
        severity: "error",
      });
    } else if (missingRead.status === "present") {
      if (missingRead.value === undefined) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.missing`,
          message: "missing must not be undefined when present.",
          severity: "error",
        });
      } else {
        const capture = captureDenseArray(missingRead.value);
        if (!capture.valid) {
          issues.push({
            code: "INVALID_TYPE",
            path: `${path}.missing`,
            message: "missing must be a dense array of strings.",
            severity: "error",
          });
        } else {
          const list: string[] = [];
          for (let i = 0; i < capture.values.length; i++) {
            const item = capture.values[i];
            if (typeof item !== "string" || item.length === 0) {
              issues.push({
                code: "INVALID_TYPE",
                path: `${path}.missing[${i}]`,
                message: "Missing evidence item must be a non-empty string.",
                severity: "error",
              });
            } else if (
              item !== item.trim() ||
              item.length > MAX_MISSING_TOKEN_LENGTH ||
              !MISSING_TOKEN_REGEX.test(item)
            ) {
              issues.push({
                code: "INVALID_MISSING_TOKEN",
                path: `${path}.missing[${i}]`,
                message: `Missing token "${item}" must be a valid machine-readable token matching ^[a-z][a-z0-9_.-]*$ (max ${MAX_MISSING_TOKEN_LENGTH} chars).`,
                severity: "error",
              });
            } else {
              list.push(item);
            }
          }
          validMissing = Object.freeze(list);
        }
      }
    }

    if (issues.length > 0 || validReasonCode === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      value: {
        status: "insufficient-evidence",
        reasonCode: validReasonCode,
        ...(validMissing !== undefined ? { missing: validMissing } : {}),
      },
      issues: [],
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "VALIDATION_ERROR",
          path,
          message: "Failed to validate rule decision.",
          severity: "error",
        },
      ],
    };
  }
}

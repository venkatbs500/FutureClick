/**
 * Data classification, sensitivity levels, and fail-closed privacy authorization for FutureClick.
 * Enforces local-first and data-minimization principles before any potential remote processing.
 *
 * Architectural Principle:
 * Authorization to transmit data remotely requires complete runtime context including
 * affirmative credential assessment, confirmed redaction, and a fully validated policy.
 * A static policy alone is insufficient evidence that transmission is safe. Missing,
 * malformed, or unknown safety context always FAILS CLOSED (INVALID/UNKNOWN/INCOMPLETE = DENY).
 */

import { isPasswordFieldIdentifier } from "./redaction.js";

export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export type SensitivityLevel = "low" | "medium" | "high" | "critical";

export type CredentialAssessment = "clear" | "contains-credentials" | "unknown";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export const SENSITIVITY_LEVELS: readonly SensitivityLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const CREDENTIAL_ASSESSMENTS: readonly CredentialAssessment[] = [
  "clear",
  "contains-credentials",
  "unknown",
] as const;

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set(DATA_CLASSIFICATIONS);
const VALID_SENSITIVITY_LEVELS: ReadonlySet<string> = new Set(SENSITIVITY_LEVELS);
const VALID_CREDENTIAL_ASSESSMENTS: ReadonlySet<string> = new Set(CREDENTIAL_ASSESSMENTS);

export interface PrivacyPolicyRule {
  readonly classification: DataClassification;
  readonly sensitivity: SensitivityLevel;
  readonly allowRemoteTransmission: boolean;
  readonly requireRedaction: boolean;
}

export interface RemoteProcessingContext {
  readonly policy: PrivacyPolicyRule;
  readonly credentialAssessment: CredentialAssessment;
  readonly redactionCompleted: boolean;
  readonly fieldIdentifier?: string;
}

export interface RemoteProcessingDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

export interface PolicyEligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface ValidationSuccess<T> {
  readonly isValid: true;
  readonly value: T;
}

export interface ValidationFailure {
  readonly isValid: false;
  readonly reasons: readonly string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Safe own-property presence check without relying on target's prototype methods.
 */
function hasOwn(target: object, key: PropertyKey): boolean {
  return (
    target !== null &&
    typeof target === "object" &&
    Object.prototype.hasOwnProperty.call(target, key)
  );
}

export function isSensitiveClassification(classification: DataClassification): boolean {
  return classification === "confidential" || classification === "restricted";
}

export function isElevatedSensitivity(sensitivity: SensitivityLevel): boolean {
  return sensitivity === "high" || sensitivity === "critical";
}

/**
 * Validates untrusted runtime input against the PrivacyPolicyRule contract.
 * Strictly verifies property presence, exact primitive types, and valid enum values.
 * Zero coercion: strings like "true"/"false" or numbers 1/0 are rejected.
 * Exception-safe: never invokes untrusted string/object coercions that could throw.
 */
export function validatePrivacyPolicyRule(input: unknown): ValidationResult<PrivacyPolicyRule> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      isValid: false,
      reasons: ["Policy must be a non-null object."],
    };
  }

  const obj = input as Record<string, unknown>;
  const reasons: string[] = [];

  // 1. Classification
  if (!hasOwn(obj, "classification") || obj.classification === undefined) {
    reasons.push("Policy classification is missing.");
  } else if (
    typeof obj.classification !== "string" ||
    !VALID_CLASSIFICATIONS.has(obj.classification)
  ) {
    reasons.push(
      "Policy classification is unrecognized. Expected one of: public, internal, confidential, restricted.",
    );
  }

  // 2. Sensitivity
  if (!hasOwn(obj, "sensitivity") || obj.sensitivity === undefined) {
    reasons.push("Policy sensitivity is missing.");
  } else if (
    typeof obj.sensitivity !== "string" ||
    !VALID_SENSITIVITY_LEVELS.has(obj.sensitivity)
  ) {
    reasons.push(
      "Policy sensitivity is unrecognized. Expected one of: low, medium, high, critical.",
    );
  }

  // 3. allowRemoteTransmission (exact boolean)
  if (!hasOwn(obj, "allowRemoteTransmission") || obj.allowRemoteTransmission === undefined) {
    reasons.push("Policy allowRemoteTransmission is missing.");
  } else if (typeof obj.allowRemoteTransmission !== "boolean") {
    reasons.push("Policy allowRemoteTransmission must be an exact boolean.");
  }

  // 4. requireRedaction (exact boolean)
  if (!hasOwn(obj, "requireRedaction") || obj.requireRedaction === undefined) {
    reasons.push("Policy requireRedaction is missing.");
  } else if (typeof obj.requireRedaction !== "boolean") {
    reasons.push("Policy requireRedaction must be an exact boolean.");
  }

  if (reasons.length > 0) {
    return { isValid: false, reasons };
  }

  return {
    isValid: true,
    value: {
      classification: obj.classification as DataClassification,
      sensitivity: obj.sensitivity as SensitivityLevel,
      allowRemoteTransmission: obj.allowRemoteTransmission as boolean,
      requireRedaction: obj.requireRedaction as boolean,
    },
  };
}

/**
 * Type guard validating whether untrusted input conforms to PrivacyPolicyRule.
 */
export function isPrivacyPolicyRule(value: unknown): value is PrivacyPolicyRule {
  return validatePrivacyPolicyRule(value).isValid;
}

/**
 * Validates untrusted runtime input against the RemoteProcessingContext contract.
 * Strictly verifies nested policy structure, affirmative credential assessment,
 * explicit redactionCompleted boolean, and optional fieldIdentifier type.
 * Zero coercion: strings like "true"/"false" or numbers 1/0 are rejected.
 * Own-property semantics: if fieldIdentifier is present, it MUST be a primitive string.
 */
export function validateRemoteProcessingContext(
  input: unknown,
): ValidationResult<RemoteProcessingContext> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      isValid: false,
      reasons: ["Remote processing context must be a non-null object."],
    };
  }

  const obj = input as Record<string, unknown>;
  const reasons: string[] = [];

  // 1. Nested Policy
  if (!hasOwn(obj, "policy") || obj.policy === undefined) {
    reasons.push("Remote processing context is missing required 'policy' property.");
  } else {
    const policyResult = validatePrivacyPolicyRule(obj.policy);
    if (!policyResult.isValid) {
      reasons.push(...policyResult.reasons);
    }
  }

  // 2. Credential Assessment
  if (!hasOwn(obj, "credentialAssessment") || obj.credentialAssessment === undefined) {
    reasons.push("Remote processing context is missing required 'credentialAssessment' property.");
  } else if (
    typeof obj.credentialAssessment !== "string" ||
    !VALID_CREDENTIAL_ASSESSMENTS.has(obj.credentialAssessment)
  ) {
    reasons.push(
      "credentialAssessment is unrecognized. Expected one of: clear, contains-credentials, unknown.",
    );
  }

  // 3. redactionCompleted (exact boolean required)
  if (!hasOwn(obj, "redactionCompleted") || obj.redactionCompleted === undefined) {
    reasons.push("redactionCompleted must be explicitly provided as a boolean.");
  } else if (typeof obj.redactionCompleted !== "boolean") {
    reasons.push("redactionCompleted must be an exact boolean.");
  }

  // 4. fieldIdentifier (optional: absent is valid; if present, must be string)
  if (hasOwn(obj, "fieldIdentifier")) {
    if (typeof obj.fieldIdentifier !== "string") {
      reasons.push("fieldIdentifier must be a string when present.");
    }
  }

  if (reasons.length > 0) {
    return { isValid: false, reasons };
  }

  const validatedPolicyResult = validatePrivacyPolicyRule(obj.policy);
  if (!validatedPolicyResult.isValid) {
    return { isValid: false, reasons: validatedPolicyResult.reasons };
  }

  return {
    isValid: true,
    value: {
      policy: validatedPolicyResult.value,
      credentialAssessment: obj.credentialAssessment as CredentialAssessment,
      redactionCompleted: obj.redactionCompleted as boolean,
      ...(hasOwn(obj, "fieldIdentifier") && typeof obj.fieldIdentifier === "string"
        ? { fieldIdentifier: obj.fieldIdentifier }
        : {}),
    },
  };
}

/**
 * Type guard validating whether untrusted input conforms to RemoteProcessingContext.
 */
export function isRemoteProcessingContext(value: unknown): value is RemoteProcessingContext {
  return validateRemoteProcessingContext(value).isValid;
}

/**
 * Evaluates whether a PrivacyPolicyRule statically permits remote transmission in principle.
 *
 * IMPORTANT ARCHITECTURAL BOUNDARY:
 * This evaluates static policy configuration only and does NOT constitute authorization to transmit data.
 * Full authorization requires calling `evaluateRemoteProcessing(context)` with affirmative
 * runtime evidence that credentials have been excluded and redactions have been completed.
 */
export function evaluateRemotePolicyEligibility(
  policy: PrivacyPolicyRule,
): PolicyEligibilityDecision {
  try {
    const validation = validatePrivacyPolicyRule(policy);
    if (!validation.isValid) {
      return {
        eligible: false,
        reasons: validation.reasons,
      };
    }

    const validPolicy = validation.value;
    const reasons: string[] = [];

    if (validPolicy.classification === "restricted") {
      reasons.push("Restricted data classification forbids remote transmission.");
    } else if (validPolicy.classification === "confidential") {
      reasons.push("Confidential data classification forbids remote transmission.");
    }

    if (validPolicy.sensitivity === "critical") {
      reasons.push("Critical sensitivity data must remain local.");
    } else if (validPolicy.sensitivity === "high") {
      reasons.push("High sensitivity data cannot be processed remotely.");
    }

    if (!validPolicy.allowRemoteTransmission) {
      reasons.push("Privacy policy rule explicitly disallows remote transmission.");
    }

    return {
      eligible: reasons.length === 0,
      reasons,
    };
  } catch {
    return {
      eligible: false,
      reasons: [
        "Policy eligibility evaluation failed closed because the policy could not be safely validated.",
      ],
    };
  }
}

/**
 * Evaluates whether remote processing is authorized under privacy rules and complete runtime context.
 * FAILS CLOSED: Any malformed, missing, unverified, or unknown context is strictly denied.
 * Exception-safe: unexpected runtime exceptions fail closed and return a structured denial.
 *
 * Execution Flow:
 * UNTRUSTED INPUT -> RUNTIME STRUCTURAL VALIDATION -> CREDENTIAL CHECK -> FIELD CHECK ->
 * REDACTION CHECK -> CLASSIFICATION CHECK -> SENSITIVITY CHECK -> REMOTE TRANSMISSION POLICY
 *
 * @param context Complete runtime evaluation context. Untrusted runtime inputs are structurally validated.
 * @returns An explicit structured decision explaining reasons for allowance or denial.
 */
export function evaluateRemoteProcessing(
  context: RemoteProcessingContext,
): RemoteProcessingDecision {
  try {
    // Step 1: Runtime structural validation (defends against untyped JS/IPC/JSON callers)
    const validation = validateRemoteProcessingContext(context);
    if (!validation.isValid) {
      return {
        allowed: false,
        reasons: validation.reasons,
      };
    }

    const validContext = validation.value;
    const { policy, credentialAssessment, redactionCompleted, fieldIdentifier } = validContext;
    const reasons: string[] = [];

    // Step 2: Defense-in-depth field identifier check against credential/password patterns
    if (fieldIdentifier && isPasswordFieldIdentifier(fieldIdentifier)) {
      reasons.push(
        "Field identifier matches credential/password patterns; remote transmission forbidden.",
      );
    }

    // Step 3: Affirmative credential assessment
    if (credentialAssessment === "contains-credentials") {
      reasons.push(
        "Credential and secret payloads are strictly prohibited from remote transmission.",
      );
    } else if (credentialAssessment === "unknown") {
      reasons.push(
        "Credential assessment is unknown; authorization fails closed until payload is affirmatively verified free of credentials.",
      );
    }

    // Step 4: Classification rules (restricted and confidential are strictly local)
    if (policy.classification === "restricted") {
      reasons.push("Restricted data classification forbids remote transmission.");
    } else if (policy.classification === "confidential") {
      reasons.push("Confidential data classification forbids remote transmission.");
    }

    // Step 5: Sensitivity rules (high and critical cannot leave local device)
    if (policy.sensitivity === "critical") {
      reasons.push("Critical sensitivity data must remain local.");
    } else if (policy.sensitivity === "high") {
      reasons.push("High sensitivity data cannot be processed remotely.");
    }

    // Step 6: Mandatory redaction prerequisite check
    if (policy.requireRedaction && redactionCompleted !== true) {
      reasons.push("Mandatory redaction prerequisite has not been confirmed completed.");
    }

    // Step 7: Policy-level remote transmission flag
    if (!policy.allowRemoteTransmission) {
      reasons.push("Privacy policy rule explicitly disallows remote transmission.");
    }

    const allowed = reasons.length === 0;
    return {
      allowed,
      reasons: allowed
        ? [
            "Payload verified clear of credentials, redaction confirmed if required, and policy permits transmission.",
          ]
        : reasons,
    };
  } catch {
    return {
      allowed: false,
      reasons: [
        "Remote processing authorization failed closed because the runtime context could not be safely validated.",
      ],
    };
  }
}

/**
 * Convenience boolean helper delegating to evaluateRemoteProcessing.
 * Fails closed: malformed inputs, unknown credential states, or policy violations return false.
 */
export function allowsRemoteProcessing(context: RemoteProcessingContext): boolean {
  try {
    return evaluateRemoteProcessing(context).allowed;
  } catch {
    return false;
  }
}

import { describe, expect, it } from "vitest";
import {
  type PrivacyPolicyRule,
  REDACTED_MARKER,
  type RemoteProcessingContext,
  allowsRemoteProcessing,
  evaluateRemotePolicyEligibility,
  evaluateRemoteProcessing,
  isElevatedSensitivity,
  isPasswordFieldIdentifier,
  isPrivacyPolicyRule,
  isRemoteProcessingContext,
  isSensitiveClassification,
  maskSecret,
  redactSensitiveString,
  validatePrivacyPolicyRule,
  validateRemoteProcessingContext,
} from "../src/index.js";

describe("privacy/classification - classification & sensitivity helpers", () => {
  it("identifies confidential and restricted classifications as sensitive", () => {
    expect(isSensitiveClassification("confidential")).toBe(true);
    expect(isSensitiveClassification("restricted")).toBe(true);
    expect(isSensitiveClassification("public")).toBe(false);
    expect(isSensitiveClassification("internal")).toBe(false);
  });

  it("identifies high and critical sensitivities as elevated", () => {
    expect(isElevatedSensitivity("critical")).toBe(true);
    expect(isElevatedSensitivity("high")).toBe(true);
    expect(isElevatedSensitivity("medium")).toBe(false);
    expect(isElevatedSensitivity("low")).toBe(false);
  });
});

describe("privacy/runtime-validation - structural and type verification", () => {
  const validPolicy: PrivacyPolicyRule = {
    classification: "public",
    sensitivity: "low",
    allowRemoteTransmission: true,
    requireRedaction: false,
  };

  const validContext: RemoteProcessingContext = {
    policy: validPolicy,
    credentialAssessment: "clear",
    redactionCompleted: true,
  };

  it("A. rejects null, undefined, string, number, and array context inputs", () => {
    const invalidInputs: unknown[] = [null, undefined, "not-an-object", 12345, [], [validContext]];

    for (const input of invalidInputs) {
      const decision = evaluateRemoteProcessing(input as unknown as RemoteProcessingContext);
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.length).toBeGreaterThan(0);
      expect(decision.reasons.some((r) => r.includes("non-null object"))).toBe(true);
      expect(allowsRemoteProcessing(input as unknown as RemoteProcessingContext)).toBe(false);
      expect(isRemoteProcessingContext(input)).toBe(false);
    }
  });

  it("B. rejects partial policy context (e.g. only allowRemoteTransmission present)", () => {
    const partialPolicyContext = {
      policy: {
        allowRemoteTransmission: true,
      },
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      partialPolicyContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Policy classification is missing"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Policy sensitivity is missing"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Policy requireRedaction is missing"))).toBe(
      true,
    );
    expect(allowsRemoteProcessing(partialPolicyContext as unknown as RemoteProcessingContext)).toBe(
      false,
    );
    expect(isRemoteProcessingContext(partialPolicyContext)).toBe(false);
  });

  it("C. rejects invalid/unrecognized classification strings without permissive fallthrough", () => {
    const invalidClassificationContext = {
      policy: {
        ...validPolicy,
        classification: "totally-safe",
      },
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      invalidClassificationContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Policy classification is unrecognized"))).toBe(
      true,
    );
    expect(
      allowsRemoteProcessing(invalidClassificationContext as unknown as RemoteProcessingContext),
    ).toBe(false);
  });

  it("D. rejects context with missing classification", () => {
    const missingClassificationPolicy = {
      sensitivity: "low",
      allowRemoteTransmission: true,
      requireRedaction: false,
    };
    const context = {
      policy: missingClassificationPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(context as unknown as RemoteProcessingContext);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("classification is missing"))).toBe(true);
    expect(allowsRemoteProcessing(context as unknown as RemoteProcessingContext)).toBe(false);
  });

  it("E. rejects invalid/unrecognized sensitivity strings", () => {
    const invalidSensitivityContext = {
      policy: {
        ...validPolicy,
        sensitivity: "super-low",
      },
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      invalidSensitivityContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Policy sensitivity is unrecognized"))).toBe(
      true,
    );
    expect(
      allowsRemoteProcessing(invalidSensitivityContext as unknown as RemoteProcessingContext),
    ).toBe(false);
  });

  it("F. rejects context with missing sensitivity", () => {
    const missingSensitivityPolicy = {
      classification: "public",
      allowRemoteTransmission: true,
      requireRedaction: false,
    };
    const context = {
      policy: missingSensitivityPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(context as unknown as RemoteProcessingContext);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("sensitivity is missing"))).toBe(true);
    expect(allowsRemoteProcessing(context as unknown as RemoteProcessingContext)).toBe(false);
  });

  it("G. rejects string booleans for allowRemoteTransmission ('false' and 'true' not coerced)", () => {
    const stringBoolContext = {
      policy: {
        ...validPolicy,
        allowRemoteTransmission: "false",
      },
      credentialAssessment: "clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      stringBoolContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) => r.includes("allowRemoteTransmission must be an exact boolean")),
    ).toBe(true);
    expect(allowsRemoteProcessing(stringBoolContext as unknown as RemoteProcessingContext)).toBe(
      false,
    );

    // Also probe "true" as string
    const stringTrueContext = {
      ...stringBoolContext,
      policy: {
        ...validPolicy,
        allowRemoteTransmission: "true",
      },
    };
    const decisionTrue = evaluateRemoteProcessing(
      stringTrueContext as unknown as RemoteProcessingContext,
    );
    expect(decisionTrue.allowed).toBe(false);
    expect(
      decisionTrue.reasons.some((r) =>
        r.includes("allowRemoteTransmission must be an exact boolean"),
      ),
    ).toBe(true);
  });

  it("H. rejects invalid requireRedaction types (string, number, null)", () => {
    const invalidTypes = ["false", "true", 0, 1, null, {}];

    for (const val of invalidTypes) {
      const context = {
        policy: {
          ...validPolicy,
          requireRedaction: val,
        },
        credentialAssessment: "clear",
        redactionCompleted: true,
      };
      const decision = evaluateRemoteProcessing(context as unknown as RemoteProcessingContext);
      expect(decision.allowed).toBe(false);
      expect(
        decision.reasons.some((r) => r.includes("requireRedaction must be an exact boolean")),
      ).toBe(true);
      expect(allowsRemoteProcessing(context as unknown as RemoteProcessingContext)).toBe(false);
    }
  });

  it("I. rejects missing redactionCompleted even if policy does not require redaction", () => {
    const missingRedactionCompleted = {
      policy: validPolicy, // requireRedaction is false
      credentialAssessment: "clear",
    };

    const decision = evaluateRemoteProcessing(
      missingRedactionCompleted as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) =>
        r.includes("redactionCompleted must be explicitly provided as a boolean"),
      ),
    ).toBe(true);
    expect(
      allowsRemoteProcessing(missingRedactionCompleted as unknown as RemoteProcessingContext),
    ).toBe(false);
  });

  it("J. rejects invalid redactionCompleted types ('true', 1, null, undefined)", () => {
    const invalidCompletedValues = ["true", "false", 1, 0, null, {}];

    for (const val of invalidCompletedValues) {
      const context = {
        policy: validPolicy,
        credentialAssessment: "clear",
        redactionCompleted: val,
      };
      const decision = evaluateRemoteProcessing(context as unknown as RemoteProcessingContext);
      expect(decision.allowed).toBe(false);
      expect(
        decision.reasons.some((r) => r.includes("redactionCompleted must be an exact boolean")),
      ).toBe(true);
      expect(allowsRemoteProcessing(context as unknown as RemoteProcessingContext)).toBe(false);
    }
  });

  it("K. rejects invalid credentialAssessment string ('probably-clear')", () => {
    const invalidAssessmentContext = {
      policy: validPolicy,
      credentialAssessment: "probably-clear",
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      invalidAssessmentContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("credentialAssessment is unrecognized"))).toBe(
      true,
    );
    expect(
      allowsRemoteProcessing(invalidAssessmentContext as unknown as RemoteProcessingContext),
    ).toBe(false);
  });

  it("L. rejects missing credentialAssessment", () => {
    const missingAssessmentContext = {
      policy: validPolicy,
      redactionCompleted: true,
    };

    const decision = evaluateRemoteProcessing(
      missingAssessmentContext as unknown as RemoteProcessingContext,
    );
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) => r.includes("missing required 'credentialAssessment' property")),
    ).toBe(true);
    expect(
      allowsRemoteProcessing(missingAssessmentContext as unknown as RemoteProcessingContext),
    ).toBe(false);
  });

  it("M. rejects invalid fieldIdentifier types (123, {}, false)", () => {
    const invalidFieldIdentifiers = [123, {}, false, []];

    for (const badField of invalidFieldIdentifiers) {
      const context = {
        ...validContext,
        fieldIdentifier: badField,
      };
      const decision = evaluateRemoteProcessing(context as unknown as RemoteProcessingContext);
      expect(decision.allowed).toBe(false);
      expect(
        decision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
      ).toBe(true);
      expect(allowsRemoteProcessing(context as unknown as RemoteProcessingContext)).toBe(false);
    }
  });

  it("M2. own-property fieldIdentifier validation: absent and valid strings allowed; explicit undefined, null, number, boolean, object rejected", () => {
    // 1. Absent fieldIdentifier is valid
    const absentContext: RemoteProcessingContext = {
      policy: validPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const absentDecision = evaluateRemoteProcessing(absentContext);
    expect(absentDecision.allowed).toBe(true);
    expect(allowsRemoteProcessing(absentContext)).toBe(true);

    // 2. Present valid string is valid
    const validStringContext = { ...validContext, fieldIdentifier: "notes" };
    const validStringDecision = evaluateRemoteProcessing(validStringContext);
    expect(validStringDecision.allowed).toBe(true);
    expect(allowsRemoteProcessing(validStringContext)).toBe(true);

    // 3. Explicit undefined must fail closed as malformed
    const explicitUndefinedContext = { ...validContext, fieldIdentifier: undefined };
    const explicitUndefinedDecision = evaluateRemoteProcessing(
      explicitUndefinedContext as unknown as RemoteProcessingContext,
    );
    expect(explicitUndefinedDecision.allowed).toBe(false);
    expect(
      explicitUndefinedDecision.reasons.some((r) =>
        r.includes("fieldIdentifier must be a string when present"),
      ),
    ).toBe(true);
    expect(
      allowsRemoteProcessing(explicitUndefinedContext as unknown as RemoteProcessingContext),
    ).toBe(false);

    // 4. Null must fail closed
    const nullContext = { ...validContext, fieldIdentifier: null };
    const nullDecision = evaluateRemoteProcessing(
      nullContext as unknown as RemoteProcessingContext,
    );
    expect(nullDecision.allowed).toBe(false);
    expect(
      nullDecision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
    ).toBe(true);
    expect(allowsRemoteProcessing(nullContext as unknown as RemoteProcessingContext)).toBe(false);

    // 5. Number must fail closed
    const numContext = { ...validContext, fieldIdentifier: 123 };
    const numDecision = evaluateRemoteProcessing(numContext as unknown as RemoteProcessingContext);
    expect(numDecision.allowed).toBe(false);
    expect(
      numDecision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
    ).toBe(true);
    expect(allowsRemoteProcessing(numContext as unknown as RemoteProcessingContext)).toBe(false);

    // 6. Boolean must fail closed
    const boolContext = { ...validContext, fieldIdentifier: false };
    const boolDecision = evaluateRemoteProcessing(
      boolContext as unknown as RemoteProcessingContext,
    );
    expect(boolDecision.allowed).toBe(false);
    expect(
      boolDecision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
    ).toBe(true);
    expect(allowsRemoteProcessing(boolContext as unknown as RemoteProcessingContext)).toBe(false);

    // 7. Object must fail closed
    const objContext = { ...validContext, fieldIdentifier: {} };
    const objDecision = evaluateRemoteProcessing(objContext as unknown as RemoteProcessingContext);
    expect(objDecision.allowed).toBe(false);
    expect(
      objDecision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
    ).toBe(true);
    expect(allowsRemoteProcessing(objContext as unknown as RemoteProcessingContext)).toBe(false);

    // 8. Array must fail closed
    const arrContext = { ...validContext, fieldIdentifier: [] };
    const arrDecision = evaluateRemoteProcessing(arrContext as unknown as RemoteProcessingContext);
    expect(arrDecision.allowed).toBe(false);
    expect(
      arrDecision.reasons.some((r) => r.includes("fieldIdentifier must be a string when present")),
    ).toBe(true);
    expect(allowsRemoteProcessing(arrContext as unknown as RemoteProcessingContext)).toBe(false);
  });

  it("O. exception-safe malformed enum objects ({ toString: null }) do not throw and fail closed", () => {
    // Narrow cast at call boundary solely to simulate JavaScript/deserialized runtime input bypassing TypeScript
    const malformedObject = { toString: null };

    // 1. Malformed classification object
    const badClassificationContext = {
      ...validContext,
      policy: {
        ...validPolicy,
        classification: malformedObject,
      },
    };
    expect(() =>
      evaluateRemoteProcessing(badClassificationContext as unknown as RemoteProcessingContext),
    ).not.toThrow();
    const classDecision = evaluateRemoteProcessing(
      badClassificationContext as unknown as RemoteProcessingContext,
    );
    expect(classDecision.allowed).toBe(false);
    expect(
      classDecision.reasons.some((r) => r.includes("Policy classification is unrecognized")),
    ).toBe(true);
    expect(() =>
      allowsRemoteProcessing(badClassificationContext as unknown as RemoteProcessingContext),
    ).not.toThrow();
    expect(
      allowsRemoteProcessing(badClassificationContext as unknown as RemoteProcessingContext),
    ).toBe(false);

    // 2. Malformed sensitivity object
    const badSensitivityContext = {
      ...validContext,
      policy: {
        ...validPolicy,
        sensitivity: malformedObject,
      },
    };
    expect(() =>
      evaluateRemoteProcessing(badSensitivityContext as unknown as RemoteProcessingContext),
    ).not.toThrow();
    const sensDecision = evaluateRemoteProcessing(
      badSensitivityContext as unknown as RemoteProcessingContext,
    );
    expect(sensDecision.allowed).toBe(false);
    expect(sensDecision.reasons.some((r) => r.includes("Policy sensitivity is unrecognized"))).toBe(
      true,
    );
    expect(
      allowsRemoteProcessing(badSensitivityContext as unknown as RemoteProcessingContext),
    ).toBe(false);

    // 3. Malformed credentialAssessment object
    const badCredContext = {
      ...validContext,
      credentialAssessment: malformedObject,
    };
    expect(() =>
      evaluateRemoteProcessing(badCredContext as unknown as RemoteProcessingContext),
    ).not.toThrow();
    const credDecision = evaluateRemoteProcessing(
      badCredContext as unknown as RemoteProcessingContext,
    );
    expect(credDecision.allowed).toBe(false);
    expect(
      credDecision.reasons.some((r) => r.includes("credentialAssessment is unrecognized")),
    ).toBe(true);
    expect(allowsRemoteProcessing(badCredContext as unknown as RemoteProcessingContext)).toBe(
      false,
    );

    // 4. Malformed fieldIdentifier object
    const badFieldContext = {
      ...validContext,
      fieldIdentifier: malformedObject,
    };
    expect(() =>
      evaluateRemoteProcessing(badFieldContext as unknown as RemoteProcessingContext),
    ).not.toThrow();
    const fieldDecision = evaluateRemoteProcessing(
      badFieldContext as unknown as RemoteProcessingContext,
    );
    expect(fieldDecision.allowed).toBe(false);
    expect(
      fieldDecision.reasons.some((r) =>
        r.includes("fieldIdentifier must be a string when present"),
      ),
    ).toBe(true);
    expect(allowsRemoteProcessing(badFieldContext as unknown as RemoteProcessingContext)).toBe(
      false,
    );
  });

  it("P. malformed type matrix across enum-like fields ({}, [], null, 123, false) fails closed without throwing", () => {
    const malformedValues = [{}, [], null, 123, false];

    for (const val of malformedValues) {
      // Classification
      const contextClass = {
        ...validContext,
        policy: { ...validPolicy, classification: val },
      };
      const decClass = evaluateRemoteProcessing(contextClass as unknown as RemoteProcessingContext);
      expect(decClass.allowed).toBe(false);
      expect(allowsRemoteProcessing(contextClass as unknown as RemoteProcessingContext)).toBe(
        false,
      );

      // Sensitivity
      const contextSens = {
        ...validContext,
        policy: { ...validPolicy, sensitivity: val },
      };
      const decSens = evaluateRemoteProcessing(contextSens as unknown as RemoteProcessingContext);
      expect(decSens.allowed).toBe(false);
      expect(allowsRemoteProcessing(contextSens as unknown as RemoteProcessingContext)).toBe(false);

      // CredentialAssessment
      const contextCred = {
        ...validContext,
        credentialAssessment: val,
      };
      const decCred = evaluateRemoteProcessing(contextCred as unknown as RemoteProcessingContext);
      expect(decCred.allowed).toBe(false);
      expect(allowsRemoteProcessing(contextCred as unknown as RemoteProcessingContext)).toBe(false);
    }
  });

  it("N. approves known safe full context with all valid primitives", () => {
    const decision = evaluateRemoteProcessing(validContext);
    expect(decision.allowed).toBe(true);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.reasons[0]).toContain("Payload verified clear of credentials");
    expect(allowsRemoteProcessing(validContext)).toBe(true);
    expect(isRemoteProcessingContext(validContext)).toBe(true);
  });
});

describe("privacy/authorization - policy evaluation and security rules", () => {
  const permissivePolicy: PrivacyPolicyRule = {
    classification: "public",
    sensitivity: "low",
    allowRemoteTransmission: true,
    requireRedaction: false,
  };

  const redactRequiredPolicy: PrivacyPolicyRule = {
    classification: "internal",
    sensitivity: "low",
    allowRemoteTransmission: true,
    requireRedaction: true,
  };

  it("1. credentialAssessment = 'unknown' -> DENIED", () => {
    const context: RemoteProcessingContext = {
      policy: permissivePolicy,
      credentialAssessment: "unknown",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("unknown"))).toBe(true);
    expect(allowsRemoteProcessing(context)).toBe(false);
  });

  it("2. credentialAssessment = 'contains-credentials' -> DENIED", () => {
    const context: RemoteProcessingContext = {
      policy: permissivePolicy,
      credentialAssessment: "contains-credentials",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Credential and secret payloads"))).toBe(true);
    expect(allowsRemoteProcessing(context)).toBe(false);
  });

  it("3. credentialAssessment = 'clear' + password-like field identifier -> DENIED", () => {
    const context: RemoteProcessingContext = {
      policy: permissivePolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
      fieldIdentifier: "user_password_input",
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("matches credential/password"))).toBe(true);
    expect(allowsRemoteProcessing(context)).toBe(false);
  });

  it("4. credentialAssessment = 'clear' + requireRedaction = true + redactionCompleted = false -> DENIED", () => {
    const context: RemoteProcessingContext = {
      policy: redactRequiredPolicy,
      credentialAssessment: "clear",
      redactionCompleted: false,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) =>
        r.includes("Mandatory redaction prerequisite has not been confirmed"),
      ),
    ).toBe(true);
    expect(allowsRemoteProcessing(context)).toBe(false);
  });

  it("5. credentialAssessment = 'clear' + redaction completed + low sensitivity + allowed classification + remote transmission enabled -> PERMITTED", () => {
    const context: RemoteProcessingContext = {
      policy: redactRequiredPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(true);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.reasons[0]).toContain("Payload verified clear of credentials");
    expect(allowsRemoteProcessing(context)).toBe(true);
  });

  it("6. remote transmission explicitly disabled -> DENIED", () => {
    const disabledPolicy: PrivacyPolicyRule = {
      ...permissivePolicy,
      allowRemoteTransmission: false,
    };
    const context: RemoteProcessingContext = {
      policy: disabledPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some((r) => r.includes("explicitly disallows remote transmission")),
    ).toBe(true);
  });

  it("7. restricted classification -> DENIED", () => {
    const restrictedPolicy: PrivacyPolicyRule = {
      ...permissivePolicy,
      classification: "restricted",
    };
    const context: RemoteProcessingContext = {
      policy: restrictedPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Restricted data classification"))).toBe(true);
  });

  it("8. confidential classification -> DENIED", () => {
    const confidentialPolicy: PrivacyPolicyRule = {
      ...permissivePolicy,
      classification: "confidential",
    };
    const context: RemoteProcessingContext = {
      policy: confidentialPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Confidential data classification"))).toBe(true);
  });

  it("9. high sensitivity -> DENIED", () => {
    const highPolicy: PrivacyPolicyRule = {
      ...permissivePolicy,
      sensitivity: "high",
    };
    const context: RemoteProcessingContext = {
      policy: highPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("High sensitivity data"))).toBe(true);
  });

  it("10. critical sensitivity -> DENIED", () => {
    const critPolicy: PrivacyPolicyRule = {
      ...permissivePolicy,
      sensitivity: "critical",
    };
    const context: RemoteProcessingContext = {
      policy: critPolicy,
      credentialAssessment: "clear",
      redactionCompleted: true,
    };
    const decision = evaluateRemoteProcessing(context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes("Critical sensitivity data"))).toBe(true);
  });

  it("11. reasons array explains machine- and user-auditable denial causes", () => {
    const toxicContext: RemoteProcessingContext = {
      policy: {
        classification: "restricted",
        sensitivity: "critical",
        allowRemoteTransmission: false,
        requireRedaction: true,
      },
      credentialAssessment: "contains-credentials",
      redactionCompleted: false,
      fieldIdentifier: "user_secret_token",
    };
    const decision = evaluateRemoteProcessing(toxicContext);
    expect(decision.allowed).toBe(false);
    // Multiple defensive signals should all be reported in reasons
    expect(decision.reasons.length).toBeGreaterThanOrEqual(4);
    expect(decision.reasons.some((r) => r.includes("matches credential/password"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Credential and secret payloads"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Restricted"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Critical"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("Mandatory redaction"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("explicitly disallows"))).toBe(true);
  });

  it("12. No bare PrivacyPolicyRule can be used as an authorization call through the normal public API", () => {
    // If a bare policy is passed at runtime bypassing TS, it fails closed
    const barePolicyAsContext = permissivePolicy as unknown as RemoteProcessingContext;
    const decision = evaluateRemoteProcessing(barePolicyAsContext);
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some(
        (r) =>
          r.includes("missing required 'policy' property") ||
          r.includes("missing required 'credentialAssessment' property"),
      ),
    ).toBe(true);
    expect(allowsRemoteProcessing(barePolicyAsContext)).toBe(false);

    // Advisory policy check is available via separate explicit API
    const advisory = evaluateRemotePolicyEligibility(permissivePolicy);
    expect(advisory.eligible).toBe(true);

    const restrictedAdvisory = evaluateRemotePolicyEligibility({
      ...permissivePolicy,
      classification: "restricted",
    });
    expect(restrictedAdvisory.eligible).toBe(false);
  });
});

describe("privacy/redaction", () => {
  it("detects password and secret identifiers", () => {
    expect(isPasswordFieldIdentifier("user_password")).toBe(true);
    expect(isPasswordFieldIdentifier("apiKeyField")).toBe(true);
    expect(isPasswordFieldIdentifier("tokenInput")).toBe(true);
    expect(isPasswordFieldIdentifier("usernameField")).toBe(false);
    expect(isPasswordFieldIdentifier("searchQuery")).toBe(false);
  });

  it("redacts sensitive strings to standard marker", () => {
    expect(redactSensitiveString("super-secret-key")).toBe(REDACTED_MARKER);
    expect(redactSensitiveString("")).toBe("");
  });

  it("masks secrets cleanly", () => {
    expect(maskSecret("secret")).toBe("******");
    expect(maskSecret("")).toBe("");
  });
});

# @futureclick/privacy

Privacy engineering, sensitive-field exclusion, and fail-closed authorization primitives for FutureClick.

## Eventual Responsibilities

FutureClick will observe operating system and browser states before digital actions occur. This package ensures that privacy and data minimization are active architectural constraints, not passive retrospective policies:

1. **Sensitive-Field Handling:** Automated detection and classification of sensitive fields (tokens, secrets, credentials, PII).
2. **Password Exclusion:** FutureClick is designed to exclude password/credential fields at trust boundaries using multiple defensive signals (`isPasswordFieldIdentifier`).
3. **Local-First Protections:** Architectural enforcement that elevated sensitivity (`high`, `critical`) and confidential/restricted data never leave the local machine.
4. **Redaction:** Deterministic redaction pipelines (`redactSensitiveString`, `maskSecret`) requiring affirmative confirmation before any potential remote processing.
5. **Fail-Closed Authorization Engine:** Executable structured decision engine (`evaluateRemoteProcessing`) providing explicit audit reasons for any transmission decision.

## Core Privacy Engineering Principles

FutureClick establishes the following non-negotiable authorization rules:
- **Policy classification is not equivalent to authorization:** A `PrivacyPolicyRule` only declares static classification and policy constraints; it is insufficient evidence that a specific runtime payload is safe to transmit.
- **Authorization requires complete context:** Full authorization requires `evaluateRemoteProcessing(context: RemoteProcessingContext)` containing verified `credentialAssessment` and confirmed `redactionCompleted` state.
- **Runtime validation defends the trust boundary:** Because TypeScript types disappear at runtime, authorization enforces strict dependency-free structural validation. Invalid input = DENY, unknown input = DENY, incomplete input = DENY. Zero coercion is performed (e.g., string `"false"` is not converted to boolean).
- **Strict own-property presence semantics for optional fields:** If an optional field (`fieldIdentifier`) is absent, it is valid. If it is explicitly present (as an own property), its runtime type must strictly be a primitive string. Explicit `undefined`, `null`, numbers, or objects are rejected as malformed.
- **Exception-safe validation and error reporting:** Untrusted runtime values are never coerced (e.g., via `String(val)` or template literals) during validation or error message construction, preventing attacker-controlled `toString` methods or prototype poisoning from throwing exceptions. Unexpected errors fail closed defensively.
- **Missing or unknown context fails closed:** Unknown credential status (`credentialAssessment: "unknown"`) or omitted security context immediately denies remote processing. Unknown is never treated as safe.
- **Redaction must be positively confirmed:** When `requireRedaction` is true, transmission is denied unless `redactionCompleted` is explicitly and positively verified as `true`.
- **The privacy boundary never invents permissive defaults:** Safety state must be explicitly provided by callers with evidence. The authorization engine never assumes safety in the absence of evidence.
- **Defense-in-depth:** Even if `credentialAssessment` is marked `"clear"`, password-like field identifiers automatically trigger denial.

## Sprint FC-001 / FC-001D Scope

This package implements foundational data classifications (`public`, `internal`, `confidential`, `restricted`), sensitivity levels (`low`, `medium`, `high`, `critical`), fail-closed runtime validation and remote processing decision evaluation, identifier detection for password fields, and redaction markers. Advanced heuristics, contextual NLP detection, and OS-specific filtering will be introduced in subsequent platform milestones.

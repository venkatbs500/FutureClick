# FutureClick Privacy Principles

FutureClick is designed to observe pre-execution state and user actions across graphical operating systems and web platforms. Because this capability touches sensitive user environments, privacy and security are not cosmetic post-processing layers—they are non-negotiable architectural requirements.

The following 14 principles govern all current and future engineering at FutureClick:

## 1. Local-First Processing Whenever Technically Reasonable
Consequence evaluation, AST analysis, and state extraction must execute on the user's local machine by default. Remote processing is strictly opt-in and restricted to workloads that cannot execute locally.

## 2. Never Capture or Store Password-Field Contents
Under no circumstances may password inputs, credential prompts, secure entry textboxes, or key material be captured, evaluated, serialized, or retained. Adapters must drop password-field values at the operating system or DOM boundary.

## 3. Minimize Collected Data
Capture only the minimum structural metadata required to evaluate consequence and risk for the specific proposed action. Background windows, unrelated tabs, and irrelevant screen real estate must not be ingested.

## 4. Sensitive Information Must Be Redacted Before Remote Processing
If an evaluation requires off-device model evaluation or cloud-assisted simulation, all personally identifiable information (PII), session tokens, account IDs, and sensitive payloads must be deterministically masked or redacted prior to leaving the local boundary.

## 5. No Silent Keylogging
FutureClick is an intentional pre-action consequence verification system, not a surveillance tool. Arbitrary keystroke recording, background typing ingestion, and continuous input stream capturing are strictly prohibited in the core architecture.

## 6. Explicit Permissions for Invasive Capabilities
Any platform adapter requiring elevated accessibility privileges (`NSAccessibility`, Windows UI Automation, Chrome DevTools Protocol) must request explicit, granular user consent accompanied by clear descriptions of why the permission is required.

## 7. Clear User Visibility When FutureClick Is Active
The user must always have visual indication when FutureClick is monitoring, evaluating, or overlaying consequence predictions. Stealth execution or concealed background interception is forbidden.

## 8. Encrypted Transport for Remote Communication
All off-device communication (such as model inference calls or telemetry sync if enabled) must require authenticated TLS 1.3+ transport encryption with strict certificate validation. Unencrypted cleartext HTTP transport is rejected by architectural policy.

## 9. Avoid Permanent Storage of Raw Screen/Document Data by Default
Raw accessibility trees, screen buffers, DOM captures, and document bodies must be processed ephemerally in volatile memory and purged immediately after consequence evaluation. Persistent storage of raw user content is disabled by default.

## 10. Users Must Be Able to Disable Collection
Users must possess an accessible, instantaneous mechanism to pause or completely terminate action observation, disable specific adapters, or blacklist sensitive applications and domains.

## 11. Prediction Uncertainty Must Be Visible
Uncertainty is a first-class citizen. If a consequence evaluation is probabilistic, the system must clearly present its confidence score and potential blind spots to the user, preventing false senses of safety.

## 12. Distinguish VERIFIED, SIMULATED, and PREDICTED Outcomes
FutureClick must maintain an unambiguous distinction across all internal data representations and user-facing cards between:
- **VERIFIED:** A consequence derived deterministically from available evidence within an explicitly defined scope and set of assumptions. It is NOT philosophical or unconditional certainty. Verification may still be incorrect if the observed state is incomplete, underlying data is stale, platform behavior changes, assumptions are violated, or external systems behave differently.
- **SIMULATED:** A consequence observed in an isolated, sandboxed, or controlled execution context. It demonstrates what occurred in that simulation under those conditions; it is not a guarantee that the live environment will behave identically.
- **PREDICTED:** A probabilistic or model-derived consequence projection. It must explicitly expose calibrated uncertainty and must never be represented as verified fact.

## 13. No Consequential Action Silently Executed on Behalf of the User
FutureClick is an advisory and consequence-prediction engine. It must never autonomously trigger, alter, or dispatch consequential actions without explicit human confirmation.

## 14. Security and Privacy Requirements Are Architectural Requirements
Security and privacy guarantees must be implemented at the schema, type-system, and package-boundary levels. They cannot be bypassed for convenience or deferred as technical debt.

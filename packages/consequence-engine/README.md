# @futureclick/consequence-engine

Central consequence orchestration engine for FutureClick (Sprint FC-002 / FC-002A / FC-002B / FC-002D / FC-004).

## Eventual Responsibilities

This package is responsible for coordinating the multi-tiered evaluation of proposed digital actions. It dispatches proposed actions to three distinct evaluation modalities:

1. **VERIFIED Consequences:**
   - Consequences derived deterministically from available evidence within an explicitly defined scope and set of assumptions.
   - *Epistemological Boundary:* Verification is not philosophical or unconditional certainty. Verification may still be incorrect if the observed state is incomplete, underlying data is stale, platform behavior drifts, or foundational assumptions are violated.

2. **SIMULATED Consequences:**
   - Consequences observed in an isolated, sandboxed, or controlled execution context (e.g., dry-run CLI executions, temporary branch file simulations, shadow DOM dry-runs).
   - *Epistemological Boundary:* Demonstrates empirical behavior observed in that simulation under those conditions; does not guarantee that live environments will behave identically.

3. **PREDICTED Consequences:**
   - Probabilistic inferences and learned model projections predicting state transitions across unseen applications and GUI workflows.
   - *Epistemological Boundary:* Future evaluators may emit calibrated confidence values. FC-002 only validates representation and numeric bounds; no calibration method or empirical calibration is implemented. Predictions must never be represented as verified fact.

## Deterministic Verified Rules Engine (Sprint FC-004 / FC-004A / FC-004B)

FC-004 and the FC-004A/FC-004B semantic hardening passes implement FutureClick's first consequence-derivation mechanism via deterministic verified rules (`src/rules/`):

- **Rule Identity:** Branded `RuleId` (`segment.segment`) and `RuleVersion` (`1.0`). Active registry enforces one active version per `RuleId`. Leading and trailing whitespace is strictly rejected (Finding L1).
- **Pure Execution:** Rules are synchronous, pure, deterministic, side-effect free, and have no network, file, or live OS access.
- **Rule Immutability (Finding M1):** `createRuleSet` snapshots every registered rule definition into a runtime-frozen object (`Object.freeze`). Public built-in rule definitions are also frozen.
- **Authoritative RuleSet Normalization & Coherent Snapshot (Finding M2 / FC-004B):** `evaluateDeterministicRules` always normalizes rule inputs through `createRuleSet`. Registry-shaped objects have their `.rules` property read safely exactly once, and caller arrays are captured via `captureDenseArrayOnce` (capturing length once, reading each index once, rejecting sparse arrays, and detaching the snapshot before validation). This prevents registry bypass by duck-typed objects or dynamic Proxy getters.
- **Rule Decision Model (Finding L3):** Explicitly distinguishes `MATCHED` (with consequence drafts), `NOT_APPLICABLE` (unrelated intent), and `INSUFFICIENT_EVIDENCE` (missing facts/parameters). Extra unexpected properties on decision variant objects are strictly rejected.
- **Abstention Guarantee:** Lack of evidence produces no consequences; the engine never guesses or hallucinates missing facts.
- **Explainability Trace & Token Contract (Finding M4):** Produces deterministic, immutable evaluation traces. `reasonCode` is constrained to `^[A-Z][A-Z0-9_]*$` (max 64 chars) and `missing` tokens are constrained to `^[a-z][a-z0-9_.-]*$` (max 64 chars), preventing raw sensitive payload leakage. (Traces strictly exclude sensitive payloads; error messages convey structured diagnostics for local debugging).
- **Fact Resolution Semantics (Finding H1):** Canonical state facts are resolved via `resolveUniqueFact`. When multiple facts match a key for an entity, the helper flags them as ambiguous and the rule abstains with `INSUFFICIENT_EVIDENCE` (even if facts hold identical values, order-independently).
- **Target Cardinality Semantics (Finding H2):** Action targets are resolved via `resolveUniqueTargetByRole`. When multiple targets match a supported role, the helper flags them as ambiguous and the rule abstains with `INSUFFICIENT_EVIDENCE`. All built-in rules require exactly one primary target; document share requires exactly one primary and one recipient target.
- **ActionGraph Integration & Metadata Determinism (Finding M5, L4):** Uses FC-003's `ActionGraph` as a structural lookup index. Graph evaluation time resolves deterministically from caller options or `context.createdAt` (explicit `undefined` rejected). Graph construction uses an isolated, local deterministic ID generator that does not consume caller consequence ID generators.
- **Normalized ID Collision Detection (Finding M3):** Uniqueness checks for `ConsequenceId` and `EvidenceId` occur on *normalized* IDs after canonical validation confirms validity, tracking separate namespaces and failing closed with `[ID_COLLISION]`.
- **Confidence Policy (Option B, Finding H6):**
  - Frozen FC-002 requires aggregate `Consequence.confidence`.
  - `ConsequenceDraft.confidence` is strictly required on drafts; the evaluator contains NO default (`draft.confidence ?? 1.0` was completely removed). Matched drafts with missing or invalid confidence fail closed with `INVALID_RULE_OUTPUT`.
  - Built-in rules explicitly provide `createConfidenceScore(1.0)` ONLY after all hardened deterministic preconditions pass.
  - **Epistemological Meaning of 1.0:** Consequence confidence of `1.0` denotes complete deductive confidence *within the rule model* under explicit scope and assumptions. It does **not** denote real-world execution certainty, operating system acceptance, post-execution verification, or calibrated probability.
  - `EvidenceRecord.confidence` remains optional and omitted for deterministic verified evidence.
- **Conflict Detection:** Keyed by `(entityId, property)`. Contradictory post-states fail closed with `[RULE_OUTPUT_CONFLICT]`, and duplicate overlapping transitions fail closed with `[OVERLAPPING_RULE_TRANSITION]`. (Deferred Low Finding: differences in object key insertion order fail closed as `RULE_OUTPUT_CONFLICT` rather than `OVERLAPPING_RULE_TRANSITION`).
- **Built-in Rules:**
  1. `filesystem.delete.file` (Finding H4): Derives move-to-trash (reversible) vs permanent deletion (irreversible). Strictly validates `moveToTrash` and `permanent` as boolean primitives; only `(true, false)` and `(false, true)` combinations are supported. Missing, non-boolean, or contradictory flags abstain with `INSUFFICIENT_EVIDENCE`.
  2. `version_control.repository.visibility`: Derives private-to-public visibility transitions with high security/privacy exposure classifications.
  3. `collaboration.document.share` (Finding H5 / FC-004B): Strictly validates `document.shared_with` using canonical `validateId<EntityId>` normalization. Duplicate detection occurs after normalization. Dense arrays of canonical EntityIds are required; sparse, non-array, empty, non-string, or duplicate entries result in `INSUFFICIENT_EVIDENCE`. If the recipient (normalized) is already present, the rule abstains with `NOT_APPLICABLE` (`ALREADY_SHARED`). Derived state transitions produce normalized canonical EntityId arrays without alias leakage.
  4. `billing.subscription.activate` (Finding H3): Derives subscription activation with recurring temporal semantics only when `autoRenew === true` AND a supported `billingInterval` (`"monthly"` or `"annual"`) is specified. Non-recurring subscriptions abstain with `NOT_APPLICABLE`. Missing or unsupported intervals abstain with `INSUFFICIENT_EVIDENCE`. Never invents pricing.
- **Engine Adapter & Option Presence (Finding Section 27):** `createDeterministicRuleEvaluator` bridges deterministic rule evaluation into `ConsequenceEngine` as an `IConsequenceEvaluator` with `mode: "verified"`. Preserves option presence semantics, strictly rejecting explicit `undefined` for `generatedAt` or `rules`.

## Canonical Architecture (Sprint FC-002 / FC-002D)

The consequence engine implements an authoritative, fail-closed evaluation boundary:

- **Single Authoritative Input:** `evaluate(context: ActionEvaluationContext)` directly accepts exactly one source of truth: `ActionEvaluationContext`. The unnecessary request wrapper has been removed to eliminate re-read vulnerabilities.
- **Authoritative Pre-Evaluation Validation:** The engine executes `validateActionEvaluationContext` before any evaluator is invoked. Structurally or semantically invalid contexts are rejected immediately with `err(Error)` and evaluator call count remains 0.
- **Evaluators Receive Runtime-Frozen Snapshots:** Evaluators receive the validated, runtime-frozen context snapshot (`deepFreezeCanonical(contextValidation.value)`), not the untrusted caller input. Dynamic getters or subsequent mutations on the caller's object cannot reach evaluators.
- **Evaluator Isolation Semantics:** Evaluators receive a shared runtime-frozen canonical context. They may inspect it. They may not mutate it (runtime attempts throw in strict mode or fail safely). Future evaluators return new consequence/evidence records. No process isolation or worker sandboxes are implemented.
- **Authoritative Lineage Capture & Defense-in-Depth:** Authoritative lineage identifiers (`evaluationContextId`, `actionId`) are captured locally BEFORE evaluators are invoked. The assessment is constructed using these captured IDs and is authoritatively validated against the frozen context (`validateConsequenceAssessment`) before returning. If any evaluator attempts to return consequences with inconsistent `actionId` or duplicate IDs, assessment validation fails closed and returns `err(Error)`.
- **Evaluator Contract:** Evaluators declare an explicit modality (`mode: EvidenceMode`) and consume `ActionEvaluationContext`, producing evaluated consequences wrapped in typed `Result<EvaluatorResult, Error>`.
- **Preserved Failure Semantics & Exception Safety:**
  - Typed evaluator failures are preserved directly without transformation or fallback.
  - Hostile throwing evaluators (throwing `Object.create(null)`, `{ toString: null }`, strings, or standard Errors) are caught safely using `normalizeThrownError` and wrapped in `err(Error)` without crashing the host process.
  - Evaluation halts immediately on the first failure; consequences are never fabricated after a failure.

## Implementation Status

**FC-004 provides:**
- Deterministic verified rule definitions, contracts, and registries
- Structural ActionGraph lookup for action targets and facts
- Tri-state rule decisions (matched, not-applicable, insufficient-evidence)
- Deterministic explainability traces without raw payload leakage
- Conservative conflict detection and duplicate transition rejection
- 4 built-in canonical rules (file delete, repo visibility, document share, subscription activation)
- `createDeterministicRuleEvaluator` ConsequenceEngine adapter

**FC-004 does NOT provide:**
- Universal product coverage (built-ins cover narrowly defined synthetic cases)
- Post-execution live verification (derivation is not live confirmation)
- Real action interception, native OS hooks, or browser extensions
- Simulation or sandbox execution
- Statistical prediction or machine learning models
- Telemetry, persistence, or user-submitted executable rules

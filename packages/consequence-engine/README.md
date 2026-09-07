# @futureclick/consequence-engine

Central consequence orchestration engine for FutureClick (Sprint FC-002 / FC-002A / FC-002B / FC-002D).

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

## Canonical Architecture (Sprint FC-002 / FC-002D)

The consequence engine implements an authoritative, fail-closed evaluation boundary:

- **Single Authoritative Input:** `evaluate(context: ActionEvaluationContext)` directly accepts exactly one source of truth: `ActionEvaluationContext`. The unnecessary request wrapper has been removed to eliminate re-read vulnerabilities.
- **Authoritative Pre-Evaluation Validation:** The engine executes `validateActionEvaluationContext` before any evaluator is invoked. Structurally or semantically invalid contexts are rejected immediately with `err(Error)` and evaluator call count remains 0.
- **Evaluators Receive Runtime-Frozen Snapshots:** Evaluators receive the validated, runtime-frozen context snapshot (`deepFreezeCanonical(contextValidation.value)`), not the untrusted caller input. Dynamic getters or subsequent mutations on the caller's object cannot reach evaluators.
- **Evaluator Isolation Semantics:** Evaluators receive a shared runtime-frozen canonical context. They may inspect it. They may not mutate it (runtime attempts throw in strict mode or fail safely). Future evaluators return new consequence/evidence records. No process isolation or worker sandboxes are implemented in FC-002.
- **Authoritative Lineage Capture & Defense-in-Depth:** Authoritative lineage identifiers (`evaluationContextId`, `actionId`) are captured locally BEFORE evaluators are invoked. The assessment is constructed using these captured IDs and is authoritatively validated against the frozen context (`validateConsequenceAssessment`) before returning. If any evaluator attempts to return consequences with inconsistent `actionId` or duplicate IDs, assessment validation fails closed and returns `err(Error)`.
- **Evaluator Contract:** Evaluators declare an explicit modality (`mode: EvidenceMode`) and consume `ActionEvaluationContext`, producing evaluated consequences wrapped in typed `Result<EvaluatorResult, Error>`.
- **Preserved Failure Semantics & Exception Safety:**
  - Typed evaluator failures are preserved directly without transformation or fallback.
  - Hostile throwing evaluators (throwing `Object.create(null)`, `{ toString: null }`, strings, or standard Errors) are caught safely using `normalizeThrownError` and wrapped in `err(Error)` without crashing the host process.
  - Evaluation halts immediately on the first failure; consequences are never fabricated after a failure.

## Implementation Status

**FC-002 provides:**
- detached normalized canonical records
- runtime-frozen evaluator context at the engine boundary
- representation/validation only

**FC-002 does NOT provide:**
- real action interception
- simulation
- prediction
- confidence calibration
- privacy content classification
- execution sandboxing

All evaluators and scenarios in FC-002 are synthetic test representations proving schema and engine contracts.

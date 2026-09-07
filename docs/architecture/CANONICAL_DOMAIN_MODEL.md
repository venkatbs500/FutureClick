# FutureClick Canonical Domain Model (Sprint FC-002 / FC-002A)

## Status Notice: Representation Only

**Sprint FC-002 / FC-002A defines domain data modeling, runtime validation, serialization, and typing contracts ONLY.**

FutureClick is being designed to evaluate consequences before digital actions execute. However, as of Sprint FC-002A, FutureClick does **NOT** yet:
- Intercept user actions across browsers or desktop operating systems.
- Predict real outcomes using machine learning models or heuristics.
- Simulate actions in live execution sandboxes.
- Execute, modify, or cancel digital actions.

All structures and scenarios described in this document represent foundational data contracts that future adapters, evaluators, and presentation surfaces will produce and consume. All scenario fixtures in tests are synthetic representations used to verify schema genericity.

---

## Architectural Context and Data Flow

FutureClick's central architectural principle is that platform adapters (macOS, Windows, Linux, Web) observe platform-specific events and normalize them into a single, platform-neutral canonical domain model. Consequence evaluation logic operates strictly against this canonical representation, insulating core intelligence from native API churn.

```
StateSnapshot (Observed State)
      +
ProposedAction (User Intent)
      ↓
ActionEvaluationContext (Input Envelope)
      ↓
[Consequence Engine (validateActionEvaluationContext)]
      ↓
ConsequenceAssessment (Output Envelope)
      ↓
Consequence[] (Evaluated Consequences)
```

---

## 1. Schema Versioning

All top-level canonical domain objects identify their schema version explicitly:

- Constant: `FUTURECLICK_SCHEMA_VERSION = "1.0"`
- Type: `SchemaVersion`
- Envelope fields: `StateSnapshot.schemaVersion`, `ProposedAction.schemaVersion`, `Consequence.schemaVersion`, `ActionEvaluationContext.schemaVersion`, `ConsequenceAssessment.schemaVersion`

Breaking schema revisions in future releases will require explicit migration machinery and version negotiation.

---

## 2. Canonical Identifiers

All domain identifiers reuse FutureClick's branded identifier infrastructure (`Brand<string, ...>` from `@futureclick/shared`). Identifiers are opaque, non-semantic, and collision-resistant:

- `StateSnapshotId`: Unique identifier for an observed state snapshot.
- `EntityId`: Unique identifier for an entity (file, UI element, repository, etc.).
- `ActionId`: Unique identifier for a proposed action.
- `ConsequenceId`: Unique identifier for an evaluated consequence.
- `EvidenceId`: Unique identifier for supporting evidence.
- `ObservationId`: Unique identifier for a state fact or observation.
- `EvaluationContextId`: Unique identifier for an evaluation context.
- `AssessmentId`: Unique identifier for a consequence assessment.

Legacy provisional identifier aliases (`StateId`, `TargetId`, `FactId`) have been removed from the canonical core.

---

## 3. Environment Model & Identity Authority

The `EnvironmentDescriptor` represents where state observation and proposed actions take place using orthogonal dimensions:

- `environmentId`: Opaque string identifier for the evaluation environment.
- `kind`: Structural environment category (`"browser" | "desktop" | "terminal" | "filesystem" | "application" | "service" | "unknown"`).
- `platform`: Operating system or runtime host (`"macos" | "windows" | "linux" | "web" | "unknown"`). Legacy `"browser"` has been removed from platform to eliminate taxonomy leakage (`"browser"` is an environment kind).
- `application`: Generic application descriptor (`{ id?: string; name: string; version?: string }`).
- `sessionId`: Optional session correlation token.

### Authoritative Environment Compatibility Semantics
In `ActionEvaluationContext`, the state environment and action environment must represent the same execution realm:
1. `environmentId`: MUST match exactly between state and action.
2. `platform`: MUST match unless either is `"unknown"`.
3. `kind`: MUST match unless either is `"unknown"`.
4. `application`: If both declare `id`, IDs MUST match. Otherwise, application `name` must match.
5. `sessionId`: If both declare `sessionId`, session IDs MUST match.

---

## 4. Canonical State Model

A `StateSnapshot` represents FutureClick's normalized understanding of the environment at a specific moment in time prior to execution.

**Bounded Scope Invariant:**
A `StateSnapshot` represents only the localized, bounded context observed by an adapter (e.g., active window, target directory, current document). It does **NOT** represent the entire computer or full system state.

Components:
- `schemaVersion`: Schema version (`"1.0"`).
- `id`: Unique `StateSnapshotId`.
- `observedAt`: Canonical UTC ISO-8601 timestamp (`IsoTimestamp`).
- `environment`: `EnvironmentDescriptor`.
- `entities`: Readonly dense array of `CanonicalEntity` records.
- `facts`: Readonly dense array of `StateFact` records.
- `provenance`: Optional `ProvenanceDescriptor`.

### Canonical Entity (`CanonicalEntity`) vs. State Fact (`StateFact`)
To eliminate ambiguity between entity attributes and observed facts, FutureClick defines strict authority rules:

1. **`CanonicalEntity.attributes`:** Stable, descriptive metadata about the entity that does not change during normal action evaluation.
   - Examples: file path, file extension, MIME category, resource class, owner identity.
2. **`StateFact`:** Time-bound observed mutable state used for evaluation and state-transition reasoning.
   - Examples: `file.size_bytes`, `repository.visibility`, `permission.camera`, `subscription.status`.
3. **Precedence Rule:** If a datum may change over time and matters to state transition reasoning, it MUST be represented as a `StateFact`. Entity attributes must not silently override facts.
4. **Fact Key Convention:** Fact keys must follow a strict namespaced pattern (`namespace.property`) matching `/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/`. Display text or un-namespaced keys are rejected.
5. **Entity Kind & domainKind Normalization:** `CanonicalEntity.kind` belongs to `KNOWN_ENTITY_KINDS` (`file`, `folder`, `ui_control`, `document`, `repository`, `message`, `account`, `permission`, `application`, `process`, `subscription`, `form`, `resource`, `other`). When `kind === "other"`, a namespaced `domainKind` (matching `/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/`) is strictly REQUIRED. When `kind !== "other"`, `domainKind` MUST be absent.

---

## 5. Proposed Action Model

A `ProposedAction` represents a user or system operation proposal and its canonical evaluation lifecycle record:

- `schemaVersion`: Schema version (`"1.0"`).
- `id`: `ActionId`.
- `proposedAt`: Canonical UTC ISO-8601 timestamp.
- `environment`: `EnvironmentDescriptor`.
- `actor`: `ActionActor` (`kind: "human" | "system" | "agent" | "unknown"`, optional opaque `id`).
- `intent`: `ActionIntent` (`verb: ActionVerb`, optional domain string).
- `targets`: Readonly dense array of `ActionTarget` records.
- `parameters`: JSON-safe dictionary of action arguments.
- `executionStatus`: Lifecycle status (`"proposed" | "approved" | "rejected" | "executing" | "executed" | "failed" | "cancelled"`).
- `provenance`: Optional `ProvenanceDescriptor`.

### Structured Action Targets (`ActionTarget`)
To prevent positional ambiguity, action targets are structured references:
- `entityId`: `EntityId` of the target entity.
- `role`: Controlled `ActionTargetRole` (`primary`, `source`, `destination`, `recipient`, `container`, `account`, `resource`, `subject`, `other`).
- **Semantic Invariant:** Exact duplicate `(entityId, role)` pairs are rejected.

### Chronology Invariant
In pre-execution consequence evaluation, an action proposal cannot precede the state snapshot used to evaluate it:
- Semantic invariant: `action.proposedAt >= state.observedAt`. Any action timestamp strictly before state observation timestamp produces a `CHRONOLOGY_VIOLATION` error.

---

## 6. Consequence Model

A `Consequence` describes a potential or established outcome evaluated for an action:

- `schemaVersion`: Schema version (`"1.0"`).
- `id`: `ConsequenceId`.
- `actionId`: `ActionId` correlating to the proposed action.
- `kind`: Broad structural category (`"state-change" | "data-loss" | "data-exposure" | "permission-change" | "financial" | "communication" | "execution" | "availability" | "security" | "privacy" | "dependency-impact" | "unknown"`).
- `summary`: Human-readable summary of the consequence.
- `affectedEntities`: Readonly dense array of unique `EntityId` records directly impacted.
- `stateChanges`: Readonly dense array of `StateChange` records.
- `evidence`: Supporting `EvidenceRecord` chain.
- `confidence`: Bounded numerical score in `[0.0, 1.0]` (`ConfidenceScore`).
- `reversibility`: `ReversibilityDescriptor`.
- `risk`: `RiskDescriptor`.
- `temporal`: Optional `TemporalDescriptor`.
- `provenance`: Optional `ProvenanceDescriptor`.

### State Change Semantics (`StateChange`)
- `entityId`: Target entity.
- `property`: Property name being mutated.
- `operation`: Mutation operation (`"add" | "remove" | "replace" | "unknown"`).
- `before`: `ValueState`.
- `after`: `ValueState`.

**Operation Invariants:**
- `add`: `before` must be `absent` or `unknown`; `after` must not be `absent`.
- `remove`: `before` must not be `absent`; `after` must be `absent` or `unknown`.
- `replace`: `before` must not be `absent`; `after` must not be `absent`.
- `unknown`: No operation-specific transition restriction.

**Affected Entity Consistency:** Every entity referenced by `stateChanges[].entityId` MUST appear in `affectedEntities`. Duplicate affected entity IDs are rejected.

---

## 7. Tri-Modal Evidence & Confidence Semantics

Every consequence is grounded in an audit trail of `EvidenceRecord` instances adhering to FutureClick's tri-modal epistemological boundary:

1. **VERIFIED:**
   - Deterministically derived from available evidence under explicit assumptions and scope.
   - *Epistemological Boundary:* Verification is not unconditional certainty; it remains subject to assumption invalidation or unmodeled external state. Confidence is optional.
2. **SIMULATED:**
   - Observed within an isolated, sandboxed, or controlled execution context (e.g., dry-run CLI, sandbox directory).
   - *Epistemological Boundary:* Demonstrates empirical behavior within that sandbox; does not guarantee live production parity. Confidence is optional.
3. **PREDICTED:**
   - Probabilistic projection or learned neural inference with uncertainty.
   - *Epistemological Boundary:* Future evaluators may emit calibrated confidence values. FC-002 only validates representation and numeric bounds; no calibration method or empirical calibration is implemented. Confidence score in `[0.0, 1.0]` is **strictly mandatory**. Must never be presented as verified fact.

### Evidence Structure
- `id`: Unique `EvidenceId`.
- `mode`: `"verified" | "simulated" | "predicted"`.
- `source`: Provenance source kind.
- `observedAt`: Canonical UTC timestamp.
- `scope`: Mandatory non-empty string defining the validity boundary of the evidence.
- `assumptions`: Dense array of `Assumption` records (`id`, `statement`, `status`).
- `confidence`: Bounded numerical score in `[0.0, 1.0]`. Future evaluators may emit calibrated confidence values; FC-002 only validates representation and numeric bounds. Required for `predicted` mode; optional for `verified` and `simulated` modes.
- `summary`: Non-empty explanatory summary.
- `details`: Optional plain JSON object.

### Evidence Confidence vs. Consequence Confidence
FutureClick distinguishes two levels of confidence semantics:
1. **`EvidenceRecord.confidence`:** Confidence in the specific evidence claim under that record's evidence mode, scope, and assumptions. Required for `predicted` mode; optional for `verified` and `simulated` modes.
2. **`Consequence.confidence`:** Aggregate confidence that the represented consequence is a correct/likely outcome given the available evidence, assumptions, and state/action context. FC-002 does NOT define an aggregation algorithm (it is not a mathematical average of evidence confidence). A value of 1.0 never represents philosophical certainty.

### Evidence Ownership & Uniqueness
- Evidence records live inside `Consequence.evidence` and `StateFact.evidence`.
- Within a consequence: Every `EvidenceId` must be unique.
- Within an assessment: Duplicate `EvidenceId` values across consequences are rejected.
- Within a state snapshot: Duplicate `EvidenceId` values across facts are rejected (standalone invariant).

---

## 8. Temporal, Risk, and Reversibility Models

### Temporal Semantics (`TemporalDescriptor`)
Separates timing from frequency:
- `timing`: `"immediate" | "near-term" | "long-term" | "unknown"`.
- `frequency`: `"once" | "recurring" | "continuous" | "unknown"`.

### Risk Semantics (`RiskDescriptor`)
Models qualitative impact without arbitrary numeric risk calculations:
- `severity`: `"none" | "low" | "medium" | "high" | "critical" | "unknown"`.
- `categories`: Readonly array of `"privacy" | "security" | "financial" | "data-loss" | "availability" | "reputation" | "other"`.
- **Invariants:**
  - Severity `"none"` requires an empty `categories` array.
  - Known non-none severities (`"low"`, `"medium"`, `"high"`, `"critical"`) require at least one category.
  - Severity `"unknown"` may have zero or more unique categories.
  - Duplicate categories are rejected.

### Reversibility Semantics (`ReversibilityDescriptor`)
Models operational recovery mechanics:
- `level`: `"reversible" | "partially_reversible" | "irreversible" | "unknown"` (legacy `"fully_reversible"` removed).
- `method`: Optional description of recovery process.
- `timeWindow`: Optional operational window for recovery.
- `requirements`: Optional prerequisites for recovery.
- **Invariants:**
  - `irreversible` consequences cannot specify a recovery method.
  - `unknown` reversibility cannot specify a recovery method or timeWindow.

---

## 9. Canonical Envelopes & Engine Boundary

1. **`ActionEvaluationContext` (Input Envelope):**
   - The single authoritative source of truth passed to consequence evaluators.
   - Binds `StateSnapshot` and `ProposedAction` under an `EvaluationContextId`.
   - The engine consumes `evaluate(context: ActionEvaluationContext)` directly; the wrapper has been removed to eliminate re-read vulnerabilities.
   - Evaluators receive the validated, immutable snapshot (`contextValidation.value`), completely neutralizing hostile dynamic getters.
2. **`ConsequenceAssessment` (Output Envelope):**
   - Produced by consequence evaluation.
   - Binds `evaluationContextId`, `actionId`, evaluated `Consequence[]`, `generatedAt`, and engine `ProvenanceDescriptor`.
   - Guaranteed traceability from assessment back to the exact evaluation context.

---

## 10. Runtime Validation & Serialization Soundness

### Validated Snapshot Architecture (FC-002B)
A successful validation result is a trusted immutable SNAPSHOT of the exact data validated:
- **One-Read Property Capture:** Properties are read at most ONCE using `readOwnProperty`, which safely distinguishes `absent`, `present`, and `error` states.
- **Required Property Rule:** `absent` or `error` yields `INVALID`.
- **Optional Property Rule:** `absent` is valid omission. `present` must satisfy the declared field type. Explicit `undefined` is rejected (matching `exactOptionalPropertyTypes`). `error` (e.g. throwing getter) yields `INVALID` and never becomes field absence.
- **Normalized Detached Output:** Returned `value` is reconstructed from captured scalars, nested validated snapshots, and newly constructed dense arrays/objects. Hostile getters and subsequent mutations on untrusted input objects are completely neutralized.

### Exception Safety & Fail-Closed Behavior
All exported runtime validators (`json.ts`, `validation.ts`, `serialization.ts`) are guaranteed to fail closed without throwing:
- Hostile getters and throwing prototypes are caught via `readOwnProperty`.
- Hostile thrown values (`Object.create(null)`, `{ toString: null }`, string throws) are normalized safely via `normalizeThrownError` without string coercion exceptions.
- `isDenseArray` is exception-safe: hostile proxies with throwing length or index traps return `false` without throwing.
- Error messages describe static failed validation rules and never interpolate unvalidated hostile strings.
- Discriminated union `ValidationResult<T>` guarantees that `valid: true` statically provides `value: T`.

### JSON-Safe Model & Consistent Depth Policy
- `MAX_JSON_VALUE_DEPTH = 32` applies to payload values (`attributes`, `parameters`, `details`) from their own roots.
- The structural nesting of the domain envelope does not consume the payload's depth budget.
- Serializers validate domain rules and serialize the validated normalized representation without applying conflicting whole-envelope double depth budgeting.
- Rejects: `undefined`, non-finite numbers (`NaN`, `Infinity`, `-Infinity`), `bigint`, `symbol`, `function`, class instances (`Date`, `RegExp`, `Map`, `Set`), sparse arrays, circular references, and structures deeper than maxDepth.
- Accepts: JSON primitives, dense arrays, plain objects, and shared-reference DAGs (using active recursion-path cycle detection).

### Identity Fields & Presence Semantics
- Optional ID fields (`application.id`, `sessionId`, `actor.id`) permit omission.
- If supplied, they must be non-empty and non-whitespace strings; empty strings `""` or whitespace `"   "` are rejected.

### Privacy Principle Reminder
**JSON-safe does NOT mean privacy-safe.** Runtime validation verifies data structure and serializability, not privacy posture. Platform adapters are strictly required to redact credentials, tokens, cookies, and sensitive PII before constructing canonical domain objects.

---

## 11. Implementation Status

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

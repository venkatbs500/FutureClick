# @futureclick/action-schema

Canonical data contracts, runtime validators, factories, and serialization helpers for FutureClick (Sprint FC-002 / FC-002A).

## Architectural Purpose

This package defines the universal data representation for pre-execution consequence evaluation across all platforms (macOS, Windows, Linux, and Web).

Platform adapters observe platform-specific events and normalize them into `@futureclick/action-schema` types:
```
StateSnapshot (Observed Local State)
      +
ProposedAction (User Intent)
      ↓
ActionEvaluationContext (Input Envelope)
      ↓
[Consequence Engine]
      ↓
ConsequenceAssessment (Output Envelope)
      ↓
Consequence[] (Evaluated Outcomes)
```

## Canonical Core Concepts (Sprint FC-002 / FC-002A)

- **Schema Version (`FUTURECLICK_SCHEMA_VERSION`):** Explicit domain schema version (`"1.0"`).
- **Branded Identifiers:** Opaque, collision-resistant identifiers (`StateSnapshotId`, `EntityId`, `ActionId`, `ConsequenceId`, `EvidenceId`, `ObservationId`, `EvaluationContextId`, `AssessmentId`).
- **EnvironmentDescriptor:** Platform-neutral context across orthogonal dimensions:
  - `kind`: `browser`, `desktop`, `terminal`, `filesystem`, `application`, `service`, `unknown`.
  - `platform`: `macos`, `windows`, `linux`, `web`, `unknown` (strictly orthogonal; `"browser"` is an environment kind, not an OS platform).
  - `application`: structured application identity (`id`, `name`, `version`).
  - `sessionId`: optional evaluation session identifier.
- **StateSnapshot:** Bounded snapshot of local entities and facts prior to action execution (represents an evaluation context, not the entire operating system).
- **CanonicalEntity vs. StateFact Authority:**
  - `CanonicalEntity.attributes`: stable descriptive/identity metadata about an entity (e.g. file extension, MIME category, resource class).
  - `StateFact`: time-bound observed mutable state used for evaluation (e.g. `file.size_bytes`, `repository.visibility`, `permission.camera`, `subscription.status`).
  - **Precedence Rule:** If a datum may change over time and matters to state transition reasoning, it MUST be represented as a `StateFact`. Entity attributes must not silently override facts.
  - **Fact Key Convention:** Strictly enforced namespaced pattern `namespace.property` matching `/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/`.
- **ProposedAction:** Descriptive representation of an intended operation before execution:
  - `actor`: `human`, `system`, `agent`, or `unknown`.
  - `intent`: broad canonical `ActionVerb` and optional domain qualifier.
  - `targets`: structured `ActionTarget[]` with explicit `ActionTargetRole` (`primary`, `source`, `destination`, `recipient`, `container`, `account`, `resource`, `subject`, `other`) to avoid positional ambiguity. Exact duplicate `(entityId, role)` pairs are rejected.
  - `parameters`: JSON-safe parameter dictionary.
  - `executionStatus`: ProposedAction begins as a proposal and can serve as its canonical lifecycle record (`proposed`, `approved`, `rejected`, `executing`, `executed`, `failed`, `cancelled`). Future execution-verification data remains separate/out of scope.
- **Consequence:** Evaluated potential outcome classified across broad categories (`state-change`, `data-loss`, `data-exposure`, `permission-change`, `financial`, `security`, `privacy`, `communication`, `execution`, `availability`, `dependency-impact`, `unknown`).
- **StateChange:** Explicit delta model distinguishing `{ status: "known", value }`, `{ status: "absent" }`, and `{ status: "unknown" }`. Enforces strict semantic transition invariants for `add`, `remove`, and `replace` operations.
- **Affected Entity Consistency:** Every entity referenced by a consequence's `stateChanges` must be declared in `affectedEntities`. Duplicate affected entity IDs are rejected.
- **EvidenceRecord:** Grounding supporting the consequence, strictly preserving the tri-modal epistemological boundary:
  - **VERIFIED:** Deterministically derived within an explicit scope and defined assumptions (not unconditional certainty). Confidence is optional.
  - **SIMULATED:** Observed within an isolated sandbox under controlled conditions (not a live production guarantee). Confidence is optional.
  - **PREDICTED:** Probabilistic projection with uncertainty (never represented as fact). Future evaluators may emit calibrated confidence values. FC-002 only validates representation and numeric bounds; no calibration method or empirical calibration is implemented. Confidence score in `[0.0, 1.0]` is strictly REQUIRED.
  - **Scope & Assumptions:** Every evidence record must declare an explicit `scope` string defining its validity boundaries.
  - **Evidence Ownership & Uniqueness:** Evidence records live in `Consequence.evidence` and `StateFact.evidence`. Duplicate `EvidenceId` values within a consequence, within an assessment, or across snapshot facts are rejected.
- **ConfidenceScore:** Bounded numerical score in `[0.0, 1.0]`. Confidence represents bounded uncertainty under explicit assumptions, not philosophical certainty. Future evaluators may emit calibrated confidence values; FC-002 only validates representation and numeric bounds.
- **ReversibilityDescriptor:** Operational recovery model (`reversible`, `partially_reversible`, `irreversible`, `unknown`). Semantic invariants prohibit recovery methods on `irreversible` consequences and recovery methods/timeWindows on `unknown` reversibility.
- **RiskDescriptor:** Structured qualitative impact assessment (`severity`, `categories`). Severity `"none"` requires an empty categories array; known non-none severities (`"low"`, `"medium"`, `"high"`, `"critical"`) require at least one category; severity `"unknown"` may have zero or more unique categories; duplicate categories are rejected.
- **Confidence Semantics (Evidence vs. Consequence):**
  - `EvidenceRecord.confidence`: Confidence in the specific evidence claim under that record's evidence mode, scope, and assumptions. Required for `predicted` mode; optional for `verified` and `simulated` modes.
  - `Consequence.confidence`: Aggregate confidence that the represented consequence is a correct/likely outcome given the available evidence, assumptions, and state/action context. FC-002 does not define an aggregation formula (e.g. it is not an average of evidence confidence). A value of 1.0 never represents philosophical certainty.
- **Entity Kind & domainKind Normalization:** Root categories use `KNOWN_ENTITY_KINDS`. When `kind === "other"`, a namespaced `domainKind` (matching `/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/`) is strictly REQUIRED. When `kind !== "other"`, `domainKind` MUST be absent.
- **Identity Fields & Presence Semantics:** Optional ID fields (`application.id`, `sessionId`, `actor.id`) permit omission. If supplied, they must be non-empty and non-whitespace strings; empty strings `""` or whitespace `"   "` are rejected.
- **TemporalDescriptor:** Orthogonal separation of `timing` (`immediate`, `near-term`, `long-term`, `unknown`) and `frequency` (`once`, `recurring`, `continuous`, `unknown`).
- **ActionEvaluationContext & ConsequenceAssessment:** Canonical envelopes binding evaluation inputs and outputs:
  - `ActionEvaluationContext` binds `state` and `action` into a single authoritative evaluation context.
  - `ConsequenceAssessment` binds `evaluationContextId`, `actionId`, evaluated `consequences`, and evaluation `provenance`.

## Runtime Validation & Serialization

- **Dependency-Free Structural Validation:** Validates primitive shapes, enum domains, ISO UTC timestamps, bounded confidence scores, dense arrays (rejecting holes/sparse arrays), and JSON safety. Never throws on untrusted input.
- **Validated Snapshot Architecture (FC-002B / FC-002D):** Every validator constructs a detached snapshot of the exact validated data, completely free of original dynamic getters, proxy traps, or subsequent caller mutations. Properties are read at most once using `readOwnProperty`, distinguishing `absent`, `present`, and `error` states. Arrays are captured exactly once using `captureDenseArray` to neutralize length-changing proxies. Validators return detached snapshots; runtime freezing occurs separately at the consequence-engine boundary via `deepFreezeCanonical`. TypeScript domain records remain readonly at compile time.
- **Fail-Closed Defensive Design:** All public validation and serialization boundaries use defensive property access and safe error normalization (`normalizeThrownError`) to protect against hostile getters, throwing prototypes, and invalid `toString` coercions. Error messages describe failed validation rules and never leak unvalidated hostile strings.
- **Semantic Cross-Object Validation:** Verifies ID uniqueness, fact-subject referential integrity (orphan facts referencing undeclared entities are rejected unconditionally, including zero-entity snapshots), evidence ID uniqueness (standalone in snapshots, within consequences, and across assessments), environment compatibility (`environmentId` exact match, platform match, application match, session match), state-change transition consistency, and chronological plausibility (`action.proposedAt >= state.observedAt`).
- **Authoritative Validation Entrypoint:** `validateActionEvaluationContext` performs both structural and semantic validation before evaluators process input. `validateConsequenceAssessment` authoritatively validates expected context before lineage comparison.
- **Consistent JSON Depth Policy:** `MAX_JSON_VALUE_DEPTH = 32` applies to JSON payload fields from their own roots. Domain serializers serialize the validated normalized representation without applying conflicting whole-envelope double depth budgeting.
- **Privacy Trust Boundary:** JSON-safe validation guarantees data serializability, NOT privacy safety. Platform adapters must sanitize and redact sensitive user parameters before constructing canonical domain objects.

## Current Implementation Status

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

All scenario tests are synthetic representations designed to prove schema genericity.

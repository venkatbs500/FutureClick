# @futureclick/action-schema

Canonical data contracts and domain types for FutureClick.

## Eventual Responsibilities

This package defines the universal data representation for pre-execution consequence evaluation across all platforms (macOS, Windows, browsers).

Core concepts include:
- **EnvironmentState:** Normalized snapshot of the operating system or application context prior to execution.
- **ProposedAction:** The user-intended operation (e.g., delete, share, grant permissions, move files).
- **ActionTarget:** The UI element, file, or resource targeted by the action.
- **ActionConsequence:** Tri-modal evaluation outcome:
  - **Verified:** Deterministically derived from available evidence within an explicitly defined scope and set of assumptions (not philosophical or unconditional certainty).
  - **Simulated:** Observed within an isolated or controlled sandbox under specific conditions (not an absolute guarantee of live behavior).
  - **Predicted:** Probabilistic projection from learned models exposing calibrated uncertainty.
- **EvidenceRecord:** Audit trail and factual grounding supporting the consequence evaluation.
- **ConfidenceScore:** Bounded numerical score in \([0.0, 1.0]\) representing calibrated uncertainty.
- **ReversibilityLevel:** Distinction between fully reversible, partially reversible, and irreversible side effects.
- **PredictionProvenance:** Traceability metadata (engine version, deterministic flags, model identifiers).

## Provisional Domain Contract Notice (FC-001 / FC-001A)

The types and schemas in this package represent foundational and provisional contracts:
- TypeScript structural typing enforces compile-time shape consistency but does not by itself guarantee runtime semantic validity.
- Comprehensive cross-field invariants, lifecycle states, and relational validations will be developed in subsequent domain-design sprints.
- External and untrusted inputs arriving from native adapters or browser bridges will require explicit validation and sanitization at system trust boundaries.

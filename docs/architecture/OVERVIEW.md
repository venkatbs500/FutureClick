# FutureClick Architecture Overview

FutureClick is a human-centered consequence prediction system for computer interactions. Before a user triggers an important digital action (such as deleting files, sharing resources, modifying access controls, or submitting critical transactions), FutureClick analyzes the environmental state and proposed action to predict, simulate, or formally verify likely consequences.

## System Architecture

The following diagram illustrates the intended end-to-end data flow:

```
Platform Adapters (macOS, Windows, Browser Extension)
        ↓
State Capture (DOM, Accessibility Tree, Filesystem Handles)
        ↓
Canonical Action Representation (@futureclick/action-schema)
        ↓
ActionGraph Relational Model (@futureclick/action-graph)
        ↓
Consequence Engine (@futureclick/consequence-engine)
       ├── Verified (Deterministic derivations under defined assumptions)
       ├── Simulated (Sandboxed dry-runs, isolated mutations)
       └── Predicted (Statistical models, learned inference)
        ↓
Risk / Reversibility / Confidence Scoring
        ↓
Human-Facing Preview Surface (Non-modal overlay card)
```

## Architectural Principles and Boundaries

### 1. Adapters Observe Platform-Specific State
Platform adapters (`apps/browser-extension`, `native/macos`, `native/windows`) interface directly with platform APIs (e.g., Chrome DevTools Protocol, macOS Accessibility API `AXUIElement`, Windows UI Automation `IUIAutomation`). Their sole responsibility is observing user intent, extracting relevant localized context, and normalizing it into standard schemas.

### 2. Platform Logic Must Not Own Central Intelligence
Platform-specific logic must remain thin observation layers. Under no circumstances should business rules, consequence modeling, or graph relational queries be embedded inside native OS hooks or browser content scripts. Central evaluation intelligence is strictly platform-agnostic.

### 3. Consequence Engine Stays Platform-Agnostic
The `@futureclick/consequence-engine` operates entirely against `@futureclick/action-schema` and `@futureclick/action-graph`. It does not know or care whether an action originated from a Cocoa button, a Win32 dialog, or a React web component. This decouples research improvements from native integration work.

### 4. Actions and Consequences Require Provenance
Every evaluation carries structured provenance metadata:
- Evaluation timestamp (`IsoTimestamp`).
- Engine version.
- Source model identifier or rule definition.
- Deterministic vs. probabilistic execution flags.

FutureClick is designed to preserve provenance and support auditable consequence decisions, reproducible debugging, and transparent telemetry for research validation.

### 5. Uncertainty Is First-Class
Prediction is inherently probabilistic in open computer environments. FutureClick rejects binary "safe/unsafe" heuristics without confidence weighting. Every consequence output includes:
- Calibrated `ConfidenceScore` in \([0.0, 1.0]\).
- Categorized `ReversibilityLevel` (`reversible`, `partially_reversible`, `irreversible`, `unknown`).
- Supporting `EvidenceRecord` chain.

### 6. Truth Classification Hierarchy
The system strictly enforces the epistemological boundary between evaluation modalities:
- **Verified consequences are deterministic derivations, not universal certainty:** A verified consequence is derived deterministically from available evidence within an explicitly defined scope and set of assumptions. It is NOT philosophical or unconditional certainty. Verification may still be incorrect if the observed state is incomplete, underlying data is stale, platform behavior drifts, assumptions are violated, or external systems behave differently.
- **Simulation results must never be falsely presented as deterministic truth:** Sandboxed dry-runs approximate real execution under controlled test conditions, but do not guarantee that the live environment will behave identically due to environmental drift, network states, or unmodeled external dependencies.
- **Predicted results must never be presented as verified facts:** Statistical and neural predictions carry uncertainty and potential hallucinations. UI surfaces must visually differentiate Verified deductions (scoped deterministic derivations), Simulated dry-runs (empirical sandbox behavior), and Predicted inferences (probabilistic/statistical).

### 7. Canonical Domain and Structural Representations (FC-002 / FC-003)
The canonical domain model (`@futureclick/action-schema`) and structural intermediate representation (`@futureclick/action-graph`) provide normalized, authoritative foundations for evaluation. Contexts and graphs are deeply validated and runtime-frozen at trust boundaries.

### 8. Deterministic Verified Rules Engine (Sprint FC-004)
Sprint FC-004 introduces FutureClick's first consequence-derivation mechanism: Deterministic Verified Rules (`@futureclick/consequence-engine`). Rules consume the authoritative `ActionEvaluationContext` and its structural `ActionGraph` to derive validated consequences under explicit scopes and assumptions. The engine enforces tri-state decision models (MATCHED, NOT_APPLICABLE, INSUFFICIENT_EVIDENCE), conservative conflict detection, and fail-closed abstention when evidence is incomplete. See `docs/architecture/DETERMINISTIC_RULE_ENGINE.md` for complete specification.

### 9. Browser Observation & Adapter Foundation (Sprint FC-005)
Sprint FC-005 establishes FutureClick's first browser observation boundary. The pure adapter layer (`@futureclick/browser-adapter`) validates and minimizes raw browser observations, strips URL queries/fragments, excludes sensitive controls, and maps explicit synthetic declarations into canonical evaluation contexts via trusted action adapters. The development extension (`apps/browser-extension`) captures passive DOM click events without cancellation (`preventDefault`), enabling end-to-end deduction of verified consequences on synthetic test fixtures. See `docs/architecture/BROWSER_ADAPTER.md` for complete specification.


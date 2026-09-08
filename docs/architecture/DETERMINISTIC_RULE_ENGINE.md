# Deterministic Verified Rule Engine

This document specifies the architecture, contracts, execution semantics, and epistemological boundaries of FutureClick's Deterministic Verified Rule Engine (`Sprint FC-004`).

## 1. Purpose and Overview

FutureClick's foundational thesis is: **"See what your click will do before you click it."**

- **FC-002** established canonical representations for State, Actions, Consequences, Evidence, Risk, Reversibility, and Confidence.
- **FC-003** established a trustworthy, structural `ActionGraph` representation over those records.
- **FC-004** introduces FutureClick's **first actual consequence-derivation mechanism**: **Deterministic Verified Rules**.

The deterministic rule engine evaluates proposed digital actions against observed state facts using statically declared, trusted rule definitions. When required canonical pre-state facts exist and action parameters satisfy rule preconditions, rules derive validated, canonical consequences under explicitly declared scopes and assumptions.

```
raw ActionEvaluationContext
        ↓
FC-002 Authoritative Input Validation
        ↓
Validated Canonical Context (Deeply Frozen Snapshot)
        ↓
FC-003 Context-Only ActionGraph (Structural Index)
        ↓
Deterministic Rule-Set Evaluation (Sequential, Trace Generation)
        ↓
Conflict Detection (Contradictory / Overlapping State Changes)
        ↓
Validated Canonical Consequence[]
        ↓
Existing ConsequenceEngine Orchestrator
        ↓
ConsequenceAssessment (Validated Lineage Binding)
```

---

## 2. Epistemological Boundary of "VERIFIED"

In FutureClick, **"VERIFIED" NEVER means:**
- Universal truth or philosophical certainty
- Guaranteed real-world execution
- Confirmation that an external platform or operating system accepted the action
- That a live action has already occurred or succeeded

**"VERIFIED" strictly means:**
> A deterministic conclusion was derived from available canonical evidence within an explicitly defined rule scope and set of assumptions.

For example, when evaluating a repository visibility change from `private` to `public`, the rule derives:
- Post-state: `repository.visibility = "public"`
- Risk: High security/privacy exposure
- Scope: "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared repository visibility change action executes successfully according to the modeled platform semantics without platform rejection."

The engine never claims that GitHub or GitLab servers were contacted or updated.

---

## 3. Rule Identity and Versioning

Rules are distinct from runtime instance records (such as UUIDs). Rule identity is defined by a pair of immutable, branded identifiers:

1. **`RuleId`**:
   - Branded string (`Brand<string, "RuleId">`).
   - Format: Namespaced identifier with dot-separated lowercase ASCII segments (`/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/`).
   - Examples:
     - `filesystem.delete.file`
     - `version_control.repository.visibility`
     - `collaboration.document.share`
     - `billing.subscription.activate`
   - Rejects: empty strings, uppercase letters, whitespace, single segments without dots, and arbitrary display prose.

2. **`RuleVersion`**:
   - Branded string (`Brand<string, "RuleVersion">`).
   - Format: Explicit dot-separated numeric version (`/^[0-9]+(\.[0-9]+)+$/`), such as `"1.0"` or `"1.0.0"`.
   - Independent of `package.json`.

3. **Active Registry Identity Policy**:
   - Rule identity is composite: `RuleId + RuleVersion`.
   - The active registry enforces **one active version per `RuleId`** to prevent ambiguous duplicate rule executions.
   - Registering duplicate `RuleId` values throws an immediate `[DUPLICATE_RULE]` error.

---

## 4. Rule Contract and Execution Purity

A deterministic rule is defined by the strongly typed `DeterministicRule` interface:

```typescript
export interface DeterministicRule {
  readonly id: RuleId;
  readonly version: RuleVersion;
  readonly description: string;
  evaluate(input: DeterministicRuleInput): RuleDecision | Promise<RuleDecision>;
}

export interface DeterministicRuleInput {
  readonly context: ActionEvaluationContext;
  readonly graph: ActionGraph;
}
```

### Execution Invariants
- **Purity:** Pure, side-effect free functions. Same canonical inputs always produce identical decisions.
- **Synchronous Logic:** Built-in rules execute synchronously; asynchronous evaluations are normalized without side effects.
- **Zero I/O:** Rules must never perform network requests, file access, live OS queries, browser API calls, or external service communication.
- **No Direct Clock Reads:** Rules must not inspect system wall-clock time (`Date.now()`); all temporal reasoning is bound to canonical timestamps provided in the context or injected options.

---

## 5. Rule Decision Model

Rules explicitly differentiate between three distinct outcomes rather than collapsing non-matches into empty consequence arrays:

```typescript
export type RuleDecision =
  | {
      readonly status: "matched";
      readonly drafts: readonly ConsequenceDraft[];
    }
  | {
      readonly status: "not-applicable";
      readonly reasonCode: string;
    }
  | {
      readonly status: "insufficient-evidence";
      readonly reasonCode: string;
      readonly missing?: readonly string[];
    };
```

### Distinction: NOT_APPLICABLE vs. INSUFFICIENT_EVIDENCE
- **`NOT_APPLICABLE`:** The action intent, verb, domain, or target kind does not match the rule's purview (e.g. evaluating a file delete action against the repository visibility rule).
- **`INSUFFICIENT_EVIDENCE`:** The action intent matches the rule's scope, but required preconditions or current state facts are absent (e.g. attempting to publish a repository when its current visibility is unknown, or deleting a file without permanence parameters).

**Abstention Principle:** Missing evidence never turns into a guessed consequence or probabilistic prediction.

---

## 6. Rule Trace and Explainability

Every rule evaluation produces an immutable evaluation trace recording the disposition of every registered rule in deterministic registration order:

```typescript
export interface RuleTraceEntry {
  readonly ruleId: RuleId;
  readonly ruleVersion: RuleVersion;
  readonly status: "matched" | "not-applicable" | "insufficient-evidence";
  readonly reasonCode: string;
  readonly missing?: readonly string[];
}
```

### Privacy and Sensitivity Boundary
- Traces contain only machine-readable codes matching strict grammar (Finding M4):
  - `reasonCode`: strictly conforms to `^[A-Z][A-Z0-9_]*$` with a maximum length of 64 characters (e.g., `MISSING_VISIBILITY_FACT`, `UNMATCHED_VERB`).
  - `missing`: token array elements strictly conform to `^[a-z][a-z0-9_.-]*$` with a maximum length of 64 characters (e.g., `action.parameters.move_to_trash`, `fact.filesystem.exists`).
- Traces never copy raw state payload values, filenames, document titles, or personal identifiers. Arbitrary prose and unstructured descriptions are rejected at runtime validation.
- Traces are intended solely for local explainability, debugging, and future research; they are not telemetry and are never persisted or transmitted.

---

## 7. Consequence Drafts and Runtime Identity Generation

To ensure pure semantic determinism, rules return **consequence drafts** (`ConsequenceDraft`) rather than constructing runtime entity IDs directly.

The top-level evaluator (`evaluateDeterministicRules`):
1. **Requires Explicit Draft Confidence (Option B, Finding H6):** Every consequence draft returned by a matched rule must explicitly specify `confidence: ConfidenceScore | number`. The evaluator contains NO fallback or default (`draft.confidence ?? 1.0` has been eliminated). Matched drafts with omitted or invalid confidence fail closed with `INVALID_RULE_OUTPUT`.
2. Allocates candidate `ConsequenceId` and `EvidenceId` using an injected or default ID generator.
3. Constructs canonical `Consequence` objects binding the authoritative `actionId` and validated `StateChange` records.
4. Validates each constructed consequence using `validateConsequence` before returning.
5. **Normalized ID Uniqueness (Finding M3):** Checks uniqueness on *normalized* `ConsequenceId` and `EvidenceId` values after canonical validation succeeds, maintaining separate namespaces and failing closed with `[ID_COLLISION]` if candidate IDs collide.

---

## 8. Consequence and Evidence Confidence Contract (Option B)

### Background: Frozen FC-002 Requirement
The frozen canonical domain model (`@futureclick/action-schema` in Sprint FC-002) defines `Consequence.confidence` as a REQUIRED canonical property of type `ConfidenceScore` (\([0.0, 1.0]\)). Consequence validation fails closed if `confidence` is missing or outside this range.

### FC-004A Architectural Decision: Option B
1. **Frozen FC-002 is NOT modified.** `Consequence.confidence` remains strictly required on all canonical consequences.
2. **`ConsequenceDraft.confidence` is required.** Every rule author must explicitly provide a `ConfidenceScore` on every consequence draft.
3. **No Evaluator Fallback or Default:** The evaluator will never automatically inject `1.0` or any other default on behalf of a rule. If a matched rule returns a draft lacking explicit `confidence`, evaluation halts immediately with `INVALID_RULE_OUTPUT`.
4. **Custom Rule Authority:** Custom rules explicitly own their confidence claim. Explicit valid custom confidence values (e.g., `0.8`) are preserved exactly through canonical validation.
5. **Built-in Deterministic Rules:** For the four narrowly scoped FC-004 built-in verified rules, the rule author explicitly sets `confidence = createConfidenceScore(1.0)` **ONLY AFTER** all hardened deterministic preconditions (ambiguity resolution, cardinality checks, parameter validation) pass. If any precondition is missing or ambiguous, the rule abstains without generating a consequence.

### Epistemological Meaning of Deterministic Consequence Confidence 1.0
In FutureClick's epistemological framework:
- `Consequence.confidence = 1.0` means:
  > "Given these explicit premises and assumptions, this deterministic rule derives this modeled consequence without residual uncertainty inside the rule model."
- **It does NOT mean:**
  - The external action will definitely execute successfully in the real world
  - The operating system, platform, or remote API will accept the action without error
  - The physical or world outcome is guaranteed
  - Live execution or post-execution verification occurred
  - The empirical probability of action success is 100%
  - Philosophical certainty exists
- **VERIFIED remains:** deterministically derived under explicit scope and stated assumptions; NOT execution observed or platform certified.
- **No Probability Calibration:** FutureClick makes no claim that calibration exists for deterministic rule confidence; it reflects deductive completeness within the model.

### EvidenceRecord Confidence Distinction
- Numeric confidence is **omitted** on verified `EvidenceRecord`s. Under FC-002, `EvidenceRecord.confidence` remains optional.
- Built-in deterministic evidence records continue to omit evidence-level confidence.
- `Consequence.confidence` and `EvidenceRecord.confidence` remain separate concepts.

---

## 9. ActionGraph Integration & Metadata Determinism

FC-004 consumes FC-003's `ActionGraph` strictly as a **structural lookup index**:
- **Deterministic Timestamp Resolution (Finding M5, L4):** When constructing the graph for evaluation, graph metadata timestamp `generatedAt` resolves to `options.generatedAt` if provided, or defaults to the canonical evaluation context timestamp `context.createdAt`. Explicitly passing `generatedAt: undefined` is rejected as invalid (L4). The evaluator never samples system wall-clock time (`Date.now()`).
- **Isolated Local Deterministic ID Generator (Finding M5):** `buildActionGraph` uses an isolated, local deterministic ID generator (`createDeterministicIdGenerator("graph-det")`). It does not consume or alter the caller-provided consequence ID generator.
- **Context-Only Graph:** Evaluator builds a context-only graph from the authoritative `ActionEvaluationContext` using `buildActionGraph({ context })`. No separate or mismatched graph can be passed to rules.
- **Structural Traversal Only:** Rules inspect one-hop relationships (`findNodeBySubject`, `getOutgoingEdges`, `targetRole`).
- **Strictly No Graph Reasoning:** No shortest-path calculation, recursive propagation, causal inference, or graph neural network processing is implemented.

---

## 10. Output Conflict Policy & Deferred Finding

Deterministic rules represent verified claims under stated assumptions. When multiple rules match:
1. **Contradictory Transitions:** If two rules produce different `after` values for the same `(entityId, property)`, evaluation fails immediately with `[RULE_OUTPUT_CONFLICT]`. Precedence ordering or arbitrary selection is strictly forbidden.
2. **Duplicate Transitions:** If two distinct rules produce identical post-state transitions for the same `(entityId, property)`, evaluation fails with `[OVERLAPPING_RULE_TRANSITION]`. Overlapping ownership must be made explicit and non-overlapping.
3. **Deferred Low Finding (JSON Object Key Order in Conflicts):** When comparing `StateChange` records whose property values are `JsonObject` records, differing key insertion order may cause structurally equivalent objects to be classified as `[RULE_OUTPUT_CONFLICT]` rather than `[OVERLAPPING_RULE_TRANSITION]`. Both failure modes fail closed and safely halt evaluation; canonical normalization of JSON object key ordering in conflict detection is deferred to a future pass.

---

## 11. Built-in Rules (FC-004 / FC-004A Hardened Baseline)

| Rule ID | Domain / Verb | Preconditions | Derived Consequence & Risk |
|---|---|---|---|
| `filesystem.delete.file` | `filesystem` / `delete` | File exists (`filesystem.exists: true`), exactly 1 primary target, explicit `moveToTrash` and `permanent` boolean parameters. Only `(true, false)` and `(false, true)` allowed. | Moving to trash derives reversible `filesystem.exists: false` with low data-loss risk; permanent deletion derives irreversible transition with medium data-loss risk. Explicit confidence `1.0`. |
| `version_control.repository.visibility` | `version_control` / `change-access` | Repository entity, exactly 1 primary target, current fact `repository.visibility: "private"`, requested parameter `newVisibility: "public"`. | Derives partially reversible `repository.visibility` replace transition with high security/privacy exposure risk. Explicit confidence `1.0`. |
| `collaboration.document.share` | `collaboration` / `share` | Exactly 1 primary document entity, exactly 1 recipient role entity, valid dense `document.shared_with` array. | If recipient is already present, abstains with `NOT_APPLICABLE` (`ALREADY_SHARED`). If not present, derives reversible document access grant, adding recipient to `document.shared_with` with low privacy risk. Explicit confidence `1.0`. |
| `billing.subscription.activate` | `billing` / `subscribe` | Subscription entity, exactly 1 primary target, current fact `subscription.status: "inactive"`, parameter `autoRenew === true`, and supported `billingInterval` (`"monthly"` or `"annual"`). | If `autoRenew === false`, abstains with `NOT_APPLICABLE` (`NON_RECURRING_SUBSCRIPTION`). If interval missing or unsupported, abstains with `INSUFFICIENT_EVIDENCE`. Derives reversible transition to `active` with recurring temporal frequency and financial risk. Explicit confidence `1.0`. Never invents currency price when absent. |

---

## 12. Ambiguity and Cardinality Helpers

FC-004A introduces strict helper functions enforcing fail-closed abstention:

1. **Fact Resolution (`resolveUniqueFact`, Finding H1):**
   - Resolves a specific state fact key for a subject entity.
   - Evaluates to `missing` (0 facts found), `found` (exactly 1 fact found), or `ambiguous` (2 or more facts found matching the key).
   - **Policy:** AMBIGUOUS INPUT → `INSUFFICIENT_EVIDENCE`. If multiple facts exist for the same subject and key, the rule must abstain, even if the facts have identical values. Fact resolution is order-independent.

2. **Target Cardinality (`resolveUniqueTargetByRole`, Finding H2):**
   - Resolves an action target by its role (`primary`, `recipient`, etc.).
   - Evaluates to `missing` (0 targets found with that role), `found` (exactly 1 target found), or `ambiguous` (2 or more targets found with that role).
   - **Policy:** UNSUPPORTED CARDINALITY → `INSUFFICIENT_EVIDENCE`. Rules must never silently pick the first target from an array. All built-ins require exactly one primary target; document share requires exactly one primary and one recipient target.

3. **Delete Parameter Reader (`readExplicitBooleanParameter`, Finding H4):**
   - Strictly reads boolean parameters as primitive booleans (`typeof === "boolean"`).
   - Rejects non-boolean primitives, stringified booleans, numbers, null, undefined, or missing values as `INSUFFICIENT_EVIDENCE`.

4. **Document Sharing Validator & Canonical Identity (`validateSharedWithArray`, Finding H5 / FC-004B):**
   - Validates that `document.shared_with` is a dense JSON array of unique, canonically valid `EntityId` values.
   - Authoritative canonical `validateId<EntityId>` is executed on each entry, obtaining its normalized `EntityId`.
   - **Canonical Normalization & Duplicate Detection:** Duplicate detection occurs *after* normalization, so aliases like `["x", " x "]` are rejected fail-closed as `MALFORMED_SHARED_WITH`.
   - **Canonical Membership Check:** The recipient target `EntityId` (normalized by context validation) is compared against the normalized list of recipients. An action target `" recipient "` matching an existing state entry `[" recipient "]` evaluates to `NOT_APPLICABLE` (`ALREADY_SHARED`), preventing false `VERIFIED` consequence generation.
   - **Normalized Derived State:** Derived `StateChange` records write normalized canonical `EntityId`s into `document.shared_with` transitions without alias leakage.
   - Rejects sparse arrays, non-array types, non-string elements, empty strings, overlength strings (> 128 chars), and duplicate entries as `INSUFFICIENT_EVIDENCE`.
   - An empty array `[]` is canonically valid (representing no currently shared recipients).

---

## 13. Rule Immutability & Registry Snapshot Integrity (Finding M2 / FC-004B)

1. **Rule Snapshot Immutability (Finding M1):**
   - `createRuleSet` clones and freezes each rule definition using `Object.freeze`. The rules array and rule registry are also frozen.
   - Public built-in rule definitions exported by `@futureclick/consequence-engine` are frozen.
2. **Registry Bypass Elimination & Coherent Snapshotting (Finding M2 / FC-004B):**
   - `evaluateDeterministicRules` always normalizes caller-supplied rules through `createRuleSet`.
   - **Single Read of `.rules` Property:** At the public evaluation boundary, if a registry-shaped object is provided, its own `.rules` property is captured exactly once using safe property access (`readOwnProperty`). Hostile getters cannot return different arrays across checks.
   - **Dense Array Snapshotting (`captureDenseArrayOnce`):** Any caller-supplied rules array is snapshotted by capturing length once, reading each index once, rejecting sparse arrays, and detaching into a frozen ordinary array before definition validation. Live Proxy length manipulations cannot skip rules.
   - `getRule` on untrusted registries is never called or trusted.
3. **Adapter Option Presence Semantics (Finding Section 27):**
   - `createDeterministicRuleEvaluator` strictly preserves option presence: absent options take normal defaults, while explicitly passing `generatedAt: undefined` or `rules: undefined` fails closed with a configuration error.
4. **Strict Identifier Grammar (Finding L1):**
   - `RuleId` and `RuleVersion` reject leading and trailing whitespace as invalid rather than silently trimming.
5. **Strict Decision Variant Validation (Finding L3):**
   - Decision variants (`matched`, `not-applicable`, `insufficient-evidence`) strictly reject unexpected extra properties.

---

## 14. Rule Coverage vs. Product Coverage

**Critical Boundary:**
The four built-in rules cover **only narrowly defined, canonical demonstration cases**. They do NOT mean FutureClick understands:
- All filesystem deletions across diverse operating systems
- All GitHub / GitLab / Bitbucket API operations
- All cloud document sharing platforms (Google Docs, Notion, SharePoint)
- All subscription, billing, or payment gateway workflows
- Arbitrary computer interactions

Rule coverage represents a minimal, verifiable foundation for deterministic consequence evaluation.

---

## 15. ConsequenceEngine Integration

The deterministic rule engine integrates with `ConsequenceEngine` via `createDeterministicRuleEvaluator`:
- Implements `IConsequenceEvaluator` with `mode: "verified"`.
- When no rules match, returns `ok({ consequences: [] })`.
- When rules abstain with insufficient evidence, returns `ok({ consequences: [] })`.
- `ConsequenceEngine` retains exclusive ownership over constructing `ConsequenceAssessment`, validating assessment invariants, and binding evaluation context lineage.

---

## 16. Security and Privacy Model

1. **Static Trusted Code:** Built-in rules are statically bundled, trusted application code. User-submitted executable JavaScript, dynamic `eval()`, `new Function()`, or remote rule loading is strictly forbidden.
2. **Data Sensitivity Boundary:**
   - **Evaluation Traces:** Traces contain only machine-readable codes (`reasonCode`) and tokens (`missing`). They never copy raw state payload values, filenames, document titles, or personal identifiers.
   - **Diagnostic Errors:** Error messages provide structured technical diagnostics for local evaluation failures. Traces and evaluation results are never telemetry and are never persisted or transmitted.
3. **No External Transmission:** All evaluations occur entirely locally and synchronously in-memory. No network, telemetry, or remote API interactions exist.

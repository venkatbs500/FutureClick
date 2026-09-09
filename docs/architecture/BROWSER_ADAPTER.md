# Browser Observation & Adapter Foundation (Sprint FC-005)

## 1. Architectural Overview

Sprint FC-005 introduces FutureClick's first real browser observation boundary. It establishes a strictly privacy-minimized pipeline from a local browser DOM interaction to an authoritative canonical evaluation context, which is then evaluated by the existing deterministic rules engine (`@futureclick/consequence-engine`) to derive a conditional `VERIFIED` consequence.

```
REAL LOCAL DOM EVENT (Click on <button type="button">)
        ↓
Passive, Capture-Phase Event Listener (No preventDefault)
        ↓
Synchronous Snapshot of Allowlisted Metadata
        ↓
Strict Runtime Validation (validateBrowserObservation)
        ↓
Detached, Frozen BrowserObservation (schemaVersion "1.0")
        ↓
Browser Action Adapter Assessment (assess)
        ↓
Semantic BrowserContextDraft
        ↓
Central Canonical Context Construction (BrowserAdapterEngine)
        ↓
Authoritative FC-002 Validation (validateActionEvaluationContext)
        ↓
Detached, Frozen ActionEvaluationContext
        ↓
Existing FC-004 ConsequenceEngine + Deterministic Rule Evaluator
        ↓
Conditional VERIFIED Consequence Assessment
```

---

## 2. Epistemological & Engineering Boundaries

### Observation Only
FC-005 is strictly **observation only**. It does **NOT**:
- Call `preventDefault()`, `stopPropagation()`, or `stopImmediatePropagation()`.
- Pause page navigation or delay event delivery.
- Replay actions or simulate synthetic clicks.
- Intercept, cancel, or modify underlying page execution.
- Mutate repository state or issue network calls.

The underlying web page receives and processes the native click event normally. Pre-click interception, consequence preview overlays, and Continue/Cancel workflows are explicitly deferred to **Sprint FC-006**.

### Synthetic Demonstration Honesty
The initial vertical slice models a **Synthetic Repository Visibility Transition** (`private` &rarr; `public`).
- The page metadata (`data-futureclick-*`) represents an explicit synthetic declaration in a test fixture.
- It is **NOT** proof or a heuristic that arbitrary, unannotated HTML reveals repository semantics.
- Button text alone (e.g., "Make public") without explicit semantic metadata is never trusted and yields no canonical action.
- The `VERIFIED` consequence derived by the rules engine is a conditional deduction based on represented canonical state and action parameters; it is not empirical confirmation that a remote repository changed.

---

## 3. BrowserObservation Data Model

`BrowserObservation` is a versioned, privacy-minimized record representing a single user activation:

```typescript
export interface BrowserObservation {
  readonly schemaVersion: "1.0";
  readonly id: BrowserObservationId; // Branded string, max 128 chars
  readonly capturedAt: IsoTimestamp;   // Canonical UTC ISO-8601 string
  readonly page: {
    readonly origin: string;           // Max 256 chars, e.g. "http://127.0.0.1:4173"
    readonly routeId: string;          // Static token, max 64 chars
  };
  readonly interaction: {
    readonly kind: string;             // Max 32 chars, e.g. "activate"
  };
  readonly element: {
    readonly kind: string;             // Max 32 chars, e.g. "button"
    readonly role: string;             // Max 32 chars, e.g. "button"
    readonly buttonType: string;       // Max 32 chars, e.g. "button"
  };
  readonly metadata: {
    readonly fixtureContract: string;  // Max 64 chars, e.g. "fc005.repository-visibility.v1"
    readonly operation: string;        // Max 64 chars, e.g. "repository.visibility.change"
    readonly entityKey: string;        // Max 64 chars, e.g. "fixture-repository"
    readonly currentVisibility?: string | undefined;   // Optional, max 128 chars
    readonly requestedVisibility?: string | undefined; // Optional, max 128 chars
  };
}
```

### Observation Schema Version
`BrowserObservation` defines its own version (`"1.0"`). It is not coupled to canonical schema versions. Unknown schema versions are rejected fail-closed.

### Strict Validation & Bounds
All observations crossing the boundary undergo closed-shape structural validation:
1. **Safe Own-Property Reads:** Properties are read using safe accessors that catch throwing getters and prototype tampering.
2. **String Length Bounds:** Strict maximum lengths prevent memory exhaustion (`origin <= 256`, `tokens <= 64`, `roles/kinds <= 32`, `scalars <= 128`, `observationId <= 128`).
3. **Control Character Rejection:** Any ASCII control characters (`\x00-\x1F`, `\x7F`) result in immediate rejection.
4. **Machine Token Policy:** Fields such as `routeId`, `fixtureContract`, `operation`, and `adapterId` must conform to narrow machine token grammars (`^[a-z][a-z0-9_.-]*$`). Free-form human prose is disallowed.
5. **Closed Object Shapes:** Unexpected or unknown properties on the observation or its sub-objects are rejected.
6. **Property Presence Semantics:** Explicit `undefined` on optional properties is rejected.
7. **Serialized Size Limit:** The detached safe object must not exceed 4096 bytes (4 KiB) UTF-8.
8. **Immutability & Detachment:** The returned observation contains no DOM object references and is deeply frozen.

---

## 4. Privacy Boundaries & Data Minimization

The browser observation boundary strictly enforces FutureClick's core privacy principles:

1. **URL Sanitization:**
   - Content scripts inspect `location.protocol`, `hostname`, `port`, and `pathname` strictly for authorization.
   - The resulting `BrowserObservation` retains **only** the normalized `origin` and a static machine `routeId`.
   - Raw pathname, query strings, search parameters, fragments, credentials, referrer, and full URLs are **never** captured, retained, or logged.
2. **Exact Local Fixture Authorization:**
   - Fixture capture is authorized **only** when all of the following match exactly:
     - `protocol`: `http:`
     - `hostname`: `127.0.0.1`
     - `port`: `4173`
     - `pathname`: `/fc005/repository-visibility.html`
   - Any mismatch (wrong host, port, path, or protocol) results in zero observation.
3. **DOM Minimization & Target Resolution:**
   - No full DOM, HTML, `outerHTML`, `innerHTML`, `textContent`, surrounding text, page title, or accessibility trees are read.
   - Only native `<button type="button">` controls are supported.
   - **Bounded Ancestor Traversal (FC-005A Hardening):** Unbounded `closest("button")` is removed. Event target resolution traverses upward at most 4 ancestor hops (`MAX_ACTIVATION_ANCESTOR_HOPS = 4`) strictly within the ordinary light DOM of the active document. Deeply nested targets (>4 hops), cross-document targets, and shadow DOM crossings are rejected fail-closed.
4. **Allowlisted Metadata Only:**
   - Reads exact allowlisted attributes individually:
     - `data-futureclick-fixture-contract`
     - `data-futureclick-operation`
     - `data-futureclick-entity-key`
     - `data-futureclick-current-visibility`
     - `data-futureclick-requested-visibility`
   - Spreading `element.dataset` or enumerating arbitrary `data-*` attributes is forbidden.
   - **Machine Token Entity Reference (FC-005A Hardening):** `data-futureclick-entity-key` is strictly an internal machine token (`^[a-z][a-z0-9_.-]*$`, max 64 chars) and is never treated as human display prose. Secret-looking, email-like, or arbitrary prose is rejected fail-closed.
5. **Sensitive & Form Control Exclusion:**
   - Reject editable and sensitive surfaces: `<input>`, `<textarea>`, `<select>`, `contenteditable`, file inputs, password fields, OTP inputs, credit card inputs.
   - **Contenteditable Exclusion (FC-005A Hardening):** Any target, traversed ancestor, or resolved button that is `contenteditable` (checked via `isContentEditable` and `getAttribute("contenteditable")`) is strictly excluded from observation.
   - Zero form values (`input.value`, `FormData`) are ever read.
   - Elements with password-like or secret-like identifiers are rejected via defense-in-depth inspection using `isPasswordFieldIdentifier` from `@futureclick/privacy`.
6. **No Storage, File, or Media Capture:**
   - No `localStorage`, `sessionStorage`, `IndexedDB`, `chrome.storage`, or file persistence.
   - No clipboard access, screenshot APIs, or screen capture.
   - No network transmission, telemetry, or remote processing.

---

## 5. Browser Action Adapter Model

### Adapter Contract
Adapters implement the pure synchronous `BrowserActionAdapter` interface:

```typescript
export interface BrowserActionAdapter {
  readonly id: AdapterId;
  readonly version: AdapterVersion;
  readonly description: string;
  assess(observation: BrowserObservation): AdapterDecision;
}
```

### Discriminated Decisions
Adapters return a strict discriminated decision:
- `matched`: `{ status: "matched", draft: BrowserContextDraft }`
- `not-applicable`: `{ status: "not-applicable", reasonCode: string }`
- `insufficient-evidence`: `{ status: "insufficient-evidence", reasonCode: string, missing: readonly string[] }`
- `error`: `{ status: "error", code: string }`

*Note (FC-005A Hardening):* Arbitrary `message` strings on error decisions are removed. Reason codes and error codes are constrained to closed machine token grammars.

### Semantic Context Draft
The adapter returns a closed `BrowserContextDraft` describing semantic intent without canonical IDs, timestamps, environment descriptors, or ActionGraph references:

```typescript
export interface BrowserContextDraft {
  readonly kind: "synthetic.repository-visibility";
  readonly entityKey: string;
  readonly entityKind: "repository";
  readonly currentVisibility: "private";
  readonly requestedVisibility: "public";
  readonly intent: {
    readonly verb: "change-access";
    readonly domain: "version_control";
  };
  readonly targetRole: "primary";
}
```

*Note (FC-005A Hardening):* Every adapter decision and draft undergoes authoritative runtime validation (`validateAdapterDecision` and `validateBrowserContextDraft`) before engine interpretation. The draft schema is closed to the synthetic repository visibility operation; arbitrary entities, actions, or visibility values are rejected fail-closed with `INVALID_ADAPTER_OUTPUT`.

### Synthetic Repository Visibility Adapter
The built-in adapter (`browser.synthetic.repository-visibility` v`1.0`) enforces exact scope applicability:
- `page.origin === "http://127.0.0.1:4173"`
- `page.routeId === "synthetic.repository-visibility"`
- `interaction.kind === "activate"`
- `element.kind === "button"`, `element.role === "button"`, `element.buttonType === "button"`
- `fixtureContract === "fc005.repository-visibility.v1"`
- `operation === "repository.visibility.change"`
- `currentVisibility === "private"`
- `requestedVisibility === "public"`
- Any mismatch in origin, route, interaction, element, contract, or operation produces `not-applicable`. Observations from unauthorized origins (e.g. `https://untrusted.example`) never produce a canonical context.
- Missing current or requested visibility returns `insufficient-evidence` with missing field details.
- Unsupported visibility transitions (e.g. `internal` &rarr; `public`) return `not-applicable`.

---

## 6. Adapter Registry & Ambiguity Handling

### Immutable Static Registry & Engine Ingress
`createBrowserAdapterRegistry` creates an immutable registry from an array of adapters:
- Uses `captureDenseArrayOnce` to capture adapter definitions and length once, rejecting sparse arrays and hostile getters.
- Validates each adapter definition and creates a detached, frozen copy.
- Enforces unique `AdapterId` across all registered adapters; duplicate IDs fail closed.
- **Engine Registry Ingress (FC-005A Hardening):** `BrowserAdapterEngine` never trusts external caller-supplied registry instances directly. At construction, it snapshots, validates, detaches, and deeply freezes adapter definitions, isolating the engine's internal registry from post-construction mutations or forged objects.

### Multiple Adapter Applicability Policy
All registered adapters are evaluated against the **same frozen observation**. The central engine evaluates decisions according to a strict policy where registration order does not influence semantics:
1. **Any ERROR:** Adaptation immediately fails with an error.
2. **Ambiguity (>1 Claim):** If more than one adapter claims applicability (`MATCHED + MATCHED`, `MATCHED + INSUFFICIENT`, or `INSUFFICIENT + INSUFFICIENT`), the engine returns `AMBIGUOUS_ADAPTER` fail-closed.
3. **Single MATCHED:** If exactly one adapter returns `MATCHED` and all others return `NOT_APPLICABLE`, canonical context construction proceeds.
4. **Single INSUFFICIENT_EVIDENCE:** If exactly one adapter returns `INSUFFICIENT_EVIDENCE` and all others return `NOT_APPLICABLE`, the engine abstains with detailed missing evidence.
5. **All NOT_APPLICABLE:** The observation is classified as `unsupported`.

---

## 7. Central Canonical Context Construction

The central `BrowserAdapterEngine` owns the conversion from `BrowserContextDraft` to `ActionEvaluationContext`:

1. **Canonical ID Allocation:** Assigns `EvaluationContextId`, `ActionId`, `StateSnapshotId`, `EntityId`, and `ObservationId` via an injected deterministic or cryptographic ID generator. Local DOM references (`entityKey`) are never used as canonical IDs. Detects normalized ID collisions fail-closed.
2. **Single Timestamp Ownership:** Consistently propagates `observation.capturedAt` to state snapshot, state facts, action proposed time, context creation time, and provenance.
3. **Canonical Environment:** Instantiates an `EnvironmentDescriptor` with `kind: "browser"`, `platform: "web"`, and application `"FutureClick Synthetic Harness"`. The state snapshot and proposed action reference the exact same environment.
4. **Canonical Entity & State:**
   - Exactly one repository entity (`kind: "repository"`).
   - **Predefined Trusted Label (FC-005A Hardening):** The repository entity's `label` is hardcoded to the trusted adapter-owned string `"Synthetic Repository"`. Page-controlled `entityKey` is never copied into canonical entity display labels.
   - Exactly one state fact (`key: "repository.visibility"`, `value: "private"`).
5. **Proposed Action:**
   - `domain: "version_control"`, `verb: "change-access"`.
   - Primary target references the repository entity.
   - `parameters: { newVisibility: "public" }`.
   - `executionStatus: "proposed"`.
6. **Provenance Attachment:**
   - Attached to both `StateSnapshot` and `ProposedAction`.
   - `source: "adapter"`.
   - Details: `adapterId`, `adapterVersion`, `browserObservationId`, `observationSchemaVersion`, `synthetic: true`, `evidenceBasis: "synthetic-page-metadata"`.
7. **Authoritative Canonical Validation:**
   - Context is validated against `validateActionEvaluationContext` from `@futureclick/action-schema`.
   - Returns the detached, deeply frozen valid context.

---

## 8. Extension Architecture & Packaging

### Manifest V3 Development Manifest (`manifest.dev.json`)
- `manifest_version`: 3
- `permissions`: `[]` (zero elevated privileges)
- `host_permissions`: absent (zero host permissions requested)
- `content_scripts`:
  - `matches`: `["http://127.0.0.1/fc005/repository-visibility.html"]` (strictly narrowed to fixture route)
  - `js`: `["content.bundle.js"]`
  - `run_at`: `"document_idle"`
  - `all_frames`: `false`
  - `world`: `"ISOLATED"`
- No background service worker, no storage, no external connectability.

### Bootstrap Location Authorization (FC-005A Hardening)
Even with narrowed manifest match patterns, `bootstrapExtension` explicitly verifies `isLocationAuthorized(window.location)` at startup before injecting any UI elements, instantiating the controller, or attaching event listeners. On unauthorized routes, execution terminates immediately.

### Bundling
- Bundled via `esbuild` as an IIFE script (`dist/content.bundle.js`).
- Completely self-contained with no unresolved workspace imports or remote dependencies.
- Build output is gitignored.

### Development Indicator & Lifecycle Invalidation (FC-005A Hardening)
- Inactive by default.
- Injects a clearly labeled UI control ("FutureClick Dev", "Observing: INACTIVE / ACTIVE", "Start Observing", "Stop Observing").
- **Session Epoch & Monotonic Sequencing:** To prevent race conditions and stale async results from overwriting newer user interactions (Finding M3):
  - Starting or stopping observation increments `sessionEpoch` and resets request sequence.
  - Each activation increments `currentRequestSequence`.
  - When async consequence evaluation completes, the result is displayed if and only if the session epoch matches, observation remains active, and the sequence number is current.
  - Stale results from superseded requests or previous observation sessions are discarded silently.
- **Trusted Display Strings:** Indicator display never renders page-controlled strings, entity keys, raw adapter errors, or missing tokens. Status badges and summaries use static, predefined strings.
- Stop immediately invalidates state, clears displayed results, and detaches event listeners.

---

## 9. Testing & Quality Strategy

1. **Pure Package Unit Tests (`packages/browser-adapter/tests/`):**
   - Structural validation of `BrowserObservation`, closed shapes, string bounds, and serialized size limits.
   - Hostile input handling (throwing getters, sparse arrays, duplicate IDs, prototype tampering).
   - Registry snapshotting, immutability, and ambiguity detection (order-independence).
   - Canonical context construction, timestamp propagation, and determinism.
   - **Hardening Tests (`hardening.test.ts`):** Runtime decision validation (H1), closed draft schema (H1), entity key machine token validation (H2), adapter scope enforcement (H3), hostile proxy protection (M1), and engine registry isolation (M2).
2. **Extension Capture Tests (`apps/browser-extension/tests/capture.test.ts`):**
   - DOM-independent capture policy and location authorization tests.
   - Sensitive control exclusion checks without DOM mocking.
3. **End-to-End Integration Tests (`apps/browser-extension/tests/consequence-integration.test.ts`):**
   - End-to-end integration from synthetic observation through `BrowserAdapterEngine` to `ConsequenceEngine`.
   - Asserts verified consequence details (`private` &rarr; `public`, confidence 1.0, high risk).
   - Verifies abstention on missing metadata, unsupported transitions, and unrelated operations.
4. **Lifecycle & Security Hardening Tests (`apps/browser-extension/tests/lifecycle-hardening.test.ts`):**
   - Session epoch and monotonic request sequencing regressions (M3).
   - Bounded ancestor traversal (max 4 hops) and strict contenteditable exclusion (M4).
   - Least privilege manifest and pre-bootstrap location authorization (M6).
5. **Native Browser Fixture Harness (`apps/browser-extension/tests/fixtures/fc005/browser-tests.html`):**
   - Exercises real DOM click events, passive listeners, and propagation in a live browser.

---

## 10. Manual Smoke Verification Procedure

To perform manual verification with an unpacked extension in Chrome/Chromium:
1. Build the extension: `pnpm --filter @futureclick/browser-extension build`
2. Start the fixture server: `pnpm --filter @futureclick/browser-extension serve:fixtures`
3. Open `chrome://extensions` in Chromium.
4. Enable **Developer mode** (top right toggle).
5. Click **Load unpacked** and select `apps/browser-extension/dist`.
6. Navigate to `http://127.0.0.1:4173/fc005/repository-visibility.html`.
7. Click **Start Observing** on the FutureClick Dev control.
8. Click **Change Visibility to Public** (Button A).
9. Verify that:
   - The FutureClick indicator displays `VERIFIED: Repository "Synthetic Repository" visibility will change from private to public.`
   - The page handler execution counter increments to `1` (confirming no event cancellation).
10. Click buttons B, C, D, and E; verify appropriate abstentions (`Insufficient evidence`, `Unsupported observation`).
11. Test contenteditable (Button F), deeply nested (>4 hops, Button G), and secret-prose (Button H) controls; verify rejection and zero secret leakage.
12. Click **Stop Observing**; confirm observation turns INACTIVE and results are cleared.

---

## 11. Hostile-Boundary & Error-Privacy Hardening (Sprint FC-005B)

The FC-005B corrective pass addressed three specific trust boundary and privacy findings identified during independent review:

### M1: Schema Coercion & Reflection / Proxy Safety
1. **Schema Version String Coercion Removed:**
   - Hostile input objects with throwing `Symbol.toPrimitive` or `toString` traps (e.g., throwing `"PASSWORD=secret"`) cannot trigger string coercion during schema version checks.
   - All string fields strictly verify `typeof value === "string"` before any string methods or comparisons execute.
2. **Revoked Proxy & Reflection Safety:**
   - Standard `Array.isArray`, `Object.keys`, `Object.getPrototypeOf`, and property reads on revoked proxies throw native `TypeError` exceptions.
   - All external array boundaries use `safeIsArray()` wrapped in fail-closed error handling.
   - `deepFreeze()` catches all reflective/proxy failures (`ownKeys`, `getOwnPropertyDescriptor`, `get`, `getPrototypeOf`, revoked proxies) and returns safely without leaking thrown exceptions.
3. **ID Generator Runtime Return & Throw Safety:**
   - Return values from `idGen.generate()` are treated as untrusted runtime data.
   - Primitive type is validated (`typeof generatedId === "string"`) before canonical ID validation. Non-string returns (e.g. `null`, numbers, objects, proxies, throwing coercion objects) fail safely with a fixed configuration failure code.
   - Thrown generator exceptions (e.g., `Error("PASSWORD=secret")`) are caught and normalized to fixed configuration failure codes without leaking secret prose.

### M2: Engine Construction Failure Boundary & Safe Configuration Ingress
1. **Hostile Registry & Options Capture:**
   - `BrowserAdapterEngine` construction and `createBrowserAdapterEngine()` safely capture options and registry properties once.
   - Revoked options/registry proxies, throwing getters for `adapters` or `registry`, sparse arrays, and throwing array `length`/`index` traps are caught and normalized to fixed `[INVALID_CONFIGURATION]` failures.
2. **Safe Extension Initialization:**
   - Extension bootstrap wraps controller creation in fail-closed error handling, preventing raw configuration errors or stacks from reaching page console or DOM.

### M5: Adapter Thrown Exception Privacy & Public Error Contract
1. **Adapter Thrown Exception Privacy:**
   - When an adapter's `assess()` method throws any value (Error, string, object, proxy, or secret-containing error), `BrowserAdapterEngine` returns only the fixed code `ADAPTER_EXECUTION_FAILED`.
   - Raw error messages, stacks, causes, names, or thrown values never cross the trusted adapter engine boundary.
2. **Diagnostic Property Privacy:**
   - Internal validation issues from `validateBrowserObservation` (which may reference malformed property names such as `PASSWORD_super_secret`) are not exposed in public adaptation outcomes. The engine returns only the fixed code `INVALID_OBSERVATION`.
3. **Public Error Contract:**
   - The public adaptation outcome error contract is code-only: `{ status: "error", code: BrowserAdapterErrorCode | string }`. Framework-level failures map to closed codes in `BROWSER_ADAPTER_ERROR_CODES`, while adapters may return custom machine-token error codes ($\le 64$ characters) validated fail-closed against `isValidErrorCode`.
   - The development indicator maps error statuses to fixed, predefined static UI strings (`Adaptation error`, `Adapter evaluation failed.`), ensuring zero secret leakage to the browser display.

---

## 12. Oversized Adapter Missing-Array Bound Hardening (Sprint FC-005C)

The FC-005C single-defect corrective pass addressed an array allocation vulnerability where an adapter returning an `insufficient-evidence` decision with an oversized proxied `missing` array (`length = 4294967296`) could trigger a `RangeError: Invalid array length` escaping `BrowserAdapterEngine.adapt()`:
- **Maximum Length Bound Before Allocation:** `captureDenseArrayOnce` now accepts an optional `maxLength` parameter. After reading `length` exactly once and verifying it is a non-negative safe integer, the function enforces `rawLength <= maxLength` (and `rawLength <= 4294967295`) BEFORE invoking `new Array(length)` or iterating indices.
- **Strict Adapter Missing Bound:** `validateAdapterDecision` enforces `MAX_ADAPTER_MISSING_COUNT = 16` via `captureDenseArrayOnce(missingRead.value, "missing", MAX_ADAPTER_MISSING_COUNT)`. Oversized missing arrays are rejected fail-closed without memory allocation or iteration.
- **Public Error Contract Retained:** Oversized missing arrays return `{ status: "error", code: "INVALID_ADAPTER_OUTPUT" }` with zero RangeError or raw exception leakage.

---

## 13. Registry Resource-Bound & Adapter Count Safety (Sprint FC-005D)

The FC-005D corrective pass addressed a denial-of-service / resource exhaustion vulnerability where a hostile adapter registry configuration could report a huge valid JavaScript array length (e.g. `length = 4294967295` or `100000`), causing excessive memory allocation or massive synchronous index traversal before individual adapter validation:
- **Named Practical Registry Limit:** Defined `MAX_BROWSER_ADAPTER_COUNT = 256` in `packages/browser-adapter/src/registry.ts`.
- **Enforcement Before Allocation & Traversal:** `createBrowserAdapterRegistry` passes `MAX_BROWSER_ADAPTER_COUNT` to `captureDenseArrayOnce(adapters, "adapters", MAX_BROWSER_ADAPTER_COUNT)`. After reading length exactly once and confirming safe-integer status, `captureDenseArrayOnce` validates `length <= MAX_BROWSER_ADAPTER_COUNT` *prior* to `new Array(length)` allocation and *prior* to any index reads.
- **Fail-Closed Configuration Failure:** Any oversized adapter array is rejected immediately with zero index reads (`[INVALID_CONFIGURATION]`), preventing CPU/memory exhaustion and allocation exceptions.

---

## 14. Explicitly Deferred LOW Findings (FC-005)

The independent security reviews identified the following non-blocking items as LOW severity and safe to defer:
- **Adapter identity/version trim policy:** Adapter ID and version strings are required to be non-empty machine tokens; leading/trailing whitespace trimming is deferred.
- **Observation ID trailing-newline policy:** Observation IDs are validated against ASCII bounded printable characters without explicit trailing-newline stripping.
- **Capture observation-ID injection seam:** Observation ID generation uses cryptographic UUID v4 or caller-injected generator; capture-time generator substitution is deferred.
- **Non-enumerable extra input-property policy:** `Object.keys()` validates enumerable property names against closed schemas; non-enumerable property inspection on hostile object inputs is deferred.
- **Standalone deepFreeze permissive helper contract:** Standalone `deepFreeze()` best-effort return on hostile reflection traps is deferred as trusted validation paths detach structures before freezing.
- **Configuration diagnostic property-name wording:** Refinement of property naming in internal diagnostic strings is deferred as public adaptation outputs remain strictly code-only.

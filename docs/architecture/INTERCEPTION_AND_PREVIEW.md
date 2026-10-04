# Interception + Preview Architecture (Sprint FC-006)

## Status

**Architecture:** APPROVED
**Implementation:** Sprint 3A — release-binding corrective pass on Sprint 3 trusted Continue

FC-006 Sprint 3A keeps the approved one-shot release architecture and hardens binding:

1. trusted human click on the exact supported action
2. synchronous eligibility + `preventDefault` / `stopImmediatePropagation`
3. evaluating UI
4. local adapter + frozen ConsequenceEngine
5. deterministic VERIFIED consequence preview bound to an immutable Continue decision token
6. Cancel, Stop, or **trusted Continue** (token must match the exact pending decision)
7. Continue order: leave `preview-ready` → UI preflight (may run page callbacks) →
   **final** synchronous release revalidation → private one-shot `ArmedContinuation` →
   immediate `Reflect.apply(capturedHtmlButtonClick, pending.element, [])`
8. authorization consumed at window capture **before** page handlers (includes `releaseGeneration`)
9. nested/reentrant activations blocked; at most one authorized continuation activation

**Synthetic fixture only.** No generic executor. No real GitHub mutation.
**Honest note:** Continue does **not** re-await `ConsequenceEngine.evaluate()`. Release authorization
proves fresh context semantic fingerprint equality against the retained preview fingerprint, and
validates the retained assessment against a closed FC-006 expected consequence shape.

## Capture Ancestor Bounds (Sprint 1A)

FC-006 capture uses two independent fail-closed hop limits:

| Bound | Constant | Value | Meaning |
| --- | --- | --- | --- |
| Target → button | `MAX_ACTIVATION_ANCESTOR_HOPS` | 4 | Event target to candidate `<button>` |
| Button → root safety | `MAX_BUTTON_ANCESTOR_INSPECTION_HOPS` | 8 | Post-button light-DOM ancestors inspected for disabled-fieldset / editable exclusions |

Exceeding either bound rejects the candidate (fail closed). Continue revalidation reuses the same bounds.

## Pending / Control / Focus Work Bounds (Sprint 2B)

FutureClick bounds **its own synchronous JavaScript traversal work**, not the browser's
internal event-dispatch cost.

| Path | Bound | Mechanism |
| --- | --- | --- |
| Window pending fast path | ≤4 `parentElement` hops (or exact `event.target` identity) | No `composedPath()` scan |
| Deep pending descendants / reparenting | Constant FutureClick JS | Capture listener on the exact `pending.element` for the pending lifetime |
| Owned UI controls | Exact control references | No host-containment authority; no full event-path ownership scan |
| Dialog focus trap | `shadowRoot.activeElement` + known control list | No ancestor climb; no `composedPath()` |

## Trusted Continue (Sprint 3 / 3A)

| Topic | Truthful claim |
| --- | --- |
| Continue UI | Exact FutureClick-created control; preview-ready only; requires `event.isTrusted === true` |
| Decision token | Immutable `{ pendingId, sessionEpoch, requestSequence, previewGeneration }` captured by Continue listener |
| Old Continue | Token mismatch is inert and does not disturb a different current pending B; Continue node is replaced on teardown/new preview |
| Revalidation | Full synchronous fresh capture + matcher + adapter adapt + closed-world context/assessment fingerprints |
| Entity identity | Observation `entityKey` is part of the release fingerprint — a different valid key is a different decision |
| Assessment | Retained VERIFIED assessment must match the exact closed FC-006 consequence shape (summary, evidence, risk, reversibility, state-change binding, provenance, cardinalities). Sprint 3B: no string coercion of before/after/visibility values; optional semantic fields (`evidence.details`, `reversibility.timeWindow`, state/assessment provenance shape including `engineVersion`) are closed to exact frozen absence/presence. Sprint 3C: context fingerprint also binds exact actor (`human`, no id) and environment/application semantics (`browser`/`web`/`FutureClick Synthetic Harness`/`app-futureclick-synthetic-harness`/`1.0`, no sessionId), with state/action environmentId consistency inside one context. Generated IDs/timestamps may still differ across fresh adapts. |


| Stale | Any revalidation failure → `stale`; fixed copy only; Dismiss/Stop; no Continue; no release |
| ArmedContinuation | Private in-memory one-shot capability (`pendingId`, element, epochs, `releaseGeneration`, `consumed`) — **not cryptographic** |
| Native click | Captured `HTMLButtonElement.prototype.click` at module init; invoked via `Reflect.apply` on exact `pending.element` |
| Released event trust | The issued `.click()` event is generally `isTrusted === false`; authorization comes from trusted Continue + private armed state |
| Consumption | Window capture consumes authorization and retains exact `Event` object identity before target handlers |
| Reentrancy | Nested `dispatchEvent` / `.click()` / second supported targets blocked while `releaseInProgress` |
| Exactly-once | At most one authorized continuation activation per valid Continue decision |

Safe Continue phase order (Sprint 3A):

1. trusted Continue with decision-specific token
2. exact token / session / pending / `preview-ready` match (else inert)
3. state → `continuing` (blocks duplicate Continue / new preview)
4. UI preflight (`beginContinuing`: unbind Continue, disable controls, clear preview content — page `disconnectedCallback` may run here)
5. **final** synchronous release revalidation
6. on failure → `stale` (no arm)
7. `releaseInProgress = true` → create `ArmedContinuation` → **immediately** native click
8. `finally` cleanup

After step 5 success there is **no** UI/DOM/page-callback work before step 7.

## Semantic Identity

| Field | Value |
| --- | --- |
| Route | `/fc006/repository-visibility-interception.html` |
| Origin | `http://127.0.0.1:4173` |
| routeId | `synthetic.repository-visibility-interception` |
| fixtureContract | `fc006.repository-visibility-interception.v1` |
| operation | `repository.visibility.change` |
| adapterId | `browser.synthetic.repository-visibility-interception` |
| adapterVersion | `1.0` |
| transition | `private → public` |

## Sprint 3 Lifecycle

States: `off` → `observing` → `evaluating` → `preview-ready` | `abstention` → (`continuing` | `stale`)

- Capture-phase click listener installs at `document_start` and remains for document lifetime.
- Controller starts `off`. Trusted Start → `observing`.
- One pending action maximum (`pendingId`, element ref, observation, sessionEpoch, requestSequence, optional context/assessment).
- Continue may begin **only** from `preview-ready`.
- Stale evaluation results are dropped unless sessionEpoch, requestSequence, pendingId, and `evaluating` still match.
- Shared applicability helper `assessFc006RepositoryVisibilityObservation` is required before cancellation; capture alone is insufficient.

## Explicitly Not Implemented

- generic `executeAction` / selector release / arbitrary element argument
- queue / batch / auto-Continue / timeout release
- cryptographic event authentication
- remote execution / AI prediction
- real GitHub mutation

## Untrusted Original Clicks While Observing

While `observing` with no pending action, an untrusted scripted `button.click()` does **not** open a FutureClick preview (outside the human-action guarantee) and is not broadly cancelled. Page behavior may proceed.

While a pending action exists, activations targeting the pending element (or shallow
descendants within the window ≤4-hop fast path) are blocked by **identity**, regardless of
`isTrusted`, cancelability, `defaultPrevented`, metadata mutation, ownership host
containment, or page reparenting. Deeper descendants are blocked by the direct
`pending.element` capture guard. During an authorized release, only the exact retained
`authorizedReleasedEvent` object identity is allowed through that guard.

Owned UI actions are identified by exact FutureClick-created control identities (Start /
Stop / Cancel / Continue / Dismiss), not by host/ShadowRoot containment alone. Dialog Tab/Escape
handling uses the closed known-control list and `shadowRoot.activeElement` only.

## Frozen Boundaries

Unchanged:

- `packages/action-schema/**`
- `packages/action-graph/**`
- `packages/consequence-engine/**`
- `packages/privacy/**`
- `packages/shared/**`
- `packages/browser-adapter/**`
- `apps/browser-extension/src/content/**` (FC-005 passive production)
- `apps/browser-extension/tests/fixtures/fc005/**`

## Manifest Split

### FC-005

- path: `http://127.0.0.1/fc005/repository-visibility.html`
- bundle: `content.bundle.js`
- `run_at`: `document_idle`
- behavior: passive observation only

### FC-006

- path: `http://127.0.0.1/fc006/repository-visibility-interception.html`
- bundle: `fc006-interception.bundle.js`
- `run_at`: `document_start`
- behavior (Sprint 3): trusted interception + preview + Cancel/Stop/Continue one-shot release

Permissions remain `[]`. No `host_permissions`.

## Honest Product Claim (Sprint 3)

While interception is active (`observing`+) on the controlled FC-006 fixture, an eligible trusted human activation of the exact private→public control is stopped before the fixture's consequential target handler executes, and FutureClick shows a deterministic consequence preview. The user may Cancel, Stop, or trusted-Continue. On valid Continue, FutureClick issues **at most one** authorized continuation activation via the captured native button click method on the exact stored pending element. Nested activations during release remain blocked.

## FC-007 Interception Boundary (GitHub Stage-D visibility confirmation)

FC-007 is a consequence-aware interception boundary for the **recognized consequential click
surface**: the Stage-D final confirmation button of the GitHub repository visibility dialog, as
recognized by the V2 contract.

Guarantees:

| Topic | Guarantee |
| --- | --- |
| Human activation | Once the current Stage-D surface is recognized, a later human activation of its final button (or a descendant) is intercepted and previewed; the page's default action does not run. |
| Page-generated activation | `click()`, `dispatchEvent` (cancelable or not), descendant activation, and `requestSubmit(finalButton)` targeting the guarded button are blocked, before and after a decision, and in terminal states. |
| Re-render | A Stage-D re-render while VERIFIED or while evaluation is pending destroys the old decision/evaluation, ignores stale async results, re-runs full recognition once, and moves the guard to the current button. The old detached button stays blocked. |
| Continue | One trusted Continue permits **at most one** guarded consequential submit — exactly one on the normal path — from the authorized generated click's default action. Nested activations or `requestSubmit(finalButton)` inside page handlers during that dispatch are blocked. Unrelated forms are unaffected. |
| Authority | Extension-private, in-memory state only: no DOM attributes, page globals, event markers, or public tokens. Event object identity is diagnostic, not authority. |

Out of scope (FC-007 does **not** prevent):

- hostile page JavaScript calling `form.submit()`;
- hostile page JavaScript calling `requestSubmit()` without the guarded button as submitter;
- the page issuing its own network requests (`fetch`, XHR, beacons, navigations);
- the page replacing the Stage-D surface **and** programmatically activating the replacement in
  the same JavaScript task, before mutation-observer delivery lets FutureClick re-recognize it.

These limits concern page-script actions FutureClick cannot observe as a click on the recognized
surface. They do not weaken the human-activation guarantee above.

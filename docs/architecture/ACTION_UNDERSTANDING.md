# Action Understanding (FC-008)

`@futureclick/action-understanding` is the inert contract, trust-boundary, and
runtime-policy layer for FutureClick's first learned component.

FC-008 is implemented and closed as AI/ML action understanding. Its scope ends
at isolated **PREDICTED** evidence. [§14](#14-fc-008-closure) is the current
record and supersedes earlier planning language in this document that describes
implementation, Sprint 5 runtime work, or the final evaluation as future work.

Sprint 1 delivered **contracts and policy only**. At that freeze there was no
browser observation extraction, no sanitizer, no feature projector
implementation, no training, no dataset, no model artifact, and no user-facing
prediction. The package compiled, validated, decided, and refused. It could not
predict, because no provider in it could score.

## 1. What FC-008 is and is not

FC-008 produces **PREDICTED** evidence in the sense fixed by ADR-006 and
ADR-010: a probabilistic projection with explicit uncertainty. It never produces
VERIFIED or SIMULATED evidence.

The contrast with FC-007 is structural rather than procedural. FC-007's
`Fc007VerifiedDecision` is release-capable precisely because it holds live DOM
references. An `ActionHypothesis` holds no `Element`, no `Node`, no `Event`, no
function, no callback, no executor, no release token, and no click capability. It
is a frozen, JSON-serializable record. It is incapable of releasing a click, not
merely forbidden from doing so.

## 2. The four-layer observation contract

Observation data is divided into four layers, and the division is the primary
privacy and leakage control.

| Layer | Name | Purpose | On `ActionObservation`? | Visible to the model |
|---|---|---|---|---|
| A | `AcquisitionContext` | actor kind, platform, environment kind, locale, frame, authorization | Yes | No |
| B | `ObservationSemantics` | normalized tokens, closed categoricals, explicit missingness, bounded structural counts | Yes | **Yes, and only this** |
| C | `BenchmarkMetadata` | opaque grouping identifiers for research partitioning | Yes, nullable | No |
| D | `EphemeralDisplayContext` | human-readable labels for UI only, memory-only | **No — see below** | No |

Layer B is the **only** projector input. This is enforced by signature, not by
review:

```
projectPrimaryFeatures(semantics: ObservationSemantics, vocabulary, policy)
```

The other layers are not reachable from the parameter type, so a projector
cannot read site identity, application family, template lineage, or an object
label even if its author wanted to. The same technique constrains the scoring
provider, which also receives Layer B only.

The resolved oracle class is absent from every layer, including Layer C. It is
not merely excluded from features; it is unreachable from any API the runtime
touches.

### Layer D is not observation data

`EphemeralDisplayContext` is deliberately **not a field of `ActionObservation`**.
It lives in its own module, `display.ts`, and is a companion value the caller
holds in memory alongside an observation.

The reason is that `ActionObservation` is the **serializable** record: it is
fingerprinted, logged, written to benchmark files, and handed to validators.
Layer D holds the one thing that must never be any of those — a human-readable
private object label such as a repository or file name. A field on a serializable
record that "must never be serialized" is a convention, and conventions are the
things that break.

So the separation is enforced rather than documented:

- `EphemeralDisplayContext` is not a member of `ActionObservation`, which is a
  type-level fact.
- The observation validator uses closed-shape validation, so an input that
  carries a `display` key is **rejected**, not silently ignored.
- `OBSERVATION_FORBIDDEN_KEYS` names `display`, `objectLabel`, `surfaceTitle`,
  and `retentionPolicy` explicitly.
- A display context carries a non-enumerable `toJSON` that **throws**, so
  attempting to serialize one — directly or as part of a larger object — is a
  `TypeError` rather than a quiet disclosure.
- It is accepted by no serializer, no fingerprint input, no provider, no
  projector, and no benchmark recorder; none of them has a parameter of its type.

`tests/layering.test.ts` asserts its absence from the observation, from JSON
serialization, from the fingerprint signature, and from the projector input.

### Privacy by grammar

Layer B tokens must match a closed normalized-token grammar: lowercase
alphanumeric segments joined by single `-` or `_` separators. This structurally
excludes URLs, paths, emails, CSS selectors, XPath expressions, mixed case, and
whitespace. A supplementary per-segment length cap rejects long opaque
alphanumeric runs such as hashes and bearer tokens.

The grammar is **defence in depth, not the primary secret control**. Deciding
what is a secret is the exclusive responsibility of the Sprint 2 sanitizer,
which runs before these semantics are constructed. A short lowercase run is
indistinguishable from a word by shape alone and is accepted here.

State tokens use the closed form `<transition-property>:<normalized-value>`
where the namespace must be one of the frozen transition properties, so the
state channel cannot grow uncontrolled free text.

## 3. The frozen support matrix

Thirteen supported `(verb, objectKind, transition)` tuples, in a permanent class
ordering that artifacts and evaluation code depend on.

### Class numbering

Stated once so it is never ambiguous:

- **`classNumber` is the canonical external identity, 1 through 13.** Every
  document, report, dataset record, oracle statement, and review comment uses
  this.
- **`classIndex` is the internal array position, 0 through 12.** Logit vectors,
  coefficient matrices, and array lookups use this.
- The relationship is exactly **`classNumber = classIndex + 1`**.

There is no "class 0". Array index 0 is class number 1. `classNumberToIndex` and
`classIndexToNumber` are the only sanctioned conversions, and
`verifySupportMatrixIntegrity` asserts the relationship on every row.

| Class number | Array index | Verb | Object kind | Transition |
|---|---|---|---|---|
| 1 | 0 | `delete` | `file` | `existence: present → absent` |
| 2 | 1 | `delete` | `document` | `existence: present → absent` |
| 3 | 2 | `share` | `file` | `access: private → shared` |
| 4 | 3 | `share` | `document` | `access: private → shared` |
| 5 | 4 | `rename` | `file` | `name: current → replaced` |
| 6 | 5 | `move` | `file` | `container: source → destination` |
| 7 | 6 | `move` | `folder` | `container: source → destination` |
| 8 | 7 | `change-access` | `repository` | `visibility: private → public` |
| 9 | 8 | `grant` | `permission` | `grant-state: absent → granted` |
| 10 | 9 | `subscribe` | `subscription` | `status: inactive → active` |
| 11 | 10 | `install` | `application` | `installation: absent → installed` |
| 12 | 11 | `send` | `message` | `delivery: draft → sent` |
| 13 | 12 | `submit` | `form` | `submission: ready → submitted` |

Verbs and object kinds are drawn from the existing canonical
`@futureclick/action-schema` vocabularies. FC-008 adds no vocabulary. `unknown`
and `other` are never learned classes.

### A property discovered, not designed — mandatory research disclosure

`(verb, objectKind)` is **unique across all thirteen tuples**. The transition
property is therefore deterministically determined by the (verb, objectKind)
pair, and **transition factorization provides no independent class
discrimination in this support matrix**. The factorized model's transition head
carries no information beyond the verb and object heads on the supported set.

This must be disclosed wherever RQ1 is reported, because it bounds what the
comparison can show:

- RQ1 compares **two complete systems**, a joint model and a factorized model,
  each with its own parameterization, calibration, and abstention behaviour. It
  does not compare "with" against "without" transition factorization.
- Any accuracy, calibration, or abstention difference observed **must not be
  attributed to transition factorization**. On this matrix the transition head is
  informationally redundant, so it cannot be the cause.
- A plausible mechanism for any difference is the **parameter sharing** across
  the verb and object heads, not the transition head, and even that is a
  hypothesis rather than a measured attribution.
- The property is a consequence of **this** thirteen-tuple matrix. A broader
  future matrix containing two tuples that share a (verb, objectKind) pair and
  differ only in transition would break the property and make the transition head
  informative. The matrix was **not** changed to manufacture such a result: it is
  frozen on semantic grounds, and the property was discovered afterwards.

`verifySupportMatrixIntegrity` asserts the uniqueness, so the property cannot
silently disappear, and any interpretation of the factorized-versus-joint
comparison must account for it.

### The submit/form specificity oracle

Class 13 (`submit`/`form`) overlaps every other class whose action is performed
by submitting a form. The overlap is resolved by a frozen seven-point rule,
exported as `FC008_SPECIFICITY_ORACLE_RULE`:

1. Ground truth is the **intended semantic transition**, not the UI mechanism
   used to trigger it.
2. All thirteen tuples are retained; none is deleted to avoid the overlap.
3. When a class 1–12 tuple applies, it wins — even when the action is performed
   by submitting a form.
4. Class 13 (`submit`/`form`) applies only when the submission itself is the
   action and no more specific transition is intended.
5. When two tuples are equally specific, the sample is **rejected as ambiguous**
   rather than assigned arbitrarily.
6. Oracle metadata is stored separately from observation semantics.
7. The resolved class, fixture identifier, generator identifier, deterministic
   rule outcome, and any proxy for them **must never enter model features**.

Worked example: making a private GitHub repository public is class 8
(`change-access`/`repository`/`visibility`), **not** class 13, even though the
control is a form submit button.

## 4. Three outcomes, and why the split matters

`UnderstandingResult` is a discriminated union with exactly three members:

- `hypothesis` — the system worked and committed to one supported tuple.
- `abstained` — the system worked and declined to commit. **Epistemic.** Seven
  reasons: `LOW_CONFIDENCE`, `AMBIGUOUS_ACTION`, `NOVEL_OR_UNSUPPORTED_INPUT`,
  `INSUFFICIENT_CONTEXT`, `UNSUPPORTED_OBJECT`, `PRIVACY_REDACTION_TOO_HIGH`,
  `OBSERVATION_STALE`.
- `failed` — the system did not work. **Operational.** Five codes:
  `SCHEMA_INVALID`, `MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`,
  `MODEL_VERSION_MISMATCH`, `INTERNAL_ERROR`.

The split is structural: an `AbstainedResult` has no operational code field and
a `FailedResult` has no epistemic reason field, so the two cannot be conflated by
a careless consumer.

Coverage and selective-risk statistics are computed over `hypothesis` versus
`abstained` only. `failed` is excluded from every research metric and reported
separately as an engineering reliability defect. A non-zero failure rate in a
final evaluation is a bug to fix, not a finding. A crashed model is never
reported as model uncertainty.

### Failure detail is closed and categorical

`FailedResult.detail` is **not** a free-text map. It is a closed record of
`{ stage, reason, measurement }` where `stage` and `reason` are drawn from frozen
vocabularies and `measurement` is a single bounded, finite, non-negative number
or null.

An arbitrary-string detail is a leak channel in both directions: page-derived or
provider-derived text can be copied into a failure record, and a raw model output
or a private label can reach a log through an error path that nobody audits as a
data path. With no free-text field, no attacker-controlled or model-controlled
string can ride out through a failure. `createFailureDetail` fails closed on an
out-of-vocabulary stage or reason, substituting a conservative
`runtime`/`unhandled-exception` record rather than recording an unvalidated
value.

### Every published result is deeply frozen and detached

Diagnostics, support records, provenance, alternatives, failure details,
freshness bindings, and confidence records are each validated, detached from the
caller's object, and frozen at construction. A caller that retains a mutable
reference to something it passed in cannot alter a published result, and
`findUnfrozenPath` and `findNonInertPath` assert the property on every outcome
path.

## 5. Deterministic support checks, not statistical OOD

Nine deterministic checks exist. These are counts and comparisons, never
probabilities.

FC-008 makes **no robust statistical out-of-distribution claim**. There is no
Mahalanobis distance, no feature-vector norm threshold, and no density estimate.
The reason is named for the check that produced it rather than for a statistical
property it does not have. The reason name `OUT_OF_DISTRIBUTION` is deliberately
absent from the vocabulary.

`RuntimeSupportDiagnostics` carries no confidence, probability, score, or
distance field, by design.

### Support assessment is runtime-owned

`assessSupport` runs on the runtime side and takes only validated Layer B
semantics plus runtime-held policy state. **A provider contributes nothing to
it**, and the provider contract carries no support field at all.

This is not stylistic. If a provider reported its own input-support evidence, it
could claim full feature coverage and zero unknown tokens for any input and
thereby convert an input that should have been refused into an accepted
hypothesis — a provider certifying the very thing the runtime exists to check.
`assessSupport` therefore has **no parameter** through which a provider value
could arrive, and `tests/outcome-mapping.test.ts` asserts that a hostile provider
cannot alter the support evidence.

### One frozen condition-to-outcome mapping

Each of the nine checks maps to exactly one outcome, and the mapping is declared
once as data in `FC008_SUPPORT_OUTCOME_MAPPING`:

| Condition | Outcome |
|---|---|
| schema version mismatch | `SCHEMA_INVALID` (operational) |
| feature-policy, support-matrix, or model version mismatch | `MODEL_VERSION_MISMATCH` (operational) |
| excessive privacy redaction | `PRIVACY_REDACTION_TOO_HIGH` |
| missing required feature groups | `INSUFFICIENT_CONTEXT` |
| missing minimum semantic evidence | `INSUFFICIENT_CONTEXT` |
| unsupported object kind | `UNSUPPORTED_OBJECT` |
| unknown categorical token | `NOVEL_OR_UNSUPPORTED_INPUT` |
| unknown-token ratio over threshold | `NOVEL_OR_UNSUPPORTED_INPUT` |
| unsupported semantic tuple | `NOVEL_OR_UNSUPPORTED_INPUT` |

The alternative — condition checks scattered through the runtime — leaves the
mapping implicit in control flow, where a code could be exported, never wired to
an outcome, and silently do nothing. `verifyOutcomeMapping` asserts that every
code has exactly one entry, names a member of the frozen result vocabularies,
declares a step that exists in the precedence ladder, and **has a predicate**, so
an unwired code is a test failure.

### An honest gap: the unknown-token ratio

The unknown-token ratio requires a **fitted feature vocabulary**, which is a
Sprint 3 artifact. Until one is loaded, `assessSupport` reports
`unknownTokenRatioAvailable: false` and the mapping does not apply the ratio
rule.

Sprint 1 therefore does not report passing a check it is structurally unable to
perform. Reporting a ratio of zero as though the check had succeeded would be the
easy option and a false statement about coverage.

## 6. The thirteen-step precedence ladder

Declared as data in `FC008_PRECEDENCE`, not as nested conditionals, so the
ordering is inspectable and cannot be reordered by editing control flow.

| Step | Category | Phase | Outcome |
|---|---|---|---|
| 1 | operational | pre-inference | `SCHEMA_INVALID` |
| 2 | operational | pre-inference | `MODEL_VERSION_MISMATCH` |
| 3 | operational | pre-inference | `MODEL_UNAVAILABLE` |
| 4 | operational | post-inference | `MODEL_TIMEOUT`, `INTERNAL_ERROR` (when encountered) |
| 5 | epistemic | pre-inference | `OBSERVATION_STALE` |
| 6 | epistemic | pre-inference | `PRIVACY_REDACTION_TOO_HIGH` |
| 7 | epistemic | pre-inference | `INSUFFICIENT_CONTEXT` |
| 8 | epistemic | pre-inference | `UNSUPPORTED_OBJECT` |
| 9 | epistemic | post-inference | `NOVEL_OR_UNSUPPORTED_INPUT` |
| 10 | epistemic | post-inference | `AMBIGUOUS_ACTION` |
| 11 | epistemic | post-inference | `LOW_CONFIDENCE` |
| 12 | accept | post-inference | PREDICTED hypothesis |
| 13 | epistemic | final | `OBSERVATION_STALE` replacement |

Two subtleties are deliberate and tested:

**Step 4 applies "when encountered."** A stale observation at step 5 short
circuits before the provider is invoked, so no timeout can occur on that path.
The provider call count is asserted to be zero.

**Step 13 does not replace an operational failure.** It replaces any unpublished
epistemic or accepted result, because a result computed from input that has since
gone stale must not be published. It leaves `failed` alone, because relabelling a
crashed or timed-out model as stale input would hide a reliability defect behind
an epistemic label.

## 7. Providers score, the runtime decides

See ADR-014. A `ScoringProvider` returns **raw scores only**, plus artifact
identity. `ProviderScoringContext` carries two version strings and nothing else,
so a provider is told no threshold, no budget, and no policy, and has nothing to
apply.

### Both model families, from Sprint 1

The score payload is a discriminated union, so the Sprint 3 model choice needs no
breaking redesign of the boundary:

| Family | Payload | Head sizes |
|---|---|---|
| `joint-logistic` | `tupleLogits` | 13, one per supported tuple |
| `factorized-logistic` | `verbLogits`, `objectLogits`, `transitionLogits` | 10 verbs, 9 object kinds, 10 transition properties |

The head sizes are derived from the frozen matrix as
`FC008_MATRIX_VERB_COUNT`, `FC008_MATRIX_OBJECT_KIND_COUNT`, and
`FC008_MATRIX_TRANSITION_PROPERTY_COUNT` rather than hard-coded, so they cannot
drift from the matrix they describe.

**All three factorized heads are preserved losslessly** at the boundary. That
matters for three later needs: RQ1 must be able to inspect the heads, temperature
calibration must be definable over them, and unsupported-combination mass must be
computable from them. Collapsing them at the boundary would destroy all three.

Per-family shapes are closed, so a joint payload carrying factorized heads, or
the reverse, is rejected rather than partially interpreted. A payload whose
`family` contradicts its own artifact descriptor is also rejected.

### Factorized composition is deferred, not faked

Sprint 1 **accepts** a factorized payload at the boundary and **refuses to
compose it**, returning the operational result `MODEL_UNAVAILABLE` with the
detail `composition/composition-not-implemented`.

Composing three heads into a distribution over the thirteen supported tuples
requires supported-set renormalisation and unsupported-combination mass
accounting. Those were later-sprint deliverables. Inventing a probability in
Sprint 1 would have been the alternative, so that runtime declined. The refusal
is operational rather than epistemic, because an unimplemented composition is a
system limitation and not a statement about how difficult the input was.

This subsection records the Sprint 1 refusal. Composition is implemented in the
closed runtime. [§14](#14-fc-008-closure) supersedes this subsection as a
description of the current system.

### A provider cannot self-certify anything

Provider output is closed-shape validated. A provider returning an extra
`hypothesis`, `evidenceMode`, `accepted`, `policy`, `probabilities`,
`calibratedConfidence`, `thresholds`, or any support-bearing field — `support`,
`evidence`, `featureCoverage`, `unknownTokenRatio`, `supportedTupleResolved` —
is rejected as an operational defect.

Non-scored outcomes carry a **closed diagnostic token**, not prose, drawn from
`PROVIDER_DIAGNOSTICS`. A provider cannot emit arbitrary text through a failure
path, because such text would be page- or model-derived and unbounded.

The Sprint 1 default is `createNullScoringProvider()`, which always returns
`unavailable` and can never emit `scored`. Sprint 1 therefore cannot produce a
hypothesis through its default configuration.

### Artifact and calibration identity

The runtime checks that the loaded artifact, the provider's score set, the
calibration result, and the published provenance all refer to a **compatible
model family, model version, artifact SHA-256, support matrix version, feature
policy version, and calibration artifact version**. Any divergence fails closed
with `MODEL_VERSION_MISMATCH`, and no hypothesis is produced.

Those six fields are declared once, as `ARTIFACT_IDENTITY_FIELDS`, and every
boundary is compared through the same `artifactIdentityDivergence`. A partial
comparison is the failure mode worth designing against: model SHA and version can
match while the support matrix or feature policy differ, which means a different
class space or a different feature space. Declaring the dimensions in one place
means adding a seventh enforces it everywhere rather than in whichever comparison
the author remembered.

The calibration check is the one most easily overlooked and the most dangerous to
omit: a temperature fitted for one artifact applied to another artifact's logits
produces a mis-calibrated probability that looks entirely normal. `CalibratedScores`
therefore carries the identity it was fitted for, and the runtime compares it
rather than assuming it.

### Timeout and latency

The runtime enforces `AbstentionPolicy.inferenceTimeoutMs`, which can never
exceed the 250 ms absolute ceiling because the policy validator rejects a larger
value. Latency is **measured** from an injected monotonic `RuntimeClock`, never
hard-coded.

The budget is **inclusive**: the comparison is `elapsedMs > timeoutMs`, strictly
greater. Work finishing at exactly `timeoutMs` has not overrun its budget and is
accepted; `timeoutMs + 1` is `MODEL_TIMEOUT`. All three adjacent cases —
`timeoutMs - 1`, `timeoutMs`, `timeoutMs + 1` — are pinned by test, so the
operator cannot be changed silently.

The clock is injected rather than imported so the package stays platform-neutral:
it names no `performance`, `Date`, `node:perf_hooks`, or browser API, and tests
drive a deterministic scripted clock so timing behaviour is exactly reproducible.

One honest limitation is recorded in `timing.ts` rather than glossed over.
`score()` is synchronous, and JavaScript cannot preempt synchronous code, so no
wrapper can interrupt a provider mid-computation. What is implemented is a
**deadline check**: elapsed time is measured across the provider call and across
calibration, and an over-budget result is **discarded** with `MODEL_TIMEOUT`. An
over-budget score therefore cannot reach a decision, which is the property that
matters, but the work is not cancelled. Wrapping synchronous work in a promise
race would look like cancellation while delivering none, so it is deliberately
not done.

### Calibration placement

`ScoreCalibrator` was defined in Sprint 1 as a runtime-owned **interface with no
implementation**. Softmax, temperature scaling, and factorized renormalisation
onto the supported set were implemented in Sprint 4, with golden
Python/TypeScript parity vectors. Sprint 1 tests injected a deterministic stub,
explicitly documented as not the FC-008 implementation. [§14](#14-fc-008-closure)
is the current record.

Calibration authority stays with the runtime regardless, which is what ADR-014
requires.

## 8. Abstention policy

`AbstentionPolicy` carries the thresholds and the version bindings they apply to.
**Sprint 1 ships no default policy and no recommended threshold values.**
Thresholds are selected on the policy-validation partition in Sprint 3; shipping
a number now would fabricate a calibration decision that no data supports.

A validated policy is deeply frozen and detached from the caller's object.
Neither a provider nor a page holds a reference to it, and a write to it throws.

### What FC-008 does not claim about thresholds

FC-008 does **not** claim that error is approximately one minus the threshold.
For a set selected at confidence at or above a threshold, empirical accuracy is
compared against that selected set's **mean predicted confidence**, not against
the threshold. Calibration improvement is never attributed when two systems are
evaluated at different coverage.

## 9. Fingerprint

`computeObservationInputFingerprint(semantics, acquisition)` is a canonical,
self-delimiting, type-tagged encoding of Layers A and B only, following FC-007's
`decision-fingerprint` pattern. It is an **encoding, not a hash**, so a reviewer
can read what was fingerprinted.

Properties: every atom is type-tagged, so `1` and `"1"` cannot collide; every
variable-length atom is length-prefixed, so no delimiter can be smuggled through
a value; encoding is positional over a fixed schema, so key insertion order is
irrelevant; unordered collections are canonically sorted, so a permutation
produces the same fingerprint.

The signature accepts only Layers A and B, so Layer C cannot be fingerprinted
even by mistake, and Layer D is not observation data at all. Observation validation recomputes the fingerprint
and rejects a declared value that does not match.

## 10. Hard bounds and measure-then-freeze

Every bound is a frozen number in `FC008_SAFETY_CAPS`: string byte and character
caps, per-channel and total token caps, traversal depth, candidate control count,
alternative count, feature vocabulary and active feature caps, concurrency, and
record size.

Three values are **deliberately not fixed in Sprint 1**, because fixing them now
would mean inventing them. Each records where it will be measured, when it is
frozen, and the absolute ceiling it may never exceed:

| Target | Measured in | Frozen before | Bounded by |
|---|---|---|---|
| released artifact size | Sprint 3 | Sprint 3 exit | `absoluteArtifactCeilingBytes` |
| operational inference timeout | Sprint 4 parity | Sprint 5 | `absoluteInferenceTimeoutCeilingMs` |
| probability parity tolerance | Sprint 4 parity | Sprint 4 final experiments | `maxAcceptableProbabilityParityCeiling` |

## 11. Security invariants: the frozen AI-1 … AI-24

These twenty-four identities are **frozen**. AI-n means one specific thing
permanently. Renumbering them, reusing a number for a different claim, or
introducing a second numbering scheme is forbidden, because a review that cites
AI-9 must be citing the same invariant the code enforces.

The authoritative wording and the per-invariant status live in
`packages/action-understanding/src/invariants.ts` as `FC008_INVARIANTS`, and
`verifyInvariantNumbering` asserts that the identifiers are AI-1 through AI-24
exactly once each in order. This section and that module cannot drift apart:
`tests/invariants.test.ts` pins each number to its subject matter.

### Status vocabulary

Each invariant carries an honest Sprint-1 status, because several are enforced by
components that do not exist yet.

| Status | Meaning |
|---|---|
| **PASS** | Holds for the surface Sprint 1 ships, demonstrated by test. |
| **PARTIAL (STRUCTURAL)** | The structural guarantee is in place and tested, but full enforcement needs a later-sprint component. |
| **DEFERRED** | Sprint 1 defines the invariant and ships nothing that could satisfy it yet. **Not a pass.** |

A deferred invariant is reported as deferred. Marking an unimplemented invariant
as passing would make the table worthless as evidence, so it is not done.

### The invariants

Status below is **as of Sprint 1**. Sprint 2 built the sanitizer and extractor
these entries were waiting on and upgraded AI-4 and AI-7; see
[FUTUREBENCH_SPRINT2.md](./FUTUREBENCH_SPRINT2.md) §14 for that sprint's table.
The Sprint-1 column is kept rather than overwritten so the reason each entry was
not a pass at freeze time remains readable. Current readings for AI-18 and AI-23
are in the notes below and in [§14](#14-fc-008-closure).

| ID | Invariant | Sprint 1 status |
|---|---|---|
| **AI-1** | Observation and hypothesis are inert serializable deeply-frozen data. No live DOM/capability/function references. | PASS |
| **AI-2** | Model output can never create, arm, or influence release authority. | PASS |
| **AI-3** | FC-008 model output is always PREDICTED and never VERIFIED. | PASS |
| **AI-4** | Privacy sanitization completes before fingerprinting, logging, serialization, persistence, and inference. | **DEFERRED** |
| **AI-5** | Stale inference cannot attach to changed state. Pre/post freshness checks are required. | PASS |
| **AI-6** | Invalid, unavailable, timed-out, mismatched, or crashed model fails closed without producing a hypothesis. | PASS |
| **AI-7** | Page/application content is untrusted data, never instructions. | **PARTIAL (STRUCTURAL)** |
| **AI-8** | Thresholds and abstention policy are runtime-owned, validated, frozen, and cannot be influenced by page content or provider output. | PASS |
| **AI-9** | The model/provider has no tool, shell, filesystem, network mutation, browser-control, eval, or execution capability. | PASS |
| **AI-10** | FC-008 imports nothing from FC-007 interception/release/native-click paths. | PASS |
| **AI-11** | No remote transmission, remote model download, or remote model SDK exists in FC-008 V1. | PASS |
| **AI-12** | No runtime training or weight mutation. Model artifacts are read-only. | PASS |
| **AI-13** | Provider cannot accept itself. Provider returns scores only; runtime constructs decisions/hypotheses. | PASS |
| **AI-14** | FC-007 remains frozen: canonical seven source hashes + production bundle + regressions unchanged. | PASS |
| **AI-15** | Site/application identity is excluded from primary model features. | PASS |
| **AI-16** | Object labels/private object names are excluded from primary model features. | PASS |
| **AI-17** | FC-008 does not mutate the authoritative ActionGraph and adds no graph node/relation vocabulary. | PASS |
| **AI-18** | Offline training dependencies are separated from browser/TypeScript runtime dependencies. | **PARTIAL (STRUCTURAL)** |
| **AI-19** | All prohibited feature families and oracle proxies are structurally unreachable by the primary feature projector. | PASS |
| **AI-20** | Operational failures are never represented as epistemic abstention. | PASS |
| **AI-21** | Novelty/support diagnostics are deterministic support evidence, never probabilities or calibrated confidence. | PASS |
| **AI-22** | FC-008 captures no screenshots, images, clipboard, keystrokes, or accessibility-tree dumps. | PASS |
| **AI-23** | The future research-mode indicator is inert, contains no predicted consequence content, and has no execution authority. | **DEFERRED** |
| **AI-24** | No persistence or production telemetry exists in FC-008 V1. | PASS |

### Why four Sprint 1 entries were not PASS

The Sprint 1 column is historical. Parenthetical notes record later
implementation. They do not change the invariant wording.

- **AI-4 — DEFERRED.** The ordering is declared and the observation carries a
  sanitizer version and a redaction record, but **the real sanitizer is a
  Sprint 2 component**. Sprint 1 ships no sanitizer, so there is nothing whose
  ordering could be enforced. Claiming a pass here would be claiming a property
  of code that does not exist. *(Sprint 2: now PASS —
  `packages/privacy/src/text-sanitizer.ts` is the sole authority, and the single
  fingerprint call site is positioned after it.)*
- **AI-7 — PARTIAL (STRUCTURAL).** Layer B is a closed grammar of bounded
  categoricals and tokens with no free-text field, and the provider receives
  Layer B alone, so page content structurally cannot arrive as an instruction.
  Full enforcement nonetheless depends on the **Sprint 2 extractor and
  sanitizer** that will produce Layer B from a real page. *(Sprint 2: now PASS
  within synthetic scope — differential tests over injected instructions show the
  label, policy, caps, and support matrix all unchanged.)*
- **AI-18 — PARTIAL (STRUCTURAL).** The package manifest contains no training
  dependency and a closed allowlist test enforces that. Sprint 1 could assert
  the separation on the runtime side only, because the offline training
  environment did not exist yet. *(Sprint 3: offline NumPy and scikit-learn
  training lives in `research/futurebench` and is separate from TypeScript and
  browser inference. The invariant still means that split, not a change to what
  the runtime is allowed to import.)*
- **AI-23 — DEFERRED.** Sprint 1 had no research-mode indicator. *(Sprint 5A:
  `researchIndicatorFromResult` is an inert view model. It contains no predicted
  consequence content and has no execution authority. The browser content script
  does not render it.)*

### Two PASS entries whose scope is worth stating

- **AI-22** passes **for the surface Sprint 1 ships**: no capture API is
  reachable and every such field is unnameable on Layer B. Extension-side
  capture is governed by the Sprint 2 extractor and is deferred to it.
- **AI-24** passes **for the surface Sprint 1 ships**: no storage, database,
  filesystem, or telemetry API is referenced, and the dependency allowlist
  contains no such client. Sprint 3 introduces offline artifacts on disk, which
  are research files and not product persistence.

### How the structural invariants are evidenced

A source-string scan alone is weak evidence, defeatable by an alias, a computed
specifier, or a transitive dependency. The isolation invariants (AI-9, AI-10,
AI-11, AI-12, AI-17, AI-18, AI-24) are therefore evidenced in six independent
layers, in `tests/isolation.test.ts`:

1. **Closed manifest allowlist** — every declared dependency is named
   explicitly, and peer and optional dependencies must be empty.
2. **Closed import allowlist** — every specifier in `src` must be relative or one
   of the inert contract packages, and computed or dynamic specifiers are
   forbidden so the scan is provably complete. The allowlist itself is the
   authority on which packages those are; stating a count here only created a
   second place to keep in sync, and it fell out of sync the moment the third was
   added.
3. **Closed public-export allowlist** — all 139 exported names are enumerated, so
   the public surface cannot grow unnoticed.
4. **Built-package inspection** — the package is compiled into a temporary
   directory and the **emitted JavaScript** is inspected, since that is the
   artifact a consumer would load.
5. **Type-level negatives** — forbidden shapes are compile errors rather than
   runtime checks that could be forgotten.
6. **Runtime negative capability** — the shipped objects are exercised and shown
   unable to act, including a provider that attempts to mutate its input.

Static string scanning remains as defence in depth, but it is no longer the only
evidence for any invariant.

## 12. Research process contracts

These rules were recorded in Sprint 1, which implemented none of them, so later
sprints could not drift from them. They are implemented in the closed system.
[§14](#14-fc-008-closure) supersedes any reading of this section as still future
work. The rules themselves remain binding.

### Six partitions

| Partition | May determine | May never determine |
|---|---|---|
| train | feature vocabulary, model weights | thresholds, temperature |
| calibration | temperature only | weights, thresholds, vocabulary |
| policy-validation | hyperparameters, regularization, thresholds, operational artifact lock | weights, reported generalization |
| test-ID | reporting only | any choice whatsoever |
| test-OOA | reporting only | any choice whatsoever |
| test-novelty | reporting only | any choice whatsoever |

### Preregistration

`FC008_PREREGISTRATION.md` was finalized and **frozen at the end of Sprint 3**,
before Sprint 4. No final partition was read before that freeze. The one-shot
final evaluation must not be rerun to select a model family. See
[§14](#14-fc-008-closure) and ADR-016.

### No final-test model selection

Final test data may not select the runtime or product model family,
hyperparameters, regularization strength, thresholds, feature policy, fixture
design, or application family design. FC-008 declares no runtime or product
winner. See ADR-016.

### RQ1 — factorized versus joint

The two architectures are compared under an identical procedure: identical
examples, identical projection, identical splits, identical tuning procedure, and
an identical regularization search budget.

Parameter counts are **asymmetric and reported as such**. The factorized model
carries roughly 29 × F coefficients plus 29 intercepts; the joint model carries
roughly 13 × F plus 13 intercepts. FC-008 does **not** claim that effective
capacity is matched. Actual coefficient counts, intercept counts, regularization
strength, coefficient norms, and serialized artifact size are reported as
measured facts. The number of non-zero coefficients is **never** used as a
measure of capacity.

Permitted claim: RQ1 compares two complete, naturally defined architectures.
Not permitted: claiming any observed difference is caused solely by compositional
representation.

**The transition-redundancy disclosure in section 3 applies in full here.**
Because `(verb, objectKind)` is unique across all thirteen tuples, transition
factorization provides no independent class discrimination on this support
matrix, so no observed difference may be attributed to it. Any RQ1 report must
state this property alongside the result.

### RQ2 — calibration at matched coverage

Temperature scaling is evaluated at **matched coverage**. Lower error is never
attributed to calibration when two systems are compared at different coverage.

### Application family and template lineage

These are formally distinct and recorded separately in every manifest. An
application family is an independently authored application; a template lineage
is an independently authored generator lineage. Deterministic variants of a
single lineage count as neither.

Minimums: two independent application families per class and two independently
authored template lineages per class. Three families are required only for
classes used in repeated or multi-fold out-of-application evaluation. Multi-class
applications are encouraged. This does **not** require 26 or 39 unrelated
applications.

## 13. Repository conventions that affect later sprints

`.gitignore` ignores any path segment named `out`, `dist`, `build`, `lib`, `var`,
`sdist`, `wheels`, `downloads`, or `logs`. Sprint 3 and later model artifacts and
dataset manifests must avoid those directory names or they will be silently
untracked.

## 14. FC-008 Closure

FC-008, AI/ML action understanding, is implemented and closed. Its scope ends at
isolated **PREDICTED** evidence. This section supersedes earlier text in this
document that describes FC-008 implementation as future work, Sprint 5 runtime
work as deferred, or the final evaluation as not yet run. Historical Sprint 1
wording that is explicitly labeled as Sprint 1 is left in place.

### Released commits

| Sprint | Commit | Role |
|---|---|---|
| 1 | `918ab0d8fc004058bb818b3b97ba545d2ae4d795` | Contracts and policy |
| 2 | `6675c4f2995ec397395e148d4277b15ee0424692` | FutureBench data foundation |
| 3 | `d722d13ecae5f7a4111616227b6660fa7c5a6841` | Reference models, calibration, policy |
| 4 pre-open | `ad3ec754bc7f90fbabb4fd244358dc980f13541e` | Frozen final-evaluation pipeline |
| 4 one-shot evidence | `7ba82acdd624a222689b17f901cec3f79f2a28a7` | Canonical final result |
| 5A | `465ae882fde96e55615abe8753dbabdd7f08890e` | Headless TypeScript runtime |
| 5B | `e0d00bc5b4a07e0181d6334818a165aeeec77470` | Browser runtime bridge |

### What the closed system includes

Committed FC-008 includes privacy-safe `ActionObservation` contracts and
feature projection; deterministic support and novelty handling; abstention;
the synthetic FutureBench dataset; frozen train, calibration, policy, and test
partitions; a joint semantic-tuple logistic model and a factorized
verb/object/transition-property logistic model; temperature calibration;
runtime-owned confidence and policy; reproducibility controls; golden vectors;
Python/TypeScript parity; the frozen final research evaluation; a headless
TypeScript runtime; a browser-safe runtime bridge; freshness and supersession
protection; a 250 ms publication deadline; explicit model-family configuration;
local frozen browser artifacts; and immutable PREDICTED, abstained, and failed
results.

The runtime does not use the network, persist results, or download a remote
model. It has no FC-007 execution authority.

### Epistemic scope

FC-008 outputs **PREDICTED** evidence only, in the sense fixed by ADR-006 and
ADR-010.

It does not promote PREDICTED to VERIFIED, combine VERIFIED with PREDICTED,
click, submit, continue, approve, release, invoke native-click execution, or
authoritatively mutate ActionGraph consequence truth.

### FC-009 handoff

FC-009 is the next planned scope: hybrid intelligence that combines VERIFIED
evidence with AI PREDICTED evidence. That combination is intentionally outside
FC-008. FC-009 is not implemented here, and this record states no FC-009
performance result and no FC-009 architecture beyond that boundary.

### Final evaluation

The canonical result is
`research/futurebench/results/fc008-final-evaluation.json`, SHA-256
`ed0fe951525f05ac858a8ba3ce0420274a7a86919acf7214e10fefb46d8cbacc`.

The evaluation was one-shot and frozen. It must not be rerun for model
selection. It selected no production model-family winner. ADR-016 remains
binding.

### RQ1

Factorized modeling did not establish superiority over the joint classifier on
the frozen out-of-application evaluation.

Structured exact-match delta, factorized minus joint:
`-0.18181818181818188`.

Fixed-13 macro-F1 delta, factorized minus joint:
`-0.10581302755215799`.

Out-of-application inference was low-powered on six lineages. The
transition-redundancy disclosure in section 3 still applies: no observed
difference is attributed solely to transition factorization. This result does
not say that the joint model is universally better, and it does not say that
factorized modeling failed as a research direction. The valid conclusion is
only that factorized superiority was not established under the frozen
experiment.

### RQ2

Temperature scaling produced mixed effects across model families, metrics, and
the in-distribution and out-of-application settings. It is not summarized as
universally improving calibration. No production family winner was selected.

### Limitations

- The benchmark is authored synthetic FutureBench content.
- Out-of-application evaluation uses six lineages and is low-powered.
- Differences are not causally attributed solely to factorization.
- The deterministic novelty gate is not evidence of robust statistical
  out-of-distribution detection.
- No production model-family winner was selected.
- Current browser capture does not provide real-world production prediction
  coverage.

### Browser capture boundary

The production handoff exists:

FC-005 capture → optional FC-008 sidecar → mapper → browser bridge → headless
runtime.

Current FC-005 `BrowserObservation` does not contain enough trustworthy,
privacy-safe observed semantics to build an `ActionObservation` for production
inference. The mapper returns `extraction-refused` rather than inventing
evidence. Later privacy-safe semantic capture can feed the existing bridge
without redesigning FC-008. That is not current production prediction support.

### Fixture and oracle exclusion

The production mapper excludes fixture and site metadata from primary model
input, including `operation`, `currentVisibility`, `requestedVisibility`,
`fixtureContract`, `routeId`, `entityKey`, and `origin`. It does not invent
object kind, control text, heading, nearby labels, or ancestor depth.

### AI-18 and AI-23

AI-18 requires offline training dependencies to stay separate from
browser/TypeScript runtime dependencies. That separation is present: research
training uses NumPy and scikit-learn under `research/futurebench`; inference in
the package and the browser is TypeScript. The Sprint 1 table cell remains
PARTIAL (STRUCTURAL) as a historical status.

AI-23 requires an inert research/prediction indicator with no predicted
consequence content and no execution authority. Sprint 5A provides
`researchIndicatorFromResult` on those terms. The content script does not
render an FC-008 indicator. The Sprint 1 table cell remains DEFERRED as a
historical status.

### Accepted findings

These are accepted and not resolved.

**LOW 1.** The disabled browser content bundle is approximately 518 KB, compared
with roughly 341 KB before Sprint 5B. Frozen coefficient matrices are not
embedded in the disabled default module graph, and an empty host configuration
constructs no runtime.

**LOW 2.** `research/futurebench/results/**` remains broadly ignored by Biome,
from the Sprint 5A ignore entry in `biome.json`.

**NOTE 1.** Current FC-005 capture lacks enough trustworthy privacy-safe
semantics for production FC-008 inference.

**NOTE 2.** Mapper refusal or failed capture can leave prior internal sidecar
state. `understandBrowserObservation` returns the existing bridge state when
mapping is refused. No FC-008 indicator is currently rendered. Future
user-visible indicator work must revisit clearing semantics.

**NOTE 3.** A declared fingerprint/body mismatch may publish `SCHEMA_INVALID`.
An equal-sequence semantic conflict is separately protected and does not
replace `currentState`.

**NOTE 4.** The known frozen FC-007 parallel `requestSequence` timing flake
remains outside FC-008. FC-007 source and bundle remained unchanged, and serial
validation passes under the established rule.

### Privacy and authority

Primary learned features exclude site and application identity, private names,
fixture and oracle tokens, raw DOM, HTML, and selectors, passwords, tokens, and
storage, screenshots, clipboard, keystrokes, accessibility-tree dumps,
evaluation labels, and split identifiers.

FC-008 has no FC-007 release authority.

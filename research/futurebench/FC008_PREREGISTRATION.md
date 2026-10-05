# FC-008 Research Preregistration

Version 1.2. Frozen at the end of Sprint 3, before any sealed partition was evaluated.

Two pre-final-test amendments have been made, both to the authorization mechanism and
neither to any analysis choice. The canonical bytes of every superseded version are
retained under [`artifacts/history/`](artifacts/history/README.md) so each historical
freeze hash can be recomputed rather than taken on trust.

| Version | SHA-256 | Status |
| --- | --- | --- |
| 1.0 | `cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f` | superseded pre-test |
| 1.1 | `4b2cbbb1a9da3bb8479be5c517316762b0417210efe4bb5ca6f7ae290aec4b1c` | superseded pre-test |
| 1.2 | see `fc008-artifact-manifest.json` | **active** |

## Amendment 2 — pre-final-test trust-anchor correction

A second independent review found that amendment 1 had moved the expected identities
out of the caller's hands but left the trust root itself reachable. Three gaps:

1. The manifest **path** was still a parameter. A caller could point authorization at
   any manifest it liked, and a self-consistent fake in a temporary directory would
   build a registry and authorize.
2. The manifest was never checked against anything **outside itself**. Re-deriving each
   artifact hash from disk catches a manifest that misreports its own files, but not a
   manifest that is internally perfect and wholly substituted.
3. The manifest's top-level `datasetHash`, `vocabularyHash`, `supportMatrixVersion`,
   and `featurePolicyVersion` were never compared to the **artifact bodies**. The three
   artifacts of a family were checked against each other, so a manifest declaring one
   dataset while all six artifacts were built from another was accepted.

All three are corrected in the [final-test opening rule](#final-test-opening-rule): the
manifest is resolved from the unlock module's own location, its bytes are pinned to a
SHA-256 constant held in version-controlled source, and the shared identities are
cross-checked manifest-to-body across all six artifacts. The evaluation-time recheck
also now re-reads `modelVersion`, `calibrationArtifactVersion`, and
`abstentionPolicyVersion`, which amendment 1 verified once and then stopped tracking.

**At the time of this amendment no sealed partition had been loaded and no final-test
prediction, logit, probability, or metric existed.**

This amendment was made because the preregistration is the authoritative statement of
the final-test opening rule, and that rule materially changed. Version 1.1's declared
trust boundary asserted that the contract "cannot certify the manifest itself," which is
no longer the implemented protocol; leaving v1.1 active would have left the
preregistration understating its own gate.

Changed: the final-test opening rule and the unlock contract version (2.0 → 3.0).
Unchanged: RQ1 and RQ2 wording, every metric, the ECE binning, the coverage and risk
targets, the bootstrap specification and seeds, the C grid and selected C values, the
temperature grid and fitted temperatures, the threshold grid and selected thresholds,
the model coefficients, intercepts, and golden-vector values, the dataset, vocabulary,
partitions, support matrix, feature policy, and the no-family-winner rule.

## Amendment 1 — pre-final-test authorization correction

Version 1.0 of this document was frozen at SHA-256
`cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f`. That hash is
**superseded pre-test** and is no longer the active preregistration identity. It is
named here rather than quietly replaced, so the amendment is auditable.

Independent review found two defects in the final-test opening protocol, both in the
*authorization* mechanism and neither in any analysis choice:

1. The unlock bound its identity checks to no model family, so an authorization
   obtained while holding the joint triplet carried no evidence of that fact and could
   be presented alongside the factorized artifacts.
2. The caller supplied both the identities it claimed and the identities it expected
   those to equal, which let the caller define its own trust root. The comparison
   proved only that the caller agreed with itself.

Both are corrected in the [final-test opening rule](#final-test-opening-rule) below.

**At the time of this amendment no sealed partition had been loaded and no final-test
prediction, logit, probability, or metric existed.** That is the only condition under
which amending a preregistration is admissible, and it is why this correction is
recorded as pre-test rather than as a post-hoc revision.

Changed: the final-test opening rule, the unlock contract version (1.0 → 2.0), and the
required-identity list, which now includes the model family and the per-family artifact
triplet. Unchanged: RQ1 and RQ2 wording, every primary and secondary metric, the ECE
binning, the coverage and risk targets, the bootstrap specification and seeds, the C
grid and selected C values, the temperature grid and fitted temperatures, the threshold
grid and selected thresholds, the dataset, vocabulary, partitions, support matrix,
feature policy, and the no-family-winner rule.

The machine-checkable form is `fc008-preregistration.json` in the artifact directory,
and its canonical SHA-256 is the freeze hash recorded in
`fc008-artifact-manifest.json`. This document and that file are generated from the
same constants in `futurebench.fc008.preregistration`, so they cannot disagree about
what was preregistered. Where a number appears in both, the JSON is authoritative.

## Why this document exists

Every decision below could otherwise be made after seeing results, and several of
them — the ECE bin count, the coverage grid, whether absent classes count toward
macro F1 — can move a headline number without anybody writing down that a choice was
made. Fixing them now means the Sprint-4 evaluation reports what was asked rather
than what turned out to be favourable.

## RQ1

> Does a factorized verb/object/transition logistic model improve structured
> exact-match performance on held-out application families relative to a joint flat
> semantic-tuple logistic classifier trained on the same observations and
> privacy-safe features?

Primary metrics, on **test-OOA**: structured exact-match; fixed-13-class macro F1;
the paired delta between joint and factorized.

Secondary context: macro F1 over only the classes observed in OOA, reported
**separately**. The fixed-13 figure is the preregistered primary and the observed-class
figure never substitutes for it. test-OOA contains only six of the thirteen classes,
so the observed-class number will look considerably better, and allowing a swap after
seeing both would be choosing the metric by its result.

RQ1 compares **complete systems**, not components.

### Required disclosure about transition property

All 13 `(verb, objectKind)` pairs in the V1 support set are unique. Transition
property therefore provides **no independent class discrimination** once verb and
object are known inside this frozen support set: given the pair, the property is
determined. Any difference measured between the families must not be attributed
specifically to transition factorization. The support matrix is not being changed to
alter this, because changing the class structure to produce a cleaner research story
is the failure mode the freeze exists to prevent.

## RQ2

> Does temperature scaling fitted without test labels improve probabilistic
> calibration and selective-prediction quality at matched coverage on held-out ID and
> OOA data?

Comparison: `T = 1` against the calibration-fitted `T`, with **model weights
unchanged**. That is what isolates the scaling: both arms are the same model.

Evaluated **separately** on test-ID and test-OOA. They are not combined into a single
primary result, because averaging an in-distribution set with an out-of-application
set produces a number that describes neither.

Primary metrics: negative log-likelihood; multiclass Brier score; fixed-bin expected
calibration error; AURC; risk at matched coverage; coverage at fixed risk; paired
scaled-versus-unscaled deltas.

## Frozen inputs

| Input | Value |
|---|---|
| dataset hash | `44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa` |
| vocabulary hash | `005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64` |
| Sprint-2 manifest hash | `aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77` |
| support-matrix version | `1.0` |
| feature-policy version | `1.0` |
| vocabulary features | 370, fitted on train only |

## Partition roles

| Partition | Role | Rows |
|---|---|---|
| train | vocabulary already fitted here; model weights only | 143 |
| calibration | temperature only | 143 |
| policy-validation | regularization selection and acceptance-threshold selection | 143 |
| test-ID | final reporting only | 143 |
| test-OOA | final reporting only | 66 |
| test-novelty | final reporting only | 28 |

The three test partitions were sealed throughout Sprint 3. The development export the
trainer consumes contains 429 rows and structurally cannot contain the others.

## Models

Both families consume the **same** dense float64 feature matrix over the frozen
370-feature vocabulary. No new feature fitting, no normalization or standardization,
no learned feature transforms.

Joint: multinomial logistic regression over the 13 supported tuples; L2; intercept
enabled; lbfgs; coefficients 13×370, intercepts 13.

Factorized: three heads — verb (10), objectKind (9), transitionProperty (10) — with
coefficients 10×370, 9×370, 10×370. The raw 10/9/10 head logits are preserved in the
artifact.

Class order is the canonical support-matrix order, external numbers 1 through 13,
persisted in every artifact and asserted against `classes_` rather than assumed.
scikit-learn sorts classes lexically, and depending on that sort agreeing with the
canonical order would be a silent dependency.

## Factorized composition

```
tupleLogit[k] = verbLogit[verb(k)] + objectLogit[object(k)] + transitionPropertyLogit[property(k)]
```

Additive independent-head log score, applied **before** normalization. The sum, not a
learned combiner: a trained composition layer would give the factorized family
capacity the joint family does not have, and the comparison would no longer be about
factorization. Composition version `1.0`; Sprint 4 ports this exact rule.

## Regularization

Candidate grid, identical for both families: **C ∈ {0.01, 0.1, 1.0, 10.0}**.

The factorized family trains all three heads at **one shared C**. A separate C per
head would be a 4× larger search space and would make any measured difference partly
an artifact of the search budget.

Weights are fitted on **train only**. C is selected on **policy-validation only**.
Calibration is not used to select C, and no test partition is used for anything.

After C is selected, weights are **not refit** on train+calibration or
train+policy-validation. Those partitions keep their distinct roles.

Selection ranking, predeclared: (1) higher structured exact-match on
policy-validation, (2) higher fixed-13-class macro F1 on policy-validation, (3)
smaller C as the final tie-break. The same ranking is used for both families, and for
the factorized family the structured prediction comes from the composition rule above.

`max_iter` is fixed at 5000 for every candidate. `ConvergenceWarning` is promoted to
an exception: weights left wherever the optimizer ran out of iterations are not
reproducible in any useful sense. The budget is not raised for whichever model looks
best.

## Temperature

One scalar per family, fitted on **calibration only**, weights untouched.

Deterministic grid: **401 log-spaced candidates over [0.1, 10.0] inclusive**,
symmetric about 1.0 and containing `T = 1` exactly. A fixed grid rather than an
adaptive optimizer, so the result does not depend on a library's convergence path and
ports to TypeScript unchanged. The no-op must be a reachable candidate, otherwise the
search could not decline to act.

Objective: multiclass negative log-likelihood on calibration. Tie-break: (1) lower
NLL, (2) temperature closest to 1.0, (3) smaller temperature.

**A boundary hit is a stop condition.** If the optimum were 0.1 or 10.0 the
preregistered range would be wrong, and expanding it after seeing test data is exactly
the post-hoc adjustment this document exists to prevent. The pipeline fails instead.

## Acceptance threshold

One calibrated-confidence threshold per family, selected on **policy-validation
only**, from the frozen grid 0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.65,
0.70, 0.75, 0.80, 0.85, 0.90, 0.95.

Top-two margin and normalized entropy remain **diagnostics**. Sprint 3 tunes exactly
one gate; three tuned gates on one 143-row partition would be three chances to overfit
it.

Minimum accepted support: `max(20 records, ceil(25% of partition))` = 36 rows here.
Without a floor the search would reliably pick a very high threshold that accepted
almost nothing and reported zero error.

Primary rule: among candidates meeting selective structured error ≤ 0.10 **and** the
minimum support, choose (1) highest coverage, (2) lower selective error, (3) lower
threshold. If no candidate meets the error constraint, fall back to candidates meeting
minimum support and choose (1) lowest selective error, (2) highest coverage, (3)
higher threshold. Whether the fallback ran is recorded in the policy artifact.

This is an **engineering development policy, not a statistical guarantee**. It does
not promise 90% real-world accuracy, or any accuracy on a different corpus.

The threshold applies only **after** the frozen deterministic gates — schema, version,
freshness, privacy, context, object support, tuple support, novelty/support — in the
established runtime precedence. Model confidence never replaces them.

## Metric definitions

**ECE**: 15 equal-width bins over [0, 1]. Fixed now; no adaptive binning chosen after
inspecting test data.

**Fixed-13 label universe**: labels are exactly 1..13 with `zero_division = 0`. Absent
classes are **not** dropped from the primary metric. Dropping them would inflate macro
F1 on precisely the partition that has fewest classes.

**Matched coverage**: reported at 25%, 50%, 75%, 100%, using the nearest achievable
empirical coverage without interpolation. Full empirical risk-coverage curves and AURC
are also reported.

**Fixed risk**: targets 5%, 10%, 20%; report the maximum coverage achieved at or below
each. Targets that cannot be achieved are reported as unavailable rather than omitted.

**Secondary**: per-field factorized accuracy, transition exact, test-ID structured
accuracy, ID→OOA gap, per-class precision/recall/F1, worst-class recall, confusion
matrix, observed-class OOA macro F1, novelty abstention recall, false abstention rate,
latency, artifact size.

## Bootstrap

5000 paired replicates. Resampling unit is **`parentLineageId` groups**, not individual
records: the 11 variants of one authored lineage are near-duplicates, and resampling
them independently would treat correlated siblings as independent evidence and produce
intervals far too narrow.

Paired model comparisons use the **same sampled parent groups** for both systems.

Percentile 95% confidence intervals. Bootstrap seed `202601040002`, namespaced away
from the training seed `20260104`.

**Power limitation.** test-OOA contains only six parent lineages. Intervals will be
wide and no high-powered inference is claimed from this holdout. A single held-out
synthetic application family cannot represent the space of real applications.

## Novelty reporting

Sprint 4 reports novelty abstention recall, false acceptance rate on novelty, and
false abstention rate on supported test data, using the already-frozen deterministic
support logic plus the model policy above. Nothing is tuned on test-novelty.

## Final-test opening rule

Corrected by amendments 1 and 2. Unlock contract version **3.0**.

Final evaluation may proceed only in explicit `final-evaluation` mode, **for one named
model family at a time**, with every identity matching the frozen value.

**Authorization is per family.** The registered families are `joint-logistic` and
`factorized-logistic`. An authorization names one family and that family's exact
model / calibration / policy SHA-256 triplet. A joint authorization can never
authorize factorized artifacts or the reverse, and every mixed-family triplet — joint
model with factorized calibration, factorized model with joint policy, and the rest —
is refused. The returned token is immutable and carries the verified family alongside
the verified triplet, so it cannot be detached from the artifacts that produced it;
`assert_authorization_matches_artifacts` re-checks it against whatever was actually
loaded at evaluation time, re-reading **every** bound identity including
`modelVersion`, `calibrationArtifactVersion`, and `abstentionPolicyVersion`. Nothing is
trusted because it was checked earlier: an earlier check is evidence about the artifacts
loaded then, not about the ones loaded now.

**Expectations come from repository state, not from the caller.** There is one canonical
artifact manifest, resolved from the unlock module's own file location — not from an
argument, the working directory, `sys.argv`, or an environment variable. The production
authorization function takes exactly three parameters (`mode`, `model_family`,
`actual`), so there is no parameter through which a caller could state what the
identities should be or redirect which manifest supplies them. A test asserts that
parameter set exactly, so a future parameter of any name that could carry a trust root
fails the build.

**The manifest is anchored outside itself.** Its bytes are hashed and compared to
`FROZEN_FC008_ARTIFACT_MANIFEST_SHA256`, a constant in version-controlled source. The
expected hash deliberately does not live in the manifest, because a file that carries
its own expected hash vouches for itself. Nothing recursive is introduced: the manifest
does not contain its own hash and the artifact hash DAG remains non-recursive.

**The manifest must agree with the artifact bodies.** `datasetHash`, `vocabularyHash`,
`supportMatrixVersion`, and `featurePolicyVersion` are cross-checked from the manifest
top level against all six frozen model, calibration, and policy bodies. Both directions
fail: editing the manifest to contradict the bodies, and editing a body to contradict
the manifest, even when the manifest's recorded file hash is repaired to match.
`preregistrationSha256` is deliberately not in that list — artifact bodies do not carry
it, and adding the field just to lengthen the list would be inventing a duplicate
identity rather than verifying an existing one.

The registry further validates the identity chain by content rather than by naming
convention: each file must declare the family it is registered under, the calibration
artifact must reference the model hash, the policy artifact must reference both, and the
version fields must agree wherever two artifacts carry the same one. No identity is
taken from a filename.

Bound identities: model family; model, calibration, and policy artifact SHA-256; model,
calibration-artifact, and abstention-policy versions; dataset hash; vocabulary hash;
support-matrix version; feature-policy version; preregistration SHA-256.

The gate is fail-closed and default-deny: a missing or empty identity is a refusal, an
unregistered family is a refusal, and the mode must be requested positively rather than
inferred. Refusal raises rather than returning a falsy value, because a caller who
ignored a return value would go on to read test data.

**Historical preregistrations are never active.** Superseded bytes are recorded under
the manifest's `auditHistory` section, which the authorization path does not search — it
resolves artifacts from the `artifacts` list only. A retained v1.0 or v1.1 document is
therefore structurally unreachable from an unlock rather than merely discouraged from
one, and the registry refuses outright if the active preregistration hash ever appears
among the audit-history entries.

**Trust boundary, stated plainly.** The contract pins the manifest bytes to a
source-held hash and verifies that the manifest, the artifact bodies, and the caller's
actuals all agree. So the claim is now twofold: a caller cannot substitute the trust
root, and a swapped or edited manifest is detected.

What it still cannot do is defend against an actor able to rewrite the source trust
anchor together with the artifacts — at that point the anchor moves with the attack.
That is repository integrity, enforced by version control and review, and no in-process
check can bootstrap it. The guarantee is about callers and files, not about commits.

It was **not invoked in Sprint 3**, and a test parses the trainer's syntax tree to
confirm no authorizing function is called or imported anywhere outside the unlock module.

## No model-family winner

Both families are preserved. Sprint 3 designates no product, runtime, or research
winner, and no such choice may be made from development results. ADR-016 remains
binding.

## Synthetic-data claim boundary

FutureBench V1 is entirely synthetic authored content. Every result describes
behaviour on this corpus only. Nothing here is evidence about real websites, real user
populations, or production accuracy.

## What this document does not contain

No final-test result, prediction, logit, probability, or metric. The process that
generated the machine-readable form never loaded a sealed partition.

# @futureclick/action-understanding

Inert PREDICTED action-understanding contracts, trust boundary, and runtime
policy for FutureClick (FC-008).

**Sprint 1 scope: contracts and policy only.** This package cannot predict
anything. Its default scoring provider always reports `unavailable`, so the only
reachable outcome in the default configuration is an operational failure.

Not in this package, by design: browser observation extraction, the sanitizer,
feature projection, model training, datasets, model artifacts, calibration
numerics, and any user-facing prediction.

## Install

Workspace-internal. Depends only on `@futureclick/action-schema` and
`@futureclick/shared`.

## Shape of the API

```ts
import {
  evaluateObservation,
  createNullScoringProvider,
  validateAbstentionPolicy,
  computeObservationInputFingerprint,
  FC008_SUPPORT_MATRIX,
  FC008_PRECEDENCE,
} from "@futureclick/action-understanding";

const result = evaluateObservation(untrustedInput, {
  policy,                  // thresholds you selected on policy-validation data
  provider,                // scores only; it is told no threshold and no budget
  calibrator,              // interface only in Sprint 1
  freshnessValidator,      // your current-state authority
  clock,                   // monotonic clock; latency is measured, not assumed
  artifact,                // validated artifact descriptor, or null
  vocabulary,              // fitted feature vocabulary, or null until Sprint 3
  now,
  idGenerator,
  researchMode: false,
});

switch (result.outcome) {
  case "hypothesis": break; // PREDICTED, one of 13 supported tuples
  case "abstained":  break; // epistemic: the system declined to commit
  case "failed":     break; // operational: the system did not work
}
```

## The four things worth knowing

**Layer B is the only model input.** Observation data has four layers. Only
`ObservationSemantics` is visible to a projector or a provider, enforced by the
function signature rather than by review. Site identity, object labels,
benchmark grouping, and oracle metadata are unreachable from the parameter type.

Layer D, the ephemeral display context holding human-readable labels, is **not a
field of `ActionObservation` at all**. The observation is the serializable
record, and a field on a serializable record that "must never be serialized" is
a convention waiting to break. Layer D therefore lives in its own module, the
observation validator rejects an input carrying it, and a display context throws
if anything tries to serialize it.

**Providers score; the runtime decides.** A provider returns raw scores and the
identity of the artifact that produced them, and nothing else. It receives two
version strings — no threshold, no budget, no policy. Version checks, artifact
and calibration identity checks, freshness checks, support assessment, deadline
enforcement, calibration, threshold application, and hypothesis construction all
belong to the runtime. Provider output is closed-shape validated, so a provider
cannot self-certify a result or report its own input support.

The score payload is a union over **both** planned model families — 13 joint
tuple logits, or 10 verb plus 9 object plus 10 transition logits — so the
Sprint 3 family decision needs no breaking change here. Sprint 1 accepts a
factorized payload and declines to compose it, because composing it honestly
needs Sprint 3 numerics.

**Class numbering is 1 through 13.** That is the canonical external identity used
by every document, report, and dataset record. The array index is 0 through 12,
and `classNumber = classIndex + 1`. There is no "class 0".

**Abstention and failure are different things.** `abstained` means the system
worked and declined. `failed` means the system did not work. They are
structurally separate types, and only the first participates in coverage and
selective-risk statistics. A crash, a timeout, and an unimplemented numeric path
are all operational; none is ever reported as model uncertainty. A failure
detail is a closed `{ stage, reason, measurement }` record with no free-text
field, so nothing page-derived or model-derived can leave through an error
path.

## Scripts

```
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit, includes the type-level security assertions
pnpm test       # vitest run
pnpm lint       # biome lint src tests
```

`pnpm typecheck` is load-bearing for security, not just for correctness. The
layer-separation and capability-absence invariants are asserted as type-level
tests, so widening the projector signature or adding a prohibited field to
`ObservationSemantics` is a **compile error**.

`pnpm test` is load-bearing for isolation. Dependencies, import specifiers, and
public exports are all closed allowlists, and the test suite additionally
compiles the package and inspects the **emitted JavaScript**, so adding a
dependency, an import, or an export is a deliberate edit rather than something
that can slip in.

## Documentation

- [`docs/architecture/ACTION_UNDERSTANDING.md`](../../docs/architecture/ACTION_UNDERSTANDING.md)
  — full architecture, the thirteen-tuple support matrix, the specificity oracle
  rule, the thirteen-step precedence ladder, the frozen AI-1 to AI-24 invariants
  with their PASS / PARTIAL / DEFERRED status, and the documented research
  process contracts.
- ADR-012 to ADR-016 in
  [`docs/architecture/DECISIONS.md`](../../docs/architecture/DECISIONS.md).

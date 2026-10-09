# Hybrid Intelligence (FC-009 Sprint 1)

`@futureclick/hybrid-intelligence` composes deterministic VERIFIED consequence claims with optional FC-008 PREDICTED hypotheses into one immutable evidence view.

This package is evidence composition only. It does not authorize execution, mutate ActionGraph, train a model, or redesign the browser UI.

FC-009 Sprint 1 composes VERIFIED and PREDICTED only. SIMULATED remains a distinct system evidence modality and is not consumed by hybrid policy 1.0.

## Modalities remain separate

- **VERIFIED** means a claim was derived deterministically under an explicit scope and assumptions. It is not universal certainty.
- **PREDICTED** means a learned hypothesis with calibrated uncertainty. It is never verification.
- Agreement does not promote a prediction. A high-confidence PREDICTED claim that matches a VERIFIED claim remains PREDICTED.
- Conflict is explicit. Neither side is overwritten or deleted.
- There is no fused confidence, averaged score, or "AI-confirmed verified" state.
- Schema 1.0 asserts at most one primary PREDICTED hypothesis. Alternatives are uncertainty context only. Multiple asserted predictions would require a later schema/policy version.

## Hybrid policy version

`FC009_HYBRID_POLICY_VERSION = "1.0"`

The policy covers claim identity, agreement, conflict, freshness, stale prediction, verified-evidence conflict, unknown incomparability, and epistemic precedence. It is not product tuning.

## Claim identity

Canonical identity is `property` + `before` + `after` on a semantic state transition, for example `repository.visibility: private → public`.

Identity excludes selectors, hostname, URL, fixture id, private object names, UI labels, and timestamps. A bare token such as `visibility` is invalid; the grammar requires a dotted semantic namespace.

## Relationships

Closed vocabulary: `AGREES`, `CONFLICTS`, `VERIFIED_ONLY`, `PREDICTION_ONLY`, `INCOMPARABLE`, `ABSTAINED_PREDICTION`, `PREDICTION_FAILED`, `VERIFIED_CONFLICT`, `PREDICTION_STALE`.

Each relationship identifies generic endpoints `leftClaim` / `rightClaim` with explicit `evidenceMode` and identity. VERIFIED↔VERIFIED and VERIFIED↔PREDICTED pairs both name both sides. Endpoint order and relationship-array order are canonical, so caller input order cannot change the semantic payload.

`unknown` state tokens are not comparable. Identical unknown transitions are `INCOMPARABLE`, never `AGREES` or `CONFLICTS`.

Exact duplicate VERIFIED assertions are semantically deduplicated before relationship computation. They do not conflict and do not duplicate relationship records.

`VERIFIED_ONLY` means the claim stands without a comparable active predicted claim and is not part of an unresolved `VERIFIED_CONFLICT`.

## Trust boundary

`scope` and `assumption.statement` are trusted already-sanitized canonical evidence supplied by the caller. FC-009 validates closed shape and length bounds only. It does not sanitize raw browser, page, or DOM text, and it never copies `consequence.summary` into hybrid scope.

## Authority distinction

- **Epistemic precedence:** VERIFIED dominates PREDICTED when a consumer needs a preferred factual basis.
- **Execution authority:** none. Hybrid agreement is not permission to click, submit, continue, approve, release, grant a capability, or dispatch a native event.

If two VERIFIED claims conflict, FC-009 emits `VERIFIED_CONFLICT` naming both claims and refuses authoritative simplification. A PREDICTED claim cannot break the tie.

"""The FC-008 research preregistration, frozen before the test sets are opened.

Every analysis decision that could otherwise be made after seeing results lives here:
the two research questions in their exact wording, the primary and secondary metrics,
the ECE binning, the coverage and risk targets, the bootstrap procedure, and the rule
for when final evaluation may run. Fixing the ECE bin count and the coverage grid in
advance is the whole point — both are choices where a post-hoc pick can move a result
without anyone writing down that a choice was made.

No final-test result appears here, and none can: the sealed partitions were never
loaded by the process that writes this file.
"""

from __future__ import annotations

from typing import Any

from .calibration import (
    TEMPERATURE_GRID_POINTS,
    TEMPERATURE_MAX,
    TEMPERATURE_MIN,
    TEMPERATURE_SEARCH_SPECIFICATION,
    TEMPERATURE_SEARCH_VERSION,
)
from .canonical import canonical_sha256
from .models import (
    C_GRID,
    COMPOSITION_SPECIFICATION,
    COMPOSITION_VERSION,
    MAX_ITER,
    RANDOM_SEED,
    SELECTION_RULE,
    SELECTION_RULE_VERSION,
    SOLVER,
)
from .policy import (
    CONFIDENCE_THRESHOLD_GRID,
    POLICY_SELECTION_RULE,
    POLICY_SELECTION_RULE_VERSION,
    SELECTIVE_ERROR_CONSTRAINT,
)
from .unlock import (
    CANONICAL_ARTIFACT_MANIFEST_PATH,
    REGISTERED_FAMILIES,
    REQUIRED_IDENTITIES,
    UNLOCK_CONTRACT_VERSION,
)

#: Bumped by amendment 2, the pre-final-test trust-anchor correction.
PREREGISTRATION_VERSION = "1.2"

#: The pre-review freeze hash, retained so amendment 1 is auditable rather than a
#: silent replacement. No longer the active preregistration identity.
SUPERSEDED_PREREGISTRATION_SHA256 = (
    "cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f"
)

#: The amendment-1 freeze hash, superseded in turn by amendment 2.
SUPERSEDED_V11_PREREGISTRATION_SHA256 = (
    "4b2cbbb1a9da3bb8479be5c517316762b0417210efe4bb5ca6f7ae290aec4b1c"
)

#: Where superseded preregistration bytes are retained, relative to the artifact root.
PREREGISTRATION_HISTORY_DIRECTORY = "history"

#: Retained superseded preregistrations, as frozen declarations rather than a directory
#: listing.
#:
#: Declared rather than discovered for two reasons. A scan of whatever happens to be in
#: the history directory would make the manifest depend on the filesystem, so a stray
#: file would silently change the manifest hash and break the trust anchor for a reason
#: unrelated to research state. And an expected hash recorded here is checkable: the
#: generator verifies the retained bytes still hash to these values and fails closed if
#: they do not, which is what makes the historical freeze hashes independently
#: recomputable rather than merely asserted.
PREREGISTRATION_HISTORY: tuple[dict[str, Any], ...] = (
    {
        "fileName": "fc008-preregistration-v1.0.json",
        "preregistrationVersion": "1.0",
        "sha256": SUPERSEDED_PREREGISTRATION_SHA256,
        "status": "superseded pre-final-test",
        "supersededByVersion": "1.1",
        "supersededByAmendment": 1,
        "active": False,
    },
    {
        "fileName": "fc008-preregistration-v1.1.json",
        "preregistrationVersion": "1.1",
        "sha256": SUPERSEDED_V11_PREREGISTRATION_SHA256,
        "status": "superseded pre-final-test",
        "supersededByVersion": "1.2",
        "supersededByAmendment": 2,
        "active": False,
    },
)

RQ1 = (
    "Does a factorized verb/object/transition logistic model improve structured "
    "exact-match performance on held-out application families relative to a joint "
    "flat semantic-tuple logistic classifier trained on the same observations and "
    "privacy-safe features?"
)

RQ2 = (
    "Does temperature scaling fitted without test labels improve probabilistic "
    "calibration and selective-prediction quality at matched coverage on held-out ID "
    "and OOA data?"
)

#: 15 equal-width bins over [0, 1], fixed now so binning cannot be chosen later.
ECE_BIN_COUNT = 15
ECE_BINNING = "equal-width"

#: Nearest achievable empirical coverage, no interpolation.
MATCHED_COVERAGE_TARGETS: tuple[float, ...] = (0.25, 0.50, 0.75, 1.00)

#: Report the maximum coverage achieved at or below each risk target.
FIXED_RISK_TARGETS: tuple[float, ...] = (0.05, 0.10, 0.20)

BOOTSTRAP_REPLICATES = 5000
#: Namespaced away from the training seed so resampling cannot interact with fitting.
BOOTSTRAP_SEED = 20260104_0002
BOOTSTRAP_UNIT = "parentLineageId"


def build_preregistration(
    *,
    dataset_hash: str,
    vocabulary_hash: str,
    manifest_hash: str,
    support_matrix_version: str,
    feature_policy_version: str,
    class_order: list[int],
    verb_order: list[str],
    object_order: list[str],
    transition_property_order: list[str],
    joint: dict[str, Any],
    factorized: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the machine-checkable preregistration document."""
    return {
        "preregistrationVersion": PREREGISTRATION_VERSION,
        "researchQuestions": {
            "RQ1": {
                "question": RQ1,
                "comparison": "complete systems, joint-logistic versus factorized-logistic",
                "primaryMetrics": [
                    "structured exact-match on test-OOA",
                    "fixed-13-class macro F1 on test-OOA",
                    "paired delta joint versus factorized",
                ],
                "secondaryContext": [
                    "observed-OOA-class macro F1, reported separately and never "
                    "substituted for the frozen fixed-13 metric"
                ],
                "transitionPropertyDisclosure": (
                    "All 13 (verb, objectKind) pairs in the V1 support set are unique. "
                    "Transition property therefore provides no independent class "
                    "discrimination once verb and object are known inside this frozen "
                    "support set. Any factorized difference must NOT be attributed "
                    "specifically to transition factorization."
                ),
            },
            "RQ2": {
                "question": RQ2,
                "comparison": ("T = 1 versus calibration-fitted T, with model weights unchanged"),
                "evaluatedSeparatelyOn": ["test-id", "test-ooa"],
                "combinedIdAndOoaPrimaryResult": False,
                "primaryMetrics": [
                    "negative log-likelihood",
                    "multiclass Brier score",
                    "fixed-bin expected calibration error",
                    "AURC",
                    "risk at matched coverage",
                    "coverage at fixed risk",
                    "paired scaled-versus-unscaled deltas",
                ],
            },
        },
        "frozenInputs": {
            "datasetHash": dataset_hash,
            "featurePolicyVersion": feature_policy_version,
            "manifestHash": manifest_hash,
            "supportMatrixVersion": support_matrix_version,
            "vocabularyFeatureCount": 370,
            "vocabularyHash": vocabulary_hash,
        },
        "partitionRoles": {
            "calibration": "temperature only",
            "policy-validation": (
                "regularization/hyperparameter selection and acceptance-threshold selection"
            ),
            "test-id": "final reporting only",
            "test-novelty": "final reporting only",
            "test-ooa": "final reporting only",
            "train": "vocabulary already fitted here; model weights only",
        },
        "modelDefinitions": {
            "classOrder": class_order,
            "factorized": factorized,
            "featureIdentity": {
                "featureCount": 370,
                "fittedOn": "train",
                "newFeatureFitting": False,
                "normalizationOrStandardization": False,
                "representation": "dense float64 over the frozen vocabulary index order",
                "sharedAcrossFamilies": True,
            },
            "joint": joint,
            "objectOrder": object_order,
            "transitionPropertyOrder": transition_property_order,
            "verbOrder": verb_order,
        },
        "regularization": {
            "candidateCValues": list(C_GRID),
            "factorizedUsesOneSharedC": True,
            "maxIter": MAX_ITER,
            "convergenceWarningTreatedAsFailure": True,
            "refitOnDevelopmentUnion": False,
            "selectionMetric": SELECTION_RULE,
            "selectionMetricVersion": SELECTION_RULE_VERSION,
            "selectionPartition": "policy-validation",
            "solver": SOLVER,
            "weightFittingPartition": "train",
        },
        "factorizedComposition": {
            "appliesBeforeNormalization": True,
            "compositionVersion": COMPOSITION_VERSION,
            "learnedCombiner": False,
            "specification": COMPOSITION_SPECIFICATION,
        },
        "temperatureProcedure": {
            "boundaryHitIsAStopCondition": True,
            "fittedOn": "calibration",
            "gridPoints": TEMPERATURE_GRID_POINTS,
            "objective": "multiclass negative log-likelihood",
            "range": [TEMPERATURE_MIN, TEMPERATURE_MAX],
            "specification": TEMPERATURE_SEARCH_SPECIFICATION,
            "temperatureSearchVersion": TEMPERATURE_SEARCH_VERSION,
            "weightsRefitted": False,
        },
        "thresholdProcedure": {
            "candidateThresholds": list(CONFIDENCE_THRESHOLD_GRID),
            "extraMarginOrEntropyGates": False,
            "marginAndEntropyAreDiagnostics": True,
            "minimumAcceptedSupport": "max(20 records, ceil(25% of partition))",
            "selectedOn": "policy-validation",
            "selectionRule": POLICY_SELECTION_RULE,
            "selectionRuleVersion": POLICY_SELECTION_RULE_VERSION,
            "selectiveErrorConstraint": SELECTIVE_ERROR_CONSTRAINT,
            "statisticalGuarantee": False,
        },
        "metricDefinitions": {
            "ece": {
                "binCount": ECE_BIN_COUNT,
                "binning": ECE_BINNING,
                "adaptiveBinningAfterTestInspection": False,
                "range": [0.0, 1.0],
            },
            "fixedRiskTargets": list(FIXED_RISK_TARGETS),
            "fixedRiskReporting": (
                "maximum coverage achieved at or below each risk target; targets that "
                "cannot be achieved are reported as unavailable rather than omitted"
            ),
            "fixedThirteenLabelUniverse": {
                "absentClassesDropped": False,
                "labels": list(range(1, 14)),
                "zeroDivision": 0,
            },
            "matchedCoverageTargets": list(MATCHED_COVERAGE_TARGETS),
            "matchedCoverageRule": (
                "nearest achievable empirical coverage without interpolation; full "
                "empirical risk-coverage curves and AURC also reported"
            ),
            "secondaryMetrics": [
                "per-field factorized accuracy",
                "transition exact",
                "test-ID structured accuracy",
                "ID to OOA gap",
                "per-class precision/recall/F1",
                "worst-class recall",
                "confusion matrix",
                "observed-class OOA macro F1",
                "novelty abstention recall",
                "false abstention rate",
                "latency",
                "artifact size",
            ],
        },
        "bootstrap": {
            "confidenceInterval": "percentile 95%",
            "pairedComparisonsUseIdenticalSampledGroups": True,
            "replicates": BOOTSTRAP_REPLICATES,
            "resamplingUnit": BOOTSTRAP_UNIT,
            "seed": BOOTSTRAP_SEED,
            "seedNamespacedFromTrainingSeed": True,
            "trainingSeed": RANDOM_SEED,
            "powerLimitation": (
                "test-OOA contains only six parent lineages; interval width will be "
                "large and no high-powered inference is claimed from this holdout"
            ),
        },
        "noveltyReporting": {
            "falseAbstentionRateOnSupportedTestData": True,
            "falseAcceptanceRateOnNovelty": True,
            "noveltyAbstentionRecall": True,
            "tunedOnNovelty": False,
            "usesFrozenDeterministicSupportPlusModelPolicy": True,
        },
        "finalTestOpeningRule": {
            "mode": "final-evaluation",
            "requiredIdentities": list(REQUIRED_IDENTITIES),
            "unlockContractVersion": UNLOCK_CONTRACT_VERSION,
            "failClosed": True,
            "authorizationScope": "per model family",
            "registeredFamilies": list(REGISTERED_FAMILIES),
            "trustedExpectationSource": (
                "one canonical artifact manifest, resolved from the unlock module's own "
                "location rather than from any argument, working directory, or "
                "environment variable; every artifact hash is re-derived from the bytes "
                "on disk; the caller supplies only the identities it actually loaded and "
                "has no parameter through which it could supply the expected values or "
                "redirect which manifest is read"
            ),
            "canonicalArtifactManifestPath": str(
                CANONICAL_ARTIFACT_MANIFEST_PATH.relative_to(
                    CANONICAL_ARTIFACT_MANIFEST_PATH.parents[2]
                )
            ),
            "manifestTrustAnchor": (
                "the canonical manifest bytes are hashed and compared to a SHA-256 "
                "constant held in version-controlled source, outside the manifest being "
                "verified, so the file cannot declare its own trustworthiness; a "
                "substituted but internally self-consistent manifest is refused"
            ),
            "manifestToArtifactBodyCrossChecks": [
                "datasetHash",
                "vocabularyHash",
                "supportMatrixVersion",
                "featurePolicyVersion",
            ],
            "manifestToArtifactBodyRule": (
                "each of these manifest top-level identities must equal the same field in "
                "all six frozen model/calibration/policy artifact bodies; a manifest that "
                "contradicts the artifacts it names is refused even when it is internally "
                "consistent and its recorded file hashes are correct"
            ),
            "familyBinding": (
                "an authorization names one model family and that family's exact "
                "model/calibration/policy SHA-256 triplet; an authorization obtained for "
                "one family can never authorize the other, and any mixed-family triplet "
                "is refused"
            ),
            "authorizationTokenImmutable": True,
            "reverificationAtEvaluationTime": (
                "assert_authorization_matches_artifacts re-checks the token against the "
                "artifacts actually loaded, so a token cannot be detached from the "
                "triplet that produced it; every material identity is re-read, including "
                "modelVersion, calibrationArtifactVersion, and abstentionPolicyVersion, "
                "none of which is trusted merely because it was checked at authorization"
            ),
            "reverifiedIdentities": list(REQUIRED_IDENTITIES),
            "trustBoundary": (
                "the contract pins the manifest bytes to a source-held hash and verifies "
                "that the manifest, the artifact bodies, and the caller's actuals all "
                "agree, so a caller cannot substitute the trust root and a swapped or "
                "edited manifest is detected; it still cannot defend against an actor "
                "able to rewrite the source trust anchor together with the artifacts, "
                "which is repository integrity enforced by version control and review "
                "rather than an in-process guarantee"
            ),
            "historicalArtifactsAreNeverActive": (
                "superseded preregistration bytes are retained under the audit-history "
                "section of the manifest, which the authorization path does not search; "
                "only the active preregistration identity can satisfy an unlock"
            ),
            "note": (
                "final evaluation may proceed only in explicit final-evaluation mode, for "
                "one named model family, with every listed identity matching the frozen "
                "value derived from repository state"
            ),
        },
        "amendments": [
            {
                "amendmentNumber": 1,
                "amendedVersion": "1.1",
                "supersededVersion": "1.0",
                "supersededPreregistrationSha256": SUPERSEDED_PREREGISTRATION_SHA256,
                "supersededStatus": "superseded pre-test",
                "stage": "pre-final-test",
                "trigger": "independent review of the Sprint-3 implementation",
                "reason": (
                    "the final-evaluation unlock checked identity values but bound them "
                    "to no model family, and accepted both the claimed and the expected "
                    "identities from the caller, which let the caller define its own "
                    "trust root; the corrected protocol is family-bound and derives "
                    "expectations from the checked-in artifact manifest"
                ),
                "scope": "authorization integrity only",
                "finalTestOutputsExistedBeforeAmendment": False,
                "sealedPartitionsOpenedBeforeAmendment": False,
                "changed": [
                    "finalTestOpeningRule: now per-family with a trusted registry",
                    "unlockContractVersion: 1.0 to 2.0",
                    "requiredIdentities: now includes modelFamily and the per-family "
                    "artifact triplet and version identities",
                ],
                "unchanged": [
                    "RQ1 wording",
                    "RQ2 wording",
                    "primary and secondary metric definitions",
                    "ECE binning",
                    "matched-coverage and fixed-risk targets",
                    "bootstrap specification and seeds",
                    "C candidate grid and selected C values",
                    "temperature grid and selected temperatures",
                    "threshold grid and selected thresholds",
                    "dataset, vocabulary, partitions, support matrix, feature policy",
                    "no-family-winner rule",
                ],
                "note": (
                    "recorded rather than silently replaced: the superseded hash is "
                    "named above so the amendment is auditable, and it is no longer the "
                    "active preregistration identity"
                ),
            },
            {
                "amendmentNumber": 2,
                "amendedVersion": "1.2",
                "supersededVersion": "1.1",
                "supersededPreregistrationSha256": SUPERSEDED_V11_PREREGISTRATION_SHA256,
                "supersededStatus": "superseded pre-test",
                "stage": "pre-final-test",
                "trigger": "second independent review of the Sprint-3 implementation",
                "reason": (
                    "amendment 1 moved the expected identities out of the caller's hands "
                    "but left the trust root reachable: the manifest path was still a "
                    "parameter, the manifest bytes were never compared to anything "
                    "outside the manifest, and the manifest's top-level dataset, "
                    "vocabulary, support-matrix, and feature-policy identities were never "
                    "cross-checked against the artifact bodies, so a self-consistent "
                    "substituted manifest could build a registry and authorize"
                ),
                "scope": "authorization integrity only",
                "finalTestOutputsExistedBeforeAmendment": False,
                "sealedPartitionsOpenedBeforeAmendment": False,
                "changed": [
                    "finalTestOpeningRule: the manifest is now resolved from the unlock "
                    "module's own location and the production authorization API accepts "
                    "no manifest path and no caller-supplied frozen identity",
                    "finalTestOpeningRule: the canonical manifest bytes are now pinned to "
                    "a SHA-256 trust anchor held in version-controlled source",
                    "finalTestOpeningRule: manifest top-level shared identities are now "
                    "cross-checked against all six frozen artifact bodies",
                    "finalTestOpeningRule: trustBoundary restated, because the previous "
                    "wording said the manifest itself could not be certified and the "
                    "manifest bytes are now verified against an external anchor",
                    "reverificationAtEvaluationTime: the token now carries and re-checks "
                    "modelVersion, calibrationArtifactVersion, and abstentionPolicyVersion",
                    "unlockContractVersion: 2.0 to 3.0",
                ],
                "unchanged": [
                    "RQ1 wording",
                    "RQ2 wording",
                    "primary and secondary metric definitions",
                    "ECE binning",
                    "matched-coverage and fixed-risk targets",
                    "bootstrap specification and seeds",
                    "C candidate grid and selected C values",
                    "temperature grid and selected temperatures",
                    "threshold grid and selected thresholds",
                    "model coefficients, intercepts, and golden-vector values",
                    "dataset, vocabulary, partitions, support matrix, feature policy",
                    "no-family-winner rule",
                ],
                "note": (
                    "amended because the preregistration is the authoritative statement "
                    "of the final-test opening rule and that rule materially changed; "
                    "v1.1's declared trust boundary asserted the manifest could not be "
                    "certified, which is no longer the implemented protocol, so leaving "
                    "v1.1 active would have left the preregistration understating the "
                    "gate; the retained v1.1 bytes let its freeze hash be recomputed"
                ),
            },
        ],
        "preregistrationHistory": {
            "directory": PREREGISTRATION_HISTORY_DIRECTORY,
            "note": (
                "canonical bytes of every superseded preregistration are retained so each "
                "historical freeze hash can be recomputed independently rather than taken "
                "on trust; these files are historical evidence and are never a valid "
                "active identity for final-evaluation authorization"
            ),
            "retained": [dict(record) for record in PREREGISTRATION_HISTORY],
        },
        "noFamilyWinnerRule": (
            "both joint-logistic and factorized-logistic are preserved; no product, "
            "runtime, or research winner is selected from Sprint-3 development "
            "results, and ADR-016 remains binding"
        ),
        "ooaLimitations": [
            "test-OOA contains 66 records from 6 parent lineages in one application family",
            "only six of the thirteen classes are observed in test-OOA",
            "one held-out application family cannot represent the space of real applications",
        ],
        "syntheticDataClaimBoundary": (
            "FutureBench V1 is entirely synthetic authored content. Results describe "
            "behaviour on this corpus only and are not evidence about real websites, "
            "real user populations, or production accuracy."
        ),
        "finalTestResultsPresent": False,
    }


def preregistration_sha256(document: dict[str, Any]) -> str:
    """Freeze hash over the canonical preregistration bytes."""
    return canonical_sha256(document)

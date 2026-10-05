"""Canonical JSON artifact assembly.

NO PICKLE, NO JOBLIB, NO .npy

The product artifact is portable canonical JSON. Pickle and joblib are Python object
graphs: they cannot be loaded by the TypeScript runtime that has to consume these
weights, they are not stable across library versions, and unpickling is arbitrary code
execution. A ``.npy`` blob would at least be portable but would hide the class order
and feature order inside a shape, and those orders are the part most likely to be got
wrong silently.

NO SELF-HASH

An artifact cannot contain the hash of its own bytes. So the model artifact carries
its identity fields and the hash is computed over the serialized bytes afterwards,
then recorded in the calibration artifact, the policy artifact, and the manifest. That
makes the dependency direction explicit: calibration references a specific model, not
a filename.

NO WALL-CLOCK TIME

A generation timestamp in canonical bytes would change the hash on every run and make
determinism unverifiable. Nothing here records when it ran.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .corpus import DevelopmentCorpus
    from .environment import ReferenceEnvironment
    from .models import FactorizedModel, JointModel, SelectionOutcome

from .calibration import CALIBRATION_ARTIFACT_VERSION, TemperatureFit
from .canonical import canonical_bytes, sha256_hex, to_float_matrix, to_float_vector
from .models import (
    C_GRID,
    COMPOSITION_SPECIFICATION,
    COMPOSITION_VERSION,
    FACTORIZED_FAMILY,
    FIT_INTERCEPT,
    JOINT_FAMILY,
    L1_RATIO,
    MAX_ITER,
    MODEL_VERSION,
    PENALTY,
    RANDOM_SEED,
    SELECTION_RULE,
    SELECTION_RULE_VERSION,
    SOLVER,
    TOLERANCE,
)
from .policy import (
    ABSTENTION_POLICY_VERSION,
    CONFIDENCE_THRESHOLD_GRID,
    POLICY_SELECTION_RULE,
    POLICY_SELECTION_RULE_VERSION,
    SELECTIVE_ERROR_CONSTRAINT,
    ThresholdSelection,
)

MODEL_ARTIFACT_SCHEMA_VERSION = "1.0"
POLICY_ARTIFACT_VERSION = "1.0"
MANIFEST_SCHEMA_VERSION = "1.0"

#: Hard ceiling per artifact.
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024


class ArtifactTooLarge(RuntimeError):
    """Raised when a serialized artifact exceeds the 2 MB ceiling."""


@dataclass(frozen=True)
class WrittenArtifact:
    name: str
    path: Path
    sha256: str
    byte_length: int


def write_artifact(path: Path, document: Any, name: str) -> WrittenArtifact:
    """Serialize, enforce the size ceiling, write, and report the exact hash."""
    payload = canonical_bytes(document)
    if len(payload) > MAX_ARTIFACT_BYTES:
        raise ArtifactTooLarge(
            f"{name} is {len(payload)} bytes, over the {MAX_ARTIFACT_BYTES} byte ceiling"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return WrittenArtifact(
        name=name, path=path, sha256=sha256_hex(payload), byte_length=len(payload)
    )


def _shared_identity(
    corpus: DevelopmentCorpus, environment: ReferenceEnvironment
) -> dict[str, Any]:
    return {
        "datasetHash": corpus.dataset_hash,
        "featurePolicyVersion": corpus.feature_policy_version,
        "manifestHash": corpus.manifest_hash,
        "projectorVersion": corpus.projector_version,
        "referenceEnvironment": environment.to_canonical(),
        "supportMatrixVersion": corpus.support_matrix_version,
        "vocabularyHash": corpus.vocabulary_hash,
        "vocabularyVersion": corpus.vocabulary_version,
    }


def _solver_configuration(selected_c: float) -> dict[str, Any]:
    return {
        "candidateCValues": list(C_GRID),
        "fitIntercept": FIT_INTERCEPT,
        "l1Ratio": L1_RATIO,
        "maxIter": MAX_ITER,
        "penalty": PENALTY,
        "penaltySpelling": (
            "L2 expressed as l1_ratio=0.0; scikit-learn 1.8 deprecated penalty='l2' "
            "in favour of the unified elastic-net parameter without changing the "
            "regularizer"
        ),
        "randomSeed": RANDOM_SEED,
        "selectedC": selected_c,
        "solver": SOLVER,
        "tolerance": TOLERANCE,
    }


def build_joint_model_artifact(
    corpus: DevelopmentCorpus,
    model: JointModel,
    selection: SelectionOutcome,
    environment: ReferenceEnvironment,
) -> dict[str, Any]:
    return {
        **_shared_identity(corpus, environment),
        "classOrder": list(corpus.class_numbers),
        "coefficients": to_float_matrix(model.coefficients),
        "featureOrder": list(corpus.feature_order),
        "intercepts": to_float_vector(model.intercepts),
        "modelFamily": JOINT_FAMILY,
        "modelVersion": MODEL_VERSION,
        "schemaVersion": MODEL_ARTIFACT_SCHEMA_VERSION,
        "shape": {
            "coefficients": [len(corpus.class_numbers), len(corpus.feature_order)],
            "intercepts": [len(corpus.class_numbers)],
        },
        "solverConfiguration": _solver_configuration(model.c_value),
        "trainingPartitionDeclaration": {
            "weightsFittedOn": [selection.weight_partition],
            "refitOnDevelopmentUnion": False,
            "selectedOn": selection.selection_partition,
            "note": (
                "weights are TRAIN only; calibration and policy-validation retain "
                "their distinct roles and are never used to fit weights"
            ),
        },
    }


def build_factorized_model_artifact(
    corpus: DevelopmentCorpus,
    model: FactorizedModel,
    selection: SelectionOutcome,
    environment: ReferenceEnvironment,
) -> dict[str, Any]:
    feature_count = len(corpus.feature_order)
    return {
        **_shared_identity(corpus, environment),
        "classOrder": list(corpus.class_numbers),
        "composition": {
            "appliesBeforeNormalization": True,
            "classOrderHeadIndices": [
                {
                    "classNumber": int(entry["classNumber"]),
                    "objectIndex": int(entry["objectIndex"]),
                    "transitionPropertyIndex": int(entry["transitionPropertyIndex"]),
                    "verbIndex": int(entry["verbIndex"]),
                }
                for entry in corpus.class_order
            ],
            "compositionVersion": COMPOSITION_VERSION,
            "learnedCombiner": False,
            "specification": COMPOSITION_SPECIFICATION,
        },
        "featureOrder": list(corpus.feature_order),
        "heads": {
            "objectKind": {
                "classOrder": list(corpus.object_order),
                "coefficients": to_float_matrix(model.object_coefficients),
                "intercepts": to_float_vector(model.object_intercepts),
                "shape": [len(corpus.object_order), feature_count],
            },
            "transitionProperty": {
                "classOrder": list(corpus.transition_property_order),
                "coefficients": to_float_matrix(model.property_coefficients),
                "intercepts": to_float_vector(model.property_intercepts),
                "shape": [len(corpus.transition_property_order), feature_count],
            },
            "verb": {
                "classOrder": list(corpus.verb_order),
                "coefficients": to_float_matrix(model.verb_coefficients),
                "intercepts": to_float_vector(model.verb_intercepts),
                "shape": [len(corpus.verb_order), feature_count],
            },
        },
        "modelFamily": FACTORIZED_FAMILY,
        "modelVersion": MODEL_VERSION,
        "schemaVersion": MODEL_ARTIFACT_SCHEMA_VERSION,
        "sharedRegularization": {
            "oneSharedCAcrossHeads": True,
            "note": (
                "a single C trains all three heads so the factorized family does not "
                "receive a larger search budget than the joint family"
            ),
        },
        "solverConfiguration": _solver_configuration(model.c_value),
        "trainingPartitionDeclaration": {
            "weightsFittedOn": [selection.weight_partition],
            "refitOnDevelopmentUnion": False,
            "selectedOn": selection.selection_partition,
            "note": (
                "weights are TRAIN only; calibration and policy-validation retain "
                "their distinct roles and are never used to fit weights"
            ),
        },
    }


def build_calibration_artifact(
    corpus: DevelopmentCorpus,
    *,
    model_family: str,
    model_artifact_sha256: str,
    fit: TemperatureFit,
    calibration_record_count: int,
) -> dict[str, Any]:
    return {
        "calibrationArtifactVersion": CALIBRATION_ARTIFACT_VERSION,
        "calibrationPartition": "calibration",
        "calibrationRecordCount": calibration_record_count,
        "datasetHash": corpus.dataset_hash,
        "featurePolicyVersion": corpus.feature_policy_version,
        "modelArtifactSha256": model_artifact_sha256,
        "modelFamily": model_family,
        "modelVersion": MODEL_VERSION,
        "schemaVersion": MODEL_ARTIFACT_SCHEMA_VERSION,
        "supportMatrixVersion": corpus.support_matrix_version,
        "temperatureFit": fit.to_canonical(),
        "testAccess": {
            "sealedPartitionsRead": [],
            "note": (
                "temperature is fitted on the calibration partition only; no "
                "policy-validation label and no sealed-partition label participates"
            ),
        },
        "vocabularyHash": corpus.vocabulary_hash,
    }


def build_policy_artifact(
    corpus: DevelopmentCorpus,
    *,
    model_family: str,
    model_artifact_sha256: str,
    calibration_artifact_sha256: str,
    selection: ThresholdSelection,
) -> dict[str, Any]:
    return {
        "abstentionPolicyVersion": ABSTENTION_POLICY_VERSION,
        "calibrationArtifactSha256": calibration_artifact_sha256,
        "calibrationArtifactVersion": CALIBRATION_ARTIFACT_VERSION,
        "candidateThresholds": list(CONFIDENCE_THRESHOLD_GRID),
        "datasetHash": corpus.dataset_hash,
        "developmentMetrics": {
            "metricPartition": "policy-validation",
            "metricKind": "DEVELOPMENT / POLICY-VALIDATION selection metrics",
            "note": "these are development selection metrics and are not test performance",
            "acceptedCount": selection.accepted,
            "coverage": selection.coverage,
            "selectiveStructuredError": selection.selective_error,
        },
        "featurePolicyVersion": corpus.feature_policy_version,
        "fallbackUsed": selection.fallback_used,
        "guaranteeDisclaimer": (
            "engineering development policy selected on a 143-row synthetic partition; "
            "not a statistical guarantee of real-world accuracy"
        ),
        "minimumAcceptedRequirement": {
            "absoluteFloor": 20,
            "fractionOfPartition": 0.25,
            "resolvedMinimum": selection.minimum_required,
        },
        "modelArtifactSha256": model_artifact_sha256,
        "modelFamily": model_family,
        "modelVersion": MODEL_VERSION,
        "policyArtifactVersion": POLICY_ARTIFACT_VERSION,
        "policyValidationPartition": "policy-validation",
        "runtimePrecedenceNote": (
            "the confidence threshold applies only after the frozen deterministic "
            "gates: schema, version, freshness, privacy, context, object support, "
            "tuple support, and novelty/support"
        ),
        "schemaVersion": MODEL_ARTIFACT_SCHEMA_VERSION,
        "selectedConfidenceThreshold": selection.threshold,
        "selectionRule": POLICY_SELECTION_RULE,
        "selectionRuleVersion": POLICY_SELECTION_RULE_VERSION,
        "selectiveErrorConstraint": SELECTIVE_ERROR_CONSTRAINT,
        "supportMatrixVersion": corpus.support_matrix_version,
        "thresholdCandidates": [candidate.to_canonical() for candidate in selection.candidates],
        "vocabularyHash": corpus.vocabulary_hash,
    }


def build_training_configuration(
    corpus: DevelopmentCorpus,
    environment: ReferenceEnvironment,
    joint_selection: SelectionOutcome,
    factorized_selection: SelectionOutcome,
    joint_train_metrics: dict[str, float],
    factorized_train_metrics: dict[str, float],
) -> dict[str, Any]:
    """The development record: what was searched, what was selected, and on what."""
    return {
        **_shared_identity(corpus, environment),
        "candidateCValues": list(C_GRID),
        "developmentMetricDisclaimer": (
            "TRAIN and POLICY-VALIDATION metrics are development measurements on a "
            "synthetic corpus; they are not generalization evidence and no partition "
            "is combined with another"
        ),
        "families": {
            FACTORIZED_FAMILY: {
                "candidates": [
                    {
                        "c": candidate.c_value,
                        "policyValidationFixedThirteenMacroF1": (candidate.fixed_thirteen_macro_f1),
                        "policyValidationStructuredExactMatch": (candidate.structured_exact_match),
                    }
                    for candidate in factorized_selection.candidates
                ],
                "oneSharedCAcrossHeads": True,
                "selectedC": factorized_selection.selected_c,
                "tieBreakUsed": factorized_selection.tie_break_used,
                "trainMetrics": factorized_train_metrics,
            },
            JOINT_FAMILY: {
                "candidates": [
                    {
                        "c": candidate.c_value,
                        "policyValidationFixedThirteenMacroF1": (candidate.fixed_thirteen_macro_f1),
                        "policyValidationStructuredExactMatch": (candidate.structured_exact_match),
                    }
                    for candidate in joint_selection.candidates
                ],
                "selectedC": joint_selection.selected_c,
                "tieBreakUsed": joint_selection.tie_break_used,
                "trainMetrics": joint_train_metrics,
            },
        },
        "noFamilyWinner": (
            "both families are preserved; Sprint 3 does not designate a product, "
            "runtime, or research winner (ADR-016 remains binding)"
        ),
        "randomSeed": RANDOM_SEED,
        "schemaVersion": MODEL_ARTIFACT_SCHEMA_VERSION,
        "selectionPartition": "policy-validation",
        "selectionRule": SELECTION_RULE,
        "selectionRuleVersion": SELECTION_RULE_VERSION,
        "weightFittingPartition": "train",
    }


def build_artifact_manifest(
    corpus: DevelopmentCorpus,
    environment: ReferenceEnvironment,
    artifacts: list[WrittenArtifact],
    preregistration_sha256: str,
    audit_history: tuple[dict[str, Any], ...],
) -> dict[str, Any]:
    """Assemble the manifest.

    ``auditHistory`` is kept strictly out of the ``artifacts`` list. Authorization
    resolves artifacts by searching that list only, so a superseded preregistration
    recorded here is structurally unreachable from the unlock path rather than merely
    discouraged from it. Historical evidence and active authorization identity are two
    different things and share no lookup.
    """
    return {
        **_shared_identity(corpus, environment),
        "auditHistory": [dict(record) for record in audit_history],
        "auditHistoryNote": (
            "retained canonical bytes of superseded preregistrations, kept so a historical "
            "freeze hash can be independently recomputed; recorded for audit reproducibility "
            "only and never consulted when authorizing final evaluation"
        ),
        "artifacts": [
            {
                "byteLength": artifact.byte_length,
                "fileName": artifact.path.name,
                "name": artifact.name,
                "sha256": artifact.sha256,
            }
            for artifact in sorted(artifacts, key=lambda item: item.name)
        ],
        "developmentExportSha256": corpus.source_sha256,
        "maxArtifactBytes": MAX_ARTIFACT_BYTES,
        "preregistrationSha256": preregistration_sha256,
        "reproducibilityClaim": {
            "referenceEnvironment": "byte-identical artifacts expected",
            "otherEnvironments": (
                "same class order, feature order, and semantic predictions expected; "
                "numeric values checked within tolerance in Sprint 4"
            ),
            "crossPlatformBitwiseEquality": False,
        },
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "sprint2DatasetHash": corpus.dataset_hash,
        "sprint2ManifestHash": corpus.manifest_hash,
        "sprint2VocabularyHash": corpus.vocabulary_hash,
    }

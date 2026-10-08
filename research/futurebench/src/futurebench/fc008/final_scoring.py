"""Production scoring and result persistence for the FC-008 one-shot evaluator.

Predictions are derived internally from a ``ValidatedSealedCorpus`` plus
authenticated frozen artifacts. Callers cannot inject logits, probabilities,
thresholds, or metrics.

This module is exercised on fixture corpora and synthetic artifact bundles.
It must not be pointed at the real sealed partitions during Sprint 4 A3.
"""

from __future__ import annotations

import inspect
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

from .bootstrap import OOA_POWER_LIMITATION
from .calibration import apply_temperature, confidence_diagnostics, stable_softmax
from .canonical import canonical_bytes, sha256_hex
from .evaluation import (
    AuthorizationSet,
    ComparisonResult,
    EvaluationResult,
    EvaluationRow,
    PartitionMetrics,
    SystemPredictions,
    build_evaluation_result,
    compare_rq1,
    compare_rq2,
    concatenate_system_predictions,
    evaluate_novelty,
    evaluate_system,
    evaluation_rows_from_corpus,
)
from .models import FACTORIZED_FAMILY, JOINT_FAMILY, FactorizedModel, JointModel
from .sealed import (
    FEATURE_DIMENSION,
    FROZEN_CLASS_HEADS,
    ValidatedSealedCorpus,
)
from .unlock import (
    CANONICAL_ARTIFACT_DIRECTORY,
    CANONICAL_ARTIFACT_HISTORY_DIRECTORY,
    CANONICAL_ARTIFACT_MANIFEST_PATH,
)

FROZEN_JOINT_MODEL_SHA256 = "d30aceb684901bf42b8267719dc20e5319ef35b8603eb7781f50ce486c9d4194"
FROZEN_JOINT_CALIBRATION_SHA256 = "5d5d99b6f085501de1f83371b3cae08117f8b281b0babc5bf6ae0eb96b1fe8b5"
FROZEN_JOINT_POLICY_SHA256 = "b3ea74e93bc311fd1025857db8dc6d715e188e7f7dbfbd2d6d377bf3f9b3ecb7"
FROZEN_FACTORIZED_MODEL_SHA256 = "b2713475a86cd52d6703acbdacae7bb49814b77f1277f4021038cb5f53dbdb8f"
FROZEN_FACTORIZED_CALIBRATION_SHA256 = (
    "9c985d623d29042cd5b7112c9edec80db786e056ac38a056294b1347924de359"
)
FROZEN_FACTORIZED_POLICY_SHA256 = "89609abe1930e31268e14365d764ec95a6723e869fee6d975ebbf8ac014276c0"
FROZEN_JOINT_TEMPERATURE = 0.8035261221856173
FROZEN_FACTORIZED_TEMPERATURE = 1.4791083881682072
FROZEN_JOINT_THRESHOLD = 0.4
FROZEN_FACTORIZED_THRESHOLD = 0.65
FROZEN_CLASS_ORDER: tuple[int, ...] = tuple(range(1, 14))

ID_PARTITIONS = frozenset({"test-id", "fixture-id"})
OOA_PARTITIONS = frozenset({"test-ooa", "fixture-ooa"})
NOVELTY_PARTITIONS = frozenset({"test-novelty", "fixture-novelty"})

_DEVELOPMENT_CORPUS_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "fc008-development-corpus.json"
)
_SEALED_CORPUS_PATH = Path(__file__).resolve().parents[3] / "data" / "fc008-final-test-corpus.json"

_SCORING_CALLS = 0


class OutputPathRefused(RuntimeError):
    """The requested result path is missing, unsafe, or would overwrite a freeze."""


class ArtifactIdentityMismatch(RuntimeError):
    """Authorized artifact identity does not match the loaded scoring bundle."""


class ScoringInputError(RuntimeError):
    """The validated corpus or scoring bundle is not usable."""


class HoldoutOpenedError(RuntimeError):
    """Scoring or persistence failed after a sealed corpus had already been built."""


class _TupleLogitModel(Protocol):
    def tuple_logits(self, design: Any) -> Any: ...


@dataclass(frozen=True)
class FamilyScoringBundle:
    """Authenticated weights, temperature, and policy for one model family."""

    model_family: str
    model: JointModel | FactorizedModel
    model_artifact_sha256: str
    calibration_artifact_sha256: str
    policy_artifact_sha256: str
    temperature: float
    threshold: float
    fallback_used: bool


@dataclass(frozen=True)
class AuthorizedScoringArtifacts:
    """Both families' scoring bundles, bound before any inference."""

    joint: FamilyScoringBundle
    factorized: FamilyScoringBundle
    class_order: tuple[int, ...]
    feature_dimension: int


def scoring_call_count() -> int:
    return _SCORING_CALLS


def _require_closed_signature(function: Any, expected: set[str], name: str) -> None:
    parameters = set(inspect.signature(function).parameters)
    if parameters != expected:
        raise ScoringInputError(f"{name} signature drifted")


def design_from_rows(
    rows: Sequence[EvaluationRow], *, feature_dimension: int = FEATURE_DIMENSION
) -> Any:
    """Dense float64 design matrix over the frozen feature index order."""
    import numpy as np

    design = np.zeros((len(rows), feature_dimension), dtype=np.float64)
    for position, row in enumerate(rows):
        for index, value in zip(row.feature_indices, row.feature_values, strict=True):
            if 0 <= index < feature_dimension:
                design[position, index] = value
    return design


def score_family_on_rows(
    *,
    bundle: FamilyScoringBundle,
    rows: Sequence[EvaluationRow],
    class_order: tuple[int, ...] = FROZEN_CLASS_ORDER,
    feature_dimension: int = FEATURE_DIMENSION,
) -> tuple[SystemPredictions, SystemPredictions]:
    """Score one family at T=1 and at the frozen calibrated temperature.

    Acceptance uses that system's own confidence against the frozen threshold.
    RQ1/RQ2 metrics consume the full predicted distribution regardless.
    """
    global _SCORING_CALLS
    _SCORING_CALLS += 1
    if len(rows) == 0:
        raise ScoringInputError("cannot score an empty partition")
    import numpy as np

    design = design_from_rows(rows, feature_dimension=feature_dimension)
    raw = bundle.model.tuple_logits(design)
    if raw.shape != (len(rows), len(class_order)):
        raise ScoringInputError("model logits are not the frozen 13-class tuple")

    def one_setting(setting: str, temperature: float) -> SystemPredictions:
        scaled = apply_temperature(raw, temperature)
        probabilities = stable_softmax(scaled)
        confidence, _margin, _entropy = confidence_diagnostics(probabilities)
        selected = np.argmax(probabilities, axis=1)
        predicted = tuple(int(class_order[int(index)]) for index in selected)
        accepted = tuple(bool(value >= bundle.threshold) for value in confidence)
        return SystemPredictions(
            model_family=bundle.model_family,
            temperature_setting=setting,
            temperature=float(temperature),
            predicted_classes=predicted,
            probabilities=tuple(tuple(float(cell) for cell in row) for row in probabilities),
            confidences=tuple(float(value) for value in confidence),
            accepted=accepted,
        )

    return one_setting("unscaled", 1.0), one_setting("scaled", bundle.temperature)


def _partition_role(partitions: Sequence[str], aliases: frozenset[str], role: str) -> str:
    matched = [name for name in partitions if name in aliases]
    if len(matched) != 1:
        raise ScoringInputError(f"validated corpus must contain exactly one {role} partition")
    return matched[0]


def _assert_artifacts_match_authorization(
    authorization: AuthorizationSet,
    artifacts: AuthorizedScoringArtifacts,
    *,
    production_corpus: bool,
) -> None:
    for family, bundle in (
        (JOINT_FAMILY, artifacts.joint),
        (FACTORIZED_FAMILY, artifacts.factorized),
    ):
        authorized = authorization.for_family(family)
        if bundle.model_family != family:
            raise ArtifactIdentityMismatch("scoring bundle family disagreed with authorization")
        if bundle.model_artifact_sha256 != authorized.model_artifact_sha256:
            raise ArtifactIdentityMismatch("model artifact identity disagrees with authorization")
        if bundle.calibration_artifact_sha256 != authorized.calibration_artifact_sha256:
            raise ArtifactIdentityMismatch(
                "calibration artifact identity disagrees with authorization"
            )
        if bundle.policy_artifact_sha256 != authorized.policy_artifact_sha256:
            raise ArtifactIdentityMismatch("policy artifact identity disagrees with authorization")
    if artifacts.class_order != FROZEN_CLASS_ORDER:
        raise ArtifactIdentityMismatch("scoring class order is not the frozen 1..13 universe")
    if artifacts.feature_dimension != FEATURE_DIMENSION:
        raise ArtifactIdentityMismatch("scoring feature dimension is not the frozen 370")
    if production_corpus:
        expected = {
            JOINT_FAMILY: (
                FROZEN_JOINT_MODEL_SHA256,
                FROZEN_JOINT_CALIBRATION_SHA256,
                FROZEN_JOINT_POLICY_SHA256,
            ),
            FACTORIZED_FAMILY: (
                FROZEN_FACTORIZED_MODEL_SHA256,
                FROZEN_FACTORIZED_CALIBRATION_SHA256,
                FROZEN_FACTORIZED_POLICY_SHA256,
            ),
        }
        for family, bundle in (
            (JOINT_FAMILY, artifacts.joint),
            (FACTORIZED_FAMILY, artifacts.factorized),
        ):
            model_sha, calibration_sha, policy_sha = expected[family]
            if (
                bundle.model_artifact_sha256 != model_sha
                or bundle.calibration_artifact_sha256 != calibration_sha
                or bundle.policy_artifact_sha256 != policy_sha
            ):
                raise ArtifactIdentityMismatch(
                    "production scoring refuses any artifact other than the frozen pair"
                )


def evaluate_final_validated_corpus(
    *,
    authorization: AuthorizationSet,
    corpus: ValidatedSealedCorpus,
    artifacts: AuthorizedScoringArtifacts,
) -> EvaluationResult:
    """Score both families on one validated corpus and assemble the final result.

    No caller predictions, logits, probabilities, thresholds, or metrics are accepted.
    """
    _require_closed_signature(
        evaluate_final_validated_corpus,
        {"authorization", "corpus", "artifacts"},
        "evaluate_final_validated_corpus",
    )
    if type(corpus) is not ValidatedSealedCorpus:
        raise TypeError("evaluate_final_validated_corpus requires a ValidatedSealedCorpus")
    _assert_artifacts_match_authorization(
        authorization,
        artifacts,
        production_corpus=corpus.source_kind == "production",
    )

    partitions = corpus.partitions()
    id_partition = _partition_role(partitions, ID_PARTITIONS, "ID")
    ooa_partition = _partition_role(partitions, OOA_PARTITIONS, "OOA")
    novelty_partition = _partition_role(partitions, NOVELTY_PARTITIONS, "novelty")

    partition_metrics: list[PartitionMetrics] = []
    comparisons: list[ComparisonResult] = []
    scored_families: dict[str, dict[str, tuple[SystemPredictions, SystemPredictions]]] = {}
    rows_by_partition: dict[str, tuple[EvaluationRow, ...]] = {}

    for partition in (id_partition, ooa_partition):
        rows = evaluation_rows_from_corpus(corpus, partition)
        rows_by_partition[partition] = rows
        family_outputs: dict[str, tuple[SystemPredictions, SystemPredictions]] = {}
        for bundle in (artifacts.joint, artifacts.factorized):
            unscaled, scaled = score_family_on_rows(
                bundle=bundle,
                rows=rows,
                class_order=artifacts.class_order,
                feature_dimension=artifacts.feature_dimension,
            )
            family_outputs[bundle.model_family] = (unscaled, scaled)
            partition_metrics.append(evaluate_system(rows, unscaled))
            partition_metrics.append(evaluate_system(rows, scaled))
        scored_families[partition] = family_outputs
        power = OOA_POWER_LIMITATION if partition in OOA_PARTITIONS else None
        comparisons.extend(
            compare_rq2(
                rows,
                family_outputs[JOINT_FAMILY][1],
                family_outputs[JOINT_FAMILY][0],
                power_limitation=power,
            )
        )
        comparisons.extend(
            compare_rq2(
                rows,
                family_outputs[FACTORIZED_FAMILY][1],
                family_outputs[FACTORIZED_FAMILY][0],
                power_limitation=power,
            )
        )

    ooa_rows = rows_by_partition[ooa_partition]
    comparisons[0:0] = list(
        compare_rq1(
            ooa_rows,
            scored_families[ooa_partition][JOINT_FAMILY][1],
            scored_families[ooa_partition][FACTORIZED_FAMILY][1],
            power_limitation=OOA_POWER_LIMITATION,
        )
    )

    novelty_rows = evaluation_rows_from_corpus(corpus, novelty_partition)
    supported_reference_rows = (
        *rows_by_partition[id_partition],
        *rows_by_partition[ooa_partition],
    )
    _unscaled_novelty, scaled_novelty = score_family_on_rows(
        bundle=artifacts.joint,
        rows=novelty_rows,
        class_order=artifacts.class_order,
        feature_dimension=artifacts.feature_dimension,
    )
    _unscaled_factorized_novelty, scaled_factorized_novelty = score_family_on_rows(
        bundle=artifacts.factorized,
        rows=novelty_rows,
        class_order=artifacts.class_order,
        feature_dimension=artifacts.feature_dimension,
    )
    novelty = {}
    for family, novel_predictions in (
        (JOINT_FAMILY, scaled_novelty),
        (FACTORIZED_FAMILY, scaled_factorized_novelty),
    ):
        supported_reference_predictions = concatenate_system_predictions(
            scored_families[id_partition][family][1],
            scored_families[ooa_partition][family][1],
        )
        novelty[f"{novelty_partition}/{family}"] = evaluate_novelty(
            novel_rows=novelty_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_reference_rows,
            supported_reference_predictions=supported_reference_predictions,
        )

    result = build_evaluation_result(
        authorization=authorization,
        sealed_corpus=corpus,
        partitions=partition_metrics,
        comparisons=comparisons,
        novelty=novelty,
    )
    if not result.comparisons or not result.partitions or not result.novelty:
        raise ScoringInputError("final evaluation assembled an empty result")
    return result


def _read_json(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text())
    if not isinstance(document, dict):
        raise ArtifactIdentityMismatch(f"{path.name} is not a JSON object")
    return document


def _require_file_sha(path: Path, expected: str, label: str) -> str:
    actual = sha256_hex(path.read_bytes())
    if actual != expected:
        raise ArtifactIdentityMismatch(f"{label} bytes do not match the authorized identity")
    return actual


def _joint_from_document(document: Mapping[str, Any]) -> JointModel:
    import numpy as np

    return JointModel(
        c_value=float(document["solverConfiguration"]["selectedC"]),
        coefficients=np.asarray(document["coefficients"], dtype=np.float64),
        intercepts=np.asarray(document["intercepts"], dtype=np.float64),
    )


def _factorized_from_document(document: Mapping[str, Any]) -> FactorizedModel:
    import numpy as np

    heads = document["heads"]
    composition = document["composition"]["classOrderHeadIndices"]
    class_order_heads = tuple(
        (
            int(entry["verbIndex"]),
            int(entry["objectIndex"]),
            int(entry["transitionPropertyIndex"]),
        )
        for entry in composition
    )
    return FactorizedModel(
        c_value=float(document["solverConfiguration"]["selectedC"]),
        verb_coefficients=np.asarray(heads["verb"]["coefficients"], dtype=np.float64),
        verb_intercepts=np.asarray(heads["verb"]["intercepts"], dtype=np.float64),
        object_coefficients=np.asarray(heads["objectKind"]["coefficients"], dtype=np.float64),
        object_intercepts=np.asarray(heads["objectKind"]["intercepts"], dtype=np.float64),
        property_coefficients=np.asarray(
            heads["transitionProperty"]["coefficients"], dtype=np.float64
        ),
        property_intercepts=np.asarray(heads["transitionProperty"]["intercepts"], dtype=np.float64),
        class_order_heads=class_order_heads,
    )


def family_bundle_from_documents(
    *,
    model_family: str,
    model_document: Mapping[str, Any],
    calibration_document: Mapping[str, Any],
    policy_document: Mapping[str, Any],
    model_sha256: str,
    calibration_sha256: str,
    policy_sha256: str,
) -> FamilyScoringBundle:
    """Build one family bundle from already-authenticated documents."""
    if model_family == JOINT_FAMILY:
        model: JointModel | FactorizedModel = _joint_from_document(model_document)
    elif model_family == FACTORIZED_FAMILY:
        model = _factorized_from_document(model_document)
        expected_heads = tuple(FROZEN_CLASS_HEADS[index] for index in FROZEN_CLASS_ORDER)
        if model.class_order_heads != expected_heads:
            raise ArtifactIdentityMismatch("factorized composition heads drifted from freeze")
    else:
        raise ArtifactIdentityMismatch(f"unregistered model family {model_family!r}")
    temperature = float(calibration_document["temperatureFit"]["temperature"])
    threshold = float(policy_document["selectedConfidenceThreshold"])
    return FamilyScoringBundle(
        model_family=model_family,
        model=model,
        model_artifact_sha256=model_sha256,
        calibration_artifact_sha256=calibration_sha256,
        policy_artifact_sha256=policy_sha256,
        temperature=temperature,
        threshold=threshold,
        fallback_used=bool(policy_document["fallbackUsed"]),
    )


def load_authorized_production_artifacts(
    authorization: AuthorizationSet,
) -> AuthorizedScoringArtifacts:
    """Load the frozen production artifacts after authorization. No fixture substitute."""
    directory = CANONICAL_ARTIFACT_DIRECTORY
    bundles: dict[str, FamilyScoringBundle] = {}
    expected = {
        JOINT_FAMILY: (
            "fc008-joint-logistic-model.json",
            "fc008-joint-logistic-calibration.json",
            "fc008-joint-logistic-policy.json",
            FROZEN_JOINT_MODEL_SHA256,
            FROZEN_JOINT_CALIBRATION_SHA256,
            FROZEN_JOINT_POLICY_SHA256,
            FROZEN_JOINT_TEMPERATURE,
            FROZEN_JOINT_THRESHOLD,
        ),
        FACTORIZED_FAMILY: (
            "fc008-factorized-logistic-model.json",
            "fc008-factorized-logistic-calibration.json",
            "fc008-factorized-logistic-policy.json",
            FROZEN_FACTORIZED_MODEL_SHA256,
            FROZEN_FACTORIZED_CALIBRATION_SHA256,
            FROZEN_FACTORIZED_POLICY_SHA256,
            FROZEN_FACTORIZED_TEMPERATURE,
            FROZEN_FACTORIZED_THRESHOLD,
        ),
    }
    for family, spec in expected.items():
        (
            model_name,
            calibration_name,
            policy_name,
            model_sha,
            calibration_sha,
            policy_sha,
            temperature,
            threshold,
        ) = spec
        authorized = authorization.for_family(family)
        if (
            authorized.model_artifact_sha256 != model_sha
            or authorized.calibration_artifact_sha256 != calibration_sha
            or authorized.policy_artifact_sha256 != policy_sha
        ):
            raise ArtifactIdentityMismatch(
                "authorization is not bound to the frozen production artifacts"
            )
        model_path = directory / model_name
        calibration_path = directory / calibration_name
        policy_path = directory / policy_name
        actual_model = _require_file_sha(model_path, model_sha, f"{family} model")
        actual_calibration = _require_file_sha(
            calibration_path, calibration_sha, f"{family} calibration"
        )
        actual_policy = _require_file_sha(policy_path, policy_sha, f"{family} policy")
        bundle = family_bundle_from_documents(
            model_family=family,
            model_document=_read_json(model_path),
            calibration_document=_read_json(calibration_path),
            policy_document=_read_json(policy_path),
            model_sha256=actual_model,
            calibration_sha256=actual_calibration,
            policy_sha256=actual_policy,
        )
        if bundle.temperature != temperature or bundle.threshold != threshold:
            raise ArtifactIdentityMismatch(f"{family} temperature or threshold drifted")
        if bundle.fallback_used is not True:
            raise ArtifactIdentityMismatch(f"{family} fallback flag drifted")
        bundles[family] = bundle
    artifacts = AuthorizedScoringArtifacts(
        joint=bundles[JOINT_FAMILY],
        factorized=bundles[FACTORIZED_FAMILY],
        class_order=FROZEN_CLASS_ORDER,
        feature_dimension=FEATURE_DIMENSION,
    )
    _assert_artifacts_match_authorization(authorization, artifacts, production_corpus=True)
    return artifacts


def preflight_final_output_path(path: Path) -> Path:
    """Refuse unsafe or missing result destinations before any sealed source exists."""
    destination = path.expanduser()
    if not destination.is_absolute():
        destination = destination.resolve()
    else:
        destination = destination.resolve()
    if destination.exists():
        raise OutputPathRefused("one-shot result path already exists and will not be overwritten")
    if destination.is_dir() or str(destination).endswith(os.sep):
        raise OutputPathRefused("result path must be a file, not a directory")
    forbidden = {
        CANONICAL_ARTIFACT_MANIFEST_PATH.resolve(),
        _DEVELOPMENT_CORPUS_PATH.resolve(),
        _SEALED_CORPUS_PATH.resolve(),
    }
    artifact_root = CANONICAL_ARTIFACT_DIRECTORY.resolve()
    history_root = CANONICAL_ARTIFACT_HISTORY_DIRECTORY.resolve()
    if destination in forbidden:
        raise OutputPathRefused("result path points at a frozen research artifact")
    if artifact_root in destination.parents or destination.parent == artifact_root:
        raise OutputPathRefused("result path may not be written into the frozen artifact directory")
    if history_root in destination.parents or destination.parent == history_root:
        raise OutputPathRefused("result path may not be written into artifact history")
    parent = destination.parent
    if not parent.exists():
        raise OutputPathRefused("result parent directory does not exist")
    if not parent.is_dir():
        raise OutputPathRefused("result parent is not a directory")
    return destination


def write_evaluation_result_atomically(result: EvaluationResult, destination: Path) -> str:
    """Canonicalize, hash, fsync, and rename into place. No timestamp."""
    if type(result) is not EvaluationResult:
        raise TypeError("atomic write requires an EvaluationResult")
    payload = canonical_bytes(result.to_canonical())
    digest = sha256_hex(payload)
    if digest != result.result_sha256():
        raise ScoringInputError("canonical result bytes do not match result_sha256")
    temporary = destination.with_name(f".{destination.name}.{digest[:16]}.tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
    return digest


__all__ = [
    "FROZEN_CLASS_ORDER",
    "FROZEN_FACTORIZED_TEMPERATURE",
    "FROZEN_FACTORIZED_THRESHOLD",
    "FROZEN_JOINT_TEMPERATURE",
    "FROZEN_JOINT_THRESHOLD",
    "ArtifactIdentityMismatch",
    "AuthorizedScoringArtifacts",
    "FamilyScoringBundle",
    "HoldoutOpenedError",
    "OutputPathRefused",
    "ScoringInputError",
    "design_from_rows",
    "evaluate_final_validated_corpus",
    "family_bundle_from_documents",
    "load_authorized_production_artifacts",
    "preflight_final_output_path",
    "score_family_on_rows",
    "scoring_call_count",
    "write_evaluation_result_atomically",
]

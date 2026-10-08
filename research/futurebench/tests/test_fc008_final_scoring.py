"""FC-008 Sprint 4 A3 production scoring wiring tests.

SYNTHETIC ONLY. These tests score fixture corpora and handmade models.
They never invoke the production FutureBench builder and never read
``test-id``, ``test-ooa``, or ``test-novelty``.
"""

from __future__ import annotations

import dataclasses
import inspect
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from futurebench.fc008 import final_evaluation as final_evaluation_module
from futurebench.fc008.evaluation import (
    FIXTURE_PARTITIONS,
    SEALED_PARTITIONS,
    AuthorizationSet,
    EvaluationRow,
    authorize_all_families,
)
from futurebench.fc008.final_evaluation import main as final_main
from futurebench.fc008.final_scoring import (
    FROZEN_CLASS_ORDER,
    FROZEN_FACTORIZED_MODEL_SHA256,
    FROZEN_FACTORIZED_TEMPERATURE,
    FROZEN_FACTORIZED_THRESHOLD,
    FROZEN_JOINT_MODEL_SHA256,
    FROZEN_JOINT_TEMPERATURE,
    FROZEN_JOINT_THRESHOLD,
    ArtifactIdentityMismatch,
    AuthorizedScoringArtifacts,
    FamilyScoringBundle,
    OutputPathRefused,
    evaluate_final_validated_corpus,
    load_authorized_production_artifacts,
    preflight_final_output_path,
    score_family_on_rows,
    write_evaluation_result_atomically,
)
from futurebench.fc008.models import FACTORIZED_FAMILY, JOINT_FAMILY, FactorizedModel, JointModel
from futurebench.fc008.sealed import (
    FEATURE_DIMENSION,
    FROZEN_CLASS_HEADS,
    FixtureTrustedSealedSource,
    ValidatedSealedCorpus,
    construct_validated_sealed_corpus,
    production_builder_invocation_count,
)
from futurebench.fc008.unlock import (
    CANONICAL_ARTIFACT_DIRECTORY,
    FINAL_EVALUATION_MODE,
    REGISTERED_FAMILIES,
    ArtifactContext,
    FrozenResearchIdentity,
    load_trusted_research_identity,
)

FIXTURE_ID, FIXTURE_OOA, FIXTURE_NOVELTY = FIXTURE_PARTITIONS


def context_for(frozen: FrozenResearchIdentity, model_family: str) -> ArtifactContext:
    entry = frozen.family(model_family)
    return ArtifactContext(
        model_family=model_family,
        model_artifact_sha256=entry.model_artifact_sha256,
        calibration_artifact_sha256=entry.calibration_artifact_sha256,
        policy_artifact_sha256=entry.policy_artifact_sha256,
        model_version=entry.model_version,
        calibration_artifact_version=entry.calibration_artifact_version,
        abstention_policy_version=entry.abstention_policy_version,
        dataset_hash=frozen.dataset_hash,
        vocabulary_hash=frozen.vocabulary_hash,
        support_matrix_version=frozen.support_matrix_version,
        feature_policy_version=frozen.feature_policy_version,
        preregistration_sha256=frozen.preregistration_sha256,
    )


@pytest.fixture(scope="module")
def frozen_identity() -> FrozenResearchIdentity:
    identity, _ = load_trusted_research_identity()
    return identity


@pytest.fixture(scope="module")
def authorization(frozen_identity: FrozenResearchIdentity) -> AuthorizationSet:
    contexts = {family: context_for(frozen_identity, family) for family in REGISTERED_FAMILIES}
    return authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)


@pytest.fixture(scope="module")
def fixture_corpus(authorization: AuthorizationSet) -> ValidatedSealedCorpus:
    return construct_validated_sealed_corpus(
        authorization=authorization,
        source=FixtureTrustedSealedSource(),
    )


def _sha(label: str) -> str:
    return bytes(label, "ascii").hex().ljust(64, "0")[:64]


def _known_joint() -> JointModel:
    coefficients = np.zeros((13, FEATURE_DIMENSION), dtype=np.float64)
    intercepts = np.zeros(13, dtype=np.float64)
    coefficients[0, 0] = 10.0
    coefficients[1, 1] = 10.0
    return JointModel(c_value=1.0, coefficients=coefficients, intercepts=intercepts)


def _known_factorized() -> FactorizedModel:
    verb = np.zeros((10, FEATURE_DIMENSION), dtype=np.float64)
    obj = np.zeros((9, FEATURE_DIMENSION), dtype=np.float64)
    prop = np.zeros((10, FEATURE_DIMENSION), dtype=np.float64)
    verb[0, 0] = 3.0
    obj[0, 0] = 3.0
    prop[0, 0] = 3.0
    obj[1, 1] = 12.0
    return FactorizedModel(
        c_value=1.0,
        verb_coefficients=verb,
        verb_intercepts=np.zeros(10, dtype=np.float64),
        object_coefficients=obj,
        object_intercepts=np.zeros(9, dtype=np.float64),
        property_coefficients=prop,
        property_intercepts=np.zeros(10, dtype=np.float64),
        class_order_heads=tuple(FROZEN_CLASS_HEADS[index] for index in FROZEN_CLASS_ORDER),
    )


def _bundle(family: str, model: JointModel | FactorizedModel, tag: str) -> FamilyScoringBundle:
    temperature = 2.0 if family == JOINT_FAMILY else 1.5
    threshold = 0.3 if family == JOINT_FAMILY else 0.2
    return FamilyScoringBundle(
        model_family=family,
        model=model,
        model_artifact_sha256=_sha(f"{tag}-model"),
        calibration_artifact_sha256=_sha(f"{tag}-cal"),
        policy_artifact_sha256=_sha(f"{tag}-pol"),
        temperature=temperature,
        threshold=threshold,
        fallback_used=True,
    )


def synthetic_artifacts() -> AuthorizedScoringArtifacts:
    return AuthorizedScoringArtifacts(
        joint=_bundle(JOINT_FAMILY, _known_joint(), "syn-joint"),
        factorized=_bundle(FACTORIZED_FAMILY, _known_factorized(), "syn-fact"),
        class_order=FROZEN_CLASS_ORDER,
        feature_dimension=FEATURE_DIMENSION,
    )


def bind_authorization(
    authorization: AuthorizationSet, artifacts: AuthorizedScoringArtifacts
) -> AuthorizationSet:
    replaced = {
        JOINT_FAMILY: dataclasses.replace(
            authorization.for_family(JOINT_FAMILY),
            model_artifact_sha256=artifacts.joint.model_artifact_sha256,
            calibration_artifact_sha256=artifacts.joint.calibration_artifact_sha256,
            policy_artifact_sha256=artifacts.joint.policy_artifact_sha256,
        ),
        FACTORIZED_FAMILY: dataclasses.replace(
            authorization.for_family(FACTORIZED_FAMILY),
            model_artifact_sha256=artifacts.factorized.model_artifact_sha256,
            calibration_artifact_sha256=artifacts.factorized.calibration_artifact_sha256,
            policy_artifact_sha256=artifacts.factorized.policy_artifact_sha256,
        ),
    }
    return dataclasses.replace(authorization, authorizations=replaced)


def _row(record_id: str, indices: tuple[int, ...], class_number: int) -> EvaluationRow:
    return EvaluationRow(
        record_id=record_id,
        parent_lineage_id=f"lin-{record_id}",
        partition="fixture-id",
        feature_indices=indices,
        feature_values=tuple(1.0 for _ in indices),
        class_number=class_number,
        is_novel=False,
        supported=True,
    )


class TestOutputSafetyBeforeSource:
    def test_enable_without_output_refuses_before_source_construction(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        constructed: list[str] = []

        def forbidden_source(**kwargs: Any) -> None:
            constructed.append("source")
            raise AssertionError("ProductionTrustedSealedSource must not be constructed")

        monkeypatch.setattr(
            final_evaluation_module, "ProductionTrustedSealedSource", forbidden_source
        )
        code = final_main(
            [
                "--mode",
                "final-evaluation",
                "--partition",
                "test-ooa",
                "--acknowledge-one-shot-holdout",
                "--enable-real-sealed-opening",
            ]
        )
        assert code == 2
        assert constructed == []
        captured = capsys.readouterr()
        assert "--output is required" in captured.err
        assert production_builder_invocation_count() == 0

    def test_output_preflight_failure_refuses_before_source_construction(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        constructed: list[str] = []

        def forbidden_source(**kwargs: Any) -> None:
            constructed.append("source")
            raise AssertionError("source must not be constructed")

        monkeypatch.setattr(
            final_evaluation_module, "ProductionTrustedSealedSource", forbidden_source
        )
        frozen = CANONICAL_ARTIFACT_DIRECTORY / "fc008-joint-logistic-model.json"
        code = final_main(
            [
                "--mode",
                "final-evaluation",
                "--partition",
                "test-id",
                "--acknowledge-one-shot-holdout",
                "--enable-real-sealed-opening",
                "--output",
                str(frozen),
            ]
        )
        assert code == 2
        assert constructed == []
        captured = capsys.readouterr()
        assert "frozen" in captured.err or "already exists" in captured.err
        assert production_builder_invocation_count() == 0

    def test_preflight_refuses_existing_and_frozen_paths(self, tmp_path: Path) -> None:
        existing = tmp_path / "already.json"
        existing.write_text("{}", encoding="utf-8")
        with pytest.raises(OutputPathRefused, match="already exists"):
            preflight_final_output_path(existing)
        with pytest.raises(OutputPathRefused, match="artifact directory"):
            preflight_final_output_path(
                CANONICAL_ARTIFACT_DIRECTORY / "fc008-a3-must-not-be-written.json"
            )
        missing_parent = tmp_path / "absent-dir" / "result.json"
        with pytest.raises(OutputPathRefused, match="parent directory"):
            preflight_final_output_path(missing_parent)


class TestKnownAnswerScoring:
    def test_joint_logits_and_argmax_are_known_by_hand(self) -> None:
        bundle = _bundle(JOINT_FAMILY, _known_joint(), "ka-joint")
        rows = (
            _row("ka-1", (0,), 1),
            _row("ka-2", (1,), 2),
        )
        unscaled, scaled = score_family_on_rows(bundle=bundle, rows=rows)
        assert unscaled.predicted_classes == (1, 2)
        assert scaled.predicted_classes == (1, 2)
        assert unscaled.temperature == 1.0
        assert scaled.temperature == bundle.temperature
        assert unscaled.probabilities[0][0] > unscaled.probabilities[0][1]
        assert unscaled.probabilities[1][1] > unscaled.probabilities[1][0]
        assert scaled.probabilities[0][0] > 0.5
        assert production_builder_invocation_count() == 0

    def test_factorized_composition_is_known_by_hand(self) -> None:
        model = _known_factorized()
        design = np.zeros((2, FEATURE_DIMENSION), dtype=np.float64)
        design[0, 0] = 1.0
        design[1, 1] = 1.0
        verb, obj, prop = model.head_logits(design)
        composed = model.tuple_logits(design)
        assert verb[0, 0] == pytest.approx(3.0)
        assert obj[0, 0] == pytest.approx(3.0)
        assert prop[0, 0] == pytest.approx(3.0)
        assert composed[0, 0] == pytest.approx(9.0)
        assert composed[1, 1] == pytest.approx(12.0)
        assert int(np.argmax(composed[0])) == 0
        assert int(np.argmax(composed[1])) == 1
        bundle = _bundle(FACTORIZED_FAMILY, model, "ka-fact")
        rows = (_row("ka-1", (0,), 1), _row("ka-2", (1,), 2))
        unscaled, scaled = score_family_on_rows(bundle=bundle, rows=rows)
        assert unscaled.predicted_classes == (1, 2)
        assert scaled.predicted_classes == (1, 2)
        assert unscaled.model_family == FACTORIZED_FAMILY


class TestProductionArtifactPath:
    def test_loader_binds_the_frozen_authorized_artifacts(
        self, authorization: AuthorizationSet
    ) -> None:
        artifacts = load_authorized_production_artifacts(authorization)
        assert artifacts.joint.model_artifact_sha256 == FROZEN_JOINT_MODEL_SHA256
        assert artifacts.factorized.model_artifact_sha256 == FROZEN_FACTORIZED_MODEL_SHA256
        assert artifacts.joint.temperature == FROZEN_JOINT_TEMPERATURE
        assert artifacts.factorized.temperature == FROZEN_FACTORIZED_TEMPERATURE
        assert artifacts.joint.threshold == FROZEN_JOINT_THRESHOLD
        assert artifacts.factorized.threshold == FROZEN_FACTORIZED_THRESHOLD
        assert artifacts.joint.fallback_used is True
        assert artifacts.factorized.fallback_used is True
        text = inspect.getsource(load_authorized_production_artifacts)
        assert "fc008-joint-logistic-model.json" in text
        assert "fc008-factorized-logistic-model.json" in text
        assert "FROZEN_JOINT_MODEL_SHA256" in text
        assert "FROZEN_FACTORIZED_MODEL_SHA256" in text
        assert production_builder_invocation_count() == 0

    def test_wrong_artifact_identity_fails_before_scoring(
        self, authorization: AuthorizationSet, fixture_corpus: ValidatedSealedCorpus
    ) -> None:
        artifacts = synthetic_artifacts()
        with pytest.raises(ArtifactIdentityMismatch, match="disagrees with authorization"):
            evaluate_final_validated_corpus(
                authorization=authorization,
                corpus=fixture_corpus,
                artifacts=artifacts,
            )


class TestSyntheticEndToEnd:
    def test_complete_final_evaluation_from_fixture_corpus(
        self, authorization: AuthorizationSet, fixture_corpus: ValidatedSealedCorpus, tmp_path: Path
    ) -> None:
        artifacts = synthetic_artifacts()
        bound = bind_authorization(authorization, artifacts)
        first = evaluate_final_validated_corpus(
            authorization=bound,
            corpus=fixture_corpus,
            artifacts=artifacts,
        )
        second = evaluate_final_validated_corpus(
            authorization=bound,
            corpus=fixture_corpus,
            artifacts=artifacts,
        )
        assert first.sealed_corpus_sha256 == fixture_corpus.sealed_corpus_sha256
        assert first.partition_record_counts is fixture_corpus.partition_record_counts
        assert first.partition_lineage_counts is fixture_corpus.partition_lineage_counts
        assert first.comparisons
        assert {entry.question for entry in first.comparisons} == {"RQ1", "RQ2"}
        assert any(entry.question == "RQ1" for entry in first.comparisons)
        assert any(
            entry.question == "RQ2" and "joint-logistic/scaled" in entry.delta.minuend_label
            for entry in first.comparisons
        )
        assert any(
            entry.question == "RQ2" and "factorized-logistic/scaled" in entry.delta.minuend_label
            for entry in first.comparisons
        )
        identities = {
            (entry.partition, entry.model_family, entry.temperature_setting)
            for entry in first.partitions
        }
        assert identities == {
            (FIXTURE_ID, JOINT_FAMILY, "scaled"),
            (FIXTURE_ID, JOINT_FAMILY, "unscaled"),
            (FIXTURE_ID, FACTORIZED_FAMILY, "scaled"),
            (FIXTURE_ID, FACTORIZED_FAMILY, "unscaled"),
            (FIXTURE_OOA, JOINT_FAMILY, "scaled"),
            (FIXTURE_OOA, JOINT_FAMILY, "unscaled"),
            (FIXTURE_OOA, FACTORIZED_FAMILY, "scaled"),
            (FIXTURE_OOA, FACTORIZED_FAMILY, "unscaled"),
        }
        assert FIXTURE_NOVELTY in "".join(first.novelty)
        assert all(value.novelty_total >= 1 for value in first.novelty.values())
        supported_reference_count = (
            fixture_corpus.partition_record_counts[FIXTURE_ID]
            + fixture_corpus.partition_record_counts[FIXTURE_OOA]
        )
        novelty_count = fixture_corpus.partition_record_counts[FIXTURE_NOVELTY]
        assert all(row.supported for row in fixture_corpus.rows_in(FIXTURE_ID))
        assert all(row.supported for row in fixture_corpus.rows_in(FIXTURE_OOA))
        assert all(not row.supported for row in fixture_corpus.rows_in(FIXTURE_NOVELTY))
        assert all(row.is_novel for row in fixture_corpus.rows_in(FIXTURE_NOVELTY))
        for metrics in first.novelty.values():
            assert metrics.novelty_total == novelty_count
            assert metrics.supported_total == supported_reference_count
            assert metrics.novelty_population == FIXTURE_NOVELTY
            assert metrics.supported_reference_partitions == (FIXTURE_ID, FIXTURE_OOA)
            canonical = metrics.to_canonical()
            assert canonical["supportedReferencePartitions"] == [FIXTURE_ID, FIXTURE_OOA]
            assert "recordId" not in canonical
        rq1 = [entry for entry in first.comparisons if entry.question == "RQ1"]
        assert {entry.metric for entry in rq1} == {"structuredExactMatch", "macroF1FixedThirteen"}
        assert all(entry.delta.minuend_label == "factorized-logistic" for entry in rq1)
        assert all(entry.interval is not None for entry in first.comparisons)
        assert first.result_sha256() == second.result_sha256()
        assert first.to_canonical() == second.to_canonical()

        destination = tmp_path / "fc008-fixture-result.json"
        digest = write_evaluation_result_atomically(first, destination)
        assert digest == first.result_sha256()
        repeat = tmp_path / "fc008-fixture-result-repeat.json"
        assert write_evaluation_result_atomically(second, repeat) == digest
        assert destination.read_bytes() == repeat.read_bytes()
        payload = json.loads(destination.read_text())
        assert payload["sealedCorpusSha256"] == fixture_corpus.sealed_corpus_sha256
        assert payload["comparisons"]
        assert payload["novelty"]
        assert "timestamp" not in json.dumps(payload)
        assert production_builder_invocation_count() == 0

    def test_production_path_rejects_caller_predictions(self) -> None:
        parameters = inspect.signature(evaluate_final_validated_corpus).parameters
        assert list(parameters) == ["authorization", "corpus", "artifacts"]
        assert "systems" not in parameters
        assert "predictions" not in parameters
        assert "novelty_systems" not in parameters
        assert "supported_reference" not in parameters
        assert "supported_reference_systems" not in parameters
        assert "supported_reference_partitions" not in parameters
        with pytest.raises(TypeError):
            evaluate_final_validated_corpus(  # type: ignore[call-arg]
                authorization=None,
                corpus=None,
                artifacts=None,
                systems={},
            )
        with pytest.raises(TypeError):
            evaluate_final_validated_corpus(  # type: ignore[call-arg]
                authorization=None,
                corpus=None,
                artifacts=None,
                supported_reference_partitions=("test-id",),
            )

    def test_atomic_write_leaves_no_partial_file_on_pre_write_failure(
        self,
        authorization: AuthorizationSet,
        fixture_corpus: ValidatedSealedCorpus,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        artifacts = synthetic_artifacts()
        bound = bind_authorization(authorization, artifacts)
        result = evaluate_final_validated_corpus(
            authorization=bound,
            corpus=fixture_corpus,
            artifacts=artifacts,
        )
        destination = tmp_path / "must-not-exist.json"

        def boom(value: object) -> bytes:
            raise RuntimeError("canonicalize failed")

        monkeypatch.setattr("futurebench.fc008.final_scoring.canonical_bytes", boom)
        with pytest.raises(RuntimeError, match="canonicalize failed"):
            write_evaluation_result_atomically(result, destination)
        assert destination.exists() is False
        assert list(tmp_path.glob("*.tmp")) == []

    def test_same_corpus_scores_both_families(
        self, authorization: AuthorizationSet, fixture_corpus: ValidatedSealedCorpus
    ) -> None:
        artifacts = synthetic_artifacts()
        bound = bind_authorization(authorization, artifacts)
        result = evaluate_final_validated_corpus(
            authorization=bound,
            corpus=fixture_corpus,
            artifacts=artifacts,
        )
        ooa = [entry for entry in result.partitions if entry.partition == FIXTURE_OOA]
        assert {entry.model_family for entry in ooa} == {JOINT_FAMILY, FACTORIZED_FAMILY}
        assert {entry.record_count for entry in ooa} == {
            fixture_corpus.partition_record_counts[FIXTURE_OOA]
        }
        assert result.sealed_corpus_sha256 == fixture_corpus.sealed_corpus_sha256

    def test_b3_novelty_partition_with_zero_supported_rows_uses_frozen_reference(
        self, authorization: AuthorizationSet, fixture_corpus: ValidatedSealedCorpus
    ) -> None:
        novelty_rows = fixture_corpus.rows_in(FIXTURE_NOVELTY)
        assert all(not row.supported for row in novelty_rows)
        assert all(row.is_novel for row in novelty_rows)
        artifacts = synthetic_artifacts()
        bound = bind_authorization(authorization, artifacts)
        result = evaluate_final_validated_corpus(
            authorization=bound,
            corpus=fixture_corpus,
            artifacts=artifacts,
        )
        expected_supported = (
            fixture_corpus.partition_record_counts[FIXTURE_ID]
            + fixture_corpus.partition_record_counts[FIXTURE_OOA]
        )
        for metrics in result.novelty.values():
            assert metrics.supported_total == expected_supported
            assert metrics.supported_total > 0
            assert metrics.novelty_total == len(novelty_rows)
        rq1 = [entry for entry in result.comparisons if entry.question == "RQ1"]
        rq2 = [entry for entry in result.comparisons if entry.question == "RQ2"]
        assert {entry.metric for entry in rq1} == {"structuredExactMatch", "macroF1FixedThirteen"}
        assert {entry.metric for entry in rq2} == {
            "negativeLogLikelihood",
            "multiclassBrier",
            "expectedCalibrationError",
            "aurc",
        }
        assert all(entry.interval is not None for entry in result.comparisons)
        assert production_builder_invocation_count() == 0


class TestTheSealStaysClosed:
    def test_production_builder_was_never_called(self) -> None:
        assert production_builder_invocation_count() == 0
        sealed = Path(__file__).resolve().parents[1] / "data" / "fc008-final-test-corpus.json"
        assert sealed.exists() is False
        text = Path(final_evaluation_module.__file__).read_text()
        assert "evaluate_final_validated_corpus" in text
        assert "load_authorized_production_artifacts" in text
        assert "write_evaluation_result_atomically" in text
        assert SEALED_PARTITIONS == ("test-id", "test-ooa", "test-novelty")

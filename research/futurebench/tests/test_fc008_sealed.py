"""FC-008 Sprint 4B-PreOpen sealed-corpus integrity tests.

SYNTHETIC ONLY. Every source here is a fixture or a deliberately gated production
stub. Real ``test-id``, ``test-ooa``, and ``test-novelty`` rows are never read,
exported, labelled, projected, or scored.
"""

from __future__ import annotations

import ast
import dataclasses
import inspect
from pathlib import Path
from typing import Any

import pytest

from futurebench.fc008.evaluation import (
    CANONICAL_SEALED_EXPORT_PATH,
    FIXTURE_PARTITIONS,
    SEALED_PARTITIONS,
    AuthorizationSet,
    FinalEvaluationNotAuthorized,
    authorize_all_families,
    build_evaluation_result,
    evaluate_from_validated_corpus,
    evaluation_rows_from_corpus,
)
from futurebench.fc008.metrics import MetricInputError
from futurebench.fc008.sealed import (
    FEATURE_DIMENSION,
    FIXTURE_DATASET_HASH,
    FIXTURE_PARTITION_COUNTS,
    FROZEN_DATASET_HASH,
    FROZEN_FEATURE_POLICY_VERSION,
    FROZEN_SEALED_PARTITION_COUNTS,
    FROZEN_SPRINT2_MANIFEST_HASH,
    FROZEN_SUPPORT_MATRIX_VERSION,
    FROZEN_VOCABULARY_HASH,
    CallerRowSource,
    DualFamilyAuthorization,
    FaultyFixtureSource,
    FixtureTrustedSealedSource,
    InjectedCanonicalBuilder,
    ProductionTrustedSealedSource,
    RealOpeningPermit,
    SealedCorpusIdentityMismatch,
    SealedCorpusPartitionMismatch,
    SealedCorpusRecordMismatch,
    SealedCorpusUnavailable,
    SealedOpeningNotEnabled,
    SealedRow,
    ValidatedSealedCorpus,
    _synthetic_production_rows,
    authorize_real_opening,
    construct_validated_sealed_corpus,
    invoke_production_futurebench_builder,
    production_builder_invocation_count,
)
from futurebench.fc008.unlock import (
    FACTORIZED_FAMILY,
    FINAL_EVALUATION_MODE,
    JOINT_FAMILY,
    REGISTERED_FAMILIES,
    ArtifactContext,
    FrozenResearchIdentity,
    load_trusted_research_identity,
)

RESEARCH_ROOT = Path(__file__).resolve().parents[1]
SEALED_SOURCE = RESEARCH_ROOT / "src" / "futurebench" / "fc008" / "sealed.py"

MUTATIONS: tuple[tuple[str, type[BaseException]], ...] = (
    ("wrong-dataset-hash", SealedCorpusIdentityMismatch),
    ("wrong-vocabulary-hash", SealedCorpusIdentityMismatch),
    ("wrong-sprint2-manifest", SealedCorpusIdentityMismatch),
    ("missing-partition", SealedCorpusPartitionMismatch),
    ("extra-partition", SealedCorpusPartitionMismatch),
    ("wrong-partition-count", SealedCorpusPartitionMismatch),
    ("duplicate-record-within-partition", SealedCorpusRecordMismatch),
    ("duplicate-record-across-partitions", SealedCorpusRecordMismatch),
    ("development-row-inserted", SealedCorpusPartitionMismatch),
    ("row-moved-id-to-ooa", SealedCorpusRecordMismatch),
    ("row-moved-ooa-to-id", SealedCorpusRecordMismatch),
    ("novelty-relabelled-supported", SealedCorpusRecordMismatch),
    ("supported-relabelled-novelty", SealedCorpusRecordMismatch),
    ("wrong-parent-lineage", SealedCorpusRecordMismatch),
    ("lineage-crosses-forbidden-split", SealedCorpusRecordMismatch),
    ("modified-sparse-index", SealedCorpusRecordMismatch),
    ("modified-feature-value", SealedCorpusRecordMismatch),
    ("feature-outside-vocab", SealedCorpusRecordMismatch),
    ("modified-class-label", SealedCorpusRecordMismatch),
    ("unsupported-external-class", SealedCorpusRecordMismatch),
    ("wrong-head-target", SealedCorpusRecordMismatch),
    ("wrong-feature-policy-version", SealedCorpusIdentityMismatch),
    ("wrong-support-matrix-version", SealedCorpusIdentityMismatch),
)


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
def contexts(frozen_identity: FrozenResearchIdentity) -> dict[str, ArtifactContext]:
    return {family: context_for(frozen_identity, family) for family in REGISTERED_FAMILIES}


@pytest.fixture(scope="module")
def authorization(contexts: dict[str, ArtifactContext]) -> AuthorizationSet:
    return authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)


class _MaterializeCounter:
    def __init__(self, inner: FixtureTrustedSealedSource) -> None:
        self.inner = inner
        self.source_kind = inner.source_kind
        self.calls = 0
        self.model_calls = 0

    def materialize(self, authorization: DualFamilyAuthorization) -> Any:
        self.calls += 1
        return self.inner.materialize(authorization)


class TestFrozenIdentitiesArePinned:
    def test_the_frozen_research_hashes_match_the_sprint_contract(self) -> None:
        assert FROZEN_DATASET_HASH == (
            "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa"
        )
        assert FROZEN_VOCABULARY_HASH == (
            "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64"
        )
        assert FROZEN_SPRINT2_MANIFEST_HASH == (
            "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77"
        )
        assert FROZEN_SUPPORT_MATRIX_VERSION == "1.0"
        assert FROZEN_FEATURE_POLICY_VERSION == "1.0"
        assert dict(FROZEN_SEALED_PARTITION_COUNTS) == {
            "test-id": 143,
            "test-ooa": 66,
            "test-novelty": 28,
        }
        assert FEATURE_DIMENSION == 370

    def test_partition_name_lists_stay_aligned_with_the_harness(self) -> None:
        assert SEALED_PARTITIONS == ("test-id", "test-ooa", "test-novelty")
        assert FIXTURE_PARTITIONS == ("fixture-id", "fixture-ooa", "fixture-novelty")
        assert set(SEALED_PARTITIONS).isdisjoint(set(FIXTURE_PARTITIONS))


def _valid_permit(authorization: AuthorizationSet) -> RealOpeningPermit:
    return authorize_real_opening(
        mode=FINAL_EVALUATION_MODE,
        acknowledge_one_shot_holdout=True,
        enable_real_sealed_opening=True,
        authorization=authorization,
    )


def _injected_source(
    authorization: AuthorizationSet,
    snapshot=None,
) -> ProductionTrustedSealedSource:
    builder = InjectedCanonicalBuilder(snapshot or _synthetic_production_rows())
    return ProductionTrustedSealedSource(permit=_valid_permit(authorization), builder=builder)


class TestRealOpeningActivation:
    def test_wrong_mode_issues_no_permit(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedOpeningNotEnabled, match="requires mode"):
            authorize_real_opening(
                mode="development",
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=True,
                authorization=authorization,
            )

    def test_missing_acknowledgement_issues_no_permit(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(SealedOpeningNotEnabled, match="acknowledge-one-shot-holdout"):
            authorize_real_opening(
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=False,
                enable_real_sealed_opening=True,
                authorization=authorization,
            )

    def test_missing_enable_flag_issues_no_permit(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedOpeningNotEnabled, match="enable-real-sealed-opening"):
            authorize_real_opening(
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=False,
                authorization=authorization,
            )

    def test_missing_joint_authorization_issues_no_permit(
        self, contexts: dict[str, ArtifactContext]
    ) -> None:
        complete = authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)
        partial = dataclasses.replace(
            complete,
            authorizations={FACTORIZED_FAMILY: complete.for_family(FACTORIZED_FAMILY)},
        )
        with pytest.raises(FinalEvaluationNotAuthorized, match="Partial evaluation is refused"):
            authorize_real_opening(
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=True,
                authorization=partial,
            )

    def test_missing_factorized_authorization_issues_no_permit(
        self, contexts: dict[str, ArtifactContext]
    ) -> None:
        complete = authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)
        partial = dataclasses.replace(
            complete,
            authorizations={JOINT_FAMILY: complete.for_family(JOINT_FAMILY)},
        )
        with pytest.raises(FinalEvaluationNotAuthorized, match="Partial evaluation is refused"):
            authorize_real_opening(
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=True,
                authorization=partial,
            )

    def test_research_state_disagreement_issues_no_permit(
        self, authorization: AuthorizationSet
    ) -> None:
        disagreed = dataclasses.replace(
            authorization,
            authorizations={
                JOINT_FAMILY: authorization.for_family(JOINT_FAMILY),
                FACTORIZED_FAMILY: dataclasses.replace(
                    authorization.for_family(FACTORIZED_FAMILY),
                    dataset_hash="aa" * 32,
                ),
            },
        )
        with pytest.raises(FinalEvaluationNotAuthorized, match="disagree"):
            authorize_real_opening(
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=True,
                authorization=disagreed,
            )

    def test_valid_prerequisites_issue_a_permit_without_opening_rows(
        self, authorization: AuthorizationSet
    ) -> None:
        before = production_builder_invocation_count()
        permit = _valid_permit(authorization)
        assert type(permit) is RealOpeningPermit
        assert permit.enable_real_sealed_opening is True
        assert production_builder_invocation_count() == before

    def test_direct_permit_construction_is_refused(self) -> None:
        with pytest.raises(SealedOpeningNotEnabled, match="authorize_real_opening"):
            RealOpeningPermit(
                _token=object(),
                mode=FINAL_EVALUATION_MODE,
                acknowledge_one_shot_holdout=True,
                enable_real_sealed_opening=True,
                artifact_manifest_sha256="00" * 32,
                preregistration_sha256="11" * 32,
            )

    def test_production_source_requires_a_permit(self) -> None:
        parameters = inspect.signature(ProductionTrustedSealedSource.__init__).parameters
        assert "permit" in parameters
        assert "rows" not in parameters
        with pytest.raises(TypeError):
            ProductionTrustedSealedSource()  # type: ignore[call-arg]

    def test_construct_refuses_partial_authorization_before_any_source_access(
        self, contexts: dict[str, ArtifactContext]
    ) -> None:
        complete = authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)
        partial = dataclasses.replace(
            complete,
            authorizations={FACTORIZED_FAMILY: complete.for_family(FACTORIZED_FAMILY)},
        )
        counter = _MaterializeCounter(FixtureTrustedSealedSource())
        with pytest.raises(FinalEvaluationNotAuthorized, match="Partial evaluation is refused"):
            construct_validated_sealed_corpus(authorization=partial, source=counter)
        assert counter.calls == 0

    def test_generic_import_does_not_activate_production_opening(self) -> None:
        assert production_builder_invocation_count() == 0


class TestConstructSignatureIsClosed:
    def test_only_authorization_and_source_are_accepted(self) -> None:
        parameters = inspect.signature(construct_validated_sealed_corpus).parameters
        assert list(parameters) == ["authorization", "source"]
        for name in parameters:
            assert parameters[name].kind is inspect.Parameter.KEYWORD_ONLY

    def test_caller_provided_expected_hash_is_rejected(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(TypeError):
            construct_validated_sealed_corpus(  # type: ignore[call-arg]
                authorization=authorization,
                source=FixtureTrustedSealedSource(),
                expected_hash="aa" * 32,
            )

    def test_caller_provided_expected_record_list_is_rejected(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(TypeError):
            construct_validated_sealed_corpus(  # type: ignore[call-arg]
                authorization=authorization,
                source=FixtureTrustedSealedSource(),
                expected_record_ids=["fix-id-000"],
            )

    def test_caller_rows_are_rejected(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(TypeError):
            construct_validated_sealed_corpus(  # type: ignore[call-arg]
                authorization=authorization,
                source=FixtureTrustedSealedSource(),
                rows=[{"recordId": "caller"}],
            )


class TestPositiveFixtureCorpus:
    def test_a_valid_fixture_produces_one_immutable_corpus(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        assert type(corpus) is ValidatedSealedCorpus
        assert corpus.source_kind == "fixture"
        assert corpus.dataset_hash == FIXTURE_DATASET_HASH
        assert dict(corpus.partition_record_counts) == dict(FIXTURE_PARTITION_COUNTS)
        assert corpus.record_count == 9
        assert corpus.lineage_count == 7
        assert corpus.sealed_corpus_sha256
        assert len(corpus.sealed_corpus_sha256) == 64
        assert corpus.partitions() == tuple(sorted(FIXTURE_PARTITIONS))
        for row in corpus.rows():
            assert row.partition in FIXTURE_PARTITIONS
            assert row.partition not in SEALED_PARTITIONS

    def test_the_canonical_hash_is_deterministic(self, authorization: AuthorizationSet) -> None:
        first = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        second = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        assert first.sealed_corpus_sha256 == second.sealed_corpus_sha256
        assert first.identity == second.identity
        assert first.rows() == second.rows()

    def test_the_corpus_is_frozen(self, authorization: AuthorizationSet) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            corpus.record_count = 0  # type: ignore[misc]

    def test_an_arbitrary_constructor_is_refused(self) -> None:
        with pytest.raises(
            SealedCorpusUnavailable, match="cannot be constructed from caller input"
        ):
            ValidatedSealedCorpus(
                _token=object(),
                sealed_corpus_sha256="00" * 32,
                source_kind="fixture",
                dataset_hash=FIXTURE_DATASET_HASH,
                vocabulary_hash="f2" * 32,
                sprint2_manifest_hash="f3" * 32,
                support_matrix_version="1.0",
                feature_policy_version="1.0",
                partition_record_counts={},
                partition_lineage_counts={},
                record_count=0,
                lineage_count=0,
                _rows=(),
                identity={},
            )


class TestMutationsFailClosed:
    @pytest.mark.parametrize(("mutation", "error"), MUTATIONS)
    def test_each_integrity_fault_is_refused(
        self,
        authorization: AuthorizationSet,
        mutation: str,
        error: type[BaseException],
    ) -> None:
        with pytest.raises(error):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=FaultyFixtureSource(mutation=mutation),
            )

    def test_arbitrary_caller_rows_are_refused(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusUnavailable):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=CallerRowSource(),
            )

    def test_exception_messages_do_not_dump_row_contents(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(SealedCorpusRecordMismatch) as caught:
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=FaultyFixtureSource(mutation="modified-feature-value"),
            )
        message = str(caught.value)
        assert "1.0" not in message
        assert "2.0" not in message
        assert "fix-id-000" not in message


class TestEvaluationRequiresValidatedCorpus:
    def test_build_evaluation_result_rejects_a_raw_mapping(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(TypeError, match="ValidatedSealedCorpus"):
            build_evaluation_result(
                authorization=authorization,
                sealed_corpus={"rows": []},  # type: ignore[arg-type]
                partitions=(),
                comparisons=(),
            )

    def test_evaluate_from_validated_corpus_rejects_a_list(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(TypeError, match="ValidatedSealedCorpus"):
            evaluate_from_validated_corpus(
                authorization=authorization,
                corpus=[{"recordId": "x"}],  # type: ignore[arg-type]
            )

    def test_evaluation_rows_from_corpus_rejects_raw_rows(self) -> None:
        with pytest.raises(TypeError, match="ValidatedSealedCorpus"):
            evaluation_rows_from_corpus(
                [
                    SealedRow(  # type: ignore[arg-type]
                        record_id="x",
                        parent_lineage_id="y",
                        partition="fixture-id",
                        feature_indices=(0,),
                        feature_values=(1.0,),
                        class_number=1,
                        is_novel=False,
                        supported=True,
                        verb_index=0,
                        object_index=0,
                        transition_property_index=0,
                    )
                ],
                "fixture-id",
            )

    def test_both_families_bind_the_same_corpus_identity(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        result = evaluate_from_validated_corpus(authorization=authorization, corpus=corpus)
        assert result.sealed_corpus_sha256 == corpus.sealed_corpus_sha256
        assert result.partition_record_counts == corpus.partition_record_counts
        assert result.partition_lineage_counts == corpus.partition_lineage_counts
        canonical = result.to_canonical()
        assert canonical["sealedCorpusSha256"] == corpus.sealed_corpus_sha256
        assert result.partitions == ()

    def test_novelty_systems_require_supported_reference_systems(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        with pytest.raises(MetricInputError, match="supported_reference_systems is required"):
            evaluate_from_validated_corpus(
                authorization=authorization,
                corpus=corpus,
                novelty_systems={"fixture-novelty": object()},  # type: ignore[arg-type]
            )


class TestValidationDoesNotCallModels:
    def test_sealed_module_imports_no_model_or_scoring_surface(self) -> None:
        tree = ast.parse(SEALED_SOURCE.read_text(), filename=str(SEALED_SOURCE))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")
                imported.update(alias.name for alias in node.names)
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
        forbidden = {
            "models",
            "train",
            "calibration",
            "policy",
            "metrics",
            "bootstrap",
            "inferJoint",
            "inferFactorized",
            "LogisticRegression",
        }
        assert not (imported & forbidden)
        # The lazy authorization import is the exception class, not an authorizer.
        source = SEALED_SOURCE.read_text()
        for name in (
            "authorize_final_evaluation",
            "load_trusted_research_identity",
            "inferJoint",
            "predict_proba",
        ):
            assert name not in source

    def test_constructing_a_valid_corpus_makes_zero_model_calls(
        self, authorization: AuthorizationSet
    ) -> None:
        counter = _MaterializeCounter(FixtureTrustedSealedSource())
        corpus = construct_validated_sealed_corpus(authorization=authorization, source=counter)
        assert counter.calls == 1
        assert counter.model_calls == 0
        assert corpus.record_count == 9


class TestTheRealSealStaysClosed:
    def test_the_physical_sealed_file_is_absent(self) -> None:
        assert CANONICAL_SEALED_EXPORT_PATH.exists() is False
        data_dir = CANONICAL_SEALED_EXPORT_PATH.parent
        assert sorted(path.name for path in data_dir.glob("*.json")) == [
            "fc008-development-corpus.json"
        ]

    def test_fixture_rows_never_use_real_partition_names(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        assert {row.partition for row in corpus.rows()} == set(FIXTURE_PARTITIONS)
        assert {row.record_id for row in corpus.rows()}.isdisjoint(
            {"test-id", "test-ooa", "test-novelty"}
        )

    def test_unknown_source_kind_is_refused(self, authorization: AuthorizationSet) -> None:
        class Unknown:
            source_kind = "adhoc"

            def materialize(self, authorization: DualFamilyAuthorization) -> Any:
                raise AssertionError("unknown source must not materialize")

        with pytest.raises(SealedCorpusUnavailable, match="not a trusted fixture or production"):
            construct_validated_sealed_corpus(authorization=authorization, source=Unknown())

    def test_the_production_builder_exists_and_was_never_called(self) -> None:
        assert callable(invoke_production_futurebench_builder)
        tree = ast.parse(SEALED_SOURCE.read_text(), filename=str(SEALED_SOURCE))
        defined = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        assert "invoke_production_futurebench_builder" in defined
        assert "authorize_real_opening" in defined
        assert "REAL_SEALED_OPENING_ENABLED" not in SEALED_SOURCE.read_text()
        test_tree = ast.parse(Path(__file__).read_text(), filename=__file__)
        for node in ast.walk(test_tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id != "invoke_production_futurebench_builder"
        assert production_builder_invocation_count() == 0

    def test_evaluation_tests_never_pass_the_enable_flag(self) -> None:
        evaluation_tests = Path(__file__).with_name("test_fc008_evaluation.py")
        tree = ast.parse(evaluation_tests.read_text(), filename=str(evaluation_tests))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.attr
                if isinstance(func, ast.Attribute)
                else (func.id if isinstance(func, ast.Name) else "")
            )
            if name != "main":
                continue
            for arg in node.args:
                if not isinstance(arg, ast.List):
                    continue
                texts = [
                    elt.value
                    for elt in arg.elts
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                ]
                assert "--enable-real-sealed-opening" not in texts
        assert production_builder_invocation_count() == 0


def _extra_syn_row(
    *,
    record_id: str,
    partition: str,
    lineage: str = "syn-lin-extra",
    family: str = "syn-extra",
) -> SealedRow:
    return SealedRow(
        record_id=record_id,
        parent_lineage_id=lineage,
        partition=partition,
        feature_indices=(0, 1),
        feature_values=(1.0, 1.0),
        class_number=1,
        is_novel=False,
        supported=True,
        verb_index=0,
        object_index=0,
        transition_property_index=0,
        application_family_id=family,
    )


class TestInjectedProductionDerivation:
    def test_correct_full_dataset_identity_succeeds(self, authorization: AuthorizationSet) -> None:
        before = production_builder_invocation_count()
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=_injected_source(authorization),
        )
        assert corpus.source_kind == "production"
        assert corpus.dataset_hash == FROZEN_DATASET_HASH
        assert corpus.vocabulary_hash == FROZEN_VOCABULARY_HASH
        assert corpus.sprint2_manifest_hash == FROZEN_SPRINT2_MANIFEST_HASH
        assert dict(corpus.partition_record_counts) == dict(FROZEN_SEALED_PARTITION_COUNTS)
        assert corpus.record_count == 237
        assert {row.partition for row in corpus.rows()} == set(SEALED_PARTITIONS)
        assert all(row.record_id.startswith("syn-") for row in corpus.rows())
        assert production_builder_invocation_count() == before

    def test_wrong_dataset_sha_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusIdentityMismatch, match="dataset"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(dataset_hash="00" * 32)
                ),
            )

    def test_wrong_vocabulary_sha_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusIdentityMismatch, match="vocabulary"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(vocabulary_hash="11" * 32)
                ),
            )

    def test_wrong_sprint2_manifest_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusIdentityMismatch, match="manifest"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(sprint2_manifest_hash="22" * 32),
                ),
            )

    def test_wrong_support_matrix_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusIdentityMismatch, match="support-matrix"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(support_matrix_version="9.9"),
                ),
            )

    def test_wrong_feature_policy_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusIdentityMismatch, match="feature-policy"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(feature_policy_version="9.9"),
                ),
            )

    def test_count_mismatch_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusPartitionMismatch, match="count"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(
                        counts={"test-id": 142, "test-ooa": 66, "test-novelty": 28}
                    ),
                ),
            )

    def test_missing_partition_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusPartitionMismatch, match="missing"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(counts={"test-id": 143, "test-ooa": 66}),
                ),
            )

    def test_extra_final_partition_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusPartitionMismatch, match="extra"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(
                        extra_rows=(
                            _extra_syn_row(record_id="syn-extra-000", partition="test-extra"),
                        )
                    ),
                ),
            )

    def test_development_row_injected_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusPartitionMismatch, match="development"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization,
                    _synthetic_production_rows(
                        extra_rows=(_extra_syn_row(record_id="syn-test-id-000", partition="train"),)
                    ),
                ),
            )

    def test_duplicate_record_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusRecordMismatch, match="duplicate"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="duplicate-record")
                ),
            )

    def test_moved_record_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(
            (SealedCorpusPartitionMismatch, SealedCorpusRecordMismatch),
            match="count|lineage|moved",
        ):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="moved-record")
                ),
            )

    def test_wrong_label_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusRecordMismatch, match="unsupported external class"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="wrong-label")
                ),
            )

    def test_wrong_factorized_targets_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusRecordMismatch, match="head-target"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="wrong-heads")
                ),
            )

    def test_wrong_feature_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusRecordMismatch, match="feature"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="wrong-feature")
                ),
            )

    def test_wrong_lineage_refuses(self, authorization: AuthorizationSet) -> None:
        with pytest.raises(SealedCorpusRecordMismatch, match="lineage"):
            construct_validated_sealed_corpus(
                authorization=authorization,
                source=_injected_source(
                    authorization, _synthetic_production_rows(mutate="wrong-lineage")
                ),
            )

    def test_production_source_accepts_no_caller_rows(self) -> None:
        parameters = inspect.signature(ProductionTrustedSealedSource.__init__).parameters
        assert "rows" not in parameters
        assert "dataset" not in parameters
        assert "expected_digest" not in parameters
        assert list(parameters) == ["self", "permit", "builder"]


class TestDeepImmutabilityAndTocTou:
    def test_fixture_corpus_state_cannot_mutate_after_hash(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=FixtureTrustedSealedSource(),
        )
        bound_hash = corpus.sealed_corpus_sha256
        bound_counts = dict(corpus.partition_record_counts)
        bound_lineages = dict(corpus.partition_lineage_counts)
        bound_dataset = corpus.dataset_hash
        with pytest.raises(TypeError):
            corpus.partition_record_counts["fixture-id"] = 0  # type: ignore[index]
        with pytest.raises(TypeError):
            corpus.partition_lineage_counts["fixture-id"] = 0  # type: ignore[index]
        with pytest.raises(TypeError):
            corpus.identity["datasetHash"] = "00" * 32  # type: ignore[index]
        with pytest.raises(TypeError):
            corpus.identity["partitionCounts"]["fixture-id"] = 0  # type: ignore[index]
        with pytest.raises(TypeError):
            corpus.identity["vocabularyHash"] = "11" * 32  # type: ignore[index]
        row = corpus.rows()[0]
        with pytest.raises(dataclasses.FrozenInstanceError):
            row.record_id = "mutated"  # type: ignore[misc]
        with pytest.raises(dataclasses.FrozenInstanceError):
            row.class_number = 99  # type: ignore[misc]
        with pytest.raises(dataclasses.FrozenInstanceError):
            row.parent_lineage_id = "mutated-lin"  # type: ignore[misc]
        with pytest.raises(TypeError):
            row.feature_indices[0] = 9  # type: ignore[index]
        with pytest.raises(TypeError):
            row.feature_values[0] = 9.0  # type: ignore[index]
        with pytest.raises(dataclasses.FrozenInstanceError):
            corpus.dataset_hash = "00" * 32  # type: ignore[misc]
        result = evaluate_from_validated_corpus(authorization=authorization, corpus=corpus)
        assert corpus.sealed_corpus_sha256 == bound_hash
        assert corpus.dataset_hash == bound_dataset
        assert result.sealed_corpus_sha256 == bound_hash
        assert result.partition_record_counts is corpus.partition_record_counts
        assert result.partition_lineage_counts is corpus.partition_lineage_counts
        assert dict(result.partition_record_counts) == bound_counts
        assert dict(result.partition_lineage_counts) == bound_lineages
        assert dict(corpus.identity["partitionCounts"]) == bound_counts
        assert dict(corpus.identity["partitionLineageCounts"]) == bound_lineages

    def test_injected_production_corpus_cannot_diverge_from_its_hash(
        self, authorization: AuthorizationSet
    ) -> None:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=_injected_source(authorization),
        )
        bound_hash = corpus.sealed_corpus_sha256
        with pytest.raises(TypeError):
            corpus.partition_record_counts["test-id"] = 0  # type: ignore[index]
        with pytest.raises(TypeError):
            corpus.identity["datasetHash"] = "ff" * 32  # type: ignore[index]
        result = evaluate_from_validated_corpus(authorization=authorization, corpus=corpus)
        assert result.sealed_corpus_sha256 == bound_hash
        assert result.partition_record_counts is corpus.partition_record_counts
        assert dict(result.partition_record_counts) == {
            "test-id": 143,
            "test-ooa": 66,
            "test-novelty": 28,
        }
        assert production_builder_invocation_count() == 0

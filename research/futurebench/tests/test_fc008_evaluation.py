"""Tests for the FC-008 Sprint-4A evaluation harness and its seal.

THE REAL FINAL TESTS ARE NEVER OPENED HERE. Every row in this module is a synthetic
``EvaluationRow`` built inline on one of the ``fixture-*`` partition names. The real
sealed partitions are named only inside tests that assert they are REFUSED, and the
real opening count stays at zero.

The seal tests come first, deliberately. The evaluator can only be exercised safely
once it is established that no fixture, no plumbing, and no command-line invocation
can be redirected at the holdout.
"""

from __future__ import annotations

import dataclasses
import importlib
import inspect
import json
import re
from pathlib import Path
from typing import Sequence

import pytest

from futurebench.fc008 import evaluation as evaluation_module
from futurebench.fc008 import final_evaluation as final_evaluation_module
from futurebench.fc008.bootstrap import OOA_POWER_LIMITATION
from futurebench.fc008.evaluation import (
    CANONICAL_SEALED_EXPORT_PATH,
    DEFAULT_LIMITATIONS,
    EVALUATION_SCHEMA_VERSION,
    FIXTURE_PARTITIONS,
    NOVELTY_POPULATION_PARTITION,
    NOVELTY_SUPPORTED_REFERENCE_PARTITIONS,
    SEALED_PARTITIONS,
    AuthorizationSet,
    CanonicalSealedCorpus,
    ComparisonResult,
    EvaluationRow,
    FinalEvaluationLocked,
    FinalEvaluationNotAuthorized,
    FixtureCorpus,
    FixturePartitionMisuse,
    PartitionMetrics,
    SealedCorpusUnavailable,
    SystemPredictions,
    authorize_all_families,
    bootstrap_structured_exact_match,
    build_evaluation_result,
    compare_rq1,
    compare_rq2,
    evaluate_novelty,
    evaluate_system,
    evaluation_specification_canonical,
    open_sealed_partition,
)
from futurebench.fc008.metrics import FIXED_THIRTEEN_LABELS, MetricInputError
from futurebench.fc008.report import render_report
from futurebench.fc008.sealed import (
    FixtureTrustedSealedSource,
    construct_validated_sealed_corpus,
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

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_ROOT = REPOSITORY_ROOT / "research" / "futurebench"
DATA_DIR = RESEARCH_ROOT / "data"

FIXTURE_ID, FIXTURE_OOA, FIXTURE_NOVELTY = FIXTURE_PARTITIONS

TOLERANCE = 1e-9


# ============================================================================
# SYNTHETIC FIXTURE BUILDERS
# ============================================================================


def peaked(label: int, peak: float) -> tuple[float, ...]:
    """A 13-class distribution with ``peak`` on ``label``, remainder spread evenly."""
    remainder = (1.0 - peak) / (len(FIXED_THIRTEEN_LABELS) - 1)
    return tuple(peak if value == label else remainder for value in FIXED_THIRTEEN_LABELS)


def make_rows(
    partition: str,
    classes: Sequence[int | None],
    lineages: Sequence[str],
    *,
    novel: Sequence[bool] | None = None,
    supported: Sequence[bool] | None = None,
) -> tuple[EvaluationRow, ...]:
    """Build synthetic evaluation rows on a FIXTURE partition.

    ``partition`` is asserted to be a fixture name rather than merely documented as
    one, so a future fixture that reached for the holdout fails inside the builder.
    """
    assert partition in FIXTURE_PARTITIONS, partition
    novel = novel if novel is not None else [False] * len(classes)
    supported = supported if supported is not None else [True] * len(classes)
    return tuple(
        EvaluationRow(
            record_id=f"{partition}-{index:03d}",
            parent_lineage_id=lineage,
            partition=partition,
            feature_indices=(index % 7, (index + 3) % 11),
            feature_values=(1.0, 1.0),
            class_number=class_number,
            is_novel=is_novel,
            supported=is_supported,
        )
        for index, (class_number, lineage, is_novel, is_supported) in enumerate(
            zip(classes, lineages, novel, supported, strict=True)
        )
    )


def make_predictions(
    predicted: Sequence[int],
    confidences: Sequence[float],
    *,
    model_family: str = JOINT_FAMILY,
    temperature_setting: str = "scaled",
    temperature: float = 1.3,
    accepted: Sequence[bool] | None = None,
) -> SystemPredictions:
    """One system's synthetic output, with probabilities derived from the confidences."""
    return SystemPredictions(
        model_family=model_family,
        temperature_setting=temperature_setting,
        temperature=temperature,
        predicted_classes=tuple(int(value) for value in predicted),
        probabilities=tuple(
            peaked(int(label), float(confidence))
            for label, confidence in zip(predicted, confidences, strict=True)
        ),
        confidences=tuple(float(value) for value in confidences),
        accepted=tuple(accepted)
        if accepted is not None
        else tuple(float(value) >= 0.5 for value in confidences),
    )


def context_for(frozen: FrozenResearchIdentity, model_family: str) -> ArtifactContext:
    """The actuals a correctly configured caller presents, built as production does.

    Mirrors ``final_evaluation._artifact_contexts`` rather than calling it, so the
    tests exercise the public authorization surface and the private helper stays free
    to change shape.
    """
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


@pytest.fixture(scope="module")
def sealed_corpus(authorization: AuthorizationSet):
    return construct_validated_sealed_corpus(
        authorization=authorization,
        source=FixtureTrustedSealedSource(),
    )


# ============================================================================
# THE SEAL
# ============================================================================


class TestTheSealRefusesEveryRoute:
    """No mode, no fixture, no command line, and no import can reach the holdout."""

    @pytest.mark.parametrize(
        "mode", ["", "development", "FINAL-EVALUATION", "final_evaluation", "quality", "test"]
    )
    def test_open_sealed_partition_refuses_any_mode_but_the_exact_one(
        self, authorization: AuthorizationSet, mode: str
    ) -> None:
        # Checked before anything else, so a refusal never depends on whether data
        # happened to be present.
        with pytest.raises(FinalEvaluationNotAuthorized, match="requires mode"):
            open_sealed_partition(
                mode=mode,
                partition="test-ooa",
                authorization=authorization,
                source=CanonicalSealedCorpus(),
            )

    @pytest.mark.parametrize("partition", [*FIXTURE_PARTITIONS, "train", "calibration", ""])
    def test_the_gate_exists_only_for_sealed_partitions(
        self, authorization: AuthorizationSet, partition: str
    ) -> None:
        # A non-sealed name is a programming error, not an authorization question: the
        # gate is not a general-purpose loader.
        with pytest.raises(KeyError, match="not a sealed partition"):
            open_sealed_partition(
                mode=FINAL_EVALUATION_MODE,
                partition=partition,
                authorization=authorization,
                source=CanonicalSealedCorpus(),
            )

    def test_an_authorization_issued_in_the_wrong_mode_is_refused_at_the_gate(
        self, authorization: AuthorizationSet
    ) -> None:
        # The token is re-checked at the point of use, not merely at construction.
        tampered = dataclasses.replace(authorization, mode="development")
        with pytest.raises(FinalEvaluationNotAuthorized, match="issued in mode"):
            open_sealed_partition(
                mode=FINAL_EVALUATION_MODE,
                partition="test-id",
                authorization=tampered,
                source=CanonicalSealedCorpus(),
            )

    def test_an_authorization_missing_a_family_is_refused_at_the_gate(
        self, authorization: AuthorizationSet
    ) -> None:
        partial = dataclasses.replace(
            authorization,
            authorizations={JOINT_FAMILY: authorization.for_family(JOINT_FAMILY)},
        )
        with pytest.raises(FinalEvaluationNotAuthorized, match="no authorization for model family"):
            open_sealed_partition(
                mode=FINAL_EVALUATION_MODE,
                partition="test-ooa",
                authorization=partial,
                source=CanonicalSealedCorpus(),
            )


class TestAtomicAuthorization:
    """Both families, validated in full, BEFORE any sealed row is read."""

    @pytest.mark.parametrize("mode", ["", "development", "FINAL-EVALUATION", "final_evaluation"])
    def test_authorize_all_families_refuses_a_wrong_mode(
        self, contexts: dict[str, ArtifactContext], mode: str
    ) -> None:
        with pytest.raises(FinalEvaluationNotAuthorized, match="requires mode"):
            authorize_all_families(mode=mode, contexts=contexts)

    @pytest.mark.parametrize("family", list(REGISTERED_FAMILIES))
    def test_a_single_family_is_refused_as_partial_evaluation(
        self, contexts: dict[str, ArtifactContext], family: str
    ) -> None:
        # THE ATOMICITY TEST. Authorizing lazily per family would allow a run to
        # produce a complete set of joint results and only then discover the
        # factorized policy artifact had drifted, leaving half an experiment behind
        # after the one-shot holdout had already been consumed.
        with pytest.raises(FinalEvaluationNotAuthorized) as caught:
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts={family: contexts[family]})
        message = str(caught.value)
        assert "Partial evaluation is refused" in message
        missing = next(other for other in REGISTERED_FAMILIES if other != family)
        assert missing in message

    def test_no_families_at_all_is_refused(self) -> None:
        with pytest.raises(FinalEvaluationNotAuthorized, match="Partial evaluation is refused"):
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts={})

    def test_an_unregistered_family_name_is_refused(
        self, contexts: dict[str, ArtifactContext]
    ) -> None:
        extended = {**contexts, "joint-logistic-v2": contexts[JOINT_FAMILY]}
        with pytest.raises(FinalEvaluationNotAuthorized, match="unregistered model families"):
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=extended)

    def test_a_context_keyed_under_the_wrong_family_is_refused(
        self, frozen_identity: FrozenResearchIdentity
    ) -> None:
        # Keyed as joint, declares factorized. Checked before the hashes so the error
        # names the real problem.
        mismatched = {
            JOINT_FAMILY: context_for(frozen_identity, FACTORIZED_FAMILY),
            FACTORIZED_FAMILY: context_for(frozen_identity, FACTORIZED_FAMILY),
        }
        with pytest.raises(FinalEvaluationNotAuthorized, match="declares model family"):
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=mismatched)

    @pytest.mark.parametrize(
        "field",
        [
            "model_artifact_sha256",
            "calibration_artifact_sha256",
            "policy_artifact_sha256",
            "preregistration_sha256",
            "dataset_hash",
        ],
    )
    def test_a_drifted_artifact_identity_locks_the_evaluation(
        self, contexts: dict[str, ArtifactContext], field: str
    ) -> None:
        drifted = {
            **contexts,
            JOINT_FAMILY: dataclasses.replace(contexts[JOINT_FAMILY], **{field: "0" * 64}),
        }
        with pytest.raises(FinalEvaluationLocked):
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=drifted)

    def test_a_second_family_failing_refuses_the_whole_set(
        self, contexts: dict[str, ArtifactContext]
    ) -> None:
        # Joint validates and factorized does not. The refusal must cover the whole set,
        # so there is no partially populated authorization a caller could spend on the
        # family that did validate — and because nothing has been opened, the failure
        # costs nothing and the seal is still intact.
        drifted = {
            **contexts,
            FACTORIZED_FAMILY: dataclasses.replace(
                contexts[FACTORIZED_FAMILY], model_version="9.9"
            ),
        }
        with pytest.raises(FinalEvaluationLocked) as caught:
            authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=drifted)
        assert FACTORIZED_FAMILY in str(caught.value)
        assert CANONICAL_SEALED_EXPORT_PATH.exists() is False
        # The honest set still authorizes afterwards: the failure left no sticky state.
        recovered = authorize_all_families(mode=FINAL_EVALUATION_MODE, contexts=contexts)
        assert set(recovered.families()) == set(REGISTERED_FAMILIES)


class TestFixturesCannotBeRedirectedAtTheHoldout:
    @pytest.mark.parametrize("partition", list(SEALED_PARTITIONS))
    def test_the_fixture_corpus_refuses_every_real_sealed_partition(self, partition: str) -> None:
        # Even a fixture whose mapping CONTAINS the sealed name is refused, so no
        # amount of fixture plumbing can produce something that looks like a real
        # final result.
        corpus = FixtureCorpus(
            rows_by_partition={
                partition: make_rows(FIXTURE_ID, [1], ["L000"]),
                FIXTURE_ID: make_rows(FIXTURE_ID, [1], ["L000"]),
            }
        )
        with pytest.raises(FixturePartitionMisuse, match="refuses the real sealed partition"):
            corpus.read(partition)

    def test_the_fixture_corpus_serves_its_own_partitions(self) -> None:
        rows = make_rows(FIXTURE_OOA, [1, 2], ["L000", "L000"])
        corpus = FixtureCorpus(rows_by_partition={FIXTURE_OOA: rows})
        assert corpus.read(FIXTURE_OOA) == rows
        assert corpus.source_id == "in-memory-fixture"

    def test_an_unknown_fixture_partition_is_a_key_error(self) -> None:
        corpus = FixtureCorpus(rows_by_partition={})
        with pytest.raises(KeyError, match="no fixture rows"):
            corpus.read(FIXTURE_NOVELTY)

    def test_sealed_and_fixture_partition_names_are_disjoint(self) -> None:
        # The fixture names are deliberately NOT the real ones, so a typo cannot turn a
        # fixture read into a holdout read.
        assert set(SEALED_PARTITIONS).isdisjoint(set(FIXTURE_PARTITIONS))
        assert SEALED_PARTITIONS == ("test-id", "test-ooa", "test-novelty")
        assert FIXTURE_PARTITIONS == ("fixture-id", "fixture-ooa", "fixture-novelty")


class TestTheSealIsStructural:
    """No sealed export exists in the repository, so there is nothing to read.

    The seal is a property of the repository and not only of this code: even a caller
    holding a complete, valid authorization gets ``SealedCorpusUnavailable``, because
    the FutureBench exporter refuses to write the sealed partitions and no file was
    ever produced.
    """

    @pytest.mark.parametrize("partition", list(SEALED_PARTITIONS))
    def test_the_canonical_reader_has_nothing_to_read(self, partition: str) -> None:
        with pytest.raises(SealedCorpusUnavailable, match="no sealed export at"):
            CanonicalSealedCorpus().read(partition)

    def test_the_canonical_sealed_export_does_not_exist(self) -> None:
        assert CANONICAL_SEALED_EXPORT_PATH.exists() is False
        assert CANONICAL_SEALED_EXPORT_PATH.name == "fc008-final-test-corpus.json"
        assert CANONICAL_SEALED_EXPORT_PATH.parent == DATA_DIR

    def test_the_data_directory_contains_only_the_development_export(self) -> None:
        # Stronger than the absence of one filename: nothing in the data directory is a
        # sealed corpus under some other name.
        present = sorted(path.name for path in DATA_DIR.glob("*.json"))
        assert present == ["fc008-development-corpus.json"]

    @pytest.mark.parametrize("partition", list(SEALED_PARTITIONS))
    def test_a_complete_authorization_still_gets_no_data(
        self, authorization: AuthorizationSet, partition: str
    ) -> None:
        assert authorization.families() == tuple(sorted(REGISTERED_FAMILIES))
        with pytest.raises(SealedCorpusUnavailable):
            open_sealed_partition(
                mode=FINAL_EVALUATION_MODE,
                partition=partition,
                authorization=authorization,
                source=CanonicalSealedCorpus(),
            )

    def test_the_canonical_reader_refuses_a_non_sealed_partition(self) -> None:
        with pytest.raises(KeyError, match="not a sealed partition"):
            CanonicalSealedCorpus().read(FIXTURE_ID)


class TestImportHasNoDataSideEffect:
    """Importing the harness computes nothing and reads no data.

    Every path into sealed data is an explicit function call, which is what makes an
    accidental opening by ``pytest`` collection, a build, or a transitive import
    impossible rather than merely unlikely.
    """

    MODULES = (evaluation_module, final_evaluation_module)

    def test_no_sealed_export_was_created_by_importing(self) -> None:
        assert CANONICAL_SEALED_EXPORT_PATH.exists() is False

    @pytest.mark.parametrize("module_name", ["evaluation", "final_evaluation"])
    def test_no_module_level_dataset_is_exposed(self, module_name: str) -> None:
        module = {
            "evaluation": evaluation_module,
            "final_evaluation": final_evaluation_module,
        }[module_name]
        for name, value in vars(module).items():
            assert not isinstance(value, EvaluationRow), name
            if isinstance(value, (list, tuple, set, frozenset)):
                assert not any(isinstance(item, EvaluationRow) for item in value), name
            if isinstance(value, dict):
                assert not any(isinstance(item, EvaluationRow) for item in value.values()), name

    def test_reloading_both_modules_reads_nothing_and_writes_nothing(self) -> None:
        # A reload re-executes the module body, which is the direct test of "importing
        # performs no data access". The original module dictionaries are restored
        # afterwards because a reload rebinds the exception and dataclass objects: the
        # names this test file imported at collection time would otherwise no longer be
        # the ones the reloaded module raises, and every later pytest.raises here would
        # stop matching for a reason that has nothing to do with the seal.
        original_evaluation = dict(vars(evaluation_module))
        original_final_evaluation = dict(vars(final_evaluation_module))
        before = sorted(path.name for path in DATA_DIR.iterdir())
        try:
            importlib.reload(evaluation_module)
            importlib.reload(final_evaluation_module)
            after = sorted(path.name for path in DATA_DIR.iterdir())
            # No exception above, no new file below, and still no sealed export.
            assert after == before
            assert CANONICAL_SEALED_EXPORT_PATH.exists() is False
            assert evaluation_module.CANONICAL_SEALED_EXPORT_PATH.exists() is False
        finally:
            evaluation_module.__dict__.clear()
            evaluation_module.__dict__.update(original_evaluation)
            final_evaluation_module.__dict__.clear()
            final_evaluation_module.__dict__.update(original_final_evaluation)

    def test_the_specification_declares_the_sprint_four_a_conditions(self) -> None:
        specification = evaluation_specification_canonical()
        assert specification["mode"] == FINAL_EVALUATION_MODE
        assert specification["authorizationIsAtomicAcrossFamilies"] is True
        assert specification["partialEvaluationRefused"] is True
        assert specification["canonicalBytesContainNoTimestamp"] is True
        assert specification["performanceDependentExit"] is False
        assert specification["sealedPartitions"] == list(SEALED_PARTITIONS)
        assert specification["fixturePartitions"] == list(FIXTURE_PARTITIONS)
        assert specification["validatedSealedCorpusRequired"] is True
        assert specification["realSealedOpeningRequiresExplicitPermit"] is True
        assert specification["physicalSealedCorpusFileTrusted"] is False
        assert specification["oneValidatedCorpusForBothFamilies"] is True
        assert specification["productionScoringDerivesPredictionsInternally"] is True
        assert specification["outputRequiredForRealOpening"] is True
        assert specification["noveltyPopulationPartition"] == "test-novelty"
        assert specification["noveltySupportedReferencePartitions"] == ["test-id", "test-ooa"]
        assert specification["noveltySupportedReferenceUsesFrozenSupportStatus"] is True
        assert specification["noveltyCallerConfigurableReference"] is False


class TestCommandLineRefusals:
    """The only entry point to the sealed partitions, exercised through its exit codes."""

    def test_a_wrong_mode_returns_two(self, capsys: pytest.CaptureFixture[str]) -> None:
        code = final_evaluation_module.main(
            ["--mode", "development", "--partition", "test-ooa", "--acknowledge-one-shot-holdout"]
        )
        assert code == 2
        captured = capsys.readouterr()
        assert "refused: --mode must be exactly 'final-evaluation'" in captured.err

    def test_a_missing_acknowledgement_returns_two(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # The flag exists purely so that running this is a sentence someone had to
        # type, not a flag inherited from shell history.
        code = final_evaluation_module.main(
            ["--mode", "final-evaluation", "--partition", "test-id"]
        )
        assert code == 2
        captured = capsys.readouterr()
        assert "--acknowledge-one-shot-holdout is required" in captured.err
        assert "consumes a one-shot holdout" in captured.err

    @pytest.mark.parametrize("partition", list(SEALED_PARTITIONS))
    def test_the_fully_explicit_correct_invocation_returns_five(
        self, partition: str, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Authorization SUCCEEDS here against real frozen repository state, and the run
        # still produces no data, because there is no sealed export to read. Exit 5 is
        # the correct and expected Sprint-4A outcome.
        code = final_evaluation_module.main(
            [
                "--mode",
                "final-evaluation",
                "--partition",
                partition,
                "--acknowledge-one-shot-holdout",
            ]
        )
        assert code == 5
        captured = capsys.readouterr()
        assert "refused:" in captured.err
        assert "enable-real-sealed-opening" in captured.err

    @pytest.mark.parametrize("partition", list(SEALED_PARTITIONS))
    def test_main_never_returns_zero_in_this_sprint(self, partition: str) -> None:
        # A zero exit would mean sealed rows had been read and counted.
        code = final_evaluation_module.main(
            [
                "--mode",
                "final-evaluation",
                "--partition",
                partition,
                "--acknowledge-one-shot-holdout",
            ]
        )
        assert code != 0

    def test_an_omitted_mode_is_an_argparse_error_rather_than_an_implied_run(self) -> None:
        # This is what keeps an ordinary test, build, or quality run from reaching the
        # sealed path: there is NO default mode that could drift into permitting it.
        parser = final_evaluation_module.build_parser()
        mode_action = next(action for action in parser._actions if action.dest == "mode")
        assert mode_action.required is True
        assert mode_action.default is None
        with pytest.raises(SystemExit) as caught:
            parser.parse_args(["--partition", "test-ooa", "--acknowledge-one-shot-holdout"])
        assert caught.value.code == 2

    def test_a_fixture_partition_is_not_even_an_accepted_argument(self) -> None:
        # --partition is restricted to the sealed names, so this command cannot be used
        # as a general evaluation runner over fixtures either.
        parser = final_evaluation_module.build_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(
                [
                    "--mode",
                    "final-evaluation",
                    "--partition",
                    FIXTURE_OOA,
                    "--acknowledge-one-shot-holdout",
                ]
            )

    def test_the_acknowledgement_flag_defaults_to_false(self) -> None:
        parser = final_evaluation_module.build_parser()
        arguments = parser.parse_args(["--mode", "final-evaluation", "--partition", "test-ooa"])
        assert arguments.acknowledge_one_shot_holdout is False
        assert arguments.output is None
        assert arguments.enable_real_sealed_opening is False


class TestAuthorizationHappyPath:
    """The refusals above are only meaningful if the honest case is accepted.

    No partition is opened in any of these tests: authorization is a separate,
    earlier act, and that separation is what makes a failure cost nothing.
    """

    def test_both_families_authorize_against_real_frozen_state(
        self, authorization: AuthorizationSet
    ) -> None:
        assert authorization.mode == FINAL_EVALUATION_MODE
        assert authorization.families() == (FACTORIZED_FAMILY, JOINT_FAMILY)
        assert set(authorization.families()) == set(REGISTERED_FAMILIES)

    def test_the_two_authorizations_agree_on_the_research_state(
        self, authorization: AuthorizationSet
    ) -> None:
        # Two independently valid authorizations could still have been granted against
        # different research states, which would make a cross-family comparison
        # meaningless while every individual check passed.
        joint = authorization.for_family(JOINT_FAMILY)
        factorized = authorization.for_family(FACTORIZED_FAMILY)
        assert joint.preregistration_sha256 == factorized.preregistration_sha256
        assert joint.artifact_manifest_sha256 == factorized.artifact_manifest_sha256
        assert authorization.preregistration_sha256 == joint.preregistration_sha256
        assert authorization.artifact_manifest_sha256 == joint.artifact_manifest_sha256

    def test_the_two_authorizations_are_still_distinct_per_family(
        self, authorization: AuthorizationSet
    ) -> None:
        joint = authorization.for_family(JOINT_FAMILY)
        factorized = authorization.for_family(FACTORIZED_FAMILY)
        assert joint.model_artifact_sha256 != factorized.model_artifact_sha256
        assert joint.calibration_artifact_sha256 != factorized.calibration_artifact_sha256
        assert joint.policy_artifact_sha256 != factorized.policy_artifact_sha256

    def test_an_unauthorized_family_lookup_raises_rather_than_returning_none(
        self, authorization: AuthorizationSet
    ) -> None:
        with pytest.raises(FinalEvaluationNotAuthorized, match="no authorization"):
            authorization.for_family("joint-logistic-v2")

    def test_the_canonical_form_names_both_registered_and_authorized_families(
        self, authorization: AuthorizationSet
    ) -> None:
        canonical = authorization.to_canonical()
        assert canonical["registeredFamilies"] == list(REGISTERED_FAMILIES)
        assert canonical["authorizedFamilies"] == list(authorization.families())
        assert canonical["evaluationSpecificationVersion"] == "1.0"


# ============================================================================
# THE EVALUATOR, ON SYNTHETIC FIXTURES ONLY
# ============================================================================

LINEAGES_THREE_PAIRS = ["L000", "L000", "L001", "L001", "L002", "L002"]
CLASSES_THREE_PAIRS = [1, 1, 2, 2, 3, 3]


class TestEvaluatorEnumeratedCases:
    """Every enumerated fixture shape, on ``fixture-*`` partitions only."""

    def test_case_1_perfect_predictions(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, 2, 3, 4, 5, 6], ["L000"] * 3 + ["L001"] * 3)
        predictions = make_predictions([1, 2, 3, 4, 5, 6], [0.9] * 6)
        metrics = evaluate_system(rows, predictions)
        assert metrics.partition == FIXTURE_ID
        assert metrics.structured_exact_match == pytest.approx(1.0, abs=TOLERANCE)
        # Six of thirteen classes observed and each perfect: 6/13 = 0.46153846...
        assert metrics.macro_f1_fixed_thirteen == pytest.approx(6.0 / 13.0, abs=TOLERANCE)
        assert metrics.macro_f1_observed_classes == pytest.approx(1.0, abs=TOLERANCE)
        assert metrics.risk_coverage.aurc == pytest.approx(0.0, abs=TOLERANCE)

    def test_case_2_all_wrong_predictions(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, 2, 3, 4, 5, 6], ["L000"] * 6)
        predictions = make_predictions([2, 3, 4, 5, 6, 7], [0.9] * 6)
        metrics = evaluate_system(rows, predictions)
        assert metrics.structured_exact_match == pytest.approx(0.0, abs=TOLERANCE)
        # No class has a true positive, so every F1 is zero and both macro variants
        # collapse to 0.0.
        assert metrics.macro_f1_fixed_thirteen == pytest.approx(0.0, abs=TOLERANCE)
        assert metrics.macro_f1_observed_classes == pytest.approx(0.0, abs=TOLERANCE)
        assert metrics.risk_coverage.aurc == pytest.approx(1.0, abs=TOLERANCE)

    def test_case_3_only_a_subset_of_the_thirteen_classes_is_present(self) -> None:
        rows = make_rows(FIXTURE_OOA, CLASSES_THREE_PAIRS, LINEAGES_THREE_PAIRS)
        predictions = make_predictions(CLASSES_THREE_PAIRS, [0.8] * 6)
        metrics = evaluate_system(rows, predictions)
        assert metrics.observed_classes == (1, 2, 3)
        # The absent ten classes keep their averaging slots: 3/13, not 1.0.
        assert metrics.macro_f1_fixed_thirteen == pytest.approx(3.0 / 13.0, abs=TOLERANCE)
        assert metrics.macro_f1_observed_classes == pytest.approx(1.0, abs=TOLERANCE)
        assert len(metrics.per_class) == 13
        unobserved = [entry for entry in metrics.per_class if entry.label > 3]
        assert len(unobserved) == 10
        assert all(entry.support == 0 and entry.f1 == 0.0 for entry in unobserved)
        assert len(metrics.confusion) == 13

    def test_case_4_tied_confidence_accepts_the_tied_group_together(self) -> None:
        rows = make_rows(FIXTURE_ID, CLASSES_THREE_PAIRS, LINEAGES_THREE_PAIRS)
        predictions = make_predictions(CLASSES_THREE_PAIRS, [0.8, 0.8, 0.8, 0.5, 0.5, 0.5])
        metrics = evaluate_system(rows, predictions)
        # Two distinct confidences, so two achievable points at coverage 3/6 and 6/6.
        coverages = [point.coverage for point in metrics.risk_coverage.points]
        assert coverages == pytest.approx([0.5, 1.0], abs=TOLERANCE)
        assert len(metrics.risk_coverage.points) == 2

    def test_case_5_confidences_exactly_on_ece_bin_boundaries(self) -> None:
        rows = make_rows(FIXTURE_ID, CLASSES_THREE_PAIRS, LINEAGES_THREE_PAIRS)
        boundaries = [1 / 15, 2 / 15, 5 / 15, 10 / 15, 14 / 15, 1.0]
        predictions = make_predictions(CLASSES_THREE_PAIRS, boundaries)
        metrics = evaluate_system(rows, predictions)
        populated = {
            entry.index: entry.count for entry in metrics.calibration.bins if entry.count > 0
        }
        # k/15 lands in bin k, and 1.0 lands in bin 14 alongside 14/15 rather than in a
        # sixteenth bin.
        assert populated == {1: 1, 2: 1, 5: 1, 10: 1, 14: 2}
        assert sum(entry.count for entry in metrics.calibration.bins) == 6

    def test_case_6_one_lineage_with_several_sibling_rows(self) -> None:
        rows = make_rows(FIXTURE_OOA, CLASSES_THREE_PAIRS, ["L000"] * 6)
        predictions = make_predictions(CLASSES_THREE_PAIRS, [0.9] * 6)
        metrics = evaluate_system(rows, predictions)
        assert metrics.record_count == 6
        # Six rows but ONE resampling unit, which is what the clustered bootstrap needs
        # to be told.
        assert metrics.parent_lineage_count == 1
        interval = bootstrap_structured_exact_match(rows, predictions)
        assert interval.lineage_count == 1
        assert interval.row_count == 6
        assert interval.low_powered is True

    def test_case_7_multiple_lineages_with_unequal_row_counts(self) -> None:
        rows = make_rows(
            FIXTURE_OOA,
            [1, 1, 1, 2, 3, 3],
            ["L000", "L000", "L000", "L001", "L002", "L002"],
        )
        predictions = make_predictions([1, 1, 1, 2, 3, 3], [0.9] * 6)
        metrics = evaluate_system(rows, predictions)
        assert metrics.record_count == 6
        assert metrics.parent_lineage_count == 3
        interval = bootstrap_structured_exact_match(rows, predictions)
        assert interval.lineage_count == 3
        assert interval.row_count == 6

    def test_case_8_coverage_targets_not_exactly_attainable(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, 2, 3], ["L000", "L000", "L001"])
        predictions = make_predictions([1, 2, 9], [0.9, 0.8, 0.7])
        metrics = evaluate_system(rows, predictions)
        matched = {entry.target: entry for entry in metrics.matched_coverage}
        # Achievable coverages are 1/3, 2/3, and 1. The 0.25 target is not among them.
        assert matched[0.25].achieved_coverage == pytest.approx(1.0 / 3.0, abs=TOLERANCE)
        assert matched[0.25].exact is False
        # Equidistant from 0.5, so the frozen tie-break takes the HIGHER coverage.
        assert matched[0.50].achieved_coverage == pytest.approx(2.0 / 3.0, abs=TOLERANCE)
        assert matched[0.50].exact is False
        assert matched[1.00].exact is True
        # Unattainable targets are reported, not dropped.
        assert len(metrics.matched_coverage) == 4

    def test_case_9_no_threshold_meets_a_fixed_risk_target(self) -> None:
        rows = make_rows(FIXTURE_OOA, [1, 2, 3, 4], ["L000", "L000", "L001", "L001"])
        predictions = make_predictions([5, 6, 7, 8], [0.9, 0.8, 0.7, 0.6])
        metrics = evaluate_system(rows, predictions)
        assert all(point.selective_risk > 0.2 for point in metrics.risk_coverage.points)
        assert len(metrics.fixed_risk) == 3
        for entry in metrics.fixed_risk:
            assert entry.available is False
            assert entry.coverage is None

    def test_case_10_every_threshold_meets_every_fixed_risk_target(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, 2, 3, 4], ["L000", "L000", "L001", "L001"])
        predictions = make_predictions([1, 2, 3, 4], [0.9, 0.8, 0.7, 0.6])
        metrics = evaluate_system(rows, predictions)
        assert len(metrics.fixed_risk) == 3
        for entry in metrics.fixed_risk:
            assert entry.available is True
            assert entry.coverage == pytest.approx(1.0, abs=TOLERANCE)
            assert entry.accepted == 4

    def test_case_13_a_novel_sample_accepted_is_a_false_acceptance(self) -> None:
        novel_rows = make_rows(
            FIXTURE_NOVELTY,
            [None, None],
            ["L000", "L000"],
            novel=[True, True],
            supported=[True, True],
        )
        supported_rows = make_rows(
            FIXTURE_ID,
            [1, 2],
            ["L001", "L001"],
            novel=[False, False],
            supported=[True, True],
        )
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=make_predictions([1, 1], [0.9, 0.9], accepted=[True, False]),
            supported_reference_rows=supported_rows,
            supported_reference_predictions=make_predictions(
                [1, 2], [0.9, 0.9], accepted=[True, True]
            ),
        )
        # Two novel rows, one accepted: false acceptance 1/2, recall 1/2.
        assert novelty.novelty_total == 2
        assert novelty.novelty_false_acceptance_rate == pytest.approx(0.5, abs=TOLERANCE)
        assert novelty.novelty_abstention_recall == pytest.approx(0.5, abs=TOLERANCE)

    def test_case_14_a_novel_sample_abstained_is_recall(self) -> None:
        novel_rows = make_rows(
            FIXTURE_NOVELTY,
            [None, None],
            ["L000", "L001"],
            novel=[True, True],
            supported=[False, False],
        )
        supported_rows = make_rows(FIXTURE_ID, [1], ["L002"], novel=[False], supported=[True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=make_predictions([1, 2], [0.2, 0.3], accepted=[False, False]),
            supported_reference_rows=supported_rows,
            supported_reference_predictions=make_predictions([1], [0.9], accepted=[True]),
        )
        assert novelty.novelty_abstention_recall == pytest.approx(1.0, abs=TOLERANCE)
        assert novelty.novelty_false_acceptance_rate == pytest.approx(0.0, abs=TOLERANCE)
        assert novelty.supported_total == 1
        assert novelty.supported_false_abstention_rate == pytest.approx(0.0, abs=TOLERANCE)

    def test_case_15_a_supported_sample_abstained_is_a_false_abstention(self) -> None:
        novel_rows = make_rows(
            FIXTURE_NOVELTY,
            [None],
            ["L-nov"],
            novel=[True],
            supported=[False],
        )
        supported_rows = make_rows(
            FIXTURE_ID,
            [1, 2, 3, 4],
            ["L000", "L000", "L001", "L001"],
            novel=[False, False, False, False],
            supported=[True, True, True, True],
        )
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=make_predictions([1], [0.2], accepted=[False]),
            supported_reference_rows=supported_rows,
            supported_reference_predictions=make_predictions(
                [1, 2, 3, 4], [0.9] * 4, accepted=[False, True, True, True]
            ),
        )
        assert novelty.supported_total == 4
        assert novelty.supported_abstained == 1
        assert novelty.supported_false_abstention_rate == pytest.approx(0.25, abs=TOLERANCE)
        assert novelty.novelty_total == 1

    def test_a_row_the_support_gates_refused_counts_as_abstained(self) -> None:
        # The deterministic gates sit in FRONT of the model, so a row they refused is
        # abstained regardless of what the policy scored.
        novel_rows = make_rows(
            FIXTURE_NOVELTY,
            [None],
            ["L000"],
            novel=[True],
            supported=[False],
        )
        supported_rows = make_rows(
            FIXTURE_ID,
            [1],
            ["L001"],
            novel=[False],
            supported=[False],
        )
        with pytest.raises(MetricInputError, match="at least one supported row"):
            evaluate_novelty(
                novel_rows=novel_rows,
                novel_predictions=make_predictions([1], [0.99], accepted=[True]),
                supported_reference_rows=supported_rows,
                supported_reference_predictions=make_predictions([1], [0.99], accepted=[True]),
            )
        supported_rows = make_rows(
            FIXTURE_ID,
            [1],
            ["L001"],
            novel=[False],
            supported=[True],
        )
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=make_predictions([1], [0.99], accepted=[True]),
            supported_reference_rows=supported_rows,
            supported_reference_predictions=make_predictions([1], [0.99], accepted=[True]),
        )
        assert novelty.novelty_abstention_recall == pytest.approx(1.0, abs=TOLERANCE)
        assert novelty.supported_false_abstention_rate == pytest.approx(0.0, abs=TOLERANCE)

    def test_a_novelty_decision_count_mismatch_is_refused(self) -> None:
        novel_rows = make_rows(FIXTURE_NOVELTY, [None, None], ["L000", "L001"], novel=[True, True])
        supported_rows = make_rows(FIXTURE_ID, [1], ["L002"], novel=[False], supported=[True])
        with pytest.raises(MetricInputError, match="novelty rows against"):
            evaluate_novelty(
                novel_rows=novel_rows,
                novel_predictions=make_predictions([1], [0.9], accepted=[False]),
                supported_reference_rows=supported_rows,
                supported_reference_predictions=make_predictions([1], [0.9], accepted=[True]),
            )


class TestNoveltySupportedReferenceBinding:
    """Supported false abstention uses the frozen supported-test reference.

    Pre-test evidence (preregistration v1.2 + Sprint-2) binds that reference to
    test-id ∪ test-ooa. These fixtures never open the real sealed partitions.
    """

    def _novel(
        self, accepted: Sequence[bool]
    ) -> tuple[tuple[EvaluationRow, ...], SystemPredictions]:
        rows = make_rows(
            FIXTURE_NOVELTY,
            [None] * len(accepted),
            [f"N{index:03d}" for index in range(len(accepted))],
            novel=[True] * len(accepted),
            supported=[False] * len(accepted),
        )
        predictions = make_predictions(
            [1] * len(accepted),
            [0.99 if flag else 0.20 for flag in accepted],
            accepted=accepted,
        )
        return rows, predictions

    def _supported(
        self,
        partition: str,
        accepted: Sequence[bool],
        *,
        supported: Sequence[bool] | None = None,
    ) -> tuple[tuple[EvaluationRow, ...], SystemPredictions]:
        flags = supported if supported is not None else [True] * len(accepted)
        rows = make_rows(
            partition,
            list(range(1, len(accepted) + 1)),
            [f"{partition}-{index:03d}" for index in range(len(accepted))],
            novel=[False] * len(accepted),
            supported=flags,
        )
        predictions = make_predictions(
            list(range(1, len(accepted) + 1)),
            [0.90 if flag else 0.20 for flag in accepted],
            accepted=accepted,
        )
        return rows, predictions

    def test_hand_calculated_union_fixture_has_literal_expected_values(self) -> None:
        # fixture-id: 2 supported, 1 accepted, 1 abstained
        # fixture-ooa: 2 supported, 2 accepted, 0 abstained
        # fixture-novelty: 2 novel unsupported, 0 accepted, 2 abstained
        novel_rows, novel_predictions = self._novel([False, False])
        id_rows, id_predictions = self._supported(FIXTURE_ID, [False, True])
        ooa_rows, ooa_predictions = self._supported(FIXTURE_OOA, [True, True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=(*id_rows, *ooa_rows),
            supported_reference_predictions=SystemPredictions(
                model_family=id_predictions.model_family,
                temperature_setting=id_predictions.temperature_setting,
                temperature=id_predictions.temperature,
                predicted_classes=(
                    id_predictions.predicted_classes + ooa_predictions.predicted_classes
                ),
                probabilities=id_predictions.probabilities + ooa_predictions.probabilities,
                confidences=id_predictions.confidences + ooa_predictions.confidences,
                accepted=id_predictions.accepted + ooa_predictions.accepted,
            ),
        )
        assert novelty.novelty_total == 2
        assert novelty.novelty_abstained == 2
        assert novelty.novelty_abstention_recall == 1.0
        assert novelty.novelty_false_acceptance_rate == 0.0
        assert novelty.supported_total == 4
        assert novelty.supported_abstained == 1
        assert novelty.supported_false_abstention_rate == 0.25
        assert novelty.novelty_population == FIXTURE_NOVELTY
        assert novelty.supported_reference_partitions == (FIXTURE_ID, FIXTURE_OOA)

    def test_novelty_partition_with_only_unsupported_rows_still_has_a_supported_denominator(
        self,
    ) -> None:
        # B3 regression: a novelty partition with zero supported rows must not
        # collapse supportedFalseAbstentionRate to the zero-division value.
        novel_rows, novel_predictions = self._novel([False, False])
        assert all(not row.supported for row in novel_rows)
        id_rows, id_predictions = self._supported(FIXTURE_ID, [False, True])
        ooa_rows, ooa_predictions = self._supported(FIXTURE_OOA, [True, True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=(*id_rows, *ooa_rows),
            supported_reference_predictions=SystemPredictions(
                model_family=id_predictions.model_family,
                temperature_setting=id_predictions.temperature_setting,
                temperature=id_predictions.temperature,
                predicted_classes=(
                    id_predictions.predicted_classes + ooa_predictions.predicted_classes
                ),
                probabilities=id_predictions.probabilities + ooa_predictions.probabilities,
                confidences=id_predictions.confidences + ooa_predictions.confidences,
                accepted=id_predictions.accepted + ooa_predictions.accepted,
            ),
        )
        assert novelty.supported_total == 4
        assert novelty.supported_false_abstention_rate == 0.25
        assert novelty.supported_false_abstention_rate != 0.0 or novelty.supported_total > 0

    def test_novelty_rates_ignore_the_supported_reference_population(self) -> None:
        # Gates passed on these novel rows so the policy acceptance is visible.
        novel_rows = make_rows(
            FIXTURE_NOVELTY,
            [None, None],
            ["N000", "N001"],
            novel=[True, True],
            supported=[True, True],
        )
        novel_predictions = make_predictions([1, 1], [0.99, 0.20], accepted=[True, False])
        supported_rows, supported_predictions = self._supported(FIXTURE_ID, [False, False, False])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novelty.novelty_total == 2
        assert novelty.novelty_abstention_recall == 0.5
        assert novelty.novelty_false_acceptance_rate == 0.5
        assert novelty.supported_total == 3

    def test_supported_false_abstention_ignores_novelty_rows(self) -> None:
        novel_rows, novel_predictions = self._novel([False, False, False])
        supported_rows, supported_predictions = self._supported(FIXTURE_OOA, [True, False])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novelty.supported_total == 2
        assert novelty.supported_abstained == 1
        assert novelty.supported_false_abstention_rate == 0.5
        assert novelty.novelty_total == 3

    def test_an_accepted_supported_row_is_not_a_false_abstention(self) -> None:
        novel_rows, novel_predictions = self._novel([False])
        supported_rows, supported_predictions = self._supported(FIXTURE_ID, [True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novelty.supported_total == 1
        assert novelty.supported_abstained == 0
        assert novelty.supported_false_abstention_rate == 0.0

    def test_an_abstained_supported_row_is_a_false_abstention(self) -> None:
        novel_rows, novel_predictions = self._novel([False])
        supported_rows, supported_predictions = self._supported(FIXTURE_ID, [False])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novelty.supported_total == 1
        assert novelty.supported_abstained == 1
        assert novelty.supported_false_abstention_rate == 1.0

    def test_an_unsupported_high_confidence_novelty_row_remains_abstained(self) -> None:
        novel_rows, novel_predictions = self._novel([True])
        supported_rows, supported_predictions = self._supported(FIXTURE_ID, [True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novel_predictions.accepted == (True,)
        assert novelty.novelty_abstention_recall == 1.0
        assert novelty.novelty_false_acceptance_rate == 0.0

    def test_unsupported_rows_in_the_reference_pool_are_excluded(self) -> None:
        novel_rows, novel_predictions = self._novel([False])
        supported_rows, supported_predictions = self._supported(
            FIXTURE_ID, [False, True], supported=[False, True]
        )
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=supported_rows,
            supported_reference_predictions=supported_predictions,
        )
        assert novelty.supported_total == 1
        assert novelty.supported_abstained == 0
        assert novelty.supported_false_abstention_rate == 0.0

    def test_an_empty_supported_reference_is_refused(self) -> None:
        novel_rows, novel_predictions = self._novel([False, False])
        empty = make_predictions([], [])
        with pytest.raises(MetricInputError, match="at least one supported row"):
            evaluate_novelty(
                novel_rows=novel_rows,
                novel_predictions=novel_predictions,
                supported_reference_rows=(),
                supported_reference_predictions=empty,
            )

    def test_the_api_is_keyword_only_and_separates_populations(self) -> None:
        parameters = inspect.signature(evaluate_novelty).parameters
        assert list(parameters) == [
            "novel_rows",
            "novel_predictions",
            "supported_reference_rows",
            "supported_reference_predictions",
        ]
        assert all(
            parameter.kind is inspect.Parameter.KEYWORD_ONLY for parameter in parameters.values()
        )
        with pytest.raises(TypeError):
            evaluate_novelty([], [])  # type: ignore[misc]

    def test_the_supported_reference_is_not_caller_configurable(self) -> None:
        assert NOVELTY_SUPPORTED_REFERENCE_PARTITIONS == ("test-id", "test-ooa")
        assert NOVELTY_POPULATION_PARTITION == "test-novelty"
        specification = evaluation_specification_canonical()
        assert specification["noveltySupportedReferencePartitions"] == ["test-id", "test-ooa"]
        assert specification["noveltyCallerConfigurableReference"] is False
        parser = final_evaluation_module.build_parser()
        flags = {action.option_strings[0] for action in parser._actions if action.option_strings}
        assert "--supported-reference" not in flags
        assert "--supported-reference-partitions" not in flags
        source = Path(evaluation_module.__file__).read_text()
        assert "os.environ" not in source
        assert "NOVELTY_SUPPORTED_REFERENCE_PARTITIONS" in source

    def test_canonical_novelty_records_the_frozen_reference_identity(self) -> None:
        novel_rows, novel_predictions = self._novel([False])
        id_rows, id_predictions = self._supported(FIXTURE_ID, [True])
        ooa_rows, ooa_predictions = self._supported(FIXTURE_OOA, [True])
        novelty = evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=novel_predictions,
            supported_reference_rows=(*id_rows, *ooa_rows),
            supported_reference_predictions=SystemPredictions(
                model_family=id_predictions.model_family,
                temperature_setting=id_predictions.temperature_setting,
                temperature=id_predictions.temperature,
                predicted_classes=(
                    id_predictions.predicted_classes + ooa_predictions.predicted_classes
                ),
                probabilities=id_predictions.probabilities + ooa_predictions.probabilities,
                confidences=id_predictions.confidences + ooa_predictions.confidences,
                accepted=id_predictions.accepted + ooa_predictions.accepted,
            ),
        )
        canonical = novelty.to_canonical()
        assert canonical["noveltyPopulation"] == FIXTURE_NOVELTY
        assert canonical["supportedReferencePartitions"] == [FIXTURE_ID, FIXTURE_OOA]
        assert "recordId" not in canonical
        assert "recordIds" not in canonical


# ============================================================================
# RQ1 AND RQ2
# ============================================================================

#: Both RQ fixtures share these rows: three lineages of two sibling rows, classes
#: 1, 1, 2, 2, 3, 3. Row 5 is the one every system gets wrong.
RQ_ROWS = make_rows(FIXTURE_OOA, CLASSES_THREE_PAIRS, LINEAGES_THREE_PAIRS)
PERFECT_PREDICTED = [1, 1, 2, 2, 3, 3]
ONE_WRONG_PREDICTED = [1, 1, 2, 2, 3, 13]

#: A well-ordered, well-scaled system: the five correct rows sit at 0.95 and the one
#: wrong row at 0.30, so confidence both matches accuracy and ranks the error last.
GOOD_CONFIDENCES = [0.95, 0.95, 0.95, 0.95, 0.95, 0.30]
#: An overconfident, badly ordered system: everything near 1.0 and the WRONG row
#: scored highest of all.
BAD_CONFIDENCES = [0.99, 0.99, 0.99, 0.99, 0.99, 0.995]


@pytest.fixture(scope="module")
def rq1_factorized_better() -> tuple[ComparisonResult, ...]:
    joint = make_predictions(
        ONE_WRONG_PREDICTED, [0.9] * 6, model_family=JOINT_FAMILY, temperature_setting="scaled"
    )
    factorized = make_predictions(
        PERFECT_PREDICTED, [0.9] * 6, model_family=FACTORIZED_FAMILY, temperature_setting="scaled"
    )
    return compare_rq1(RQ_ROWS, joint, factorized)


@pytest.fixture(scope="module")
def rq1_factorized_worse() -> tuple[ComparisonResult, ...]:
    joint = make_predictions(
        PERFECT_PREDICTED, [0.9] * 6, model_family=JOINT_FAMILY, temperature_setting="scaled"
    )
    factorized = make_predictions(
        ONE_WRONG_PREDICTED,
        [0.9] * 6,
        model_family=FACTORIZED_FAMILY,
        temperature_setting="scaled",
    )
    return compare_rq1(RQ_ROWS, joint, factorized)


@pytest.fixture(scope="module")
def rq2_scaling_helped() -> tuple[ComparisonResult, ...]:
    scaled = make_predictions(
        ONE_WRONG_PREDICTED, GOOD_CONFIDENCES, temperature_setting="scaled", temperature=1.4
    )
    unscaled = make_predictions(
        ONE_WRONG_PREDICTED, BAD_CONFIDENCES, temperature_setting="unscaled", temperature=1.0
    )
    return compare_rq2(RQ_ROWS, scaled, unscaled)


@pytest.fixture(scope="module")
def rq2_scaling_hurt() -> tuple[ComparisonResult, ...]:
    # The same two systems with their roles exchanged, so the harness is asked to
    # report a BAD calibration outcome.
    scaled = make_predictions(
        ONE_WRONG_PREDICTED, BAD_CONFIDENCES, temperature_setting="scaled", temperature=0.6
    )
    unscaled = make_predictions(
        ONE_WRONG_PREDICTED, GOOD_CONFIDENCES, temperature_setting="unscaled", temperature=1.0
    )
    return compare_rq2(RQ_ROWS, scaled, unscaled)


class TestRq1Comparison:
    def test_the_direction_is_factorized_minus_joint(
        self, rq1_factorized_better: tuple[ComparisonResult, ...]
    ) -> None:
        assert len(rq1_factorized_better) == 2
        for result in rq1_factorized_better:
            assert result.question == "RQ1"
            assert result.delta.minuend_label == FACTORIZED_FAMILY
            assert result.delta.subtrahend_label == JOINT_FAMILY
            assert result.delta.to_canonical()["direction"] == (
                "factorized-logistic minus joint-logistic"
            )

    def test_both_rq1_metrics_are_higher_is_better(
        self, rq1_factorized_better: tuple[ComparisonResult, ...]
    ) -> None:
        metrics = {result.metric for result in rq1_factorized_better}
        assert metrics == {"structuredExactMatch", "macroF1FixedThirteen"}
        for result in rq1_factorized_better:
            assert result.delta.higher_is_better is True

    def test_a_factorized_better_fixture_gives_a_positive_delta(
        self, rq1_factorized_better: tuple[ComparisonResult, ...]
    ) -> None:
        deltas = {result.metric: result.delta for result in rq1_factorized_better}
        # Factorized is perfect (6/6) and joint misses row 5 (5/6):
        #   structured exact match delta = 1.0 - 5/6 = 1/6 = 0.16666666...
        assert deltas["structuredExactMatch"].delta == pytest.approx(1.0 / 6.0, abs=TOLERANCE)
        # Factorized fixed-13 macro F1: classes 1, 2, 3 perfect -> 3/13.
        # Joint predicts 13 instead of 3 on row 5, so
        #   class 1 F1 = 1, class 2 F1 = 1,
        #   class 3: TP=1, predictedCount=1, support=2 -> P=1, R=0.5, F1=2/3,
        #   class 13: TP=0, predictedCount=1, support=0 -> F1=0,
        #   sum = 8/3, macro = (8/3)/13 = 8/39.
        # delta = 3/13 - 8/39 = 9/39 - 8/39 = 1/39 = 0.02564102...
        assert deltas["macroF1FixedThirteen"].delta == pytest.approx(1.0 / 39.0, abs=TOLERANCE)
        for delta in deltas.values():
            assert delta.delta > 0

    def test_a_factorized_worse_fixture_gives_a_negative_delta(
        self, rq1_factorized_worse: tuple[ComparisonResult, ...]
    ) -> None:
        # The harness must report a factorized model that loses just as readily as one
        # that wins; both are reportable scientific outcomes.
        deltas = {result.metric: result.delta for result in rq1_factorized_worse}
        assert deltas["structuredExactMatch"].delta == pytest.approx(-1.0 / 6.0, abs=TOLERANCE)
        assert deltas["macroF1FixedThirteen"].delta == pytest.approx(-1.0 / 39.0, abs=TOLERANCE)
        for delta in deltas.values():
            assert delta.delta < 0

    def test_each_rq1_result_carries_a_paired_clustered_interval(
        self, rq1_factorized_better: tuple[ComparisonResult, ...]
    ) -> None:
        for result in rq1_factorized_better:
            canonical = result.to_canonical()["bootstrap"]
            assert isinstance(canonical, dict)
            assert canonical["resamplingUnit"] == "parentLineageId"
            assert canonical["lineageCount"] == 3
            assert canonical["rowCount"] == 6
            assert canonical["pairedComparisonsUseIdenticalSampledGroups"] is True
            assert canonical["lowPowered"] is True

    def test_rq1_requires_every_row_to_carry_a_class_number(self) -> None:
        rows = make_rows(FIXTURE_OOA, [1, None], ["L000", "L001"])
        joint = make_predictions([1, 1], [0.9, 0.9], model_family=JOINT_FAMILY)
        factorized = make_predictions([1, 1], [0.9, 0.9], model_family=FACTORIZED_FAMILY)
        with pytest.raises(MetricInputError, match="RQ1 requires every row"):
            compare_rq1(rows, joint, factorized)


class TestRq2Comparison:
    """Every RQ2 metric is error-like, so a NEGATIVE delta favours temperature scaling."""

    METRICS = ("negativeLogLikelihood", "multiclassBrier", "expectedCalibrationError", "aurc")

    def test_all_four_metrics_are_reported_as_lower_is_better(
        self, rq2_scaling_helped: tuple[ComparisonResult, ...]
    ) -> None:
        assert tuple(result.metric for result in rq2_scaling_helped) == self.METRICS
        for result in rq2_scaling_helped:
            assert result.question == "RQ2"
            # NLL, Brier, ECE, and AURC are all errors, so the sign must never be read
            # as "higher is better".
            assert result.delta.higher_is_better is False

    def test_scaling_that_helped_gives_a_negative_delta_on_every_metric(
        self, rq2_scaling_helped: tuple[ComparisonResult, ...]
    ) -> None:
        deltas = {result.metric: result.delta.delta for result in rq2_scaling_helped}
        for metric, delta in deltas.items():
            assert delta < 0, metric

    def test_the_helped_ece_and_aurc_deltas_are_hand_computable(
        self, rq2_scaling_helped: tuple[ComparisonResult, ...]
    ) -> None:
        deltas = {result.metric: result.delta for result in rq2_scaling_helped}
        # ECE, scaled: 0.95 * 15 = 14.25 -> bin 14 (five rows, all correct),
        #              0.30 * 15 =  4.5  -> bin 4  (one row, wrong).
        #   bin 14: count 5, meanConfidence 0.95, accuracy 1.0, gap 0.05
        #   bin  4: count 1, meanConfidence 0.30, accuracy 0.0, gap 0.30
        #   ECE = (5/6)(0.05) + (1/6)(0.30) = 1/24 + 1/20 = 11/120 = 0.09166666...
        # ECE, unscaled: 0.99 * 15 = 14.85 and 0.995 * 15 = 14.925, both bin 14.
        #   count 6, meanConfidence (5(0.99) + 0.995)/6 = 5.945/6 = 0.99083333...,
        #   accuracy 5/6 = 0.83333333..., gap = 0.1575, ECE = 0.1575 = 63/400
        #   delta = 11/120 - 63/400 = 110/1200 - 189/1200 = -79/1200 = -0.06583333...
        assert deltas["expectedCalibrationError"].minuend == pytest.approx(
            11.0 / 120.0, abs=TOLERANCE
        )
        assert deltas["expectedCalibrationError"].subtrahend == pytest.approx(
            63.0 / 400.0, abs=TOLERANCE
        )
        assert deltas["expectedCalibrationError"].delta == pytest.approx(
            -79.0 / 1200.0, abs=TOLERANCE
        )
        # AURC, scaled: descending confidence gives the five correct rows first.
        #   point 1: coverage 5/6, risk 0
        #   point 2: coverage 1,   risk 1/6
        #   AURC = 0 * (5/6) + (1/6) * (1 - 5/6) = 1/36 = 0.02777777...
        # AURC, unscaled: the WRONG row has the highest confidence, so it is accepted
        # first and the curve opens at risk 1.0.
        #   point 1: coverage 1/6, risk 1
        #   point 2: coverage 1,   risk 1/6
        #   AURC = 1 * (1/6) + (1/6) * (1 - 1/6) = 1/6 + 5/36 = 11/36 = 0.30555555...
        #   delta = 1/36 - 11/36 = -10/36 = -5/18 = -0.27777777...
        assert deltas["aurc"].minuend == pytest.approx(1.0 / 36.0, abs=TOLERANCE)
        assert deltas["aurc"].subtrahend == pytest.approx(11.0 / 36.0, abs=TOLERANCE)
        assert deltas["aurc"].delta == pytest.approx(-5.0 / 18.0, abs=TOLERANCE)

    def test_scaling_that_hurt_gives_a_positive_delta_on_every_metric(
        self, rq2_scaling_hurt: tuple[ComparisonResult, ...]
    ) -> None:
        # THE HONESTY TEST. With the two systems' roles exchanged the harness must
        # report that temperature scaling made calibration WORSE, not only that it can
        # detect an improvement.
        deltas = {result.metric: result.delta.delta for result in rq2_scaling_hurt}
        for metric, delta in deltas.items():
            assert delta > 0, metric
        assert deltas["expectedCalibrationError"] == pytest.approx(79.0 / 1200.0, abs=TOLERANCE)
        assert deltas["aurc"] == pytest.approx(5.0 / 18.0, abs=TOLERANCE)

    def test_the_two_directions_are_exact_negations_of_each_other(
        self,
        rq2_scaling_helped: tuple[ComparisonResult, ...],
        rq2_scaling_hurt: tuple[ComparisonResult, ...],
    ) -> None:
        helped = {result.metric: result.delta.delta for result in rq2_scaling_helped}
        hurt = {result.metric: result.delta.delta for result in rq2_scaling_hurt}
        for metric in self.METRICS:
            assert helped[metric] == pytest.approx(-hurt[metric], abs=TOLERANCE)

    def test_the_labels_record_which_temperature_setting_each_side_was(
        self, rq2_scaling_helped: tuple[ComparisonResult, ...]
    ) -> None:
        for result in rq2_scaling_helped:
            assert result.delta.minuend_label == f"{JOINT_FAMILY}/scaled"
            assert result.delta.subtrahend_label == f"{JOINT_FAMILY}/unscaled"

    def test_comparing_across_model_families_is_refused(self) -> None:
        # RQ2 is a temperature comparison WITHIN one family; crossing families here
        # would silently turn it into a confounded RQ1.
        scaled = make_predictions(
            PERFECT_PREDICTED, [0.9] * 6, model_family=JOINT_FAMILY, temperature_setting="scaled"
        )
        unscaled = make_predictions(
            PERFECT_PREDICTED,
            [0.8] * 6,
            model_family=FACTORIZED_FAMILY,
            temperature_setting="unscaled",
        )
        with pytest.raises(MetricInputError, match="compares temperatures within one model"):
            compare_rq2(RQ_ROWS, scaled, unscaled)

    def test_rq2_requires_every_row_to_carry_a_class_number(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, None], ["L000", "L001"])
        scaled = make_predictions([1, 1], [0.9, 0.9], temperature_setting="scaled")
        unscaled = make_predictions([1, 1], [0.8, 0.8], temperature_setting="unscaled")
        with pytest.raises(MetricInputError, match="RQ2 requires every row"):
            compare_rq2(rows, scaled, unscaled)


class TestEvaluateSystemRefusals:
    def test_an_empty_partition_is_refused(self) -> None:
        predictions = make_predictions([], [])
        with pytest.raises(MetricInputError, match="empty partition"):
            evaluate_system((), predictions)

    def test_rows_spanning_multiple_partitions_are_refused(self) -> None:
        # A result artifact names ONE partition, so a mixed row set would produce a
        # number attributed to a partition it did not come from.
        rows = (
            *make_rows(FIXTURE_ID, [1, 2], ["L000", "L000"]),
            *make_rows(FIXTURE_OOA, [3], ["L001"]),
        )
        predictions = make_predictions([1, 2, 3], [0.9, 0.8, 0.7])
        with pytest.raises(MetricInputError, match="span multiple partitions"):
            evaluate_system(rows, predictions)

    def test_a_row_without_a_class_number_is_refused(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, None, 3], ["L000", "L000", "L001"])
        predictions = make_predictions([1, 2, 3], [0.9, 0.8, 0.7])
        with pytest.raises(MetricInputError, match="has no class number"):
            evaluate_system(rows, predictions)

    def test_a_prediction_count_mismatch_is_refused(self) -> None:
        rows = make_rows(FIXTURE_ID, [1, 2, 3], ["L000", "L000", "L001"])
        predictions = make_predictions([1, 2], [0.9, 0.8])
        with pytest.raises(MetricInputError, match="rows against"):
            evaluate_system(rows, predictions)

    def test_inconsistent_system_output_lengths_are_refused_at_construction(self) -> None:
        with pytest.raises(MetricInputError, match="inconsistent output lengths"):
            SystemPredictions(
                model_family=JOINT_FAMILY,
                temperature_setting="scaled",
                temperature=1.0,
                predicted_classes=(1, 2),
                probabilities=(peaked(1, 0.9),),
                confidences=(0.9, 0.9),
                accepted=(True, True),
            )


# ============================================================================
# RESULT ARTIFACT AND REPORT
# ============================================================================


def eight_partition_metrics() -> tuple[PartitionMetrics, ...]:
    """Two fixture partitions x two families x two temperature settings.

    Eight systems, every one of which must remain individually identifiable in the
    canonical output: a result that collapsed them would attribute a number to the
    wrong partition, family, or temperature.
    """
    results: list[PartitionMetrics] = []
    for partition in (FIXTURE_ID, FIXTURE_OOA):
        rows = make_rows(partition, CLASSES_THREE_PAIRS, LINEAGES_THREE_PAIRS)
        for family in (JOINT_FAMILY, FACTORIZED_FAMILY):
            for setting, confidences, temperature in (
                ("scaled", GOOD_CONFIDENCES, 1.4),
                ("unscaled", BAD_CONFIDENCES, 1.0),
            ):
                results.append(
                    evaluate_system(
                        rows,
                        make_predictions(
                            ONE_WRONG_PREDICTED,
                            confidences,
                            model_family=family,
                            temperature_setting=setting,
                            temperature=temperature,
                        ),
                    )
                )
    return tuple(results)


@pytest.fixture(scope="module")
def partition_metrics() -> tuple[PartitionMetrics, ...]:
    return eight_partition_metrics()


@pytest.fixture(scope="module")
def novelty_by_partition():
    novel_rows = make_rows(
        FIXTURE_NOVELTY,
        [None, None],
        ["L000", "L000"],
        novel=[True, True],
        supported=[False, False],
    )
    supported_rows = make_rows(
        FIXTURE_ID,
        [1, 2],
        ["L001", "L001"],
        novel=[False, False],
        supported=[True, True],
    )
    return {
        FIXTURE_NOVELTY: evaluate_novelty(
            novel_rows=novel_rows,
            novel_predictions=make_predictions([1, 1], [0.9, 0.9], accepted=[True, False]),
            supported_reference_rows=supported_rows,
            supported_reference_predictions=make_predictions(
                [1, 2], [0.9, 0.9], accepted=[True, False]
            ),
        )
    }


@pytest.fixture(scope="module")
def evaluation_result(
    authorization: AuthorizationSet,
    sealed_corpus,
    partition_metrics: tuple[PartitionMetrics, ...],
    rq1_factorized_better: tuple[ComparisonResult, ...],
    rq2_scaling_helped: tuple[ComparisonResult, ...],
    novelty_by_partition,
):
    return build_evaluation_result(
        authorization=authorization,
        sealed_corpus=sealed_corpus,
        partitions=partition_metrics,
        comparisons=(*rq1_factorized_better, *rq2_scaling_helped),
        novelty=novelty_by_partition,
    )


class TestResultArtifact:
    def test_the_result_hash_is_stable_across_identical_builds(
        self,
        authorization: AuthorizationSet,
        sealed_corpus,
        partition_metrics: tuple[PartitionMetrics, ...],
        rq1_factorized_better: tuple[ComparisonResult, ...],
    ) -> None:
        # Two independently assembled results from the same inputs must hash the same;
        # that equality is the only cheap check that a result was REPRODUCED rather
        # than merely regenerated.
        first = build_evaluation_result(
            authorization=authorization,
            sealed_corpus=sealed_corpus,
            partitions=partition_metrics,
            comparisons=rq1_factorized_better,
        )
        second = build_evaluation_result(
            authorization=authorization,
            sealed_corpus=sealed_corpus,
            partitions=eight_partition_metrics(),
            comparisons=rq1_factorized_better,
        )
        assert first.result_sha256() == second.result_sha256()
        assert len(first.result_sha256()) == 64

    def test_the_canonical_bytes_contain_no_timestamp(self, evaluation_result) -> None:
        # A wall-clock timestamp would make two identical evaluations hash differently
        # and destroy the reproduction check above.
        canonical = evaluation_result.to_canonical()
        time_key = re.compile(r"time|date|timestamp|generated", re.IGNORECASE)
        iso_like = re.compile(r"\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T")
        offenders: list[str] = []

        def walk(node: object, path: str) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if time_key.search(str(key)):
                        offenders.append(f"{path}.{key}")
                    walk(value, f"{path}.{key}")
            elif isinstance(node, (list, tuple)):
                for index, value in enumerate(node):
                    walk(value, f"{path}[{index}]")
            elif isinstance(node, str) and iso_like.search(node):
                offenders.append(f"{path} = {node!r}")

        walk(canonical, "result")
        assert offenders == []
        # Also checked on the serialized bytes, in case a future field smuggles one in
        # somewhere this walk does not reach.
        serialized = json.dumps(canonical, sort_keys=True)
        assert iso_like.search(serialized) is None

    @pytest.mark.parametrize(
        "key",
        [
            "evaluationSchemaVersion",
            "evaluationSpecificationVersion",
            "preregistrationVersion",
            "preregistrationSha256",
            "artifactManifestSha256",
            "datasetHash",
            "vocabularyHash",
            "supportMatrixVersion",
            "featurePolicyVersion",
            "sealedCorpusSha256",
            "partitionRecordCounts",
            "partitionLineageCounts",
            "modelFamilies",
            "metricDefinitions",
            "bootstrap",
            "partitions",
            "comparisons",
            "novelty",
            "limitations",
        ],
    )
    def test_every_required_identity_is_present(self, evaluation_result, key: str) -> None:
        # A result file has to be interpretable without its surrounding directory.
        canonical = evaluation_result.to_canonical()
        assert key in canonical
        assert canonical[key] not in (None, "", [])

    @pytest.mark.parametrize(
        "key",
        [
            "modelArtifactSha256",
            "calibrationArtifactSha256",
            "policyArtifactSha256",
            "modelVersion",
            "calibrationArtifactVersion",
            "abstentionPolicyVersion",
        ],
    )
    def test_every_family_carries_its_own_artifact_identities(
        self, evaluation_result, key: str
    ) -> None:
        families = evaluation_result.to_canonical()["modelFamilies"]
        assert set(families) == set(REGISTERED_FAMILIES)
        for family in REGISTERED_FAMILIES:
            assert families[family][key]
        # Per-family, not shared: the two families must not report the same artifacts.
        if key.endswith("Sha256"):
            assert families[JOINT_FAMILY][key] != families[FACTORIZED_FAMILY][key]

    def test_the_identities_come_from_the_authorization_not_the_caller(
        self, evaluation_result, authorization: AuthorizationSet
    ) -> None:
        # build_evaluation_result takes no dataset or vocabulary parameter, so a result
        # cannot claim inputs the authorization did not cover.
        canonical = evaluation_result.to_canonical()
        any_authorization = authorization.for_family(JOINT_FAMILY)
        assert canonical["datasetHash"] == any_authorization.dataset_hash
        assert canonical["vocabularyHash"] == any_authorization.vocabulary_hash
        assert canonical["supportMatrixVersion"] == any_authorization.support_matrix_version
        assert canonical["featurePolicyVersion"] == any_authorization.feature_policy_version
        assert canonical["preregistrationSha256"] == authorization.preregistration_sha256
        assert canonical["artifactManifestSha256"] == authorization.artifact_manifest_sha256
        assert canonical["evaluationSchemaVersion"] == EVALUATION_SCHEMA_VERSION

    def test_all_eight_systems_are_distinguishable_in_the_canonical_output(
        self, evaluation_result
    ) -> None:
        entries = evaluation_result.to_canonical()["partitions"]
        assert len(entries) == 8
        identities = {
            (entry["partition"], entry["modelFamily"], entry["temperatureSetting"])
            for entry in entries
        }
        assert len(identities) == 8
        assert {identity[0] for identity in identities} == {FIXTURE_ID, FIXTURE_OOA}
        assert {identity[1] for identity in identities} == set(REGISTERED_FAMILIES)
        assert {identity[2] for identity in identities} == {"scaled", "unscaled"}
        # The temperature VALUE is carried too, so scaled and unscaled are not merely
        # two labels over the same numbers.
        temperatures = {entry["temperatureSetting"]: entry["temperature"] for entry in entries}
        assert temperatures["scaled"] != temperatures["unscaled"]

    def test_the_result_embeds_the_frozen_metric_and_bootstrap_configuration(
        self, evaluation_result
    ) -> None:
        canonical = evaluation_result.to_canonical()
        definitions = canonical["metricDefinitions"]
        assert definitions["eceBinCount"] == 15
        assert definitions["absentClassesDropped"] is False
        bootstrap = canonical["bootstrap"]
        assert bootstrap["replicates"] == 5000
        assert bootstrap["resamplingUnit"] == "parentLineageId"
        assert bootstrap["pairedComparisonsUseIdenticalSampledGroups"] is True

    def test_the_default_limitations_are_carried_rather_than_optional(
        self, evaluation_result
    ) -> None:
        limitations = evaluation_result.to_canonical()["limitations"]
        assert limitations == list(DEFAULT_LIMITATIONS)
        joined = " ".join(limitations)
        assert "entirely synthetic authored content" in joined
        assert "six parent lineages" in joined
        assert "no model family winner is selected" in joined

    def test_changing_any_partition_number_changes_the_hash(
        self,
        authorization: AuthorizationSet,
        sealed_corpus,
        partition_metrics: tuple[PartitionMetrics, ...],
    ) -> None:
        # The stability test above would also pass for a hash that ignored the metrics
        # entirely, so the hash must be shown to be sensitive to them.
        baseline = build_evaluation_result(
            authorization=authorization,
            sealed_corpus=sealed_corpus,
            partitions=partition_metrics,
            comparisons=(),
        )
        nudged = build_evaluation_result(
            authorization=authorization,
            sealed_corpus=sealed_corpus,
            partitions=(
                dataclasses.replace(partition_metrics[0], structured_exact_match=0.5),
                *partition_metrics[1:],
            ),
            comparisons=(),
        )
        assert baseline.result_sha256() != nudged.result_sha256()


class TestReport:
    def test_rendering_is_deterministic(self, evaluation_result) -> None:
        assert render_report(evaluation_result) == render_report(evaluation_result)

    def test_the_required_sections_are_all_present(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        for heading in (
            "## Limitations",
            "## RQ1",
            "## RQ2",
            "## Novelty",
            "## No performance-dependent conclusion",
        ):
            assert heading in report, heading

    def test_the_limitations_appear_before_the_first_primary_result(
        self, evaluation_result
    ) -> None:
        # Not an appendix. A reader who skims must not reach a headline number before
        # reading what the holdout can support.
        report = render_report(evaluation_result)
        assert report.index("## Limitations") < report.index("## RQ1")
        assert report.index("## Limitations") < report.index("## RQ2")

    def test_the_report_states_the_six_lineage_power_limitation(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert "six parent lineages" in report
        assert OOA_POWER_LIMITATION in report
        # Every interval carries the caveat inline as well, not only in the section.
        assert "LOW POWER: 3 parent lineages" in report

    def test_the_report_states_the_synthetic_data_claim_boundary(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert "entirely synthetic authored content" in report
        assert "not evidence about real websites" in report

    def test_the_report_separates_primary_from_secondary(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert "## Secondary diagnostics by partition and system" in report
        assert "Secondary context, not primary results." in report
        assert "SECONDARY, never substituted" in report
        assert report.index("## RQ1") < report.index("## Secondary diagnostics")

    def test_the_report_names_the_direction_of_every_delta(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert "factorized-logistic minus joint-logistic" in report
        assert f"{JOINT_FAMILY}/scaled minus {JOINT_FAMILY}/unscaled" in report
        assert "so a negative delta favours temperature scaling" in report

    def test_the_report_renders_only_fixture_partitions(self, evaluation_result) -> None:
        """No sealed partition identifier appears anywhere in the rendered report.

        The check is case-sensitive on purpose. The frozen limitations deliberately
        discuss ``test-OOA`` in prose, which must stay; what must never appear is a
        lowercase partition IDENTIFIER, because that is what a row carries and what a
        section heading would print if sealed rows had been rendered.
        """
        report = render_report(evaluation_result)
        for sealed in SEALED_PARTITIONS:
            assert sealed not in report, sealed
        for fixture in (FIXTURE_ID, FIXTURE_OOA, FIXTURE_NOVELTY):
            assert fixture in report, fixture
        # Every rendered partition heading names a fixture partition.
        headings = re.findall(r"^### (\S+) —", report, flags=re.MULTILINE)
        assert headings
        assert set(headings) <= set(FIXTURE_PARTITIONS)

    def test_the_report_refuses_to_declare_a_winner(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert "No model family winner is selected from these results" in report
        assert "are all reportable scientific outcomes" in report

    def test_a_result_without_comparisons_still_renders(
        self,
        authorization: AuthorizationSet,
        sealed_corpus,
        partition_metrics: tuple[PartitionMetrics, ...],
    ) -> None:
        bare = build_evaluation_result(
            authorization=authorization,
            sealed_corpus=sealed_corpus,
            partitions=partition_metrics,
            comparisons=(),
        )
        report = render_report(bare)
        assert "No RQ1 comparison present in this result." in report
        assert "No RQ2 comparison present in this result." in report
        assert "No novelty partition present in this result." in report
        # The limitations are populated from the artifact, so they cannot go missing.
        assert "## Limitations" in report
        assert "six parent lineages" in report

    def test_the_novelty_section_disclaims_out_of_distribution_detection(
        self, evaluation_result
    ) -> None:
        report = render_report(evaluation_result)
        assert "Not a statistical out-of-distribution detector" in report
        assert "never tuned on novelty data" in report
        assert "frozen supported-reference" in report
        assert FIXTURE_NOVELTY in report

    def test_the_report_carries_the_result_hash_and_provenance(self, evaluation_result) -> None:
        report = render_report(evaluation_result)
        assert evaluation_result.result_sha256() in report
        assert evaluation_result.authorization.preregistration_sha256 in report
        assert evaluation_result.authorization.artifact_manifest_sha256 in report
        assert evaluation_result.sealed_corpus_sha256 in report


class TestNoRealFinalDataWasTouched:
    def test_the_real_opening_count_is_still_zero(self) -> None:
        # The only evidence that matters at the end of the run: no sealed export was
        # created, and every sealed read still raises.
        assert CANONICAL_SEALED_EXPORT_PATH.exists() is False
        for partition in SEALED_PARTITIONS:
            with pytest.raises(SealedCorpusUnavailable):
                CanonicalSealedCorpus().read(partition)

    def test_every_fixture_used_in_this_module_is_an_in_memory_literal(self) -> None:
        # make_rows asserts its partition is a fixture name, so the only way a row in
        # this module could carry a sealed partition is if that assertion were removed.
        for partition in SEALED_PARTITIONS:
            with pytest.raises(AssertionError):
                make_rows(partition, [1], ["L000"])
        for partition in FIXTURE_PARTITIONS:
            rows = make_rows(partition, [1], ["L000"])
            assert rows[0].partition == partition

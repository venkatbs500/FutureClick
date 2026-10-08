"""Tests for the boundaries: sealed partitions, the unlock contract, and warnings.

Each test here breaks something on purpose. A guard that has only ever been exercised
on well-formed input is untested, because a passing run is indistinguishable from a
guard that does nothing.
"""

from __future__ import annotations

import ast
import dataclasses
import json
import re
import warnings
from pathlib import Path

import pytest

from futurebench.fc008.canonical import canonical_bytes, sha256_hex
from futurebench.fc008.corpus import (
    CALIBRATION,
    DEVELOPMENT_PARTITIONS,
    POLICY_VALIDATION,
    SEALED_PARTITIONS,
    TRAIN,
    AccessLedger,
    SealedPartitionError,
    load_development_corpus,
)
from futurebench.fc008.unlock import (
    CANONICAL_ARTIFACT_MANIFEST_PATH,
    CROSS_CHECKED_SHARED_IDENTITIES,
    FACTORIZED_FAMILY,
    FINAL_EVALUATION_MODE,
    FROZEN_FC008_ARTIFACT_MANIFEST_SHA256,
    JOINT_FAMILY,
    REQUIRED_IDENTITIES,
    ArtifactContext,
    FinalEvaluationLocked,
    FrozenIdentityUnavailable,
    FrozenResearchIdentity,
    assert_authorization_matches_artifacts,
    authorization_parameter_names,
    authorize_final_evaluation,
    load_frozen_research_identity,
    load_trusted_research_identity,
    read_canonical_manifest_sha256,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_ROOT = REPOSITORY_ROOT / "research" / "futurebench"
EXPORT_PATH = RESEARCH_ROOT / "data" / "fc008-development-corpus.json"
ARTIFACT_DIR = RESEARCH_ROOT / "artifacts"
MANIFEST_PATH = ARTIFACT_DIR / "fc008-artifact-manifest.json"


@pytest.fixture
def corpus():
    return load_development_corpus(EXPORT_PATH)


@pytest.fixture(scope="module")
def frozen_identity() -> FrozenResearchIdentity:
    # Through the production entry point, so the fixture exercises the anchored path
    # rather than a parser call the production code no longer makes.
    identity, _ = load_trusted_research_identity()
    return identity


def context_for(frozen: FrozenResearchIdentity, model_family: str) -> ArtifactContext:
    """The actuals a correctly configured Sprint-4 caller would present.

    Built from the registry so the honest case is exact by construction, which leaves
    the tests free to corrupt one field at a time and observe the refusal.
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


class TestSealedPartitionGuard:
    @pytest.mark.parametrize("partition", SEALED_PARTITIONS)
    def test_partition_view_refuses_every_sealed_partition(self, corpus, partition):
        with pytest.raises(SealedPartitionError):
            corpus.partition_view(partition)

    @pytest.mark.parametrize("partition", SEALED_PARTITIONS)
    def test_weight_fitting_path_refuses_sealed_partitions(self, corpus, partition):
        # `matrix` is the only way design matrices are built, so refusing here closes
        # the weight-fitting path rather than one call site in it.
        with pytest.raises(SealedPartitionError):
            corpus.matrix(partition)

    @pytest.mark.parametrize("partition", SEALED_PARTITIONS)
    def test_head_label_path_refuses_sealed_partitions(self, corpus, partition):
        with pytest.raises(SealedPartitionError):
            corpus.head_labels(partition)

    @pytest.mark.parametrize("partition", SEALED_PARTITIONS)
    def test_bootstrap_grouping_path_refuses_sealed_partitions(self, corpus, partition):
        with pytest.raises(SealedPartitionError):
            corpus.parent_lineages(partition)

    def test_development_partitions_are_readable(self, corpus):
        for partition in DEVELOPMENT_PARTITIONS:
            assert len(corpus.partition_view(partition)) == 143

    def test_loading_an_export_containing_sealed_rows_is_refused(self, tmp_path):
        import json

        document = json.loads(EXPORT_PATH.read_text())
        smuggled = dict(document["rows"][0])
        smuggled["partition"] = "test-ooa"
        smuggled["recordId"] = "smuggled"
        document["rows"] = [*document["rows"], smuggled]
        path = tmp_path / "contaminated.json"
        path.write_text(json.dumps(document))
        with pytest.raises(SealedPartitionError):
            load_development_corpus(path)

    def test_the_real_export_contains_no_sealed_row(self, corpus):
        assert {row.partition for row in corpus.rows} == set(DEVELOPMENT_PARTITIONS)
        assert len(corpus.rows) == 429


class TestAccessLedger:
    def test_distinct_rows_and_access_events_are_counted_separately(self, corpus):
        corpus.partition_view(TRAIN)
        corpus.partition_view(TRAIN)
        report = corpus.ledger.to_canonical()
        train = next(
            entry for entry in report["developmentRowsAccessed"] if entry["partition"] == TRAIN
        )
        # Two reads of 143 rows: 143 distinct, 286 events. Conflating them would
        # either invent rows or hide the repeated read.
        assert train["distinctRows"] == 143
        assert train["accessEvents"] == 286

    def test_sealed_partitions_report_zero_because_nothing_was_read(self, corpus):
        corpus.matrix(TRAIN)
        corpus.matrix(CALIBRATION)
        corpus.matrix(POLICY_VALIDATION)
        report = corpus.ledger.to_canonical()
        assert report["sealedTotalRowsAccessed"] == 0
        assert report["sealedTotalAccessEvents"] == 0
        for entry in report["sealedRowsAccessed"]:
            assert entry["distinctRows"] == 0
            assert entry["accessEvents"] == 0

    def test_the_ledger_would_report_a_sealed_read_if_one_happened(self):
        # The zero above must be a measurement, not a hard-coded constant. Writing a
        # sealed partition straight into the ledger proves the counter is live.
        ledger = AccessLedger()
        ledger.record("test-ooa", ("a", "b"))
        report = ledger.to_canonical()
        assert report["sealedTotalRowsAccessed"] == 2


class TestFamilyBoundUnlock:
    """The unlock must bind an authorization to one family's exact artifact triplet.

    The defect these tests exist for is subtle: the previous contract compared a
    caller-supplied "claimed" dictionary against a caller-supplied "frozen" dictionary
    and named no model family, so it proved only that the caller agreed with itself,
    and a token obtained while holding one family's artifacts carried nothing that
    tied it to them. Both halves are tested here — that expectations come from
    repository state, and that a token cannot be spent on the wrong family.
    """

    def test_the_trusted_registry_comes_from_repository_state_alone(self, frozen_identity):
        # The only argument is a path. There is no parameter through which a caller
        # could describe what it expects to find, which is the structural fix.
        import inspect

        signature = inspect.signature(load_frozen_research_identity)
        assert list(signature.parameters) == ["manifest_path"]
        assert set(frozen_identity.families) == {JOINT_FAMILY, FACTORIZED_FAMILY}

    def test_authorize_accepts_no_caller_supplied_trust_root(self):
        # The signature IS the guarantee. A caller cannot define the expected identities
        # ("claimed"/"frozen"), and after A3 cannot redirect which manifest supplies them
        # ("manifest_path") either. Asserting the exact parameter set rather than the
        # absence of particular names means a future parameter of any name that could
        # carry a trust root fails this test.
        parameters = authorization_parameter_names()
        assert parameters == {"mode", "model_family", "actual"}
        for forbidden in ("claimed", "frozen", "manifest_path", "manifest", "expected"):
            assert forbidden not in parameters

    def test_registry_hashes_are_derived_from_the_bytes_on_disk(self, frozen_identity):
        for model_family in (JOINT_FAMILY, FACTORIZED_FAMILY):
            entry = frozen_identity.family(model_family)
            for suffix, recorded in (
                ("model", entry.model_artifact_sha256),
                ("calibration", entry.calibration_artifact_sha256),
                ("policy", entry.policy_artifact_sha256),
            ):
                path = ARTIFACT_DIR / f"fc008-{model_family}-{suffix}.json"
                assert sha256_hex(path.read_bytes()) == recorded

    @pytest.mark.parametrize("model_family", [JOINT_FAMILY, FACTORIZED_FAMILY])
    def test_exact_family_triplet_authorizes(self, frozen_identity, model_family):
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=model_family,
            actual=context_for(frozen_identity, model_family),
        )
        assert authorization.model_family == model_family
        entry = frozen_identity.family(model_family)
        assert authorization.model_artifact_sha256 == entry.model_artifact_sha256
        assert authorization.calibration_artifact_sha256 == entry.calibration_artifact_sha256
        assert authorization.policy_artifact_sha256 == entry.policy_artifact_sha256

    def test_the_two_families_receive_different_authorizations(self, frozen_identity):
        joint = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=JOINT_FAMILY,
            actual=context_for(frozen_identity, JOINT_FAMILY),
        )
        factorized = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=FACTORIZED_FAMILY,
            actual=context_for(frozen_identity, FACTORIZED_FAMILY),
        )
        assert joint != factorized
        assert joint.model_artifact_sha256 != factorized.model_artifact_sha256
        assert joint.calibration_artifact_sha256 != factorized.calibration_artifact_sha256
        assert joint.policy_artifact_sha256 != factorized.policy_artifact_sha256

    def test_the_authorization_token_is_immutable(self, frozen_identity):
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=JOINT_FAMILY,
            actual=context_for(frozen_identity, JOINT_FAMILY),
        )
        # A mutable token could be edited into a permit for the other family after it
        # was legitimately obtained.
        with pytest.raises(dataclasses.FrozenInstanceError):
            authorization.model_family = FACTORIZED_FAMILY  # type: ignore[misc]

    def test_a_joint_authorization_cannot_be_spent_on_factorized_artifacts(self, frozen_identity):
        joint = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=JOINT_FAMILY,
            actual=context_for(frozen_identity, JOINT_FAMILY),
        )
        with pytest.raises(FinalEvaluationLocked) as error:
            assert_authorization_matches_artifacts(
                joint, context_for(frozen_identity, FACTORIZED_FAMILY)
            )
        assert "modelFamily" in str(error.value)

    def test_a_factorized_authorization_cannot_be_spent_on_joint_artifacts(self, frozen_identity):
        factorized = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=FACTORIZED_FAMILY,
            actual=context_for(frozen_identity, FACTORIZED_FAMILY),
        )
        with pytest.raises(FinalEvaluationLocked):
            assert_authorization_matches_artifacts(
                factorized, context_for(frozen_identity, JOINT_FAMILY)
            )

    def test_a_matching_authorization_passes_the_second_check(self, frozen_identity):
        # The refusals above are only meaningful if the agreeing case is accepted.
        for model_family in (JOINT_FAMILY, FACTORIZED_FAMILY):
            actual = context_for(frozen_identity, model_family)
            authorization = authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=model_family,
                actual=actual,
            )
            assert_authorization_matches_artifacts(authorization, actual)

    @pytest.mark.parametrize(
        ("requested", "donor", "swapped"),
        [
            (JOINT_FAMILY, FACTORIZED_FAMILY, "calibration_artifact_sha256"),
            (JOINT_FAMILY, FACTORIZED_FAMILY, "policy_artifact_sha256"),
            (JOINT_FAMILY, FACTORIZED_FAMILY, "model_artifact_sha256"),
            (FACTORIZED_FAMILY, JOINT_FAMILY, "calibration_artifact_sha256"),
            (FACTORIZED_FAMILY, JOINT_FAMILY, "policy_artifact_sha256"),
            (FACTORIZED_FAMILY, JOINT_FAMILY, "model_artifact_sha256"),
        ],
    )
    def test_mixed_family_triplets_are_refused(self, frozen_identity, requested, donor, swapped):
        actual = dataclasses.replace(
            context_for(frozen_identity, requested),
            **{swapped: getattr(frozen_identity.family(donor), swapped)},
        )
        with pytest.raises(FinalEvaluationLocked) as error:
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=requested,
                actual=actual,
            )
        # The message must name the donor family, so a mixed triplet is diagnosable
        # rather than appearing as an inscrutable hash mismatch.
        assert donor in str(error.value)

    @pytest.mark.parametrize(
        "field",
        [
            "model_artifact_sha256",
            "calibration_artifact_sha256",
            "policy_artifact_sha256",
            "model_version",
            "calibration_artifact_version",
            "abstention_policy_version",
            "dataset_hash",
            "vocabulary_hash",
            "support_matrix_version",
            "feature_policy_version",
            "preregistration_sha256",
        ],
    )
    def test_any_single_identity_drifting_refuses(self, frozen_identity, field):
        actual = dataclasses.replace(
            context_for(frozen_identity, JOINT_FAMILY), **{field: "drifted"}
        )
        with pytest.raises(FinalEvaluationLocked):
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=actual,
            )

    @pytest.mark.parametrize(
        "field",
        [
            "model_artifact_sha256",
            "calibration_artifact_sha256",
            "policy_artifact_sha256",
            "model_version",
            "calibration_artifact_version",
            "abstention_policy_version",
            "dataset_hash",
            "vocabulary_hash",
            "support_matrix_version",
            "feature_policy_version",
            "preregistration_sha256",
        ],
    )
    def test_any_single_identity_absent_refuses(self, frozen_identity, field):
        # Default-deny. An empty identity must not read as agreement.
        actual = dataclasses.replace(context_for(frozen_identity, JOINT_FAMILY), **{field: ""})
        with pytest.raises(FinalEvaluationLocked) as error:
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=actual,
            )
        assert "absent" in str(error.value)

    def test_a_loaded_family_disagreeing_with_the_request_refuses(self, frozen_identity):
        actual = dataclasses.replace(
            context_for(frozen_identity, JOINT_FAMILY), model_family=FACTORIZED_FAMILY
        )
        with pytest.raises(FinalEvaluationLocked) as error:
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=actual,
            )
        assert FACTORIZED_FAMILY in str(error.value)

    @pytest.mark.parametrize("model_family", ["", "joint", "logistic", "joint-logistic-v2", "None"])
    def test_an_unregistered_family_refuses(self, frozen_identity, model_family):
        with pytest.raises(FinalEvaluationLocked) as error:
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=model_family,
                actual=context_for(frozen_identity, JOINT_FAMILY),
            )
        assert "registered model" in str(error.value)

    @pytest.mark.parametrize("mode", ["", "development", "FINAL-EVALUATION", "final_evaluation"])
    def test_a_wrong_mode_refuses(self, frozen_identity, mode):
        with pytest.raises(FinalEvaluationLocked):
            authorize_final_evaluation(
                mode=mode,
                model_family=JOINT_FAMILY,
                actual=context_for(frozen_identity, JOINT_FAMILY),
            )

    def test_refusal_is_an_exception_rather_than_a_falsy_return(self, frozen_identity):
        # A caller who ignored a falsy return would go on to evaluate test data, so the
        # refusal must not be expressible as a value that can be discarded.
        import inspect

        annotation = str(inspect.signature(authorize_final_evaluation).return_annotation)
        assert "FinalEvaluationAuthorization" in annotation
        assert "None" not in annotation
        assert "bool" not in annotation

    def test_the_second_check_also_refuses_a_non_final_evaluation_mode(self, frozen_identity):
        authorization = dataclasses.replace(
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=context_for(frozen_identity, JOINT_FAMILY),
            ),
            mode="development",
        )
        with pytest.raises(FinalEvaluationLocked):
            assert_authorization_matches_artifacts(
                authorization, context_for(frozen_identity, JOINT_FAMILY)
            )


class TestTrustedRegistryIntegrity:
    """The registry must refuse to form when repository state is inconsistent.

    These matter because the registry is the trust root. If it could be built from a
    manifest that disagreed with its own files, every authorization downstream would
    inherit that disagreement while looking rigorous.
    """

    @staticmethod
    def _materialize(tmp_path: Path) -> Path:
        destination = tmp_path / "artifacts"
        destination.mkdir()
        for path in ARTIFACT_DIR.glob("*.json"):
            (destination / path.name).write_bytes(path.read_bytes())
        return destination / "fc008-artifact-manifest.json"

    def test_a_faithful_copy_builds(self, tmp_path):
        identity = load_frozen_research_identity(self._materialize(tmp_path))
        assert set(identity.families) == {JOINT_FAMILY, FACTORIZED_FAMILY}

    def test_a_missing_manifest_refuses(self, tmp_path):
        with pytest.raises(FrozenIdentityUnavailable):
            load_frozen_research_identity(tmp_path / "absent.json")

    def test_a_manifest_hash_disagreeing_with_the_file_refuses(self, tmp_path):
        manifest_path = self._materialize(tmp_path)
        document = json.loads(manifest_path.read_text())
        for entry in document["artifacts"]:
            if entry["name"] == f"{JOINT_FAMILY}-model":
                entry["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(document))
        with pytest.raises(FrozenIdentityUnavailable) as error:
            load_frozen_research_identity(manifest_path)
        assert "manifest records" in str(error.value)

    def test_a_missing_artifact_file_refuses(self, tmp_path):
        manifest_path = self._materialize(tmp_path)
        (manifest_path.parent / f"fc008-{FACTORIZED_FAMILY}-policy.json").unlink()
        with pytest.raises(FrozenIdentityUnavailable) as error:
            load_frozen_research_identity(manifest_path)
        assert "not on disk" in str(error.value)

    def test_identity_is_not_taken_from_the_filename(self, tmp_path):
        # Swap the two families' model bodies while keeping the filenames and manifest
        # hashes consistent. A registry that trusted the name would accept this.
        manifest_path = self._materialize(tmp_path)
        directory = manifest_path.parent
        joint_path = directory / f"fc008-{JOINT_FAMILY}-model.json"
        factorized_path = directory / f"fc008-{FACTORIZED_FAMILY}-model.json"
        joint_bytes = joint_path.read_bytes()
        factorized_bytes = factorized_path.read_bytes()
        joint_path.write_bytes(factorized_bytes)
        factorized_path.write_bytes(joint_bytes)

        document = json.loads(manifest_path.read_text())
        for entry in document["artifacts"]:
            if entry["name"] == f"{JOINT_FAMILY}-model":
                entry["sha256"] = sha256_hex(factorized_bytes)
                entry["byteLength"] = len(factorized_bytes)
            elif entry["name"] == f"{FACTORIZED_FAMILY}-model":
                entry["sha256"] = sha256_hex(joint_bytes)
                entry["byteLength"] = len(joint_bytes)
        manifest_path.write_text(json.dumps(document))

        with pytest.raises(FrozenIdentityUnavailable) as error:
            load_frozen_research_identity(manifest_path)
        assert "declares modelFamily" in str(error.value)

    def test_a_broken_triplet_reference_chain_refuses(self, tmp_path):
        manifest_path = self._materialize(tmp_path)
        directory = manifest_path.parent
        policy_path = directory / f"fc008-{JOINT_FAMILY}-policy.json"
        document = json.loads(policy_path.read_text())
        document["calibrationArtifactSha256"] = "1" * 64
        raw = canonical_bytes(document)
        policy_path.write_bytes(raw)

        manifest = json.loads(manifest_path.read_text())
        for entry in manifest["artifacts"]:
            if entry["name"] == f"{JOINT_FAMILY}-policy":
                entry["sha256"] = sha256_hex(raw)
                entry["byteLength"] = len(raw)
        manifest_path.write_text(json.dumps(manifest))

        with pytest.raises(FrozenIdentityUnavailable) as error:
            load_frozen_research_identity(manifest_path)
        assert "different calibration artifact" in str(error.value)

    def test_a_preregistration_claiming_final_results_refuses(self, tmp_path):
        manifest_path = self._materialize(tmp_path)
        directory = manifest_path.parent
        prereg_path = directory / "fc008-preregistration.json"
        document = json.loads(prereg_path.read_text())
        document["finalTestResultsPresent"] = True
        raw = canonical_bytes(document)
        prereg_path.write_bytes(raw)

        manifest = json.loads(manifest_path.read_text())
        manifest["preregistrationSha256"] = sha256_hex(raw)
        for entry in manifest["artifacts"]:
            if entry["name"] == "preregistration":
                entry["sha256"] = sha256_hex(raw)
                entry["byteLength"] = len(raw)
        manifest_path.write_text(json.dumps(manifest))

        with pytest.raises(FrozenIdentityUnavailable):
            load_frozen_research_identity(manifest_path)


class TestAnchoredTrustRoot:
    """The trust root must be a property of the repository, not of the caller.

    A2 moved the EXPECTED identities out of the caller's hands but left the caller
    choosing which file supplied them, and never compared that file to anything outside
    itself. These tests pin both halves of the A3 correction: the path is anchored to
    the module, and the bytes are anchored to a constant in source.
    """

    def test_the_canonical_manifest_path_is_anchored_to_the_module(self):
        assert CANONICAL_ARTIFACT_MANIFEST_PATH.is_absolute()
        assert CANONICAL_ARTIFACT_MANIFEST_PATH.is_file()
        assert CANONICAL_ARTIFACT_MANIFEST_PATH == MANIFEST_PATH

    def test_the_canonical_path_does_not_depend_on_the_working_directory(
        self, tmp_path, monkeypatch
    ):
        # Resolved at import from __file__, so chdir cannot move it. Checked by actually
        # changing directory rather than by reading the source, because the claim is
        # about runtime behaviour.
        monkeypatch.chdir(tmp_path)
        assert read_canonical_manifest_sha256() == FROZEN_FC008_ARTIFACT_MANIFEST_SHA256
        identity, sha = load_trusted_research_identity()
        assert sha == FROZEN_FC008_ARTIFACT_MANIFEST_SHA256
        assert set(identity.families) == {JOINT_FAMILY, FACTORIZED_FAMILY}

    def test_the_canonical_manifest_matches_the_external_trust_anchor(self):
        # The coupling that makes the anchor meaningful: editing the manifest without
        # updating the constant must break the build, not pass quietly.
        assert sha256_hex(MANIFEST_PATH.read_bytes()) == FROZEN_FC008_ARTIFACT_MANIFEST_SHA256

    def test_the_anchor_is_not_read_from_the_manifest_it_verifies(self):
        # If the expected hash lived in the manifest, the file would vouch for itself.
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        assert FROZEN_FC008_ARTIFACT_MANIFEST_SHA256 not in json.dumps(manifest)
        source = (RESEARCH_ROOT / "src" / "futurebench" / "fc008" / "unlock.py").read_text(
            encoding="utf-8"
        )
        assert FROZEN_FC008_ARTIFACT_MANIFEST_SHA256 in source

    def test_the_manifest_does_not_contain_its_own_hash(self):
        # No circular claim: the DAG stays non-recursive and the anchor stays external.
        raw = MANIFEST_PATH.read_bytes()
        assert sha256_hex(raw) not in raw.decode("utf-8")

    def test_a_manifest_byte_change_breaks_the_anchor(self, tmp_path, monkeypatch):
        import futurebench.fc008.unlock as unlock

        original = MANIFEST_PATH.read_bytes()
        mutated = tmp_path / "fc008-artifact-manifest.json"
        mutated.write_bytes(original + b" ")
        monkeypatch.setattr(unlock, "CANONICAL_ARTIFACT_MANIFEST_PATH", mutated)
        with pytest.raises(FrozenIdentityUnavailable) as caught:
            unlock.load_trusted_research_identity()
        assert "trust anchor" in str(caught.value)

    def test_a_missing_canonical_manifest_refuses(self, tmp_path, monkeypatch):
        import futurebench.fc008.unlock as unlock

        monkeypatch.setattr(unlock, "CANONICAL_ARTIFACT_MANIFEST_PATH", tmp_path / "absent.json")
        with pytest.raises(FrozenIdentityUnavailable):
            unlock.load_trusted_research_identity()


class TestArbitraryManifestAttack:
    """A self-consistent manifest somewhere else must not become the trust root."""

    @staticmethod
    def _alternate_state(tmp_path: Path) -> Path:
        """A complete, internally consistent copy of the frozen state, relocated.

        Every file is copied and every recorded hash is correct, so the alternate state
        passes every *internal* check. It is refused only because it is not the anchored
        manifest, which is precisely the property under test.
        """
        destination = tmp_path / "artifacts"
        (destination / "history").mkdir(parents=True)
        for path in ARTIFACT_DIR.glob("*.json"):
            (destination / path.name).write_bytes(path.read_bytes())
        for path in (ARTIFACT_DIR / "history").glob("*.json"):
            (destination / "history" / path.name).write_bytes(path.read_bytes())
        return destination / "fc008-artifact-manifest.json"

    def test_the_alternate_state_is_internally_consistent(self, tmp_path):
        # Establishes that the refusal below is about the trust root and not about the
        # copy being malformed. Without this the next test could pass for a wrong reason.
        identity = load_frozen_research_identity(self._alternate_state(tmp_path))
        assert set(identity.families) == {JOINT_FAMILY, FACTORIZED_FAMILY}

    def test_an_alternate_manifest_cannot_be_passed_to_authorization(self, tmp_path):
        self._alternate_state(tmp_path)
        # There is no parameter to pass it through. This is the structural guarantee:
        # not "the wrong manifest is rejected" but "the wrong manifest cannot be named".
        assert "manifest_path" not in authorization_parameter_names()
        with pytest.raises(TypeError):
            authorize_final_evaluation(  # type: ignore[call-arg]
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=context_for(
                    load_frozen_research_identity(self._alternate_state(tmp_path / "second")),
                    JOINT_FAMILY,
                ),
                manifest_path=tmp_path / "artifacts" / "fc008-artifact-manifest.json",
            )

    def test_authorization_uses_the_anchored_manifest_not_a_relocated_one(
        self, tmp_path, monkeypatch
    ):
        # Standing in the alternate directory changes nothing, because the anchor is not
        # relative to where the process happens to be running.
        manifest_path = self._alternate_state(tmp_path)
        monkeypatch.chdir(manifest_path.parent)
        identity, sha = load_trusted_research_identity()
        assert sha == FROZEN_FC008_ARTIFACT_MANIFEST_SHA256
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=JOINT_FAMILY,
            actual=context_for(identity, JOINT_FAMILY),
        )
        assert authorization.artifact_manifest_sha256 == FROZEN_FC008_ARTIFACT_MANIFEST_SHA256

    def test_a_forged_family_in_an_alternate_manifest_cannot_authorize(self, tmp_path):
        """The realistic attack: build a state whose artifacts you control, then spend it.

        The forged triplet is coherent end to end — bodies edited, references repaired,
        manifest hashes recomputed — so it authorizes happily against its own registry.
        Presented to the production API it fails on the artifact hashes, because the
        expected values come from the anchored manifest and never from the attacker.
        """
        manifest_path = self._alternate_state(tmp_path)
        directory = manifest_path.parent
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        model_file = directory / f"fc008-{JOINT_FAMILY}-model.json"
        model = json.loads(model_file.read_text(encoding="utf-8"))
        model["intercepts"] = [value + 1.0 for value in model["intercepts"]]
        model_bytes = canonical_bytes(model)
        model_file.write_bytes(model_bytes)
        forged_model_sha = sha256_hex(model_bytes)

        for kind in ("calibration", "policy"):
            path = directory / f"fc008-{JOINT_FAMILY}-{kind}.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            document["modelArtifactSha256"] = forged_model_sha
            raw = canonical_bytes(document)
            path.write_bytes(raw)
            if kind == "calibration":
                forged_calibration_sha = sha256_hex(raw)
        policy_path = directory / f"fc008-{JOINT_FAMILY}-policy.json"
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        policy["calibrationArtifactSha256"] = forged_calibration_sha
        policy_path.write_bytes(canonical_bytes(policy))

        for entry in manifest["artifacts"]:
            path = directory / entry["fileName"]
            raw = path.read_bytes()
            entry["sha256"] = sha256_hex(raw)
            entry["byteLength"] = len(raw)
        manifest_path.write_bytes(canonical_bytes(manifest))

        forged = load_frozen_research_identity(manifest_path)
        assert forged.family(JOINT_FAMILY).model_artifact_sha256 == forged_model_sha

        with pytest.raises(FinalEvaluationLocked) as caught:
            authorize_final_evaluation(
                mode=FINAL_EVALUATION_MODE,
                model_family=JOINT_FAMILY,
                actual=context_for(forged, JOINT_FAMILY),
            )
        assert "modelArtifactSha256" in str(caught.value)


class TestManifestToArtifactBodyConsistency:
    """The B2 HIGH: a manifest contradicting its own artifacts must not build a registry.

    Re-deriving each file's hash catches a manifest that misreports a file. It does not
    catch a manifest whose top-level research identities disagree with what every
    artifact body says, because those were previously only compared across the triplet.
    """

    @staticmethod
    def _materialize(tmp_path: Path) -> Path:
        destination = tmp_path / "artifacts"
        destination.mkdir(parents=True, exist_ok=True)
        for path in ARTIFACT_DIR.glob("*.json"):
            (destination / path.name).write_bytes(path.read_bytes())
        return destination / "fc008-artifact-manifest.json"

    @staticmethod
    def _rehash(manifest_path: Path, family: str = JOINT_FAMILY) -> None:
        """Make the state fully self-consistent again except for the mutation under test.

        Editing a model or calibration body changes its hash, which breaks the
        triplet reference chain — so without this repair the mutation tests would be
        caught by the reference check and prove nothing about manifest-to-body
        cross-checking. Repairing the chain and every recorded file hash leaves exactly
        one contradiction standing, which is the one being tested.
        """
        directory = manifest_path.parent
        model_path = directory / f"fc008-{family}-model.json"
        calibration_path = directory / f"fc008-{family}-calibration.json"
        policy_path = directory / f"fc008-{family}-policy.json"

        model_sha = sha256_hex(model_path.read_bytes())
        calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
        calibration["modelArtifactSha256"] = model_sha
        calibration_path.write_bytes(canonical_bytes(calibration))
        calibration_sha = sha256_hex(calibration_path.read_bytes())

        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        policy["modelArtifactSha256"] = model_sha
        policy["calibrationArtifactSha256"] = calibration_sha
        policy_path.write_bytes(canonical_bytes(policy))

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in manifest["artifacts"]:
            raw = (directory / entry["fileName"]).read_bytes()
            entry["sha256"] = sha256_hex(raw)
            entry["byteLength"] = len(raw)
        manifest_path.write_bytes(canonical_bytes(manifest))

    @pytest.mark.parametrize("identity", CROSS_CHECKED_SHARED_IDENTITIES)
    def test_a_manifest_top_level_identity_contradicting_the_bodies_refuses(
        self, tmp_path, identity
    ):
        manifest_path = self._materialize(tmp_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest[identity] = "contradictory-value"
        manifest_path.write_bytes(canonical_bytes(manifest))
        self._rehash(manifest_path)

        with pytest.raises(FrozenIdentityUnavailable) as caught:
            load_frozen_research_identity(manifest_path)
        message = str(caught.value)
        assert identity in message
        assert "manifest and artifact bodies must agree" in message

    @pytest.mark.parametrize("identity", CROSS_CHECKED_SHARED_IDENTITIES)
    @pytest.mark.parametrize("kind", ["model", "calibration", "policy"])
    def test_an_artifact_body_identity_contradicting_the_manifest_refuses(
        self, tmp_path, identity, kind
    ):
        # The reverse direction, with the manifest's recorded file hash repaired so the
        # edit is invisible to every check except the cross-check.
        manifest_path = self._materialize(tmp_path)
        path = manifest_path.parent / f"fc008-{JOINT_FAMILY}-{kind}.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        document[identity] = "contradictory-value"
        path.write_bytes(canonical_bytes(document))
        self._rehash(manifest_path)

        with pytest.raises(FrozenIdentityUnavailable) as caught:
            load_frozen_research_identity(manifest_path)
        assert identity in str(caught.value)

    @pytest.mark.parametrize("identity", CROSS_CHECKED_SHARED_IDENTITIES)
    def test_a_whole_family_drifting_together_still_refuses(self, tmp_path, identity):
        # All three bodies agree with each other and disagree with the manifest, which is
        # exactly the case the old intra-triplet check could not see.
        manifest_path = self._materialize(tmp_path)
        for kind in ("model", "calibration", "policy"):
            path = manifest_path.parent / f"fc008-{JOINT_FAMILY}-{kind}.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            document[identity] = "drifted-together"
            path.write_bytes(canonical_bytes(document))
        self._rehash(manifest_path)

        with pytest.raises(FrozenIdentityUnavailable):
            load_frozen_research_identity(manifest_path)

    @pytest.mark.parametrize(
        "field",
        ["modelVersion", "calibrationArtifactVersion"],
    )
    def test_a_version_disagreement_inside_a_triplet_refuses(self, tmp_path, field):
        manifest_path = self._materialize(tmp_path)
        path = manifest_path.parent / f"fc008-{JOINT_FAMILY}-policy.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        document[field] = "9.9"
        path.write_bytes(canonical_bytes(document))
        self._rehash(manifest_path)

        with pytest.raises(FrozenIdentityUnavailable) as caught:
            load_frozen_research_identity(manifest_path)
        assert field in str(caught.value)


class TestTokenRevalidationCoversVersions:
    """Nothing is trusted because it was checked at authorization time.

    A2's token omitted the three version dimensions, so they were verified once and then
    taken on faith. A model re-versioned between authorization and evaluation had nothing
    left to contradict it.
    """

    @pytest.mark.parametrize(
        "field",
        ["model_version", "calibration_artifact_version", "abstention_policy_version"],
    )
    def test_the_token_carries_each_version_dimension(self, frozen_identity, field):
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE,
            model_family=JOINT_FAMILY,
            actual=context_for(frozen_identity, JOINT_FAMILY),
        )
        expected = getattr(frozen_identity.family(JOINT_FAMILY), field)
        assert getattr(authorization, field) == expected

    @pytest.mark.parametrize(
        ("field", "reported"),
        [
            ("model_version", "modelVersion"),
            ("calibration_artifact_version", "calibrationArtifactVersion"),
            ("abstention_policy_version", "abstentionPolicyVersion"),
        ],
    )
    def test_a_version_drifting_before_evaluation_refuses(self, frozen_identity, field, reported):
        actual = context_for(frozen_identity, JOINT_FAMILY)
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE, model_family=JOINT_FAMILY, actual=actual
        )
        drifted = dataclasses.replace(actual, **{field: "9.9"})
        with pytest.raises(FinalEvaluationLocked) as caught:
            assert_authorization_matches_artifacts(authorization, drifted)
        assert reported in str(caught.value)

    @pytest.mark.parametrize(
        ("field", "reported"),
        [
            ("model_family", "modelFamily"),
            ("model_artifact_sha256", "modelArtifactSha256"),
            ("calibration_artifact_sha256", "calibrationArtifactSha256"),
            ("policy_artifact_sha256", "policyArtifactSha256"),
            ("model_version", "modelVersion"),
            ("calibration_artifact_version", "calibrationArtifactVersion"),
            ("abstention_policy_version", "abstentionPolicyVersion"),
            ("dataset_hash", "datasetHash"),
            ("vocabulary_hash", "vocabularyHash"),
            ("support_matrix_version", "supportMatrixVersion"),
            ("feature_policy_version", "featurePolicyVersion"),
            ("preregistration_sha256", "preregistrationSha256"),
        ],
    )
    def test_every_material_identity_is_rechecked(self, frozen_identity, field, reported):
        actual = context_for(frozen_identity, JOINT_FAMILY)
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE, model_family=JOINT_FAMILY, actual=actual
        )
        drifted = dataclasses.replace(actual, **{field: "tampered"})
        with pytest.raises(FinalEvaluationLocked) as caught:
            assert_authorization_matches_artifacts(authorization, drifted)
        assert reported in str(caught.value)

    def test_the_recheck_covers_the_whole_required_identity_list(self, frozen_identity):
        # Guards against the two checks drifting apart: anything added to the frozen
        # identity list must also be re-verified at evaluation time.
        actual = context_for(frozen_identity, JOINT_FAMILY)
        authorization = authorize_final_evaluation(
            mode=FINAL_EVALUATION_MODE, model_family=JOINT_FAMILY, actual=actual
        )
        canonical = authorization.to_canonical()
        for identity in REQUIRED_IDENTITIES:
            assert identity in canonical


class TestPreregistrationHistory:
    """Superseded preregistration bytes are retained, and are never an active identity."""

    HISTORY_DIR = ARTIFACT_DIR / "history"

    @pytest.mark.parametrize(
        ("file_name", "expected"),
        [
            (
                "fc008-preregistration-v1.0.json",
                "cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f",
            ),
            (
                "fc008-preregistration-v1.1.json",
                "4b2cbbb1a9da3bb8479be5c517316762b0417210efe4bb5ca6f7ae290aec4b1c",
            ),
        ],
    )
    def test_a_historical_freeze_hash_can_be_recomputed(self, file_name, expected):
        # The entire point of retaining the bytes: an auditor can verify the recorded
        # freeze hash instead of taking the amendment's word for it.
        path = self.HISTORY_DIR / file_name
        assert path.is_file()
        assert sha256_hex(path.read_bytes()) == expected

    def test_the_retained_bytes_are_the_real_document_not_a_summary(self):
        for path in self.HISTORY_DIR.glob("*.json"):
            document = json.loads(path.read_text(encoding="utf-8"))
            assert document["finalTestResultsPresent"] is False
            assert document["researchQuestions"]["RQ1"]["question"]
            assert document["bootstrap"]["replicates"] == 5000

    def test_each_retained_version_declares_itself_superseded(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        history = manifest["auditHistory"]
        assert len(history) == 2
        for record in history:
            assert record["active"] is False
            assert record["status"] == "superseded pre-final-test"
            path = self.HISTORY_DIR / record["fileName"]
            assert sha256_hex(path.read_bytes()) == record["sha256"]
            assert len(path.read_bytes()) == record["byteLength"]

    def test_historical_bytes_are_outside_the_active_artifact_list(self):
        # Structural separation, not a naming convention: authorization resolves
        # artifacts from the 'artifacts' list only, so a history entry is unreachable.
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        active_files = {entry["fileName"] for entry in manifest["artifacts"]}
        active_hashes = {entry["sha256"] for entry in manifest["artifacts"]}
        for record in manifest["auditHistory"]:
            assert record["fileName"] not in active_files
            assert record["sha256"] not in active_hashes

    def test_no_historical_hash_is_the_active_preregistration_identity(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        active = manifest["preregistrationSha256"]
        superseded = {record["sha256"] for record in manifest["auditHistory"]}
        assert active not in superseded
        identity, _ = load_trusted_research_identity()
        assert identity.preregistration_sha256 == active
        assert identity.preregistration_sha256 not in superseded

    def test_a_historical_preregistration_cannot_satisfy_an_unlock(self, frozen_identity):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for record in manifest["auditHistory"]:
            actual = dataclasses.replace(
                context_for(frozen_identity, JOINT_FAMILY),
                preregistration_sha256=record["sha256"],
            )
            with pytest.raises(FinalEvaluationLocked) as caught:
                authorize_final_evaluation(
                    mode=FINAL_EVALUATION_MODE, model_family=JOINT_FAMILY, actual=actual
                )
            assert "preregistrationSha256" in str(caught.value)

    def test_registering_history_as_active_is_refused(self, tmp_path):
        # If a future change merged the two lists, the registry must fail rather than
        # authorize against an amended-away protocol.
        destination = tmp_path / "artifacts"
        destination.mkdir()
        for path in ARTIFACT_DIR.glob("*.json"):
            (destination / path.name).write_bytes(path.read_bytes())
        manifest_path = destination / "fc008-artifact-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        historical = self.HISTORY_DIR / "fc008-preregistration-v1.0.json"
        raw = historical.read_bytes()
        (destination / historical.name).write_bytes(raw)
        manifest["preregistrationSha256"] = sha256_hex(raw)
        manifest["auditHistory"] = [
            {**record, "sha256": sha256_hex(raw)} for record in manifest["auditHistory"][:1]
        ]
        for entry in manifest["artifacts"]:
            if entry["name"] == "preregistration":
                entry["fileName"] = historical.name
                entry["sha256"] = sha256_hex(raw)
                entry["byteLength"] = len(raw)
        manifest_path.write_bytes(canonical_bytes(manifest))

        with pytest.raises(FrozenIdentityUnavailable) as caught:
            load_frozen_research_identity(manifest_path)
        assert "superseded" in str(caught.value)


class TestSprintThreeNonInvocation:
    def test_the_trainer_never_reaches_the_unlock(self):
        source = (
            REPOSITORY_ROOT
            / "research"
            / "futurebench"
            / "src"
            / "futurebench"
            / "fc008"
            / "train.py"
        ).read_text()
        for forbidden in (
            "authorize_final_evaluation",
            "assert_authorization_matches_artifacts",
            "load_frozen_research_identity",
            "load_trusted_research_identity",
            FINAL_EVALUATION_MODE,
        ):
            assert forbidden not in source

    #: The only modules permitted to invoke or import an authorizing function.
    #:
    #: ``unlock.py`` defines them. ``evaluation.py`` and ``final_evaluation.py`` are the
    #: Sprint-4A final-evaluation harness, whose entire purpose is to require
    #: authorization before a sealed partition can be opened — a harness that could not
    #: call the authorizers could not enforce anything.
    #:
    #: Naming them is what keeps this a real check. The scan below still walks EVERY
    #: module by glob, so a newly added generation module that reaches for an authorizer
    #: fails here until someone deliberately adds it to this set and justifies it.
    AUTHORIZING_CALLERS_PERMITTED = frozenset(
        {"unlock.py", "evaluation.py", "final_evaluation.py", "sealed.py"}
    )

    #: Modules that generate the frozen research state. None may ever authorize.
    GENERATION_MODULES = frozenset(
        {
            "artifacts.py",
            "calibration.py",
            "corpus.py",
            "golden.py",
            "models.py",
            "policy.py",
            "train.py",
        }
    )

    def test_the_permitted_set_is_disjoint_from_the_generation_pipeline(self):
        """The two sets must not overlap, or the scan below would permit a generator."""
        assert not (self.AUTHORIZING_CALLERS_PERMITTED & self.GENERATION_MODULES)
        source_root = RESEARCH_ROOT / "src" / "futurebench" / "fc008"
        present = {path.name for path in source_root.glob("*.py")}
        # Both sets must describe modules that actually exist, so neither can rot into
        # a list of names that no longer corresponds to anything.
        assert self.AUTHORIZING_CALLERS_PERMITTED <= present
        assert self.GENERATION_MODULES <= present

    def test_no_generation_module_calls_the_unlock(self):
        """Only the permitted modules invoke or import an authorizing function.

        Parsed rather than grepped. Importing the contract CONSTANTS is legitimate and
        expected — the preregistration has to describe the protocol it is freezing, and
        it names the re-verification function in prose. A substring search cannot tell
        that apart from a call, so it would either miss real invocations or fail on
        documentation. The AST can.
        """
        source_root = RESEARCH_ROOT / "src" / "futurebench" / "fc008"
        authorizing = {
            "authorize_final_evaluation",
            "assert_authorization_matches_artifacts",
            "load_frozen_research_identity",
            "load_trusted_research_identity",
            "authorize_real_opening",
        }
        scanned: set[str] = set()
        for path in sorted(source_root.glob("*.py")):
            if path.name in self.AUTHORIZING_CALLERS_PERMITTED:
                continue
            scanned.add(path.name)
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    target = node.func
                    name = (
                        target.id
                        if isinstance(target, ast.Name)
                        else target.attr
                        if isinstance(target, ast.Attribute)
                        else None
                    )
                    assert name not in authorizing, f"{path.name} calls {name}"
                if isinstance(node, ast.ImportFrom) and node.module == "unlock":
                    imported = {alias.name for alias in node.names}
                    assert not (imported & authorizing), f"{path.name} imports an authorizer"

        # Not vacuous: the whole generation pipeline must actually have been walked.
        assert self.GENERATION_MODULES <= scanned


class TestSingleThreadVerification:
    def test_reports_a_real_pool_rather_than_passing_vacuously(self):
        from futurebench.fc008.environment import verify_single_thread

        pools = verify_single_thread()
        # An empty list would pass a "nothing exceeds one thread" check without
        # inspecting anything, so a non-empty result is part of the contract.
        assert pools
        assert all(int(pool["num_threads"]) == 1 for pool in pools)

    def test_thread_environment_variables_are_pinned(self):
        import os

        from futurebench.fc008.environment import THREAD_ENVIRONMENT_VARIABLES

        for name in THREAD_ENVIRONMENT_VARIABLES:
            assert os.environ.get(name) == "1"


class TestConvergenceAndWarnings:
    def test_a_non_converging_fit_raises_instead_of_returning_weights(self):
        import numpy as np

        from futurebench.fc008 import models
        from futurebench.fc008.models import ConvergenceFailure

        # One iteration cannot converge, so this proves the warning is promoted
        # rather than merely configured.
        original = models.MAX_ITER
        try:
            models.MAX_ITER = 1
            design = np.random.default_rng(0).normal(size=(60, 40))
            labels = np.array([index % 6 for index in range(60)], dtype=np.int64)
            with pytest.raises(ConvergenceFailure):
                models._fit_logistic(
                    design,
                    labels,
                    c_value=1000.0,
                    class_order=(0, 1, 2, 3, 4, 5),
                    target_name="synthetic",
                )
        finally:
            models.MAX_ITER = original

    def test_a_converging_fit_emits_no_warning_at_all(self, corpus):
        from futurebench.fc008.models import _fit_logistic

        design, labels = corpus.matrix(TRAIN)
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            _fit_logistic(
                design,
                labels,
                c_value=1.0,
                class_order=corpus.class_numbers,
                target_name="joint tuple class",
            )


class TestThreadingDocumentationMatchesImplementation:
    """Threading claims must describe the mechanism that actually runs.

    Documentation drift is not cosmetic here. A reader who believes
    ``threadpool_limits`` constrains the open pools would also believe Accelerate's
    thread count had been read back, which it has not. These tests pin the claim to
    the code so the two cannot diverge again silently.
    """

    def test_no_threadpool_limits_is_used_anywhere(self):
        """No code path calls or imports ``threadpool_limits``.

        Parsed, not grepped: the corrected docstring names ``threadpool_limits`` in
        order to say it is deliberately absent, so a substring search would fail on the
        very sentence that fixes the finding.
        """
        source_root = RESEARCH_ROOT / "src" / "futurebench" / "fc008"
        for path in sorted(source_root.glob("*.py")):
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    target = node.func
                    name = (
                        target.id
                        if isinstance(target, ast.Name)
                        else target.attr
                        if isinstance(target, ast.Attribute)
                        else None
                    )
                    assert name != "threadpool_limits", f"{path.name} calls threadpool_limits"
                if isinstance(node, ast.ImportFrom):
                    assert "threadpool_limits" not in {alias.name for alias in node.names}, (
                        f"{path.name} imports threadpool_limits"
                    )
                if isinstance(node, ast.With):
                    for item in node.items:
                        expression = item.context_expr
                        if isinstance(expression, ast.Call):
                            target = expression.func
                            name = getattr(target, "attr", getattr(target, "id", None))
                            assert name != "threadpool_limits", path.name

    def test_control_is_environment_variables_set_before_numpy_loads(self):
        import os

        from futurebench.fc008.environment import (
            THREAD_ENVIRONMENT_VARIABLES,
            force_single_thread,
        )

        assert set(THREAD_ENVIRONMENT_VARIABLES) == {
            "OMP_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "MKL_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
            "NUMEXPR_NUM_THREADS",
        }
        force_single_thread()
        for name in THREAD_ENVIRONMENT_VARIABLES:
            assert os.environ[name] == "1"

    def test_accelerate_is_the_backend_and_is_not_enumerated_by_threadpoolctl(self):
        from futurebench.fc008.environment import (
            capture_reference_environment,
            verify_single_thread,
        )

        environment = capture_reference_environment()
        pools = verify_single_thread()
        observed = {str(pool.get("internal_api")) for pool in pools}

        # The precise situation the documentation now describes: OpenMP is observed,
        # Accelerate is the BLAS backend and is absent from the observation.
        assert "openmp" in observed
        if environment.blas_name == "accelerate":
            assert "accelerate" not in observed

    def test_the_access_report_scopes_its_threading_claim(self):
        report = json.loads((ARTIFACT_DIR / "fc008-development-access-report.json").read_text())
        control = report["threadControl"]
        assert "no threadpool_limits" in control["mechanism"]
        assert "openmp" in control["independentlyConfirmed"]
        unconfirmed = " ".join(control["configuredButNotIndependentlyConfirmed"]).lower()
        assert "veclib_maximum_threads" in unconfirmed
        assert "does not enumerate accelerate" in unconfirmed


class TestAccessEventExplanation:
    """The stated reason for repeated reads must match the actual call graph."""

    def test_design_matrices_are_built_outside_the_c_loop(self):
        """The old explanation blamed the C loop. Prove the loop does not re-read.

        Parsed rather than asserted in prose: every ``corpus.matrix`` and
        ``corpus.head_labels`` call in the two training functions must sit at function
        body level, not inside the ``for c_value in C_GRID`` loop.
        """
        source_path = RESEARCH_ROOT / "src" / "futurebench" / "fc008" / "models.py"
        tree = ast.parse(source_path.read_text(), filename=str(source_path))
        accessors = {"matrix", "head_labels", "partition_view"}

        for function_name in ("train_joint", "train_factorized"):
            function = next(
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.FunctionDef) and node.name == function_name
            )
            loops = [node for node in ast.walk(function) if isinstance(node, ast.For)]
            inside_loops = {
                node.func.attr
                for loop in loops
                for node in ast.walk(loop)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            }
            assert not (inside_loops & accessors), (
                f"{function_name} reads a partition inside a loop; the access-event "
                f"explanation would then be the C loop after all"
            )

    def test_the_report_does_not_blame_the_c_loop(self):
        report = json.loads((ARTIFACT_DIR / "fc008-development-access-report.json").read_text())
        note = report["accessEventNote"]
        assert "not per candidate C" in note
        assert "candidate C values re-reads" not in note

    def test_every_event_count_is_an_exact_multiple_of_the_partition_size(self):
        report = json.loads((ARTIFACT_DIR / "fc008-development-access-report.json").read_text())
        for entry in report["developmentRowsAccessed"]:
            # Each access is a whole-partition read, which is what makes the event
            # count decomposable into named stages at all.
            assert entry["distinctRows"] == 143
            assert entry["accessEvents"] % 143 == 0

    def test_attribution_names_one_stage_per_whole_partition_read(self):
        report = json.loads((ARTIFACT_DIR / "fc008-development-access-report.json").read_text())
        attribution = report["accessEventAttribution"]
        expected_reads = {"train": 6, "calibration": 2, "policy-validation": 4}
        for entry in report["developmentRowsAccessed"]:
            partition = entry["partition"]
            reads = entry["accessEvents"] // entry["distinctRows"]
            assert reads == expected_reads[partition]
            # The attribution list must account for every read. train_metrics runs once
            # per family, so its single line covers two reads and is marked as such.
            lines = attribution[partition]
            accounted = sum(2 if "(2 reads)" in line else 1 for line in lines)
            assert accounted == reads, f"{partition}: {accounted} accounted, {reads} measured"


class TestTimeoutConfiguration:
    """The authorized FutureBench test-timeout headroom, pinned to its exact scope."""

    CONFIG = REPOSITORY_ROOT / "packages" / "futurebench-dataset" / "vitest.config.ts"

    def test_it_is_package_local_to_futurebench_only(self):
        assert self.CONFIG.is_file()
        others = [
            path
            for path in (REPOSITORY_ROOT / "packages").glob("*/vitest.config.ts")
            if path != self.CONFIG
        ]
        for path in others:
            assert "testTimeout" not in path.read_text(), path

    def test_the_timeout_is_exactly_fifteen_seconds(self):
        text = self.CONFIG.read_text()
        assert "testTimeout: 15000" in text

    @staticmethod
    def _configured_keys(text: str) -> set[str]:
        """Keys the config actually sets, with comments stripped.

        The config explains in prose why retries were deliberately not used, so a raw
        substring search for "retry" matches the explanation. Stripping comments first
        is what lets the test check behaviour rather than vocabulary.
        """
        without_block_comments = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        without_comments = re.sub(r"//[^\n]*", "", without_block_comments)
        return set(re.findall(r"(\w+)\s*:", without_comments))

    def test_it_adds_no_retries_and_no_skips(self):
        keys = self._configured_keys(self.CONFIG.read_text())
        # The whole config surface, so a future addition has to be deliberate.
        assert keys == {"test", "testTimeout"}, keys
        for forbidden in ("retry", "bail", "exclude", "testNamePattern", "maxConcurrency"):
            assert forbidden not in keys

    def test_it_does_not_raise_any_global_timeout(self):
        root_config = REPOSITORY_ROOT / "vitest.config.ts"
        if root_config.is_file():
            assert "testTimeout" not in root_config.read_text()
        for name in ("vitest.workspace.ts", "vitest.config.mts"):
            candidate = REPOSITORY_ROOT / name
            if candidate.is_file():
                assert "testTimeout" not in candidate.read_text()

    def test_it_is_documented_as_headroom_rather_than_a_correctness_fix(self):
        text = self.CONFIG.read_text().lower()
        assert "headroom" in text
        # The distinction matters: calling it a correctness fix would imply the tests
        # were wrong, when what was reproduced was parallel-load timing sensitivity.
        assert "parallel" in text or "load" in text

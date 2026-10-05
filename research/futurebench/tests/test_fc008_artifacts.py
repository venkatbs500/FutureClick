"""Tests for the artifacts themselves: canonicalization, identity, size, determinism.

These read the artifacts that were actually written, not freshly built in-memory
copies, because the file on disk is what Sprint 4 will load and what a reviewer will
hash. A test that only checks the builder's return value would pass even if the
writer rounded, reordered, or truncated on the way out.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from futurebench.fc008.artifacts import MAX_ARTIFACT_BYTES, ArtifactTooLarge, write_artifact
from futurebench.fc008.canonical import canonical_bytes, canonical_json, sha256_hex, to_float
from futurebench.fc008.corpus import (
    EXPECTED_CLASS_COUNT,
    EXPECTED_FEATURE_COUNT,
    EXPECTED_OBJECT_COUNT,
    EXPECTED_TRANSITION_PROPERTY_COUNT,
    EXPECTED_VERB_COUNT,
)
from futurebench.fc008.golden import GOLDEN_VECTOR_SCHEMA_VERSION, PARITY_ABSOLUTE_TOLERANCE
from futurebench.fc008.preregistration import RQ1, RQ2

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_ROOT = REPOSITORY_ROOT / "research" / "futurebench"
ARTIFACT_DIR = RESEARCH_ROOT / "artifacts"

FAMILIES = ("joint-logistic", "factorized-logistic")
SEALED_PARTITION_NAMES = ("test-id", "test-ooa", "test-novelty")


def read(name: str) -> dict:
    return json.loads((ARTIFACT_DIR / f"fc008-{name}.json").read_text())


@pytest.fixture(scope="module")
def manifest():
    return read("artifact-manifest")


class TestCanonicalization:
    def test_keys_are_sorted_and_separators_are_compact(self):
        assert canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'

    def test_non_finite_values_are_rejected_at_write_time(self):
        # A diverged fit produces NaN or inf. Writing it would produce an artifact
        # that looks valid until something tries to use it.
        for value in (float("nan"), float("inf"), float("-inf")):
            with pytest.raises(ValueError):
                to_float(value)

    def test_floats_keep_full_round_trip_precision(self):
        # Rounding to display precision would cap achievable TypeScript parity at the
        # rounding width, well above the 1e-6 ceiling.
        value = 0.1234567890123456789
        restored = json.loads(canonical_json({"x": to_float(value)}))["x"]
        assert restored == value

    @pytest.mark.parametrize(
        "name",
        [
            "joint-logistic-model",
            "factorized-logistic-model",
            "joint-logistic-calibration",
            "factorized-logistic-calibration",
            "joint-logistic-policy",
            "factorized-logistic-policy",
            "golden-vectors",
            "training-configuration",
            "development-access-report",
            "preregistration",
            "artifact-manifest",
        ],
    )
    def test_every_artifact_on_disk_is_already_canonical(self, name):
        path = ARTIFACT_DIR / f"fc008-{name}.json"
        raw = path.read_bytes()
        assert raw == canonical_bytes(json.loads(raw.decode("utf-8")))

    def test_artifacts_carry_no_wall_clock_timestamp(self, manifest):
        # A timestamp inside the canonical bytes would make every rebuild differ and
        # turn the determinism check into a no-op.
        for entry in manifest["artifacts"]:
            raw = (ARTIFACT_DIR / entry["fileName"]).read_text().lower()
            for token in ("generatedat", "timestamp", "createdat", "builtat", "wallclock"):
                assert token not in raw


class TestNoPickle:
    def test_only_json_artifacts_were_produced(self):
        produced = sorted(path.name for path in ARTIFACT_DIR.iterdir() if path.is_file())
        assert produced
        assert all(name.endswith(".json") for name in produced)

    def test_no_binary_serialization_format_is_present(self):
        forbidden = (".pkl", ".pickle", ".joblib", ".npy", ".npz", ".pt", ".onnx", ".h5")
        assert not [
            path.name
            for path in ARTIFACT_DIR.rglob("*")
            if path.is_file() and path.suffix in forbidden
        ]

    def test_the_pipeline_does_not_import_a_serializer(self):
        # joblib pulls cloudpickle into the dependency tree as a transitive
        # requirement of scikit-learn. Its presence in the lockfile is unavoidable;
        # what matters is that no FC-008 module reaches for it, so the product
        # artifact cannot quietly become a pickle.
        source_root = RESEARCH_ROOT / "src" / "futurebench" / "fc008"
        for path in source_root.glob("*.py"):
            text = path.read_text()
            for forbidden in (
                "import pickle",
                "import cloudpickle",
                "joblib.dump",
                "joblib.load",
                "np.save",
                "np.load",
                ".tofile(",
            ):
                assert forbidden not in text, f"{path.name} reaches for {forbidden}"


class TestArtifactSize:
    def test_each_artifact_is_under_the_two_megabyte_ceiling(self, manifest):
        assert MAX_ARTIFACT_BYTES == 2 * 1024 * 1024
        for entry in manifest["artifacts"]:
            assert 0 < entry["byteLength"] < MAX_ARTIFACT_BYTES

    def test_the_ceiling_is_enforced_rather_than_merely_declared(self, tmp_path):
        oversized = {"padding": ["x" * 1024 for _ in range(4096)]}
        with pytest.raises(ArtifactTooLarge):
            write_artifact(tmp_path / "oversized.json", oversized, "oversized")

    def test_a_refused_artifact_is_not_left_on_disk(self, tmp_path):
        # A truncated or oversized file left behind would be loadable by a later run.
        path = tmp_path / "oversized.json"
        with pytest.raises(ArtifactTooLarge):
            write_artifact(path, {"padding": ["x" * 1024 for _ in range(4096)]}, "oversized")
        assert not path.exists()


class TestModelArtifacts:
    def test_joint_coefficient_shape_and_class_order(self):
        artifact = read("joint-logistic-model")
        assert len(artifact["coefficients"]) == EXPECTED_CLASS_COUNT
        assert all(len(row) == EXPECTED_FEATURE_COUNT for row in artifact["coefficients"])
        assert len(artifact["intercepts"]) == EXPECTED_CLASS_COUNT
        assert artifact["classOrder"] == list(range(1, EXPECTED_CLASS_COUNT + 1))

    def test_factorized_head_shapes_and_preserved_raw_providers(self):
        artifact = read("factorized-logistic-model")
        for head, count in (
            ("verb", EXPECTED_VERB_COUNT),
            ("objectKind", EXPECTED_OBJECT_COUNT),
            ("transitionProperty", EXPECTED_TRANSITION_PROPERTY_COUNT),
        ):
            block = artifact["heads"][head]
            assert len(block["coefficients"]) == count
            assert all(len(row) == EXPECTED_FEATURE_COUNT for row in block["coefficients"])
            assert len(block["intercepts"]) == count

    def test_factorized_artifact_states_the_additive_composition(self):
        artifact = read("factorized-logistic-model")
        composition = artifact["composition"]
        assert "verbLogit" in composition["specification"]
        assert composition["learnedCombiner"] is False
        assert composition["appliesBeforeNormalization"] is True
        assert len(composition["classOrderHeadIndices"]) == EXPECTED_CLASS_COUNT

    @pytest.mark.parametrize("family", FAMILIES)
    def test_feature_order_is_persisted_so_columns_cannot_drift(self, family):
        artifact = read(f"{family}-model")
        assert len(artifact["featureOrder"]) == EXPECTED_FEATURE_COUNT

    @pytest.mark.parametrize("family", FAMILIES)
    def test_identity_dimensions_are_present_in_the_artifact_body(self, family):
        # No identity dimension may be inferred from the filename.
        artifact = read(f"{family}-model")
        for field in (
            "modelFamily",
            "modelVersion",
            "supportMatrixVersion",
            "featurePolicyVersion",
            "datasetHash",
            "vocabularyHash",
        ):
            assert artifact[field]
        assert artifact["modelFamily"] == family

    @pytest.mark.parametrize("family", FAMILIES)
    def test_the_model_does_not_hash_itself(self, family):
        # A self-hash is unsatisfiable. The hash lives in the documents that depend
        # on the model, which also makes the dependency direction explicit.
        artifact = read(f"{family}-model")
        assert "artifactSha256" not in artifact
        raw = (ARTIFACT_DIR / f"fc008-{family}-model.json").read_bytes()
        assert read(f"{family}-calibration")["modelArtifactSha256"] == sha256_hex(raw)

    @pytest.mark.parametrize("family", FAMILIES)
    def test_recorded_weight_and_selection_partitions(self, family):
        artifact = read(f"{family}-model")
        declaration = artifact["trainingPartitionDeclaration"]
        assert declaration["weightsFittedOn"] == ["train"]
        assert declaration["selectedOn"] == "policy-validation"
        # Weights stay train-only after C is chosen; refitting on the development
        # union would blur the partition roles the whole design depends on.
        assert declaration["refitOnDevelopmentUnion"] is False


class TestCalibrationAndPolicyArtifacts:
    @pytest.mark.parametrize("family", FAMILIES)
    def test_temperature_is_inside_the_declared_range(self, family):
        artifact = read(f"{family}-calibration")
        fit = artifact["temperatureFit"]
        assert fit["temperatureMin"] < fit["temperature"] < fit["temperatureMax"]
        assert fit["gridPoints"] == 401
        assert fit["candidatesEvaluated"] == 401
        assert artifact["calibrationPartition"] == "calibration"
        assert artifact["testAccess"]["sealedPartitionsRead"] == []

    @pytest.mark.parametrize("family", FAMILIES)
    def test_policy_records_its_threshold_grid_and_fallback_state(self, family):
        artifact = read(f"{family}-policy")
        assert len(artifact["thresholdCandidates"]) == 15
        assert len(artifact["candidateThresholds"]) == 15
        assert artifact["policyValidationPartition"] == "policy-validation"
        assert artifact["developmentMetrics"]["metricPartition"] == "policy-validation"
        assert isinstance(artifact["fallbackUsed"], bool)
        assert artifact["selectedConfidenceThreshold"] in artifact["candidateThresholds"]
        assert artifact["abstentionPolicyVersion"]

    @pytest.mark.parametrize("family", FAMILIES)
    def test_policy_disclaims_a_real_world_accuracy_guarantee(self, family):
        artifact = read(f"{family}-policy")
        assert "guarantee" in artifact["guaranteeDisclaimer"].lower()
        assert artifact["runtimePrecedenceNote"]

    @pytest.mark.parametrize("family", FAMILIES)
    def test_policy_depends_on_both_upstream_artifacts_by_hash(self, family):
        artifact = read(f"{family}-policy")
        model = (ARTIFACT_DIR / f"fc008-{family}-model.json").read_bytes()
        calibration = (ARTIFACT_DIR / f"fc008-{family}-calibration.json").read_bytes()
        assert artifact["modelArtifactSha256"] == sha256_hex(model)
        assert artifact["calibrationArtifactSha256"] == sha256_hex(calibration)


@pytest.fixture(scope="module")
def golden():
    return read("golden-vectors")


@pytest.fixture(scope="module")
def prereg():
    return read("preregistration")


class TestGoldenVectors:
    def test_schema_and_tolerance_are_declared(self, golden):
        assert golden["schemaVersion"] == GOLDEN_VECTOR_SCHEMA_VERSION
        assert golden["parityAbsoluteTolerance"] == PARITY_ABSOLUTE_TOLERANCE == 1e-6

    def test_all_thirteen_classes_are_covered(self, golden):
        assert set(golden["classesCovered"]) == set(range(1, EXPECTED_CLASS_COUNT + 1))
        covered = {case["actualClassNumber"] for case in golden["vectors"]}
        assert covered == set(range(1, EXPECTED_CLASS_COUNT + 1))

    def test_every_vector_comes_from_a_development_partition(self, golden):
        # Golden vectors go into the repository and get read by Sprint 4 tests; a
        # sealed-partition row here would leak test data into the port.
        partitions = {case["partition"] for case in golden["vectors"]}
        assert partitions <= {"train", "calibration", "policy-validation"}
        assert not partitions & set(SEALED_PARTITION_NAMES)
        assert golden["sealedPartitionsUsed"] == []
        # `partitionsUsed` must describe the vectors rather than restate the eligible
        # set, otherwise it would read as true of rows it does not cover.
        assert set(golden["partitionsUsed"]) == partitions
        assert partitions <= set(golden["partitionsEligible"])

    def test_sparse_and_dense_inputs_are_both_represented(self, golden):
        counts = sorted(case["activeFeatureCount"] for case in golden["vectors"])
        assert counts[0] < counts[-1]

    def test_unknown_features_are_ignored_rather_than_rejected(self, golden):
        case = golden["unknownFeatureCase"]
        # The vocabulary is frozen, so unseen tokens are expected at runtime. The case
        # names the row it must match instead of duplicating its logits, so the two
        # cannot drift apart.
        assert case["outOfVocabularyIndices"]
        assert all(index >= EXPECTED_FEATURE_COUNT for index in case["outOfVocabularyIndices"])
        reference = next(
            vector
            for vector in golden["vectors"]
            if vector["recordId"] == case["expectedEqualToRecordId"]
        )
        in_vocabulary = [
            index for index in case["featureIndices"] if index < EXPECTED_FEATURE_COUNT
        ]
        assert in_vocabulary == reference["featureIndices"]

    @pytest.mark.parametrize("family", FAMILIES)
    def test_each_vector_carries_the_full_inference_chain(self, golden, family):
        for case in golden["vectors"]:
            block = case["families"][family]
            assert len(block["rawTupleLogits"]) == EXPECTED_CLASS_COUNT
            assert len(block["scaledTupleLogits"]) == EXPECTED_CLASS_COUNT
            assert len(block["probabilities"]) == EXPECTED_CLASS_COUNT
            assert sum(block["probabilities"]) == pytest.approx(1.0, abs=1e-12)
            assert 0.0 <= block["calibratedConfidence"] <= 1.0
            assert 0.0 <= block["topTwoMargin"] <= 1.0
            assert 0.0 <= block["normalizedEntropy"] <= 1.0
            assert block["selectedClassNumber"] in range(1, EXPECTED_CLASS_COUNT + 1)
            # The selected class must agree with the stored probabilities, otherwise a
            # port could match the label while computing the distribution wrongly.
            position = int(np.argmax(block["probabilities"]))
            assert block["selectedClassNumber"] == golden["classOrder"][position]

    def test_temperature_application_is_reproducible_from_the_stored_values(self, golden):
        for case in golden["vectors"]:
            for family in FAMILIES:
                block = case["families"][family]
                temperature = block["temperature"]
                raw = np.array(block["rawTupleLogits"], dtype=np.float64)
                scaled = np.array(block["scaledTupleLogits"], dtype=np.float64)
                # Both raw and scaled are stored so a port with a correct argmax but
                # a broken softmax cannot pass by accident.
                assert np.allclose(raw / temperature, scaled, atol=PARITY_ABSOLUTE_TOLERANCE)

    def test_factorized_vectors_keep_raw_head_logits_at_their_own_dimensions(self, golden):
        for case in golden["vectors"]:
            block = case["families"]["factorized-logistic"]
            heads = block["rawHeadLogits"]
            assert len(heads["verb"]) == EXPECTED_VERB_COUNT
            assert len(heads["objectKind"]) == EXPECTED_OBJECT_COUNT
            assert len(heads["transitionProperty"]) == EXPECTED_TRANSITION_PROPERTY_COUNT
            assert block["composedTupleLogits"] == block["rawTupleLogits"]

    def test_composition_is_verifiable_from_the_golden_file_alone(self, golden):
        targets = [
            (entry["verbIndex"], entry["objectIndex"], entry["transitionPropertyIndex"])
            for entry in golden["classHeadTargets"]
        ]
        assert [entry["classNumber"] for entry in golden["classHeadTargets"]] == golden[
            "classOrder"
        ]
        for case in golden["vectors"]:
            block = case["families"]["factorized-logistic"]
            heads = block["rawHeadLogits"]
            composed = block["composedTupleLogits"]
            for position, (verb, obj, prop) in enumerate(targets):
                expected = (
                    heads["verb"][verb]
                    + heads["objectKind"][obj]
                    + heads["transitionProperty"][prop]
                )
                assert composed[position] == pytest.approx(expected, abs=PARITY_ABSOLUTE_TOLERANCE)

    def test_no_raw_surface_text_is_embedded(self, golden):
        serialized = json.dumps(golden)
        for forbidden in ("surfaceText", "rawText", "textContent", "innerText", "ariaLabel"):
            assert forbidden not in serialized


class TestPreregistration:
    def test_research_questions_are_recorded_verbatim(self, prereg):
        assert prereg["researchQuestions"]["RQ1"]["question"] == RQ1
        assert prereg["researchQuestions"]["RQ2"]["question"] == RQ2

    def test_the_transition_property_disclosure_is_present(self, prereg):
        disclosure = prereg["researchQuestions"]["RQ1"]["transitionPropertyDisclosure"]
        assert "All 13 (verb, objectKind) pairs in the V1 support set are unique" in disclosure
        assert "no independent class discrimination" in disclosure

    def test_the_fixed_thirteen_metric_cannot_be_swapped_for_the_observed_class_one(self, prereg):
        # test-OOA holds only six classes, so the observed-class figure will look
        # better; declaring now that it is secondary is what stops it being promoted.
        secondary = json.dumps(prereg["researchQuestions"]["RQ1"]["secondaryContext"])
        assert "never substituted" in secondary
        assert (
            prereg["metricDefinitions"]["fixedThirteenLabelUniverse"]["absentClassesDropped"]
            is False
        )

    def test_rq2_keeps_the_two_test_partitions_separate(self, prereg):
        serialized = json.dumps(prereg["researchQuestions"]["RQ2"]).lower()
        assert "separately" in serialized

    def test_metric_and_bootstrap_specifications_are_frozen(self, prereg):
        metrics = prereg["metricDefinitions"]
        assert metrics["ece"]["binCount"] == 15
        assert metrics["ece"]["binning"] == "equal-width"
        assert metrics["ece"]["adaptiveBinningAfterTestInspection"] is False
        assert metrics["matchedCoverageTargets"] == [0.25, 0.5, 0.75, 1.0]
        assert metrics["fixedRiskTargets"] == [0.05, 0.1, 0.2]
        assert "without interpolation" in metrics["matchedCoverageRule"]

        bootstrap = prereg["bootstrap"]
        assert bootstrap["replicates"] == 5000
        assert bootstrap["resamplingUnit"] == "parentLineageId"
        assert bootstrap["pairedComparisonsUseIdenticalSampledGroups"] is True
        # Reusing the training seed would couple the interval to the fit.
        assert bootstrap["seed"] != bootstrap["trainingSeed"]
        assert bootstrap["seedNamespacedFromTrainingSeed"] is True

    def test_the_ooa_power_limitation_is_stated(self, prereg):
        assert "six parent lineages" in prereg["bootstrap"]["powerLimitation"]
        assert "6 parent lineages" in json.dumps(prereg["ooaLimitations"])

    def test_no_family_winner_is_declared(self, prereg):
        rule = prereg["noFamilyWinnerRule"]
        assert "ADR-016 remains binding" in rule
        assert "no product, runtime, or research winner" in rule

    def test_the_synthetic_claim_boundary_is_recorded(self, prereg):
        assert "synthetic" in json.dumps(prereg["syntheticDataClaimBoundary"]).lower()

    def test_the_final_test_opening_rule_requires_all_eight_identities(self, prereg):
        rule = json.dumps(prereg["finalTestOpeningRule"])
        for identity in (
            "datasetHash",
            "vocabularyHash",
            "supportMatrixVersion",
            "featurePolicyVersion",
            "modelArtifactSha256",
            "calibrationArtifactSha256",
            "policyArtifactSha256",
            "preregistrationSha256",
        ):
            assert identity in rule

    def test_it_contains_no_final_test_result(self, prereg):
        assert prereg["finalTestResultsPresent"] is False
        serialized = json.dumps(prereg).lower()
        for forbidden in ("testaccuracy", "testf1", "testlogits", "testpredictions"):
            assert forbidden not in serialized

    def test_the_markdown_and_json_forms_agree_on_the_frozen_numbers(self, prereg):
        document = (RESEARCH_ROOT / "FC008_PREREGISTRATION.md").read_text()
        assert prereg["frozenInputs"]["datasetHash"] in document
        assert prereg["frozenInputs"]["vocabularyHash"] in document
        assert prereg["frozenInputs"]["manifestHash"] in document
        assert str(prereg["bootstrap"]["replicates"]) in document
        assert str(prereg["bootstrap"]["seed"]) in document
        assert str(prereg["metricDefinitions"]["ece"]["binCount"]) in document
        assert str(prereg["frozenInputs"]["vocabularyFeatureCount"]) in document

    def test_every_amendment_is_recorded_as_a_pre_test_correction(self, prereg):
        amendments = prereg["amendments"]
        assert len(amendments) == 2
        assert [item["amendmentNumber"] for item in amendments] == [1, 2]
        for amendment in amendments:
            assert amendment["stage"] == "pre-final-test"
            assert amendment["scope"] == "authorization integrity only"
            # The whole justification for amending a preregistration at all is that
            # nothing had been measured yet. If either of these were true, the amendment
            # would be post-hoc and inadmissible.
            assert amendment["finalTestOutputsExistedBeforeAmendment"] is False
            assert amendment["sealedPartitionsOpenedBeforeAmendment"] is False

    def test_the_amendment_chain_is_contiguous(self, prereg):
        # Each amendment must supersede the version the previous one produced, so the
        # history is a chain rather than a set of unrelated edits.
        amendments = prereg["amendments"]
        assert amendments[0]["supersededVersion"] == "1.0"
        assert amendments[0]["amendedVersion"] == "1.1"
        assert amendments[1]["supersededVersion"] == amendments[0]["amendedVersion"]
        assert amendments[1]["amendedVersion"] == prereg["preregistrationVersion"]

    def test_every_superseded_hash_is_named_rather_than_quietly_dropped(self, prereg):
        expected = {
            "1.0": "cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f",
            "1.1": "4b2cbbb1a9da3bb8479be5c517316762b0417210efe4bb5ca6f7ae290aec4b1c",
        }
        named = {
            amendment["supersededVersion"]: amendment["supersededPreregistrationSha256"]
            for amendment in prereg["amendments"]
        }
        assert named == expected
        for amendment in prereg["amendments"]:
            assert amendment["supersededStatus"] == "superseded pre-test"
        assert prereg["preregistrationVersion"] == "1.2"

    def test_the_superseded_bytes_are_retained_and_recomputable(self, prereg):
        # A named hash nobody can recompute is an assertion, not evidence.
        retained = prereg["preregistrationHistory"]["retained"]
        assert len(retained) == 2
        directory = ARTIFACT_DIR / prereg["preregistrationHistory"]["directory"]
        for record in retained:
            path = directory / record["fileName"]
            assert path.is_file()
            assert sha256_hex(path.read_bytes()) == record["sha256"]
            assert record["active"] is False
            assert record["status"] == "superseded pre-final-test"

    def test_the_amendment_changed_only_the_authorization_protocol(self, prereg):
        amendment = prereg["amendments"][0]
        changed = " ".join(amendment["changed"]).lower()
        assert "finaltestopeningrule" in changed
        assert "unlockcontractversion" in changed
        unchanged = " ".join(amendment["unchanged"]).lower()
        for preserved in ("rq1", "rq2", "ece", "bootstrap", "c candidate grid", "temperature"):
            assert preserved in unchanged

    def test_the_superseded_hash_is_not_the_active_identity(self, prereg, manifest):
        superseded = prereg["amendments"][0]["supersededPreregistrationSha256"]
        raw = (ARTIFACT_DIR / "fc008-preregistration.json").read_bytes()
        active = sha256_hex(raw)
        assert active != superseded
        # The superseded hash may appear in the amendment history, but no ACTIVE
        # identity field anywhere may still point at it.
        assert manifest["preregistrationSha256"] == active
        for entry in manifest["artifacts"]:
            assert entry["sha256"] != superseded

    def test_the_opening_rule_is_family_bound(self, prereg):
        rule = prereg["finalTestOpeningRule"]
        assert rule["authorizationScope"] == "per model family"
        assert set(rule["registeredFamilies"]) == set(FAMILIES)
        assert rule["failClosed"] is True
        assert rule["authorizationTokenImmutable"] is True
        assert rule["unlockContractVersion"] == "3.0"
        assert "modelFamily" in rule["requiredIdentities"]
        for identity in (
            "modelArtifactSha256",
            "calibrationArtifactSha256",
            "policyArtifactSha256",
        ):
            assert identity in rule["requiredIdentities"]

    def test_the_opening_rule_states_where_expectations_come_from(self, prereg):
        rule = prereg["finalTestOpeningRule"]
        source = rule["trustedExpectationSource"].lower()
        assert "canonical artifact manifest" in source
        assert "no parameter through which it could supply the expected values" in source
        # The A3 addition: the caller cannot choose WHICH manifest supplies them either.
        assert "redirect which manifest is read" in source
        assert "rather than from any argument" in source
        assert "never authorize the other" in rule["familyBinding"]

    def test_the_opening_rule_declares_the_external_trust_anchor(self, prereg):
        rule = prereg["finalTestOpeningRule"]
        anchor = rule["manifestTrustAnchor"].lower()
        assert "version-controlled source" in anchor
        assert "outside the manifest being" in anchor
        assert "cannot declare its own trustworthiness" in anchor
        assert rule["canonicalArtifactManifestPath"].endswith(
            "artifacts/fc008-artifact-manifest.json"
        )

    def test_the_opening_rule_declares_the_manifest_to_body_cross_checks(self, prereg):
        rule = prereg["finalTestOpeningRule"]
        assert rule["manifestToArtifactBodyCrossChecks"] == [
            "datasetHash",
            "vocabularyHash",
            "supportMatrixVersion",
            "featurePolicyVersion",
        ]
        assert "contradicts the artifacts it names" in rule["manifestToArtifactBodyRule"]

    def test_the_opening_rule_declares_full_reverification(self, prereg):
        rule = prereg["finalTestOpeningRule"]
        reverification = rule["reverificationAtEvaluationTime"]
        for version in (
            "modelVersion",
            "calibrationArtifactVersion",
            "abstentionPolicyVersion",
        ):
            assert version in reverification
            assert version in rule["reverifiedIdentities"]
        assert "trusted merely because it was checked at authorization" in reverification

    def test_historical_preregistrations_are_declared_non_active(self, prereg):
        statement = prereg["finalTestOpeningRule"]["historicalArtifactsAreNeverActive"]
        assert "does not search" in statement
        assert "only the active preregistration identity" in statement

    def test_the_opening_rule_does_not_overstate_its_trust_boundary(self, prereg):
        boundary = prereg["finalTestOpeningRule"]["trustBoundary"].lower()
        # The claim grew with A3 — the manifest bytes ARE now verified — so the honest
        # limit moved rather than disappeared. What a source-held anchor still cannot do
        # is survive an actor who rewrites the anchor along with the artifacts, and the
        # preregistration has to say so instead of implying the gate is absolute.
        assert "cannot defend against an actor able to rewrite the source trust anchor" in boundary
        assert "repository integrity" in boundary
        assert "rather than an in-process guarantee" in boundary

    def test_the_research_questions_survived_the_amendment_verbatim(self, prereg):
        # The amendment is only admissible because it changed no analysis choice.
        assert prereg["researchQuestions"]["RQ1"]["question"] == RQ1
        assert prereg["researchQuestions"]["RQ2"]["question"] == RQ2
        assert prereg["metricDefinitions"]["ece"]["binCount"] == 15
        assert prereg["bootstrap"]["replicates"] == 5000
        assert prereg["bootstrap"]["seed"] == 202601040002
        assert prereg["regularization"]["candidateCValues"] == [0.01, 0.1, 1.0, 10.0]

    def test_the_freeze_hash_is_recorded_in_the_manifest(self, prereg, manifest):
        del prereg
        raw = (ARTIFACT_DIR / "fc008-preregistration.json").read_bytes()
        entry = next(item for item in manifest["artifacts"] if item["name"] == "preregistration")
        assert entry["sha256"] == sha256_hex(raw)
        assert manifest["preregistrationSha256"] == sha256_hex(raw)


class TestManifestAndAccessReport:
    def test_every_recorded_hash_and_size_matches_the_file_on_disk(self, manifest):
        assert manifest["artifacts"]
        for entry in manifest["artifacts"]:
            raw = (ARTIFACT_DIR / entry["fileName"]).read_bytes()
            assert entry["sha256"] == sha256_hex(raw)
            assert entry["byteLength"] == len(raw)

    def test_the_manifest_does_not_list_itself(self, manifest):
        assert "artifact-manifest" not in {entry["name"] for entry in manifest["artifacts"]}

    def test_reproducibility_claim_is_scoped_to_the_reference_environment(self, manifest):
        claim = manifest["reproducibilityClaim"]
        # Byte identity is promised for this pinned toolchain only. A universal
        # cross-platform claim would be false the moment the BLAS changed.
        assert claim["crossPlatformBitwiseEquality"] is False
        environment = manifest["referenceEnvironment"]
        assert environment["pythonVersion"].startswith("3.12")
        assert environment["threadLimit"] == 1
        assert environment["blasName"]

    def test_access_report_shows_no_sealed_partition_was_read(self):
        report = read("development-access-report")
        assert report["sealedTotalRowsAccessed"] == 0
        assert report["sealedTotalAccessEvents"] == 0
        for entry in report["developmentRowsAccessed"]:
            assert entry["distinctRows"] == 143

    def test_the_isolation_claim_is_not_overstated_as_filesystem_secrecy(self):
        report = read("development-access-report")
        claim = report["isolationClaim"].lower()
        assert "access isolation" in claim
        assert "not a filesystem secrecy claim" in claim

    def test_training_configuration_declares_no_family_winner(self):
        configuration = read("training-configuration")
        assert "ADR-016 remains binding" in configuration["noFamilyWinner"]
        assert "not generalization evidence" in configuration["developmentMetricDisclaimer"]
        assert set(configuration["families"]) == set(FAMILIES)
        assert configuration["weightFittingPartition"] == "train"
        assert configuration["selectionPartition"] == "policy-validation"


class TestFinalTestSeal:
    def test_no_artifact_mentions_a_sealed_partition_as_data(self):
        for path in ARTIFACT_DIR.glob("*.json"):
            document = json.loads(path.read_text())
            # Partition NAMES are permitted frozen metadata. What must not appear is
            # a sealed partition as the source of any row, score, or metric.
            for case in document.get("vectors", []):
                assert case["partition"] not in SEALED_PARTITION_NAMES
            for entry in document.get("developmentRowsAccessed", []):
                assert entry["partition"] not in SEALED_PARTITION_NAMES

    def test_no_predictions_file_exists_for_any_sealed_partition(self):
        for name in SEALED_PARTITION_NAMES:
            assert not list(ARTIFACT_DIR.rglob(f"*{name}*"))


class TestDeterministicRebuild:
    def test_two_separate_processes_produce_byte_identical_artifacts(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        for destination in (first, second):
            completed = subprocess.run(
                [sys.executable, "-m", "futurebench.fc008.train", "--output", str(destination)],
                cwd=RESEARCH_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            assert completed.returncode == 0, completed.stderr
            # Warnings are promoted to failures during fitting, so a clean stderr is
            # also part of what is being asserted here.
            assert completed.stderr == ""

        produced = sorted(path.name for path in first.glob("*.json"))
        assert len(produced) == 11
        for name in produced:
            assert (first / name).read_bytes() == (second / name).read_bytes(), name

    def test_the_committed_artifacts_match_a_fresh_rebuild(self, tmp_path):
        completed = subprocess.run(
            [sys.executable, "-m", "futurebench.fc008.train", "--output", str(tmp_path)],
            cwd=RESEARCH_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr
        for path in sorted(tmp_path.glob("*.json")):
            assert path.read_bytes() == (ARTIFACT_DIR / path.name).read_bytes(), path.name

"""FC-008 Sprint 4A final-evaluation harness.

THE REAL FINAL TESTS ARE SEALED. This module is the machinery that would open
them, implemented and tested now so that the opening itself is a small, reviewed,
deliberate act rather than an act of implementation. Nothing here has been run
against ``test-id``, ``test-ooa``, or ``test-novelty``. The real opening count is
zero.

FOUR STRUCTURAL REASONS AN ACCIDENT CANNOT HAPPEN

1. NO IMPORT SIDE EFFECT. Importing this module computes nothing and reads no data.
   Every path into sealed data is an explicit function call.
2. EXPLICIT MODE. ``open_sealed_partition`` requires ``mode`` to equal
   ``FINAL_EVALUATION_MODE`` verbatim. A generic ``pytest``, ``build``, or
   ``quality`` run never supplies it, so there is no default that could drift into
   permitting evaluation.
3. BOTH FAMILIES, FIRST. Opening requires a complete authorization set covering
   BOTH registered families, built by ``authorize_all_families`` BEFORE any sealed
   row is read. See ATOMICITY below.
4. NO SEALED CORPUS EXISTS. The canonical sealed export path is absent from the
   repository, and the TypeScript exporter refuses to write sealed partitions. So
   even a caller holding valid authorization currently gets
   ``SealedCorpusUnavailable`` rather than data. The seal is a property of the
   repository, not only of this code.

ATOMICITY, AND WHY IT IS ORDERED THIS WAY

The order is: authorize joint, authorize factorized, verify the preregistration
identity, verify the evaluation specification, and only then read sealed inputs. If
authorization were per-family at the point of use, a run could produce a complete
set of joint results, then discover the factorized policy artifact had drifted, and
leave behind half an experiment whose existence has already consumed the one-shot
holdout. Validating everything first means a failure costs nothing: no sealed row
has been read and the seal is still intact. ``authorize_all_families`` therefore
raises on the FIRST family that fails and never returns a partial set.

WHAT THIS MODULE DOES NOT DECIDE

It computes metrics and writes results. It does not select a model family, does not
retune anything, and has no code path that changes a threshold, a temperature, or a
coefficient. A bad result is a finding, not a trigger.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Mapping, Protocol, Sequence

from . import metrics as metric_module
from .bootstrap import (
    OOA_POWER_LIMITATION,
    BootstrapInterval,
    bootstrap_configuration_canonical,
    bootstrap_paired_delta,
    bootstrap_statistic,
)
from .canonical import canonical_sha256
from .metrics import (
    CalibrationError,
    MetricInputError,
    NoveltyMetrics,
    RiskCoverageCurve,
    coverage_at_fixed_risk,
    expected_calibration_error,
    macro_f1_fixed_thirteen,
    macro_f1_observed_classes,
    multiclass_brier,
    negative_log_likelihood,
    novelty_metrics,
    paired_delta,
    per_class_metrics,
    risk_at_matched_coverage,
    risk_coverage_curve,
    structured_exact_match,
)
from .preregistration import PREREGISTRATION_VERSION
from .sealed import ValidatedSealedCorpus
from .unlock import (
    FINAL_EVALUATION_MODE,
    REGISTERED_FAMILIES,
    ArtifactContext,
    FinalEvaluationAuthorization,
    FinalEvaluationLocked,
    assert_authorization_matches_artifacts,
    authorize_final_evaluation,
)

EVALUATION_SCHEMA_VERSION = "1.0"
EVALUATION_SPECIFICATION_VERSION = "1.0"

#: The real sealed partitions. Named here only so they can be REFUSED.
SEALED_PARTITIONS: tuple[str, ...] = ("test-id", "test-ooa", "test-novelty")

#: Partition names reserved for synthetic fixtures. Deliberately not the real ones.
FIXTURE_PARTITIONS: tuple[str, ...] = (
    "fixture-id",
    "fixture-ooa",
    "fixture-novelty",
)

#: Frozen novelty population. Novelty recall and false acceptance use this
#: partition only. Not caller-configurable.
NOVELTY_POPULATION_PARTITION = "test-novelty"
NOVELTY_POPULATION_ALIASES: frozenset[str] = frozenset({"test-novelty", "fixture-novelty"})

#: Frozen supported-test reference for falseAbstentionRateOnSupportedTestData.
#: Sprint-2 names test-id and test-ooa as the supported final-reporting
#: partitions and test-novelty as the unsupported surface. Bound here, before
#: any holdout opens, and not selectable from CLI, env, or a caller option.
NOVELTY_SUPPORTED_REFERENCE_PARTITIONS: tuple[str, ...] = ("test-id", "test-ooa")
NOVELTY_SUPPORTED_REFERENCE_ALIASES: tuple[tuple[str, str], ...] = (
    ("test-id", "fixture-id"),
    ("test-ooa", "fixture-ooa"),
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[5]

#: Where a sealed export WOULD live. This file does not exist, and Sprint 4A does
#: not create it. Declared so a test can assert its absence rather than assume it.
CANONICAL_SEALED_EXPORT_PATH = (
    _REPOSITORY_ROOT / "research" / "futurebench" / "data" / "fc008-final-test-corpus.json"
)


class FinalEvaluationNotAuthorized(RuntimeError):
    """Raised when sealed data is requested without complete, explicit authorization."""


class SealedCorpusUnavailable(RuntimeError):
    """Raised when no sealed export exists. The expected Sprint-4A condition."""


class FixturePartitionMisuse(RuntimeError):
    """Raised when a fixture source is handed a REAL sealed partition name.

    The point of a fixture is to exercise the evaluator without going anywhere near
    the holdout. A fixture that answered to ``test-ooa`` would quietly become a way
    to produce something that looks like a real final result.
    """


# ============================================================================
# AUTHORIZATION, ATOMICALLY
# ============================================================================


@dataclass(frozen=True)
class AuthorizationSet:
    """Complete authorization covering every registered family.

    Constructed only by :func:`authorize_all_families`, which refuses to produce a
    partial set. Holding one of these is the evidence that every frozen identity for
    BOTH families validated before anything was opened.
    """

    mode: str
    authorizations: Mapping[str, FinalEvaluationAuthorization]
    preregistration_sha256: str
    artifact_manifest_sha256: str
    evaluation_specification_version: str

    def families(self) -> tuple[str, ...]:
        return tuple(sorted(self.authorizations))

    def for_family(self, model_family: str) -> FinalEvaluationAuthorization:
        authorization = self.authorizations.get(model_family)
        if authorization is None:
            raise FinalEvaluationNotAuthorized(
                f"no authorization for model family {model_family!r}; "
                f"authorized families are {self.families()}"
            )
        return authorization

    def to_canonical(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "registeredFamilies": list(REGISTERED_FAMILIES),
            "authorizedFamilies": list(self.families()),
            "preregistrationSha256": self.preregistration_sha256,
            "artifactManifestSha256": self.artifact_manifest_sha256,
            "evaluationSpecificationVersion": self.evaluation_specification_version,
        }


def authorize_all_families(
    *, mode: str, contexts: Mapping[str, ArtifactContext]
) -> AuthorizationSet:
    """Authorize EVERY registered family, or raise and authorize none.

    Raises before returning if any family is missing, if any family fails its
    identity check, or if the two families disagree about the preregistration or the
    artifact-manifest trust anchor. The last check matters because two
    independently valid authorizations could still have been granted against
    different research states, which would make a cross-family comparison
    meaningless while every individual check passed.
    """
    if mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationNotAuthorized(
            f"final evaluation requires mode {FINAL_EVALUATION_MODE!r}, got {mode!r}"
        )

    missing = [family for family in REGISTERED_FAMILIES if family not in contexts]
    if missing:
        raise FinalEvaluationNotAuthorized(
            "every registered family must be authorized before any sealed partition is "
            f"opened; missing {missing}. Partial evaluation is refused so a failed "
            "family cannot be discovered after the holdout has already been consumed."
        )
    unexpected = sorted(set(contexts) - set(REGISTERED_FAMILIES))
    if unexpected:
        raise FinalEvaluationNotAuthorized(f"unregistered model families supplied: {unexpected}")

    authorizations: dict[str, FinalEvaluationAuthorization] = {}
    for family in REGISTERED_FAMILIES:
        context = contexts[family]
        if context.model_family != family:
            raise FinalEvaluationNotAuthorized(
                f"context keyed as {family!r} declares model family {context.model_family!r}"
            )
        # Raises FinalEvaluationLocked on any mismatch. Nothing is opened yet.
        authorization = authorize_final_evaluation(mode=mode, model_family=family, actual=context)
        # Immediately re-check the issued token against the same loaded artifacts, so
        # the token is never trusted merely because it was checked at authorization.
        assert_authorization_matches_artifacts(authorization, context)
        authorizations[family] = authorization

    anchors = {authorization.artifact_manifest_sha256 for authorization in authorizations.values()}
    preregistrations = {
        authorization.preregistration_sha256 for authorization in authorizations.values()
    }
    if len(anchors) != 1 or len(preregistrations) != 1:
        raise FinalEvaluationNotAuthorized(
            "authorized families disagree about the research state: artifact manifest "
            f"anchors {sorted(anchors)}, preregistration identities {sorted(preregistrations)}"
        )

    return AuthorizationSet(
        mode=mode,
        authorizations=dict(authorizations),
        preregistration_sha256=next(iter(preregistrations)),
        artifact_manifest_sha256=next(iter(anchors)),
        evaluation_specification_version=EVALUATION_SPECIFICATION_VERSION,
    )


# ============================================================================
# SEALED DATA
# ============================================================================


@dataclass(frozen=True)
class EvaluationRow:
    """One labelled evaluation row.

    ``is_novel`` is the novelty-partition ground truth. ``supported`` is the
    frozen deterministic support-gate status from the trusted corpus. Both are
    inputs to the novelty metrics, never model outputs. Supported false
    abstention uses ``supported`` on the frozen supported-reference partitions,
    not the novelty partition.
    """

    record_id: str
    parent_lineage_id: str
    partition: str
    feature_indices: tuple[int, ...]
    feature_values: tuple[float, ...]
    class_number: int | None
    is_novel: bool = False
    supported: bool = True


class SealedCorpusSource(Protocol):
    """A source of sealed rows. Deliberately narrow: one method, read-only."""

    @property
    def source_id(self) -> str: ...

    def read(self, partition: str) -> tuple[EvaluationRow, ...]: ...


@dataclass(frozen=True)
class CanonicalSealedCorpus:
    """The real sealed export reader.

    Currently always raises ``SealedCorpusUnavailable``, because no sealed export
    exists: the TypeScript exporter refuses to write the sealed partitions, so there
    is no file to read. That is the Sprint-4A expected condition and a test asserts
    it. The reader exists so the eventual opening needs authorization and review,
    not new code written under time pressure.
    """

    path: Path = CANONICAL_SEALED_EXPORT_PATH

    @property
    def source_id(self) -> str:
        return "canonical-sealed-export"

    def read(self, partition: str) -> tuple[EvaluationRow, ...]:
        if partition not in SEALED_PARTITIONS:
            raise KeyError(f"{partition!r} is not a sealed partition")
        if not self.path.exists():
            raise SealedCorpusUnavailable(
                f"no sealed export at {self.path}. The FutureBench exporter refuses to "
                "write test-id, test-ooa, or test-novelty, so opening the real final "
                "tests requires a deliberate, reviewed export step that Sprint 4A does "
                "not perform."
            )
        raise SealedCorpusUnavailable(
            f"a file exists at {self.path} but is refused: "
            "fc008-final-test-corpus.json is never a trusted input. Sealed rows "
            "must be derived from the authorized FutureBench source after dual-family "
            "authorization, not read from a caller-supplied file."
        )


@dataclass(frozen=True)
class FixtureCorpus:
    """TEST-ONLY in-memory source over deliberately fake partition names.

    Refuses every real sealed partition name, so no amount of fixture plumbing can
    be redirected at the holdout.
    """

    rows_by_partition: Mapping[str, tuple[EvaluationRow, ...]]

    @property
    def source_id(self) -> str:
        return "in-memory-fixture"

    def read(self, partition: str) -> tuple[EvaluationRow, ...]:
        if partition in SEALED_PARTITIONS:
            raise FixturePartitionMisuse(
                f"fixture source refuses the real sealed partition {partition!r}; "
                f"fixtures must use {FIXTURE_PARTITIONS}"
            )
        rows = self.rows_by_partition.get(partition)
        if rows is None:
            raise KeyError(f"no fixture rows for partition {partition!r}")
        return rows


def open_sealed_partition(
    *,
    mode: str,
    partition: str,
    authorization: AuthorizationSet,
    source: SealedCorpusSource,
) -> tuple[EvaluationRow, ...]:
    """The single gate to sealed data.

    Checks are ordered cheapest-and-most-categorical first, so a refusal never
    depends on whether data happened to be present: mode, then that the partition is
    actually sealed, then that authorization is complete and in the right mode, and
    only then the read.
    """
    if mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationNotAuthorized(
            f"opening a sealed partition requires mode {FINAL_EVALUATION_MODE!r}, got {mode!r}"
        )
    if partition not in SEALED_PARTITIONS:
        raise KeyError(
            f"{partition!r} is not a sealed partition; this gate exists only for "
            f"{SEALED_PARTITIONS}"
        )
    if authorization.mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationNotAuthorized(
            f"authorization was issued in mode {authorization.mode!r}"
        )
    for family in REGISTERED_FAMILIES:
        # Re-checked at the point of use, not merely at construction.
        authorization.for_family(family)
    return source.read(partition)


# ============================================================================
# SYSTEM OUTPUTS
# ============================================================================


@dataclass(frozen=True)
class SystemPredictions:
    """One system's output on one partition.

    A "system" is a (model family, temperature setting) pair: joint scaled, joint
    unscaled, factorized scaled, factorized unscaled. Carrying the temperature
    setting in the identity is what keeps RQ2's scaled-versus-unscaled comparison
    from being confused with RQ1's family comparison.
    """

    model_family: str
    temperature_setting: str
    temperature: float
    predicted_classes: tuple[int, ...]
    probabilities: tuple[tuple[float, ...], ...]
    confidences: tuple[float, ...]
    accepted: tuple[bool, ...]

    def __post_init__(self) -> None:
        lengths = {
            len(self.predicted_classes),
            len(self.probabilities),
            len(self.confidences),
            len(self.accepted),
        }
        if len(lengths) != 1:
            raise MetricInputError(
                f"system {self.label()} has inconsistent output lengths: {sorted(lengths)}"
            )

    def label(self) -> str:
        return f"{self.model_family}/{self.temperature_setting}"

    def correctness(self, actual: Sequence[int]) -> tuple[bool, ...]:
        return tuple(
            int(predicted) == int(truth)
            for predicted, truth in zip(self.predicted_classes, actual, strict=True)
        )


def concatenate_system_predictions(
    first: SystemPredictions, second: SystemPredictions
) -> SystemPredictions:
    """Join two same-system prediction blocks, preserving identity fields."""
    if (
        first.model_family != second.model_family
        or first.temperature_setting != second.temperature_setting
    ):
        raise MetricInputError("cannot concatenate predictions from different systems")
    return SystemPredictions(
        model_family=first.model_family,
        temperature_setting=first.temperature_setting,
        temperature=first.temperature,
        predicted_classes=first.predicted_classes + second.predicted_classes,
        probabilities=first.probabilities + second.probabilities,
        confidences=first.confidences + second.confidences,
        accepted=first.accepted + second.accepted,
    )


def novelty_population_from_partitions(partitions: Sequence[str]) -> str:
    """Resolve the single novelty partition present in a validated corpus."""
    matched = [name for name in partitions if name in NOVELTY_POPULATION_ALIASES]
    if len(matched) != 1:
        raise MetricInputError("validated corpus must contain exactly one novelty partition")
    return matched[0]


def supported_reference_partitions_from_partitions(
    partitions: Sequence[str],
) -> tuple[str, ...]:
    """Resolve the frozen supported-reference aliases present in a corpus.

    The production names are test-id and test-ooa. Fixture corpora use the
    corresponding fixture-* aliases. The caller cannot choose a different set.
    """
    resolved: list[str] = []
    available = set(partitions)
    for production_name, fixture_name in NOVELTY_SUPPORTED_REFERENCE_ALIASES:
        matched = [name for name in (production_name, fixture_name) if name in available]
        if len(matched) != 1:
            raise MetricInputError(
                "validated corpus must contain exactly one "
                f"{production_name} supported-reference partition"
            )
        resolved.append(matched[0])
    return tuple(resolved)


def supported_reference_rows_from_corpus(
    corpus: ValidatedSealedCorpus,
) -> tuple[EvaluationRow, ...]:
    """Load the frozen supported-reference partitions from one validated corpus."""
    if type(corpus) is not ValidatedSealedCorpus:
        raise TypeError("supported reference rows require a ValidatedSealedCorpus")
    rows: list[EvaluationRow] = []
    for partition in supported_reference_partitions_from_partitions(corpus.partitions()):
        rows.extend(evaluation_rows_from_corpus(corpus, partition))
    return tuple(rows)


@dataclass(frozen=True)
class PartitionMetrics:
    """Every metric for one system on one partition."""

    partition: str
    model_family: str
    temperature_setting: str
    temperature: float
    record_count: int
    parent_lineage_count: int
    structured_exact_match: float
    macro_f1_fixed_thirteen: float
    macro_f1_observed_classes: float
    negative_log_likelihood: float
    multiclass_brier: float
    calibration: CalibrationError
    risk_coverage: RiskCoverageCurve
    matched_coverage: tuple[metric_module.MatchedCoverageResult, ...]
    fixed_risk: tuple[metric_module.FixedRiskResult, ...]
    per_class: tuple[metric_module.ClassMetrics, ...]
    confusion: tuple[tuple[int, ...], ...]
    observed_classes: tuple[int, ...]

    def to_canonical(self) -> dict[str, object]:
        return {
            "partition": self.partition,
            "modelFamily": self.model_family,
            "temperatureSetting": self.temperature_setting,
            "temperature": self.temperature,
            "recordCount": self.record_count,
            "parentLineageCount": self.parent_lineage_count,
            "observedClasses": list(self.observed_classes),
            "structuredExactMatch": self.structured_exact_match,
            "macroF1FixedThirteen": self.macro_f1_fixed_thirteen,
            "macroF1ObservedClasses": self.macro_f1_observed_classes,
            "negativeLogLikelihood": self.negative_log_likelihood,
            "multiclassBrier": self.multiclass_brier,
            "calibration": self.calibration.to_canonical(),
            "riskCoverage": self.risk_coverage.to_canonical(),
            "riskAtMatchedCoverage": [entry.to_canonical() for entry in self.matched_coverage],
            "coverageAtFixedRisk": [entry.to_canonical() for entry in self.fixed_risk],
            "perClass": [entry.to_canonical() for entry in self.per_class],
            "confusionMatrix": [list(row) for row in self.confusion],
        }


def evaluate_system(
    rows: Sequence[EvaluationRow], predictions: SystemPredictions
) -> PartitionMetrics:
    """Compute every metric for one system on one set of rows.

    PURE: takes rows and predictions, returns numbers. It has no authorization
    parameter and no data source, which is what lets the whole metric surface be
    tested exhaustively on synthetic fixtures without going near the seal.
    """
    if len(rows) == 0:
        raise MetricInputError("cannot evaluate an empty partition")
    actual: list[int] = []
    for row in rows:
        if row.class_number is None:
            raise MetricInputError(
                f"row {row.record_id!r} has no class number; label-free rows belong to "
                "the novelty path, not the structured-accuracy path"
            )
        actual.append(int(row.class_number))
    if len(actual) != len(predictions.predicted_classes):
        raise MetricInputError(
            f"{len(actual)} rows against {len(predictions.predicted_classes)} predictions"
        )

    correct = predictions.correctness(actual)
    curve = risk_coverage_curve(predictions.confidences, correct)
    partitions = {row.partition for row in rows}
    if len(partitions) != 1:
        raise MetricInputError(f"rows span multiple partitions: {sorted(partitions)}")

    return PartitionMetrics(
        partition=next(iter(partitions)),
        model_family=predictions.model_family,
        temperature_setting=predictions.temperature_setting,
        temperature=predictions.temperature,
        record_count=len(rows),
        parent_lineage_count=len({row.parent_lineage_id for row in rows}),
        structured_exact_match=structured_exact_match(predictions.predicted_classes, actual),
        macro_f1_fixed_thirteen=macro_f1_fixed_thirteen(predictions.predicted_classes, actual),
        macro_f1_observed_classes=macro_f1_observed_classes(predictions.predicted_classes, actual),
        negative_log_likelihood=negative_log_likelihood(predictions.probabilities, actual),
        multiclass_brier=multiclass_brier(predictions.probabilities, actual),
        calibration=expected_calibration_error(predictions.confidences, correct),
        risk_coverage=curve,
        matched_coverage=risk_at_matched_coverage(curve),
        fixed_risk=coverage_at_fixed_risk(curve),
        per_class=per_class_metrics(
            predictions.predicted_classes, actual, metric_module.FIXED_THIRTEEN_LABELS
        ),
        confusion=metric_module.confusion_matrix(predictions.predicted_classes, actual),
        observed_classes=tuple(sorted({int(value) for value in actual})),
    )


def _row_abstained(row: EvaluationRow, accepted: bool) -> bool:
    """Abstention is the policy complement, or a support-gate refusal in front."""
    return (not accepted) or (not row.supported)


def evaluate_novelty(
    *,
    novel_rows: Sequence[EvaluationRow],
    novel_predictions: SystemPredictions,
    supported_reference_rows: Sequence[EvaluationRow],
    supported_reference_predictions: SystemPredictions,
) -> NoveltyMetrics:
    """Novelty behaviour from two explicitly separated populations.

    Novelty abstention recall and novelty false acceptance use ``novel_rows``.
    Supported false abstention uses only those ``supported_reference_rows``
    whose trusted ``supported`` flag is true. The two populations are never
    inferred from a single mixed list.

    Abstention is the complement of acceptance, and acceptance comes from the
    runtime policy, not from this evaluator. A row that the deterministic support
    gates already refused counts as abstained regardless of what the model scored,
    because the gates sit in front of the model.
    """
    if len(novel_rows) != len(novel_predictions.accepted):
        raise MetricInputError(
            f"{len(novel_rows)} novelty rows against {len(novel_predictions.accepted)} decisions"
        )
    if len(supported_reference_rows) != len(supported_reference_predictions.accepted):
        raise MetricInputError(
            f"{len(supported_reference_rows)} supported-reference rows against "
            f"{len(supported_reference_predictions.accepted)} decisions"
        )
    if any(not row.is_novel for row in novel_rows):
        raise MetricInputError("novel population must contain only novel rows")
    if any(row.is_novel for row in supported_reference_rows):
        raise MetricInputError("supported reference population must not contain novel rows")

    novel_abstained = [
        _row_abstained(row, accepted)
        for row, accepted in zip(novel_rows, novel_predictions.accepted, strict=True)
    ]
    supported_pairs = [
        (row, _row_abstained(row, accepted))
        for row, accepted in zip(
            supported_reference_rows,
            supported_reference_predictions.accepted,
            strict=True,
        )
        if row.supported
    ]
    if not supported_pairs:
        raise MetricInputError(
            "supported reference population must contain at least one supported row"
        )

    supported_rows = [row for row, _flag in supported_pairs]
    supported_abstained = [flag for _row, flag in supported_pairs]
    is_novel = [True] * len(novel_rows) + [False] * len(supported_rows)
    abstained = novel_abstained + supported_abstained
    metrics = novelty_metrics(is_novel, abstained)
    novelty_partitions = tuple(sorted({row.partition for row in novel_rows}))
    if len(novelty_partitions) == 1:
        novelty_population = novelty_partitions[0]
    else:
        novelty_population = ",".join(novelty_partitions)
    return replace(
        metrics,
        novelty_population=novelty_population,
        supported_reference_partitions=tuple(sorted({row.partition for row in supported_rows})),
    )


# ============================================================================
# RQ1 AND RQ2 COMPARISONS
# ============================================================================


@dataclass(frozen=True)
class ComparisonResult:
    """A paired comparison with its delta and its clustered interval."""

    question: str
    metric: str
    delta: metric_module.PairedDelta
    interval: object

    def to_canonical(self) -> dict[str, object]:
        interval = self.interval
        canonical = interval.to_canonical() if hasattr(interval, "to_canonical") else None
        return {
            "question": self.question,
            "metric": self.metric,
            "delta": self.delta.to_canonical(),
            "bootstrap": canonical,
        }


def compare_rq1(
    rows: Sequence[EvaluationRow],
    joint: SystemPredictions,
    factorized: SystemPredictions,
    *,
    power_limitation: str | None = None,
) -> tuple[ComparisonResult, ...]:
    """RQ1: factorized minus joint, on structured exact match and fixed-13 macro F1.

    Direction is FACTORIZED MINUS JOINT throughout, so a positive delta always means
    the factorized family scored higher. Both metrics use the same subtraction order
    and the same lineage draws.
    """
    actual = [int(row.class_number) for row in rows if row.class_number is not None]
    if len(actual) != len(rows):
        raise MetricInputError("RQ1 requires every row to carry a class number")
    lineage_ids = [row.parent_lineage_id for row in rows]

    def subset(
        predictions: SystemPredictions, metric_name: str
    ) -> Callable[[Sequence[int]], float]:
        def statistic(indices: Sequence[int]) -> float:
            predicted = [predictions.predicted_classes[index] for index in indices]
            truth = [actual[index] for index in indices]
            if metric_name == "structuredExactMatch":
                return structured_exact_match(predicted, truth)
            return macro_f1_fixed_thirteen(predicted, truth)

        return statistic

    results: list[ComparisonResult] = []
    for metric_name, higher_is_better in (
        ("structuredExactMatch", True),
        ("macroF1FixedThirteen", True),
    ):
        factorized_statistic = subset(factorized, metric_name)
        joint_statistic = subset(joint, metric_name)
        all_rows = tuple(range(len(rows)))
        results.append(
            ComparisonResult(
                question="RQ1",
                metric=metric_name,
                delta=paired_delta(
                    metric_name,
                    minuend_label="factorized-logistic",
                    subtrahend_label="joint-logistic",
                    minuend=factorized_statistic(all_rows),
                    subtrahend=joint_statistic(all_rows),
                    higher_is_better=higher_is_better,
                ),
                interval=bootstrap_paired_delta(
                    lineage_ids,
                    factorized_statistic,
                    joint_statistic,
                    metric=metric_name,
                    minuend_label="factorized-logistic",
                    subtrahend_label="joint-logistic",
                    power_limitation=power_limitation,
                ),
            )
        )
    return tuple(results)


def compare_rq2(
    rows: Sequence[EvaluationRow],
    scaled: SystemPredictions,
    unscaled: SystemPredictions,
    *,
    power_limitation: str | None = None,
) -> tuple[ComparisonResult, ...]:
    """RQ2: scaled minus unscaled, on the calibration and selective metrics.

    Direction is SCALED MINUS UNSCALED. NLL, Brier, ECE, and AURC are all
    error-like, so a NEGATIVE delta means temperature scaling helped; each result
    records ``higherIsBetter: false`` so the sign is never read backwards.
    """
    if scaled.model_family != unscaled.model_family:
        raise MetricInputError(
            "RQ2 compares temperatures within one model family, but received "
            f"{scaled.model_family!r} and {unscaled.model_family!r}"
        )
    actual = [int(row.class_number) for row in rows if row.class_number is not None]
    if len(actual) != len(rows):
        raise MetricInputError("RQ2 requires every row to carry a class number")
    lineage_ids = [row.parent_lineage_id for row in rows]

    def statistic_for(
        predictions: SystemPredictions, metric_name: str
    ) -> Callable[[Sequence[int]], float]:
        def statistic(indices: Sequence[int]) -> float:
            truth = [actual[index] for index in indices]
            probabilities = [predictions.probabilities[index] for index in indices]
            confidences = [predictions.confidences[index] for index in indices]
            predicted = [predictions.predicted_classes[index] for index in indices]
            correct = [int(p) == int(t) for p, t in zip(predicted, truth, strict=True)]
            if metric_name == "negativeLogLikelihood":
                return negative_log_likelihood(probabilities, truth)
            if metric_name == "multiclassBrier":
                return multiclass_brier(probabilities, truth)
            if metric_name == "expectedCalibrationError":
                return expected_calibration_error(confidences, correct).expected_calibration_error
            return risk_coverage_curve(confidences, correct).aurc

        return statistic

    results: list[ComparisonResult] = []
    for metric_name in (
        "negativeLogLikelihood",
        "multiclassBrier",
        "expectedCalibrationError",
        "aurc",
    ):
        scaled_statistic = statistic_for(scaled, metric_name)
        unscaled_statistic = statistic_for(unscaled, metric_name)
        all_rows = tuple(range(len(rows)))
        results.append(
            ComparisonResult(
                question="RQ2",
                metric=metric_name,
                delta=paired_delta(
                    metric_name,
                    minuend_label=f"{scaled.model_family}/scaled",
                    subtrahend_label=f"{unscaled.model_family}/unscaled",
                    minuend=scaled_statistic(all_rows),
                    subtrahend=unscaled_statistic(all_rows),
                    higher_is_better=False,
                ),
                interval=bootstrap_paired_delta(
                    lineage_ids,
                    scaled_statistic,
                    unscaled_statistic,
                    metric=metric_name,
                    minuend_label=f"{scaled.model_family}/scaled",
                    subtrahend_label=f"{unscaled.model_family}/unscaled",
                    power_limitation=power_limitation,
                ),
            )
        )
    return tuple(results)


def bootstrap_structured_exact_match(
    rows: Sequence[EvaluationRow],
    predictions: SystemPredictions,
    *,
    power_limitation: str | None = None,
) -> BootstrapInterval:
    """Clustered interval for one system's structured exact match."""
    actual = [int(row.class_number) for row in rows if row.class_number is not None]
    if len(actual) != len(rows):
        raise MetricInputError("every row must carry a class number")

    def statistic(indices: Sequence[int]) -> float:
        predicted = [predictions.predicted_classes[index] for index in indices]
        truth = [actual[index] for index in indices]
        return structured_exact_match(predicted, truth)

    return bootstrap_statistic(
        [row.parent_lineage_id for row in rows], statistic, power_limitation=power_limitation
    )


# ============================================================================
# RESULT ARTIFACT
# ============================================================================


@dataclass(frozen=True)
class EvaluationResult:
    """The canonical, versioned, hashable result artifact.

    Every identity needed to know WHAT was evaluated is carried in the artifact
    itself, so a result file is interpretable without its surrounding directory. The
    canonical bytes contain NO wall-clock timestamp: a timestamp would make two
    identical evaluations hash differently and destroy the only cheap check that a
    result was reproduced rather than regenerated.
    """

    evaluation_schema_version: str
    evaluation_specification_version: str
    preregistration_version: str
    authorization: AuthorizationSet
    dataset_hash: str
    vocabulary_hash: str
    support_matrix_version: str
    feature_policy_version: str
    partitions: tuple[PartitionMetrics, ...]
    comparisons: tuple[ComparisonResult, ...]
    novelty: Mapping[str, NoveltyMetrics] = field(default_factory=dict)
    limitations: tuple[str, ...] = ()
    sealed_corpus_sha256: str = ""
    partition_record_counts: Mapping[str, int] = field(default_factory=dict)
    partition_lineage_counts: Mapping[str, int] = field(default_factory=dict)

    def to_canonical(self) -> dict[str, object]:
        families = {
            family: {
                "modelArtifactSha256": authorization.model_artifact_sha256,
                "calibrationArtifactSha256": authorization.calibration_artifact_sha256,
                "policyArtifactSha256": authorization.policy_artifact_sha256,
                "modelVersion": authorization.model_version,
                "calibrationArtifactVersion": authorization.calibration_artifact_version,
                "abstentionPolicyVersion": authorization.abstention_policy_version,
            }
            for family, authorization in sorted(self.authorization.authorizations.items())
        }
        return {
            "evaluationSchemaVersion": self.evaluation_schema_version,
            "evaluationSpecificationVersion": self.evaluation_specification_version,
            "preregistrationVersion": self.preregistration_version,
            "preregistrationSha256": self.authorization.preregistration_sha256,
            "artifactManifestSha256": self.authorization.artifact_manifest_sha256,
            "datasetHash": self.dataset_hash,
            "vocabularyHash": self.vocabulary_hash,
            "supportMatrixVersion": self.support_matrix_version,
            "featurePolicyVersion": self.feature_policy_version,
            "sealedCorpusSha256": self.sealed_corpus_sha256,
            "partitionRecordCounts": dict(self.partition_record_counts),
            "partitionLineageCounts": dict(self.partition_lineage_counts),
            "modelFamilies": families,
            "metricDefinitions": metric_module.metric_definitions_canonical(),
            "bootstrap": bootstrap_configuration_canonical(),
            "partitions": [entry.to_canonical() for entry in self.partitions],
            "comparisons": [entry.to_canonical() for entry in self.comparisons],
            "novelty": {
                partition: value.to_canonical() for partition, value in sorted(self.novelty.items())
            },
            "limitations": list(self.limitations),
        }

    def result_sha256(self) -> str:
        """SHA-256 of the canonical JSON. Stable across runs by construction."""
        return canonical_sha256(self.to_canonical())


DEFAULT_LIMITATIONS: tuple[str, ...] = (
    "FutureBench V1 is entirely synthetic authored content; results describe behaviour "
    "on this corpus only and are not evidence about real websites, real users, or "
    "production accuracy",
    OOA_POWER_LIMITATION,
    "all 13 (verb, objectKind) pairs in the frozen support set are unique, so transition "
    "property adds no independent class discrimination; any factorized difference must "
    "not be attributed specifically to transition factorization",
    "novelty rates come from frozen deterministic support gates plus the frozen "
    "confidence threshold and are not evidence of robust statistical out-of-distribution "
    "detection",
    "no model family winner is selected from these results; ADR-016 remains binding",
)


def build_evaluation_result(
    *,
    authorization: AuthorizationSet,
    sealed_corpus: ValidatedSealedCorpus,
    partitions: Sequence[PartitionMetrics],
    comparisons: Sequence[ComparisonResult],
    novelty: Mapping[str, NoveltyMetrics] | None = None,
    limitations: Sequence[str] = DEFAULT_LIMITATIONS,
) -> EvaluationResult:
    """Assemble a result artifact from an authorization, a validated corpus, and metrics.

    The shared identities are read from the authorization rather than passed in, so a
    result cannot claim a dataset or vocabulary that the authorization did not cover.
    The sealed-corpus identity is read from the validated object, so a result cannot
    bind a caller-supplied hash.
    """
    if type(sealed_corpus) is not ValidatedSealedCorpus:
        raise TypeError(
            "build_evaluation_result requires a ValidatedSealedCorpus; "
            "raw rows are not an accepted input"
        )
    any_authorization = next(iter(authorization.authorizations.values()))
    return EvaluationResult(
        evaluation_schema_version=EVALUATION_SCHEMA_VERSION,
        evaluation_specification_version=EVALUATION_SPECIFICATION_VERSION,
        preregistration_version=PREREGISTRATION_VERSION,
        authorization=authorization,
        dataset_hash=any_authorization.dataset_hash,
        vocabulary_hash=any_authorization.vocabulary_hash,
        support_matrix_version=any_authorization.support_matrix_version,
        feature_policy_version=any_authorization.feature_policy_version,
        partitions=tuple(partitions),
        comparisons=tuple(comparisons),
        novelty=dict(novelty or {}),
        limitations=tuple(limitations),
        sealed_corpus_sha256=sealed_corpus.sealed_corpus_sha256,
        partition_record_counts=sealed_corpus.partition_record_counts,
        partition_lineage_counts=sealed_corpus.partition_lineage_counts,
    )


def evaluation_rows_from_corpus(
    corpus: ValidatedSealedCorpus, partition: str
) -> tuple[EvaluationRow, ...]:
    """Convert validated sealed rows for one partition into evaluation rows.

    Requires a ``ValidatedSealedCorpus``. A raw list is refused, so the metric
    functions cannot be pointed at caller-defined JSON by accident through this path.
    """
    if type(corpus) is not ValidatedSealedCorpus:
        raise TypeError("evaluation requires a ValidatedSealedCorpus, not raw rows")
    return tuple(
        EvaluationRow(
            record_id=row.record_id,
            parent_lineage_id=row.parent_lineage_id,
            partition=row.partition,
            feature_indices=row.feature_indices,
            feature_values=row.feature_values,
            class_number=row.class_number,
            is_novel=row.is_novel,
            supported=row.supported,
        )
        for row in corpus.rows_in(partition)
    )


def evaluate_from_validated_corpus(
    *,
    authorization: AuthorizationSet,
    corpus: ValidatedSealedCorpus,
    systems: Mapping[str, Sequence[SystemPredictions]] | None = None,
    novelty_systems: Mapping[str, SystemPredictions] | None = None,
    supported_reference_systems: Mapping[str, SystemPredictions] | None = None,
) -> EvaluationResult:
    """Score both families from one immutable validated corpus.

    ``systems`` is optional so identity binding can be tested without calling a
    model. When predictions are supplied they are scored against the corpus rows;
    the same corpus identity is written onto every result section.

    Novelty populations are bound from the corpus: novelty rates use the novelty
    partition, and supported false abstention uses the frozen supported-reference
    partitions. The caller supplies the matching prediction blocks but cannot
    choose a different reference set.
    """
    if type(corpus) is not ValidatedSealedCorpus:
        raise TypeError("evaluate_from_validated_corpus requires a ValidatedSealedCorpus")
    partition_metrics: list[PartitionMetrics] = []
    for partition, predictions_list in (systems or {}).items():
        rows = evaluation_rows_from_corpus(corpus, partition)
        for predictions in predictions_list:
            partition_metrics.append(evaluate_system(rows, predictions))
    novelty: dict[str, NoveltyMetrics] = {}
    if novelty_systems:
        if not supported_reference_systems:
            raise MetricInputError(
                "supported_reference_systems is required whenever novelty_systems is supplied"
            )
        novelty_partition = novelty_population_from_partitions(corpus.partitions())
        supported_rows = supported_reference_rows_from_corpus(corpus)
        novel_rows = evaluation_rows_from_corpus(corpus, novelty_partition)
        for key, predictions in novelty_systems.items():
            if key not in supported_reference_systems:
                raise MetricInputError(
                    f"missing supported-reference predictions for novelty system {key!r}"
                )
            novelty[key] = evaluate_novelty(
                novel_rows=novel_rows,
                novel_predictions=predictions,
                supported_reference_rows=supported_rows,
                supported_reference_predictions=supported_reference_systems[key],
            )
    return build_evaluation_result(
        authorization=authorization,
        sealed_corpus=corpus,
        partitions=partition_metrics,
        comparisons=(),
        novelty=novelty,
    )


def evaluation_specification_canonical() -> dict[str, object]:
    """The evaluation specification, validated before any sealed partition opens."""
    return {
        "evaluationSchemaVersion": EVALUATION_SCHEMA_VERSION,
        "evaluationSpecificationVersion": EVALUATION_SPECIFICATION_VERSION,
        "mode": FINAL_EVALUATION_MODE,
        "registeredFamilies": list(REGISTERED_FAMILIES),
        "sealedPartitions": list(SEALED_PARTITIONS),
        "fixturePartitions": list(FIXTURE_PARTITIONS),
        "authorizationIsAtomicAcrossFamilies": True,
        "partialEvaluationRefused": True,
        "metricDefinitions": metric_module.metric_definitions_canonical(),
        "bootstrap": bootstrap_configuration_canonical(),
        "canonicalBytesContainNoTimestamp": True,
        "performanceDependentExit": False,
        "validatedSealedCorpusRequired": True,
        "realSealedOpeningRequiresExplicitPermit": True,
        "physicalSealedCorpusFileTrusted": False,
        "oneValidatedCorpusForBothFamilies": True,
        "productionScoringDerivesPredictionsInternally": True,
        "outputRequiredForRealOpening": True,
        "noveltyPopulationPartition": NOVELTY_POPULATION_PARTITION,
        "noveltySupportedReferencePartitions": list(NOVELTY_SUPPORTED_REFERENCE_PARTITIONS),
        "noveltySupportedReferenceUsesFrozenSupportStatus": True,
        "noveltyCallerConfigurableReference": False,
    }


__all__ = [
    "CANONICAL_SEALED_EXPORT_PATH",
    "DEFAULT_LIMITATIONS",
    "EVALUATION_SCHEMA_VERSION",
    "EVALUATION_SPECIFICATION_VERSION",
    "FIXTURE_PARTITIONS",
    "NOVELTY_POPULATION_ALIASES",
    "NOVELTY_POPULATION_PARTITION",
    "NOVELTY_SUPPORTED_REFERENCE_ALIASES",
    "NOVELTY_SUPPORTED_REFERENCE_PARTITIONS",
    "SEALED_PARTITIONS",
    "AuthorizationSet",
    "CanonicalSealedCorpus",
    "ComparisonResult",
    "EvaluationResult",
    "EvaluationRow",
    "FinalEvaluationLocked",
    "FinalEvaluationNotAuthorized",
    "FixtureCorpus",
    "FixturePartitionMisuse",
    "PartitionMetrics",
    "SealedCorpusSource",
    "SealedCorpusUnavailable",
    "SystemPredictions",
    "ValidatedSealedCorpus",
    "authorize_all_families",
    "bootstrap_structured_exact_match",
    "build_evaluation_result",
    "compare_rq1",
    "compare_rq2",
    "concatenate_system_predictions",
    "evaluate_from_validated_corpus",
    "evaluate_novelty",
    "evaluate_system",
    "evaluation_rows_from_corpus",
    "evaluation_specification_canonical",
    "novelty_population_from_partitions",
    "open_sealed_partition",
    "supported_reference_partitions_from_partitions",
    "supported_reference_rows_from_corpus",
]

"""FC-008 Sprint 4A evaluation metrics.

Every definition here is fixed BEFORE any sealed partition is opened, and each one
is written out as an explicit equation rather than delegated to a library default,
because a library default is a choice nobody recorded. The frozen preregistration
supplies the constants (15 bins, the coverage and risk targets, the fixed-13 label
universe, zero-division handling); this module supplies the arithmetic and, where
the preregistration deliberately left a convention open, states the convention it
fixes and why.

THREE CONVENTIONS FIXED HERE, NOT IN THE PREREGISTRATION

The preregistration names "multiclass Brier score", "AURC", and "nearest
achievable empirical coverage" without pinning the exact formula or the tie-break.
Those are fixed below, once, and used identically for joint and factorized, scaled
and unscaled, ID and OOA. They are fixed now, while no final result is visible, so
the choice cannot be made to flatter an outcome:

1. MULTICLASS BRIER
       BS = (1/N) * sum_i sum_k (p_ik - y_ik)^2
   where y_ik is 1 when class k is the true class of row i and 0 otherwise, and k
   runs over all 13 frozen classes. This is the standard multiclass (Brier's
   original) form. Its range is [0, 2], NOT [0, 1]: a confidently wrong
   one-hot prediction contributes 1 from the true class and 1 from the predicted
   class. No factor of 1/2 and no per-class averaging is applied, so a reader
   comparing these numbers to a source that halves them must divide by two.

2. AURC
       AURC = sum_i risk_i * (coverage_i - coverage_{i-1}),  coverage_0 = 0
   over the achievable coverage points in increasing coverage order. This is a
   right-endpoint step integral of selective risk with respect to coverage across
   [0, 1]. Because full coverage is always achievable, the increments sum to
   exactly 1 and AURC is therefore a coverage-weighted mean of the achievable
   selective risks. No interpolation between achievable coverages and no
   trapezoidal smoothing: with six parent lineages on test-OOA, interpolation
   would invent operating points the data cannot support. Lower is better.

3. MATCHED-COVERAGE TIE-BREAK
   The preregistration says "nearest achievable empirical coverage without
   interpolation" but does not say what to do when two achievable coverages are
   equidistant from a target. Fixed here as: smaller absolute difference first,
   then HIGHER achieved coverage. Preferring the higher coverage on a tie means
   the reported operating point abstains less, which is the less flattering choice
   for selective risk and so cannot be accused of being chosen to look good.

SELECTIVE STATISTICS AND TIES

Acceptance is by confidence threshold, and all rows sharing a confidence value are
accepted or rejected TOGETHER. A coverage level that would require splitting a tied
group is therefore not achievable, and is not manufactured by interpolation. This
is why the achievable coverage set has one point per distinct confidence value
rather than one point per row.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

# The frozen label universe. Absent classes stay in the macro average.
FIXED_THIRTEEN_LABELS: tuple[int, ...] = tuple(range(1, 14))

# Frozen zero-division value for precision, recall, and F1.
ZERO_DIVISION = 0.0

# Frozen ECE configuration.
ECE_BIN_COUNT = 15
ECE_RANGE = (0.0, 1.0)

# Frozen targets.
MATCHED_COVERAGE_TARGETS: tuple[float, ...] = (0.25, 0.50, 0.75, 1.00)
FIXED_RISK_TARGETS: tuple[float, ...] = (0.05, 0.10, 0.20)

# Documented identifiers so a result artifact can name the exact arithmetic it used.
METRIC_DEFINITIONS_VERSION = "1.0"
BRIER_FORMULATION = (
    "BS = mean_i sum_k (p_ik - y_ik)^2 over all 13 frozen classes; range [0, 2]; "
    "no factor of one half"
)
AURC_CONVENTION = (
    "right-endpoint step integral of selective risk over coverage on [0, 1] using "
    "only achievable coverage points; increments sum to 1; no interpolation"
)
MATCHED_COVERAGE_TIE_BREAK = (
    "smaller absolute difference from the target first, then higher achieved coverage"
)
ACCEPTANCE_TIE_RULE = "rows sharing a confidence value are accepted or rejected together"

# Keeps log finite when a probability underflows to exactly zero. Matches the
# reference clip in calibration.py so NLL cannot diverge between the two.
PROBABILITY_LOG_FLOOR = 1e-300


class MetricInputError(ValueError):
    """Raised when metric inputs are inconsistent. Fails closed rather than guessing."""


def _require_same_length(
    name_a: str, a: Sequence[object], name_b: str, b: Sequence[object]
) -> None:
    if len(a) != len(b):
        raise MetricInputError(f"{name_a} has {len(a)} entries but {name_b} has {len(b)}")


def _require_non_empty(name: str, values: Sequence[object]) -> None:
    if len(values) == 0:
        raise MetricInputError(f"{name} must not be empty")


# ============================================================================
# RQ1: STRUCTURED EXACT MATCH AND MACRO F1
# ============================================================================


def structured_exact_match(predicted: Sequence[int], actual: Sequence[int]) -> float:
    """Fraction of rows whose predicted 13-tuple class equals the true class.

    "Structured" because a class number IS a (verb, objectKind, transitionProperty)
    tuple under the frozen support matrix, so an exact class match is an exact tuple
    match. There is no partial credit: predicting the right verb with the wrong
    object is simply wrong here, and per-field credit is a separate secondary metric.
    """
    _require_same_length("predicted", predicted, "actual", actual)
    _require_non_empty("actual", actual)
    correct = sum(1 for p, a in zip(predicted, actual, strict=True) if int(p) == int(a))
    return correct / len(actual)


@dataclass(frozen=True)
class ClassMetrics:
    """Precision, recall, F1, and support for one class."""

    label: int
    precision: float
    recall: float
    f1: float
    support: int
    predicted_count: int

    def to_canonical(self) -> dict[str, float | int]:
        return {
            "label": self.label,
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "support": self.support,
            "predictedCount": self.predicted_count,
        }


def per_class_metrics(
    predicted: Sequence[int], actual: Sequence[int], labels: Sequence[int]
) -> tuple[ClassMetrics, ...]:
    """Per-class precision, recall, and F1 over an explicit label universe.

    The label universe is a PARAMETER, never inferred from the data, because
    inferring it is exactly the mistake that turns the frozen fixed-13 metric into
    the observed-class metric without anyone noticing.
    """
    _require_same_length("predicted", predicted, "actual", actual)
    results: list[ClassMetrics] = []
    for label in labels:
        true_positive = sum(
            1 for p, a in zip(predicted, actual, strict=True) if int(p) == label and int(a) == label
        )
        predicted_count = sum(1 for p in predicted if int(p) == label)
        support = sum(1 for a in actual if int(a) == label)
        precision = true_positive / predicted_count if predicted_count > 0 else ZERO_DIVISION
        recall = true_positive / support if support > 0 else ZERO_DIVISION
        denominator = precision + recall
        f1 = (2 * precision * recall / denominator) if denominator > 0 else ZERO_DIVISION
        results.append(
            ClassMetrics(
                label=label,
                precision=precision,
                recall=recall,
                f1=f1,
                support=support,
                predicted_count=predicted_count,
            )
        )
    return tuple(results)


def macro_f1_fixed_thirteen(predicted: Sequence[int], actual: Sequence[int]) -> float:
    """Macro F1 over the frozen 1..13 universe, absent classes included as zero.

    THE PRIMARY RQ1 CALIBRATION-FREE METRIC. test-OOA observes only six of the
    thirteen classes, so the seven absent classes each contribute an F1 of exactly
    0.0 to a thirteen-way average under the frozen ``zeroDivision: 0`` rule. That
    is intentional and it is why this number is much lower than the observed-class
    variant. Dropping absent classes would silently change the denominator from 13
    to 6 and roughly double the score, which is precisely the substitution the
    preregistration forbids.
    """
    _require_non_empty("actual", actual)
    scores = [metrics.f1 for metrics in per_class_metrics(predicted, actual, FIXED_THIRTEEN_LABELS)]
    return sum(scores) / len(FIXED_THIRTEEN_LABELS)


def macro_f1_observed_classes(predicted: Sequence[int], actual: Sequence[int]) -> float:
    """Macro F1 over classes observed in the TRUE labels only. SECONDARY CONTEXT.

    Reported alongside the fixed-13 metric and never in place of it. The universe is
    the set of classes actually present in ``actual``; a class the model predicted
    but which never occurs is not given its own averaging slot, though its false
    positives still damage the precision of the class it was confused with.
    """
    _require_non_empty("actual", actual)
    observed = sorted({int(a) for a in actual})
    scores = [metrics.f1 for metrics in per_class_metrics(predicted, actual, observed)]
    return sum(scores) / len(observed)


def confusion_matrix(
    predicted: Sequence[int], actual: Sequence[int], labels: Sequence[int] = FIXED_THIRTEEN_LABELS
) -> tuple[tuple[int, ...], ...]:
    """Counts indexed ``[actual][predicted]`` over an explicit label universe."""
    _require_same_length("predicted", predicted, "actual", actual)
    position = {label: index for index, label in enumerate(labels)}
    counts = [[0 for _ in labels] for _ in labels]
    for p, a in zip(predicted, actual, strict=True):
        actual_index = position.get(int(a))
        predicted_index = position.get(int(p))
        if actual_index is None or predicted_index is None:
            raise MetricInputError(
                f"observed label pair ({a}, {p}) falls outside the declared universe {list(labels)}"
            )
        counts[actual_index][predicted_index] += 1
    return tuple(tuple(row) for row in counts)


# ============================================================================
# RQ2: PROBABILISTIC CALIBRATION
# ============================================================================


def _one_hot_position(class_order: Sequence[int]) -> dict[int, int]:
    return {int(label): index for index, label in enumerate(class_order)}


def negative_log_likelihood(
    probabilities: Sequence[Sequence[float]],
    actual: Sequence[int],
    class_order: Sequence[int] = FIXED_THIRTEEN_LABELS,
) -> float:
    """Mean multiclass NLL of the true class under the fixed 13-class distribution.

        NLL = -(1/N) * sum_i log p_i[true class of i]

    Computed from the probability of the TRUE class only. The clip keeps the
    logarithm finite when a probability underflows to exactly zero; it is a floor on
    an already-catastrophic prediction, not a smoothing parameter, and it matches the
    reference clip so the Python training path and this evaluator agree.
    """
    _require_same_length("probabilities", probabilities, "actual", actual)
    _require_non_empty("actual", actual)
    position = _one_hot_position(class_order)
    total = 0.0
    for row, label in zip(probabilities, actual, strict=True):
        if len(row) != len(class_order):
            raise MetricInputError(
                f"probability row has {len(row)} entries, expected {len(class_order)}"
            )
        index = position.get(int(label))
        if index is None:
            raise MetricInputError(f"actual class {label} is outside the class order")
        total += math.log(max(float(row[index]), PROBABILITY_LOG_FLOOR))
    return -total / len(actual)


def multiclass_brier(
    probabilities: Sequence[Sequence[float]],
    actual: Sequence[int],
    class_order: Sequence[int] = FIXED_THIRTEEN_LABELS,
) -> float:
    """Multiclass Brier score. See ``BRIER_FORMULATION``.

        BS = (1/N) * sum_i sum_k (p_ik - y_ik)^2

    Summed over ALL 13 classes, not only the true one, so a model that spreads mass
    across wrong classes is penalised for that spread. Range [0, 2].
    """
    _require_same_length("probabilities", probabilities, "actual", actual)
    _require_non_empty("actual", actual)
    position = _one_hot_position(class_order)
    total = 0.0
    for row, label in zip(probabilities, actual, strict=True):
        if len(row) != len(class_order):
            raise MetricInputError(
                f"probability row has {len(row)} entries, expected {len(class_order)}"
            )
        true_index = position.get(int(label))
        if true_index is None:
            raise MetricInputError(f"actual class {label} is outside the class order")
        for index, probability in enumerate(row):
            target = 1.0 if index == true_index else 0.0
            difference = float(probability) - target
            total += difference * difference
    return total / len(actual)


def ece_bin_index(confidence: float, bin_count: int = ECE_BIN_COUNT) -> int:
    """Deterministic bin for one confidence value.

    Equal-width bins over [0, 1]. The frozen edge rule is HALF-OPEN LOWER bins,
    ``[lo, hi)``, with the FINAL bin closed on the right, ``[lo, 1]``:

        index = min(floor(confidence * bin_count), bin_count - 1)

    Written as one function so every caller shares one rule. That matters at the
    exact boundaries ``k/15``: a confidence of exactly ``1/15`` belongs to bin 1 and
    not bin 0, and a confidence of exactly ``1.0`` belongs to bin 14 rather than
    falling off the end into a sixteenth bin. Every value in [0, 1] therefore lands
    in exactly one of the 15 bins — never two, never none.
    """
    if not math.isfinite(confidence):
        raise MetricInputError(f"confidence must be finite, got {confidence}")
    if confidence < ECE_RANGE[0] or confidence > ECE_RANGE[1]:
        raise MetricInputError(f"confidence {confidence} falls outside {ECE_RANGE}")
    return min(int(math.floor(confidence * bin_count)), bin_count - 1)


@dataclass(frozen=True)
class CalibrationBin:
    index: int
    lower: float
    upper: float
    count: int
    mean_confidence: float
    accuracy: float

    def to_canonical(self) -> dict[str, float | int]:
        return {
            "index": self.index,
            "lower": self.lower,
            "upper": self.upper,
            "count": self.count,
            "meanConfidence": self.mean_confidence,
            "accuracy": self.accuracy,
        }


@dataclass(frozen=True)
class CalibrationError:
    expected_calibration_error: float
    maximum_calibration_error: float
    bins: tuple[CalibrationBin, ...]
    bin_count: int
    binning: str

    def to_canonical(self) -> dict[str, object]:
        return {
            "expectedCalibrationError": self.expected_calibration_error,
            "maximumCalibrationError": self.maximum_calibration_error,
            "binCount": self.bin_count,
            "binning": self.binning,
            "bins": [entry.to_canonical() for entry in self.bins],
        }


def expected_calibration_error(
    confidences: Sequence[float],
    correct: Sequence[bool],
    bin_count: int = ECE_BIN_COUNT,
) -> CalibrationError:
    """Fixed-bin ECE with 15 equal-width bins over [0, 1].

        ECE = sum_b (n_b / N) * |accuracy_b - mean_confidence_b|

    Equal-width and FIXED. Adaptive or quantile binning chosen after looking at test
    confidences would let the bin edges be tuned to the result, which the
    preregistration explicitly rules out. Empty bins contribute nothing and are
    still reported, so a reader can see that a model's confidence collapsed into two
    bins rather than inferring it from a single summary number.
    """
    _require_same_length("confidences", confidences, "correct", correct)
    _require_non_empty("confidences", confidences)
    total = len(confidences)
    width = (ECE_RANGE[1] - ECE_RANGE[0]) / bin_count

    sums = [0.0] * bin_count
    hits = [0] * bin_count
    counts = [0] * bin_count
    for confidence, is_correct in zip(confidences, correct, strict=True):
        index = ece_bin_index(float(confidence), bin_count)
        counts[index] += 1
        sums[index] += float(confidence)
        if is_correct:
            hits[index] += 1

    bins: list[CalibrationBin] = []
    ece = 0.0
    maximum = 0.0
    for index in range(bin_count):
        count = counts[index]
        mean_confidence = sums[index] / count if count > 0 else 0.0
        accuracy = hits[index] / count if count > 0 else 0.0
        gap = abs(accuracy - mean_confidence) if count > 0 else 0.0
        ece += (count / total) * gap
        maximum = max(maximum, gap)
        bins.append(
            CalibrationBin(
                index=index,
                lower=ECE_RANGE[0] + index * width,
                upper=ECE_RANGE[0] + (index + 1) * width,
                count=count,
                mean_confidence=mean_confidence,
                accuracy=accuracy,
            )
        )

    return CalibrationError(
        expected_calibration_error=ece,
        maximum_calibration_error=maximum,
        bins=tuple(bins),
        bin_count=bin_count,
        binning="equal-width",
    )


# ============================================================================
# SELECTIVE PREDICTION: RISK, COVERAGE, AURC
# ============================================================================


@dataclass(frozen=True)
class RiskCoveragePoint:
    """One achievable operating point.

    ``threshold`` is the confidence value at or above which a row is accepted, so
    the point is reproducible from the data alone.
    """

    threshold: float
    accepted: int
    total: int
    coverage: float
    selective_risk: float

    def to_canonical(self) -> dict[str, float | int]:
        return {
            "threshold": self.threshold,
            "accepted": self.accepted,
            "total": self.total,
            "coverage": self.coverage,
            "selectiveRisk": self.selective_risk,
        }


@dataclass(frozen=True)
class RiskCoverageCurve:
    points: tuple[RiskCoveragePoint, ...]
    aurc: float
    total: int

    def to_canonical(self) -> dict[str, object]:
        return {
            "points": [point.to_canonical() for point in self.points],
            "aurc": self.aurc,
            "total": self.total,
            "aurcConvention": AURC_CONVENTION,
            "acceptanceTieRule": ACCEPTANCE_TIE_RULE,
        }


def risk_coverage_curve(confidences: Sequence[float], correct: Sequence[bool]) -> RiskCoverageCurve:
    """Empirical risk-coverage curve over the achievable operating points.

    Confidence is the calibrated maximum 13-class probability. Selective risk is the
    structured prediction ERROR rate among accepted rows, and coverage is accepted
    over total.

    Ties are the subtle part. Rows sharing a confidence value cannot be separated by
    a threshold, so they enter together and each distinct confidence yields exactly
    one achievable point. With the rows sorted by descending confidence, the point
    for a given distinct value accepts every row with confidence >= that value.
    Coverage 0 is excluded: selective risk is undefined when nothing is accepted,
    and reporting it as 0.0 would read as perfect performance.
    """
    _require_same_length("confidences", confidences, "correct", correct)
    _require_non_empty("confidences", confidences)
    total = len(confidences)
    for confidence in confidences:
        if not math.isfinite(float(confidence)):
            raise MetricInputError(f"confidence must be finite, got {confidence}")

    ordered = sorted(
        zip((float(c) for c in confidences), (bool(c) for c in correct), strict=True),
        key=lambda pair: -pair[0],
    )

    points: list[RiskCoveragePoint] = []
    accepted = 0
    errors = 0
    index = 0
    while index < total:
        threshold = ordered[index][0]
        # Consume the whole tied group before recording a point.
        while index < total and ordered[index][0] == threshold:
            accepted += 1
            if not ordered[index][1]:
                errors += 1
            index += 1
        points.append(
            RiskCoveragePoint(
                threshold=threshold,
                accepted=accepted,
                total=total,
                coverage=accepted / total,
                selective_risk=errors / accepted,
            )
        )

    return RiskCoverageCurve(points=tuple(points), aurc=_aurc(points), total=total)


def _aurc(points: Sequence[RiskCoveragePoint]) -> float:
    """Right-endpoint step integral of risk over coverage. See ``AURC_CONVENTION``."""
    area = 0.0
    previous_coverage = 0.0
    for point in points:
        area += point.selective_risk * (point.coverage - previous_coverage)
        previous_coverage = point.coverage
    return area


@dataclass(frozen=True)
class MatchedCoverageResult:
    target: float
    achieved_coverage: float
    selective_risk: float
    threshold: float
    accepted: int
    exact: bool

    def to_canonical(self) -> dict[str, float | int | bool]:
        return {
            "target": self.target,
            "achievedCoverage": self.achieved_coverage,
            "selectiveRisk": self.selective_risk,
            "threshold": self.threshold,
            "accepted": self.accepted,
            "exact": self.exact,
        }


def risk_at_matched_coverage(
    curve: RiskCoverageCurve, targets: Sequence[float] = MATCHED_COVERAGE_TARGETS
) -> tuple[MatchedCoverageResult, ...]:
    """Selective risk at the nearest ACHIEVABLE coverage to each target.

    No interpolation. ``exact`` records whether the achieved coverage equalled the
    target, so a reader can tell "risk at 25% coverage" from "risk at the 30% we
    could actually reach". Ties resolve to the higher coverage; see
    ``MATCHED_COVERAGE_TIE_BREAK``.
    """
    if not curve.points:
        raise MetricInputError("cannot match coverage on an empty curve")
    results: list[MatchedCoverageResult] = []
    for target in targets:
        best = min(
            curve.points,
            key=lambda point: (abs(point.coverage - target), -point.coverage),
        )
        results.append(
            MatchedCoverageResult(
                target=target,
                achieved_coverage=best.coverage,
                selective_risk=best.selective_risk,
                threshold=best.threshold,
                accepted=best.accepted,
                exact=math.isclose(best.coverage, target, rel_tol=0.0, abs_tol=1e-12),
            )
        )
    return tuple(results)


@dataclass(frozen=True)
class FixedRiskResult:
    target: float
    available: bool
    coverage: float | None
    selective_risk: float | None
    threshold: float | None
    accepted: int | None

    def to_canonical(self) -> dict[str, object]:
        return {
            "target": self.target,
            "available": self.available,
            "coverage": self.coverage,
            "selectiveRisk": self.selective_risk,
            "threshold": self.threshold,
            "accepted": self.accepted,
        }


def coverage_at_fixed_risk(
    curve: RiskCoverageCurve, targets: Sequence[float] = FIXED_RISK_TARGETS
) -> tuple[FixedRiskResult, ...]:
    """Maximum coverage whose empirical selective risk is at or below each target.

    When no achievable operating point meets a target, the result is reported with
    ``available=False`` and null coverage. It is NOT omitted and NOT reported as
    zero coverage, because "we could not reach 5% risk at any coverage" and "we
    reached 5% risk at 0% coverage" are different findings and the frozen rule is to
    say which one happened.
    """
    if not curve.points:
        raise MetricInputError("cannot evaluate fixed risk on an empty curve")
    results: list[FixedRiskResult] = []
    for target in targets:
        qualifying = [point for point in curve.points if point.selective_risk <= target]
        if not qualifying:
            results.append(
                FixedRiskResult(
                    target=target,
                    available=False,
                    coverage=None,
                    selective_risk=None,
                    threshold=None,
                    accepted=None,
                )
            )
            continue
        best = max(qualifying, key=lambda point: point.coverage)
        results.append(
            FixedRiskResult(
                target=target,
                available=True,
                coverage=best.coverage,
                selective_risk=best.selective_risk,
                threshold=best.threshold,
                accepted=best.accepted,
            )
        )
    return tuple(results)


# ============================================================================
# NOVELTY
# ============================================================================


@dataclass(frozen=True)
class NoveltyMetrics:
    """Novelty behaviour of the complete system: frozen support gates plus policy.

    Not a statistical out-of-distribution detector. These rates describe what the
    deterministic support gates and the frozen confidence threshold did on a
    labelled novelty set; they are not evidence of robust OOD detection, and the
    threshold was never tuned on novelty data.
    """

    novelty_total: int
    novelty_abstained: int
    novelty_abstention_recall: float
    novelty_false_acceptance_rate: float
    supported_total: int
    supported_abstained: int
    supported_false_abstention_rate: float
    novelty_population: str = ""
    supported_reference_partitions: tuple[str, ...] = ()

    def to_canonical(self) -> dict[str, object]:
        return {
            "noveltyTotal": self.novelty_total,
            "noveltyAbstained": self.novelty_abstained,
            "noveltyAbstentionRecall": self.novelty_abstention_recall,
            "noveltyFalseAcceptanceRate": self.novelty_false_acceptance_rate,
            "supportedTotal": self.supported_total,
            "supportedAbstained": self.supported_abstained,
            "supportedFalseAbstentionRate": self.supported_false_abstention_rate,
            "noveltyPopulation": self.novelty_population,
            "supportedReferencePartitions": list(self.supported_reference_partitions),
        }


def novelty_metrics(is_novel: Sequence[bool], abstained: Sequence[bool]) -> NoveltyMetrics:
    """Abstention recall, false acceptance, and false abstention.

        novelty abstention recall    = abstained among novel / novel
        novelty false acceptance     = accepted among novel / novel
                                     = 1 - novelty abstention recall
        supported false abstention   = abstained among supported / supported

    The first two are complements by construction, and both are reported because
    they are the two directions a reader asks about. An empty novel or supported
    group yields 0.0 under the frozen zero-division rule rather than a NaN that
    would propagate into a bootstrap interval.
    """
    _require_same_length("is_novel", is_novel, "abstained", abstained)
    novelty_total = sum(1 for novel in is_novel if novel)
    supported_total = len(is_novel) - novelty_total
    novelty_abstained = sum(
        1 for novel, abstain in zip(is_novel, abstained, strict=True) if novel and abstain
    )
    supported_abstained = sum(
        1 for novel, abstain in zip(is_novel, abstained, strict=True) if not novel and abstain
    )
    recall = novelty_abstained / novelty_total if novelty_total > 0 else ZERO_DIVISION
    return NoveltyMetrics(
        novelty_total=novelty_total,
        novelty_abstained=novelty_abstained,
        novelty_abstention_recall=recall,
        novelty_false_acceptance_rate=(1.0 - recall) if novelty_total > 0 else ZERO_DIVISION,
        supported_total=supported_total,
        supported_abstained=supported_abstained,
        supported_false_abstention_rate=(
            supported_abstained / supported_total if supported_total > 0 else ZERO_DIVISION
        ),
    )


# ============================================================================
# PAIRED DELTAS
# ============================================================================


@dataclass(frozen=True)
class PairedDelta:
    """A signed difference with both operands and the direction named explicitly.

    The label carries the subtraction order so no reader has to guess which way
    "improvement" points. A positive ``delta`` always means ``minuend`` scored
    higher, which for an error-like metric means it did WORSE; ``higher_is_better``
    records which reading applies.
    """

    metric: str
    minuend_label: str
    subtrahend_label: str
    minuend: float
    subtrahend: float
    delta: float
    higher_is_better: bool

    def to_canonical(self) -> dict[str, object]:
        return {
            "metric": self.metric,
            "direction": f"{self.minuend_label} minus {self.subtrahend_label}",
            "minuendLabel": self.minuend_label,
            "subtrahendLabel": self.subtrahend_label,
            "minuend": self.minuend,
            "subtrahend": self.subtrahend,
            "delta": self.delta,
            "higherIsBetter": self.higher_is_better,
        }


def paired_delta(
    metric: str,
    *,
    minuend_label: str,
    subtrahend_label: str,
    minuend: float,
    subtrahend: float,
    higher_is_better: bool,
) -> PairedDelta:
    """Build a signed delta. Both labels are mandatory so the sign is never ambiguous."""
    return PairedDelta(
        metric=metric,
        minuend_label=minuend_label,
        subtrahend_label=subtrahend_label,
        minuend=float(minuend),
        subtrahend=float(subtrahend),
        delta=float(minuend) - float(subtrahend),
        higher_is_better=higher_is_better,
    )


def metric_definitions_canonical() -> dict[str, object]:
    """The exact arithmetic this module implements, for embedding in a result artifact.

    Recorded so a result can be read years later without re-deriving which
    convention produced it.
    """
    return {
        "metricDefinitionsVersion": METRIC_DEFINITIONS_VERSION,
        "structuredExactMatch": "exact 13-tuple class match; no partial credit",
        "fixedThirteenLabels": list(FIXED_THIRTEEN_LABELS),
        "zeroDivision": ZERO_DIVISION,
        "absentClassesDropped": False,
        "brierFormulation": BRIER_FORMULATION,
        "nllFormulation": "mean over rows of -log p[true class]; floor 1e-300",
        "eceBinCount": ECE_BIN_COUNT,
        "eceBinning": "equal-width",
        "eceRange": list(ECE_RANGE),
        "eceEdgeRule": "half-open [lo, hi) bins with the final bin closed at 1.0",
        "aurcConvention": AURC_CONVENTION,
        "acceptanceTieRule": ACCEPTANCE_TIE_RULE,
        "matchedCoverageTargets": list(MATCHED_COVERAGE_TARGETS),
        "matchedCoverageRule": "nearest achievable empirical coverage without interpolation",
        "matchedCoverageTieBreak": MATCHED_COVERAGE_TIE_BREAK,
        "fixedRiskTargets": list(FIXED_RISK_TARGETS),
        "fixedRiskReporting": (
            "maximum coverage at or below each risk target; unachievable targets are "
            "reported as unavailable, never omitted and never as zero coverage"
        ),
        "noveltyNote": (
            "novelty rates describe frozen deterministic support gates plus the frozen "
            "confidence threshold; they are not a statistical out-of-distribution detector"
        ),
    }

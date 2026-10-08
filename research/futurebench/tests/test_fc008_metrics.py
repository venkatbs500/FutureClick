"""Hand-checked tests for the FC-008 Sprint-4A metric definitions.

Every expected value below was worked out with pen and paper from the formula stated
in the ``metrics`` module docstrings, and the arithmetic is written out in a comment
beside the assertion. A number copied from a run of the code under test would only
prove the code agrees with itself; the frozen preregistration fixes the conventions,
and the question these tests answer is whether the evaluator implements THOSE.

NO SEALED DATA. Every fixture here is a handful of literal numbers written inline.
The real ``test-id``, ``test-ooa``, and ``test-novelty`` partitions are never named,
loaded, opened, or simulated anywhere in this module.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Sequence

import pytest

from futurebench.fc008.metrics import (
    ACCEPTANCE_TIE_RULE,
    ECE_BIN_COUNT,
    ECE_RANGE,
    FIXED_RISK_TARGETS,
    FIXED_THIRTEEN_LABELS,
    MATCHED_COVERAGE_TARGETS,
    ZERO_DIVISION,
    MetricInputError,
    RiskCoverageCurve,
    confusion_matrix,
    coverage_at_fixed_risk,
    ece_bin_index,
    expected_calibration_error,
    macro_f1_fixed_thirteen,
    macro_f1_observed_classes,
    metric_definitions_canonical,
    multiclass_brier,
    negative_log_likelihood,
    novelty_metrics,
    paired_delta,
    per_class_metrics,
    risk_at_matched_coverage,
    risk_coverage_curve,
    structured_exact_match,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT_DIR = REPOSITORY_ROOT / "research" / "futurebench" / "artifacts"
PREREGISTRATION_PATH = ARTIFACT_DIR / "fc008-preregistration.json"

#: Tolerance for every float comparison in this module. Explicit rather than relying
#: on ``pytest.approx`` defaults, because a relative default would quietly accept a
#: value that is wrong in the sixth decimal place of a probability.
TOLERANCE = 1e-12


@pytest.fixture(scope="module")
def preregistered_metrics() -> dict[str, object]:
    """The frozen preregistration's ``metricDefinitions`` block, read READ-ONLY.

    An independent document from ``metrics.py``, which is the whole point: comparing
    the evaluator's constants against themselves would pass for a drifted evaluator.
    """
    document = json.loads(PREREGISTRATION_PATH.read_text(encoding="utf-8"))
    assert document["finalTestResultsPresent"] is False
    definitions = document["metricDefinitions"]
    assert isinstance(definitions, dict)
    return definitions


def one_hot(label: int) -> tuple[float, ...]:
    """A degenerate 13-class distribution: all mass on ``label``."""
    return tuple(1.0 if value == label else 0.0 for value in FIXED_THIRTEEN_LABELS)


def peaked(label: int, peak: float) -> tuple[float, ...]:
    """A 13-class distribution with ``peak`` on ``label``, remainder spread evenly."""
    remainder = (1.0 - peak) / (len(FIXED_THIRTEEN_LABELS) - 1)
    return tuple(peak if value == label else remainder for value in FIXED_THIRTEEN_LABELS)


class TestStructuredExactMatch:
    """Exact 13-tuple match, no partial credit."""

    def test_perfect_predictions_score_one(self) -> None:
        # 5 of 5 correct: 5 / 5 = 1.0
        predicted = [1, 2, 3, 4, 5]
        assert structured_exact_match(predicted, predicted) == pytest.approx(1.0, abs=TOLERANCE)

    def test_all_wrong_predictions_score_zero(self) -> None:
        # 0 of 5 correct: 0 / 5 = 0.0
        assert structured_exact_match([2, 3, 4, 5, 6], [1, 2, 3, 4, 5]) == pytest.approx(
            0.0, abs=TOLERANCE
        )

    def test_three_of_five_correct_scores_zero_point_six(self) -> None:
        # predicted 1,2,3,9,9 against actual 1,2,3,4,5
        # positions 0,1,2 match and positions 3,4 do not: 3 / 5 = 0.6
        assert structured_exact_match([1, 2, 3, 9, 9], [1, 2, 3, 4, 5]) == pytest.approx(
            0.6, abs=TOLERANCE
        )

    def test_there_is_no_partial_credit_for_a_near_miss(self) -> None:
        # A class number IS a (verb, objectKind, transitionProperty) tuple, so "close"
        # has no meaning here: class 2 against class 1 scores exactly the same as 13.
        assert structured_exact_match([2], [1]) == pytest.approx(0.0, abs=TOLERANCE)
        assert structured_exact_match([13], [1]) == pytest.approx(0.0, abs=TOLERANCE)


class TestFixedThirteenMacroF1:
    """THE KEY TEST: absent classes are retained in the macro average at zero.

    The frozen rule is a thirteen-way average with ``zeroDivision: 0``. Dropping the
    absent classes changes the denominator and roughly doubles the score, which is the
    exact substitution the preregistration forbids.
    """

    #: Only classes 1 and 2 occur, and both are predicted perfectly.
    PREDICTED = [1, 1, 2, 2]
    ACTUAL = [1, 1, 2, 2]

    def test_two_perfect_classes_out_of_thirteen_score_two_thirteenths(self) -> None:
        # Class 1: TP=2, predictedCount=2, support=2 -> P=2/2=1, R=2/2=1, F1=2*1*1/2=1.0
        # Class 2: TP=2, predictedCount=2, support=2 -> P=1, R=1, F1=1.0
        # Classes 3..13 (eleven of them): predictedCount=0 and support=0, so precision
        #   and recall are both the frozen zeroDivision 0.0, the denominator P+R is 0,
        #   and F1 is therefore 0.0 as well.
        # macro F1 = (1.0 + 1.0 + eleven zeros) / 13 = 2 / 13 = 0.15384615384615385
        assert macro_f1_fixed_thirteen(self.PREDICTED, self.ACTUAL) == pytest.approx(
            2.0 / 13.0, abs=TOLERANCE
        )

    def test_the_absent_classes_really_are_the_eleven_zeros(self) -> None:
        # The 2/13 above must come from eleven zero-F1 slots rather than from some
        # other arithmetic that happens to land on the same number.
        per_class = per_class_metrics(self.PREDICTED, self.ACTUAL, FIXED_THIRTEEN_LABELS)
        assert len(per_class) == 13
        scored = {entry.label: entry.f1 for entry in per_class}
        assert scored[1] == pytest.approx(1.0, abs=TOLERANCE)
        assert scored[2] == pytest.approx(1.0, abs=TOLERANCE)
        absent = [label for label in FIXED_THIRTEEN_LABELS if label not in (1, 2)]
        assert len(absent) == 11
        for label in absent:
            assert scored[label] == pytest.approx(0.0, abs=TOLERANCE)

    def test_the_observed_class_variant_scores_one_on_the_same_fixture(self) -> None:
        # Universe = {1, 2}, both perfect: (1.0 + 1.0) / 2 = 1.0
        assert macro_f1_observed_classes(self.PREDICTED, self.ACTUAL) == pytest.approx(
            1.0, abs=TOLERANCE
        )

    def test_the_two_variants_differ_and_must_never_be_substituted(self) -> None:
        # 1.0 versus 2/13 is a factor of 6.5 on identical inputs. The observed-class
        # number is SECONDARY CONTEXT only: reporting it where the fixed-13 metric is
        # called for would silently inflate the headline result, which is precisely
        # what the preregistration's absentClassesDropped: false rules out.
        fixed = macro_f1_fixed_thirteen(self.PREDICTED, self.ACTUAL)
        observed = macro_f1_observed_classes(self.PREDICTED, self.ACTUAL)
        assert fixed != pytest.approx(observed, abs=1e-6)
        assert observed > fixed

    def test_a_fully_observed_perfect_fixture_makes_the_two_agree(self) -> None:
        # The divergence above is caused by absence, not by a difference in the F1
        # formula: when all thirteen classes occur, the two universes coincide.
        labels = list(FIXED_THIRTEEN_LABELS)
        assert macro_f1_fixed_thirteen(labels, labels) == pytest.approx(1.0, abs=TOLERANCE)
        assert macro_f1_observed_classes(labels, labels) == pytest.approx(1.0, abs=TOLERANCE)


class TestPerClassMetricsAndConfusion:
    def test_precision_and_recall_are_computed_per_class(self) -> None:
        # actual   = 1, 1, 2
        # predicted= 1, 2, 2
        # class 1: TP=1, predictedCount=1, support=2 -> P=1/1=1.0, R=1/2=0.5
        #          F1 = 2*1.0*0.5 / 1.5 = 1/1.5 = 0.6666666666666666
        # class 2: TP=1, predictedCount=2, support=1 -> P=1/2=0.5, R=1/1=1.0
        #          F1 = 2*0.5*1.0 / 1.5 = 0.6666666666666666
        per_class = {
            entry.label: entry
            for entry in per_class_metrics([1, 2, 2], [1, 1, 2], FIXED_THIRTEEN_LABELS)
        }
        assert per_class[1].precision == pytest.approx(1.0, abs=TOLERANCE)
        assert per_class[1].recall == pytest.approx(0.5, abs=TOLERANCE)
        assert per_class[1].f1 == pytest.approx(2.0 / 3.0, abs=TOLERANCE)
        assert per_class[2].precision == pytest.approx(0.5, abs=TOLERANCE)
        assert per_class[2].recall == pytest.approx(1.0, abs=TOLERANCE)
        assert per_class[2].f1 == pytest.approx(2.0 / 3.0, abs=TOLERANCE)

    def test_the_label_universe_is_a_parameter_and_never_inferred(self) -> None:
        # Passing the universe explicitly is what stops the fixed-13 metric from
        # silently becoming the observed-class metric.
        assert len(per_class_metrics([1], [1], FIXED_THIRTEEN_LABELS)) == 13
        assert len(per_class_metrics([1], [1], [1])) == 1

    def test_the_confusion_matrix_is_indexed_actual_then_predicted(self) -> None:
        counts = confusion_matrix([2], [1])
        # One row whose actual class is 1 and predicted class is 2, so the single
        # count sits at [actual=1][predicted=2] == row 0, column 1.
        assert counts[0][1] == 1
        assert counts[1][0] == 0
        assert sum(sum(row) for row in counts) == 1

    def test_a_label_outside_the_declared_universe_is_refused(self) -> None:
        with pytest.raises(MetricInputError, match="outside the declared universe"):
            confusion_matrix([14], [1])


class TestNegativeLogLikelihood:
    def test_true_class_probability_of_one_half_gives_log_two(self) -> None:
        # Two rows, each with exactly 0.5 on its own true class.
        # NLL = -(1/2) * (ln 0.5 + ln 0.5) = -ln 0.5 = ln 2 = 0.6931471805599453
        probabilities = [peaked(1, 0.5), peaked(2, 0.5)]
        assert probabilities[0][0] == pytest.approx(0.5, abs=TOLERANCE)
        assert probabilities[1][1] == pytest.approx(0.5, abs=TOLERANCE)
        assert negative_log_likelihood(probabilities, [1, 2]) == pytest.approx(
            math.log(2.0), abs=TOLERANCE
        )

    def test_only_the_true_class_probability_enters_the_sum(self) -> None:
        # Both rows put 0.5 on the true class but spread the remaining mass very
        # differently. NLL is blind to that: still ln 2.
        spread = peaked(1, 0.5)
        lumped = tuple(0.5 if index == 0 else (0.5 if index == 1 else 0.0) for index in range(13))
        assert negative_log_likelihood([spread, lumped], [1, 1]) == pytest.approx(
            math.log(2.0), abs=TOLERANCE
        )

    def test_a_perfect_one_hot_prediction_gives_zero(self) -> None:
        # -ln 1.0 = 0.0
        assert negative_log_likelihood([one_hot(7)], [7]) == pytest.approx(0.0, abs=TOLERANCE)

    def test_a_zero_true_class_probability_is_floored_rather_than_infinite(self) -> None:
        # The floor keeps an already-catastrophic prediction finite so a bootstrap
        # interval cannot be poisoned by an infinity.
        value = negative_log_likelihood([one_hot(7)], [1])
        assert math.isfinite(value)
        assert value == pytest.approx(-math.log(1e-300), abs=1e-9)

    def test_a_class_outside_the_class_order_is_refused(self) -> None:
        with pytest.raises(MetricInputError, match="outside the class order"):
            negative_log_likelihood([one_hot(1)], [99])

    def test_a_wrong_width_probability_row_is_refused(self) -> None:
        with pytest.raises(MetricInputError, match="expected 13"):
            negative_log_likelihood([(0.5, 0.5)], [1])


class TestMulticlassBrier:
    """Brier's original multiclass form. Range [0, 2], no factor of one half."""

    def test_a_correct_one_hot_prediction_scores_zero(self) -> None:
        # Every (p_ik - y_ik) is exactly 0, so the sum of squares is 0 and BS = 0.
        assert multiclass_brier([one_hot(4)], [4]) == pytest.approx(0.0, abs=TOLERANCE)

    def test_a_wrong_one_hot_prediction_scores_exactly_two(self) -> None:
        # One row, all mass on class 5, true class 7.
        #   at the predicted class 5: (1 - 0)^2 = 1
        #   at the true class 7:      (0 - 1)^2 = 1
        #   at the other eleven:      (0 - 0)^2 = 0
        # sum = 2, over one row: BS = 2 / 1 = 2.0
        # THE RANGE IS [0, 2], NOT [0, 1]: there is no factor of one half here, so a
        # reader comparing these numbers against a halved convention must divide by 2.
        assert multiclass_brier([one_hot(5)], [7]) == pytest.approx(2.0, abs=TOLERANCE)

    def test_two_is_the_attainable_maximum(self) -> None:
        # Worst case over every one-hot/true-class pairing is exactly the 2.0 above.
        worst = max(
            multiclass_brier([one_hot(predicted)], [truth])
            for predicted in FIXED_THIRTEEN_LABELS
            for truth in FIXED_THIRTEEN_LABELS
        )
        assert worst == pytest.approx(2.0, abs=TOLERANCE)

    def test_spread_mass_is_penalised_across_all_thirteen_classes(self) -> None:
        # Uniform over 13 classes, true class 1:
        #   at the true class:  (1/13 - 1)^2 = (12/13)^2 = 144/169
        #   at the other 12:    12 * (1/13)^2 = 12/169
        # sum = 156/169 = 12/13 = 0.9230769230769231
        uniform = tuple(1.0 / 13.0 for _ in FIXED_THIRTEEN_LABELS)
        assert multiclass_brier([uniform], [1]) == pytest.approx(12.0 / 13.0, abs=TOLERANCE)

    def test_the_documented_formulation_names_the_range_and_the_missing_half(self) -> None:
        definitions = metric_definitions_canonical()
        assert "[0, 2]" in str(definitions["brierFormulation"])
        assert "no factor of one half" in str(definitions["brierFormulation"])


class TestExpectedCalibrationError:
    """Fifteen equal-width bins over [0, 1], fixed in advance."""

    CONFIDENCES = [0.1, 0.1, 0.9, 0.9]
    CORRECT = [True, False, True, True]

    def test_the_weighted_gap_is_hand_computable(self) -> None:
        # Four rows, confidences 0.1, 0.1, 0.9, 0.9, correctness T, F, T, T.
        # bin index of 0.1 = min(floor(0.1 * 15), 14) = min(floor(1.5), 14) = 1
        # bin index of 0.9 = min(floor(0.9 * 15), 14) = min(floor(13.5), 14) = 13
        # bin 1:  count 2, meanConfidence 0.1, accuracy 1/2 = 0.5, gap |0.5 - 0.1| = 0.4
        # bin 13: count 2, meanConfidence 0.9, accuracy 2/2 = 1.0, gap |1.0 - 0.9| = 0.1
        # every other bin: count 0, contributes nothing
        # ECE = (2/4) * 0.4 + (2/4) * 0.1 = 0.2 + 0.05 = 0.25
        # MCE = max(0.4, 0.1) = 0.4
        result = expected_calibration_error(self.CONFIDENCES, self.CORRECT)
        assert result.expected_calibration_error == pytest.approx(0.25, abs=1e-12)
        assert result.maximum_calibration_error == pytest.approx(0.4, abs=1e-12)

    def test_the_populated_bins_are_exactly_one_and_thirteen(self) -> None:
        result = expected_calibration_error(self.CONFIDENCES, self.CORRECT)
        populated = {entry.index: entry.count for entry in result.bins if entry.count > 0}
        assert populated == {1: 2, 13: 2}

    def test_empty_bins_are_reported_rather_than_dropped(self) -> None:
        # A reader must be able to see that confidence collapsed into two bins instead
        # of having to infer it from a single summary number.
        result = expected_calibration_error(self.CONFIDENCES, self.CORRECT)
        assert len(result.bins) == ECE_BIN_COUNT
        assert len([entry for entry in result.bins if entry.count == 0]) == 13

    def test_there_are_exactly_fifteen_equal_width_bins(self) -> None:
        result = expected_calibration_error([0.5], [True])
        assert ECE_BIN_COUNT == 15
        assert result.bin_count == 15
        assert result.binning == "equal-width"
        assert len(result.bins) == 15
        width = 1.0 / 15.0
        for index, entry in enumerate(result.bins):
            assert entry.index == index
            assert entry.upper - entry.lower == pytest.approx(width, abs=1e-12)
        # Contiguous and spanning exactly [0, 1]: no gap and no overlap.
        assert result.bins[0].lower == pytest.approx(ECE_RANGE[0], abs=1e-12)
        assert result.bins[-1].upper == pytest.approx(ECE_RANGE[1], abs=1e-12)
        for lower, upper in zip(result.bins[:-1], result.bins[1:], strict=True):
            assert lower.upper == pytest.approx(upper.lower, abs=1e-12)

    def test_a_perfectly_calibrated_fixture_scores_zero(self) -> None:
        # Four rows at confidence 0.5, two correct: accuracy 0.5 == meanConfidence 0.5.
        result = expected_calibration_error([0.5, 0.5, 0.5, 0.5], [True, True, False, False])
        assert result.expected_calibration_error == pytest.approx(0.0, abs=TOLERANCE)


class TestEceBinBoundaries:
    """The edge rule at every exact boundary ``k/15``.

    Half-open lower bins ``[lo, hi)`` with the final bin closed at 1.0. These are the
    values where an off-by-one would be invisible on ordinary data and would quietly
    move a reported ECE.
    """

    @pytest.mark.parametrize("k", list(range(16)))
    def test_every_exact_boundary_lands_in_the_frozen_bin(self, k: int) -> None:
        # k/15 belongs to bin k for k = 0..14, and 15/15 == 1.0 belongs to bin 14
        # rather than falling off the end into a sixteenth bin.
        expected = 14 if k == 15 else k
        assert ece_bin_index(k / ECE_BIN_COUNT) == expected

    def test_zero_is_in_the_first_bin(self) -> None:
        assert ece_bin_index(0.0) == 0

    def test_one_fifteenth_is_in_bin_one_and_not_bin_zero(self) -> None:
        # The lower edge is INCLUSIVE, so the boundary value moves up a bin.
        assert ece_bin_index(1.0 / 15.0) == 1

    def test_one_point_zero_is_in_the_last_bin_and_not_a_sixteenth(self) -> None:
        assert ece_bin_index(1.0) == ECE_BIN_COUNT - 1 == 14

    def test_a_dense_sweep_puts_every_value_in_exactly_one_bin(self) -> None:
        # The property is "never two, never none". Counting into the bins and then
        # checking the total against the input count detects both failures: a value
        # in two bins would overcount, a value in none would undercount or raise.
        sweep = [index / 1500.0 for index in range(1501)]
        assert sweep[0] == 0.0
        assert sweep[-1] == 1.0
        counts = [0] * ECE_BIN_COUNT
        for confidence in sweep:
            index = ece_bin_index(confidence)
            assert 0 <= index < ECE_BIN_COUNT
            counts[index] += 1
        assert sum(counts) == len(sweep)
        # NO BIN IS SKIPPED: a dense sweep must reach all fifteen.
        assert all(count > 0 for count in counts)

    def test_the_sweep_is_also_fully_accounted_for_by_the_ece_binner(self) -> None:
        # Same property through the public entry point, so the shared rule is proven
        # to be the one expected_calibration_error actually uses.
        sweep = [index / 1500.0 for index in range(1501)]
        result = expected_calibration_error(sweep, [True] * len(sweep))
        assert sum(entry.count for entry in result.bins) == len(sweep)
        assert all(entry.count > 0 for entry in result.bins)

    @pytest.mark.parametrize("confidence", [-1e-9, -0.1, 1.0 + 1e-9, 1.1, 2.0])
    def test_a_confidence_outside_the_unit_interval_is_refused(self, confidence: float) -> None:
        with pytest.raises(MetricInputError, match="falls outside"):
            ece_bin_index(confidence)

    @pytest.mark.parametrize("confidence", [float("nan"), float("inf"), float("-inf")])
    def test_a_non_finite_confidence_is_refused(self, confidence: float) -> None:
        # Checked before the range comparison, because NaN compares false against both
        # bounds and would otherwise slip through into floor().
        with pytest.raises(MetricInputError, match="must be finite"):
            ece_bin_index(confidence)


class TestRiskCoverageCurve:
    CONFIDENCES = [0.9, 0.8, 0.7, 0.6]
    CORRECT = [True, False, True, False]

    def test_every_point_and_the_aurc_are_hand_computable(self) -> None:
        # Four rows with distinct confidences, sorted descending:
        #   (0.9, correct), (0.8, wrong), (0.7, correct), (0.6, wrong)
        # point 1: threshold 0.9, accepted 1, errors 0, coverage 1/4 = 0.25, risk 0/1 = 0
        # point 2: threshold 0.8, accepted 2, errors 1, coverage 2/4 = 0.50, risk 1/2 = 0.5
        # point 3: threshold 0.7, accepted 3, errors 1, coverage 3/4 = 0.75, risk 1/3
        # point 4: threshold 0.6, accepted 4, errors 2, coverage 4/4 = 1.00, risk 2/4 = 0.5
        #
        # AURC is the right-endpoint step integral with coverage_0 = 0:
        #   0.0   * (0.25 - 0.00) = 0
        #   0.5   * (0.50 - 0.25) = 0.125
        #   1/3   * (0.75 - 0.50) = 1/12 = 0.08333333333333333
        #   0.5   * (1.00 - 0.75) = 0.125
        #   total = 0.125 + 1/12 + 0.125 = 3/12 + 1/12 = 4/12 = 1/3 = 0.3333333333333333
        curve = risk_coverage_curve(self.CONFIDENCES, self.CORRECT)
        assert [point.threshold for point in curve.points] == [0.9, 0.8, 0.7, 0.6]
        assert [point.accepted for point in curve.points] == [1, 2, 3, 4]
        expected_coverage = [0.25, 0.5, 0.75, 1.0]
        expected_risk = [0.0, 0.5, 1.0 / 3.0, 0.5]
        for point, coverage, risk in zip(
            curve.points, expected_coverage, expected_risk, strict=True
        ):
            assert point.coverage == pytest.approx(coverage, abs=TOLERANCE)
            assert point.selective_risk == pytest.approx(risk, abs=TOLERANCE)
        assert curve.aurc == pytest.approx(1.0 / 3.0, abs=1e-12)

    def test_the_coverage_increments_sum_to_exactly_one(self) -> None:
        # The property that makes AURC a coverage-weighted mean of achievable risks.
        curve = risk_coverage_curve(self.CONFIDENCES, self.CORRECT)
        previous = 0.0
        total = 0.0
        for point in curve.points:
            total += point.coverage - previous
            previous = point.coverage
        assert total == pytest.approx(1.0, abs=TOLERANCE)

    def test_full_coverage_is_always_the_last_achievable_point(self) -> None:
        curve = risk_coverage_curve(self.CONFIDENCES, self.CORRECT)
        assert curve.points[-1].coverage == pytest.approx(1.0, abs=TOLERANCE)
        assert curve.points[-1].accepted == curve.total

    def test_coverage_zero_is_never_an_operating_point(self) -> None:
        # Selective risk is undefined when nothing is accepted, and reporting it as
        # 0.0 would read as perfect performance.
        for confidences, correct in (
            (self.CONFIDENCES, self.CORRECT),
            ([0.5, 0.5, 0.5], [True, False, True]),
            ([0.1], [False]),
        ):
            curve = risk_coverage_curve(confidences, correct)
            assert all(point.coverage > 0.0 for point in curve.points)
            assert all(point.accepted >= 1 for point in curve.points)

    def test_a_non_finite_confidence_is_refused(self) -> None:
        with pytest.raises(MetricInputError, match="must be finite"):
            risk_coverage_curve([0.5, float("nan")], [True, False])

    def test_the_canonical_form_records_the_two_fixed_conventions(self) -> None:
        canonical = risk_coverage_curve(self.CONFIDENCES, self.CORRECT).to_canonical()
        assert "no interpolation" in str(canonical["aurcConvention"])
        assert canonical["acceptanceTieRule"] == ACCEPTANCE_TIE_RULE


class TestAcceptanceTies:
    """Rows sharing a confidence value are accepted or rejected TOGETHER."""

    def test_a_tied_group_is_never_split_by_an_achievable_coverage(self) -> None:
        # Three rows tied at 0.8 and one at 0.5. A threshold cannot separate the tied
        # three, so coverages 1/4 and 2/4 are NOT achievable: the only achievable
        # points are 3/4 (the whole tied group) and 4/4.
        curve = risk_coverage_curve([0.8, 0.8, 0.8, 0.5], [True, False, True, True])
        coverages = [point.coverage for point in curve.points]
        assert coverages == pytest.approx([0.75, 1.0], abs=TOLERANCE)
        assert 0.25 not in coverages
        assert 0.5 not in coverages
        assert [point.accepted for point in curve.points] == [3, 4]

    def test_the_number_of_points_equals_the_number_of_distinct_confidences(self) -> None:
        confidences = [0.9, 0.9, 0.7, 0.7, 0.7, 0.4]
        correct = [True, False, True, True, False, True]
        curve = risk_coverage_curve(confidences, correct)
        assert len(curve.points) == len(set(confidences)) == 3

    def test_a_single_tied_value_yields_exactly_one_full_coverage_point(self) -> None:
        # Everything tied means the only achievable operating point is full coverage,
        # which is the honest report: this system offers no selective behaviour at all.
        curve = risk_coverage_curve([0.6] * 5, [True, True, False, True, True])
        assert len(curve.points) == 1
        assert curve.points[0].coverage == pytest.approx(1.0, abs=TOLERANCE)
        # AURC collapses to the full-coverage error rate: 1/5 * (1.0 - 0.0) = 0.2
        assert curve.aurc == pytest.approx(0.2, abs=TOLERANCE)

    def test_input_order_does_not_change_the_curve(self) -> None:
        forward = risk_coverage_curve([0.8, 0.8, 0.5], [True, False, True])
        shuffled = risk_coverage_curve([0.5, 0.8, 0.8], [True, False, True])
        assert [point.to_canonical() for point in forward.points] == [
            point.to_canonical() for point in shuffled.points
        ]


class TestMatchedCoverage:
    def test_an_unattainable_target_resolves_to_the_nearest_achievable_coverage(self) -> None:
        # Three rows with distinct confidences, so the achievable coverages are
        # exactly 1/3, 2/3, and 1. The target 0.25 is not among them.
        #   |1/3 - 0.25| = 0.0833333...
        #   |2/3 - 0.25| = 0.4166666...
        #   |1   - 0.25| = 0.75
        # nearest is 1/3, and exact must be False because 1/3 != 0.25.
        curve = risk_coverage_curve([0.9, 0.8, 0.7], [True, True, False])
        quarter = risk_at_matched_coverage(curve, [0.25])[0]
        assert quarter.achieved_coverage == pytest.approx(1.0 / 3.0, abs=TOLERANCE)
        assert quarter.exact is False
        assert quarter.target == pytest.approx(0.25, abs=TOLERANCE)

    def test_the_half_target_resolves_to_the_higher_of_two_equidistant_coverages(self) -> None:
        # |1/3 - 0.5| = 1/6 and |2/3 - 0.5| = 1/6 are equal in exact arithmetic, so the
        # documented tie-break applies: smaller absolute difference first, then HIGHER
        # achieved coverage. 2/3 must win, which is the LESS flattering operating point
        # because it abstains less.
        curve = risk_coverage_curve([0.9, 0.8, 0.7], [True, True, False])
        half = risk_at_matched_coverage(curve, [0.50])[0]
        assert half.achieved_coverage == pytest.approx(2.0 / 3.0, abs=TOLERANCE)
        assert half.exact is False

    def test_an_exact_binary_tie_resolves_to_the_higher_coverage(self) -> None:
        # THE TEST THAT PINS THE TIE-BREAK. In the three-row fixture above the two
        # distances are equal on paper but differ by one ulp once 1/3 and 2/3 are
        # rounded to float64, so that case does not actually exercise the tie-break.
        # Eight rows with a tied pair make the distances exactly equal in binary:
        #   confidences 0.9, 0.8, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3
        #   achievable coverages: 1/8, 3/8, 4/8, 5/8, 6/8, 7/8, 8/8
        #   0.25 is NOT achievable, and |0.125 - 0.25| = |0.375 - 0.25| = 0.125 exactly,
        #   since 0.125, 0.25, and 0.375 are all exact float64 values.
        # The tie-break therefore decides, and it must choose 0.375.
        curve = risk_coverage_curve(
            [0.9, 0.8, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3],
            [True, True, False, True, True, False, True, True],
        )
        coverages = [point.coverage for point in curve.points]
        assert coverages == pytest.approx([0.125, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0])
        assert 0.25 not in coverages
        assert abs(0.125 - 0.25) == abs(0.375 - 0.25)
        matched = risk_at_matched_coverage(curve, [0.25])[0]
        assert matched.achieved_coverage == pytest.approx(0.375, abs=TOLERANCE)
        assert matched.exact is False

    def test_an_attainable_target_is_marked_exact(self) -> None:
        curve = risk_coverage_curve([0.9, 0.8, 0.7, 0.6], [True, True, True, False])
        results = {entry.target: entry for entry in risk_at_matched_coverage(curve)}
        assert results[0.25].achieved_coverage == pytest.approx(0.25, abs=TOLERANCE)
        assert results[0.25].exact is True
        assert results[1.00].achieved_coverage == pytest.approx(1.0, abs=TOLERANCE)
        assert results[1.00].exact is True

    def test_all_four_frozen_targets_are_reported(self) -> None:
        curve = risk_coverage_curve([0.9, 0.8, 0.7], [True, True, False])
        results = risk_at_matched_coverage(curve)
        assert tuple(entry.target for entry in results) == MATCHED_COVERAGE_TARGETS

    def test_an_empty_curve_is_refused(self) -> None:
        # Not reachable through risk_coverage_curve, which refuses empty input; built
        # directly so the guard itself is exercised rather than assumed.
        empty = RiskCoverageCurve(points=(), aurc=0.0, total=0)
        with pytest.raises(MetricInputError, match="empty curve"):
            risk_at_matched_coverage(empty)


class TestCoverageAtFixedRisk:
    def test_an_unreachable_target_is_reported_as_unavailable_not_omitted(self) -> None:
        # Every prediction is wrong, so selective risk is 1.0 at every operating point
        # and none of 0.05, 0.10, 0.20 can be met.
        curve = risk_coverage_curve([0.9, 0.8, 0.7, 0.6], [False, False, False, False])
        assert all(point.selective_risk > 0.2 for point in curve.points)
        results = coverage_at_fixed_risk(curve)
        # PRESENT, in the frozen order, with available False and null coverage: "we
        # could not reach 5% risk at any coverage" is a different finding from "we
        # reached 5% risk at 0% coverage", and the frozen rule is to say which.
        assert tuple(entry.target for entry in results) == FIXED_RISK_TARGETS
        assert len(results) == 3
        for entry in results:
            assert entry.available is False
            assert entry.coverage is None
            assert entry.selective_risk is None
            assert entry.threshold is None
            assert entry.accepted is None

    def test_every_target_is_met_on_a_perfect_fixture(self) -> None:
        curve = risk_coverage_curve([0.9, 0.8, 0.7, 0.6], [True, True, True, True])
        results = coverage_at_fixed_risk(curve)
        assert len(results) == 3
        for entry in results:
            assert entry.available is True
            # Risk is 0 everywhere, so the MAXIMUM qualifying coverage is full coverage.
            assert entry.coverage == pytest.approx(1.0, abs=TOLERANCE)
            assert entry.selective_risk == pytest.approx(0.0, abs=TOLERANCE)
            assert entry.accepted == 4

    def test_the_reported_coverage_is_the_maximum_that_meets_the_target(self) -> None:
        # Points: 0.25/0.0, 0.5/0.0, 0.75/1/3, 1.0/0.5. Only the first two meet 0.20,
        # and the maximum of those coverages is 0.5.
        curve = risk_coverage_curve([0.9, 0.8, 0.7, 0.6], [True, True, False, False])
        results = {entry.target: entry for entry in coverage_at_fixed_risk(curve)}
        assert results[0.20].available is True
        assert results[0.20].coverage == pytest.approx(0.5, abs=TOLERANCE)
        assert results[0.20].selective_risk == pytest.approx(0.0, abs=TOLERANCE)

    def test_an_empty_curve_is_refused(self) -> None:
        empty = RiskCoverageCurve(points=(), aurc=0.0, total=0)
        with pytest.raises(MetricInputError, match="empty curve"):
            coverage_at_fixed_risk(empty)


class TestNoveltyMetrics:
    def test_each_rate_is_hand_computable(self) -> None:
        # Five rows: three novel, two supported.
        #   novel rows:     abstained T, T, F  -> 2 of 3 abstained
        #   supported rows: abstained T, F     -> 1 of 2 abstained
        # novelty abstention recall  = 2/3 = 0.6666666666666666  (abstained correctly)
        # novelty false acceptance   = 1 - 2/3 = 1/3 = 0.3333333333333333 (accepted a
        #                              novel sample, which is the failure direction)
        # supported false abstention = 1/2 = 0.5 (abstained on a supported sample)
        result = novelty_metrics([True, True, True, False, False], [True, True, False, True, False])
        assert result.novelty_total == 3
        assert result.novelty_abstained == 2
        assert result.novelty_abstention_recall == pytest.approx(2.0 / 3.0, abs=TOLERANCE)
        assert result.novelty_false_acceptance_rate == pytest.approx(1.0 / 3.0, abs=TOLERANCE)
        assert result.supported_total == 2
        assert result.supported_abstained == 1
        assert result.supported_false_abstention_rate == pytest.approx(0.5, abs=TOLERANCE)

    def test_recall_and_false_acceptance_are_complements(self) -> None:
        # Complements by construction, and both reported because they are the two
        # directions a reader asks about.
        for is_novel, abstained in (
            ([True, True, True], [True, True, False]),
            ([True, False, True], [False, False, True]),
            ([True], [True]),
            ([True], [False]),
        ):
            result = novelty_metrics(is_novel, abstained)
            assert result.novelty_total > 0
            total = result.novelty_abstention_recall + result.novelty_false_acceptance_rate
            assert total == pytest.approx(1.0, abs=TOLERANCE)

    def test_a_novel_sample_accepted_is_a_false_acceptance(self) -> None:
        result = novelty_metrics([True], [False])
        assert result.novelty_abstention_recall == pytest.approx(0.0, abs=TOLERANCE)
        assert result.novelty_false_acceptance_rate == pytest.approx(1.0, abs=TOLERANCE)

    def test_a_novel_sample_abstained_is_recall(self) -> None:
        result = novelty_metrics([True], [True])
        assert result.novelty_abstention_recall == pytest.approx(1.0, abs=TOLERANCE)
        assert result.novelty_false_acceptance_rate == pytest.approx(0.0, abs=TOLERANCE)

    def test_a_supported_sample_abstained_is_a_false_abstention(self) -> None:
        result = novelty_metrics([False], [True])
        assert result.supported_total == 1
        assert result.supported_false_abstention_rate == pytest.approx(1.0, abs=TOLERANCE)

    def test_an_empty_novel_group_yields_zero_rather_than_nan(self) -> None:
        # The frozen zero-division value is 0.0. A NaN here would propagate silently
        # into every bootstrap percentile computed from it.
        result = novelty_metrics([False, False], [True, False])
        assert result.novelty_total == 0
        assert result.novelty_abstention_recall == ZERO_DIVISION == 0.0
        assert result.novelty_false_acceptance_rate == ZERO_DIVISION == 0.0
        assert not math.isnan(result.novelty_abstention_recall)
        assert not math.isnan(result.novelty_false_acceptance_rate)

    def test_an_empty_supported_group_yields_zero_rather_than_nan(self) -> None:
        result = novelty_metrics([True, True], [True, False])
        assert result.supported_total == 0
        assert result.supported_false_abstention_rate == ZERO_DIVISION == 0.0
        assert not math.isnan(result.supported_false_abstention_rate)

    def test_both_groups_empty_yields_zeros(self) -> None:
        # novelty_metrics is deliberately TOTAL on empty input rather than raising,
        # because the frozen zero-division rule has to produce a number a bootstrap
        # replicate can carry.
        result = novelty_metrics([], [])
        assert result.novelty_abstention_recall == 0.0
        assert result.novelty_false_acceptance_rate == 0.0
        assert result.supported_false_abstention_rate == 0.0


class TestPairedDelta:
    def test_the_subtraction_order_is_carried_rather_than_implied(self) -> None:
        delta = paired_delta(
            "structuredExactMatch",
            minuend_label="factorized-logistic",
            subtrahend_label="joint-logistic",
            minuend=0.6,
            subtrahend=0.5,
            higher_is_better=True,
        )
        assert delta.delta == pytest.approx(0.1, abs=TOLERANCE)
        canonical = delta.to_canonical()
        assert canonical["direction"] == "factorized-logistic minus joint-logistic"
        assert canonical["higherIsBetter"] is True

    def test_an_error_like_metric_records_that_lower_is_better(self) -> None:
        # The sign alone is ambiguous: +0.1 on an error-like metric means WORSE.
        delta = paired_delta(
            "negativeLogLikelihood",
            minuend_label="scaled",
            subtrahend_label="unscaled",
            minuend=1.1,
            subtrahend=1.0,
            higher_is_better=False,
        )
        assert delta.delta == pytest.approx(0.1, abs=TOLERANCE)
        assert delta.higher_is_better is False


class TestInputValidation:
    """Every guard is exercised with broken input, because a guard only ever run on
    well-formed input is indistinguishable from a guard that does nothing."""

    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(lambda: structured_exact_match([1, 2], [1]), id="structured_exact_match"),
            pytest.param(
                lambda: per_class_metrics([1, 2], [1], FIXED_THIRTEEN_LABELS),
                id="per_class_metrics",
            ),
            pytest.param(
                lambda: macro_f1_fixed_thirteen([1, 2], [1]), id="macro_f1_fixed_thirteen"
            ),
            pytest.param(
                lambda: macro_f1_observed_classes([1, 2], [1]), id="macro_f1_observed_classes"
            ),
            pytest.param(lambda: confusion_matrix([1, 2], [1]), id="confusion_matrix"),
            pytest.param(
                lambda: negative_log_likelihood([one_hot(1), one_hot(2)], [1]),
                id="negative_log_likelihood",
            ),
            pytest.param(
                lambda: multiclass_brier([one_hot(1), one_hot(2)], [1]), id="multiclass_brier"
            ),
            pytest.param(
                lambda: expected_calibration_error([0.5, 0.6], [True]),
                id="expected_calibration_error",
            ),
            pytest.param(lambda: risk_coverage_curve([0.5, 0.6], [True]), id="risk_coverage_curve"),
            pytest.param(lambda: novelty_metrics([True, False], [True]), id="novelty_metrics"),
        ],
    )
    def test_a_length_mismatch_is_refused(self, call) -> None:
        with pytest.raises(MetricInputError, match="entries"):
            call()

    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(lambda: structured_exact_match([], []), id="structured_exact_match"),
            pytest.param(lambda: macro_f1_fixed_thirteen([], []), id="macro_f1_fixed_thirteen"),
            pytest.param(lambda: macro_f1_observed_classes([], []), id="macro_f1_observed_classes"),
            pytest.param(lambda: negative_log_likelihood([], []), id="negative_log_likelihood"),
            pytest.param(lambda: multiclass_brier([], []), id="multiclass_brier"),
            pytest.param(
                lambda: expected_calibration_error([], []), id="expected_calibration_error"
            ),
            pytest.param(lambda: risk_coverage_curve([], []), id="risk_coverage_curve"),
        ],
    )
    def test_empty_input_is_refused(self, call) -> None:
        with pytest.raises(MetricInputError, match="must not be empty"):
            call()

    def test_the_three_deliberately_total_functions_do_not_raise_on_empty_input(self) -> None:
        # Documented rather than silently untested. per_class_metrics and
        # confusion_matrix take the label universe as a PARAMETER, so an empty row set
        # over a declared universe is a well-defined all-zero answer; novelty_metrics
        # must return the frozen zero-division value so a bootstrap replicate drawing
        # no novel rows still yields a number. The other seven refuse, above.
        assert len(per_class_metrics([], [], FIXED_THIRTEEN_LABELS)) == 13
        assert all(entry.f1 == 0.0 for entry in per_class_metrics([], [], FIXED_THIRTEEN_LABELS))
        assert len(confusion_matrix([], [])) == 13
        assert novelty_metrics([], []).novelty_total == 0


class TestFrozenMetricDefinitions:
    """The canonical definitions must be the preregistered ones, not a drifted copy."""

    def test_the_canonical_definitions_report_the_frozen_constants(self) -> None:
        definitions = metric_definitions_canonical()
        assert definitions["eceBinCount"] == 15
        assert definitions["eceBinning"] == "equal-width"
        assert definitions["eceRange"] == [0.0, 1.0]
        assert definitions["fixedThirteenLabels"] == list(range(1, 14))
        assert definitions["zeroDivision"] == 0
        assert definitions["absentClassesDropped"] is False
        assert definitions["matchedCoverageTargets"] == [0.25, 0.5, 0.75, 1.0]
        assert definitions["fixedRiskTargets"] == [0.05, 0.1, 0.2]

    def test_the_edge_rule_and_tie_rules_are_stated_not_left_to_a_library_default(
        self,
    ) -> None:
        definitions = metric_definitions_canonical()
        assert "half-open" in str(definitions["eceEdgeRule"])
        assert "closed at 1.0" in str(definitions["eceEdgeRule"])
        assert "higher achieved coverage" in str(definitions["matchedCoverageTieBreak"])
        assert "accepted or rejected together" in str(definitions["acceptanceTieRule"])
        assert "no interpolation" in str(definitions["aurcConvention"])

    def test_the_module_constants_match_the_canonical_report(self) -> None:
        definitions = metric_definitions_canonical()
        assert definitions["eceBinCount"] == ECE_BIN_COUNT
        assert definitions["fixedRiskTargets"] == list(FIXED_RISK_TARGETS)
        assert definitions["matchedCoverageTargets"] == list(MATCHED_COVERAGE_TARGETS)
        assert definitions["fixedThirteenLabels"] == list(FIXED_THIRTEEN_LABELS)
        assert definitions["zeroDivision"] == ZERO_DIVISION


class TestPreregistrationCrossCheck:
    """The evaluator must implement the FROZEN preregistration, not a copy of it.

    Two independent documents are compared: the constants in ``metrics.py`` and the
    checked-in preregistration artifact. Asserting the constants against themselves
    would pass for a drifted evaluator, because the drift would be on both sides.
    """

    def test_the_preregistration_artifact_is_present_and_readable(self) -> None:
        assert PREREGISTRATION_PATH.is_file()

    def test_the_ece_binning_matches_the_preregistration(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        ece = preregistered_metrics["ece"]
        assert isinstance(ece, dict)
        assert ece["binCount"] == ECE_BIN_COUNT == 15
        assert ece["binning"] == "equal-width"
        assert ece["range"] == list(ECE_RANGE)
        assert ece["adaptiveBinningAfterTestInspection"] is False
        definitions = metric_definitions_canonical()
        assert definitions["eceBinCount"] == ece["binCount"]
        assert definitions["eceBinning"] == ece["binning"]
        assert definitions["eceRange"] == ece["range"]

    def test_the_matched_coverage_targets_match_the_preregistration(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        preregistered = preregistered_metrics["matchedCoverageTargets"]
        assert preregistered == list(MATCHED_COVERAGE_TARGETS)
        assert metric_definitions_canonical()["matchedCoverageTargets"] == preregistered

    def test_the_fixed_risk_targets_match_the_preregistration(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        preregistered = preregistered_metrics["fixedRiskTargets"]
        assert preregistered == list(FIXED_RISK_TARGETS)
        assert metric_definitions_canonical()["fixedRiskTargets"] == preregistered

    def test_the_fixed_thirteen_label_universe_matches_the_preregistration(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        universe = preregistered_metrics["fixedThirteenLabelUniverse"]
        assert isinstance(universe, dict)
        assert universe["labels"] == list(FIXED_THIRTEEN_LABELS)
        assert universe["zeroDivision"] == ZERO_DIVISION
        # The single most consequential frozen flag: dropping absent classes would
        # change the macro-F1 denominator from 13 to the observed count.
        assert universe["absentClassesDropped"] is False
        definitions = metric_definitions_canonical()
        assert definitions["fixedThirteenLabels"] == universe["labels"]
        assert definitions["zeroDivision"] == universe["zeroDivision"]
        assert definitions["absentClassesDropped"] == universe["absentClassesDropped"]

    def test_the_fixed_risk_reporting_rule_matches_the_preregistration(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        preregistered = str(preregistered_metrics["fixedRiskReporting"])
        assert "unavailable rather than omitted" in preregistered
        implemented = str(metric_definitions_canonical()["fixedRiskReporting"])
        assert "never omitted" in implemented
        assert "never as zero coverage" in implemented

    def test_the_matched_coverage_rule_is_without_interpolation_in_both_documents(
        self, preregistered_metrics: dict[str, object]
    ) -> None:
        assert "without interpolation" in str(preregistered_metrics["matchedCoverageRule"])
        definitions = metric_definitions_canonical()
        assert "without interpolation" in str(definitions["matchedCoverageRule"])
        assert "no interpolation" in str(definitions["aurcConvention"])

    def test_the_observed_class_variant_is_preregistered_as_secondary_only(self) -> None:
        document = json.loads(PREREGISTRATION_PATH.read_text(encoding="utf-8"))
        secondary = document["researchQuestions"]["RQ1"]["secondaryContext"]
        joined = " ".join(str(entry) for entry in secondary)
        assert "never" in joined
        assert "substituted" in joined


def _sorted_distinct(values: Sequence[float]) -> list[float]:
    return sorted(set(values))


class TestCurveInvariantsAcrossFixtures:
    """A handful of properties that must hold on every fixture shape used elsewhere."""

    FIXTURES = [
        ([0.9, 0.8, 0.7, 0.6], [True, False, True, False]),
        ([0.8, 0.8, 0.8, 0.5], [True, False, True, True]),
        ([0.9, 0.8, 0.7], [True, True, False]),
        ([0.5] * 4, [True, True, True, True]),
        ([0.99, 0.01], [False, False]),
    ]

    @pytest.mark.parametrize(("confidences", "correct"), FIXTURES)
    def test_one_point_per_distinct_confidence(
        self, confidences: list[float], correct: list[bool]
    ) -> None:
        curve = risk_coverage_curve(confidences, correct)
        assert len(curve.points) == len(_sorted_distinct(confidences))

    @pytest.mark.parametrize(("confidences", "correct"), FIXTURES)
    def test_aurc_lies_between_the_minimum_and_maximum_achievable_risk(
        self, confidences: list[float], correct: list[bool]
    ) -> None:
        # AURC is a coverage-weighted MEAN of the achievable selective risks, because
        # the coverage increments sum to exactly 1.
        curve = risk_coverage_curve(confidences, correct)
        risks = [point.selective_risk for point in curve.points]
        assert min(risks) - 1e-12 <= curve.aurc <= max(risks) + 1e-12

    @pytest.mark.parametrize(("confidences", "correct"), FIXTURES)
    def test_coverage_is_strictly_increasing_and_ends_at_one(
        self, confidences: list[float], correct: list[bool]
    ) -> None:
        curve = risk_coverage_curve(confidences, correct)
        coverages = [point.coverage for point in curve.points]
        assert coverages == sorted(coverages)
        assert len(set(coverages)) == len(coverages)
        assert coverages[-1] == pytest.approx(1.0, abs=TOLERANCE)

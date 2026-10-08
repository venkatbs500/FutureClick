"""Tests for the FC-008 Sprint-4A clustered bootstrap.

The claims under test are structural rather than numerical: that the resampling unit
really is the parent lineage and not the row, that a paired comparison really does
evaluate both systems on the same draw, and that the frozen configuration is the
preregistered one. Each is checked by observing what the code DID — the row-index
tuples it passed to the statistic — rather than by trusting a flag it reports about
itself.

NO SEALED DATA. Every lineage identifier here is a synthetic string invented in this
file. The real ``test-id``, ``test-ooa``, and ``test-novelty`` partitions are never
named, opened, or simulated.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Sequence

import pytest

from futurebench.fc008.bootstrap import (
    CONFIDENCE_LEVEL,
    LOW_POWER_LINEAGE_THRESHOLD,
    LOWER_PERCENTILE,
    OOA_POWER_LIMITATION,
    PERCENTILE_METHOD,
    UPPER_PERCENTILE,
    BootstrapInputError,
    bootstrap_configuration_canonical,
    bootstrap_paired_delta,
    bootstrap_statistic,
    lineage_groups,
)
from futurebench.fc008.preregistration import (
    BOOTSTRAP_REPLICATES,
    BOOTSTRAP_SEED,
    BOOTSTRAP_UNIT,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PREREGISTRATION_PATH = (
    REPOSITORY_ROOT / "research" / "futurebench" / "artifacts" / "fc008-preregistration.json"
)

#: Small replicate count for the structural tests, where 5000 would only cost time.
#: One test below runs the real frozen 5000 to prove it completes deterministically.
FAST_REPLICATES = 128

TOLERANCE = 1e-12


@pytest.fixture(scope="module")
def preregistered_bootstrap() -> dict[str, object]:
    """The frozen preregistration's ``bootstrap`` block, read READ-ONLY."""
    document = json.loads(PREREGISTRATION_PATH.read_text(encoding="utf-8"))
    section = document["bootstrap"]
    assert isinstance(section, dict)
    return section


def lineage_ids_for(sizes: Sequence[int]) -> list[str]:
    """Row-aligned lineage identifiers, ``sizes[i]`` sibling rows for lineage ``i``.

    Zero-padded so lexicographic order matches numeric order; the grouping is sorted
    by identifier, and a test that relied on ``L10`` sorting after ``L9`` would be
    asserting something about string collation rather than about the bootstrap.
    """
    return [f"L{index:03d}" for index, size in enumerate(sizes) for _ in range(size)]


def values_statistic(values: Sequence[float]):
    """A mean-of-values statistic over row positions, the simplest honest statistic."""

    def statistic(indices: Sequence[int]) -> float:
        selected = [values[index] for index in indices]
        if not selected:
            return 0.0
        return sum(selected) / len(selected)

    return statistic


def recording_statistic(values: Sequence[float], log: list[tuple[int, ...]]):
    """A statistic that records the exact row-index tuple it was handed.

    This is how the paired-sampling claim is tested: not by reading the
    ``identical_groups_per_replicate`` flag the result sets about itself, but by
    comparing what the two statistics were actually called with.
    """

    def statistic(indices: Sequence[int]) -> float:
        log.append(tuple(int(index) for index in indices))
        selected = [values[index] for index in indices]
        if not selected:
            return 0.0
        return sum(selected) / len(selected)

    return statistic


class TestLineageGrouping:
    def test_groups_are_ordered_by_lineage_identifier(self) -> None:
        # Sorted by identifier rather than by first appearance, so which group a drawn
        # index refers to does not depend on the order rows happened to arrive in.
        groups = lineage_groups(["L002", "L000", "L001", "L000"])
        assert [group.lineage_id for group in groups] == ["L000", "L001", "L002"]

    def test_grouping_is_independent_of_input_row_order(self) -> None:
        # Row POSITIONS necessarily move when the rows move; what must not move is
        # which lineage owns which rows, nor the group ordering. Both are checked by
        # mapping each group's positions back through the input.
        forward = ["L000", "L000", "L001", "L002", "L002", "L002"]
        shuffled = ["L002", "L000", "L002", "L001", "L002", "L000"]

        def ownership(lineage_ids: list[str]) -> list[tuple[str, int]]:
            return [
                (group.lineage_id, len(group.row_indices)) for group in lineage_groups(lineage_ids)
            ]

        assert ownership(forward) == ownership(shuffled)
        for lineage_ids in (forward, shuffled):
            for group in lineage_groups(lineage_ids):
                owned = {lineage_ids[index] for index in group.row_indices}
                assert owned == {group.lineage_id}

    def test_every_row_belongs_to_exactly_one_group(self) -> None:
        lineage_ids = lineage_ids_for([3, 1, 2, 4])
        groups = lineage_groups(lineage_ids)
        covered = [index for group in groups for index in group.row_indices]
        assert sorted(covered) == list(range(len(lineage_ids)))
        assert len(covered) == len(set(covered))

    def test_a_lineage_with_several_sibling_rows_is_one_resampling_unit(self) -> None:
        # Four siblings under one parent are ONE unit, not four. Resampling them
        # individually would treat each sibling as fresh evidence and shrink the
        # interval by roughly the square root of the lineage size.
        groups = lineage_groups(["L000"] * 4 + ["L001"])
        assert len(groups) == 2
        assert groups[0].row_indices == (0, 1, 2, 3)
        assert groups[1].row_indices == (4,)

    def test_all_rows_of_a_drawn_lineage_move_together(self) -> None:
        # Observed through the statistic rather than asserted about the grouping: every
        # recorded draw must decompose into whole lineage blocks laid end to end. A
        # draw containing two of a lineage's three siblings would fail to decompose.
        lineage_ids = lineage_ids_for([3, 1, 2])
        blocks = [group.row_indices for group in lineage_groups(lineage_ids)]
        log: list[tuple[int, ...]] = []
        bootstrap_statistic(
            lineage_ids,
            recording_statistic([1.0] * len(lineage_ids), log),
            replicates=FAST_REPLICATES,
        )
        # The first call is the point estimate over all rows; the rest are replicates.
        assert len(log) == FAST_REPLICATES + 1
        for drawn in log:
            position = 0
            while position < len(drawn):
                block = next(
                    (
                        candidate
                        for candidate in blocks
                        if drawn[position : position + len(candidate)] == candidate
                    ),
                    None,
                )
                assert block is not None, drawn
                position += len(block)
            assert position == len(drawn)

    def test_empty_lineage_ids_are_refused(self) -> None:
        with pytest.raises(BootstrapInputError, match="must not be empty"):
            lineage_groups([])


class TestTheUnitIsALineageNotARow:
    def test_unequal_lineage_sizes_make_the_resampled_row_count_vary(self) -> None:
        # Three lineages owning 1, 2, and 7 rows. Each replicate draws three LINEAGES
        # with replacement, so drawing the seven-row lineage twice yields more rows
        # than drawing the one-row lineage twice. If rows were the unit, every
        # replicate would contain exactly ten rows and this set would be a singleton.
        lineage_ids = lineage_ids_for([1, 2, 7])
        assert len(lineage_ids) == 10
        log: list[tuple[int, ...]] = []
        bootstrap_statistic(
            lineage_ids,
            recording_statistic([1.0] * len(lineage_ids), log),
            replicates=FAST_REPLICATES,
        )
        replicate_sizes = {len(drawn) for drawn in log[1:]}
        assert len(replicate_sizes) > 1
        # Three lineages drawn from {1, 2, 7} rows: smallest possible is 3 x 1 = 3 and
        # largest is 3 x 7 = 21.
        assert min(replicate_sizes) >= 3
        assert max(replicate_sizes) <= 21
        assert len(log) == FAST_REPLICATES + 1

    def test_the_point_estimate_uses_every_row_exactly_once(self) -> None:
        lineage_ids = lineage_ids_for([1, 2, 7])
        log: list[tuple[int, ...]] = []
        bootstrap_statistic(
            lineage_ids,
            recording_statistic([1.0] * len(lineage_ids), log),
            replicates=4,
        )
        assert log[0] == tuple(range(len(lineage_ids)))

    def test_equal_lineage_sizes_keep_the_row_count_constant(self) -> None:
        # The control for the test above: with equal lineage sizes the row count is
        # constant, which proves the variation there came from the size imbalance and
        # not from some unrelated sloppiness in the draw.
        lineage_ids = lineage_ids_for([2] * 5)
        log: list[tuple[int, ...]] = []
        bootstrap_statistic(
            lineage_ids,
            recording_statistic([1.0] * len(lineage_ids), log),
            replicates=FAST_REPLICATES,
        )
        assert {len(drawn) for drawn in log[1:]} == {10}

    def test_the_resampling_unit_is_named_in_the_result(self) -> None:
        lineage_ids = lineage_ids_for([2] * 5)
        interval = bootstrap_statistic(
            lineage_ids,
            values_statistic([1.0, 0.0] * 5),
            replicates=FAST_REPLICATES,
        )
        assert interval.resampling_unit == BOOTSTRAP_UNIT == "parentLineageId"
        assert interval.lineage_count == 5
        assert interval.row_count == 10


class TestDeterminism:
    LINEAGE_IDS = lineage_ids_for([2, 3, 1, 4, 2, 2, 3, 1, 5, 2])
    VALUES = [float(index % 3) for index in range(25)]

    def test_the_same_seed_produces_byte_identical_intervals(self) -> None:
        first = bootstrap_statistic(
            self.LINEAGE_IDS,
            values_statistic(self.VALUES),
            replicates=FAST_REPLICATES,
            seed=BOOTSTRAP_SEED,
        )
        second = bootstrap_statistic(
            self.LINEAGE_IDS,
            values_statistic(self.VALUES),
            replicates=FAST_REPLICATES,
            seed=BOOTSTRAP_SEED,
        )
        assert first.point_estimate == second.point_estimate
        assert first.lower == second.lower
        assert first.upper == second.upper
        assert first.to_canonical() == second.to_canonical()

    def test_the_draw_sequence_itself_is_identical_across_calls(self) -> None:
        # Stronger than equal endpoints: the whole sequence of drawn row tuples must
        # match, so determinism cannot be an accident of two different draws happening
        # to land on the same percentiles.
        first: list[tuple[int, ...]] = []
        second: list[tuple[int, ...]] = []
        for log in (first, second):
            bootstrap_statistic(
                self.LINEAGE_IDS,
                recording_statistic(self.VALUES, log),
                replicates=FAST_REPLICATES,
                seed=BOOTSTRAP_SEED,
            )
        assert first == second

    def test_different_seeds_generally_produce_different_intervals(self) -> None:
        # A fixture with real variance: without variance every draw would give the
        # same statistic and the seed would be invisible, so this would pass vacuously.
        assert len(set(self.VALUES)) > 1
        intervals = [
            bootstrap_statistic(
                self.LINEAGE_IDS,
                values_statistic(self.VALUES),
                replicates=FAST_REPLICATES,
                seed=seed,
            )
            for seed in (BOOTSTRAP_SEED, BOOTSTRAP_SEED + 1, BOOTSTRAP_SEED + 2)
        ]
        # The point estimate is seed-free by construction; the endpoints are not.
        assert len({interval.point_estimate for interval in intervals}) == 1
        assert len({(interval.lower, interval.upper) for interval in intervals}) > 1

    def test_row_order_does_not_change_the_interval(self) -> None:
        # The same lineages and the same per-lineage values, presented in a different
        # row order. Grouping is sorted by lineage id, so the draw is unchanged.
        sizes = [2, 3, 1, 4]
        forward_ids = lineage_ids_for(sizes)
        # Value depends on the lineage, not the position, so reordering rows reorders
        # the values with them and the per-lineage content is preserved.
        forward_values = [float(identifier[-1]) for identifier in forward_ids]
        order = list(reversed(range(len(forward_ids))))
        reversed_ids = [forward_ids[index] for index in order]
        reversed_values = [forward_values[index] for index in order]

        first = bootstrap_statistic(
            forward_ids, values_statistic(forward_values), replicates=FAST_REPLICATES
        )
        second = bootstrap_statistic(
            reversed_ids, values_statistic(reversed_values), replicates=FAST_REPLICATES
        )
        assert first.point_estimate == pytest.approx(second.point_estimate, abs=TOLERANCE)
        assert first.lower == pytest.approx(second.lower, abs=TOLERANCE)
        assert first.upper == pytest.approx(second.upper, abs=TOLERANCE)

    def test_the_real_frozen_five_thousand_replicates_complete_deterministically(self) -> None:
        # The fast tests above use a reduced replicate count. This one runs the actual
        # preregistered configuration, because "it is deterministic at 128" is not a
        # claim about the number that will be reported.
        lineage_ids = lineage_ids_for([2] * 6)
        values = [1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0]
        first = bootstrap_statistic(lineage_ids, values_statistic(values))
        second = bootstrap_statistic(lineage_ids, values_statistic(values))
        assert first.replicates == BOOTSTRAP_REPLICATES == 5000
        assert first.seed == BOOTSTRAP_SEED
        assert first.to_canonical() == second.to_canonical()


class TestPairedSamplingUsesIdenticalGroups:
    """THE CRITICAL TEST: both systems must see the SAME draw, not two draws.

    If each system were bootstrapped independently, the interval on the difference
    would carry between-draw variance that the paired design exists to remove. The
    claim is checked by instrumenting both statistics and comparing the row-index
    tuples they were actually handed, element for element.
    """

    LINEAGE_IDS = lineage_ids_for([1, 3, 2, 4, 2])
    MINUEND_VALUES = [float(index % 2) for index in range(12)]
    SUBTRAHEND_VALUES = [float((index + 1) % 3) for index in range(12)]

    def paired(self, replicates: int = FAST_REPLICATES):
        minuend_log: list[tuple[int, ...]] = []
        subtrahend_log: list[tuple[int, ...]] = []
        interval = bootstrap_paired_delta(
            self.LINEAGE_IDS,
            recording_statistic(self.MINUEND_VALUES, minuend_log),
            recording_statistic(self.SUBTRAHEND_VALUES, subtrahend_log),
            metric="structuredExactMatch",
            minuend_label="factorized-logistic",
            subtrahend_label="joint-logistic",
            replicates=replicates,
        )
        return interval, minuend_log, subtrahend_log

    def test_both_statistics_received_identical_call_sequences(self) -> None:
        _, minuend_log, subtrahend_log = self.paired()
        assert len(minuend_log) == len(subtrahend_log) == FAST_REPLICATES + 1
        assert minuend_log == subtrahend_log
        for drawn_by_minuend, drawn_by_subtrahend in zip(minuend_log, subtrahend_log, strict=True):
            assert drawn_by_minuend == drawn_by_subtrahend

    def test_the_recorded_draws_are_not_all_the_same_tuple(self) -> None:
        # Guards the test above against passing vacuously: if every draw happened to be
        # identical, two INDEPENDENT bootstraps would also produce equal logs.
        _, minuend_log, _ = self.paired()
        assert len(set(minuend_log[1:])) > 1

    def test_the_point_estimate_call_also_covers_all_rows_for_both(self) -> None:
        _, minuend_log, subtrahend_log = self.paired()
        all_rows = tuple(range(len(self.LINEAGE_IDS)))
        assert minuend_log[0] == all_rows
        assert subtrahend_log[0] == all_rows

    def test_an_independent_pair_of_bootstraps_would_not_match(self) -> None:
        # Establishes that equal logs are evidence rather than an artefact of the
        # instrumentation: two separate bootstrap_statistic runs on different seeds
        # produce different draw sequences on the same lineages.
        first: list[tuple[int, ...]] = []
        second: list[tuple[int, ...]] = []
        bootstrap_statistic(
            self.LINEAGE_IDS,
            recording_statistic(self.MINUEND_VALUES, first),
            replicates=FAST_REPLICATES,
            seed=BOOTSTRAP_SEED,
        )
        bootstrap_statistic(
            self.LINEAGE_IDS,
            recording_statistic(self.SUBTRAHEND_VALUES, second),
            replicates=FAST_REPLICATES,
            seed=BOOTSTRAP_SEED + 7,
        )
        assert first != second

    def test_the_point_estimate_is_the_difference_of_the_two_statistics(self) -> None:
        interval, _, _ = self.paired()
        all_rows = tuple(range(len(self.LINEAGE_IDS)))
        minuend = values_statistic(self.MINUEND_VALUES)(all_rows)
        subtrahend = values_statistic(self.SUBTRAHEND_VALUES)(all_rows)
        assert interval.point_estimate == pytest.approx(minuend - subtrahend, abs=TOLERANCE)

    def test_the_canonical_form_declares_identical_sampled_groups(self) -> None:
        interval, _, _ = self.paired()
        canonical = interval.to_canonical()
        assert canonical["pairedComparisonsUseIdenticalSampledGroups"] is True
        assert interval.identical_groups_per_replicate is True

    def test_the_canonical_form_warns_that_excluding_zero_is_not_significance(self) -> None:
        interval, _, _ = self.paired()
        warning = str(interval.to_canonical()["interpretationWarning"])
        assert "not a significance claim" in warning
        assert "powerLimitation" in warning

    def test_the_subtraction_order_is_carried_rather_than_implied(self) -> None:
        interval, _, _ = self.paired()
        canonical = interval.to_canonical()
        assert canonical["direction"] == "factorized-logistic minus joint-logistic"
        assert canonical["minuendLabel"] == "factorized-logistic"
        assert canonical["subtrahendLabel"] == "joint-logistic"

    def test_the_paired_run_is_deterministic_at_the_frozen_replicate_count(self) -> None:
        first, first_log, _ = self.paired(replicates=BOOTSTRAP_REPLICATES)
        second, second_log, _ = self.paired(replicates=BOOTSTRAP_REPLICATES)
        assert first.replicates == 5000
        assert first.to_canonical() == second.to_canonical()
        assert first_log == second_log


class TestPercentileInterval:
    LINEAGE_IDS = lineage_ids_for([2, 2, 2, 3, 1, 2, 2, 4, 1, 3, 2, 2])
    VALUES = [float((index * 7) % 5) / 4.0 for index in range(26)]

    def test_the_endpoints_are_ordered_and_finite(self) -> None:
        # Deliberately NOT asserting lower <= point <= upper. For a skewed statistic a
        # percentile interval can legitimately sit entirely on one side of the point
        # estimate, so that assertion would be pinning an accident rather than the
        # frozen convention.
        interval = bootstrap_statistic(
            self.LINEAGE_IDS, values_statistic(self.VALUES), replicates=512
        )
        assert interval.lower <= interval.upper
        assert math.isfinite(interval.lower)
        assert math.isfinite(interval.upper)
        assert math.isfinite(interval.point_estimate)

    def test_a_constant_statistic_collapses_the_interval_to_a_point(self) -> None:
        # The one case where the endpoints ARE pinned exactly: zero replicate variance
        # must give lower == point == upper rather than a spuriously wide band.
        interval = bootstrap_statistic(
            self.LINEAGE_IDS,
            values_statistic([0.25] * len(self.LINEAGE_IDS)),
            replicates=256,
        )
        assert interval.lower == pytest.approx(0.25, abs=TOLERANCE)
        assert interval.upper == pytest.approx(0.25, abs=TOLERANCE)
        assert interval.point_estimate == pytest.approx(0.25, abs=TOLERANCE)

    def test_the_percentile_convention_is_two_point_five_and_ninety_seven_point_five(
        self,
    ) -> None:
        assert (LOWER_PERCENTILE, UPPER_PERCENTILE) == (2.5, 97.5)
        assert CONFIDENCE_LEVEL == 0.95
        assert "linear interpolation" in PERCENTILE_METHOD

    def test_every_interval_records_the_percentile_method(self) -> None:
        interval = bootstrap_statistic(
            self.LINEAGE_IDS, values_statistic(self.VALUES), replicates=64
        )
        canonical = interval.to_canonical()
        assert canonical["confidenceLevel"] == 0.95
        assert canonical["percentileMethod"] == PERCENTILE_METHOD


class TestLowPowerFlag:
    def test_six_parent_lineages_are_flagged_as_low_powered(self) -> None:
        # Six is the test-OOA lineage count and is deliberately inside the flag.
        lineage_ids = lineage_ids_for([2] * 6)
        interval = bootstrap_statistic(
            lineage_ids,
            values_statistic([1.0, 0.0] * 6),
            replicates=FAST_REPLICATES,
        )
        assert interval.lineage_count == 6
        assert interval.low_powered is True
        assert interval.power_limitation is not None
        assert "six parent lineages" in interval.power_limitation
        assert interval.power_limitation == OOA_POWER_LIMITATION

    def test_twenty_parent_lineages_are_not_flagged(self) -> None:
        lineage_ids = lineage_ids_for([2] * 20)
        interval = bootstrap_statistic(
            lineage_ids,
            values_statistic([1.0, 0.0] * 20),
            replicates=FAST_REPLICATES,
        )
        assert interval.lineage_count == 20
        assert interval.low_powered is False
        assert interval.power_limitation is None

    def test_the_threshold_is_ten_clusters(self) -> None:
        assert LOW_POWER_LINEAGE_THRESHOLD == 10
        for count, expected in ((9, True), (10, False)):
            lineage_ids = lineage_ids_for([1] * count)
            interval = bootstrap_statistic(
                lineage_ids, values_statistic([1.0] * count), replicates=16
            )
            assert interval.low_powered is expected

    def test_a_paired_interval_carries_the_same_flag_and_caveat(self) -> None:
        lineage_ids = lineage_ids_for([2] * 6)
        interval = bootstrap_paired_delta(
            lineage_ids,
            values_statistic([1.0, 0.0] * 6),
            values_statistic([0.0, 1.0] * 6),
            metric="macroF1FixedThirteen",
            minuend_label="factorized-logistic",
            subtrahend_label="joint-logistic",
            replicates=FAST_REPLICATES,
        )
        assert interval.low_powered is True
        canonical = interval.to_canonical()
        assert canonical["lowPowered"] is True
        assert "six parent lineages" in str(canonical["powerLimitation"])

    def test_an_explicit_power_limitation_overrides_the_default(self) -> None:
        lineage_ids = lineage_ids_for([1] * 20)
        interval = bootstrap_statistic(
            lineage_ids,
            values_statistic([1.0] * 20),
            replicates=16,
            power_limitation="caller supplied caveat",
        )
        assert interval.low_powered is False
        assert interval.power_limitation == "caller supplied caveat"


class TestFrozenConfiguration:
    def test_the_module_constants_are_the_frozen_ones(self) -> None:
        assert BOOTSTRAP_REPLICATES == 5000
        assert BOOTSTRAP_SEED == 202601040002
        assert BOOTSTRAP_UNIT == "parentLineageId"

    def test_the_canonical_configuration_reports_percentile_ninety_five(self) -> None:
        configuration = bootstrap_configuration_canonical()
        assert configuration["confidenceInterval"] == "percentile 95%"
        assert configuration["replicates"] == BOOTSTRAP_REPLICATES
        assert configuration["seed"] == BOOTSTRAP_SEED
        assert configuration["resamplingUnit"] == BOOTSTRAP_UNIT
        assert configuration["pairedComparisonsUseIdenticalSampledGroups"] is True
        assert configuration["lowPowerLineageThreshold"] == LOW_POWER_LINEAGE_THRESHOLD
        assert configuration["percentileMethod"] == PERCENTILE_METHOD

    def test_the_power_limitation_refuses_to_claim_significance(self) -> None:
        limitation = str(bootstrap_configuration_canonical()["ooaPowerLimitation"])
        assert "six parent lineages" in limitation
        assert "no high-powered inference or statistical significance is claimed" in limitation

    def test_the_configuration_matches_the_frozen_preregistration(
        self, preregistered_bootstrap: dict[str, object]
    ) -> None:
        # Cross-checked against an independent document, so a drifted evaluator cannot
        # pass by agreeing with itself.
        assert preregistered_bootstrap["replicates"] == BOOTSTRAP_REPLICATES
        assert preregistered_bootstrap["seed"] == BOOTSTRAP_SEED
        assert preregistered_bootstrap["resamplingUnit"] == BOOTSTRAP_UNIT
        assert preregistered_bootstrap["confidenceInterval"] == "percentile 95%"
        assert preregistered_bootstrap["pairedComparisonsUseIdenticalSampledGroups"] is True
        configuration = bootstrap_configuration_canonical()
        for key in (
            "replicates",
            "seed",
            "resamplingUnit",
            "confidenceInterval",
            "pairedComparisonsUseIdenticalSampledGroups",
        ):
            assert configuration[key] == preregistered_bootstrap[key]

    def test_the_seed_is_namespaced_away_from_the_training_seed(
        self, preregistered_bootstrap: dict[str, object]
    ) -> None:
        assert preregistered_bootstrap["seedNamespacedFromTrainingSeed"] is True
        assert preregistered_bootstrap["seed"] != preregistered_bootstrap["trainingSeed"]

    def test_the_preregistered_power_limitation_names_six_lineages(
        self, preregistered_bootstrap: dict[str, object]
    ) -> None:
        assert "six parent lineages" in str(preregistered_bootstrap["powerLimitation"])


class TestInputValidation:
    LINEAGE_IDS = lineage_ids_for([2, 2])

    def test_empty_lineage_ids_are_refused_by_both_entry_points(self) -> None:
        with pytest.raises(BootstrapInputError, match="must not be empty"):
            bootstrap_statistic([], values_statistic([]), replicates=8)
        with pytest.raises(BootstrapInputError, match="must not be empty"):
            bootstrap_paired_delta(
                [],
                values_statistic([]),
                values_statistic([]),
                metric="aurc",
                minuend_label="scaled",
                subtrahend_label="unscaled",
                replicates=8,
            )

    @pytest.mark.parametrize("replicates", [0, -1, -5000])
    def test_a_non_positive_replicate_count_is_refused(self, replicates: int) -> None:
        with pytest.raises(BootstrapInputError, match="must be positive"):
            bootstrap_statistic(
                self.LINEAGE_IDS,
                values_statistic([1.0, 0.0, 1.0, 0.0]),
                replicates=replicates,
            )

    @pytest.mark.parametrize("replicates", [0, -1])
    def test_a_non_positive_replicate_count_is_refused_for_paired_deltas(
        self, replicates: int
    ) -> None:
        with pytest.raises(BootstrapInputError, match="must be positive"):
            bootstrap_paired_delta(
                self.LINEAGE_IDS,
                values_statistic([1.0, 0.0, 1.0, 0.0]),
                values_statistic([0.0, 1.0, 0.0, 1.0]),
                metric="aurc",
                minuend_label="scaled",
                subtrahend_label="unscaled",
                replicates=replicates,
            )

    def test_a_single_lineage_still_produces_an_interval(self) -> None:
        # Degenerate but legal: one cluster resampled with replacement is always
        # itself, so the interval collapses. It must be reported, and flagged.
        interval = bootstrap_statistic(
            ["L000", "L000"], values_statistic([1.0, 0.0]), replicates=16
        )
        assert interval.lineage_count == 1
        assert interval.low_powered is True
        assert interval.lower == pytest.approx(interval.upper, abs=TOLERANCE)

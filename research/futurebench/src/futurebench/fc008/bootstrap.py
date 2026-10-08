"""FC-008 Sprint 4A clustered bootstrap.

WHY THE SAMPLING UNIT IS A PARENT LINEAGE AND NOT A ROW

FutureBench records are authored in lineages: one parent scenario produces several
sibling rows that share wording, structure, and class. Those siblings are not
independent draws. Resampling individual ROWS would treat each sibling as fresh
evidence, shrink the interval by roughly the square root of the average lineage
size, and produce a confidence interval that is confidently wrong. Resampling whole
LINEAGES with replacement keeps the dependence inside the unit of resampling, which
is the entire point of a clustered bootstrap.

WHY PAIRED COMPARISONS MUST SHARE THE DRAW

RQ1 compares two model families on the same rows, and RQ2 compares two temperatures
on the same rows. If each system were bootstrapped from its own independent draw,
the interval on the DIFFERENCE would include between-draw variance that the paired
design eliminates, and the comparison would lose the correlation that makes it
sensitive. ``bootstrap_paired_delta`` therefore draws one lineage sample per
replicate and evaluates BOTH systems on exactly that sample.

WHAT THE INTERVAL ON TEST-OOA DOES AND DOES NOT MEAN

test-OOA contains six parent lineages. A bootstrap over six clusters can only ever
resample those six, so the interval describes variability across THESE six authored
lineages and nothing wider. It is not evidence about the population of real
applications, and an interval that excludes zero here is NOT a significance claim.
Every interval this module produces carries ``lineage_count`` and a
``power_limitation`` note so a result artifact cannot be read without that caveat.

PERCENTILE CONVENTION

The 95% interval is the 2.5th and 97.5th percentiles of the replicate statistics,
computed with NumPy's default linear interpolation between order statistics. Fixed
and recorded here because with six clusters the choice of interpolation is visible
in the result, and it must not be selectable after the fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Sequence

from .preregistration import BOOTSTRAP_REPLICATES, BOOTSTRAP_SEED, BOOTSTRAP_UNIT

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np
    from numpy.typing import NDArray

CONFIDENCE_LEVEL = 0.95
LOWER_PERCENTILE = 2.5
UPPER_PERCENTILE = 97.5
PERCENTILE_METHOD = "numpy linear interpolation between order statistics"

OOA_POWER_LIMITATION = (
    "test-OOA contains only six parent lineages; the interval describes variability "
    "across those six authored lineages only, interval width will be large, and no "
    "high-powered inference or statistical significance is claimed from this holdout"
)

# Below this many clusters the interval is reported but explicitly flagged as
# low-powered. Six, the test-OOA lineage count, is deliberately inside the flag.
LOW_POWER_LINEAGE_THRESHOLD = 10


class BootstrapInputError(ValueError):
    """Raised when bootstrap inputs are inconsistent. Fails closed."""


@dataclass(frozen=True)
class LineageGroup:
    """One resampling unit: a lineage identifier and the row positions it owns."""

    lineage_id: str
    row_indices: tuple[int, ...]


def lineage_groups(lineage_ids: Sequence[str]) -> tuple[LineageGroup, ...]:
    """Group row positions by parent lineage, ordered by lineage id.

    Sorted by identifier rather than by first appearance so the group ordering — and
    therefore which group a drawn index refers to — does not depend on the order
    rows happen to arrive in. A bootstrap whose result depends on input row order is
    not reproducible.
    """
    if len(lineage_ids) == 0:
        raise BootstrapInputError("lineage_ids must not be empty")
    grouped: dict[str, list[int]] = {}
    for position, lineage_id in enumerate(lineage_ids):
        grouped.setdefault(str(lineage_id), []).append(position)
    return tuple(
        LineageGroup(lineage_id=lineage_id, row_indices=tuple(positions))
        for lineage_id, positions in sorted(grouped.items())
    )


@dataclass(frozen=True)
class BootstrapInterval:
    """A percentile interval plus everything needed to reproduce and caveat it."""

    point_estimate: float
    lower: float
    upper: float
    replicates: int
    seed: int
    resampling_unit: str
    lineage_count: int
    row_count: int
    confidence_level: float
    low_powered: bool
    power_limitation: str | None

    def to_canonical(self) -> dict[str, object]:
        return {
            "pointEstimate": self.point_estimate,
            "lower": self.lower,
            "upper": self.upper,
            "replicates": self.replicates,
            "seed": self.seed,
            "resamplingUnit": self.resampling_unit,
            "lineageCount": self.lineage_count,
            "rowCount": self.row_count,
            "confidenceLevel": self.confidence_level,
            "percentileMethod": PERCENTILE_METHOD,
            "lowPowered": self.low_powered,
            "powerLimitation": self.power_limitation,
        }


@dataclass(frozen=True)
class PairedBootstrapInterval:
    """A paired difference interval. Both systems saw the same lineage draws."""

    metric: str
    minuend_label: str
    subtrahend_label: str
    point_estimate: float
    lower: float
    upper: float
    replicates: int
    seed: int
    resampling_unit: str
    lineage_count: int
    row_count: int
    confidence_level: float
    low_powered: bool
    power_limitation: str | None
    identical_groups_per_replicate: bool

    def to_canonical(self) -> dict[str, object]:
        return {
            "metric": self.metric,
            "direction": f"{self.minuend_label} minus {self.subtrahend_label}",
            "minuendLabel": self.minuend_label,
            "subtrahendLabel": self.subtrahend_label,
            "pointEstimate": self.point_estimate,
            "lower": self.lower,
            "upper": self.upper,
            "replicates": self.replicates,
            "seed": self.seed,
            "resamplingUnit": self.resampling_unit,
            "lineageCount": self.lineage_count,
            "rowCount": self.row_count,
            "confidenceLevel": self.confidence_level,
            "percentileMethod": PERCENTILE_METHOD,
            "lowPowered": self.low_powered,
            "powerLimitation": self.power_limitation,
            "pairedComparisonsUseIdenticalSampledGroups": self.identical_groups_per_replicate,
            "interpretationWarning": (
                "an interval excluding zero is not a significance claim; see powerLimitation"
            ),
        }


def _draw_group_indices(group_count: int, replicates: int, seed: int) -> NDArray[np.int64]:
    """Draw every replicate's cluster indices in one deterministic call.

    One ``integers`` call for the whole matrix rather than one per replicate, so the
    draw depends only on the seed, the cluster count, and the replicate count — and
    not on how many times anything else consumed the generator.
    """
    import numpy as np

    generator = np.random.default_rng(seed)
    return generator.integers(0, group_count, size=(replicates, group_count), dtype=np.int64)


def _rows_for_draw(groups: Sequence[LineageGroup], drawn: Sequence[int]) -> tuple[int, ...]:
    rows: list[int] = []
    for group_index in drawn:
        rows.extend(groups[int(group_index)].row_indices)
    return tuple(rows)


def _percentiles(values: Sequence[float]) -> tuple[float, float]:
    import numpy as np

    array = np.asarray(values, dtype=np.float64)
    lower, upper = np.percentile(array, [LOWER_PERCENTILE, UPPER_PERCENTILE])
    return float(lower), float(upper)


def _validate(lineage_ids: Sequence[str], replicates: int, groups: Sequence[LineageGroup]) -> None:
    if replicates <= 0:
        raise BootstrapInputError(f"replicates must be positive, got {replicates}")
    if len(groups) == 0:
        raise BootstrapInputError("at least one lineage group is required")
    if len(lineage_ids) == 0:
        raise BootstrapInputError("lineage_ids must not be empty")


def bootstrap_statistic(
    lineage_ids: Sequence[str],
    statistic: Callable[[Sequence[int]], float],
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
    power_limitation: str | None = None,
) -> BootstrapInterval:
    """Clustered percentile bootstrap of one statistic.

    ``statistic`` receives ROW POSITIONS, which lets the same function be reused for
    accuracy, macro F1, or any curve summary without this module knowing anything
    about the metric. Positions may repeat within a replicate: that is what sampling
    clusters with replacement means.
    """
    groups = lineage_groups(lineage_ids)
    _validate(lineage_ids, replicates, groups)

    point = float(statistic(tuple(range(len(lineage_ids)))))
    draws = _draw_group_indices(len(groups), replicates, seed)
    values = [float(statistic(_rows_for_draw(groups, draws[index]))) for index in range(replicates)]
    lower, upper = _percentiles(values)
    low_powered = len(groups) < LOW_POWER_LINEAGE_THRESHOLD

    return BootstrapInterval(
        point_estimate=point,
        lower=lower,
        upper=upper,
        replicates=replicates,
        seed=seed,
        resampling_unit=BOOTSTRAP_UNIT,
        lineage_count=len(groups),
        row_count=len(lineage_ids),
        confidence_level=CONFIDENCE_LEVEL,
        low_powered=low_powered,
        power_limitation=power_limitation or (OOA_POWER_LIMITATION if low_powered else None),
    )


def bootstrap_paired_delta(
    lineage_ids: Sequence[str],
    minuend_statistic: Callable[[Sequence[int]], float],
    subtrahend_statistic: Callable[[Sequence[int]], float],
    *,
    metric: str,
    minuend_label: str,
    subtrahend_label: str,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
    power_limitation: str | None = None,
) -> PairedBootstrapInterval:
    """Clustered percentile bootstrap of ``minuend - subtrahend``.

    Both statistics are evaluated on the SAME drawn rows within each replicate, so
    the interval is on the paired difference rather than on a difference of two
    independently resampled quantities. The subtraction order is carried in the
    result and never left to the reader.
    """
    groups = lineage_groups(lineage_ids)
    _validate(lineage_ids, replicates, groups)

    all_rows = tuple(range(len(lineage_ids)))
    point = float(minuend_statistic(all_rows)) - float(subtrahend_statistic(all_rows))

    draws = _draw_group_indices(len(groups), replicates, seed)
    values: list[float] = []
    for index in range(replicates):
        rows = _rows_for_draw(groups, draws[index])
        values.append(float(minuend_statistic(rows)) - float(subtrahend_statistic(rows)))
    lower, upper = _percentiles(values)
    low_powered = len(groups) < LOW_POWER_LINEAGE_THRESHOLD

    return PairedBootstrapInterval(
        metric=metric,
        minuend_label=minuend_label,
        subtrahend_label=subtrahend_label,
        point_estimate=point,
        lower=lower,
        upper=upper,
        replicates=replicates,
        seed=seed,
        resampling_unit=BOOTSTRAP_UNIT,
        lineage_count=len(groups),
        row_count=len(lineage_ids),
        confidence_level=CONFIDENCE_LEVEL,
        low_powered=low_powered,
        power_limitation=power_limitation or (OOA_POWER_LIMITATION if low_powered else None),
        identical_groups_per_replicate=True,
    )


def bootstrap_configuration_canonical() -> dict[str, object]:
    """The frozen bootstrap configuration, for embedding in a result artifact."""
    return {
        "replicates": BOOTSTRAP_REPLICATES,
        "seed": BOOTSTRAP_SEED,
        "resamplingUnit": BOOTSTRAP_UNIT,
        "confidenceInterval": "percentile 95%",
        "percentileMethod": PERCENTILE_METHOD,
        "pairedComparisonsUseIdenticalSampledGroups": True,
        "lowPowerLineageThreshold": LOW_POWER_LINEAGE_THRESHOLD,
        "ooaPowerLimitation": OOA_POWER_LIMITATION,
    }

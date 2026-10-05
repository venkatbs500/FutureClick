"""Acceptance-threshold selection on POLICY-VALIDATION only.

WHAT THIS THRESHOLD IS AND IS NOT

It is an engineering development policy: the calibrated-confidence level above which
the model's structured prediction is accepted rather than abstained on, chosen on one
143-row synthetic partition. It is NOT a statistical guarantee. A threshold selected
under a <=10% selective-error constraint does not promise 90% accuracy in the world,
on a different corpus, or even on the test partitions, and describing it that way
would convert a development choice into a claim the evidence cannot support.

A MINIMUM ACCEPTED COUNT, BECAUSE HIGH THRESHOLDS LIE

Selective error on three accepted records is meaningless, and without a floor the
search would reliably pick a very high threshold that accepted almost nothing and
reported zero error. The floor is max(20, ceil(25% of rows)), which on 143 rows is 36.

WHERE THIS SITS IN THE RUNTIME

After the deterministic gates, never instead of them. Schema, version, freshness,
privacy, context, object support, tuple support, and novelty/support checks run first
under the frozen precedence; model confidence can only decline to answer a question
those checks have already allowed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

#: Frozen candidate thresholds.
CONFIDENCE_THRESHOLD_GRID: tuple[float, ...] = (
    0.00,
    0.10,
    0.20,
    0.30,
    0.40,
    0.50,
    0.55,
    0.60,
    0.65,
    0.70,
    0.75,
    0.80,
    0.85,
    0.90,
    0.95,
)

SELECTIVE_ERROR_CONSTRAINT = 0.10
MINIMUM_ACCEPTED_ABSOLUTE = 20
MINIMUM_ACCEPTED_FRACTION = 0.25

ABSTENTION_POLICY_VERSION = "1.0"
POLICY_SELECTION_RULE_VERSION = "1.0"
POLICY_SELECTION_RULE = (
    "among thresholds meeting selective structured error <= 0.10 AND the minimum "
    "accepted support, choose (1) highest coverage, (2) lower selective error, "
    "(3) lower threshold; if none meets the error constraint, fall back to "
    "thresholds meeting minimum support and choose (1) lowest selective error, "
    "(2) highest coverage, (3) higher threshold"
)


def minimum_accepted_support(row_count: int) -> int:
    """max(20 records, 25% of the partition rounded up)."""
    return max(MINIMUM_ACCEPTED_ABSOLUTE, math.ceil(MINIMUM_ACCEPTED_FRACTION * row_count))


@dataclass(frozen=True)
class ThresholdCandidate:
    threshold: float
    accepted: int
    coverage: float
    selective_error: float
    meets_minimum_support: bool
    meets_error_constraint: bool

    def to_canonical(self) -> dict[str, Any]:
        return {
            "acceptedCount": self.accepted,
            "coverage": self.coverage,
            "meetsErrorConstraint": self.meets_error_constraint,
            "meetsMinimumSupport": self.meets_minimum_support,
            "selectiveStructuredError": self.selective_error,
            "threshold": self.threshold,
        }


@dataclass(frozen=True)
class ThresholdSelection:
    threshold: float
    coverage: float
    selective_error: float
    accepted: int
    minimum_required: int
    fallback_used: bool
    candidates: tuple[ThresholdCandidate, ...]


def evaluate_thresholds(
    confidence: NDArray[np.float64],
    predicted_classes: NDArray[np.int64],
    actual_classes: NDArray[np.int64],
) -> tuple[ThresholdCandidate, ...]:
    """Coverage, accepted count, and selective structured error per candidate."""
    import numpy as np

    total = int(confidence.shape[0])
    minimum = minimum_accepted_support(total)
    candidates: list[ThresholdCandidate] = []
    for threshold in CONFIDENCE_THRESHOLD_GRID:
        accepted_mask = confidence >= threshold
        accepted = int(np.count_nonzero(accepted_mask))
        coverage = accepted / total if total else 0.0
        if accepted == 0:
            selective_error = 0.0
        else:
            wrong = int(
                np.count_nonzero(predicted_classes[accepted_mask] != actual_classes[accepted_mask])
            )
            selective_error = wrong / accepted
        candidates.append(
            ThresholdCandidate(
                threshold=threshold,
                accepted=accepted,
                coverage=coverage,
                selective_error=selective_error,
                meets_minimum_support=accepted >= minimum,
                meets_error_constraint=selective_error <= SELECTIVE_ERROR_CONSTRAINT,
            )
        )
    return tuple(candidates)


def select_threshold(
    confidence: NDArray[np.float64],
    predicted_classes: NDArray[np.int64],
    actual_classes: NDArray[np.int64],
) -> ThresholdSelection:
    """Apply the predeclared primary rule, falling back only if nothing qualifies.

    Whether the fallback ran is recorded rather than smoothed over: a threshold
    selected under the fallback means no candidate met the 10% error constraint at
    adequate support, which is a materially weaker result and must be visible.
    """
    total = int(confidence.shape[0])
    minimum = minimum_accepted_support(total)
    candidates = evaluate_thresholds(confidence, predicted_classes, actual_classes)

    primary = [
        candidate
        for candidate in candidates
        if candidate.meets_error_constraint and candidate.meets_minimum_support
    ]
    if primary:
        chosen = sorted(
            primary,
            key=lambda item: (-item.coverage, item.selective_error, item.threshold),
        )[0]
        fallback_used = False
    else:
        supported = [c for c in candidates if c.meets_minimum_support]
        if not supported:
            raise RuntimeError(
                f"no candidate threshold accepted the minimum {minimum} records out "
                f"of {total}; threshold selection cannot proceed"
            )
        chosen = sorted(
            supported,
            key=lambda item: (item.selective_error, -item.coverage, -item.threshold),
        )[0]
        fallback_used = True

    return ThresholdSelection(
        threshold=chosen.threshold,
        coverage=chosen.coverage,
        selective_error=chosen.selective_error,
        accepted=chosen.accepted,
        minimum_required=minimum,
        fallback_used=fallback_used,
        candidates=candidates,
    )

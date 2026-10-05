"""Temperature scaling, fitted on CALIBRATION only.

ONE SCALAR, AND NOTHING ELSE MOVES

Temperature scaling divides the logits by a single positive number before the
softmax. Model weights are untouched, which is what makes RQ2 answerable: T=1 and the
fitted T are the same model, so any difference in calibration quality is attributable
to the scaling rather than to a different fit.

A DETERMINISTIC GRID, NOT AN OPTIMIZER

A fixed 401-point log-spaced grid over [0.1, 10.0], predeclared. An adaptive optimizer
such as L-BFGS would find a marginally better NLL and would make the result depend on
the optimizer's own convergence path, line-search implementation, and version. The
grid gives the same answer on every machine and is trivially portable to TypeScript.
Log spacing is symmetric about T=1, so sharpening and smoothing get equal resolution,
and the grid contains T=1 exactly at its midpoint — the no-op must be a reachable
candidate, otherwise the search could not decline to act.

A BOUNDARY HIT IS A STOP CONDITION

If the best T is 0.1 or 10.0, the optimum is outside the preregistered range and the
range is wrong. Expanding it after seeing test data would be exactly the kind of
post-hoc adjustment preregistration exists to prevent, so the pipeline fails instead
and the range has to be reviewed before the tests are opened.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

TEMPERATURE_MIN = 0.1
TEMPERATURE_MAX = 10.0
TEMPERATURE_GRID_POINTS = 401
TEMPERATURE_SEARCH_VERSION = "1.0"
CALIBRATION_ARTIFACT_VERSION = "1.0"

TEMPERATURE_SEARCH_SPECIFICATION = (
    f"{TEMPERATURE_GRID_POINTS} log-spaced candidates over "
    f"[{TEMPERATURE_MIN}, {TEMPERATURE_MAX}] inclusive, symmetric about T=1; "
    "objective multiclass negative log-likelihood on the calibration partition; "
    "tie-break (1) lower NLL, (2) temperature closest to 1.0, (3) smaller temperature"
)


class TemperatureBoundaryError(RuntimeError):
    """Raised when the selected temperature sits on the edge of the frozen range."""


def temperature_grid() -> NDArray[np.float64]:
    """The frozen candidate grid. Contains exactly 1.0 at its midpoint."""
    import numpy as np

    return np.logspace(
        np.log10(TEMPERATURE_MIN),
        np.log10(TEMPERATURE_MAX),
        num=TEMPERATURE_GRID_POINTS,
        dtype=np.float64,
    )


def stable_softmax(scores: NDArray[np.float64]) -> NDArray[np.float64]:
    """Row-wise softmax computed by subtracting the row maximum first.

    The subtraction is mathematically a no-op and numerically essential: ``exp`` of a
    large positive logit overflows to infinity and the row becomes NaN. Written here
    once so the Python reference and the Sprint-4 TypeScript port can be the same
    algorithm rather than two approximations of it.
    """
    import numpy as np

    shifted = scores - np.max(scores, axis=1, keepdims=True)
    exponentiated = np.exp(shifted)
    return exponentiated / np.sum(exponentiated, axis=1, keepdims=True)


def apply_temperature(scores: NDArray[np.float64], temperature: float) -> NDArray[np.float64]:
    """Scale logits by ``1/T``. Raw and scaled logits stay separate values."""
    if temperature <= 0.0:
        raise ValueError(f"temperature must be positive, got {temperature}")
    return scores / temperature


def negative_log_likelihood(
    scores: NDArray[np.float64],
    actual_classes: NDArray[np.int64],
    class_order: tuple[int, ...],
) -> float:
    """Mean multiclass NLL of the scaled logits under the frozen class order."""
    import numpy as np

    probabilities = stable_softmax(scores)
    position_of = {class_number: index for index, class_number in enumerate(class_order)}
    rows = np.arange(probabilities.shape[0])
    columns = np.array([position_of[int(value)] for value in actual_classes], dtype=np.int64)
    chosen = probabilities[rows, columns]
    # Clipped only to keep log finite when a probability underflows to exactly zero.
    return float(-np.mean(np.log(np.clip(chosen, 1e-300, 1.0))))


@dataclass(frozen=True)
class TemperatureFit:
    temperature: float
    nll_at_unit_temperature: float
    nll_at_selected_temperature: float
    tie_break_used: str
    candidates_evaluated: int

    def to_canonical(self) -> dict[str, Any]:
        return {
            "calibrationNllScaled": self.nll_at_selected_temperature,
            "calibrationNllUnitTemperature": self.nll_at_unit_temperature,
            "candidatesEvaluated": self.candidates_evaluated,
            "gridPoints": TEMPERATURE_GRID_POINTS,
            "temperature": self.temperature,
            "temperatureMax": TEMPERATURE_MAX,
            "temperatureMin": TEMPERATURE_MIN,
            "temperatureSearchSpecification": TEMPERATURE_SEARCH_SPECIFICATION,
            "temperatureSearchVersion": TEMPERATURE_SEARCH_VERSION,
            "tieBreakUsed": self.tie_break_used,
        }


def fit_temperature(
    calibration_logits: NDArray[np.float64],
    calibration_classes: NDArray[np.int64],
    class_order: tuple[int, ...],
) -> TemperatureFit:
    """Select T by exhaustive grid search on calibration NLL.

    Takes logits already computed from the selected model, so this function cannot
    reach the model weights and cannot change them.
    """
    import numpy as np

    grid = temperature_grid()
    losses = np.array(
        [
            negative_log_likelihood(
                apply_temperature(calibration_logits, float(candidate)),
                calibration_classes,
                class_order,
            )
            for candidate in grid
        ],
        dtype=np.float64,
    )

    best_loss = float(np.min(losses))
    tied = [float(grid[index]) for index in np.flatnonzero(losses == best_loss)]
    if len(tied) == 1:
        tie_break_used = "none"
    else:
        closest = min(abs(candidate - 1.0) for candidate in tied)
        nearest = [c for c in tied if abs(c - 1.0) == closest]
        tie_break_used = "closest-to-one" if len(nearest) == 1 else "smaller-temperature"
        tied = nearest
    selected = min(tied)

    if selected <= grid[0] or selected >= grid[-1]:
        raise TemperatureBoundaryError(
            f"selected temperature {selected} sits on the boundary of the "
            f"preregistered range [{TEMPERATURE_MIN}, {TEMPERATURE_MAX}]; the search "
            "range must be reviewed before final tests are opened"
        )

    return TemperatureFit(
        temperature=selected,
        nll_at_unit_temperature=negative_log_likelihood(
            calibration_logits, calibration_classes, class_order
        ),
        nll_at_selected_temperature=best_loss,
        tie_break_used=tie_break_used,
        candidates_evaluated=int(grid.size),
    )


def confidence_diagnostics(
    probabilities: NDArray[np.float64],
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Calibrated confidence, top-two margin, and normalized entropy.

    Margin and entropy are DIAGNOSTICS. Sprint 3 tunes exactly one gate, the
    confidence threshold; adding tuned margin or entropy gates would be three
    selection decisions on one 143-row partition.
    """
    import numpy as np

    confidence = np.max(probabilities, axis=1)
    ordered = np.sort(probabilities, axis=1)
    margin = ordered[:, -1] - ordered[:, -2]
    classes = probabilities.shape[1]
    safe = np.clip(probabilities, 1e-300, 1.0)
    entropy = -np.sum(probabilities * np.log(safe), axis=1) / np.log(classes)
    return confidence, margin, entropy

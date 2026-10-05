"""Joint and factorized logistic reference models.

TWO FAMILIES, ONE SEARCH BUDGET

RQ1 compares complete systems, which only means anything if neither system got more
tuning than the other. So both families search the same four C values, and the
factorized family trains all three heads at ONE shared C. Tuning a separate C per
head would give the factorized system a 4x larger search space and turn any measured
difference into an artifact of the search budget rather than of the factorization.

WHAT IS FIT WHERE

Weights come from TRAIN only, including after C is chosen: there is no refit on
train+calibration or train+policy-validation. Calibration and policy-validation keep
their distinct roles, and a refit would spend them.

CONVERGENCE IS A HARD FAILURE

``ConvergenceWarning`` is promoted to an exception. A logistic fit that has not
converged has weights determined partly by where the optimizer ran out of iterations,
which is not reproducible in any meaningful sense and would quietly poison the
artifact. ``max_iter`` is fixed in advance at 5000 for every candidate, so the budget
cannot be raised for whichever model happens to look best.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

    from .corpus import DevelopmentCorpus

from .corpus import CALIBRATION, POLICY_VALIDATION, TRAIN

#: The one fixed candidate grid, identical for both families. Four values.
C_GRID: tuple[float, ...] = (0.01, 0.1, 1.0, 10.0)

#: Fixed in advance, generous, and the same for every candidate.
MAX_ITER = 5000
TOLERANCE = 1e-6
SOLVER = "lbfgs"
#: L2 regularization. scikit-learn 1.8 deprecated `penalty="l2"` in favour of
#: `l1_ratio=0.0`, which is the identical regularizer expressed through the unified
#: elastic-net parameter. The regularizer did not change; only its spelling did, and
#: passing the deprecated form would emit a FutureWarning on every one of the eight
#: candidate fits. `PENALTY` is retained as the artifact's semantic descriptor.
PENALTY = "l2"
L1_RATIO = 0.0
FIT_INTERCEPT = True

#: One seed, chosen once, never searched over.
RANDOM_SEED = 20260104

MODEL_VERSION = "1.0"
JOINT_FAMILY = "joint-logistic"
FACTORIZED_FAMILY = "factorized-logistic"

#: The factorized composition is frozen now so Sprint 4 ports a fixed rule.
COMPOSITION_VERSION = "1.0"
COMPOSITION_SPECIFICATION = (
    "tupleLogit[k] = verbLogit[verb(k)] + objectLogit[object(k)] "
    "+ transitionPropertyLogit[property(k)]; additive independent-head log score, "
    "no learned combiner, applied before normalization"
)

SELECTION_RULE_VERSION = "1.0"
SELECTION_RULE = (
    "rank candidates on policy-validation by (1) higher structured exact-match "
    "accuracy, (2) higher fixed-13-class macro F1, (3) smaller C"
)


class ClassCoverageError(RuntimeError):
    """Raised when TRAIN does not cover the frozen class universe exactly."""


class ConvergenceFailure(RuntimeError):
    """Raised when a candidate fit emits a convergence warning."""


def _fit_logistic(
    design: NDArray[np.float64],
    labels: NDArray[np.int64],
    *,
    c_value: float,
    class_order: tuple[int, ...],
    target_name: str,
) -> Any:
    """Fit one multinomial logistic model with the frozen configuration.

    ``class_order`` is passed and then ASSERTED against ``classes_`` rather than
    assumed. scikit-learn sorts classes itself, and the sort happens to agree with
    1..13 here; relying on that agreement would be a silent dependency that breaks
    without warning if a class is ever absent from a partition.

    Coverage is checked BEFORE the fit, so a malformed corpus costs nothing and
    produces no estimator that a later stage could mistake for a usable one.
    """
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.linear_model import LogisticRegression

    require_complete_class_coverage(labels, class_order, target_name=target_name)

    model = LogisticRegression(
        C=c_value,
        l1_ratio=L1_RATIO,
        fit_intercept=FIT_INTERCEPT,
        solver=SOLVER,
        max_iter=MAX_ITER,
        tol=TOLERANCE,
        random_state=RANDOM_SEED,
    )
    # Every warning becomes an error during the fit. ConvergenceWarning is the one
    # that matters methodologically, but a deprecation or numerical warning slipping
    # through silently is how a fit configuration rots across library versions, so
    # nothing is allowed to pass unnoticed.
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        try:
            model.fit(design, labels)
        except ConvergenceWarning as error:
            raise ConvergenceFailure(
                f"logistic fit at C={c_value} did not converge within max_iter={MAX_ITER}: {error}"
            ) from error
        except Warning as error:
            raise RuntimeError(
                f"logistic fit at C={c_value} emitted an unexpected warning, which "
                f"would otherwise have gone unnoticed: {type(error).__name__}: {error}"
            ) from error

    # Exact equality, not a subset. The earlier version compared against the frozen
    # order filtered down to whatever classes happened to be observed, which meant an
    # absent class could never fail this check — the expectation shrank to match.
    observed = [int(value) for value in model.classes_]
    if observed != list(class_order):
        raise ClassCoverageError(
            f"{target_name}: scikit-learn exposes classes {observed}, expected exactly "
            f"the frozen order {list(class_order)}; coefficient rows would be misaligned"
        )
    return model


def require_complete_class_coverage(
    labels: NDArray[np.int64],
    expected: tuple[int, ...],
    *,
    target_name: str,
) -> None:
    """Require TRAIN to contain every expected class exactly, or refuse to fit.

    FC-008's frozen train partition is REQUIRED to contain all supported classes, so a
    missing class is a malformed corpus rather than a case to accommodate. The earlier
    version of this module padded an absent class with a zero weight row and a -1e9
    intercept. That was the wrong call: it produces an artifact with the correct
    13-row shape and the correct byte size, which passes every structural check while
    silently encoding a class the model was never trained to recognise. A reviewer
    reading the artifact could not tell the difference. Failing here means a corpus
    defect surfaces as a corpus defect.

    Unexpected labels are refused for the mirror reason: a label outside the frozen
    universe means the export and the support matrix disagree, and guessing which one
    is right is not this function's decision to make.
    """
    import numpy as np

    observed = {int(value) for value in np.unique(labels)}
    allowed = set(expected)

    unexpected = sorted(observed - allowed)
    if unexpected:
        raise ClassCoverageError(
            f"{target_name}: training labels contain {unexpected}, which are outside the "
            f"frozen universe {list(expected)}; the export and the support matrix disagree"
        )

    missing = [value for value in expected if value not in observed]
    if missing:
        raise ClassCoverageError(
            f"{target_name}: training partition is missing class(es) {missing} of the "
            f"required {len(expected)}; FC-008 requires complete coverage and will not "
            f"synthesise a coefficient row for an unobserved class"
        )


def _place_in_frozen_order(
    model: Any,
    class_order: tuple[int, ...],
    feature_count: int,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Place fitted rows into the frozen class order.

    Reached only after :func:`require_complete_class_coverage` has established that
    every expected class was observed, so there is no absent class to pad and no
    binary collapse to unwind. Both are still checked, because this function's
    correctness depends on those facts and an unchecked dependency is how the padding
    path would come back.
    """
    import numpy as np

    observed = [int(value) for value in model.classes_]
    if observed != list(class_order):
        raise ClassCoverageError(
            f"fitted estimator exposes classes {observed}, expected exactly "
            f"{list(class_order)}; coefficient rows would be misaligned"
        )

    fitted_coefficients = np.asarray(model.coef_, dtype=np.float64)
    fitted_intercepts = np.asarray(model.intercept_, dtype=np.float64)
    if fitted_coefficients.shape != (len(class_order), feature_count):
        raise ClassCoverageError(
            f"fitted coefficients have shape {fitted_coefficients.shape}, expected "
            f"{(len(class_order), feature_count)}"
        )
    if fitted_intercepts.shape != (len(class_order),):
        raise ClassCoverageError(
            f"fitted intercepts have shape {fitted_intercepts.shape}, expected "
            f"{(len(class_order),)}"
        )

    coefficients = np.zeros((len(class_order), feature_count), dtype=np.float64)
    intercepts = np.zeros(len(class_order), dtype=np.float64)
    for row, class_number in enumerate(observed):
        target = class_order.index(class_number)
        coefficients[target] = fitted_coefficients[row]
        intercepts[target] = fitted_intercepts[row]
    return coefficients, intercepts


def logits(
    design: NDArray[np.float64],
    coefficients: NDArray[np.float64],
    intercepts: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Raw decision values: ``X @ W.T + b``."""
    return design @ coefficients.T + intercepts


def compose_tuple_logits(
    verb_logits: NDArray[np.float64],
    object_logits: NDArray[np.float64],
    property_logits: NDArray[np.float64],
    class_order_heads: tuple[tuple[int, int, int], ...],
) -> NDArray[np.float64]:
    """Frozen additive composition of head logits into 13 tuple logits.

    The sum, not a learned combiner. Adding a trained composition layer would give
    the factorized family extra capacity that the joint family does not have, and the
    comparison would stop being about factorization.
    """
    import numpy as np

    composed = np.zeros((verb_logits.shape[0], len(class_order_heads)), dtype=np.float64)
    for position, (verb, obj, prop) in enumerate(class_order_heads):
        composed[:, position] = (
            verb_logits[:, verb] + object_logits[:, obj] + property_logits[:, prop]
        )
    return composed


def structured_exact_match(
    predicted_classes: NDArray[np.int64], actual_classes: NDArray[np.int64]
) -> float:
    """Fraction of rows whose predicted class equals the actual class."""
    import numpy as np

    if predicted_classes.size == 0:
        return 0.0
    return float(np.mean(predicted_classes == actual_classes))


def fixed_thirteen_macro_f1(
    predicted_classes: NDArray[np.int64],
    actual_classes: NDArray[np.int64],
    class_order: tuple[int, ...],
) -> float:
    """Macro F1 over the FIXED label universe 1..13 with ``zero_division=0``.

    The label set is passed explicitly so absent classes are scored as zero rather
    than dropped. Dropping them would inflate macro F1 on any partition that happens
    to contain fewer classes, which is exactly what test-OOA does.
    """
    from sklearn.metrics import f1_score

    return float(
        f1_score(
            actual_classes,
            predicted_classes,
            labels=list(class_order),
            average="macro",
            zero_division=0,
        )
    )


@dataclass(frozen=True)
class JointModel:
    c_value: float
    coefficients: NDArray[np.float64]
    intercepts: NDArray[np.float64]

    def tuple_logits(self, design: NDArray[np.float64]) -> NDArray[np.float64]:
        return logits(design, self.coefficients, self.intercepts)


@dataclass(frozen=True)
class FactorizedModel:
    c_value: float
    verb_coefficients: NDArray[np.float64]
    verb_intercepts: NDArray[np.float64]
    object_coefficients: NDArray[np.float64]
    object_intercepts: NDArray[np.float64]
    property_coefficients: NDArray[np.float64]
    property_intercepts: NDArray[np.float64]
    class_order_heads: tuple[tuple[int, int, int], ...]

    def head_logits(
        self, design: NDArray[np.float64]
    ) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
        """The raw 10/9/10 provider logits, preserved as the factorized output."""
        return (
            logits(design, self.verb_coefficients, self.verb_intercepts),
            logits(design, self.object_coefficients, self.object_intercepts),
            logits(design, self.property_coefficients, self.property_intercepts),
        )

    def tuple_logits(self, design: NDArray[np.float64]) -> NDArray[np.float64]:
        verb, obj, prop = self.head_logits(design)
        return compose_tuple_logits(verb, obj, prop, self.class_order_heads)


@dataclass(frozen=True)
class CandidateScore:
    c_value: float
    structured_exact_match: float
    fixed_thirteen_macro_f1: float


@dataclass(frozen=True)
class SelectionOutcome:
    """The chosen C plus which partition played which role in choosing it.

    The two partition names are carried as data rather than left implicit in the
    code, so an artifact reader can see that weights came from train and the choice
    came from policy-validation without reading the trainer.
    """

    selected_c: float
    candidates: tuple[CandidateScore, ...]
    tie_break_used: str
    weight_partition: str = TRAIN
    selection_partition: str = POLICY_VALIDATION


def _select(candidates: list[tuple[float, CandidateScore]]) -> SelectionOutcome:
    """Apply the predeclared ranking: accuracy, then macro F1, then smaller C."""
    ordered = sorted(
        candidates,
        key=lambda item: (
            -item[1].structured_exact_match,
            -item[1].fixed_thirteen_macro_f1,
            item[1].c_value,
        ),
    )
    best = ordered[0][1]
    tied_on_accuracy = [
        score for _, score in ordered if score.structured_exact_match == best.structured_exact_match
    ]
    tied_on_f1 = [
        score
        for score in tied_on_accuracy
        if score.fixed_thirteen_macro_f1 == best.fixed_thirteen_macro_f1
    ]
    if len(tied_on_accuracy) == 1:
        tie_break_used = "none"
    elif len(tied_on_f1) == 1:
        tie_break_used = "fixed-13-macro-f1"
    else:
        tie_break_used = "smaller-C"
    return SelectionOutcome(
        selected_c=best.c_value,
        candidates=tuple(score for _, score in sorted(candidates, key=lambda item: item[0])),
        tie_break_used=tie_break_used,
    )


def train_joint(corpus: DevelopmentCorpus) -> tuple[JointModel, SelectionOutcome]:
    """Fit the joint family: weights on TRAIN, C selected on POLICY-VALIDATION."""
    import numpy as np

    class_order = corpus.class_numbers
    train_design, train_labels = corpus.matrix(TRAIN)
    policy_design, policy_labels = corpus.matrix(POLICY_VALIDATION)

    # Checked once, up front, before any candidate is fitted. Doing it here as well as
    # inside the fit means a malformed corpus is rejected before the first estimator
    # exists, rather than on whichever candidate happens to trip over it.
    require_complete_class_coverage(train_labels, class_order, target_name="joint tuple class")

    candidates: list[tuple[float, CandidateScore]] = []
    fitted: dict[float, JointModel] = {}
    for c_value in C_GRID:
        model = _fit_logistic(
            train_design,
            train_labels,
            c_value=c_value,
            class_order=class_order,
            target_name="joint tuple class",
        )
        coefficients, intercepts = _place_in_frozen_order(model, class_order, train_design.shape[1])
        joint = JointModel(c_value=c_value, coefficients=coefficients, intercepts=intercepts)
        fitted[c_value] = joint

        scores = joint.tuple_logits(policy_design)
        predicted = np.array(
            [class_order[int(index)] for index in np.argmax(scores, axis=1)], dtype=np.int64
        )
        candidates.append(
            (
                c_value,
                CandidateScore(
                    c_value=c_value,
                    structured_exact_match=structured_exact_match(predicted, policy_labels),
                    fixed_thirteen_macro_f1=fixed_thirteen_macro_f1(
                        predicted, policy_labels, class_order
                    ),
                ),
            )
        )

    outcome = _select(candidates)
    return fitted[outcome.selected_c], outcome


def train_factorized(corpus: DevelopmentCorpus) -> tuple[FactorizedModel, SelectionOutcome]:
    """Fit the factorized family: three heads at ONE shared C.

    The shared C is what keeps the search budget equal to the joint family's. All
    three heads are refit together for each candidate, and the candidate is scored
    through the frozen composition rule, so selection sees the same structured
    prediction the artifact will produce.
    """
    import numpy as np

    class_order = corpus.class_numbers
    class_order_heads = tuple(
        corpus.head_targets_for_class(class_number) for class_number in class_order
    )

    train_design, _ = corpus.matrix(TRAIN)
    train_verbs, train_objects, train_properties = corpus.head_labels(TRAIN)
    policy_design, policy_labels = corpus.matrix(POLICY_VALIDATION)

    head_specifications = (
        ("verb", train_verbs, len(corpus.verb_order)),
        ("objectKind", train_objects, len(corpus.object_order)),
        ("transitionProperty", train_properties, len(corpus.transition_property_order)),
    )

    # Each head has its own frozen universe — 10 verbs, 9 object kinds, 10 transition
    # properties — and each must be covered completely. A head missing one class would
    # otherwise contribute a padded row to the additive composition, quietly biasing
    # every tuple logit that depends on it.
    for head_name, targets, size in head_specifications:
        require_complete_class_coverage(
            targets, tuple(range(size)), target_name=f"factorized {head_name} head"
        )

    candidates: list[tuple[float, CandidateScore]] = []
    fitted: dict[float, FactorizedModel] = {}
    for c_value in C_GRID:
        heads = []
        for head_name, targets, size in head_specifications:
            head_order = tuple(range(size))
            model = _fit_logistic(
                train_design,
                targets,
                c_value=c_value,
                class_order=head_order,
                target_name=f"factorized {head_name} head",
            )
            heads.append(_place_in_frozen_order(model, head_order, train_design.shape[1]))

        factorized = FactorizedModel(
            c_value=c_value,
            verb_coefficients=heads[0][0],
            verb_intercepts=heads[0][1],
            object_coefficients=heads[1][0],
            object_intercepts=heads[1][1],
            property_coefficients=heads[2][0],
            property_intercepts=heads[2][1],
            class_order_heads=class_order_heads,
        )
        fitted[c_value] = factorized

        scores = factorized.tuple_logits(policy_design)
        predicted = np.array(
            [class_order[int(index)] for index in np.argmax(scores, axis=1)], dtype=np.int64
        )
        candidates.append(
            (
                c_value,
                CandidateScore(
                    c_value=c_value,
                    structured_exact_match=structured_exact_match(predicted, policy_labels),
                    fixed_thirteen_macro_f1=fixed_thirteen_macro_f1(
                        predicted, policy_labels, class_order
                    ),
                ),
            )
        )

    outcome = _select(candidates)
    return fitted[outcome.selected_c], outcome


def train_metrics(
    model: JointModel | FactorizedModel, corpus: DevelopmentCorpus
) -> dict[str, float]:
    """TRAIN-partition descriptive metrics. Labelled as train, never as generalization."""
    import numpy as np

    class_order = corpus.class_numbers
    design, labels = corpus.matrix(TRAIN)
    scores = model.tuple_logits(design)
    predicted = np.array(
        [class_order[int(index)] for index in np.argmax(scores, axis=1)], dtype=np.int64
    )
    return {
        "structuredExactMatch": structured_exact_match(predicted, labels),
        "fixedThirteenMacroF1": fixed_thirteen_macro_f1(predicted, labels, class_order),
    }


def calibration_partition_name() -> str:
    """Named accessor so a typo cannot silently point temperature fitting elsewhere."""
    return CALIBRATION

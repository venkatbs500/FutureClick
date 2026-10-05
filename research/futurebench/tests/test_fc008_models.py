"""Tests for the frozen model contracts: orders, shapes, budgets, and composition.

These pin the things Sprint 4 will port and that a reader of the artifacts has to be
able to trust without rerunning the training: that row 0 of the coefficient matrix is
class 1, that both families searched the same four C values, and that the factorized
score really is the sum of three head logits and not something close to it.
"""

from __future__ import annotations

import ast
import dataclasses
from pathlib import Path

import numpy as np
import pytest

from futurebench.fc008.calibration import (
    TEMPERATURE_GRID_POINTS,
    TEMPERATURE_MAX,
    TEMPERATURE_MIN,
    TemperatureBoundaryError,
    apply_temperature,
    confidence_diagnostics,
    fit_temperature,
    negative_log_likelihood,
    stable_softmax,
    temperature_grid,
)
from futurebench.fc008.corpus import (
    CALIBRATION,
    EXPECTED_CLASS_COUNT,
    EXPECTED_FEATURE_COUNT,
    EXPECTED_OBJECT_COUNT,
    EXPECTED_TRANSITION_PROPERTY_COUNT,
    EXPECTED_VERB_COUNT,
    POLICY_VALIDATION,
    TRAIN,
    AccessLedger,
    load_development_corpus,
)
from futurebench.fc008.models import (
    C_GRID,
    MAX_ITER,
    RANDOM_SEED,
    ClassCoverageError,
    compose_tuple_logits,
    logits,
    require_complete_class_coverage,
    train_factorized,
    train_joint,
)
from futurebench.fc008.policy import (
    CONFIDENCE_THRESHOLD_GRID,
    MINIMUM_ACCEPTED_ABSOLUTE,
    evaluate_thresholds,
    minimum_accepted_support,
    select_threshold,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_ROOT = REPOSITORY_ROOT / "research" / "futurebench"
EXPORT_PATH = RESEARCH_ROOT / "data" / "fc008-development-corpus.json"


@pytest.fixture(scope="module")
def corpus():
    return load_development_corpus(EXPORT_PATH)


@pytest.fixture(scope="module")
def trained(corpus):
    joint, joint_selection = train_joint(corpus)
    factorized, factorized_selection = train_factorized(corpus)
    return joint, joint_selection, factorized, factorized_selection


class TestFrozenOrders:
    def test_class_order_is_the_canonical_one_through_thirteen(self, corpus):
        assert corpus.class_numbers == tuple(range(1, EXPECTED_CLASS_COUNT + 1))

    def test_feature_space_is_the_frozen_three_hundred_seventy(self, corpus):
        assert len(corpus.feature_order) == EXPECTED_FEATURE_COUNT
        assert len(set(corpus.feature_order)) == EXPECTED_FEATURE_COUNT

    def test_both_families_see_the_identical_feature_matrix(self, corpus):
        # RQ1 compares model structure. A difference in the inputs would confound it.
        first, _ = corpus.matrix(TRAIN)
        second, _ = corpus.matrix(TRAIN)
        assert np.array_equal(first, second)
        assert first.dtype == np.float64

    def test_features_are_not_standardized(self, corpus):
        # No normalization was part of the frozen feature policy, so adding one here
        # would silently change the feature space Sprint 4 has to reproduce.
        design, _ = corpus.matrix(TRAIN)
        assert np.all((design == 0.0) | (design == 1.0))

    def test_head_targets_are_derived_from_the_frozen_support_matrix(self, corpus):
        seen = {corpus.head_targets_for_class(number): number for number in corpus.class_numbers}
        # All 13 (verb, object) pairs are unique, which is the RQ1 disclosure; this
        # test is what would notice if the support matrix ever stopped being so.
        pairs = {(verb, obj) for verb, obj, _ in seen}
        assert len(pairs) == EXPECTED_CLASS_COUNT


class TestJointModel:
    def test_coefficient_shape_is_thirteen_by_three_hundred_seventy(self, trained):
        joint = trained[0]
        assert joint.coefficients.shape == (EXPECTED_CLASS_COUNT, EXPECTED_FEATURE_COUNT)
        assert joint.intercepts.shape == (EXPECTED_CLASS_COUNT,)
        assert joint.coefficients.dtype == np.float64

    def test_selected_c_comes_from_the_declared_grid(self, trained):
        selection = trained[1]
        assert selection.selected_c in C_GRID
        assert tuple(score.c_value for score in selection.candidates) == C_GRID


class TestFactorizedModel:
    def test_head_shapes_are_ten_nine_ten_by_three_hundred_seventy(self, trained):
        factorized = trained[2]
        assert factorized.verb_coefficients.shape == (
            EXPECTED_VERB_COUNT,
            EXPECTED_FEATURE_COUNT,
        )
        assert factorized.object_coefficients.shape == (
            EXPECTED_OBJECT_COUNT,
            EXPECTED_FEATURE_COUNT,
        )
        assert factorized.property_coefficients.shape == (
            EXPECTED_TRANSITION_PROPERTY_COUNT,
            EXPECTED_FEATURE_COUNT,
        )
        for intercepts, count in (
            (factorized.verb_intercepts, EXPECTED_VERB_COUNT),
            (factorized.object_intercepts, EXPECTED_OBJECT_COUNT),
            (factorized.property_intercepts, EXPECTED_TRANSITION_PROPERTY_COUNT),
        ):
            assert intercepts.shape == (count,)

    def test_one_shared_c_across_all_three_heads(self, trained):
        factorized, selection = trained[2], trained[3]
        # A separate C per head would be a sixty-four-candidate search against the
        # joint family's four, and part of any measured difference would be budget.
        # One `c_value` on the model is what makes a per-head C unrepresentable.
        assert selection.selected_c in C_GRID
        assert len(selection.candidates) == len(C_GRID)
        assert factorized.c_value == selection.selected_c

    def test_both_families_searched_the_same_number_of_candidates(self, trained):
        assert len(trained[1].candidates) == len(trained[3].candidates) == len(C_GRID)

    def test_raw_head_logits_are_preserved_at_their_own_dimensions(self, trained, corpus):
        factorized = trained[2]
        design, _ = corpus.matrix(TRAIN)
        verb, obj, prop = factorized.head_logits(design)
        assert verb.shape == (design.shape[0], EXPECTED_VERB_COUNT)
        assert obj.shape == (design.shape[0], EXPECTED_OBJECT_COUNT)
        assert prop.shape == (design.shape[0], EXPECTED_TRANSITION_PROPERTY_COUNT)

    def test_composition_is_exactly_the_sum_of_three_head_logits(self, trained, corpus):
        factorized = trained[2]
        design, _ = corpus.matrix(TRAIN)
        verb, obj, prop = factorized.head_logits(design)
        composed = factorized.tuple_logits(design)
        for position, number in enumerate(corpus.class_numbers):
            verb_index, object_index, property_index = factorized.class_order_heads[position]
            assert (verb_index, object_index, property_index) == corpus.head_targets_for_class(
                number
            )
            expected = verb[:, verb_index] + obj[:, object_index] + prop[:, property_index]
            # Exact equality, not approximate: the frozen rule is addition, and a
            # learned combiner would give this family capacity the joint lacks.
            assert np.array_equal(composed[:, position], expected)

    def test_composition_helper_agrees_with_the_model(self, trained, corpus):
        factorized = trained[2]
        design, _ = corpus.matrix(TRAIN)
        verb, obj, prop = factorized.head_logits(design)
        targets = tuple(corpus.head_targets_for_class(number) for number in corpus.class_numbers)
        assert targets == factorized.class_order_heads
        assert np.array_equal(
            compose_tuple_logits(verb, obj, prop, targets), factorized.tuple_logits(design)
        )


class TestSelectionIsolation:
    def test_weights_are_fitted_on_train_only(self, corpus):
        import futurebench.fc008.corpus as corpus_module

        seen: list[str] = []
        original = corpus_module.DevelopmentCorpus.matrix

        def spy(self, partition):  # type: ignore[no-untyped-def]
            seen.append(partition)
            return original(self, partition)

        corpus_module.DevelopmentCorpus.matrix = spy  # type: ignore[method-assign]
        try:
            train_joint(corpus)
        finally:
            corpus_module.DevelopmentCorpus.matrix = original  # type: ignore[method-assign]
        # Training reads train for weights and policy-validation for selection, and
        # must never touch calibration: that partition belongs to temperature alone.
        assert CALIBRATION not in seen
        assert TRAIN in seen
        assert POLICY_VALIDATION in seen

    def test_selection_scores_were_computed_on_policy_validation(self, trained, corpus):
        assert trained[1].selection_partition == POLICY_VALIDATION
        assert trained[3].selection_partition == POLICY_VALIDATION
        assert len(corpus.partition_view(POLICY_VALIDATION)) == 143

    def test_no_refit_on_the_development_union(self, trained):
        for selection in (trained[1], trained[3]):
            assert selection.weight_partition == TRAIN

    def test_iteration_budget_is_identical_for_every_candidate(self, trained):
        # Raising max_iter only for the model that looks best would be a hidden
        # advantage, so the budget is a single constant rather than a per-fit choice.
        assert MAX_ITER == 5000
        assert RANDOM_SEED == 20260104


class TestTemperature:
    def test_grid_is_the_declared_search(self):
        grid = temperature_grid()
        assert len(grid) == TEMPERATURE_GRID_POINTS == 401
        assert grid[0] == pytest.approx(TEMPERATURE_MIN)
        assert grid[-1] == pytest.approx(TEMPERATURE_MAX)
        assert np.all(np.diff(grid) > 0)

    def test_the_no_op_temperature_is_a_reachable_candidate(self):
        # A search that cannot select T = 1 cannot decline to rescale.
        assert np.isclose(temperature_grid(), 1.0, atol=1e-12).any()

    def test_fitted_temperature_is_inside_the_range_and_off_the_boundary(self, trained, corpus):
        joint = trained[0]
        design, labels = corpus.matrix(CALIBRATION)
        fit = fit_temperature(joint.tuple_logits(design), labels, class_order=corpus.class_numbers)
        assert TEMPERATURE_MIN < fit.temperature < TEMPERATURE_MAX

    def test_fitting_reads_calibration_only(self, corpus, trained):
        joint = trained[0]
        calibration_design, calibration_labels = corpus.matrix(CALIBRATION)
        first = fit_temperature(
            joint.tuple_logits(calibration_design),
            calibration_labels,
            class_order=corpus.class_numbers,
        )
        policy_design, policy_labels = corpus.matrix(POLICY_VALIDATION)
        second = fit_temperature(
            joint.tuple_logits(policy_design),
            policy_labels,
            class_order=corpus.class_numbers,
        )
        # Different inputs must give a different answer, otherwise a test asserting
        # "calibration was used" would pass even if the wrong partition were passed.
        assert first.temperature != second.temperature

    def test_a_boundary_optimum_stops_rather_than_widening_the_range(self, corpus):
        # Logits scaled far beyond any plausible confidence push the optimum to the
        # top of the range; the correct response is to fail, not to extend the grid.
        rng = np.random.default_rng(0)
        scores = rng.normal(size=(200, EXPECTED_CLASS_COUNT)) * 400.0
        labels = np.array(
            [(index % EXPECTED_CLASS_COUNT) + 1 for index in range(200)], dtype=np.int64
        )
        with pytest.raises(TemperatureBoundaryError):
            fit_temperature(scores, labels, class_order=corpus.class_numbers)

    def test_softmax_is_shift_invariant(self):
        scores = np.array([[1000.0, 1001.0, 999.0]])
        probabilities = stable_softmax(scores)
        assert np.isfinite(probabilities).all()
        assert probabilities.sum(axis=1) == pytest.approx(1.0)

    def test_applying_the_fitted_temperature_lowers_calibration_nll(self, trained, corpus):
        joint = trained[0]
        design, labels = corpus.matrix(CALIBRATION)
        scores = joint.tuple_logits(design)
        fit = fit_temperature(scores, labels, class_order=corpus.class_numbers)
        unit = negative_log_likelihood(
            apply_temperature(scores, 1.0), labels, class_order=corpus.class_numbers
        )
        scaled = negative_log_likelihood(
            apply_temperature(scores, fit.temperature),
            labels,
            class_order=corpus.class_numbers,
        )
        # Descriptive, on the partition it was fitted on. Not generalization evidence.
        assert scaled <= unit


class TestPolicyThreshold:
    def test_grid_is_the_declared_fifteen_candidates(self):
        assert len(CONFIDENCE_THRESHOLD_GRID) == 15
        assert CONFIDENCE_THRESHOLD_GRID[0] == 0.0
        assert CONFIDENCE_THRESHOLD_GRID[-1] == 0.95
        assert list(CONFIDENCE_THRESHOLD_GRID) == sorted(CONFIDENCE_THRESHOLD_GRID)

    def test_minimum_support_floor_protects_against_an_empty_accept_set(self):
        # Without the floor the search would pick a threshold accepting one easy row
        # and report zero error.
        assert minimum_accepted_support(143) == 36
        assert minimum_accepted_support(4) == MINIMUM_ACCEPTED_ABSOLUTE

    @staticmethod
    def _policy_inputs(joint, corpus):
        design, labels = corpus.matrix(POLICY_VALIDATION)
        probabilities = stable_softmax(apply_temperature(joint.tuple_logits(design), 1.0))
        confidence, _, _ = confidence_diagnostics(probabilities)
        predicted = np.array(
            [corpus.class_numbers[int(index)] for index in np.argmax(probabilities, axis=1)],
            dtype=np.int64,
        )
        return confidence, predicted, labels

    def test_every_candidate_is_scored(self, trained, corpus):
        candidates = evaluate_thresholds(*self._policy_inputs(trained[0], corpus))
        assert [candidate.threshold for candidate in candidates] == list(CONFIDENCE_THRESHOLD_GRID)

    def test_zero_threshold_accepts_everything(self, trained, corpus):
        confidence, predicted, labels = self._policy_inputs(trained[0], corpus)
        candidates = evaluate_thresholds(confidence, predicted, labels)
        assert candidates[0].threshold == 0.0
        assert candidates[0].accepted == len(labels)
        assert candidates[0].coverage == pytest.approx(1.0)

    def test_selection_reports_whether_the_fallback_ran(self, trained, corpus):
        confidence, predicted, labels = self._policy_inputs(trained[0], corpus)
        selection = select_threshold(confidence, predicted, labels)
        assert isinstance(selection.fallback_used, bool)
        assert selection.threshold in CONFIDENCE_THRESHOLD_GRID
        assert selection.accepted >= minimum_accepted_support(len(labels))
        assert selection.minimum_required == minimum_accepted_support(len(labels))

    def test_the_primary_rule_prefers_coverage_among_qualifying_candidates(self):
        # A synthetic 100-row partition engineered so two thresholds both satisfy the
        # error constraint and the support floor, leaving coverage as the only thing
        # that decides. Everything is correct above 0.80 and 96% correct above 0.30.
        confidence = np.concatenate([np.full(40, 0.90), np.full(60, 0.50), np.full(100, 0.05)])
        predicted = np.ones(200, dtype=np.int64)
        actual = np.ones(200, dtype=np.int64)
        actual[95:100] = 2  # five errors, all in the 0.50 band
        selection = select_threshold(confidence, predicted, actual)
        assert selection.fallback_used is False
        # 0.00 accepts all 200 at 2.5% error; higher coverage wins outright.
        assert selection.threshold == 0.0
        assert selection.coverage == pytest.approx(1.0)

    def test_the_fallback_runs_only_when_nothing_meets_the_error_constraint(self):
        # Every candidate is far worse than 10% selective error, so the primary rule
        # has nothing to choose from and the fallback must take over visibly.
        confidence = np.concatenate([np.full(50, 0.90), np.full(50, 0.20)])
        predicted = np.ones(100, dtype=np.int64)
        actual = np.ones(100, dtype=np.int64)
        actual[:20] = 2  # 40% error in the high-confidence band
        actual[50:80] = 2  # 60% error in the low-confidence band
        selection = select_threshold(confidence, predicted, actual)
        assert selection.fallback_used is True
        # Fallback ranks by lowest selective error first: the 0.90 band at 40%.
        assert selection.selective_error == pytest.approx(0.40)

    def test_candidates_below_the_support_floor_are_never_selected(self):
        # One perfect row at very high confidence is the candidate a search without a
        # support floor would happily pick, reporting zero error on a sample of one.
        confidence = np.concatenate([np.full(1, 0.99), np.full(99, 0.30)])
        predicted = np.ones(100, dtype=np.int64)
        actual = np.ones(100, dtype=np.int64)
        actual[50:90] = 2
        selection = select_threshold(confidence, predicted, actual)
        assert selection.accepted >= minimum_accepted_support(100)
        assert selection.threshold <= 0.30


class TestLogits:
    def test_logits_match_the_explicit_linear_form(self, trained, corpus):
        joint = trained[0]
        design, _ = corpus.matrix(TRAIN)
        computed = logits(design, joint.coefficients, joint.intercepts)
        manual = design @ joint.coefficients.T + joint.intercepts
        assert np.allclose(computed, manual, atol=0.0, rtol=0.0)


class TestTrainingClassCoverage:
    """TRAIN must cover the frozen class universe exactly, or nothing may be fitted.

    The defect these replace was a silent accommodation: a class absent from TRAIN got
    a zero coefficient row and a -1e9 intercept. That produces an artifact with the
    right 13-row shape, the right byte size, and a plausible hash — it passes every
    structural check while encoding a class the model never learned, and no reviewer
    reading the artifact could tell. Each test below removes real coverage and requires
    a refusal, so the accommodation cannot come back unnoticed.
    """

    @staticmethod
    def _drop_class(corpus, class_number: int):
        """The corpus minus every TRAIN row for one tuple class."""
        return dataclasses.replace(
            corpus,
            rows=tuple(
                row
                for row in corpus.rows
                if not (row.partition == TRAIN and row.class_number == class_number)
            ),
            ledger=AccessLedger(),
        )

    @staticmethod
    def _drop_rows_where(corpus, predicate):
        return dataclasses.replace(
            corpus,
            rows=tuple(
                row for row in corpus.rows if not (row.partition == TRAIN and predicate(row))
            ),
            ledger=AccessLedger(),
        )

    def test_current_train_covers_every_canonical_class(self, corpus):
        # The refusals below only mean something because the real corpus passes.
        _, labels = corpus.matrix(TRAIN)
        require_complete_class_coverage(
            labels, corpus.class_numbers, target_name="joint tuple class"
        )
        assert set(int(value) for value in labels) == set(range(1, EXPECTED_CLASS_COUNT + 1))

    @pytest.mark.parametrize("class_number", list(range(1, EXPECTED_CLASS_COUNT + 1)))
    def test_a_missing_joint_class_refuses_before_any_artifact(self, corpus, class_number):
        mutated = self._drop_class(corpus, class_number)
        with pytest.raises(ClassCoverageError) as error:
            train_joint(mutated)
        assert str(class_number) in str(error.value)
        assert "missing class" in str(error.value)

    def test_a_missing_joint_class_refuses_at_the_coverage_check_not_the_fit(self, corpus):
        # Refusing before fitting means a malformed corpus never produces an estimator
        # that a later stage could mistake for usable.
        mutated = self._drop_class(corpus, 7)
        _, labels = mutated.matrix(TRAIN)
        with pytest.raises(ClassCoverageError):
            require_complete_class_coverage(
                labels, mutated.class_numbers, target_name="joint tuple class"
            )

    def test_an_unexpected_joint_label_refuses(self, corpus):
        labels = np.array([*range(1, EXPECTED_CLASS_COUNT + 1), 14], dtype=np.int64)
        with pytest.raises(ClassCoverageError) as error:
            require_complete_class_coverage(
                labels, corpus.class_numbers, target_name="joint tuple class"
            )
        assert "14" in str(error.value)
        assert "outside the frozen universe" in str(error.value)

    @pytest.mark.parametrize("verb_index", list(range(EXPECTED_VERB_COUNT)))
    def test_a_missing_verb_class_refuses(self, corpus, verb_index):
        mutated = self._drop_rows_where(
            corpus, lambda row: corpus.head_targets_for_class(row.class_number)[0] == verb_index
        )
        with pytest.raises(ClassCoverageError) as error:
            train_factorized(mutated)
        assert "verb head" in str(error.value)

    @pytest.mark.parametrize("object_index", list(range(EXPECTED_OBJECT_COUNT)))
    def test_a_missing_object_class_refuses(self, corpus, object_index):
        mutated = self._drop_rows_where(
            corpus,
            lambda row: corpus.head_targets_for_class(row.class_number)[1] == object_index,
        )
        with pytest.raises(ClassCoverageError) as error:
            train_factorized(mutated)
        assert "head" in str(error.value)

    @pytest.mark.parametrize("property_index", list(range(EXPECTED_TRANSITION_PROPERTY_COUNT)))
    def test_a_missing_transition_property_class_refuses(self, corpus, property_index):
        mutated = self._drop_rows_where(
            corpus,
            lambda row: corpus.head_targets_for_class(row.class_number)[2] == property_index,
        )
        with pytest.raises(ClassCoverageError) as error:
            train_factorized(mutated)
        assert "head" in str(error.value)

    def test_an_unexpected_head_label_refuses(self, corpus):
        del corpus
        labels = np.array([*range(EXPECTED_VERB_COUNT), EXPECTED_VERB_COUNT], dtype=np.int64)
        with pytest.raises(ClassCoverageError):
            require_complete_class_coverage(
                labels, tuple(range(EXPECTED_VERB_COUNT)), target_name="factorized verb head"
            )

    def test_no_padded_coefficient_row_can_be_produced(self):
        """The sentinel intercept is gone from the code, not merely unreachable.

        Checked against the AST rather than the text, because the docstring explaining
        why the padding was wrong necessarily contains the literal ``-1e9``. A substring
        search would fail on the explanation, which would push the next person to delete
        the explanation rather than keep the guarantee.
        """
        source_path = RESEARCH_ROOT / "src" / "futurebench" / "fc008" / "models.py"
        tree = ast.parse(source_path.read_text(), filename=str(source_path))
        magnitudes = {
            abs(node.value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, float)
        }
        assert 1e9 not in magnitudes
        assert "_expand_to_frozen_classes" not in source_path.read_text()

    def test_a_mutated_corpus_produces_no_artifact_at_all(self, corpus, tmp_path):
        # End to end: an incomplete corpus must not yield a nominally complete artifact
        # set, which is the outcome the old fallback made possible.
        mutated = self._drop_class(corpus, 3)
        with pytest.raises(ClassCoverageError):
            train_joint(mutated)
        assert list(tmp_path.glob("*.json")) == []


class TestTrainerRefusesUnexpectedLabelsEndToEnd:
    """The guard must be load-bearing in the real trainers, not just unit-testable.

    ``require_complete_class_coverage`` was already tested directly, but a helper that
    rejects bad input proves nothing if a trainer can reach a fit without calling it.
    These tests mutate the corpus and call the actual entry points, so the assertion is
    about the pipeline rather than about the helper.

    Out-of-universe labels are used rather than missing ones because they are the case a
    shape check cannot catch: the label count and matrix dimensions stay valid, and only
    the label universe is violated.
    """

    @staticmethod
    def _duplicated_class(corpus) -> int:
        """A TRAIN class with more than one row.

        Needed so the mutation below can introduce an unexpected label while leaving
        every canonical class still covered — otherwise the refusal could be the missing
        class rather than the unexpected one, and the test would pass for a reason other
        than the one it claims.
        """
        counts: dict[int, int] = {}
        for row in corpus.rows:
            if row.partition == TRAIN:
                counts[row.class_number] = counts.get(row.class_number, 0) + 1
        for class_number, count in sorted(counts.items()):
            if count > 1:
                return class_number
        raise AssertionError("no TRAIN class has a spare row to mutate")

    @classmethod
    def _mutate_one_train_row(cls, corpus, **changes):
        target = cls._duplicated_class(corpus)
        mutated = []
        replaced = False
        for row in corpus.rows:
            if not replaced and row.partition == TRAIN and row.class_number == target:
                mutated.append(dataclasses.replace(row, **changes))
                replaced = True
            else:
                mutated.append(row)
        assert replaced
        return dataclasses.replace(corpus, rows=tuple(mutated), ledger=AccessLedger())

    def test_the_joint_trainer_refuses_an_out_of_universe_class(self, corpus):
        mutated = self._mutate_one_train_row(corpus, class_number=14)
        with pytest.raises(ClassCoverageError) as error:
            train_joint(mutated)
        message = str(error.value)
        assert "14" in message
        assert "outside the frozen universe" in message

    @pytest.mark.parametrize("class_number", [0, -1, 99, 14])
    def test_the_joint_trainer_refuses_any_label_off_the_frozen_grid(self, corpus, class_number):
        mutated = self._mutate_one_train_row(corpus, class_number=class_number)
        with pytest.raises(ClassCoverageError):
            train_joint(mutated)

    @pytest.mark.parametrize(
        ("field", "value", "head"),
        [
            ("verb_index", EXPECTED_VERB_COUNT, "verb"),
            ("verb_index", -1, "verb"),
            ("object_index", EXPECTED_OBJECT_COUNT, "objectKind"),
            ("object_index", -1, "objectKind"),
            ("transition_property_index", EXPECTED_TRANSITION_PROPERTY_COUNT, "transitionProperty"),
            ("transition_property_index", -1, "transitionProperty"),
        ],
    )
    def test_the_factorized_trainer_refuses_an_out_of_universe_head_label(
        self, corpus, field, value, head
    ):
        mutated = self._mutate_one_train_row(corpus, **{field: value})
        with pytest.raises(ClassCoverageError) as error:
            train_factorized(mutated)
        message = str(error.value)
        assert head in message
        assert "outside the frozen universe" in message

    def test_the_joint_refusal_happens_before_any_estimator_is_fitted(self, corpus):
        # If the refusal came after fitting, a caller catching the error would still have
        # a fitted estimator in hand, and the guard would only be advisory.
        import futurebench.fc008.models as models

        mutated = self._mutate_one_train_row(corpus, class_number=14)
        calls: list[str] = []
        original = models._fit_logistic

        def spy(*args, **kwargs):
            calls.append(kwargs.get("target_name", "unknown"))
            return original(*args, **kwargs)

        models._fit_logistic = spy
        try:
            with pytest.raises(ClassCoverageError):
                train_joint(mutated)
        finally:
            models._fit_logistic = original
        assert calls == []

    def test_neither_trainer_emits_an_artifact_from_a_bad_label(self, corpus):
        for mutation, trainer in (
            ({"class_number": 14}, train_joint),
            ({"verb_index": EXPECTED_VERB_COUNT}, train_factorized),
        ):
            mutated = self._mutate_one_train_row(corpus, **mutation)
            with pytest.raises(ClassCoverageError):
                trainer(mutated)

    def test_the_unmutated_corpus_still_trains(self, corpus):
        # The refusals above must come from the mutation, not from the fixture.
        _, outcome = train_joint(corpus)
        assert outcome.selected_c == 10.0

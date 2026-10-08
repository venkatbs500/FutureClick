"""FC-008 Sprint 4A human-readable report generator.

Renders an :class:`~.evaluation.EvaluationResult` as Markdown. DETERMINISTIC: the
same result produces the same bytes, with no wall-clock timestamp and no dictionary
iteration order leaking into the output, so a report can be diffed between runs the
same way the result artifact can be hashed between runs.

The section order is fixed and separates the primary questions from everything
else. That separation is the whole point. A reader who skims must not be able to
mistake an exploratory secondary diagnostic for a preregistered primary result, and
must not reach a headline number before reading what the holdout can support. The
limitations are therefore not an appendix: they are a required section, populated
from the result artifact rather than written by hand, so a report cannot be
generated without them.

NO REAL FINAL DATA HAS BEEN RENDERED. Sprint 4A exercises this generator on
synthetic fixtures only.
"""

from __future__ import annotations

from typing import Sequence

from .bootstrap import PairedBootstrapInterval
from .evaluation import ComparisonResult, EvaluationResult, PartitionMetrics
from .metrics import FixedRiskResult, MatchedCoverageResult


def _format_number(value: float | None, places: int = 6) -> str:
    if value is None:
        return "unavailable"
    return f"{value:.{places}f}"


def _format_interval(interval: object) -> str:
    """Render a bootstrap interval, always with its power caveat attached."""
    if not isinstance(interval, PairedBootstrapInterval):
        return "no interval"
    body = (
        f"{_format_number(interval.point_estimate)} "
        f"[{_format_number(interval.lower)}, {_format_number(interval.upper)}]"
    )
    caveat = (
        f" (LOW POWER: {interval.lineage_count} parent lineages)"
        if interval.low_powered
        else f" ({interval.lineage_count} parent lineages)"
    )
    return body + caveat


def _matched_coverage_rows(entries: Sequence[MatchedCoverageResult]) -> list[str]:
    lines = ["| target | achieved coverage | exact | selective risk |", "| --- | --- | --- | --- |"]
    for entry in entries:
        lines.append(
            f"| {entry.target:.2f} | {entry.achieved_coverage:.6f} | "
            f"{'yes' if entry.exact else 'no'} | {entry.selective_risk:.6f} |"
        )
    return lines


def _fixed_risk_rows(entries: Sequence[FixedRiskResult]) -> list[str]:
    lines = ["| risk target | available | coverage | selective risk |", "| --- | --- | --- | --- |"]
    for entry in entries:
        lines.append(
            f"| {entry.target:.2f} | {'yes' if entry.available else 'NO'} | "
            f"{_format_number(entry.coverage)} | {_format_number(entry.selective_risk)} |"
        )
    return lines


def _partition_section(metrics: PartitionMetrics) -> list[str]:
    lines = [
        f"### {metrics.partition} — {metrics.model_family} / {metrics.temperature_setting}",
        "",
        f"- records: {metrics.record_count}",
        f"- parent lineages: {metrics.parent_lineage_count}",
        f"- observed classes: {list(metrics.observed_classes)} "
        f"of 13 (absent classes still count toward fixed-13 macro F1)",
        f"- temperature: {metrics.temperature}",
        f"- structured exact match: {_format_number(metrics.structured_exact_match)}",
        f"- fixed-13 macro F1: {_format_number(metrics.macro_f1_fixed_thirteen)}",
        f"- observed-class macro F1 (SECONDARY, never substituted): "
        f"{_format_number(metrics.macro_f1_observed_classes)}",
        f"- negative log-likelihood: {_format_number(metrics.negative_log_likelihood)}",
        f"- multiclass Brier (range [0, 2]): {_format_number(metrics.multiclass_brier)}",
        f"- expected calibration error (15 equal-width bins): "
        f"{_format_number(metrics.calibration.expected_calibration_error)}",
        f"- maximum calibration error: "
        f"{_format_number(metrics.calibration.maximum_calibration_error)}",
        f"- AURC: {_format_number(metrics.risk_coverage.aurc)}",
        f"- achievable operating points: {len(metrics.risk_coverage.points)}",
        "",
        "Risk at matched coverage:",
        "",
    ]
    lines.extend(_matched_coverage_rows(metrics.matched_coverage))
    lines.extend(["", "Coverage at fixed risk:", ""])
    lines.extend(_fixed_risk_rows(metrics.fixed_risk))
    lines.append("")
    return lines


def _comparison_section(comparisons: Sequence[ComparisonResult], question: str) -> list[str]:
    selected = [entry for entry in comparisons if entry.question == question]
    if not selected:
        return [f"No {question} comparison present in this result.", ""]
    lines = [
        "| metric | direction | delta | 95% percentile interval | better when |",
        "| --- | --- | --- | --- | --- |",
    ]
    for entry in selected:
        delta = entry.delta
        lines.append(
            f"| {delta.metric} | {delta.minuend_label} minus {delta.subtrahend_label} | "
            f"{_format_number(delta.delta)} | {_format_interval(entry.interval)} | "
            f"{'higher' if delta.higher_is_better else 'lower'} |"
        )
    lines.append("")
    return lines


def render_report(result: EvaluationResult) -> str:
    """Render the full Markdown report. Deterministic for a given result."""
    lines: list[str] = [
        "# FC-008 Final Evaluation Report",
        "",
        "## Provenance",
        "",
        f"- evaluation schema version: {result.evaluation_schema_version}",
        f"- evaluation specification version: {result.evaluation_specification_version}",
        f"- preregistration version: {result.preregistration_version}",
        f"- preregistration SHA-256: {result.authorization.preregistration_sha256}",
        f"- artifact manifest SHA-256: {result.authorization.artifact_manifest_sha256}",
        f"- dataset hash: {result.dataset_hash}",
        f"- vocabulary hash: {result.vocabulary_hash}",
        f"- support matrix version: {result.support_matrix_version}",
        f"- feature policy version: {result.feature_policy_version}",
        f"- sealed corpus SHA-256: {result.sealed_corpus_sha256}",
        f"- partition record counts: {dict(result.partition_record_counts)}",
        f"- partition lineage counts: {dict(result.partition_lineage_counts)}",
        f"- authorized families: {list(result.authorization.families())}",
        f"- result SHA-256: {result.result_sha256()}",
        "",
        "## Limitations",
        "",
        "Read before any number below.",
        "",
    ]
    for limitation in result.limitations:
        lines.append(f"- {limitation}")
    lines.extend(
        [
            "",
            "## RQ1 — structured exact match, factorized versus joint",
            "",
            "Primary metrics are test-OOA structured exact match and test-OOA fixed-13 "
            "macro F1. Direction is factorized minus joint.",
            "",
        ]
    )
    lines.extend(_comparison_section(result.comparisons, "RQ1"))
    lines.extend(
        [
            "## RQ2 — calibration and selective prediction, scaled versus unscaled",
            "",
            "Evaluated separately on each partition and never combined into one primary "
            "result. Direction is scaled minus unscaled; every metric here is error-like, "
            "so a negative delta favours temperature scaling.",
            "",
        ]
    )
    lines.extend(_comparison_section(result.comparisons, "RQ2"))

    lines.extend(["## Novelty", ""])
    if result.novelty:
        lines.extend(
            [
                "Frozen deterministic support gates plus the frozen confidence threshold. "
                "Not a statistical out-of-distribution detector, and the threshold was "
                "never tuned on novelty data. Novelty rates use the novelty partition. "
                "Supported false abstention uses the frozen supported-reference "
                "partitions bound in the evaluation specification, filtered by trusted "
                "support status.",
                "",
                "| partition | novel | abstained | abstention recall | false acceptance | "
                "supported false abstention |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for partition, novelty in sorted(result.novelty.items()):
            lines.append(
                f"| {partition} | {novelty.novelty_total} | {novelty.novelty_abstained} | "
                f"{_format_number(novelty.novelty_abstention_recall)} | "
                f"{_format_number(novelty.novelty_false_acceptance_rate)} | "
                f"{_format_number(novelty.supported_false_abstention_rate)} |"
            )
        lines.append("")
    else:
        lines.extend(["No novelty partition present in this result.", ""])

    lines.extend(
        [
            "## Secondary diagnostics by partition and system",
            "",
            "Per-partition, per-system detail. Secondary context, not primary results.",
            "",
        ]
    )
    for metrics in sorted(
        result.partitions,
        key=lambda entry: (entry.partition, entry.model_family, entry.temperature_setting),
    ):
        lines.extend(_partition_section(metrics))

    lines.extend(
        [
            "## No performance-dependent conclusion",
            "",
            "No model family winner is selected from these results, and nothing was "
            "retuned after seeing them. A factorized model that performs worse than the "
            "joint model, a temperature that fails to improve calibration, weak "
            "out-of-application accuracy, wide bootstrap intervals, and poor novelty "
            "behaviour are all reportable scientific outcomes.",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


__all__ = ["render_report"]

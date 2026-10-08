"""FC-008 final-evaluation command. THE ONLY ENTRY POINT TO THE SEALED PARTITIONS.

Invoked deliberately and never otherwise:

    python -m futurebench.fc008.final_evaluation \\
        --mode final-evaluation \\
        --partition test-ooa \\
        --acknowledge-one-shot-holdout \\
        --enable-real-sealed-opening \\
        --output research/futurebench/results/fc008-final-evaluation.json

FIVE REASONS THIS CANNOT FIRE BY ACCIDENT

1. It is a ``__main__`` module. Importing it runs nothing.
2. ``--mode`` has NO DEFAULT and must equal ``final-evaluation`` verbatim.
3. ``--acknowledge-one-shot-holdout`` must be passed explicitly.
4. ``--enable-real-sealed-opening`` must be passed explicitly. That flag is a
   runtime control, not a source edit. Ordinary ``pytest``, ``build``, and
   ``quality`` runs do not pass it.
5. Authorization covers BOTH model families before a ``RealOpeningPermit`` can
   be issued. The production source then derives rows from the frozen
   FutureBench generator. A physical ``fc008-final-test-corpus.json`` is never
   trusted.

Tests in this session never pass the enable flag together with the
authoritative builder, so the real final partitions remain unopened.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from .evaluation import (
    SEALED_PARTITIONS,
    FinalEvaluationNotAuthorized,
    SealedCorpusUnavailable,
    authorize_all_families,
    evaluation_specification_canonical,
)
from .final_scoring import (
    ArtifactIdentityMismatch,
    HoldoutOpenedError,
    OutputPathRefused,
    ScoringInputError,
    evaluate_final_validated_corpus,
    load_authorized_production_artifacts,
    preflight_final_output_path,
    write_evaluation_result_atomically,
)
from .report import render_report
from .sealed import (
    ProductionTrustedSealedSource,
    SealedOpeningNotEnabled,
    authorize_real_opening,
    construct_validated_sealed_corpus,
)
from .unlock import (
    FINAL_EVALUATION_MODE,
    REGISTERED_FAMILIES,
    ArtifactContext,
    FinalEvaluationLocked,
    FrozenIdentityUnavailable,
    load_trusted_research_identity,
)

ACKNOWLEDGEMENT_FLAG = "--acknowledge-one-shot-holdout"
ENABLE_REAL_OPENING_FLAG = "--enable-real-sealed-opening"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="futurebench.fc008.final_evaluation",
        description=(
            "Open the FC-008 sealed final-test partitions and produce the preregistered "
            "evaluation. One-shot: the holdout is consumed by running this."
        ),
    )
    parser.add_argument(
        "--mode",
        required=True,
        help=f"must be exactly {FINAL_EVALUATION_MODE!r}",
    )
    parser.add_argument(
        "--partition",
        required=True,
        choices=list(SEALED_PARTITIONS),
        help="which sealed partition heading the result should emphasise",
    )
    parser.add_argument(
        ACKNOWLEDGEMENT_FLAG,
        action="store_true",
        help="explicit acknowledgement that this consumes a one-shot holdout",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="where to write the canonical result artifact",
    )
    parser.add_argument(
        ENABLE_REAL_OPENING_FLAG,
        action="store_true",
        help="explicit runtime enablement of production sealed opening; required, no source edit",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="optional deterministic Markdown report derived from the same result",
    )
    return parser


def _artifact_contexts() -> dict[str, ArtifactContext]:
    frozen, _manifest_sha256 = load_trusted_research_identity()
    contexts: dict[str, ArtifactContext] = {}
    for family in REGISTERED_FAMILIES:
        identity = frozen.family(family)
        contexts[family] = ArtifactContext(
            model_family=family,
            model_artifact_sha256=identity.model_artifact_sha256,
            calibration_artifact_sha256=identity.calibration_artifact_sha256,
            policy_artifact_sha256=identity.policy_artifact_sha256,
            model_version=identity.model_version,
            calibration_artifact_version=identity.calibration_artifact_version,
            abstention_policy_version=identity.abstention_policy_version,
            dataset_hash=frozen.dataset_hash,
            vocabulary_hash=frozen.vocabulary_hash,
            support_matrix_version=frozen.support_matrix_version,
            feature_policy_version=frozen.feature_policy_version,
            preregistration_sha256=frozen.preregistration_sha256,
        )
    return contexts


def main(argv: Sequence[str] | None = None) -> int:
    """Run the final evaluation. Returns a process exit code."""
    arguments = build_parser().parse_args(list(argv) if argv is not None else None)

    if arguments.mode != FINAL_EVALUATION_MODE:
        print(
            f"refused: --mode must be exactly {FINAL_EVALUATION_MODE!r}, got {arguments.mode!r}",
            file=sys.stderr,
        )
        return 2
    if not getattr(arguments, "acknowledge_one_shot_holdout", False):
        print(
            f"refused: {ACKNOWLEDGEMENT_FLAG} is required. Opening a sealed partition "
            "consumes a one-shot holdout and cannot be undone.",
            file=sys.stderr,
        )
        return 2

    specification = evaluation_specification_canonical()
    if specification["evaluationSpecificationVersion"] != "1.0":
        print("refused: unexpected evaluation specification version", file=sys.stderr)
        return 3

    output_path = None
    if bool(arguments.enable_real_sealed_opening):
        if arguments.output is None:
            print(
                "refused: --output is required when --enable-real-sealed-opening is set. "
                "Real holdout opening cannot proceed merely to print a SHA.",
                file=sys.stderr,
            )
            return 2
        try:
            output_path = preflight_final_output_path(Path(arguments.output))
            if arguments.report is not None:
                preflight_final_output_path(Path(arguments.report))
        except OutputPathRefused as error:
            print(f"refused: {error}", file=sys.stderr)
            return 2

    try:
        authorization = authorize_all_families(mode=arguments.mode, contexts=_artifact_contexts())
        permit = authorize_real_opening(
            mode=arguments.mode,
            acknowledge_one_shot_holdout=bool(arguments.acknowledge_one_shot_holdout),
            enable_real_sealed_opening=bool(arguments.enable_real_sealed_opening),
            authorization=authorization,
        )
    except (
        FinalEvaluationLocked,
        FinalEvaluationNotAuthorized,
        FrozenIdentityUnavailable,
        SealedOpeningNotEnabled,
        SealedCorpusUnavailable,
    ) as error:
        print(f"refused: {error}", file=sys.stderr)
        return 4 if not isinstance(error, SealedOpeningNotEnabled) else 5

    try:
        corpus = construct_validated_sealed_corpus(
            authorization=authorization,
            source=ProductionTrustedSealedSource(permit=permit),
        )
    except (SealedCorpusUnavailable, SealedOpeningNotEnabled) as error:
        print(f"sealed corpus unavailable: {error}", file=sys.stderr)
        return 5

    if output_path is None:
        print("refused: production scoring requires a preflighted --output path", file=sys.stderr)
        return 2

    try:
        artifacts = load_authorized_production_artifacts(authorization)
        result = evaluate_final_validated_corpus(
            authorization=authorization,
            corpus=corpus,
            artifacts=artifacts,
        )
        digest = write_evaluation_result_atomically(result, output_path)
        if arguments.report is not None:
            report_path = preflight_final_output_path(Path(arguments.report))
            report_path.write_text(render_report(result), encoding="utf-8")
    except (
        ArtifactIdentityMismatch,
        HoldoutOpenedError,
        ScoringInputError,
        OSError,
        TypeError,
        ValueError,
    ) as error:
        print(
            "holdout was opened; scoring or result persistence failed. "
            "Do not rerun automatically and do not retune. "
            f"{error}",
            file=sys.stderr,
        )
        return 6

    print(
        f"authorized {list(authorization.families())} and wrote canonical result "
        f"{digest} for corpus {result.sealed_corpus_sha256} covering {corpus.partitions()}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - deliberate manual entry point
    raise SystemExit(main())

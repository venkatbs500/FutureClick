"""Sprint-3 reference training entry point.

Order of operations is deliberate and is the methodology:

1. force single-thread BEFORE NumPy loads, so determinism is not left to the shell;
2. load the development export, which structurally cannot contain sealed partitions;
3. fit weights on TRAIN at each candidate C;
4. select C on POLICY-VALIDATION;
5. fit temperature on CALIBRATION, weights frozen;
6. select the acceptance threshold on POLICY-VALIDATION;
7. write artifacts and golden vectors;
8. freeze the preregistration LAST, once every specification above is fixed.

The preregistration is written last because it has to describe the thing that was
actually built. Writing it first would either be aspirational or would have to be
quietly edited afterwards, and a preregistration that gets edited is not one.

Run with ``--run-id`` to write into a scratch directory; the determinism check uses
two separate processes writing to two directories and compares bytes.
"""

from __future__ import annotations

# Thread pinning must happen before NumPy is imported anywhere in the process.
from .environment import force_single_thread

force_single_thread()

import argparse  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

from .artifacts import (  # noqa: E402
    build_artifact_manifest,
    build_calibration_artifact,
    build_factorized_model_artifact,
    build_joint_model_artifact,
    build_policy_artifact,
    build_training_configuration,
    write_artifact,
)
from .calibration import (  # noqa: E402
    apply_temperature,
    confidence_diagnostics,
    fit_temperature,
    stable_softmax,
)
from .canonical import canonical_bytes, sha256_hex  # noqa: E402
from .corpus import (  # noqa: E402
    CALIBRATION,
    POLICY_VALIDATION,
    load_development_corpus,
)
from .environment import (  # noqa: E402
    THREAD_ENVIRONMENT_VARIABLES,
    capture_reference_environment,
    verify_single_thread,
)
from .golden import build_golden_vectors  # noqa: E402
from .models import (  # noqa: E402
    FACTORIZED_FAMILY,
    JOINT_FAMILY,
    train_factorized,
    train_joint,
    train_metrics,
)
from .policy import select_threshold  # noqa: E402
from .preregistration import (  # noqa: E402
    PREREGISTRATION_HISTORY,
    PREREGISTRATION_HISTORY_DIRECTORY,
    build_preregistration,
    preregistration_sha256,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
DEFAULT_EXPORT = (
    REPOSITORY_ROOT / "research" / "futurebench" / "data" / "fc008-development-corpus.json"
)
DEFAULT_OUTPUT = REPOSITORY_ROOT / "research" / "futurebench" / "artifacts"


def _materialize_audit_history(output_dir: Path) -> tuple[dict[str, Any], ...]:
    """Verify the retained superseded preregistrations and place them beside the output.

    Reads from the canonical history directory and copies into ``output_dir`` so that a
    rebuild into a scratch directory is self-contained and comparable byte for byte.
    The copy is only a copy: these bytes are never regenerated, because regenerating a
    superseded document from current source would defeat the point of retaining it.

    Fails closed if a retained file is missing or no longer hashes to its declared
    value. A history entry whose bytes cannot be reproduced is worse than no entry: it
    records a freeze hash that an auditor cannot check.
    """
    source_dir = DEFAULT_OUTPUT / PREREGISTRATION_HISTORY_DIRECTORY
    records: list[dict[str, Any]] = []
    for record in PREREGISTRATION_HISTORY:
        file_name = str(record["fileName"])
        path = source_dir / file_name
        if not path.is_file():
            raise FileNotFoundError(
                f"retained preregistration {file_name} is missing from {source_dir}; the "
                f"historical freeze hash {record['sha256']} could not be verified"
            )
        raw = path.read_bytes()
        actual = sha256_hex(raw)
        if actual != record["sha256"]:
            raise ValueError(
                f"retained preregistration {file_name} hashes to {actual}, but the "
                f"declared historical identity is {record['sha256']}"
            )
        destination = output_dir / PREREGISTRATION_HISTORY_DIRECTORY / file_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.resolve() != path.resolve():
            destination.write_bytes(raw)
        records.append({**record, "byteLength": len(raw)})
    return tuple(records)


def _predicted_classes(scores: Any, class_order: tuple[int, ...]) -> Any:
    import numpy as np

    return np.array(
        [class_order[int(index)] for index in np.argmax(scores, axis=1)], dtype=np.int64
    )


def run(export_path: Path, output_dir: Path) -> dict[str, Any]:
    pools = verify_single_thread()
    environment = capture_reference_environment()
    corpus = load_development_corpus(export_path)
    class_order = corpus.class_numbers

    joint, joint_selection = train_joint(corpus)
    factorized, factorized_selection = train_factorized(corpus)

    joint_train = train_metrics(joint, corpus)
    factorized_train = train_metrics(factorized, corpus)

    calibration_design, calibration_labels = corpus.matrix(CALIBRATION)
    policy_design, policy_labels = corpus.matrix(POLICY_VALIDATION)

    results: dict[str, Any] = {}
    written = []

    for family, model, selection in (
        (JOINT_FAMILY, joint, joint_selection),
        (FACTORIZED_FAMILY, factorized, factorized_selection),
    ):
        if family == JOINT_FAMILY:
            document = build_joint_model_artifact(corpus, joint, joint_selection, environment)
        else:
            document = build_factorized_model_artifact(
                corpus, factorized, factorized_selection, environment
            )
        model_artifact = write_artifact(
            output_dir / f"fc008-{family}-model.json", document, f"{family}-model"
        )

        fit = fit_temperature(
            model.tuple_logits(calibration_design), calibration_labels, class_order
        )
        calibration_artifact = write_artifact(
            output_dir / f"fc008-{family}-calibration.json",
            build_calibration_artifact(
                corpus,
                model_family=family,
                model_artifact_sha256=model_artifact.sha256,
                fit=fit,
                calibration_record_count=int(calibration_labels.shape[0]),
            ),
            f"{family}-calibration",
        )

        scaled = apply_temperature(model.tuple_logits(policy_design), fit.temperature)
        probabilities = stable_softmax(scaled)
        confidence, _margin, _entropy = confidence_diagnostics(probabilities)
        selection_outcome = select_threshold(
            confidence, _predicted_classes(probabilities, class_order), policy_labels
        )
        policy_artifact = write_artifact(
            output_dir / f"fc008-{family}-policy.json",
            build_policy_artifact(
                corpus,
                model_family=family,
                model_artifact_sha256=model_artifact.sha256,
                calibration_artifact_sha256=calibration_artifact.sha256,
                selection=selection_outcome,
            ),
            f"{family}-policy",
        )

        written.extend([model_artifact, calibration_artifact, policy_artifact])
        results[family] = {
            "selectedC": selection.selected_c,
            "tieBreakUsed": selection.tie_break_used,
            "temperature": fit.temperature,
            "calibrationNllUnitTemperature": fit.nll_at_unit_temperature,
            "calibrationNllScaled": fit.nll_at_selected_temperature,
            "temperatureTieBreak": fit.tie_break_used,
            "threshold": selection_outcome.threshold,
            "coverage": selection_outcome.coverage,
            "selectiveError": selection_outcome.selective_error,
            "accepted": selection_outcome.accepted,
            "minimumRequired": selection_outcome.minimum_required,
            "fallbackUsed": selection_outcome.fallback_used,
            "modelSha256": model_artifact.sha256,
            "modelBytes": model_artifact.byte_length,
            "calibrationSha256": calibration_artifact.sha256,
            "calibrationBytes": calibration_artifact.byte_length,
            "policySha256": policy_artifact.sha256,
            "policyBytes": policy_artifact.byte_length,
            "candidates": [
                {
                    "c": candidate.c_value,
                    "structuredExactMatch": candidate.structured_exact_match,
                    "fixedThirteenMacroF1": candidate.fixed_thirteen_macro_f1,
                }
                for candidate in selection.candidates
            ],
        }

    golden = build_golden_vectors(
        corpus,
        joint,
        results[JOINT_FAMILY]["temperature"],
        factorized,
        results[FACTORIZED_FAMILY]["temperature"],
    )
    written.append(
        write_artifact(output_dir / "fc008-golden-vectors.json", golden, "golden-vectors")
    )

    written.append(
        write_artifact(
            output_dir / "fc008-training-configuration.json",
            build_training_configuration(
                corpus,
                environment,
                joint_selection,
                factorized_selection,
                joint_train,
                factorized_train,
            ),
            "training-configuration",
        )
    )

    access_report = {
        "schemaVersion": "1.0",
        "datasetHash": corpus.dataset_hash,
        "developmentExportSha256": corpus.source_sha256,
        **corpus.ledger.to_canonical(),
        "threadPools": sorted(
            (
                {
                    "internalApi": str(pool.get("internal_api")),
                    "numThreads": int(pool.get("num_threads", 1)),
                    "userApi": str(pool.get("user_api")),
                }
                for pool in pools
            ),
            key=lambda item: str(item["internalApi"]),
        ),
        # The threading claim, scoped to what is actually observable. threadpoolctl
        # does not enumerate Accelerate, so reporting "all pools at one thread" without
        # this note would read as confirmation of something never measured.
        "threadControl": {
            "mechanism": (
                "environment variables assigned before NumPy is imported; no "
                "threadpool_limits context manager is used anywhere in this package"
            ),
            "environmentVariables": sorted(THREAD_ENVIRONMENT_VARIABLES),
            "observedVia": "threadpoolctl.threadpool_info()",
            "independentlyConfirmed": sorted({str(pool.get("internal_api")) for pool in pools}),
            "configuredButNotIndependentlyConfirmed": [
                "accelerate (BLAS/LAPACK backend) is constrained by "
                "VECLIB_MAXIMUM_THREADS=1; threadpoolctl does not enumerate Accelerate, "
                "so its thread count is not read back"
            ],
            "indirectEvidence": (
                "the byte-identical two-process rebuild would fail if the BLAS were "
                "reducing sums concurrently"
            ),
        },
    }
    written.append(
        write_artifact(
            output_dir / "fc008-development-access-report.json",
            access_report,
            "development-access-report",
        )
    )

    # Preregistration is frozen LAST, once every specification above is fixed.
    prereg = build_preregistration(
        dataset_hash=corpus.dataset_hash,
        vocabulary_hash=corpus.vocabulary_hash,
        manifest_hash=corpus.manifest_hash,
        support_matrix_version=corpus.support_matrix_version,
        feature_policy_version=corpus.feature_policy_version,
        class_order=list(class_order),
        verb_order=list(corpus.verb_order),
        object_order=list(corpus.object_order),
        transition_property_order=list(corpus.transition_property_order),
        joint={
            "family": JOINT_FAMILY,
            "selectedC": results[JOINT_FAMILY]["selectedC"],
            "shape": {"coefficients": [13, 370], "intercepts": [13]},
            "target": "13 supported semantic tuples",
            "temperature": results[JOINT_FAMILY]["temperature"],
            "confidenceThreshold": results[JOINT_FAMILY]["threshold"],
        },
        factorized={
            "family": FACTORIZED_FAMILY,
            "selectedSharedC": results[FACTORIZED_FAMILY]["selectedC"],
            "shapes": {
                "objectKind": [9, 370],
                "transitionProperty": [10, 370],
                "verb": [10, 370],
            },
            "target": "verb 10, objectKind 9, transitionProperty 10",
            "temperature": results[FACTORIZED_FAMILY]["temperature"],
            "confidenceThreshold": results[FACTORIZED_FAMILY]["threshold"],
        },
    )
    prereg_sha = preregistration_sha256(prereg)
    written.append(
        write_artifact(output_dir / "fc008-preregistration.json", prereg, "preregistration")
    )

    audit_history = _materialize_audit_history(output_dir)
    manifest = build_artifact_manifest(corpus, environment, written, prereg_sha, audit_history)
    manifest_bytes = canonical_bytes(manifest)
    manifest_path = output_dir / "fc008-artifact-manifest.json"
    manifest_path.write_bytes(manifest_bytes)

    return {
        "environment": environment.to_canonical(),
        "families": results,
        "goldenVectorCount": golden["vectorCount"],
        "goldenClassesCovered": golden["classesCovered"],
        "preregistrationSha256": prereg_sha,
        "artifactManifestSha256": sha256_hex(manifest_bytes),
        "artifactManifestBytes": len(manifest_bytes),
        "artifacts": [
            {"name": a.name, "sha256": a.sha256, "bytes": a.byte_length} for a in written
        ],
        "accessReport": access_report,
        "trainMetrics": {JOINT_FAMILY: joint_train, FACTORIZED_FAMILY: factorized_train},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="FC-008 Sprint 3 reference training")
    parser.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    summary = run(arguments.export, arguments.output)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

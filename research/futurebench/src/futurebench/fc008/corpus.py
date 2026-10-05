"""Loading the development export, and the guard that keeps the test sets sealed.

THE GUARD IS THE POINT OF THIS MODULE

Every function that touches labels takes its rows through :func:`partition_view`,
which raises on a sealed partition. That makes "the model never saw test data" a
property of the only available accessor rather than a claim about reviewer diligence.

The guard counts accesses as a side effect, so the access report is a record of what
the pipeline actually read rather than a restatement of what it intended to read. If
weight fitting ever touched calibration rows, the report would say so.

Scope of the claim: this is RESEARCH-PIPELINE ACCESS ISOLATION. The sealed records
exist on the same filesystem and nothing here prevents a different program from
reading them. What it prevents is this pipeline reading them by accident.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

TRAIN = "train"
CALIBRATION = "calibration"
POLICY_VALIDATION = "policy-validation"

DEVELOPMENT_PARTITIONS: tuple[str, ...] = (TRAIN, CALIBRATION, POLICY_VALIDATION)
SEALED_PARTITIONS: tuple[str, ...] = ("test-id", "test-ooa", "test-novelty")

EXPECTED_FEATURE_COUNT = 370
EXPECTED_CLASS_COUNT = 13
EXPECTED_VERB_COUNT = 10
EXPECTED_OBJECT_COUNT = 9
EXPECTED_TRANSITION_PROPERTY_COUNT = 10


class SealedPartitionError(RuntimeError):
    """Raised when the model-development path requests a sealed partition.

    A distinct exception type so tests can assert the pipeline failed for THIS
    reason. Asserting that some error occurred would also pass if the guard were
    removed and the code failed later for an unrelated reason.
    """


@dataclass(frozen=True)
class DevelopmentRow:
    record_id: str
    parent_lineage_id: str
    partition: str
    feature_indices: tuple[int, ...]
    feature_values: tuple[float, ...]
    class_number: int
    verb_index: int
    object_index: int
    transition_property_index: int


@dataclass
class AccessLedger:
    """Records what the model-development path actually read, by partition.

    Tracks DISTINCT ROWS and ACCESS EVENTS separately, because they answer different
    questions and conflating them is misleading in both directions. Distinct rows
    answers "how much of the corpus did the model see" — 143 per development
    partition. Access events answers "how many whole-partition reads happened", which
    is higher. Reporting only the event count would look like the pipeline had read 858
    training rows that do not exist; reporting only distinct rows would hide that the
    partition is read by several independent stages.

    The repeated reads are NOT per candidate C. Each training function builds its
    design matrix once, before the C loop, and the loop reuses it. The events come from
    independent pipeline stages, each of which takes its own guarded view, and from the
    two model families each taking their own. See ``to_canonical`` for the exact
    per-stage attribution, which was measured by instrumenting ``partition_view``
    rather than reasoned about.

    For the sealed partitions both numbers must be zero, and they are counted the same
    way rather than asserted, so the zero is a measurement.
    """

    events: dict[str, int] = field(default_factory=dict)
    distinct: dict[str, set[str]] = field(default_factory=dict)

    def record(self, partition: str, record_ids: tuple[str, ...]) -> None:
        self.events[partition] = self.events.get(partition, 0) + len(record_ids)
        self.distinct.setdefault(partition, set()).update(record_ids)

    def _entry(self, name: str) -> dict[str, Any]:
        return {
            "partition": name,
            "distinctRows": len(self.distinct.get(name, set())),
            "accessEvents": self.events.get(name, 0),
        }

    def to_canonical(self) -> dict[str, Any]:
        return {
            "developmentRowsAccessed": [self._entry(name) for name in DEVELOPMENT_PARTITIONS],
            "sealedRowsAccessed": [self._entry(name) for name in SEALED_PARTITIONS],
            "sealedTotalRowsAccessed": sum(
                len(self.distinct.get(name, set())) for name in SEALED_PARTITIONS
            ),
            "sealedTotalAccessEvents": sum(self.events.get(name, 0) for name in SEALED_PARTITIONS),
            "accessEventNote": (
                "distinct rows is how much of the corpus the model saw; access events "
                "counts whole-partition reads, which is higher because several "
                "independent pipeline stages each take their own guarded view. Design "
                "matrices are built once per stage, BEFORE the C loop, so the repeated "
                "reads are not per candidate C"
            ),
            # Attribution measured by instrumenting partition_view, not inferred. Each
            # entry is one whole-partition read of 143 rows, which is why every event
            # count is an exact multiple of 143 while distinct rows stays at 143.
            "accessEventAttribution": {
                TRAIN: [
                    "golden.select_golden_rows: candidate golden-vector rows",
                    "models.train_joint: joint design matrix",
                    "models.train_factorized: factorized design matrix",
                    "models.train_factorized: factorized head labels",
                    "models.train_metrics: train metrics, once per model family (2 reads)",
                ],
                CALIBRATION: [
                    "golden.select_golden_rows: candidate golden-vector rows",
                    "train.run: calibration logits for temperature fitting",
                ],
                POLICY_VALIDATION: [
                    "golden.select_golden_rows: candidate golden-vector rows",
                    "models.train_joint: joint C selection",
                    "models.train_factorized: factorized C selection",
                    "train.run: acceptance-threshold selection",
                ],
            },
            "isolationClaim": (
                "research-pipeline access isolation; not a filesystem secrecy claim"
            ),
        }


@dataclass(frozen=True)
class DevelopmentCorpus:
    """The development export, with its frozen orders and provenance."""

    dataset_hash: str
    vocabulary_hash: str
    manifest_hash: str
    feature_policy_version: str
    support_matrix_version: str
    projector_version: str
    vocabulary_version: str
    feature_order: tuple[str, ...]
    class_order: tuple[dict[str, Any], ...]
    verb_order: tuple[str, ...]
    object_order: tuple[str, ...]
    transition_property_order: tuple[str, ...]
    rows: tuple[DevelopmentRow, ...]
    source_sha256: str
    ledger: AccessLedger

    @property
    def class_numbers(self) -> tuple[int, ...]:
        """Canonical external class order, 1..13.

        Taken from the support matrix export, never from a sorted set of observed
        labels. scikit-learn orders ``classes_`` lexically by default, and relying on
        that would silently reorder the rows of every coefficient matrix the moment a
        class went missing from a partition.
        """
        return tuple(int(entry["classNumber"]) for entry in self.class_order)

    def head_targets_for_class(self, class_number: int) -> tuple[int, int, int]:
        for entry in self.class_order:
            if int(entry["classNumber"]) == class_number:
                return (
                    int(entry["verbIndex"]),
                    int(entry["objectIndex"]),
                    int(entry["transitionPropertyIndex"]),
                )
        raise KeyError(f"class {class_number} is not in the frozen class order")

    def partition_view(self, partition: str) -> tuple[DevelopmentRow, ...]:
        """Return the rows of one partition, refusing the sealed ones.

        The single accessor for labelled rows. Refuses before looking at the data, so
        the error does not depend on whether sealed rows happen to be present.
        """
        if partition in SEALED_PARTITIONS:
            raise SealedPartitionError(
                f"partition {partition!r} is sealed for Sprint 3 and must not reach "
                "weight fitting, hyperparameter selection, temperature fitting, or "
                "policy selection"
            )
        if partition not in DEVELOPMENT_PARTITIONS:
            raise KeyError(f"unknown partition {partition!r}")
        selected = tuple(row for row in self.rows if row.partition == partition)
        self.ledger.record(partition, tuple(row.record_id for row in selected))
        return selected

    def matrix(self, partition: str) -> tuple[NDArray[np.float64], NDArray[np.int64]]:
        """Dense float64 design matrix and class-number vector for one partition.

        Dense because the corpus is 143 rows by 370 features. A sparse representation
        would save nothing worth having here and would make the artifact-to-parity
        path harder to mirror exactly in TypeScript.

        No standardization or normalization. The frozen feature policy produces
        indicator and bucketed-count features that are already on a common scale, and
        introducing a scaler now would be a learned feature transform the policy does
        not describe.
        """
        import numpy as np

        rows = self.partition_view(partition)
        design = np.zeros((len(rows), EXPECTED_FEATURE_COUNT), dtype=np.float64)
        labels = np.zeros(len(rows), dtype=np.int64)
        for position, row in enumerate(rows):
            for index, value in zip(row.feature_indices, row.feature_values, strict=True):
                design[position, index] = value
            labels[position] = row.class_number
        return design, labels

    def head_labels(self, partition: str) -> tuple[NDArray[np.int64], ...]:
        """Verb, object, and transition-property targets for one partition."""
        import numpy as np

        rows = self.partition_view(partition)
        verbs = np.array([row.verb_index for row in rows], dtype=np.int64)
        objects = np.array([row.object_index for row in rows], dtype=np.int64)
        properties = np.array([row.transition_property_index for row in rows], dtype=np.int64)
        return (verbs, objects, properties)

    def parent_lineages(self, partition: str) -> tuple[str, ...]:
        return tuple(row.parent_lineage_id for row in self.partition_view(partition))


def load_development_corpus(path: Path) -> DevelopmentCorpus:
    """Read and validate the development export.

    Validates the frozen shapes on load so a drifted export fails here rather than
    producing a model with a quietly different feature space.
    """
    from .canonical import sha256_hex

    payload = path.read_bytes()
    document: dict[str, Any] = json.loads(payload)

    present = {str(row["partition"]) for row in document["rows"]}
    intruders = sorted(present & set(SEALED_PARTITIONS))
    if intruders:
        raise SealedPartitionError(
            f"development export contains sealed partitions: {', '.join(intruders)}"
        )
    unknown = sorted(present - set(DEVELOPMENT_PARTITIONS))
    if unknown:
        raise ValueError(f"development export contains unknown partitions: {unknown}")

    feature_order = tuple(str(name) for name in document["featureOrder"])
    if len(feature_order) != EXPECTED_FEATURE_COUNT:
        raise ValueError(f"expected {EXPECTED_FEATURE_COUNT} features, found {len(feature_order)}")
    class_order = tuple(dict(entry) for entry in document["classOrder"])
    if len(class_order) != EXPECTED_CLASS_COUNT:
        raise ValueError(f"expected {EXPECTED_CLASS_COUNT} classes, found {len(class_order)}")
    if [int(entry["classNumber"]) for entry in class_order] != list(
        range(1, EXPECTED_CLASS_COUNT + 1)
    ):
        raise ValueError("class order must be exactly 1..13 in support-matrix order")

    verb_order = tuple(str(name) for name in document["verbOrder"])
    object_order = tuple(str(name) for name in document["objectOrder"])
    property_order = tuple(str(name) for name in document["transitionPropertyOrder"])
    for label, order, expected in (
        ("verb", verb_order, EXPECTED_VERB_COUNT),
        ("object", object_order, EXPECTED_OBJECT_COUNT),
        ("transitionProperty", property_order, EXPECTED_TRANSITION_PROPERTY_COUNT),
    ):
        if len(order) != expected:
            raise ValueError(f"expected {expected} {label} classes, found {len(order)}")

    rows = tuple(
        DevelopmentRow(
            record_id=str(row["recordId"]),
            parent_lineage_id=str(row["parentLineageId"]),
            partition=str(row["partition"]),
            feature_indices=tuple(int(index) for index in row["featureIndices"]),
            feature_values=tuple(float(value) for value in row["featureValues"]),
            class_number=int(row["classNumber"]),
            verb_index=int(row["verbIndex"]),
            object_index=int(row["objectIndex"]),
            transition_property_index=int(row["transitionPropertyIndex"]),
        )
        for row in document["rows"]
    )

    return DevelopmentCorpus(
        dataset_hash=str(document["datasetHash"]),
        vocabulary_hash=str(document["vocabularyHash"]),
        manifest_hash=str(document["manifestHash"]),
        feature_policy_version=str(document["featurePolicyVersion"]),
        support_matrix_version=str(document["supportMatrixVersion"]),
        projector_version=str(document["projectorVersion"]),
        vocabulary_version=str(document["vocabularyVersion"]),
        feature_order=feature_order,
        class_order=class_order,
        verb_order=verb_order,
        object_order=object_order,
        transition_property_order=property_order,
        rows=rows,
        source_sha256=sha256_hex(payload),
        ledger=AccessLedger(),
    )

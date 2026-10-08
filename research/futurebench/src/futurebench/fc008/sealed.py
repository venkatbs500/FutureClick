"""FC-008 Sprint 4B-PreOpen sealed-corpus integrity plumbing.

THIS MODULE'S TESTS NEVER OPEN THE REAL FINAL PARTITIONS.

Real opening is a reviewed runtime contract, not a source edit. The one-shot
command creates a ``RealOpeningPermit`` only after mode, acknowledgement, the
explicit enable flag, and dual-family authorization all succeed. The production
source then derives rows from the frozen FutureBench generator. Tests inject a
fake builder and never invoke that generator.

A physical ``fc008-final-test-corpus.json`` is never trusted. Callers cannot
supply records, labels, feature vectors, lineage ids, expected hashes, or
expected membership lists. Validation is dataset integrity only.
"""

from __future__ import annotations

import inspect
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Protocol

from .canonical import canonical_sha256
from .unlock import FINAL_EVALUATION_MODE, REGISTERED_FAMILIES

SEALED_CORPUS_SCHEMA_VERSION = "1.0"
FEATURE_DIMENSION = 370
SUPPORTED_CLASS_MIN = 1
SUPPORTED_CLASS_MAX = 13

#: Duplicated here so this module does not import ``evaluation`` (which imports
#: this module). A test asserts the two tuples stay identical.
SEALED_PARTITIONS: tuple[str, ...] = ("test-id", "test-ooa", "test-novelty")
FIXTURE_PARTITIONS: tuple[str, ...] = (
    "fixture-id",
    "fixture-ooa",
    "fixture-novelty",
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
CANONICAL_SEALED_EXPORT_PATH = (
    _REPOSITORY_ROOT / "research" / "futurebench" / "data" / "fc008-final-test-corpus.json"
)

FROZEN_DATASET_HASH = "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa"
FROZEN_VOCABULARY_HASH = "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64"
FROZEN_SPRINT2_MANIFEST_HASH = "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77"
FROZEN_SUPPORT_MATRIX_VERSION = "1.0"
FROZEN_FEATURE_POLICY_VERSION = "1.0"
FROZEN_SEALED_PARTITION_COUNTS: Mapping[str, int] = MappingProxyType(
    {
        "test-id": 143,
        "test-ooa": 66,
        "test-novelty": 28,
    }
)

DEVELOPMENT_PARTITIONS: tuple[str, ...] = ("train", "calibration", "policy-validation")

#: Frozen factorized heads from the support matrix / development classOrder.
#: Used only as the production authority for supported classes 1..13. Not a
#: sealed-row membership list.
FROZEN_CLASS_HEADS: Mapping[int, tuple[int, int, int]] = MappingProxyType(
    {
        1: (0, 0, 0),
        2: (0, 1, 0),
        3: (1, 0, 1),
        4: (1, 1, 1),
        5: (2, 0, 2),
        6: (3, 0, 3),
        7: (3, 2, 3),
        8: (4, 3, 4),
        9: (5, 4, 5),
        10: (6, 5, 6),
        11: (7, 6, 7),
        12: (8, 7, 8),
        13: (9, 8, 9),
    }
)

PRODUCTION_DERIVATION_SCRIPT = (
    _REPOSITORY_ROOT
    / "packages"
    / "futurebench-dataset"
    / "scripts"
    / "derive-sealed-partitions.ts"
)

_PRODUCTION_BUILDER_INVOCATIONS = 0

FIXTURE_ID, FIXTURE_OOA, FIXTURE_NOVELTY = FIXTURE_PARTITIONS

FIXTURE_DATASET_HASH = "f1" * 32
FIXTURE_VOCABULARY_HASH = "f2" * 32
FIXTURE_SPRINT2_MANIFEST_HASH = "f3" * 32
FIXTURE_SUPPORT_MATRIX_VERSION = "1.0"
FIXTURE_FEATURE_POLICY_VERSION = "1.0"
FIXTURE_PARTITION_COUNTS: Mapping[str, int] = {
    FIXTURE_ID: 4,
    FIXTURE_OOA: 3,
    FIXTURE_NOVELTY: 2,
}

#: Synthetic class-to-head map used only by the fixture source. Not the frozen
#: 13-class support matrix; tests that mutate a head target stay on this table.
FIXTURE_CLASS_HEADS: Mapping[int, tuple[int, int, int]] = {
    1: (0, 0, 0),
    2: (1, 1, 1),
    3: (2, 2, 2),
}


class SealedCorpusUnavailable(RuntimeError):
    """No trusted sealed corpus can be produced. Fail-closed default."""


class SealedCorpusIdentityMismatch(SealedCorpusUnavailable):
    """Claimed dataset, vocabulary, manifest, or version identity is wrong."""


class SealedCorpusPartitionMismatch(SealedCorpusUnavailable):
    """Partition set, names, or counts disagree with the trusted source."""


class SealedCorpusRecordMismatch(SealedCorpusUnavailable):
    """Record membership, labels, features, or lineage disagree with the source."""


class SealedOpeningNotEnabled(SealedCorpusUnavailable):
    """Production sealed opening was requested without a valid runtime permit."""


class FamilyAuthorization(Protocol):
    """The per-family slice a validated authorization must expose."""

    @property
    def model_family(self) -> str: ...

    @property
    def dataset_hash(self) -> str: ...

    @property
    def vocabulary_hash(self) -> str: ...

    @property
    def support_matrix_version(self) -> str: ...

    @property
    def feature_policy_version(self) -> str: ...


class DualFamilyAuthorization(Protocol):
    """Complete dual-family authorization. Satisfied by ``AuthorizationSet``."""

    @property
    def mode(self) -> str: ...

    @property
    def authorizations(self) -> Mapping[str, Any]: ...

    @property
    def artifact_manifest_sha256(self) -> str: ...

    @property
    def preregistration_sha256(self) -> str: ...

    def families(self) -> tuple[str, ...]: ...

    def for_family(self, model_family: str) -> Any: ...


_PERMIT_TOKEN = object()


@dataclass(frozen=True)
class RealOpeningPermit:
    """Immutable capability required to request production sealed derivation.

    Constructed only by :func:`authorize_real_opening`. Direct construction
    without the private token is refused.
    """

    _token: object
    mode: str
    acknowledge_one_shot_holdout: bool
    enable_real_sealed_opening: bool
    artifact_manifest_sha256: str
    preregistration_sha256: str

    def __post_init__(self) -> None:
        if self._token is not _PERMIT_TOKEN:
            raise SealedOpeningNotEnabled(
                "RealOpeningPermit can only be created by authorize_real_opening"
            )


def authorize_real_opening(
    *,
    mode: str,
    acknowledge_one_shot_holdout: bool,
    enable_real_sealed_opening: bool,
    authorization: DualFamilyAuthorization,
) -> RealOpeningPermit:
    """Issue a real-opening permit from already-validated control information.

    No rows, labels, hashes, or membership lists are accepted. Any failed
    prerequisite raises before a production source can be constructed.
    """
    parameters = set(inspect.signature(authorize_real_opening).parameters)
    if parameters != {
        "mode",
        "acknowledge_one_shot_holdout",
        "enable_real_sealed_opening",
        "authorization",
    }:
        raise SealedOpeningNotEnabled("authorize_real_opening signature drifted")
    if mode != FINAL_EVALUATION_MODE:
        raise SealedOpeningNotEnabled(f"real opening requires mode {FINAL_EVALUATION_MODE!r}")
    if acknowledge_one_shot_holdout is not True:
        raise SealedOpeningNotEnabled("real opening requires --acknowledge-one-shot-holdout")
    if enable_real_sealed_opening is not True:
        raise SealedOpeningNotEnabled("real opening requires --enable-real-sealed-opening")
    _require_complete_authorization(authorization)
    return RealOpeningPermit(
        _token=_PERMIT_TOKEN,
        mode=mode,
        acknowledge_one_shot_holdout=True,
        enable_real_sealed_opening=True,
        artifact_manifest_sha256=authorization.artifact_manifest_sha256,
        preregistration_sha256=authorization.preregistration_sha256,
    )


@dataclass(frozen=True)
class SealedRow:
    """One integrity-checked row. Constructed only by a trusted source plan."""

    record_id: str
    parent_lineage_id: str
    partition: str
    feature_indices: tuple[int, ...]
    feature_values: tuple[float, ...]
    class_number: int | None
    is_novel: bool
    supported: bool
    verb_index: int | None
    object_index: int | None
    transition_property_index: int | None
    application_family_id: str | None = None


def _row_digest(row: SealedRow) -> str:
    return canonical_sha256(
        {
            "recordId": row.record_id,
            "parentLineageId": row.parent_lineage_id,
            "partition": row.partition,
            "featureIndices": list(row.feature_indices),
            "featureValues": list(row.feature_values),
            "classNumber": row.class_number,
            "isNovel": row.is_novel,
            "supported": row.supported,
            "verbIndex": row.verb_index,
            "objectIndex": row.object_index,
            "transitionPropertyIndex": row.transition_property_index,
        }
    )


def _projection_digest(row: SealedRow) -> str:
    return canonical_sha256(
        {
            "recordId": row.record_id,
            "featureIndices": list(row.feature_indices),
            "featureValues": list(row.feature_values),
        }
    )


def _oracle_digest(row: SealedRow) -> str:
    return canonical_sha256(
        {
            "recordId": row.record_id,
            "classNumber": row.class_number,
            "isNovel": row.is_novel,
            "supported": row.supported,
            "verbIndex": row.verb_index,
            "objectIndex": row.object_index,
            "transitionPropertyIndex": row.transition_property_index,
        }
    )


def _lineage_digest(row: SealedRow) -> str:
    return canonical_sha256(
        {
            "recordId": row.record_id,
            "parentLineageId": row.parent_lineage_id,
            "partition": row.partition,
        }
    )


@dataclass(frozen=True)
class _Authority:
    """Membership and identity the trusted source itself derives.

    Never accepted from a caller of ``construct_validated_sealed_corpus``.
    """

    dataset_hash: str
    vocabulary_hash: str
    sprint2_manifest_hash: str
    support_matrix_version: str
    feature_policy_version: str
    expected_counts: Mapping[str, int]
    allowed_partitions: tuple[str, ...]
    membership: Mapping[str, str]
    features: Mapping[str, tuple[tuple[int, ...], tuple[float, ...]]]
    labels: Mapping[str, tuple[int | None, bool, bool]]
    lineages: Mapping[str, str]
    heads: Mapping[str, tuple[int | None, int | None, int | None]]


@dataclass(frozen=True)
class _RawSnapshot:
    """Internal materialization. Not part of the public constructor surface."""

    source_kind: str
    authority: _Authority
    claimed_dataset_hash: str
    claimed_vocabulary_hash: str
    claimed_sprint2_manifest_hash: str
    claimed_support_matrix_version: str
    claimed_feature_policy_version: str
    rows: tuple[SealedRow, ...]


_CONSTRUCTION_TOKEN = object()


def _immutable_counts(mapping: Mapping[str, int]) -> Mapping[str, int]:
    return MappingProxyType({key: mapping[key] for key in sorted(mapping)})


def _immutable_identity(identity: Mapping[str, object]) -> Mapping[str, object]:
    frozen: dict[str, object] = {}
    for key, value in identity.items():
        if isinstance(value, dict):
            frozen[key] = MappingProxyType(dict(value))
        elif isinstance(value, list):
            frozen[key] = tuple(value)
        else:
            frozen[key] = value
    return MappingProxyType(frozen)


@dataclass(frozen=True)
class ValidatedSealedCorpus:
    """Immutable sealed corpus produced only by successful trusted-source validation.

    There is no public constructor that accepts caller rows. ``__init__`` refuses
    unless the private construction token is presented, and that token is not
    exported.
    """

    _token: object
    sealed_corpus_sha256: str
    source_kind: str
    dataset_hash: str
    vocabulary_hash: str
    sprint2_manifest_hash: str
    support_matrix_version: str
    feature_policy_version: str
    partition_record_counts: Mapping[str, int]
    partition_lineage_counts: Mapping[str, int]
    record_count: int
    lineage_count: int
    _rows: tuple[SealedRow, ...]
    identity: Mapping[str, object]

    def __post_init__(self) -> None:
        if self._token is not _CONSTRUCTION_TOKEN:
            raise SealedCorpusUnavailable(
                "ValidatedSealedCorpus cannot be constructed from caller input; "
                "obtain one from construct_validated_sealed_corpus"
            )

    def partitions(self) -> tuple[str, ...]:
        return tuple(sorted(self.partition_record_counts))

    def rows(self) -> tuple[SealedRow, ...]:
        return self._rows

    def rows_in(self, partition: str) -> tuple[SealedRow, ...]:
        return tuple(row for row in self._rows if row.partition == partition)


class TrustedSealedSource(Protocol):
    """A source that can materialize rows only after authorization.

    Production implementations accept no caller rows. Fixture implementations
    cannot name the real sealed partitions.
    """

    @property
    def source_kind(self) -> str: ...

    def materialize(self, authorization: DualFamilyAuthorization) -> _RawSnapshot: ...


def _refuse_physical_file(path: Path = CANONICAL_SEALED_EXPORT_PATH) -> None:
    if path.exists():
        raise SealedCorpusUnavailable(
            "a physical sealed-corpus file is present and is refused; "
            "fc008-final-test-corpus.json is never a trusted input"
        )


def _require_complete_authorization(authorization: DualFamilyAuthorization) -> None:
    # Lazy: ``evaluation`` imports this module, so a top-level import would cycle.
    from .evaluation import FinalEvaluationNotAuthorized

    if authorization.mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationNotAuthorized(
            f"sealed-corpus construction requires mode {FINAL_EVALUATION_MODE!r}"
        )
    missing = [
        family for family in REGISTERED_FAMILIES if family not in authorization.authorizations
    ]
    if missing:
        raise FinalEvaluationNotAuthorized(
            "every registered family must be authorized before any sealed row is "
            f"requested; missing {missing}. Partial evaluation is refused."
        )
    for family in REGISTERED_FAMILIES:
        authorization.for_family(family)
    anchors = {authorization.for_family(family).dataset_hash for family in REGISTERED_FAMILIES}
    vocabularies = {
        authorization.for_family(family).vocabulary_hash for family in REGISTERED_FAMILIES
    }
    if len(anchors) != 1 or len(vocabularies) != 1:
        raise FinalEvaluationNotAuthorized(
            "authorized families disagree about the frozen dataset or vocabulary identity"
        )


def _features_valid(indices: tuple[int, ...], values: tuple[float, ...]) -> str | None:
    if len(indices) != len(values):
        return "feature-length"
    seen: set[int] = set()
    previous = -1
    for index, value in zip(indices, values, strict=True):
        if not isinstance(index, int) or isinstance(index, bool):
            return "feature-index-type"
        if index < 0 or index >= FEATURE_DIMENSION:
            return "feature-oov"
        if index in seen:
            return "feature-duplicate-index"
        if index <= previous:
            return "feature-order"
        seen.add(index)
        previous = index
        if value != value or value in (float("inf"), float("-inf")):
            return "feature-nonfinite"
    return None


def _validate_snapshot(
    snapshot: _RawSnapshot, authorization: DualFamilyAuthorization
) -> ValidatedSealedCorpus:
    authority = snapshot.authority
    if snapshot.source_kind == "production":
        if snapshot.claimed_dataset_hash != FROZEN_DATASET_HASH:
            raise SealedCorpusIdentityMismatch("production dataset identity mismatch")
        if snapshot.claimed_vocabulary_hash != FROZEN_VOCABULARY_HASH:
            raise SealedCorpusIdentityMismatch("production vocabulary identity mismatch")
        if snapshot.claimed_sprint2_manifest_hash != FROZEN_SPRINT2_MANIFEST_HASH:
            raise SealedCorpusIdentityMismatch("production Sprint-2 manifest identity mismatch")
        family = authorization.for_family(next(iter(REGISTERED_FAMILIES)))
        if snapshot.claimed_dataset_hash != family.dataset_hash:
            raise SealedCorpusIdentityMismatch("dataset identity disagrees with authorization")
        if snapshot.claimed_vocabulary_hash != family.vocabulary_hash:
            raise SealedCorpusIdentityMismatch("vocabulary identity disagrees with authorization")
        if authority.allowed_partitions != SEALED_PARTITIONS:
            raise SealedCorpusPartitionMismatch(
                "production source is not restricted to sealed partitions"
            )

    if snapshot.claimed_dataset_hash != authority.dataset_hash:
        raise SealedCorpusIdentityMismatch("dataset identity mismatch")
    if snapshot.claimed_vocabulary_hash != authority.vocabulary_hash:
        raise SealedCorpusIdentityMismatch("vocabulary identity mismatch")
    if snapshot.claimed_sprint2_manifest_hash != authority.sprint2_manifest_hash:
        raise SealedCorpusIdentityMismatch("Sprint-2 manifest identity mismatch")
    if snapshot.claimed_support_matrix_version != authority.support_matrix_version:
        raise SealedCorpusIdentityMismatch("support-matrix version mismatch")
    if snapshot.claimed_feature_policy_version != authority.feature_policy_version:
        raise SealedCorpusIdentityMismatch("feature-policy version mismatch")

    if snapshot.source_kind == "fixture":
        allowed = FIXTURE_PARTITIONS
    elif snapshot.source_kind == "production":
        allowed = SEALED_PARTITIONS
    else:
        raise SealedCorpusUnavailable("unknown sealed source kind")
    if authority.allowed_partitions != allowed:
        raise SealedCorpusPartitionMismatch("source partition whitelist mismatch")

    present = {row.partition for row in snapshot.rows}
    if present & set(DEVELOPMENT_PARTITIONS):
        raise SealedCorpusPartitionMismatch("development partition present in sealed corpus")
    unexpected = present - set(allowed)
    if unexpected:
        raise SealedCorpusPartitionMismatch("unexpected partition in sealed corpus")
    missing = [partition for partition in allowed if partition not in present]
    if missing:
        raise SealedCorpusPartitionMismatch("missing required sealed partition")

    counts: dict[str, int] = {partition: 0 for partition in allowed}
    lineage_sets: dict[str, set[str]] = {partition: set() for partition in allowed}
    seen_ids: dict[str, str] = {}
    for row in snapshot.rows:
        expected_partition = authority.membership.get(row.record_id)
        if expected_partition is not None and row.partition != expected_partition:
            raise SealedCorpusRecordMismatch("row moved across partitions")
        counts[row.partition] = counts.get(row.partition, 0) + 1
        lineage_sets.setdefault(row.partition, set()).add(row.parent_lineage_id)
        prior = seen_ids.get(row.record_id)
        if prior is not None:
            raise SealedCorpusRecordMismatch("duplicate record identifier")
        seen_ids[row.record_id] = row.partition

    expected_counts = dict(authority.expected_counts)
    if set(expected_counts) != set(allowed):
        raise SealedCorpusPartitionMismatch("trusted expected-count keys disagree with whitelist")
    for partition, expected in expected_counts.items():
        if counts.get(partition, 0) != expected:
            raise SealedCorpusPartitionMismatch("partition count mismatch")

    expected_ids = set(authority.membership)
    actual_ids = set(seen_ids)
    if actual_ids - expected_ids:
        raise SealedCorpusRecordMismatch("extra record present")
    if expected_ids - actual_ids:
        raise SealedCorpusRecordMismatch("expected record absent")

    id_lineages = lineage_sets.get(allowed[0], set())
    ooa_lineages = lineage_sets.get(allowed[1], set())
    novelty_lineages = lineage_sets.get(allowed[2], set())
    if id_lineages & ooa_lineages:
        raise SealedCorpusRecordMismatch("lineage crosses a forbidden split")
    if id_lineages & novelty_lineages or ooa_lineages & novelty_lineages:
        raise SealedCorpusRecordMismatch("lineage crosses a forbidden split")

    for row in snapshot.rows:
        expected_partition = authority.membership[row.record_id]
        if row.partition != expected_partition:
            raise SealedCorpusRecordMismatch("row moved across partitions")
        if row.parent_lineage_id != authority.lineages[row.record_id]:
            raise SealedCorpusRecordMismatch("parentLineageId mismatch")
        expected_features = authority.features[row.record_id]
        if (row.feature_indices, row.feature_values) != expected_features:
            raise SealedCorpusRecordMismatch("feature vector mismatch")
        feature_error = _features_valid(row.feature_indices, row.feature_values)
        if feature_error is not None:
            raise SealedCorpusRecordMismatch("feature integrity failure")
        expected_label = authority.labels[row.record_id]
        actual_label = (row.class_number, row.is_novel, row.supported)
        if actual_label != expected_label:
            raise SealedCorpusRecordMismatch("oracle label mismatch")
        expected_heads = authority.heads[row.record_id]
        actual_heads = (row.verb_index, row.object_index, row.transition_property_index)
        if actual_heads != expected_heads:
            raise SealedCorpusRecordMismatch("head-target mismatch")

        if row.partition in (allowed[0], allowed[1]):
            if row.is_novel or not row.supported:
                raise SealedCorpusRecordMismatch("supported row relabelled novelty")
            if row.class_number is None:
                raise SealedCorpusRecordMismatch("supported row missing class")
            if not (SUPPORTED_CLASS_MIN <= row.class_number <= SUPPORTED_CLASS_MAX):
                raise SealedCorpusRecordMismatch("unsupported external class")
        if row.partition == allowed[2]:
            if row.is_novel and row.supported:
                raise SealedCorpusRecordMismatch("novelty row relabelled supported")
            if not row.is_novel:
                if row.class_number is None:
                    raise SealedCorpusRecordMismatch(
                        "supported novelty-partition row missing class"
                    )
                if not (SUPPORTED_CLASS_MIN <= row.class_number <= SUPPORTED_CLASS_MAX):
                    raise SealedCorpusRecordMismatch("unsupported external class")
            elif row.class_number is not None and not (
                SUPPORTED_CLASS_MIN <= row.class_number <= SUPPORTED_CLASS_MAX
            ):
                raise SealedCorpusRecordMismatch("unsupported external class")

    identity = {
        "schemaVersion": SEALED_CORPUS_SCHEMA_VERSION,
        "datasetHash": snapshot.claimed_dataset_hash,
        "vocabularyHash": snapshot.claimed_vocabulary_hash,
        "supportMatrixVersion": snapshot.claimed_support_matrix_version,
        "featurePolicyVersion": snapshot.claimed_feature_policy_version,
        "sprint2ManifestHash": snapshot.claimed_sprint2_manifest_hash,
        "featureDimension": FEATURE_DIMENSION,
        "featureOrderIdentity": "frozen-index-order",
        "partitionCounts": {partition: counts[partition] for partition in allowed},
        "partitionLineageCounts": {
            partition: len(lineage_sets[partition]) for partition in allowed
        },
        "recordDigests": sorted(_row_digest(row) for row in snapshot.rows),
        "lineageDigests": sorted({_lineage_digest(row) for row in snapshot.rows}),
        "projectionIdentity": canonical_sha256(
            sorted(_projection_digest(row) for row in snapshot.rows)
        ),
        "oracleIdentity": canonical_sha256(sorted(_oracle_digest(row) for row in snapshot.rows)),
        "lineageIdentity": canonical_sha256(sorted(_lineage_digest(row) for row in snapshot.rows)),
        "sourceKind": snapshot.source_kind,
    }
    digest = canonical_sha256(identity)
    return ValidatedSealedCorpus(
        _token=_CONSTRUCTION_TOKEN,
        sealed_corpus_sha256=digest,
        source_kind=snapshot.source_kind,
        dataset_hash=snapshot.claimed_dataset_hash,
        vocabulary_hash=snapshot.claimed_vocabulary_hash,
        sprint2_manifest_hash=snapshot.claimed_sprint2_manifest_hash,
        support_matrix_version=snapshot.claimed_support_matrix_version,
        feature_policy_version=snapshot.claimed_feature_policy_version,
        partition_record_counts=_immutable_counts(
            {partition: counts[partition] for partition in allowed}
        ),
        partition_lineage_counts=_immutable_counts(
            {partition: len(lineage_sets[partition]) for partition in allowed}
        ),
        record_count=len(snapshot.rows),
        lineage_count=len({row.parent_lineage_id for row in snapshot.rows}),
        _rows=snapshot.rows,
        identity=_immutable_identity(identity),
    )


def construct_validated_sealed_corpus(
    *,
    authorization: DualFamilyAuthorization,
    source: TrustedSealedSource,
) -> ValidatedSealedCorpus:
    """Authorize first, then materialize, then validate. No caller rows accepted.

    Signature is keyword-only and closed: there is no parameter for records,
    labels, hashes, or expected membership.
    """
    parameters = set(inspect.signature(construct_validated_sealed_corpus).parameters)
    if parameters != {"authorization", "source"}:
        raise SealedCorpusUnavailable("construct_validated_sealed_corpus signature drifted")
    _refuse_physical_file()
    _require_complete_authorization(authorization)
    kind = getattr(source, "source_kind", None)
    if kind not in {"fixture", "production"}:
        raise SealedCorpusUnavailable("sealed source is not a trusted fixture or production source")
    snapshot = source.materialize(authorization)
    if snapshot.source_kind != kind:
        raise SealedCorpusUnavailable("sealed source kind disagreed with its snapshot")
    return _validate_snapshot(snapshot, authorization)


def _fixture_row(
    *,
    record_id: str,
    lineage: str,
    partition: str,
    indices: tuple[int, ...],
    values: tuple[float, ...],
    class_number: int | None,
    is_novel: bool,
    supported: bool,
) -> SealedRow:
    verb: int | None
    obj: int | None
    prop: int | None
    if class_number is not None and class_number in FIXTURE_CLASS_HEADS:
        verb, obj, prop = FIXTURE_CLASS_HEADS[class_number]
    else:
        verb = obj = prop = None
    return SealedRow(
        record_id=record_id,
        parent_lineage_id=lineage,
        partition=partition,
        feature_indices=indices,
        feature_values=values,
        class_number=class_number,
        is_novel=is_novel,
        supported=supported,
        verb_index=verb,
        object_index=obj,
        transition_property_index=prop,
    )


def _valid_fixture_rows() -> tuple[SealedRow, ...]:
    return (
        _fixture_row(
            record_id="fix-id-000",
            lineage="lin-id-a",
            partition=FIXTURE_ID,
            indices=(0, 4),
            values=(1.0, 1.0),
            class_number=1,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-id-001",
            lineage="lin-id-a",
            partition=FIXTURE_ID,
            indices=(1, 5),
            values=(1.0, 1.0),
            class_number=2,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-id-002",
            lineage="lin-id-b",
            partition=FIXTURE_ID,
            indices=(2, 6),
            values=(1.0, 1.0),
            class_number=1,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-id-003",
            lineage="lin-id-b",
            partition=FIXTURE_ID,
            indices=(3, 7),
            values=(1.0, 1.0),
            class_number=2,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-ooa-000",
            lineage="lin-ooa-a",
            partition=FIXTURE_OOA,
            indices=(8, 12),
            values=(1.0, 1.0),
            class_number=1,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-ooa-001",
            lineage="lin-ooa-b",
            partition=FIXTURE_OOA,
            indices=(9, 13),
            values=(1.0, 1.0),
            class_number=2,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-ooa-002",
            lineage="lin-ooa-c",
            partition=FIXTURE_OOA,
            indices=(10, 14),
            values=(1.0, 1.0),
            class_number=3,
            is_novel=False,
            supported=True,
        ),
        _fixture_row(
            record_id="fix-nov-000",
            lineage="lin-nov-a",
            partition=FIXTURE_NOVELTY,
            indices=(20, 21),
            values=(1.0, 1.0),
            class_number=None,
            is_novel=True,
            supported=False,
        ),
        _fixture_row(
            record_id="fix-nov-001",
            lineage="lin-nov-b",
            partition=FIXTURE_NOVELTY,
            indices=(22, 23),
            values=(1.0, 1.0),
            class_number=None,
            is_novel=True,
            supported=False,
        ),
    )


def _authority_from_rows(
    rows: tuple[SealedRow, ...],
    *,
    dataset_hash: str = FIXTURE_DATASET_HASH,
    vocabulary_hash: str = FIXTURE_VOCABULARY_HASH,
    sprint2_manifest_hash: str = FIXTURE_SPRINT2_MANIFEST_HASH,
    support_matrix_version: str = FIXTURE_SUPPORT_MATRIX_VERSION,
    feature_policy_version: str = FIXTURE_FEATURE_POLICY_VERSION,
    allowed_partitions: tuple[str, ...] = FIXTURE_PARTITIONS,
    expected_counts: Mapping[str, int] | None = None,
    head_table: Mapping[int, tuple[int, int, int]] | None = None,
) -> _Authority:
    counts: dict[str, int] = {}
    membership: dict[str, str] = {}
    features: dict[str, tuple[tuple[int, ...], tuple[float, ...]]] = {}
    labels: dict[str, tuple[int | None, bool, bool]] = {}
    lineages: dict[str, str] = {}
    heads: dict[str, tuple[int | None, int | None, int | None]] = {}
    for row in rows:
        counts[row.partition] = counts.get(row.partition, 0) + 1
        membership[row.record_id] = row.partition
        features[row.record_id] = (row.feature_indices, row.feature_values)
        labels[row.record_id] = (row.class_number, row.is_novel, row.supported)
        lineages[row.record_id] = row.parent_lineage_id
        if (
            head_table is not None
            and row.class_number is not None
            and row.supported
            and row.class_number in head_table
        ):
            heads[row.record_id] = head_table[row.class_number]
        else:
            heads[row.record_id] = (
                row.verb_index,
                row.object_index,
                row.transition_property_index,
            )
    return _Authority(
        dataset_hash=dataset_hash,
        vocabulary_hash=vocabulary_hash,
        sprint2_manifest_hash=sprint2_manifest_hash,
        support_matrix_version=support_matrix_version,
        feature_policy_version=feature_policy_version,
        expected_counts=dict(expected_counts) if expected_counts is not None else dict(counts),
        allowed_partitions=allowed_partitions,
        membership=membership,
        features=features,
        labels=labels,
        lineages=lineages,
        heads=heads,
    )


def _snapshot_from_rows(
    rows: tuple[SealedRow, ...],
    authority: _Authority,
    *,
    claimed_dataset_hash: str | None = None,
    claimed_vocabulary_hash: str | None = None,
    claimed_sprint2_manifest_hash: str | None = None,
    claimed_support_matrix_version: str | None = None,
    claimed_feature_policy_version: str | None = None,
    source_kind: str = "fixture",
) -> _RawSnapshot:
    return _RawSnapshot(
        source_kind=source_kind,
        authority=authority,
        claimed_dataset_hash=claimed_dataset_hash or authority.dataset_hash,
        claimed_vocabulary_hash=claimed_vocabulary_hash or authority.vocabulary_hash,
        claimed_sprint2_manifest_hash=(
            claimed_sprint2_manifest_hash or authority.sprint2_manifest_hash
        ),
        claimed_support_matrix_version=claimed_support_matrix_version
        or authority.support_matrix_version,
        claimed_feature_policy_version=claimed_feature_policy_version
        or authority.feature_policy_version,
        rows=rows,
    )


@dataclass(frozen=True)
class FixtureTrustedSealedSource:
    """TEST-ONLY source. Cannot name or emit the real sealed partitions."""

    source_kind: str = "fixture"

    def materialize(self, authorization: DualFamilyAuthorization) -> _RawSnapshot:
        del authorization
        rows = _valid_fixture_rows()
        if any(row.partition in SEALED_PARTITIONS for row in rows):
            raise SealedCorpusPartitionMismatch("fixture source emitted a real sealed partition")
        return _snapshot_from_rows(rows, _authority_from_rows(rows))


@dataclass
class FaultyFixtureSource:
    """TEST-ONLY source that applies exactly one integrity fault after planning."""

    mutation: str
    source_kind: str = "fixture"

    def materialize(self, authorization: DualFamilyAuthorization) -> _RawSnapshot:
        del authorization
        rows = list(_valid_fixture_rows())
        authority = _authority_from_rows(tuple(rows))
        claimed = {
            "claimed_dataset_hash": authority.dataset_hash,
            "claimed_vocabulary_hash": authority.vocabulary_hash,
            "claimed_sprint2_manifest_hash": authority.sprint2_manifest_hash,
            "claimed_support_matrix_version": authority.support_matrix_version,
            "claimed_feature_policy_version": authority.feature_policy_version,
        }
        mutation = self.mutation
        if mutation == "wrong-dataset-hash":
            claimed["claimed_dataset_hash"] = "aa" * 32
        elif mutation == "wrong-vocabulary-hash":
            claimed["claimed_vocabulary_hash"] = "bb" * 32
        elif mutation == "wrong-sprint2-manifest":
            claimed["claimed_sprint2_manifest_hash"] = "cc" * 32
        elif mutation == "wrong-feature-policy-version":
            claimed["claimed_feature_policy_version"] = "9.9"
        elif mutation == "wrong-support-matrix-version":
            claimed["claimed_support_matrix_version"] = "9.9"
        elif mutation == "missing-partition":
            rows = [row for row in rows if row.partition != FIXTURE_OOA]
        elif mutation == "extra-partition":
            rows.append(
                _fixture_row(
                    record_id="fix-extra-000",
                    lineage="lin-extra",
                    partition="fixture-extra",
                    indices=(30, 31),
                    values=(1.0, 1.0),
                    class_number=1,
                    is_novel=False,
                    supported=True,
                )
            )
        elif mutation == "wrong-partition-count":
            rows = [row for row in rows if row.record_id != "fix-id-003"]
        elif mutation == "duplicate-record-within-partition":
            rows.append(rows[0])
        elif mutation == "duplicate-record-across-partitions":
            moved = SealedRow(
                record_id=rows[0].record_id,
                parent_lineage_id="lin-ooa-dup",
                partition=FIXTURE_OOA,
                feature_indices=(40, 41),
                feature_values=(1.0, 1.0),
                class_number=1,
                is_novel=False,
                supported=True,
                verb_index=0,
                object_index=0,
                transition_property_index=0,
            )
            rows.append(moved)
        elif mutation == "development-row-inserted":
            rows.append(
                _fixture_row(
                    record_id="fix-train-000",
                    lineage="lin-train",
                    partition="train",
                    indices=(50, 51),
                    values=(1.0, 1.0),
                    class_number=1,
                    is_novel=False,
                    supported=True,
                )
            )
        elif mutation == "row-moved-id-to-ooa":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=FIXTURE_OOA,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "row-moved-ooa-to-id":
            index = next(i for i, row in enumerate(rows) if row.partition == FIXTURE_OOA)
            original = rows[index]
            rows[index] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=FIXTURE_ID,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "novelty-relabelled-supported":
            index = next(i for i, row in enumerate(rows) if row.record_id == "fix-nov-000")
            original = rows[index]
            rows[index] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=1,
                is_novel=False,
                supported=True,
                verb_index=0,
                object_index=0,
                transition_property_index=0,
            )
        elif mutation == "supported-relabelled-novelty":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=True,
                supported=False,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "wrong-parent-lineage":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id="lin-tampered",
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "lineage-crosses-forbidden-split":
            index = next(i for i, row in enumerate(rows) if row.partition == FIXTURE_OOA)
            original = rows[index]
            rows[index] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id="lin-id-a",
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "modified-sparse-index":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=(0, 9),
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "modified-feature-value":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=(1.0, 2.0),
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "feature-outside-vocab":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=(0, FEATURE_DIMENSION),
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=original.verb_index,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        elif mutation == "modified-class-label":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=3,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=2,
                object_index=2,
                transition_property_index=2,
            )
        elif mutation == "unsupported-external-class":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=14,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=None,
                object_index=None,
                transition_property_index=None,
            )
        elif mutation == "wrong-head-target":
            original = rows[0]
            rows[0] = SealedRow(
                record_id=original.record_id,
                parent_lineage_id=original.parent_lineage_id,
                partition=original.partition,
                feature_indices=original.feature_indices,
                feature_values=original.feature_values,
                class_number=original.class_number,
                is_novel=original.is_novel,
                supported=original.supported,
                verb_index=8,
                object_index=original.object_index,
                transition_property_index=original.transition_property_index,
            )
        else:
            raise AssertionError(f"unknown fixture mutation {mutation!r}")
        return _snapshot_from_rows(tuple(rows), authority, **claimed)


class CallerRowSource:
    """A caller-invented source presenting arbitrary rows. Must fail closed."""

    source_kind = "fixture"

    def materialize(self, authorization: DualFamilyAuthorization) -> _RawSnapshot:
        del authorization
        invented = _fixture_row(
            record_id="caller-invented",
            lineage="caller-lineage",
            partition=FIXTURE_ID,
            indices=(0, 1),
            values=(1.0, 1.0),
            class_number=1,
            is_novel=False,
            supported=True,
        )
        empty_authority = _Authority(
            dataset_hash=FIXTURE_DATASET_HASH,
            vocabulary_hash=FIXTURE_VOCABULARY_HASH,
            sprint2_manifest_hash=FIXTURE_SPRINT2_MANIFEST_HASH,
            support_matrix_version=FIXTURE_SUPPORT_MATRIX_VERSION,
            feature_policy_version=FIXTURE_FEATURE_POLICY_VERSION,
            expected_counts=dict(FIXTURE_PARTITION_COUNTS),
            allowed_partitions=FIXTURE_PARTITIONS,
            membership={},
            features={},
            labels={},
            lineages={},
            heads={},
        )
        return _snapshot_from_rows((invented,), empty_authority)


@dataclass(frozen=True)
class CanonicalDatasetSnapshot:
    """Full canonical FutureBench identity plus the records the builder emitted.

    Production derives this from the frozen generator. Tests inject a fake.
    """

    dataset_hash: str
    vocabulary_hash: str
    sprint2_manifest_hash: str
    support_matrix_version: str
    feature_policy_version: str
    rows: tuple[SealedRow, ...]


class CanonicalDatasetBuilder(Protocol):
    def build_canonical_dataset(self) -> CanonicalDatasetSnapshot: ...


def production_builder_invocation_count() -> int:
    return _PRODUCTION_BUILDER_INVOCATIONS


def invoke_production_futurebench_builder() -> CanonicalDatasetSnapshot:
    """Authoritative production derivation. Invokes the frozen FutureBench generator.

    Not called by tests in this session. The reviewed bytes are complete: a later
    one-shot run with a valid permit uses this path with no source edit.
    """
    global _PRODUCTION_BUILDER_INVOCATIONS
    _PRODUCTION_BUILDER_INVOCATIONS += 1
    if not PRODUCTION_DERIVATION_SCRIPT.is_file():
        raise SealedCorpusUnavailable("production FutureBench derivation script is missing")
    completed = subprocess.run(
        [
            "npx",
            "tsx",
            str(PRODUCTION_DERIVATION_SCRIPT),
            "--acknowledge-one-shot-holdout",
            "--enable-real-sealed-opening",
        ],
        cwd=str(PRODUCTION_DERIVATION_SCRIPT.parent.parent),
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise SealedCorpusUnavailable("production FutureBench derivation refused")
    document = json.loads(completed.stdout)
    return _snapshot_from_derivation_document(document)


def _snapshot_from_derivation_document(document: Mapping[str, Any]) -> CanonicalDatasetSnapshot:
    rows: list[SealedRow] = []
    raw_rows = document.get("rows")
    if not isinstance(raw_rows, list):
        raise SealedCorpusUnavailable("production derivation returned no row list")
    for entry in raw_rows:
        if not isinstance(entry, dict):
            raise SealedCorpusRecordMismatch("production derivation emitted a malformed row")
        rows.append(
            SealedRow(
                record_id=str(entry["recordId"]),
                parent_lineage_id=str(entry["parentLineageId"]),
                partition=str(entry["partition"]),
                feature_indices=tuple(int(index) for index in entry["featureIndices"]),
                feature_values=tuple(float(value) for value in entry["featureValues"]),
                class_number=(
                    None if entry.get("classNumber") is None else int(entry["classNumber"])
                ),
                is_novel=bool(entry["isNovel"]),
                supported=bool(entry["supported"]),
                verb_index=None if entry.get("verbIndex") is None else int(entry["verbIndex"]),
                object_index=(
                    None if entry.get("objectIndex") is None else int(entry["objectIndex"])
                ),
                transition_property_index=(
                    None
                    if entry.get("transitionPropertyIndex") is None
                    else int(entry["transitionPropertyIndex"])
                ),
                application_family_id=(
                    None
                    if entry.get("applicationFamilyId") is None
                    else str(entry["applicationFamilyId"])
                ),
            )
        )
    return CanonicalDatasetSnapshot(
        dataset_hash=str(document["datasetHash"]),
        vocabulary_hash=str(document["vocabularyHash"]),
        sprint2_manifest_hash=str(document["sprint2ManifestHash"]),
        support_matrix_version=str(document["supportMatrixVersion"]),
        feature_policy_version=str(document["featurePolicyVersion"]),
        rows=tuple(rows),
    )


def _derive_production_snapshot(full: CanonicalDatasetSnapshot) -> _RawSnapshot:
    if full.dataset_hash != FROZEN_DATASET_HASH:
        raise SealedCorpusIdentityMismatch("dataset identity mismatch")
    if full.vocabulary_hash != FROZEN_VOCABULARY_HASH:
        raise SealedCorpusIdentityMismatch("vocabulary identity mismatch")
    if full.sprint2_manifest_hash != FROZEN_SPRINT2_MANIFEST_HASH:
        raise SealedCorpusIdentityMismatch("Sprint-2 manifest identity mismatch")
    if full.support_matrix_version != FROZEN_SUPPORT_MATRIX_VERSION:
        raise SealedCorpusIdentityMismatch("support-matrix version mismatch")
    if full.feature_policy_version != FROZEN_FEATURE_POLICY_VERSION:
        raise SealedCorpusIdentityMismatch("feature-policy version mismatch")

    present = {row.partition for row in full.rows}
    unexpected = present - set(SEALED_PARTITIONS) - set(DEVELOPMENT_PARTITIONS)
    if unexpected:
        raise SealedCorpusPartitionMismatch("extra final partition")
    sealed = tuple(row for row in full.rows if row.partition in SEALED_PARTITIONS)
    development_ids = {
        row.record_id for row in full.rows if row.partition in DEVELOPMENT_PARTITIONS
    }
    if any(row.record_id in development_ids for row in sealed):
        raise SealedCorpusPartitionMismatch("development partition present in sealed corpus")
    present_sealed = {row.partition for row in sealed}
    missing = [partition for partition in SEALED_PARTITIONS if partition not in present_sealed]
    if missing:
        raise SealedCorpusPartitionMismatch("missing required sealed partition")
    counts = {partition: 0 for partition in SEALED_PARTITIONS}
    seen_ids: set[str] = set()
    id_lineages: set[str] = set()
    ooa_lineages: set[str] = set()
    novelty_lineages: set[str] = set()
    id_families: set[str] = set()
    ooa_families: set[str] = set()
    for row in sealed:
        if row.record_id in seen_ids:
            raise SealedCorpusRecordMismatch("duplicate record identifier")
        seen_ids.add(row.record_id)
        counts[row.partition] = counts[row.partition] + 1
        feature_error = _features_valid(row.feature_indices, row.feature_values)
        if feature_error is not None:
            raise SealedCorpusRecordMismatch("feature integrity failure")
        if row.class_number is not None and not (
            SUPPORTED_CLASS_MIN <= row.class_number <= SUPPORTED_CLASS_MAX
        ):
            raise SealedCorpusRecordMismatch("unsupported external class")
        if row.supported and row.class_number is not None:
            expected_heads = FROZEN_CLASS_HEADS.get(row.class_number)
            actual_heads = (row.verb_index, row.object_index, row.transition_property_index)
            if expected_heads is None or actual_heads != expected_heads:
                raise SealedCorpusRecordMismatch("head-target mismatch")
        if row.partition == "test-id":
            id_lineages.add(row.parent_lineage_id)
            if row.application_family_id:
                id_families.add(row.application_family_id)
        elif row.partition == "test-ooa":
            ooa_lineages.add(row.parent_lineage_id)
            if row.application_family_id:
                ooa_families.add(row.application_family_id)
        elif row.partition == "test-novelty":
            novelty_lineages.add(row.parent_lineage_id)
    if id_families & ooa_families:
        raise SealedCorpusRecordMismatch("lineage crosses a forbidden split")
    forbidden_overlap = (
        id_lineages & ooa_lineages
        or id_lineages & novelty_lineages
        or ooa_lineages & novelty_lineages
    )
    if forbidden_overlap:
        raise SealedCorpusRecordMismatch("lineage crosses a forbidden split")
    for partition, expected in FROZEN_SEALED_PARTITION_COUNTS.items():
        if counts[partition] != expected:
            raise SealedCorpusPartitionMismatch("partition count mismatch")

    authority = _authority_from_rows(
        sealed,
        dataset_hash=FROZEN_DATASET_HASH,
        vocabulary_hash=FROZEN_VOCABULARY_HASH,
        sprint2_manifest_hash=FROZEN_SPRINT2_MANIFEST_HASH,
        support_matrix_version=FROZEN_SUPPORT_MATRIX_VERSION,
        feature_policy_version=FROZEN_FEATURE_POLICY_VERSION,
        allowed_partitions=SEALED_PARTITIONS,
        expected_counts=FROZEN_SEALED_PARTITION_COUNTS,
        head_table=FROZEN_CLASS_HEADS,
    )
    return _snapshot_from_rows(sealed, authority, source_kind="production")


def _synthetic_production_rows(
    *,
    counts: Mapping[str, int] | None = None,
    dataset_hash: str = FROZEN_DATASET_HASH,
    vocabulary_hash: str = FROZEN_VOCABULARY_HASH,
    sprint2_manifest_hash: str = FROZEN_SPRINT2_MANIFEST_HASH,
    support_matrix_version: str = FROZEN_SUPPORT_MATRIX_VERSION,
    feature_policy_version: str = FROZEN_FEATURE_POLICY_VERSION,
    extra_rows: tuple[SealedRow, ...] = (),
    mutate: str | None = None,
) -> CanonicalDatasetSnapshot:
    """TEST-ONLY synthetic full-dataset stand-in. Never uses real record IDs."""
    resolved = dict(counts or FROZEN_SEALED_PARTITION_COUNTS)
    rows: list[SealedRow] = []
    for partition, count in resolved.items():
        family = "syn-ooa" if partition == "test-ooa" else "syn-id"
        for index in range(count):
            class_number = (index % 13) + 1
            is_novelty = partition == "test-novelty"
            is_novel = is_novelty and index < (count // 2)
            supported = not is_novel
            heads = FROZEN_CLASS_HEADS[class_number] if supported else (None, None, None)
            if is_novel:
                class_number_value: int | None = None
                heads = (None, None, None)
            else:
                class_number_value = class_number
            rows.append(
                SealedRow(
                    record_id=f"syn-{partition}-{index:03d}",
                    parent_lineage_id=f"syn-lin-{partition}-{index // 7}",
                    partition=partition,
                    feature_indices=(index % 180, 180 + (index % 180)),
                    feature_values=(1.0, 1.0),
                    class_number=class_number_value,
                    is_novel=is_novel,
                    supported=supported,
                    verb_index=heads[0],
                    object_index=heads[1],
                    transition_property_index=heads[2],
                    application_family_id=family,
                )
            )
    rows.extend(extra_rows)
    if mutate == "wrong-label":
        original = rows[0]
        rows[0] = SealedRow(
            record_id=original.record_id,
            parent_lineage_id=original.parent_lineage_id,
            partition=original.partition,
            feature_indices=original.feature_indices,
            feature_values=original.feature_values,
            class_number=14,
            is_novel=False,
            supported=True,
            verb_index=None,
            object_index=None,
            transition_property_index=None,
            application_family_id=original.application_family_id,
        )
    elif mutate == "wrong-heads":
        original = rows[0]
        rows[0] = SealedRow(
            record_id=original.record_id,
            parent_lineage_id=original.parent_lineage_id,
            partition=original.partition,
            feature_indices=original.feature_indices,
            feature_values=original.feature_values,
            class_number=original.class_number,
            is_novel=original.is_novel,
            supported=original.supported,
            verb_index=8,
            object_index=original.object_index,
            transition_property_index=original.transition_property_index,
            application_family_id=original.application_family_id,
        )
    elif mutate == "wrong-feature":
        original = rows[0]
        rows[0] = SealedRow(
            record_id=original.record_id,
            parent_lineage_id=original.parent_lineage_id,
            partition=original.partition,
            feature_indices=(0, FEATURE_DIMENSION),
            feature_values=original.feature_values,
            class_number=original.class_number,
            is_novel=original.is_novel,
            supported=original.supported,
            verb_index=original.verb_index,
            object_index=original.object_index,
            transition_property_index=original.transition_property_index,
            application_family_id=original.application_family_id,
        )
    elif mutate == "wrong-lineage":
        first = rows[0]
        second = next(row for row in rows if row.partition == "test-ooa")
        index = rows.index(second)
        rows[index] = SealedRow(
            record_id=second.record_id,
            parent_lineage_id=first.parent_lineage_id,
            partition=second.partition,
            feature_indices=second.feature_indices,
            feature_values=second.feature_values,
            class_number=second.class_number,
            is_novel=second.is_novel,
            supported=second.supported,
            verb_index=second.verb_index,
            object_index=second.object_index,
            transition_property_index=second.transition_property_index,
            application_family_id=second.application_family_id,
        )
    elif mutate == "moved-record":
        original = rows[0]
        rows[0] = SealedRow(
            record_id=original.record_id,
            parent_lineage_id=original.parent_lineage_id,
            partition="test-ooa",
            feature_indices=original.feature_indices,
            feature_values=original.feature_values,
            class_number=original.class_number,
            is_novel=original.is_novel,
            supported=original.supported,
            verb_index=original.verb_index,
            object_index=original.object_index,
            transition_property_index=original.transition_property_index,
            application_family_id="syn-ooa",
        )
    elif mutate == "duplicate-record":
        rows.append(rows[0])
    return CanonicalDatasetSnapshot(
        dataset_hash=dataset_hash,
        vocabulary_hash=vocabulary_hash,
        sprint2_manifest_hash=sprint2_manifest_hash,
        support_matrix_version=support_matrix_version,
        feature_policy_version=feature_policy_version,
        rows=tuple(rows),
    )


@dataclass(frozen=True)
class InjectedCanonicalBuilder:
    """TEST-ONLY builder. Cannot reach the real FutureBench generator."""

    snapshot: CanonicalDatasetSnapshot

    def build_canonical_dataset(self) -> CanonicalDatasetSnapshot:
        return self.snapshot


class ProductionTrustedSealedSource:
    """Production source: derive from frozen FutureBench after a real-opening permit.

    Accepts no caller rows. ``builder`` is a test seam; omitting it selects the
    authoritative FutureBench generator, which tests in this session do not invoke.
    """

    source_kind = "production"

    def __init__(
        self,
        *,
        permit: RealOpeningPermit,
        builder: CanonicalDatasetBuilder | None = None,
    ) -> None:
        if type(permit) is not RealOpeningPermit:
            raise SealedOpeningNotEnabled(
                "production TrustedSealedSource requires a RealOpeningPermit"
            )
        self._permit = permit
        self._builder = builder
        self._consumed = False

    def materialize(self, authorization: DualFamilyAuthorization) -> _RawSnapshot:
        _require_complete_authorization(authorization)
        if (
            self._permit.artifact_manifest_sha256 != authorization.artifact_manifest_sha256
            or self._permit.preregistration_sha256 != authorization.preregistration_sha256
        ):
            raise SealedOpeningNotEnabled(
                "real-opening permit does not belong to this authorization"
            )
        if self._consumed:
            raise SealedCorpusUnavailable(
                "production sealed source is one-shot and already consumed"
            )
        self._consumed = True
        if self._builder is None:
            full = invoke_production_futurebench_builder()
        else:
            full = self._builder.build_canonical_dataset()
        return _derive_production_snapshot(full)


__all__ = [
    "FEATURE_DIMENSION",
    "FIXTURE_DATASET_HASH",
    "FIXTURE_PARTITION_COUNTS",
    "FIXTURE_SPRINT2_MANIFEST_HASH",
    "FIXTURE_VOCABULARY_HASH",
    "FROZEN_DATASET_HASH",
    "FROZEN_FEATURE_POLICY_VERSION",
    "FROZEN_SEALED_PARTITION_COUNTS",
    "FROZEN_SPRINT2_MANIFEST_HASH",
    "FROZEN_SUPPORT_MATRIX_VERSION",
    "FROZEN_VOCABULARY_HASH",
    "SealedCorpusUnavailable",
    "CallerRowSource",
    "CanonicalDatasetSnapshot",
    "FaultyFixtureSource",
    "FixtureTrustedSealedSource",
    "InjectedCanonicalBuilder",
    "ProductionTrustedSealedSource",
    "RealOpeningPermit",
    "authorize_real_opening",
    "invoke_production_futurebench_builder",
    "production_builder_invocation_count",
    "SealedCorpusIdentityMismatch",
    "SealedCorpusPartitionMismatch",
    "SealedCorpusRecordMismatch",
    "SealedOpeningNotEnabled",
    "SealedRow",
    "ValidatedSealedCorpus",
    "construct_validated_sealed_corpus",
    "_synthetic_production_rows",
]

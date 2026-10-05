"""Golden vectors: the Sprint-4 TypeScript parity fixtures.

Each vector records an input feature vector and every intermediate quantity the
TypeScript port must reproduce — raw logits, the factorized 10/9/10 head logits, the
composed 13 tuple logits, the temperature, the probabilities, the selected class, and
the confidence, margin, and entropy diagnostics. Recording intermediates rather than
only the final answer is what makes a parity failure diagnosable: if only the selected
class were stored, a port with a broken softmax and a coincidentally correct argmax
would pass.

Values are stored at full float64 precision via canonical JSON. The Sprint-4 ceiling
is 1e-6 absolute, so storing display-rounded numbers would cap achievable parity at
the rounding width and make the ceiling untestable.

Drawn from DEVELOPMENT partitions only, with the selection covering all 13 classes
plus the sparsest and densest available rows. No sealed record can appear: the corpus
object these are drawn from does not contain any.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

    from .corpus import DevelopmentCorpus, DevelopmentRow
    from .models import FactorizedModel, JointModel

from .calibration import apply_temperature, confidence_diagnostics, stable_softmax
from .canonical import to_float, to_float_vector
from .corpus import CALIBRATION, POLICY_VALIDATION, TRAIN

GOLDEN_VECTOR_SCHEMA_VERSION = "1.0"
PARITY_ABSOLUTE_TOLERANCE = 1e-6


def _dense(row: DevelopmentRow, feature_count: int) -> NDArray[np.float64]:
    import numpy as np

    vector = np.zeros((1, feature_count), dtype=np.float64)
    for index, value in zip(row.feature_indices, row.feature_values, strict=True):
        vector[0, index] = value
    return vector


def select_golden_rows(corpus: DevelopmentCorpus) -> tuple[DevelopmentRow, ...]:
    """Choose a deterministic, class-covering sample from the development partitions.

    One row per class, taken in a fixed partition order and then by record id, plus
    the globally sparsest and densest rows. Deterministic selection matters as much as
    coverage: a sample that shifted between runs would make the golden file change
    without the model changing.
    """
    chosen: dict[str, DevelopmentRow] = {}

    for partition in (TRAIN, CALIBRATION, POLICY_VALIDATION):
        rows = sorted(corpus.partition_view(partition), key=lambda row: row.record_id)
        for class_number in corpus.class_numbers:
            if any(row.class_number == class_number for row in chosen.values()):
                continue
            for row in rows:
                if row.class_number == class_number:
                    chosen[row.record_id] = row
                    break

    every = sorted(corpus.rows, key=lambda row: (len(row.feature_indices), row.record_id))
    sparsest = every[0]
    densest = every[-1]
    chosen.setdefault(sparsest.record_id, sparsest)
    chosen.setdefault(densest.record_id, densest)

    return tuple(sorted(chosen.values(), key=lambda row: row.record_id))


def build_golden_vectors(
    corpus: DevelopmentCorpus,
    joint: JointModel,
    joint_temperature: float,
    factorized: FactorizedModel,
    factorized_temperature: float,
) -> dict[str, Any]:
    """Build the full golden-vector document for both families."""
    import numpy as np

    class_order = list(corpus.class_numbers)
    feature_count = len(corpus.feature_order)
    rows = select_golden_rows(corpus)

    vectors: list[dict[str, Any]] = []
    for row in rows:
        design = _dense(row, feature_count)

        entry: dict[str, Any] = {
            "recordId": row.record_id,
            "parentLineageId": row.parent_lineage_id,
            "partition": row.partition,
            "actualClassNumber": row.class_number,
            "activeFeatureCount": len(row.feature_indices),
            "featureIndices": [int(index) for index in row.feature_indices],
            "featureValues": to_float_vector(row.feature_values),
            "families": {},
        }

        for family, model, temperature in (
            ("joint-logistic", joint, joint_temperature),
            ("factorized-logistic", factorized, factorized_temperature),
        ):
            raw = model.tuple_logits(design)
            scaled = apply_temperature(raw, temperature)
            probabilities = stable_softmax(scaled)
            confidence, margin, entropy = confidence_diagnostics(probabilities)
            selected_index = int(np.argmax(probabilities[0]))

            payload: dict[str, Any] = {
                "calibratedConfidence": to_float(confidence[0]),
                "normalizedEntropy": to_float(entropy[0]),
                "probabilities": to_float_vector(probabilities[0]),
                "rawTupleLogits": to_float_vector(raw[0]),
                "scaledTupleLogits": to_float_vector(scaled[0]),
                "selectedClassNumber": class_order[selected_index],
                "temperature": to_float(temperature),
                "topTwoMargin": to_float(margin[0]),
            }
            if family == "factorized-logistic":
                verb, obj, prop = factorized.head_logits(design)
                payload["rawHeadLogits"] = {
                    "objectKind": to_float_vector(obj[0]),
                    "transitionProperty": to_float_vector(prop[0]),
                    "verb": to_float_vector(verb[0]),
                }
                payload["composedTupleLogits"] = to_float_vector(raw[0])
            entry["families"][family] = payload

        vectors.append(entry)

    # An unknown feature index must be ignored, not crash and not shift the vector.
    # Constructed from a development row by appending an out-of-vocabulary index,
    # which is how an unseen token behaves at runtime after the projector drops it.
    base = rows[0]
    unknown_case = {
        "description": (
            "an index beyond the frozen 370-feature vocabulary is ignored; logits must "
            "equal those of the same row without it"
        ),
        "recordId": base.record_id,
        "featureIndices": [int(index) for index in base.feature_indices],
        "outOfVocabularyIndices": [feature_count, feature_count + 7],
        "expectedEqualToRecordId": base.record_id,
    }

    return {
        "schemaVersion": GOLDEN_VECTOR_SCHEMA_VERSION,
        "parityAbsoluteTolerance": PARITY_ABSOLUTE_TOLERANCE,
        "datasetHash": corpus.dataset_hash,
        "vocabularyHash": corpus.vocabulary_hash,
        "supportMatrixVersion": corpus.support_matrix_version,
        "featurePolicyVersion": corpus.feature_policy_version,
        "classOrder": class_order,
        # Head index targets travel with the vectors so the additive composition can
        # be re-derived from this file alone. Without them a TypeScript port could
        # compare composed logits but could not check that it mapped class k to the
        # right verb, object, and property rows.
        "classHeadTargets": [
            {
                "classNumber": number,
                "verbIndex": verb,
                "objectIndex": obj,
                "transitionPropertyIndex": prop,
            }
            for number, (verb, obj, prop) in (
                (number, corpus.head_targets_for_class(number)) for number in class_order
            )
        ],
        "verbOrder": list(corpus.verb_order),
        "objectOrder": list(corpus.object_order),
        "transitionPropertyOrder": list(corpus.transition_property_order),
        # Observed, not declared. The eligible set is the three development
        # partitions, but only some of them contribute rows once the selection rule
        # has picked one example per class, and listing the eligible set here would
        # read as a statement about the vectors that is not true of them. The same
        # distinction makes `sealedPartitionsUsed` meaningful: it is empty because
        # nothing was found, not because it was hard-coded empty.
        "partitionsEligible": [TRAIN, CALIBRATION, POLICY_VALIDATION],
        "partitionsUsed": sorted({row.partition for row in rows}),
        "sealedPartitionsUsed": sorted(
            {row.partition for row in rows} - {TRAIN, CALIBRATION, POLICY_VALIDATION}
        ),
        "classesCovered": sorted({row.class_number for row in rows}),
        "vectorCount": len(vectors),
        "vectors": vectors,
        "unknownFeatureCase": unknown_case,
    }

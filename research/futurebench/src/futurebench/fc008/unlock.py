"""The fail-closed contract for opening the sealed final-test partitions.

HOW THE TRUST ROOT WAS BUILT UP (A2, then A3)

The first version took two dictionaries from the caller: the identities it *claimed*
to hold and the identities it *expected* those to equal. Those are not independent
facts. A caller supplying both defines its own trust root, so the comparison proved
only self-consistency, which is trivially satisfied by deriving both sides from the
same loaded files. Nothing named a model family either, so a token obtained while
holding the joint triplet carried no evidence of that and could be presented with the
factorized artifacts.

A2 fixed those two: expectations moved to a reader of the checked-in manifest, and
authorization became per family. But A2 left three gaps that B2 found, and A3 closes
them, because A2's root of trust was still reachable by a caller:

1. The manifest PATH was a parameter. A caller could point authorization at any
   manifest it liked, and a self-consistent fake in a temporary directory would build
   a registry and authorize. The production path now resolves the manifest from this
   module's own location and takes no path argument at all, so there is no parameter
   left to redirect.

2. The manifest was never checked against anything OUTSIDE itself. Re-deriving each
   artifact hash from disk catches a manifest that disagrees with its own files, but
   not a manifest that is internally perfect and wholly substituted. The manifest
   bytes are now pinned to :data:`FROZEN_FC008_ARTIFACT_MANIFEST_SHA256`, a constant
   in source rather than a field in the file being verified. A file cannot declare its
   own trustworthiness.

3. The manifest's top-level identities were never compared to the artifact bodies.
   The three artifacts of a family were checked for agreement with each other, so a
   manifest claiming one dataset while every artifact was built from another passed.
   Those four shared identities are now cross-checked manifest-to-body for all six
   artifacts, which is the specific contradiction B2 raised.

TRUST BOUNDARY, STATED HONESTLY

The anchor is a constant in version-controlled source, so the claim is now: a caller
cannot substitute the trust root, and a swapped or edited manifest is detected. What
this still cannot do is defend against someone who can rewrite this source file
alongside the artifacts -- at that point the anchor moves with the attack. That is
repository integrity, enforced by review and version control, and no in-process check
can bootstrap it. The guarantee is about callers and files, not about commits.

NOT INVOKED IN SPRINT 3. No training or artifact-generation code path calls anything
here, and a test asserts it by parsing the trainer's syntax tree.
"""

from __future__ import annotations

import inspect
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canonical import sha256_hex

#: The active artifact directory, resolved from THIS module's location.
#:
#: ``parents[3]`` walks fc008 -> futurebench -> src -> research/futurebench. Deliberately
#: not derived from the working directory, ``sys.argv``, an environment variable, or an
#: argument: every one of those is caller-controlled, and the point of an anchor is that
#: it is not. Moving the package moves the anchor with it, which is correct, because the
#: artifacts travel in the same repository.
CANONICAL_ARTIFACT_DIRECTORY = Path(__file__).resolve().parents[3] / "artifacts"

#: The one manifest that defines the active frozen research state.
CANONICAL_ARTIFACT_MANIFEST_PATH = CANONICAL_ARTIFACT_DIRECTORY / "fc008-artifact-manifest.json"

#: Where superseded preregistrations are retained. Never consulted by authorization;
#: see :func:`load_trusted_research_identity`.
CANONICAL_ARTIFACT_HISTORY_DIRECTORY = CANONICAL_ARTIFACT_DIRECTORY / "history"

#: SHA-256 of the canonical artifact-manifest bytes.
#:
#: The external trust anchor. It lives in source, NOT in the manifest, because an
#: expected hash read from the file being verified would let the file vouch for itself.
#: Nothing recursive is introduced: the manifest does not contain its own hash, and the
#: existing artifact hash DAG is unchanged.
#:
#: If the manifest legitimately changes, this constant must be updated in the same
#: change. A test fails when they disagree, which is the intended coupling rather than
#: an inconvenience: it forces a manifest edit to be a deliberate, reviewed act.
FROZEN_FC008_ARTIFACT_MANIFEST_SHA256 = (
    "51879c7724ec28585e7802efcc9efe0c5a03222f9ba4105c0516f9094db92595"
)

#: Repository-level identities every family shares.
SHARED_IDENTITIES: tuple[str, ...] = (
    "datasetHash",
    "vocabularyHash",
    "supportMatrixVersion",
    "featurePolicyVersion",
    "preregistrationSha256",
)

#: The shared identities the manifest declares at top level AND every artifact body
#: repeats. Cross-checked in both directions; see :func:`_family_identity`.
#:
#: ``preregistrationSha256`` is absent on purpose: artifact bodies do not carry it, and
#: adding the field to them just to lengthen this tuple would be inventing a duplicate
#: identity rather than verifying an existing one.
CROSS_CHECKED_SHARED_IDENTITIES: tuple[str, ...] = (
    "datasetHash",
    "vocabularyHash",
    "supportMatrixVersion",
    "featurePolicyVersion",
)

#: Per-family artifact identities. All three must match for the requested family.
FAMILY_ARTIFACT_IDENTITIES: tuple[str, ...] = (
    "modelArtifactSha256",
    "calibrationArtifactSha256",
    "policyArtifactSha256",
)

#: Per-family version identities carried in the artifact bodies.
FAMILY_VERSION_IDENTITIES: tuple[str, ...] = (
    "modelVersion",
    "calibrationArtifactVersion",
    "abstentionPolicyVersion",
)

#: Everything an authorization binds, and everything the evaluation-time recheck
#: re-verifies. One list so the two checks cannot drift apart.
REQUIRED_IDENTITIES: tuple[str, ...] = (
    "modelFamily",
    *FAMILY_ARTIFACT_IDENTITIES,
    *FAMILY_VERSION_IDENTITIES,
    *SHARED_IDENTITIES,
)

FINAL_EVALUATION_MODE = "final-evaluation"
UNLOCK_CONTRACT_VERSION = "3.0"

JOINT_FAMILY = "joint-logistic"
FACTORIZED_FAMILY = "factorized-logistic"
REGISTERED_FAMILIES: tuple[str, ...] = (JOINT_FAMILY, FACTORIZED_FAMILY)


class FinalEvaluationLocked(RuntimeError):
    """Raised when final evaluation is attempted without a complete exact match."""


class FrozenIdentityUnavailable(RuntimeError):
    """Raised when the trusted frozen registry cannot be built or is inconsistent.

    Distinct from :class:`FinalEvaluationLocked` because the situations differ: one
    means the caller does not match the frozen state, the other means the frozen state
    itself could not be established. Collapsing them would let a substituted or
    self-contradictory manifest read as an ordinary authorization failure.
    """


@dataclass(frozen=True)
class FrozenFamilyIdentity:
    """The immutable artifact triplet and versions registered for one family."""

    model_family: str
    model_artifact_sha256: str
    calibration_artifact_sha256: str
    policy_artifact_sha256: str
    model_version: str
    calibration_artifact_version: str
    abstention_policy_version: str

    def to_canonical(self) -> dict[str, Any]:
        return {
            "abstentionPolicyVersion": self.abstention_policy_version,
            "calibrationArtifactSha256": self.calibration_artifact_sha256,
            "calibrationArtifactVersion": self.calibration_artifact_version,
            "modelArtifactSha256": self.model_artifact_sha256,
            "modelFamily": self.model_family,
            "modelVersion": self.model_version,
            "policyArtifactSha256": self.policy_artifact_sha256,
        }


@dataclass(frozen=True)
class FrozenResearchIdentity:
    """The trusted expected state, derived from the anchored manifest and artifacts."""

    dataset_hash: str
    vocabulary_hash: str
    support_matrix_version: str
    feature_policy_version: str
    preregistration_sha256: str
    families: dict[str, FrozenFamilyIdentity]

    def family(self, model_family: str) -> FrozenFamilyIdentity:
        """Look up one family, refusing an unregistered name rather than defaulting."""
        entry = self.families.get(model_family)
        if entry is None:
            raise FinalEvaluationLocked(
                f"final evaluation refused; {model_family!r} is not a registered model "
                f"family (registered: {sorted(self.families)})"
            )
        return entry

    def family_owning(self, **artifact_hashes: str) -> dict[str, str]:
        """Which registered family each supplied artifact hash belongs to, if any.

        Used only to turn an opaque hash mismatch into a message that names the actual
        owner, so a mixed-family triplet reports *which* artifact came from the wrong
        family instead of three unrelated-looking unequal strings.
        """
        owners: dict[str, str] = {}
        for label, value in artifact_hashes.items():
            for name, entry in self.families.items():
                if value in (
                    entry.model_artifact_sha256,
                    entry.calibration_artifact_sha256,
                    entry.policy_artifact_sha256,
                ):
                    owners[label] = name
                    break
        return owners


@dataclass(frozen=True)
class ArtifactContext:
    """What the caller actually loaded. Actuals only -- never expectations."""

    model_family: str
    model_artifact_sha256: str
    calibration_artifact_sha256: str
    policy_artifact_sha256: str
    model_version: str
    calibration_artifact_version: str
    abstention_policy_version: str
    dataset_hash: str
    vocabulary_hash: str
    support_matrix_version: str
    feature_policy_version: str
    preregistration_sha256: str


@dataclass(frozen=True)
class FinalEvaluationAuthorization:
    """An immutable, family-bound permit to evaluate the sealed partitions.

    Carries every identity it was granted against, including the three version
    dimensions. A2 omitted those from the token, which meant a version checked once at
    authorization was afterwards taken on trust -- so a model swapped for a different
    version of the same family, with the same artifact hashes recorded, had nothing left
    to contradict it. The token now carries them and
    :func:`assert_authorization_matches_artifacts` re-reads them.
    """

    mode: str
    model_family: str
    model_artifact_sha256: str
    calibration_artifact_sha256: str
    policy_artifact_sha256: str
    model_version: str
    calibration_artifact_version: str
    abstention_policy_version: str
    preregistration_sha256: str
    dataset_hash: str
    vocabulary_hash: str
    support_matrix_version: str
    feature_policy_version: str
    artifact_manifest_sha256: str
    unlock_contract_version: str = UNLOCK_CONTRACT_VERSION

    def to_canonical(self) -> dict[str, Any]:
        return {
            "abstentionPolicyVersion": self.abstention_policy_version,
            "artifactManifestSha256": self.artifact_manifest_sha256,
            "calibrationArtifactSha256": self.calibration_artifact_sha256,
            "calibrationArtifactVersion": self.calibration_artifact_version,
            "datasetHash": self.dataset_hash,
            "featurePolicyVersion": self.feature_policy_version,
            "mode": self.mode,
            "modelArtifactSha256": self.model_artifact_sha256,
            "modelFamily": self.model_family,
            "modelVersion": self.model_version,
            "policyArtifactSha256": self.policy_artifact_sha256,
            "preregistrationSha256": self.preregistration_sha256,
            "supportMatrixVersion": self.support_matrix_version,
            "unlockContractVersion": self.unlock_contract_version,
            "vocabularyHash": self.vocabulary_hash,
        }


def _require(document: dict[str, Any], key: str, where: str) -> str:
    value = document.get(key)
    if not isinstance(value, str) or not value:
        raise FrozenIdentityUnavailable(f"{where} is missing a usable {key!r}")
    return value


def _read_named_artifact(
    manifest: dict[str, Any], directory: Path, name: str
) -> tuple[dict[str, Any], str]:
    """Load one manifest-named artifact and re-derive its hash from the bytes on disk.

    The hash is computed here rather than read from the manifest entry, so a manifest
    disagreeing with its own files is caught instead of believed. The filename comes
    from the manifest entry, but no identity is taken from it: family, versions, and
    cross-references all come from the artifact body.

    Only the manifest's ``artifacts`` list is searched. Audit-history files are recorded
    elsewhere in the manifest and are therefore unreachable from here, which is what
    keeps a superseded preregistration from ever satisfying an active unlock.
    """
    entries = manifest.get("artifacts")
    if not isinstance(entries, list):
        raise FrozenIdentityUnavailable("artifact manifest has no 'artifacts' list")
    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("name") == name]
    if len(matches) != 1:
        raise FrozenIdentityUnavailable(
            f"artifact manifest names {name!r} {len(matches)} times; expected exactly once"
        )
    entry = matches[0]
    file_name = _require(entry, "fileName", f"manifest entry {name!r}")
    path = directory / file_name
    if not path.is_file():
        raise FrozenIdentityUnavailable(f"manifest names {file_name!r}, which is not on disk")

    raw = path.read_bytes()
    actual = sha256_hex(raw)
    recorded = _require(entry, "sha256", f"manifest entry {name!r}")
    if actual != recorded:
        raise FrozenIdentityUnavailable(
            f"{file_name} hashes to {actual}, but the manifest records {recorded}"
        )
    document = json.loads(raw.decode("utf-8"))
    if not isinstance(document, dict):
        raise FrozenIdentityUnavailable(f"{file_name} is not a JSON object")
    return document, actual


def _cross_check_shared_identities(
    manifest: dict[str, Any], model_family: str, bodies: tuple[tuple[str, dict[str, Any]], ...]
) -> None:
    """Require the manifest's top-level identities to equal every artifact body's.

    This is the B2 HIGH. Checking the three artifacts of a family against each other
    proves they were built together, but says nothing about the manifest, which is the
    document authorization reads its expectations from. A manifest declaring one dataset
    hash while all six artifacts were built from a different one was internally
    consistent, self-consistent with its own recorded file hashes, and accepted.

    Both directions fail here, because the comparison is between two independent
    sources: editing the manifest to contradict the bodies fails, and editing a body to
    contradict the manifest fails, even when the manifest's recorded file hash is
    updated to match the edited body.
    """
    for key in CROSS_CHECKED_SHARED_IDENTITIES:
        declared = _require(manifest, key, "artifact manifest")
        for label, body in bodies:
            found = _require(body, key, f"{model_family} {label} artifact")
            if found != declared:
                raise FrozenIdentityUnavailable(
                    f"{model_family} {label} artifact declares {key} {found!r}, but the "
                    f"manifest declares {declared!r}; manifest and artifact bodies must agree"
                )


def _family_identity(
    manifest: dict[str, Any], directory: Path, model_family: str
) -> FrozenFamilyIdentity:
    """Build one family's registry entry, validating the whole identity chain.

    Five independent things are checked, because any one passing alone leaves a gap.
    Each artifact must declare the family we asked for, so a file placed under the wrong
    name cannot be adopted. The calibration artifact must reference the model hash just
    computed, and the policy artifact must reference both, so the triplet is linked by
    content rather than by naming convention. The version fields must agree where two
    artifacts both carry them. The shared identities must agree across the triplet. And
    they must equal the manifest's top-level declarations.
    """
    model, model_sha = _read_named_artifact(manifest, directory, f"{model_family}-model")
    calibration, calibration_sha = _read_named_artifact(
        manifest, directory, f"{model_family}-calibration"
    )
    policy, policy_sha = _read_named_artifact(manifest, directory, f"{model_family}-policy")
    bodies = (("model", model), ("calibration", calibration), ("policy", policy))

    for label, document in bodies:
        declared = _require(document, "modelFamily", f"{model_family} {label} artifact")
        if declared != model_family:
            raise FrozenIdentityUnavailable(
                f"{model_family} {label} artifact declares modelFamily {declared!r}; "
                f"identity must come from the body, and the body disagrees"
            )

    if _require(calibration, "modelArtifactSha256", "calibration artifact") != model_sha:
        raise FrozenIdentityUnavailable(
            f"{model_family} calibration artifact references a different model artifact"
        )
    if _require(policy, "modelArtifactSha256", "policy artifact") != model_sha:
        raise FrozenIdentityUnavailable(
            f"{model_family} policy artifact references a different model artifact"
        )
    if _require(policy, "calibrationArtifactSha256", "policy artifact") != calibration_sha:
        raise FrozenIdentityUnavailable(
            f"{model_family} policy artifact references a different calibration artifact"
        )

    # All three bodies carry modelVersion, and the policy repeats the calibration's
    # version. Verified rather than assumed, so a re-versioned artifact cannot be
    # slotted into a triplet whose hashes were updated to match.
    model_version = _require(model, "modelVersion", "model artifact")
    for label, document in (("calibration", calibration), ("policy", policy)):
        found = _require(document, "modelVersion", f"{model_family} {label} artifact")
        if found != model_version:
            raise FrozenIdentityUnavailable(
                f"{model_family} {label} artifact declares modelVersion {found!r}, but the "
                f"model artifact declares {model_version!r}"
            )
    calibration_version = _require(
        calibration, "calibrationArtifactVersion", "calibration artifact"
    )
    policy_calibration_version = _require(policy, "calibrationArtifactVersion", "policy artifact")
    if policy_calibration_version != calibration_version:
        raise FrozenIdentityUnavailable(
            f"{model_family} policy artifact declares calibrationArtifactVersion "
            f"{policy_calibration_version!r}, but the calibration artifact declares "
            f"{calibration_version!r}"
        )

    for key in CROSS_CHECKED_SHARED_IDENTITIES:
        values = {_require(body, key, f"{label} artifact") for label, body in bodies}
        if len(values) != 1:
            raise FrozenIdentityUnavailable(
                f"{model_family} triplet disagrees on {key}: {sorted(values)}"
            )
    _cross_check_shared_identities(manifest, model_family, bodies)

    return FrozenFamilyIdentity(
        model_family=model_family,
        model_artifact_sha256=model_sha,
        calibration_artifact_sha256=calibration_sha,
        policy_artifact_sha256=policy_sha,
        model_version=model_version,
        calibration_artifact_version=calibration_version,
        abstention_policy_version=_require(policy, "abstentionPolicyVersion", "policy artifact"),
    )


def load_frozen_research_identity(manifest_path: Path) -> FrozenResearchIdentity:
    """Parse and validate a manifest at an explicit path. NOT the production trust root.

    Exposed because the validation logic has to be testable against deliberately
    corrupted manifests, which means building them somewhere writable. It performs every
    consistency check but deliberately does NOT verify the external trust anchor, since
    a mutated fixture will never match it.

    Production code must call :func:`load_trusted_research_identity` instead, and
    :func:`authorize_final_evaluation` has no parameter through which this function's
    result could be substituted. Accepting a path here is therefore not a hole: nothing
    a caller builds this way can reach an authorization.
    """
    if not manifest_path.is_file():
        raise FrozenIdentityUnavailable(f"artifact manifest not found at {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise FrozenIdentityUnavailable("artifact manifest is not a JSON object")

    directory = manifest_path.parent
    preregistration, preregistration_sha = _read_named_artifact(
        manifest, directory, "preregistration"
    )
    recorded_preregistration = _require(manifest, "preregistrationSha256", "artifact manifest")
    if recorded_preregistration != preregistration_sha:
        raise FrozenIdentityUnavailable(
            f"manifest records preregistrationSha256 {recorded_preregistration}, but the "
            f"preregistration artifact hashes to {preregistration_sha}"
        )
    if preregistration.get("finalTestResultsPresent") is not False:
        raise FrozenIdentityUnavailable(
            "the frozen preregistration does not assert finalTestResultsPresent: false"
        )

    # A superseded preregistration must never be the active identity. The history
    # entries are outside the 'artifacts' list already, so this cannot currently fire;
    # it is here so that a future change which merged the two lists fails loudly rather
    # than quietly authorizing against an amended-away protocol.
    for record in manifest.get("auditHistory", []):
        if not isinstance(record, dict):
            continue
        if record.get("sha256") == preregistration_sha:
            raise FrozenIdentityUnavailable(
                f"the active preregistration {preregistration_sha} is also recorded as "
                f"superseded audit history; historical bytes cannot be the active identity"
            )

    families = {
        model_family: _family_identity(manifest, directory, model_family)
        for model_family in REGISTERED_FAMILIES
    }

    return FrozenResearchIdentity(
        dataset_hash=_require(manifest, "datasetHash", "artifact manifest"),
        vocabulary_hash=_require(manifest, "vocabularyHash", "artifact manifest"),
        support_matrix_version=_require(manifest, "supportMatrixVersion", "artifact manifest"),
        feature_policy_version=_require(manifest, "featurePolicyVersion", "artifact manifest"),
        preregistration_sha256=preregistration_sha,
        families=families,
    )


def read_canonical_manifest_sha256() -> str:
    """SHA-256 of the anchored manifest's current bytes, with no comparison."""
    if not CANONICAL_ARTIFACT_MANIFEST_PATH.is_file():
        raise FrozenIdentityUnavailable(
            f"canonical artifact manifest not found at {CANONICAL_ARTIFACT_MANIFEST_PATH}"
        )
    return sha256_hex(CANONICAL_ARTIFACT_MANIFEST_PATH.read_bytes())


def load_trusted_research_identity() -> tuple[FrozenResearchIdentity, str]:
    """Build the trusted expected identity. Takes no arguments, by design.

    The production trust root. There is nothing to pass, so there is nothing to
    redirect: the path comes from this module's location and the expected manifest hash
    from a source constant. Returns the identity and the verified manifest hash, so the
    authorization can record which manifest state it was granted under.
    """
    if not CANONICAL_ARTIFACT_MANIFEST_PATH.is_file():
        raise FrozenIdentityUnavailable(
            f"canonical artifact manifest not found at {CANONICAL_ARTIFACT_MANIFEST_PATH}"
        )
    actual = sha256_hex(CANONICAL_ARTIFACT_MANIFEST_PATH.read_bytes())
    if actual != FROZEN_FC008_ARTIFACT_MANIFEST_SHA256:
        raise FrozenIdentityUnavailable(
            f"canonical artifact manifest hashes to {actual}, but the frozen trust anchor "
            f"expects {FROZEN_FC008_ARTIFACT_MANIFEST_SHA256}; refusing to build a registry "
            f"from an unanchored manifest"
        )
    return load_frozen_research_identity(CANONICAL_ARTIFACT_MANIFEST_PATH), actual


def authorize_final_evaluation(
    *,
    mode: str,
    model_family: str,
    actual: ArtifactContext,
) -> FinalEvaluationAuthorization:
    """Authorize evaluation of the sealed partitions for ONE family, or refuse.

    The caller supplies only what it loaded. There is no ``frozen`` parameter and no
    ``manifest_path`` parameter, which is the whole of the A3 correction: the expected
    state is fetched internally from the anchored manifest, so a caller cannot define,
    redirect, or substitute the trust root. A test introspects this signature to keep
    it that way.

    Raises rather than returning an unauthorized token. A caller that ignored a falsy
    return would proceed to evaluate test data, so the refusal path is not expressible
    as a value that can be discarded.
    """
    if mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationLocked(
            f"final evaluation requires mode {FINAL_EVALUATION_MODE!r}, got {mode!r}"
        )

    frozen, manifest_sha = load_trusted_research_identity()
    expected = frozen.family(model_family)

    # The requested family and the loaded artifacts must be the same family. Checked
    # before the hashes so the error names the real problem instead of reporting three
    # unrelated-looking hash mismatches.
    if actual.model_family != model_family:
        raise FinalEvaluationLocked(
            f"final evaluation refused; authorization requested for {model_family!r} but "
            f"the loaded artifacts declare {actual.model_family!r}"
        )

    owners = frozen.family_owning(
        modelArtifactSha256=actual.model_artifact_sha256,
        calibrationArtifactSha256=actual.calibration_artifact_sha256,
        policyArtifactSha256=actual.policy_artifact_sha256,
    )
    foreign = sorted(
        f"{label} belongs to {owner}" for label, owner in owners.items() if owner != model_family
    )
    if foreign:
        raise FinalEvaluationLocked(
            f"final evaluation refused; mixed-family artifact triplet for {model_family!r}: "
            + ", ".join(foreign)
        )

    mismatches: list[str] = []
    for key, supplied, required in (
        ("modelArtifactSha256", actual.model_artifact_sha256, expected.model_artifact_sha256),
        (
            "calibrationArtifactSha256",
            actual.calibration_artifact_sha256,
            expected.calibration_artifact_sha256,
        ),
        ("policyArtifactSha256", actual.policy_artifact_sha256, expected.policy_artifact_sha256),
        ("modelVersion", actual.model_version, expected.model_version),
        (
            "calibrationArtifactVersion",
            actual.calibration_artifact_version,
            expected.calibration_artifact_version,
        ),
        (
            "abstentionPolicyVersion",
            actual.abstention_policy_version,
            expected.abstention_policy_version,
        ),
        ("datasetHash", actual.dataset_hash, frozen.dataset_hash),
        ("vocabularyHash", actual.vocabulary_hash, frozen.vocabulary_hash),
        ("supportMatrixVersion", actual.support_matrix_version, frozen.support_matrix_version),
        (
            "featurePolicyVersion",
            actual.feature_policy_version,
            frozen.feature_policy_version,
        ),
        (
            "preregistrationSha256",
            actual.preregistration_sha256,
            frozen.preregistration_sha256,
        ),
    ):
        if not supplied:
            mismatches.append(f"{key} (absent)")
        elif supplied != required:
            mismatches.append(key)

    if mismatches:
        raise FinalEvaluationLocked(
            f"final evaluation refused for {model_family!r}; identity mismatch on: "
            + ", ".join(mismatches)
        )

    return FinalEvaluationAuthorization(
        mode=mode,
        model_family=model_family,
        model_artifact_sha256=expected.model_artifact_sha256,
        calibration_artifact_sha256=expected.calibration_artifact_sha256,
        policy_artifact_sha256=expected.policy_artifact_sha256,
        model_version=expected.model_version,
        calibration_artifact_version=expected.calibration_artifact_version,
        abstention_policy_version=expected.abstention_policy_version,
        preregistration_sha256=frozen.preregistration_sha256,
        dataset_hash=frozen.dataset_hash,
        vocabulary_hash=frozen.vocabulary_hash,
        support_matrix_version=frozen.support_matrix_version,
        feature_policy_version=frozen.feature_policy_version,
        artifact_manifest_sha256=manifest_sha,
    )


def assert_authorization_matches_artifacts(
    authorization: FinalEvaluationAuthorization, actual: ArtifactContext
) -> None:
    """Re-check a token against the artifacts actually loaded at evaluation time.

    A token can travel: obtained in one place, used in another, possibly after a
    different model was loaded. This is what Sprint-4 evaluation calls immediately
    before touching a sealed partition.

    Every material identity is re-read, including the three version dimensions that A2
    verified at authorization and then stopped tracking. Nothing is trusted because it
    was checked earlier -- an earlier check is evidence about the artifacts that were
    loaded then, not about the ones loaded now.
    """
    if authorization.mode != FINAL_EVALUATION_MODE:
        raise FinalEvaluationLocked(
            f"authorization carries mode {authorization.mode!r}, not {FINAL_EVALUATION_MODE!r}"
        )

    mismatches = [
        key
        for key, permitted, loaded in (
            ("modelFamily", authorization.model_family, actual.model_family),
            (
                "modelArtifactSha256",
                authorization.model_artifact_sha256,
                actual.model_artifact_sha256,
            ),
            (
                "calibrationArtifactSha256",
                authorization.calibration_artifact_sha256,
                actual.calibration_artifact_sha256,
            ),
            (
                "policyArtifactSha256",
                authorization.policy_artifact_sha256,
                actual.policy_artifact_sha256,
            ),
            ("modelVersion", authorization.model_version, actual.model_version),
            (
                "calibrationArtifactVersion",
                authorization.calibration_artifact_version,
                actual.calibration_artifact_version,
            ),
            (
                "abstentionPolicyVersion",
                authorization.abstention_policy_version,
                actual.abstention_policy_version,
            ),
            (
                "preregistrationSha256",
                authorization.preregistration_sha256,
                actual.preregistration_sha256,
            ),
            ("datasetHash", authorization.dataset_hash, actual.dataset_hash),
            ("vocabularyHash", authorization.vocabulary_hash, actual.vocabulary_hash),
            (
                "supportMatrixVersion",
                authorization.support_matrix_version,
                actual.support_matrix_version,
            ),
            (
                "featurePolicyVersion",
                authorization.feature_policy_version,
                actual.feature_policy_version,
            ),
        )
        if permitted != loaded
    ]
    if mismatches:
        raise FinalEvaluationLocked(
            f"authorization for {authorization.model_family!r} does not match the loaded "
            f"artifacts; mismatch on: " + ", ".join(mismatches)
        )


def authorization_parameter_names() -> frozenset[str]:
    """Parameter names of :func:`authorize_final_evaluation`.

    A helper rather than inline introspection in the test, so the guarantee being
    asserted -- that no parameter can carry a caller-supplied trust root -- is stated
    in the module it constrains.
    """
    return frozenset(inspect.signature(authorize_final_evaluation).parameters)

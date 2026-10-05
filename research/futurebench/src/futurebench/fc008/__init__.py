"""FC-008 Sprint 3 offline reference training.

This package fits the FC-008 reference models and writes the canonical research
artifacts. It is OFFLINE research code: it reads the repository-local synthetic
development export, writes JSON into the research artifact directory, and has no
capability to browse, click, release, submit, mutate user files, or transmit
anything. Nothing here imports a network client.

The sealed partitions (``test-id``, ``test-ooa``, ``test-novelty``) are absent from
the input this package consumes. That is enforced on the TypeScript side of the
bridge and re-checked here, because a boundary asserted in one place is a boundary
that moves the first time someone adds a caller.
"""

FC008_SPRINT3_VERSION = "1.0"

__all__ = ["FC008_SPRINT3_VERSION"]

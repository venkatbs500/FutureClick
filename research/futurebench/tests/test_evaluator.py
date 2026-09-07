"""Unit tests verifying FutureBench evaluation harness placeholder."""

from futurebench import BenchmarkHarness, BenchmarkHarnessConfig


def test_harness_configuration() -> None:
    """Verify harness properly accepts configuration contracts."""
    config = BenchmarkHarnessConfig(dataset_name="futurebench-core-v0")
    harness = BenchmarkHarness(config)

    assert harness.is_configured is True
    assert harness.get_dataset_target() == "futurebench-core-v0"

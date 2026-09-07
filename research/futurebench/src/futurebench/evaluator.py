"""FutureBench harness placeholder and configuration contracts."""

from dataclasses import dataclass


@dataclass(frozen=True)
class BenchmarkHarnessConfig:
    """Configuration for FutureBench evaluation harness."""

    dataset_name: str
    sample_limit: int = 0
    strict_calibration: bool = True


class BenchmarkHarness:
    """Evaluates consequence prediction performance against structured datasets."""

    def __init__(self, config: BenchmarkHarnessConfig) -> None:
        self.config = config

    @property
    def is_configured(self) -> bool:
        """Indicate whether harness has valid dataset target."""
        return len(self.config.dataset_name) > 0

    def get_dataset_target(self) -> str:
        """Return the target benchmark dataset identifier."""
        return self.config.dataset_name

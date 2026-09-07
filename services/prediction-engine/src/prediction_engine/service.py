"""Prediction engine service placeholder."""

from dataclasses import dataclass


@dataclass(frozen=True)
class PredictionServiceStatus:
    """Status record indicating current prediction engine service operational state."""

    ready: bool
    version: str
    active_models_count: int


def get_service_status() -> PredictionServiceStatus:
    """Return initial baseline service status for FC-001."""
    return PredictionServiceStatus(
        ready=False,
        version="0.1.0",
        active_models_count=0,
    )

"""Unit tests verifying prediction engine placeholder service."""

from prediction_engine import get_service_status


def test_service_status_initialization() -> None:
    """Verify default status indicates engine is uninitialized and has zero active models."""
    status = get_service_status()
    assert status.ready is False
    assert status.version == "0.1.0"
    assert status.active_models_count == 0

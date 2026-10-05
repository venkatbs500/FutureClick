"""Pin the thread environment before NumPy loads, for test runs as well as training.

The native numeric libraries read their thread counts once, at load time, so this has
to happen before the first import that pulls them in — which under pytest is whichever
test module gets collected first. Leaving it to the invoking shell would mean the
determinism tests pass or fail depending on how pytest was launched.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from futurebench.fc008.environment import force_single_thread  # noqa: E402

force_single_thread()

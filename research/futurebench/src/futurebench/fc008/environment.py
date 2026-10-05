"""Thread control and reference-environment capture.

WHY THREADS ARE FORCED TO ONE

Multithreaded BLAS reduces floating-point sums in whatever order the threads finish
in, so the same fit can produce slightly different weights run to run. The
differences are tiny and would not change a prediction, but they would change the
artifact bytes, and byte-identical artifacts are the only mechanism Sprint 4 has for
proving the TypeScript port reproduces the Python reference rather than merely
resembling it. So determinism here is not perfectionism; it is what makes the parity
test meaningful.

HOW SINGLE-THREADING IS ACTUALLY ACHIEVED

One mechanism, plus observation. There is no ``threadpool_limits`` context manager
anywhere in this package; an earlier version of this docstring claimed there was, which
was wrong and is corrected here.

What happens:

* :func:`force_single_thread` sets five environment variables before NumPy is imported.
  This is the only *control* mechanism. It has to run first because the native
  libraries read their thread counts once, at load time.
* :func:`verify_single_thread` then *observes* the loaded pools through
  ``threadpoolctl.threadpool_info()`` and raises if any reports more than one thread,
  or if it reports nothing at all.

WHAT IS AND IS NOT INDEPENDENTLY CONFIRMED — stated precisely, because the two
libraries involved are not equally observable:

* **OpenMP** is confirmed. ``threadpoolctl`` reports it, and this environment observes
  it at ``num_threads: 1``.
* **Accelerate**, which is the BLAS and LAPACK backend on this reference machine, is
  constrained through ``VECLIB_MAXIMUM_THREADS=1``. ``threadpoolctl`` does **not**
  enumerate Accelerate, so it never appears in ``threadpool_info()`` output and its
  thread count is not independently read back.

Therefore: Accelerate single-threading is **environment-configured, not independently
confirmed by threadpoolctl**. The honest claim is that the configuration is applied and
that the determinism it is meant to produce is verified downstream by the byte-identical
rebuild check, which would fail if Accelerate were in fact reducing sums concurrently.
``threadpool_limits`` is deliberately not added just to make the old sentence true:
it would not observe Accelerate either, so it would add a second control path without
adding any confirmation.
"""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass
from typing import Any

THREAD_ENVIRONMENT_VARIABLES = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS",
)


def force_single_thread() -> None:
    """Pin every known thread-pool environment variable to 1.

    Assigns unconditionally rather than using ``setdefault``. An ambient value of 8
    inherited from the shell is exactly the situation this is meant to defeat, and a
    default-only assignment would respect it.

    Must be called before NumPy is imported to have full effect.
    """
    for name in THREAD_ENVIRONMENT_VARIABLES:
        os.environ[name] = "1"


def verify_single_thread() -> list[dict[str, Any]]:
    """Observe the loaded thread pools, raising if the check is vacuous or violated.

    Observation only. This function sets no limits; :func:`force_single_thread` already
    did that through the environment, before the libraries loaded.

    The native libraries are imported here FIRST, deliberately. ``threadpool_info``
    only reports pools that have actually been loaded, and the numeric libraries load
    lazily, so calling this before importing them returns an empty list — which then
    passes a "no pool exceeds one thread" test without having inspected anything. An
    empty result is therefore treated as a failure rather than a pass: a verification
    that cannot fail is not a verification.

    Scope limit worth knowing when reading the result: ``threadpoolctl`` enumerates
    OpenMP and the BLAS implementations it knows how to introspect. It does not
    enumerate Accelerate, so on this reference machine the returned list confirms
    OpenMP and says nothing about the BLAS backend, which is constrained by
    ``VECLIB_MAXIMUM_THREADS`` instead.
    """
    import numpy  # noqa: F401  (imported for its side effect of loading BLAS)
    import sklearn.linear_model  # noqa: F401  (loads the OpenMP runtime)
    import threadpoolctl

    pools: list[dict[str, Any]] = [dict(entry) for entry in threadpoolctl.threadpool_info()]
    if not pools:
        raise RuntimeError(
            "threadpoolctl reported no thread pools, so the single-thread requirement "
            "was not actually verified"
        )
    offenders = [pool for pool in pools if int(pool.get("num_threads", 1)) != 1]
    if offenders:
        detail = ", ".join(
            f"{pool.get('internal_api')}={pool.get('num_threads')}" for pool in offenders
        )
        raise RuntimeError(f"expected every thread pool to report 1 thread; found {detail}")
    return pools


@dataclass(frozen=True)
class ReferenceEnvironment:
    """The toolchain identity byte-identical artifacts are promised against.

    Recorded from the live interpreter rather than written by hand, because a
    hand-maintained environment block is a claim and a measured one is evidence.
    """

    python_version: str
    python_implementation: str
    os_name: str
    os_release: str
    platform_descriptor: str
    cpu_architecture: str
    numpy_version: str
    scikit_learn_version: str
    scipy_version: str
    joblib_version: str
    threadpoolctl_version: str
    blas_name: str
    lapack_name: str
    thread_limit: int

    def to_canonical(self) -> dict[str, Any]:
        return {
            "blasName": self.blas_name,
            "cpuArchitecture": self.cpu_architecture,
            "joblibVersion": self.joblib_version,
            "lapackName": self.lapack_name,
            "numpyVersion": self.numpy_version,
            "osName": self.os_name,
            "osRelease": self.os_release,
            "platformDescriptor": self.platform_descriptor,
            "pythonImplementation": self.python_implementation,
            "pythonVersion": self.python_version,
            "scikitLearnVersion": self.scikit_learn_version,
            "scipyVersion": self.scipy_version,
            "threadLimit": self.thread_limit,
            "threadpoolctlVersion": self.threadpoolctl_version,
        }


def _blas_identity() -> tuple[str, str]:
    import numpy

    try:
        config = numpy.__config__.show(mode="dicts")
    except Exception:  # pragma: no cover - defensive, NumPy build without config
        return ("unknown", "unknown")
    if not isinstance(config, dict):  # pragma: no cover - defensive
        return ("unknown", "unknown")
    build = config.get("Build Dependencies", {})
    blas = build.get("blas", {}) if isinstance(build, dict) else {}
    lapack = build.get("lapack", {}) if isinstance(build, dict) else {}
    blas_name = str(blas.get("name", "unknown")) if isinstance(blas, dict) else "unknown"
    lapack_name = str(lapack.get("name", "unknown")) if isinstance(lapack, dict) else "unknown"
    return (blas_name, lapack_name)


def capture_reference_environment() -> ReferenceEnvironment:
    """Read the live environment. Never invents a value."""
    import joblib
    import numpy
    import scipy
    import sklearn
    import threadpoolctl

    blas_name, lapack_name = _blas_identity()
    return ReferenceEnvironment(
        python_version=platform.python_version(),
        python_implementation=platform.python_implementation(),
        os_name=platform.system(),
        os_release=platform.release(),
        platform_descriptor=platform.platform(),
        cpu_architecture=platform.machine(),
        numpy_version=numpy.__version__,
        scikit_learn_version=sklearn.__version__,
        scipy_version=scipy.__version__,
        joblib_version=joblib.__version__,
        threadpoolctl_version=threadpoolctl.__version__,
        blas_name=blas_name,
        lapack_name=lapack_name,
        thread_limit=1,
    )

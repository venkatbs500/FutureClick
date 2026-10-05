# FutureBench Research Benchmark

Evaluation harness and structured benchmark dataset for human-centered consequence prediction.

## Eventual Responsibilities

FutureBench will serve as the rigorous empirical testbed for evaluating consequence prediction models and heuristics across desktop, browser, and OS actions.

It will eventually store and evaluate structured benchmark examples containing:
- **current state:** Operating system, window hierarchy, focus state, active application context.
- **proposed action:** Intentional user action (click, keystroke, submission, deletion, permission change).
- **actual outcome:** Ground-truth post-execution state transition and environmental mutation.
- **predicted outcome:** State transition predicted by candidate models/heuristics prior to execution.
- **affected objects:** Files, cloud resources, database records, network sockets, permissions altered.
- **reversibility:** Ground-truth classification (fully reversible, partially reversible, irreversible).
- **risk:** Empirical consequence severity and blast radius.
- **confidence:** Model-generated confidence calibration curve.
- **provenance:** Complete evaluation audit trail (model version, prompt/rule weights, evaluation timestamp).

## Generated directories: `artifacts/` and `data/`

Both contain **canonical JSON** produced by `futurebench.fc008.train` and the
TypeScript development-corpus exporter. Do not hand-edit them and do not run a
formatter over them: every file is hashed, and those SHA-256 values are recorded in
`artifacts/fc008-artifact-manifest.json` and referenced by the calibration, policy,
and preregistration artifacts. Reformatting changes the bytes and so silently
invalidates every identity that points at them.

Both directories are therefore excluded from Biome in `biome.json` at the repository
root. Their correctness is checked by the Python test suite instead, which verifies
that each file on disk is already canonical, that every recorded hash and byte length
matches, and that two separate training processes produce byte-identical output.

To regenerate:

```bash
pnpm tsx packages/futurebench-dataset/scripts/export-development-corpus.ts
cd research/futurebench && uv run --locked python -m futurebench.fc008.train
```

The trainer pins every numeric thread pool to one thread before NumPy loads. Byte
identity is promised for the pinned reference environment recorded inside each
artifact, not across arbitrary platforms.

## Scientific Integrity and FC-001 Policy

- **No fake benchmark data:** Fake datasets or synthetic benchmark claims have been intentionally excluded.
- **No benchmark results or performance claims:** FutureBench is strictly in foundation configuration. Real benchmark datasets and metrics will be published only after reproducible evaluation protocols are finalized.

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

## Scientific Integrity and FC-001 Policy

- **No fake benchmark data:** Fake datasets or synthetic benchmark claims have been intentionally excluded.
- **No benchmark results or performance claims:** FutureBench is strictly in foundation configuration. Real benchmark datasets and metrics will be published only after reproducible evaluation protocols are finalized.

# FutureClick Prediction Engine Service

Python runtime service boundary for consequence prediction model inference and evaluation serving.

## Eventual Responsibilities

This service establishes the dedicated runtime and inference service boundary within FutureClick:
- Host consequence prediction models and evaluation serving runtimes.
- Score consequence likelihood, multi-step branching, and uncertainty distributions.
- Produce calibrated `ConfidenceScore` outputs and verifiable `PredictionProvenance` metadata.
- Expose local IPC / RPC endpoints for consumption by `@futureclick/consequence-engine`.

## Architectural Boundary Notice

- **Runtime vs. Research Separation:** `services/prediction-engine` is the operational service boundary. Exploratory research, experimental modeling scratchpads, dataset generation, and evaluation benchmarks strictly belong under `research/` (e.g., `research/futurebench`), not inside runtime services.
- **Sprint FC-001 / FC-001A Scope:** No inference engines, model weights, or machine learning frameworks (PyTorch, TensorFlow, transformers, LLM SDKs) are implemented in this sprint. The service contains only foundational type contracts and deterministic service status checks.

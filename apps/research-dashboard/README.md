# @futureclick/research-dashboard

Internal evaluation and experimental visualization interface for FutureClick.

## Eventual Responsibilities

This application will support scientific evaluation, developer observability, and benchmark analysis:
- Visualize ActionGraph nodes, dependency chains, and consequence trees.
- Review FutureBench experiment outcomes, prediction calibration curves, and latency metrics.
- Support human-in-the-loop qualitative review of consequence previews.
- Contrast verified vs. simulated vs. predicted consequence classifications across benchmark suites.

## Architectural Boundaries

- No polished or heavy UI framework is introduced in Sprint FC-001.
- The dashboard is decoupled from model training and prediction execution, communicating via standardized schemas and evaluation logs.

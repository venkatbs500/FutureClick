# FutureClick Engineering Principles

FutureClick is intended to become a real software company and a serious computer-science research project, not a hackathon prototype. Every architectural decision, schema contract, and codebase addition must reflect this long-term commitment.

The following engineering principles guide all development:

## 1. Real Company & Research Project Stance
We build for durability. Architecture must be designed to withstand years of active engineering and research iteration. Code must be structured for clarity, maintainability, and thorough testability rather than superficial expediency.

## 2. Demo Shortcuts Must Not Silently Become Production Architecture
Temporary hacks and demo workarounds tend to fossilize into technical debt. If a shortcut is strictly necessary for an isolated proof-of-concept, it must be quarantined, explicitly annotated, and prevented from leaking into core domain schemas or long-lived services.

## 3. Prefer Replaceable Interfaces Around Models and Providers
AI models, inference runtimes, and embedding providers evolve rapidly. The core domain layer (`@futureclick/action-schema`, `@futureclick/consequence-engine`) must never couple to specific vendor SDKs, proprietary model signatures, or hosted APIs. Model interactions must sit behind modular, swappable interfaces.

## 4. Avoid Vendor Lock-In in the Core Domain Model
The representations of state, actions, consequences, targets, and evidence are foundational data assets of FutureClick. They must remain vendor-neutral, portable, and decoupled from cloud ecosystems, proprietary database formats, or vendor-specific graph engines.

## 5. Privacy and Security Are Product Features
Privacy is not compliance overhead—it is a core selling proposition and a foundational user right. A system that predicts consequences must earn user trust by keeping processing local, actively excluding password fields at trust boundaries using multiple defensive signals, redacting sensitive fields, and providing full transparency.

## 6. Observability Must Eventually Be Built In
Every consequence evaluation, state extraction, and graph traversal must produce structured telemetry, timing metrics, and provenance records. When unexpected behavior occurs, engineers and researchers must be able to trace exactly why an action was classified as verified, simulated, or predicted.

## 7. Every Major Feature Must Have Acceptance Tests
No feature is complete without automated verification. Unit tests must cover deterministic logic; integration tests must validate inter-package contracts; benchmark tests must track evaluation regression. Tests must run deterministically without external network or credential dependencies.

## 8. Research Experiments Must Be Reproducible
Scientific integrity is paramount. Research scripts, benchmark datasets (`research/futurebench`), and model evaluations must specify exact seeds, data splits, environment versions, and evaluation protocols. Results must be repeatable by independent reviewers.

## 9. Fake Metrics Must Never Appear in Product or Research Claims
We do not publish or market unverified numbers, synthetic benchmark wins, or simulated accuracy claims. If a metric has not been rigorously measured on real, documented evaluation datasets, it does not exist.

## 10. Prototype Code Must Be Clearly Distinguished from Production Code
Experimental pipelines, scratchpads, and exploratory model scripts belong in dedicated research directories or explicitly tagged experimental modules. Experimental code must never be merged into release paths without formal hardening, typing, and test coverage.

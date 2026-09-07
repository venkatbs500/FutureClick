# FutureClick

> A human-centered consequence prediction system for computer interactions.

FutureClick is designed to analyze current system state and proposed digital actions before execution—predicting, simulating, or formally verifying likely consequences so users can proceed with certainty or catch irreversible errors before they happen.

---

## Current Status: Sprint FC-001 & FC-001A (Engineering Foundation & Corrections)

**Important Notice:** FutureClick is currently in early foundational engineering (`Sprint FC-001 / FC-001A`).

- **Consequence prediction has NOT been implemented yet.**
- **AI / LLM models have NOT been integrated yet.**
- **Browser interception and native OS accessibility APIs have NOT been implemented yet.**

This sprint establishes the production-quality monorepo architecture, provisional schema contracts, strict type systems, Python research workspace, testing harnesses, and quality gates required to support years of sustained engineering and scientific research.

---

## Architecture Summary

```
Platform Adapters (macOS, Windows, Browser Extension)
        ↓
State Capture (DOM, Accessibility Tree, Filesystem Handles)
        ↓
Canonical Action Representation (@futureclick/action-schema)
        ↓
ActionGraph Relational Model (@futureclick/action-graph)
        ↓
Consequence Engine (@futureclick/consequence-engine)
       ├── Verified (Deterministic derivation under defined assumptions)
       ├── Simulated (Sandboxed dry-runs in controlled environments)
       └── Predicted (Statistical models, learned inference with uncertainty)
        ↓
Risk / Reversibility / Confidence Scoring
        ↓
Human-Facing Preview Surface
```

### Tri-Modal Consequence Semantics
FutureClick maintains strict epistemological boundaries across evaluation modalities:
- **VERIFIED:** A consequence derived deterministically from available evidence within an explicitly defined scope and set of assumptions. It is NOT philosophical or unconditional certainty; verification may still fail if observed state is incomplete, underlying data is stale, platform behavior drifts, or core assumptions are violated.
- **SIMULATED:** A consequence observed in an isolated, sandboxed, or controlled execution context under specific test conditions; it does not guarantee that live environments will behave identically.
- **PREDICTED:** A probabilistic or model-derived consequence projection exposing bounded uncertainty; future evaluators may emit calibrated confidence values, but predictions must never be represented as verified fact.

Detailed architectural specifications and decisions are documented in:
- [Architecture Overview](docs/architecture/OVERVIEW.md)
- [Architecture Decision Records (ADRs)](docs/architecture/DECISIONS.md)
- [Company Engineering Principles](docs/architecture/ENGINEERING_PRINCIPLES.md)

---

## Repository Structure

```
FutureClick/
├── apps/
│   ├── browser-extension/      # Browser extension placeholder (CDP / WebExtensions)
│   ├── desktop/                # Desktop coordinator placeholder (macOS / Windows bridge)
│   └── research-dashboard/     # Evaluation & metrics telemetry dashboard placeholder
│
├── packages/
│   ├── action-schema/          # Canonical schemas (state, action, consequence, provenance)
│   ├── action-graph/           # Relational action-state-consequence graph representation
│   ├── consequence-engine/     # Tri-modal orchestrator (verified, simulated, predicted)
│   ├── privacy/                # Sensitive-field exclusion, password protection, redaction
│   └── shared/                 # Core cross-cutting primitives (Result, Brand, Timestamp)
│
├── services/
│   └── prediction-engine/      # Python runtime service boundary for future inference serving
│
├── native/
│   ├── macos/                  # Native macOS adapter documentation & future hooks
│   └── windows/                # Native Windows UIA adapter documentation & future hooks
│
├── research/
│   └── futurebench/            # Research benchmark dataset harness and evaluation suite
│
├── docs/
│   ├── architecture/           # Architecture diagrams, ADRs, engineering principles
│   ├── research/               # Research vision, hypotheses, scientific roadmap
│   └── security/               # Privacy principles (14 architectural tenets)
│
├── scripts/                    # Portable POSIX quality and verification scripts
├── .github/
│   └── workflows/              # GitHub Actions CI workflow definitions
├── package.json                # Monorepo root package configuration
├── pnpm-workspace.yaml         # pnpm workspace definition
├── turbo.json                  # Turborepo task pipeline configuration
├── tsconfig.base.json          # Strict base TypeScript configuration
├── pyproject.toml              # Python uv workspace configuration
├── README.md                   # Repository documentation
├── CONTRIBUTING.md             # Contribution guidelines & workflow
├── SECURITY.md                 # Vulnerability reporting guidance
├── .gitignore                  # Git ignore rules
├── .editorconfig               # Editor formatting configuration
├── .nvmrc                      # Node.js runtime pin (24.20.0)
├── .node-version               # Node.js runtime pin (24.20.0)
├── .python-version             # Python runtime pin (3.12.14)
└── .env.example                # Sample environment variables (no secrets)
```

---

## Standardized Runtime Baseline

- **Node.js:** `24.20.0 LTS` (pinned in `.nvmrc`, `.node-version`; package engine: `>=24.0.0 <25.0.0`)
- **pnpm:** `9.15.0` (pinned via `packageManager: pnpm@9.15.0`)
- **Python:** `3.12.14` (pinned in `.python-version`; package declarations: `>=3.12,<3.13`)
- **uv:** `0.5.7` (reviewed Python workspace manager)
- **Git:** `>= 2.40.0`
- **Shell (Windows):** Current quality and verification scripts require a Bash-compatible environment (such as Git Bash or WSL).

---

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd FutureClick
   ```

2. **Activate standardized Node runtime:**
   ```bash
   nvm use || nvm install 24.20.0
   ```

3. **Install JavaScript/TypeScript dependencies:**
   ```bash
   pnpm install --frozen-lockfile
   ```

4. **Sync Python research environment using locked dependencies:**
   ```bash
   uv sync --locked --all-packages
   ```

5. **Copy sample environment file:**
   ```bash
   cp .env.example .env
   ```

---

## Quality Commands

A single root command verifies the health of the entire polyglot codebase:

```bash
pnpm quality
```

This executes:
1. `pnpm format:check` — Verifies formatting via Biome (TypeScript) and Ruff (Python, locked).
2. `pnpm lint` — Enforces static analysis rules via Biome and Ruff (locked).
3. `pnpm typecheck` — Strict type verification via `tsc` and `mypy` (locked).
4. `pnpm test` — Executes all deterministic unit tests via Vitest and Pytest (locked).
5. `pnpm build` — Builds all TypeScript packages via Turborepo (`build:ts`) and verifies Python distribution packaging (`build:py` / `build:python`).

To auto-format code across both languages:
```bash
pnpm format:write
```

---

## Privacy Stance

FutureClick treats privacy and local-first execution as non-negotiable architectural requirements. Our [14 Privacy Principles](docs/security/PRIVACY_PRINCIPLES.md) include:
- Exclusion of password and credential fields at trust boundaries using defensive platform filters.
- Fail-closed privacy authorization requiring verified credential assessment.
- Local-first processing whenever technically feasible.
- Strict data minimization.
- Absolute ban on silent keylogging.
- Clear user visibility whenever FutureClick is active.

---

## Research Stance

FutureClick explores the empirical frontier of GUI state modeling, action representation, and pre-execution uncertainty estimation.

**Scientific Integrity Statement:** No benchmark results, accuracy metrics, or performance claims exist yet. All initial research questions and methodologies are detailed in [Research Vision](docs/research/RESEARCH_VISION.md). Structured benchmark datasets and reproducible evaluation protocols will be tracked in `research/futurebench/`.

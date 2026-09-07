# Architecture Decision Records (ADR) - Sprint FC-001 & FC-001A

## ADR-001: Monorepo Architecture with pnpm Workspaces and Turborepo
- **Status:** Accepted
- **Context:** FutureClick spans shared TypeScript packages, platform-specific desktop and extension apps, and Python ML research packages. We require atomic versioning, seamless cross-package dependency resolution, and fast task execution.
- **Decision:** Use `pnpm` workspaces combined with `Turborepo` for topological task orchestration (`build`, `test`, `typecheck`, `lint`).
- **Consequences:** Clean dependency graph, no circular dependencies, instant incremental builds, and reproducible lockfile management across developer machines.

## ADR-002: Dual-Language Strategy (TypeScript & Python)
- **Status:** Accepted
- **Context:** Web extensions, desktop host bridges, and graph representations require fast compile times, type safety, and direct interoperability with browser/desktop runtime APIs. Conversely, scientific research, dataset benchmarking, and future statistical/neural modeling rely on the Python data science ecosystem.
- **Decision:** Restrict TypeScript to packages, client apps, and shared schemas. Restrict Python to research services (`services/prediction-engine`) and benchmark harnesses (`research/futurebench`). Prohibit mixing language responsibilities without clear IPC/RPC boundaries.
- **Consequences:** Avoids awkward polyglot bindings while maintaining clear separation between platform engineering and scientific research.

## ADR-003: Maximum Strictness TypeScript Base Configuration
- **Status:** Accepted
- **Context:** Early foundation code must enforce high invariants to support years of maintenance without brittle runtime edge cases.
- **Decision:** Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `forceConsistentCasingInFileNames`. Ban `any` in production code and ban un-annotated `@ts-ignore`.
- **Consequences:** Strong static guarantees, clear API boundaries, and prevention of undefined property index bugs.

## ADR-004: Python Environment Management via uv Workspace
- **Status:** Accepted
- **Context:** Managing multiple Python projects in a monorepo often causes dependency drift and fragile virtual environments.
- **Decision:** Standardize on `uv` workspace support (`pyproject.toml` with `hatchling` backend). Use `ruff` for linting and formatting, `mypy` for static type checking, and `pytest` for deterministic unit testing.
- **Consequences:** Lightning-fast virtual environment creation, consistent lockfiles, and zero global environment pollution.

## ADR-005: Unified Tooling with Minimal Tool Count
- **Status:** Accepted
- **Context:** Complex toolchains with five overlapping linters, formatters, and compilers degrade developer velocity and cause conflicting CI warnings.
- **Decision:** Standardize on `Biome` for TypeScript linting and formatting, and `Ruff` for Python linting and formatting. Use `tsc` for TypeScript typechecking and `mypy` for Python typechecking.
- **Consequences:** Ultra-fast local developer feedback loop, zero configuration conflict, and minimal maintenance overhead.

## ADR-006: Explicit Consequence Modality Division (Verified, Simulated, Predicted)
- **Status:** Accepted
- **Context:** Consequence evaluation can range from mathematically deterministic static checks to fuzzy neural predictions. Conflating these modes risks misleading users with ungrounded AI hallucinations.
- **Decision:** Mandate three distinct categories in `@futureclick/action-schema` and `@futureclick/consequence-engine`: `verified`, `simulated`, and `predicted`.
- **Consequences:** UI cards can clearly color-code and caveat predictions according to their true provenance and confidence level.

## ADR-007: Deliberate Exclusion of ML Frameworks and Fake Data in FC-001
- **Status:** Accepted
- **Context:** Prototyping hackathons frequently bundle gigabytes of PyTorch/TensorFlow dependencies and synthetic mock datasets before defining domain contracts.
- **Decision:** Ban all heavy ML frameworks, LLM SDKs, browser interception logic, and synthetic benchmark metrics in Sprint FC-001.
- **Consequences:** Repository remains lightweight (<10MB codebase), installs in seconds, and focuses entirely on clean interfaces.

## ADR-008: Unified Root Quality Gate (`pnpm quality`)
- **Status:** Accepted
- **Context:** Monorepos with multiple languages often suffer from fragmented verification where developers verify one language but break another.
- **Decision:** Provide a unified `pnpm quality` command executing all format checks, linters, typecheckers, test suites, and build steps across TypeScript and Python in a single deterministic pass.
- **Consequences:** Guarantees that any developer or CI runner can verify the entire repository with a single command.

## ADR-009: Runtime Policy Standardization (Node 24.20.0 LTS & Python 3.12.14)
- **Status:** Accepted
- **Context:** Discrepancies between local developer machines and CI runners cause non-reproducible failures and configuration drift.
- **Decision:** Explicitly standardize local development and CI on Node.js 24.20.0 LTS (`.nvmrc`, `.node-version`, package engines `>=24.0.0 <25.0.0`) and Python 3.12.14 (`.python-version`, package declarations `>=3.12,<3.13`). Standardize Python tooling on `uv 0.5.7`.
- **Consequences:** Fully deterministic runtime environments across local dev shells and GitHub Actions runners.

## ADR-010: Epistemological Grounding of Consequence Semantics
- **Status:** Accepted
- **Context:** Treating "VERIFIED" outcomes as philosophical 100% certainty is scientifically flawed; stale data, environment drift, or invalid assumptions can invalidate formal deductions.
- **Decision:** Define "Verified" strictly as a deterministic consequence derived from available evidence within an explicitly defined scope and set of assumptions. Define "Simulated" as empirical observation within a controlled sandbox. Define "Predicted" as probabilistic projection with explicit uncertainty.
- **Consequences:** Research integrity is preserved, and human-facing previews avoid presenting probabilistic or assumption-dependent derivations as infallible truth.

## ADR-011: Strict Lockfile Freshness and Python Packaging Verification
- **Status:** Accepted
- **Context:** Automatic lockfile mutation during linting or testing obscures dependency changes and introduces non-deterministic CI breaks. Incomplete quality gates omitting distribution builds risk shipping broken package metadata.
- **Decision:** Enforce `--locked` on all `uv` commands in verification scripts and CI (`uv run --locked ...`, `uv sync --locked --all-packages`). Include transient temporary builds of Python wheels and source distributions in `pnpm quality`.
- **Consequences:** Locked validation verifies that dependency resolution remains unchanged during quality checks, while distribution builds provide evidence that the current packages can be built successfully in the reviewed environment.

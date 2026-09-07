# Contributing to FutureClick

Welcome to FutureClick. We are establishing a production-quality, long-term foundation for pre-execution consequence evaluation across computer platforms.

Please review our [Engineering Principles](docs/architecture/ENGINEERING_PRINCIPLES.md) and [Privacy Principles](docs/security/PRIVACY_PRINCIPLES.md) before contributing.

---

## Development Prerequisites & Standardized Runtime Baseline

FutureClick enforces strict runtime reproducibility across local development and CI:

- **Node.js:** `24.20.0 LTS` (pinned via `.nvmrc` and `.node-version`; package engine: `>=24.0.0 <25.0.0`)
- **pnpm:** `9.15.0` (pinned via `packageManager: pnpm@9.15.0`)
- **Python:** `3.12.14` (pinned via `.python-version`; package declarations: `>=3.12,<3.13`)
- **uv:** `0.5.7` (reviewed Python workspace manager)
- **Git:** `>= 2.40.0`
- **Shell / Environment (Windows Contributors):** Current verification and quality scripts require a Bash-compatible environment (e.g., Git Bash, WSL, or macOS/Linux terminal).

---

## Monorepo Setup

1. **Activate Node.js 24.20.0:**
   ```bash
   nvm use || nvm install 24.20.0
   ```

2. **Install Node and workspace dependencies:**
   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Sync Python virtual environment using locked dependencies:**
   ```bash
   uv sync --locked --all-packages
   ```

---

## Daily Workflow & Quality Gate

To ensure zero regressions across our polyglot repository, all contributions must pass the comprehensive local quality gate.

Run the quality gate:
```bash
pnpm quality
```

This single command runs:
1. `pnpm format:check` — Formats verification via Biome (TypeScript) and Ruff (Python, locked).
2. `pnpm lint` — Static analysis via Biome (TypeScript) and Ruff (Python, locked).
3. `pnpm typecheck` — Static typing via `tsc` (TypeScript) and `mypy` (Python, locked).
4. `pnpm test` — Deterministic unit tests via Vitest (TypeScript) and Pytest (Python, locked).
5. `pnpm build` — Package compilation via Turborepo (`build:ts`) and temporary distribution packaging verification (`build:py`).

### Individual Commands

You can run individual tool suites from the repository root:

- **Linting:**
  ```bash
  pnpm lint           # All linters
  pnpm lint:ts        # TypeScript only (Biome)
  pnpm lint:py        # Python only (Ruff locked)
  ```

- **Formatting:**
  ```bash
  pnpm format:check   # Verify formatting
  pnpm format:write   # Automatically format TS and Python files
  ```

- **Type Checking:**
  ```bash
  pnpm typecheck      # All typecheckers
  pnpm typecheck:ts   # TypeScript only (tsc --noEmit)
  pnpm typecheck:py   # Python only (mypy locked)
  ```

- **Testing:**
  ```bash
  pnpm test           # All test suites
  pnpm test:ts        # TypeScript unit tests (Vitest)
  pnpm test:py        # Python unit tests (pytest locked)
  ```

- **Build:**
  ```bash
  pnpm build          # Turborepo build pipeline + Python package builds
  pnpm build:ts       # TypeScript packages only
  pnpm build:python   # Python distribution builds (wheel + sdist in clean temp dir)
  ```

---

## Coding Standards

### TypeScript
- Base configuration enforces `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`.
- Avoid `any`. Use discriminated unions, branded types, or generics.
- No `@ts-ignore` in production code.
- Every package in `packages/` and `apps/` must maintain its own `README.md`, `package.json`, `tsconfig.json`, and deterministic unit tests in `tests/`.
- **Provisional Schema Notice:** FC-001/FC-001A schemas are provisional. TypeScript structural types do not prove runtime semantic validity; explicit boundary validation will be added in subsequent domain sprints.

### Python
- All Python packages must specify `pyproject.toml` with `requires-python = ">=3.12,<3.13"`.
- Use Ruff for linting and formatting (line length: 100, target version: `py312`).
- Use `mypy` in `strict = true` mode. Type annotations are mandatory on all functions.
- All Python operations must run `--locked` against `uv.lock`. Do not modify lockfiles during verification.
- Do not introduce heavy ML frameworks (PyTorch, TensorFlow, LLM SDKs) without architectural review.

---

## Security & Secrets
- Never commit credentials, API keys, authentication tokens, or personal data.
- Ensure all `.env` files are ignored by git.
- Adhere strictly to the [Privacy Principles](docs/security/PRIVACY_PRINCIPLES.md), specifically excluding password and credential fields at trust boundaries and favoring local-first execution.
- To report vulnerabilities, refer to [SECURITY.md](SECURITY.md).

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

## ADR-012: NumPy and scikit-learn Confined to the Research Workspace (FC-008)
- **Status:** Accepted
- **Context:** FC-008 introduces the first learned component in FutureClick. ADR-007 banned ML frameworks and synthetic metrics in FC-001 and remains accepted and unamended; this ADR does not rewrite it but states the narrow, later conditions under which two numeric libraries become admissible. The risk being managed is that a research dependency silently becomes a product dependency, or that a learned artifact acquires authority over a real user action.
- **Decision:**
  1. NumPy and scikit-learn are permitted ONLY inside the Python research workspace (`research/`). They are research dependencies, never product dependencies.
  2. No shipped TypeScript package may depend on them, directly or transitively.
  3. The browser extension bundle must not contain, load, or require them, and must not grow a Python runtime, WASM numeric runtime, or remote inference call to reach them.
  4. They are used for training, calibration fitting, and evaluation only. They never perform inference on a user's machine.
  5. Inference in the product path is a pure-TypeScript evaluation of a serialized, validated artifact.
  6. ADR-007's prohibition on heavy ML frameworks (PyTorch, TensorFlow, LLM SDKs) stays in force. NumPy and scikit-learn are admitted as bounded numeric libraries for linear models, not as a general ML stack.
  7. ADR-007's prohibition on fake data and fabricated benchmark metrics stays in force without exception. No metric may be reported that was not measured.
  8. Dependencies are installed no earlier than Sprint 3, when training actually begins. Sprint 1 and Sprint 2 install nothing.
  9. The research workspace is excluded from the extension build graph by construction, not by convention.
  10. Model artifacts are committed as serialized data with a recorded SHA-256 digest, never as pickled Python objects, because a pickle is executable code.
  11. Reproducibility is claimed against the pinned reference toolchain only (see ADR-015), not against arbitrary environments.
  12. A learned artifact never gains release authority. It produces a PREDICTED hypothesis and nothing else (see ADR-013 and ADR-014).
  13. If a future sprint needs a numeric capability these two libraries cannot provide, that requires a new ADR rather than a quiet dependency addition.
- **Consequences:** The product surface stays dependency-light and auditable while real research becomes possible. The cost is a hard boundary that must be re-verified by the quality gate rather than trusted, and a deliberate inability to run richer model families without an explicit architectural decision.

## ADR-013: Predictions Live Outside the Authoritative ActionGraph (FC-008)
- **Status:** Accepted
- **Context:** The ActionGraph is the authoritative deterministic record of what an action is and what it affects. A tempting shortcut is to attach model predictions to it as additional nodes or relations so that downstream consumers get them for free. That shortcut would make a probabilistic claim indistinguishable from a deterministic one at the point of consumption.
- **Decision:** FC-008 adds no node type, adds no relation type, modifies no relation endpoint, and performs no mutation of the authoritative graph. An `ActionHypothesis` is a separate, inert, PREDICTED-only record that references an observation by identifier. The authoritative graph remains the product of deterministic derivation only. Any later integration must preserve the separation at the type level, so that no consumer can read a prediction where it expects a derivation.
- **Consequences:** Deterministic and probabilistic evidence remain distinguishable by type rather than by convention, which is what ADR-006 and ADR-010 require. The cost is that consumers wanting both must join two records explicitly, and FC-008 cannot reuse graph traversal for prediction context.

## ADR-014: Providers Score, the Runtime Decides (FC-008)
- **Status:** Accepted
- **Context:** The natural shape for an inference component is one that returns a finished answer: a label, a confidence, and an accept or reject decision. That shape concentrates authority in the most replaceable part of the system. A provider could then calibrate itself, choose its own thresholds, declare itself accepted, assert an evidence mode it has no standing to assert, or certify that its own input was well supported. A second pressure points the same way: FC-008 will choose between a joint and a factorized logistic model in Sprint 3, and a boundary shaped around only one of them would have to be redesigned once that choice is made — exactly when the system is least able to absorb a breaking change.
- **Decision:**
  1. A scoring provider returns **raw scores only**, plus the identity of the artifact that produced them. It receives Layer B observation semantics and two version strings, and nothing else. It is told no threshold, no budget, and no policy, so it has nothing to apply.
  2. The score payload is a **discriminated union over both planned model families**, so the Sprint 3 family choice needs no breaking redesign of this boundary. The joint family supplies exactly 13 tuple logits. The factorized family supplies exactly 10 verb logits, 9 object logits, and 10 transition-property logits, with sizes derived from the frozen support matrix rather than hard-coded.
  3. **All three factorized heads are preserved losslessly.** Collapsing them at the boundary would destroy three things a later sprint needs: RQ1's ability to inspect the heads, the definition of temperature calibration over them, and the computation of unsupported-combination mass.
  4. Per-family shapes are closed, so a joint payload carrying factorized heads, or the reverse, is rejected rather than partially interpreted. A payload whose declared family contradicts its own artifact descriptor is also rejected.
  5. A provider supplies **no support, novelty, or coverage evidence**. Deterministic support assessment is produced on the runtime side from validated Layer B semantics and runtime-held policy state, through a function that has no parameter a provider value could enter. A provider that could report its own support could claim full coverage for any input and convert a refusable input into an accepted hypothesis.
  6. A provider supplies no hypothesis, acceptance decision, abstention decision, evidence mode, calibrated confidence, probability, threshold, policy, or release capability. Provider output is closed-shape validated, so any such field is an operational defect rather than something trusted.
  7. A non-scored outcome carries a **closed diagnostic token**, not prose, so a provider cannot emit unbounded page- or model-derived text through a failure path.
  8. The runtime owns version checks, artifact and calibration identity checks, freshness checks, support assessment, deadline enforcement, calibration, threshold application, the precedence ladder, and hypothesis construction. It validates its own constructed hypothesis through the same validator that rejects foreign ones, so there is exactly one construction path.
  9. Where production numerics for a family do not yet exist, the runtime **defers with a safe operational result** rather than fabricating one. Sprint 1 accepts a factorized payload and returns `MODEL_UNAVAILABLE` with the detail `composition/composition-not-implemented`, because composing three heads into a distribution over the thirteen supported tuples requires supported-set renormalisation and unsupported-combination mass accounting that Sprint 3 delivers. The refusal is operational, not epistemic: an unimplemented composition is a system limitation, not a statement about input difficulty.
- **Consequences:** Swapping or compromising a provider cannot change what the system is willing to accept, cannot alter the support evidence used to refuse an input, and cannot drift calibration authority into the component most likely to be replaced. Supporting both families from Sprint 1 means the boundary survives the Sprint 3 model decision unchanged. The costs are a less convenient provider interface, a runtime that must be correct because it is now the only place a decision is made, and a factorized path that is contractually complete but numerically deferred until Sprint 3.

## ADR-015: Reference-Toolchain Reproducibility, Not Universal Byte Identity (FC-008)
- **Status:** Accepted
- **Context:** Research integrity requires that a reported result can be regenerated. It is tempting to promise byte-identical artifacts from any machine. That promise cannot be kept: BLAS implementations, CPU instruction sets, thread counts, and floating-point summation order all vary, and a claim that cannot be kept is worse than a narrower claim that can.
- **Decision:** FC-008 claims bit-identical training artifacts only against the pinned reference toolchain, with pinned library versions, a fixed random seed, a fixed thread count, and a recorded platform descriptor. Outside the reference toolchain, FC-008 claims reproducibility of reported metrics within an explicitly stated tolerance, and nothing stronger. Every artifact records the toolchain that produced it. The TypeScript inference path is validated against the Python training path by golden parity vectors with a measured tolerance, frozen before final experiments; the tolerance is measured rather than assumed, and bounded by an absolute ceiling fixed in Sprint 1.
- **Consequences:** The reproducibility claim is honest and testable, and a parity failure is detectable rather than hidden in rounding. The cost is that exact artifact regeneration requires the reference environment, and the parity tolerance is a measured quantity that must be reported rather than a clean zero.

## ADR-016: FC-008 Selects No Runtime or Product Winner (FC-008)
- **Status:** Accepted
- **Context:** FC-008's first research question compares a factorized logistic architecture against a joint logistic architecture. The obvious failure mode is to read the final test results, pick whichever architecture scored better, and ship it. That is selection on the final test set, and it invalidates the generalization estimate the final test set exists to provide.
- **Decision:**
  1. Final test data (test-ID, test-OOA, test-novelty) is used for reporting only.
  2. Final test data may never select a runtime or product model family, hyperparameters, regularization strength, thresholds, feature policy, fixture design, or application family design.
  3. Every such choice is made on the development and policy-validation partitions, before the final partitions are opened.
  4. FC-008 declares no runtime or product winner between the two families. The comparison is a research finding, not a shipping decision.
  5. Where a single artifact is operationally required, it is locked using development and policy-validation data only, before the final partitions open, and is documented as an operational selection rather than a research winner.
  6. Parameter counts, coefficient counts, and coefficient norms are reported as measured facts. The number of non-zero coefficients is never presented as a measure of effective capacity.
  7. The permitted claim is that the comparison evaluates two complete, naturally defined architectures under an identical procedure. It is not claimed that any observed difference is caused solely by compositional representation.
  8. The preregistration document is finalized and frozen at the end of Sprint 3, before any final partition is read.
- **Consequences:** The generalization estimate stays interpretable and the comparison stays honest, including the honest outcome in which neither family is distinguishable. The cost is that FC-008 ends without a shipping recommendation, and a later product decision needs its own ADR and its own evidence.

# @futureclick/browser-adapter

Pure browser observation validation, privacy boundaries, and canonical context adaptation for FutureClick (Sprint FC-005).

## Architecture & Responsibilities

This package operates as a pure TypeScript platform boundary between raw browser observations and canonical FutureClick domain models:

1. **Pure Platform Boundary:**
   - Contains ZERO DOM APIs (`HTMLElement`, `MouseEvent`, `Document`, `Window`, Chrome extension APIs).
   - Operates purely on serializable, detached observation data structures.

2. **BrowserObservation Model & Strict Validation:**
   - Validates incoming observations against closed schemas.
   - Enforces string length bounds, machine token grammars, and safe property reads.
   - Rejects unexpected properties, prototype manipulation, hostile getters, and oversized payloads.
   - Produces detached, deeply frozen observation records.

3. **Privacy Preservation & Minimization:**
   - Enforces URL privacy: preserves origin and static route token; excludes raw paths, query strings, fragments, and credentials.
   - Excludes sensitive and editable controls (passwords, OTPs, credit cards, form inputs) using defense-in-depth checks from `@futureclick/privacy`.
   - Reads allowlisted semantic metadata attributes only; rejects dataset enumeration.

4. **Browser Action Adapters & Ambiguity Detection:**
   - Defines the `BrowserActionAdapter` contract (`assess` callback returning `AdapterDecision`).
   - Implements the `SyntheticRepositoryVisibilityAdapter` for `fc005.repository-visibility.v1`.
   - Immutable adapter registry enforcing one active version per adapter ID.
   - Evaluates all adapters against the same observation; flags multiple applicability claims fail-closed as `AMBIGUOUS_ADAPTER`.

5. **Canonical Context Construction:**
   - Central `BrowserAdapterEngine` converts adapter drafts into authoritative `ActionEvaluationContext` instances.
   - Allocates canonical IDs via injected deterministic providers.
   - Maps to canonical browser environment (`kind: "browser"`, `platform: "web"`).
   - Validates the resulting context against `@futureclick/action-schema`'s authoritative `validateActionEvaluationContext`.
   - Feeds directly into `@futureclick/consequence-engine` without coupling the adapter package to the rule engine.

## Synthetic Honesty

- All evaluations in FC-005 are conducted on local synthetic fixtures (`http://127.0.0.1:4173/fc005/repository-visibility.html`).
- No GitHub or live version control APIs are invoked.
- No actual repositories are modified.
- Page metadata is an explicit test declaration used to verify semantic grounding.
- The `VERIFIED` consequence is a conditional deduction based on represented state and action parameters.

## Development Scripts

- `pnpm --filter @futureclick/browser-adapter build`: Compiles TypeScript definitions and JavaScript bundle.
- `pnpm --filter @futureclick/browser-adapter typecheck`: Typechecks the package.
- `pnpm --filter @futureclick/browser-adapter test`: Runs the Vitest test suite.
- `pnpm --filter @futureclick/browser-adapter lint`: Lints the package via Biome.


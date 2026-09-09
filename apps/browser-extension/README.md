# @futureclick/browser-extension

Browser extension application for FutureClick synthetic action observation (Sprint FC-005).

## Sprint FC-005 Scope & Architecture

Sprint FC-005 establishes FutureClick's first browser observation boundary. It is strictly **observation only**:
- Passive, capture-phase event listening without calling `preventDefault()`, `stopPropagation()`, or `stopImmediatePropagation()`.
- Synchronous metadata capture on supported native `<button type="button">` controls.
- URL privacy: retains only origin and static route token; raw pathnames, query strings, and fragments are never captured.
- Bridges allowlisted DOM metadata snapshots via `@futureclick/browser-adapter` into `@futureclick/consequence-engine`.
- Minimal development indicator providing explicit Start/Stop toggles and synthetic consequence display.

## Synthetic Honesty

- All evaluations in FC-005 are conducted on local synthetic fixtures (`http://127.0.0.1:4173/fc005/repository-visibility.html`).
- No GitHub or live version control APIs are invoked.
- No actual repositories are modified.
- Page metadata is an explicit test declaration used to verify semantic grounding.
- The `VERIFIED` consequence is a conditional deduction based on represented state and action parameters.

## Development Scripts

- `pnpm --filter @futureclick/browser-extension build`: Compiles TypeScript and bundles the self-contained IIFE content script (`dist/content.bundle.js`).
- `pnpm --filter @futureclick/browser-extension serve:fixtures`: Starts the local HTTP fixture server on `http://127.0.0.1:4173`.
- `pnpm --filter @futureclick/browser-extension test`: Runs the Vitest test suite.

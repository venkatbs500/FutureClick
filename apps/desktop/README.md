# @futureclick/desktop

Desktop host application placeholder for FutureClick.

## Eventual Responsibilities

This application serves as the primary desktop runtime coordinator across operating systems:
- Host shared desktop domain logic, system tray presence, and preference management.
- Establish IPC connections to the native platform adapters (`native/macos` and `native/windows`).
- Coordinate with `@futureclick/consequence-engine` for local-first consequence evaluation.
- Present native non-modal preview surfaces to the user before high-risk desktop operations (e.g., recursive deletes, permission alterations, mass renames).

## Architectural Boundaries

- Heavy desktop frameworks (such as Electron, Tauri, or Qt) are intentionally omitted in Sprint FC-001 to prevent premature bloat before core protocol contracts stabilize.
- The desktop host delegates all platform-specific accessibility and OS event capturing to dedicated native adapters.

# @futureclick/shared

Foundational cross-cutting utilities for the FutureClick ecosystem.

## Eventual Responsibilities

This package is strictly reserved for pure, cross-cutting domain primitives that have zero external dependencies and apply universally across all packages and services.

Responsibilities include:
- Strongly typed `Result<T, E>` types for explicit error handling without runtime exceptions.
- Nominal/branded identifier utilities (`generateEntityId` for cryptographic UUIDv4 production IDs, `createDeterministicIdGenerator` for isolated test suites requiring explicit instance injection, `Brand`, `IdGenerator`).
- Validated canonical UTC ISO-8601 timestamp types and strict validator (`IsoTimestamp`, `isValidIsoTimestamp`, `parseIsoTimestamp`).
- Universal serialization and assertion primitives.

## Architectural Boundaries

- **No dumping ground:** Do not place domain-specific schemas, UI helpers, prediction logic, or native bindings here.
- **Zero third-party runtime dependencies:** Keep dependencies at zero to preserve portability across Node, browser extensions, and native bridge targets.

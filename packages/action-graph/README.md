# @futureclick/action-graph

Relational structure connecting actors, actions, targets, state, dependencies, and consequences.

## Eventual Responsibilities

The ActionGraph is the central intermediate representation (IR) within FutureClick. It models:
- **Actors:** Users, background processes, system services, or automated agents proposing actions.
- **Actions:** Proposed operations and their execution parameters.
- **Targets:** Operating system handles, UI components, file descriptors, database records, network endpoints.
- **Dependencies:** Pre-conditions, permission grants, environment requirements.
- **State:** Pre-action and post-action environmental states.
- **Consequences:** Multi-hop ramifications, side effects, downstream state mutations.

## Sprint FC-002 Scope

Future ActionGraph implementations will consume the canonical domain models (`CanonicalEntity`, `ProposedAction`, `StateSnapshot`, `Consequence`, `ActionEvaluationContext`) defined in `@futureclick/action-schema` rather than defining competing domain schemas. The current container API represents a structural relational graph placeholder; graph query engines, multi-hop dependency analysis, and cycle detection will be developed in future research sprints.

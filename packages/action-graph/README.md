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

## Sprint FC-001 Scope

In FC-001, we provide a tiny graph container API and baseline unit tests to validate package compilation and boundary definitions. The complete graph query engine, multi-hop dependency analysis, and cycle detection will be implemented in future research sprints.

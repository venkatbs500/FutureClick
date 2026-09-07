# @futureclick/action-graph

Canonical relational action and consequence graph representation for FutureClick (Sprint FC-003).

## Critical Scope & Epistemological Boundary

**ActionGraph is a purely structural relational indexing representation over canonical FutureClick domain records.**

- FC-003 does **NOT** infer consequences.
- FC-003 does **NOT** infer causal relationships.
- FC-003 does **NOT** predict downstream effects.
- FC-003 does **NOT** implement graph neural networks, embeddings, shortest-path reasoning, propagation algorithms, or recommendation engines.
- Every edge is directly derivable from authoritative canonical domain records (`ActionEvaluationContext` and optional `ConsequenceAssessment`).
- No causal relations (`causes`, `predicts`, `guarantees`, `prevents`, `will-happen`) exist in this graph representation.

## Structural Relationship Diagram

```
ActionEvaluationContext
├── context-has-state ──────► StateSnapshot
│                             ├── state-has-entity ──► CanonicalEntity
│                             └── state-has-fact ────► StateFact
│                                                       ├── fact-describes-entity ──► CanonicalEntity
│                                                       └── fact-supported-by-ev ──► EvidenceRecord (fact-owned)
└── context-has-action ─────► ProposedAction
                              └── action-targets-entity (role) ──► CanonicalEntity

ConsequenceAssessment (Optional)
├── assessment-for-context ──► ActionEvaluationContext
└── assessment-has-csq ──────► Consequence
                               ├── consequence-affects-entity ──► CanonicalEntity
                               └── csq-supported-by-ev ─────────► EvidenceRecord (csq-owned)
```

## Schema & Identifiers

- **Schema Version:** `ACTION_GRAPH_SCHEMA_VERSION = "1.0"`. Graph representation versioning is distinct from `package.json`. No public stability guarantee is implied at this stage; migration infrastructure is future work.
- **Branded Identifiers:** Opaque nominal types (`ActionGraphId`, `ActionGraphNodeId`, `ActionGraphEdgeId`) generated via cryptographic UUIDs in production and configurable with an injected `IdGenerator` for deterministic testing. No process-global or module-global counter exists.

## Source & Lineage Integrity

An `ActionGraph` root contains:
- `schemaVersion`: `"1.0"`
- `id`: Unique `ActionGraphId`
- `generatedAt`: ISO UTC timestamp
- `source`: `ActionGraphSource` containing:
  - `context`: Authoritatively validated `ActionEvaluationContext`
  - `assessment?`: Optional authoritatively validated `ConsequenceAssessment`
- `nodes`: Dense, ordered array of `ActionGraphNode`
- `edges`: Dense, ordered array of `ActionGraphEdge`

**No Second Source of Truth:**
The graph references canonical records via `ActionGraphSubjectRef`. It does NOT duplicate mutable domain values (such as file paths, entity attributes, or consequence risk scores) into competing graph metadata. The canonical records in `source` remain authoritative.

If an assessment is provided, it **must** validate authoritatively against the supplied context before graph construction. Mismatched assessments are strictly rejected.

## Node Model & Controlled Vocabulary

Each `ActionGraphNode` contains:
- `id`: `ActionGraphNodeId`
- `kind`: `ActionGraphNodeKind` (`"evaluation-context" | "state-snapshot" | "entity" | "fact" | "proposed-action" | "assessment" | "consequence" | "evidence"`)
- `subject`: `ActionGraphSubjectRef` pointing to canonical record identities (`contextId`, `stateId`, `entityId`, `factId`, `actionId`, `assessmentId`, `consequenceId`, or qualified `evidence`)
- `label?`: Optional display string (e.g. entity label, action verb, consequence summary)

### Qualified Evidence Node Scoping (Requirements 11, 39, Finding L2)
In FC-002, evidence records are unique within their immediate ownership containers (such as facts within a snapshot or consequences within an assessment). However, `EvidenceId` is not a single global repository-wide identifier across all of FutureClick history. ActionGraph evidence ownership qualification exists because graph subject identity must preserve owner context (`StateFact` vs `Consequence`), ensuring that identical `EvidenceId` values across distinct owners map to distinct, owner-qualified structural graph nodes:
```typescript
export interface ActionGraphEvidenceSubject {
  readonly kind: "evidence";
  readonly evidenceId: EvidenceId;
  readonly owner:
    | { readonly kind: "fact"; readonly factId: ObservationId }
    | { readonly kind: "consequence"; readonly consequenceId: ConsequenceId };
}
```

### Injective Structured Identity (Findings H1, H2)
Both canonical subject keys (`getSubjectKey`) and structural edge keys (`getStructuralEdgeKey`) use injective structured tuple encoding via `JSON.stringify([...])` rather than delimiter concatenation (e.g. `["evidence", "fact", factId, evidenceId]`). This eliminates delimiter collision vulnerabilities where IDs containing colons or delimiters could collide.

### External Entity References (Finding M5 / Sections 21-29)
An ActionGraph `entity` node represents a canonical `EntityId` reference appearing anywhere in `graph.source`:
1. `state.entities` (snapshot entities, preserving `label`)
2. `action.targets` (external action target entities)
3. `consequence.affectedEntities` (external consequence affected entities)

Entities are deduplicated into exactly one `entity` graph node following deterministic first-seen order. The `state-has-entity` edge is created **strictly** for entities that exist in `StateSnapshot.entities`, cleanly distinguishing known state entities from external references.

### Exactly One Node Per Canonical Subject (Requirement 42)
Each canonical domain subject maps to exactly one graph node. Duplicate nodes for the same canonical subject are strictly rejected by validation.

## Edge Model & Endpoint Kind Matrix

Edges use a controlled vocabulary of direct structural relationships:
- `context-has-state`: `evaluation-context` -> `state-snapshot`
- `context-has-action`: `evaluation-context` -> `proposed-action`
- `state-has-entity`: `state-snapshot` -> `entity` (strictly for snapshot entities)
- `state-has-fact`: `state-snapshot` -> `fact`
- `fact-describes-entity`: `fact` -> `entity`
- `action-targets-entity`: `proposed-action` -> `entity` (carries typed `targetRole: ActionTargetRole`)
- `assessment-for-context`: `assessment` -> `evaluation-context`
- `assessment-has-consequence`: `assessment` -> `consequence`
- `consequence-affects-entity`: `consequence` -> `entity`
- `fact-supported-by-evidence`: `fact` -> `evidence`
- `consequence-supported-by-evidence`: `consequence` -> `evidence`

Target roles (`primary`, `source`, `destination`, `recipient`, `container`, `account`, `resource`, `subject`, `other`) are canonically defined in `@futureclick/action-schema` (`ACTION_TARGET_ROLES`) and explicitly preserved on `action-targets-entity` edges without positional interpretation.

## Graph Invariants & Validation

Runtime validation via `validateActionGraph(input)` enforces:
1. **Node and Edge ID Uniqueness:** All `ActionGraphNodeId` and `ActionGraphEdgeId` values must be unique.
2. **Endpoint Existence:** Every edge `sourceNodeId` and `targetNodeId` must exist in graph nodes.
3. **Relation Kind Matrix:** Edge relations must strictly connect valid source and target node kinds.
4. **Duplicate Structural Edge Rejection:** Duplicate edges sharing the same `(sourceNodeId, relation, targetNodeId, targetRole)` are rejected using structured tuple encoding.
5. **Canonical Subject Uniqueness:** Exactly one node per canonical domain subject (with owner-qualified evidence).
6. **Canonical Source Consistency:** Every edge must match an actual relationship present in the canonical source records.
7. **Graph Completeness:** All canonical records and relationships in `source` (including external entity references) must have corresponding nodes and edges in the graph; omission of canonical records invalidates the graph.
8. **Strict Optional Property Semantics (Finding M1):** Optional properties (`assessment`, `label`, `targetRole`) strictly differentiate absent (valid omission), present-valid, present-undefined (invalid), and read-error/throwing-getter (invalid).
9. **Fail-Closed Diagnostic Safety (Finding M4):** Diagnostic messages never invoke untrusted `toString` or getter coercion, protecting against hostile thrown values.
10. **Deep Runtime Immutability (Finding M2):** All successful validation and builder outputs are deeply frozen recursively via `deepFreezeActionGraphValue`.
11. **No Universal DAG Invariant:** ActionGraph does not enforce acyclicity as a universal invariant, although the structural builder creates an acyclic graph.

## Construction & Builder Validity (Finding M3)

`buildActionGraph(options)`:
- Authoritatively validates source context and optional assessment before construction.
- Validates options with safe own-property reading and Error normalization (Finding M4).
- Guarantees that every candidate graph passes `validateActionGraph` before being returned.
- Rejects constant duplicate ID generators and invalid `generatedAt` timestamps with standard `Error` instances.
- Produces deterministic structural ordering for identical inputs and deterministic generators.

## Deterministic Ordering

Given the same canonical source records and injected `IdGenerator`, `buildActionGraph` produces deterministic structural ordering:
- **Nodes:** evaluation-context -> state-snapshot -> proposed-action -> entities (source order) -> facts (source order) -> fact evidence (owner/source order) -> assessment (if present) -> consequences (source order) -> consequence evidence (owner/source order).
- **Edges:** context-has-state -> context-has-action -> state-has-entity -> state-has-fact -> fact-describes-entity -> fact-supported-by-evidence -> action-targets-entity -> assessment-for-context -> assessment-has-consequence -> consequence-affects-entity -> consequence-supported-by-evidence.

## Query API

Lightweight, non-mutating one-hop inspection helpers:
- `getNodeById(graph, id)`
- `getNodesByKind(graph, kind)`
- `getOutgoingEdges(graph, nodeId)`
- `getIncomingEdges(graph, nodeId)`
- `getNeighbors(graph, nodeId)`
- `findNodeBySubject(graph, subjectRef)`
- `getEdgesByRelation(graph, relation)`

All query helpers return newly allocated or readonly arrays and never mutate the underlying graph.

## Serialization

- `serializeActionGraph(graph: unknown): Result<string, Error>`: Authoritatively validates the graph before serializing to JSON.
- `parseActionGraph(json: string): Result<ActionGraph, Error>`: Parses JSON and authoritatively validates the detached graph structure.

## Privacy Principles (Requirement 35)

- **Inherited Sensitivity:** The ActionGraph contains canonical context and assessment records, and therefore inherits their privacy sensitivity.
- **No Uncanonicalized Content:** The graph must not introduce raw, unredacted content (e.g. unredacted passwords, arbitrary raw screen text).
- **Adapter Redaction Responsibility:** Sensitive data redaction remains the responsibility of platform adapters prior to canonicalization.
- **Serialization Boundary:** Graph serialization into JSON does not imply safety for remote transmission. JSON-safe is NOT privacy-safe.

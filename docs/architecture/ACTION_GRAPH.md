# ActionGraph Architectural Specification

## Status: Sprint FC-003 Baseline (Provisional)

This document specifies the architecture, data model, validation rules, and boundaries of the `ActionGraph` representation within FutureClick.

---

## 1. Purpose and Epistemological Boundary

The `ActionGraph` provides a structural, relational intermediate representation (IR) over canonical FutureClick domain records:
- `ActionEvaluationContext`
- `StateSnapshot`
- `CanonicalEntity`
- `StateFact`
- `ProposedAction`
- `ConsequenceAssessment`
- `Consequence`
- `EvidenceRecord`

### Strict Epistemological Scope
The ActionGraph is a **structural index**.
- It represents direct relationships that are provably present in canonical source records.
- It does **not** assert or compute causal inference.
- It does **not** predict consequences, state transitions, or downstream impacts.
- It does **not** implement graph neural networks (GNNs), graph embeddings, path propagation, or recommendation algorithms.
- Relations such as `causes`, `predicts`, `guarantees`, `prevents`, and `will-happen` are strictly excluded from the structural vocabulary.

---

## 2. Structural Relationship Architecture

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

---

## 3. Schema Version & Nominal Identifiers

- **Schema Version:** `ACTION_GRAPH_SCHEMA_VERSION = "1.0"` (type `ActionGraphSchemaVersion`). Graph versioning is independent of `package.json`. No public API stability guarantee is promised; schema migration infrastructure is future work.
- **Identifiers:**
  - `ActionGraphId = Brand<string, "ActionGraphId">`
  - `ActionGraphNodeId = Brand<string, "ActionGraphNodeId">`
  - `ActionGraphEdgeId = Brand<string, "ActionGraphEdgeId">`
  Generated via crypto UUIDs in production (`generateEntityId`) and injected `IdGenerator` for deterministic tests. No module-global deterministic counter exists.

---

## 4. Canonical Source Lineage & Single Source of Truth

An `ActionGraph` instance contains:
```typescript
export interface ActionGraphSource {
  readonly context: ActionEvaluationContext;
  readonly assessment?: ConsequenceAssessment;
}

export interface ActionGraph {
  readonly schemaVersion: ActionGraphSchemaVersion;
  readonly id: ActionGraphId;
  readonly generatedAt: IsoTimestamp;
  readonly source: ActionGraphSource;
  readonly nodes: readonly ActionGraphNode[];
  readonly edges: readonly ActionGraphEdge[];
}
```

### Single Source of Truth Principle
The `ActionGraph` does not maintain a second source of truth for domain values. It stores structural references (`ActionGraphSubjectRef`) pointing to canonical IDs. Values such as entity attributes, fact values, and consequence risk descriptors remain authoritative in `source.context` and `source.assessment`.

### Lineage Validation
If an assessment is supplied, it must authoritatively validate against the context (`validateConsequenceAssessment(assessment, context)`). Context ID and Action ID binding mismatches are rejected.

---

## 5. Node Model & Qualified Evidence Scoping

### Controlled Node Kinds
`"evaluation-context" | "state-snapshot" | "entity" | "fact" | "proposed-action" | "assessment" | "consequence" | "evidence"`

### Canonical Subject References
- `evaluation-context` -> `contextId: EvaluationContextId`
- `state-snapshot` -> `stateId: StateSnapshotId`
- `entity` -> `entityId: EntityId`
- `fact` -> `factId: ObservationId`
- `proposed-action` -> `actionId: ActionId`
- `assessment` -> `assessmentId: AssessmentId`
- `consequence` -> `consequenceId: ConsequenceId`
- `evidence` -> qualified ownership reference:
  ```typescript
  export interface ActionGraphEvidenceSubject {
    readonly kind: "evidence";
    readonly evidenceId: EvidenceId;
    readonly owner:
      | { readonly kind: "fact"; readonly factId: ObservationId }
      | { readonly kind: "consequence"; readonly consequenceId: ConsequenceId };
  }
  ```

### Evidence Scope Disambiguation (Requirements 11, 39, Finding L2)
In FC-002, `EvidenceId` values are unique within their immediate canonical containers (facts within a snapshot, consequences within an assessment), but are not single global repository-wide identifiers across all FutureClick history. The ActionGraph qualifies each evidence node with its canonical owner (`StateFact` vs `Consequence`), guaranteeing that identical `EvidenceId` values across facts and consequences map to distinct, owner-qualified structural nodes.

### Injective Structured Identity (Findings H1, H2)
Both canonical subject keys (`getSubjectKey`) and structural edge keys (`getStructuralEdgeKey`) use injective structured tuple encoding via `JSON.stringify([...])` rather than delimiter concatenation (e.g. `["evidence", "fact", factId, evidenceId]`). This eliminates delimiter collision vulnerabilities where IDs containing colons or delimiters could collide.

### External Entity References (Finding M5 / Sections 21-29)
An ActionGraph `entity` node represents a canonical `EntityId` reference appearing anywhere in `graph.source`:
1. `state.entities` (snapshot entities, preserving `label`)
2. `action.targets` (external action target entities)
3. `consequence.affectedEntities` (external consequence affected entities)

Entities are deduplicated into exactly one `entity` graph node following deterministic first-seen order. The `state-has-entity` edge is created **strictly** for entities that exist in `StateSnapshot.entities`, cleanly distinguishing known state entities from external references.

### Canonical Subject Uniqueness (Requirement 42)
Each canonical domain subject maps to exactly one graph node. Duplicate nodes for the same canonical subject are strictly rejected.

---

## 6. Structural Edge Relations & Endpoint Kind Matrix

Edges model direct relationships from canonical records:

| Relation | Source Kind | Target Kind | Notes |
| :--- | :--- | :--- | :--- |
| `context-has-state` | `evaluation-context` | `state-snapshot` | Context binds StateSnapshot |
| `context-has-action` | `evaluation-context` | `proposed-action` | Context binds ProposedAction |
| `state-has-entity` | `state-snapshot` | `entity` | Snapshot contains Entity (strictly for snapshot entities) |
| `state-has-fact` | `state-snapshot` | `fact` | Snapshot contains Fact |
| `fact-describes-entity` | `fact` | `entity` | Fact references `subjectEntityId` |
| `action-targets-entity` | `proposed-action` | `entity` | Action targets Entity; carries `targetRole: ActionTargetRole` |
| `assessment-for-context` | `assessment` | `evaluation-context` | Assessment evaluates Context |
| `assessment-has-consequence` | `assessment` | `consequence` | Assessment contains Consequence |
| `consequence-affects-entity` | `consequence` | `entity` | Consequence affects Entity |
| `fact-supported-by-evidence` | `fact` | `evidence` | Fact evidence records |
| `consequence-supported-by-evidence` | `consequence` | `evidence` | Consequence evidence records |

### Target Role Preservation (Requirement 15, Finding L1)
`action-targets-entity` edges preserve the canonical `ActionTargetRole` (`primary`, `source`, `destination`, `recipient`, `container`, `account`, `resource`, `subject`, `other`) directly on the edge payload. Edge order does not encode semantics.

---

## 7. Deterministic Construction

`buildActionGraph(options: BuildActionGraphOptions): ActionGraph`:
1. Safely reads options with own-property capture and Error normalization (Finding M4 / Section 8, 20).
2. Authoritatively validates `options.context`.
3. Authoritatively validates `options.assessment` against `options.context` (if provided).
4. Constructs nodes in deterministic source order:
   - evaluation-context -> state-snapshot -> proposed-action -> entities (state, then external targets, then external affected entities) -> facts -> fact evidence -> assessment -> consequences -> consequence evidence.
5. Constructs edges in deterministic source order (`state-has-entity` strictly for snapshot entities).
6. Injects `options.idGenerator` when supplied for deterministic testing, strictly rejecting duplicate generated IDs (Finding M3 / Section 16).
7. Validates candidate graph via `validateActionGraph` before returning, guaranteeing builder validity (Finding M3 / Section 15).
8. Returns a detached, deeply immutable `ActionGraph` root via recursive freezing (`deepFreezeActionGraphValue`). Caller inputs are never mutated.

---

## 8. Runtime Validation & Invariants

`validateActionGraph(input: unknown): ValidationResult<ActionGraph>` enforces:
1. **Schema Version:** Must equal `"1.0"`.
2. **ID Validity:** Graph, Node, and Edge IDs must be valid branded non-empty strings.
3. **Timestamp Validity:** `generatedAt` must be a valid ISO 8601 UTC timestamp.
4. **Source Integrity:** Context and optional assessment must validate authoritatively.
5. **Dense Arrays:** Nodes and edges collections must be non-sparse arrays.
6. **Strict Optional Property Semantics (Finding M1):** Optional properties (`assessment`, `label`, `targetRole`) strictly differentiate absent (valid omission), present-valid, present-undefined (invalid), and read-error/throwing-getter (invalid).
7. **Hostile Diagnostic Safety (Finding M4):** Diagnostic messages never invoke untrusted `toString` or getter coercion.
8. **Deep Runtime Immutability (Finding M2):** All successful validation outputs are deeply frozen recursively.
9. **Node Invariants:**
   - Unique `ActionGraphNodeId` across all nodes.
   - Unique canonical subject mapping (no two nodes reference the same domain entity/fact/consequence/qualified evidence) via injective tuple encoding.
   - Node subject matches source records (including external entity references).
10. **Edge Invariants:**
   - Unique `ActionGraphEdgeId` across all edges.
   - Endpoint existence: source and target node IDs must exist in nodes.
   - Endpoint kind matrix: source and target node kinds must conform to relation matrix.
   - Structural edge uniqueness: no duplicate `(sourceNodeId, relation, targetNodeId, targetRole)`.
11. **Completeness by Omission:** Every canonical record in source (including external entity references) must have its structural node; every canonical relation in source must have its structural edge. Omission is invalid.
12. **Source Consistency:** Every edge in the graph must correspond to an actual relationship in source records (no rogue or phantom edges; `state-has-entity` strictly for snapshot entities).
13. **Acyclicity Note:** ActionGraph does not mandate a DAG invariant; structural graphs built from canonical sources are currently acyclic, but future multi-hop models may support cycles.

---

## 9. One-Hop Inspection Query API

Lightweight, non-mutating query utilities:
- `getNodeById(graph, id)`
- `getNodesByKind(graph, kind)`
- `getOutgoingEdges(graph, nodeId)`
- `getIncomingEdges(graph, nodeId)`
- `getNeighbors(graph, nodeId)`
- `findNodeBySubject(graph, subjectRef)`
- `getEdgesByRelation(graph, relation)`

All query utilities return newly created or readonly arrays and do not mutate the graph or internal state.

---

## 10. Privacy and Sensitivity

1. **Inherited Sensitivity:** An ActionGraph contains canonical context and assessment records and therefore inherits all data sensitivity of the underlying state and action.
2. **No Raw Content Injection:** The ActionGraph never injects uncanonicalized or unredacted raw data (passwords, keystrokes, personal data).
3. **Adapter Redaction Mandate:** Content redaction is strictly an adapter-level responsibility prior to canonicalization.
4. **Serialization Safety Boundary:** Serialization to JSON does not imply safety for remote transmission. JSON-safe is NOT privacy-safe.

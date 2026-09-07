/**
 * ActionGraph Deterministic Construction (Sprint FC-003 / FC-003A)
 *
 * Builds an immutable, detached ActionGraph from authoritative canonical domain
 * records (ActionEvaluationContext and optional ConsequenceAssessment).
 *
 * Guarantees:
 * - Safe option property reads with defensive boundaries and error normalization (Finding M4 / Section 8, 20).
 * - Authoritative validation of source inputs before graph construction.
 * - External entity reference support (Finding M5 / Sections 21-29) preserving deterministic first-seen ordering.
 * - state-has-entity generated strictly for StateSnapshot entities (Section 28).
 * - Deterministic node and edge ordering based on canonical source structure.
 * - Injective structured subject and edge keys eliminating delimiter collision vulnerabilities (Findings H1, H2).
 * - Qualified evidence references preserving fact vs consequence ownership scope.
 * - Action target roles preserved on action-targets-entity edges.
 * - Pluggable/injectable IdGenerator for deterministic testing with duplicate ID rejection (Finding M3 / Section 16).
 * - Candidate graph passes validateActionGraph before returning (Finding M3 / Section 15).
 * - Deep runtime immutability via deepFreezeActionGraphValue (Finding M2 / Section 11, 12).
 * - Non-mutating: caller input is never modified.
 */

import {
  type Brand,
  type IdGenerator,
  type IsoTimestamp,
  currentIsoTimestamp,
  generateEntityId,
} from "@futureclick/shared";
import {
  type ActionEvaluationContext,
  type ConsequenceAssessment,
  type EntityId,
  isPlainObject,
  normalizeThrownError,
  readOwnProperty,
  validateActionEvaluationContext,
  validateConsequenceAssessment,
  validateIsoTimestamp,
} from "@futureclick/action-schema";
import {
  ACTION_GRAPH_SCHEMA_VERSION,
  type ActionGraph,
  type ActionGraphEdge,
  type ActionGraphEdgeId,
  type ActionGraphNode,
  type ActionGraphNodeId,
  type ActionGraphNodeKind,
  type ActionGraphRelation,
  type ActionGraphSubjectRef,
  getSubjectKey,
} from "./types.js";
import { validateActionGraph } from "./validation.js";

export interface BuildActionGraphOptions {
  readonly context: ActionEvaluationContext;
  readonly assessment?: ConsequenceAssessment;
  readonly idGenerator?: IdGenerator;
  readonly generatedAt?: IsoTimestamp;
}

/**
 * Builds an ActionGraph from canonical domain records.
 *
 * @throws {Error} if options are invalid, source validation fails, or candidate validation fails.
 * All thrown values are guaranteed to be standard Error instances (Finding M4 / Section 20).
 */
export function buildActionGraph(options: BuildActionGraphOptions): ActionGraph {
  try {
    return buildActionGraphInternal(options);
  } catch (thrown) {
    throw normalizeThrownError(thrown, "Failed to build ActionGraph.");
  }
}

function buildActionGraphInternal(options: BuildActionGraphOptions): ActionGraph {
  if (!isPlainObject(options)) {
    throw new Error("Failed to build ActionGraph: options must be a plain object.");
  }

  // 1. Safe reading of options (Finding M1, M4 / Section 8, 20)
  const ctxProp = readOwnProperty(options, "context");
  if (ctxProp.status === "error") {
    throw new Error('Failed to read option "context".');
  }
  if (ctxProp.status !== "present") {
    throw new Error('Missing required option "context".');
  }
  if (ctxProp.value === undefined) {
    throw new Error('Option "context" must not be undefined.');
  }

  // Authoritative validation of source context
  const contextValidation = validateActionEvaluationContext(ctxProp.value);
  if (!contextValidation.valid) {
    const errorMessages = contextValidation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to build ActionGraph: Context validation failed: ${errorMessages}`);
  }
  const validContext = contextValidation.value;

  // 2. Safe reading of optional assessment
  let validAssessment: ConsequenceAssessment | undefined;
  const asmtProp = readOwnProperty(options, "assessment");
  if (asmtProp.status === "error") {
    throw new Error('Failed to read option "assessment".');
  }
  if (asmtProp.status === "present") {
    if (asmtProp.value === undefined) {
      throw new Error('Option "assessment" must not be present with value undefined.');
    }
    const assessmentValidation = validateConsequenceAssessment(asmtProp.value, validContext);
    if (!assessmentValidation.valid) {
      const errorMessages = assessmentValidation.issues
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
        .join("; ");
      throw new Error(
        `Failed to build ActionGraph: Assessment validation failed: ${errorMessages}`,
      );
    }
    validAssessment = assessmentValidation.value;
  }

  // 3. Safe reading of optional idGenerator
  let idGenerator: IdGenerator | undefined;
  const idGenProp = readOwnProperty(options, "idGenerator");
  if (idGenProp.status === "error") {
    throw new Error('Failed to read option "idGenerator".');
  }
  if (idGenProp.status === "present") {
    if (idGenProp.value === undefined) {
      throw new Error('Option "idGenerator" must not be present with value undefined.');
    }
    if (
      typeof idGenProp.value !== "object" ||
      idGenProp.value === null ||
      typeof (idGenProp.value as Record<string, unknown>).generate !== "function"
    ) {
      throw new Error('Option "idGenerator" must be an object with a callable generate method.');
    }
    idGenerator = idGenProp.value as IdGenerator;
  }

  // 4. Safe reading of optional generatedAt (Finding M3 / Section 17)
  let generatedAt: IsoTimestamp;
  const genProp = readOwnProperty(options, "generatedAt");
  if (genProp.status === "error") {
    throw new Error('Failed to read option "generatedAt".');
  }
  if (genProp.status === "present") {
    if (genProp.value === undefined) {
      throw new Error('Option "generatedAt" must not be present with value undefined.');
    }
    const genRes = validateIsoTimestamp(genProp.value, "options.generatedAt");
    if (!genRes.valid) {
      const errorMsg = genRes.issues.map((i) => i.message).join("; ");
      throw new Error(`Failed to build ActionGraph: Invalid generatedAt timestamp: ${errorMsg}`);
    }
    generatedAt = genRes.value;
  } else {
    generatedAt = currentIsoTimestamp();
  }

  // 5. Injected ID generator with duplicate detection (Finding M3 / Section 16)
  const seenNodeIds = new Set<ActionGraphNodeId>();
  const seenEdgeIds = new Set<ActionGraphEdgeId>();

  const generateId = <TBrand extends string>(prefix: string): Brand<string, TBrand> => {
    if (idGenerator) {
      return idGenerator.generate<TBrand>(prefix);
    }
    return generateEntityId<TBrand>(prefix);
  };

  // 6. Deterministic Node Construction
  const nodes: ActionGraphNode[] = [];
  const subjectNodeIdMap = new Map<string, ActionGraphNodeId>();

  function registerNode(
    kind: ActionGraphNodeKind,
    subject: ActionGraphSubjectRef,
    label?: string,
  ): ActionGraphNode {
    const key = getSubjectKey(subject);
    if (subjectNodeIdMap.has(key)) {
      throw new Error(`Internal error: duplicate canonical subject key "${key}"`);
    }
    const nodeId = generateId<"ActionGraphNodeId">("node");
    if (seenNodeIds.has(nodeId)) {
      throw new Error(
        `Failed to build ActionGraph: Duplicate ActionGraphNodeId "${nodeId}" generated during construction.`,
      );
    }
    seenNodeIds.add(nodeId);

    subjectNodeIdMap.set(key, nodeId);
    const node: ActionGraphNode = {
      id: nodeId,
      kind,
      subject,
      ...(label !== undefined ? { label } : {}),
    };
    nodes.push(node);
    return node;
  }

  // Node Order:
  // 1. evaluation context
  const ctxNode = registerNode(
    "evaluation-context",
    { kind: "evaluation-context", contextId: validContext.id },
    `EvaluationContext (${validContext.id})`,
  );

  // 2. state snapshot
  const stateNode = registerNode(
    "state-snapshot",
    { kind: "state-snapshot", stateId: validContext.state.id },
    `StateSnapshot (${validContext.state.id})`,
  );

  // 3. proposed action
  const actionNode = registerNode(
    "proposed-action",
    { kind: "proposed-action", actionId: validContext.action.id },
    `${validContext.action.intent.verb} (${validContext.action.id})`,
  );

  // 4. Entities: Union of state entities, action targets, and consequence affected entities
  // in deterministic first-seen order (Finding M5 / Sections 21-23)
  const registeredEntityIds = new Set<EntityId>();

  // 4a. StateSnapshot entities (preserve label)
  for (const entity of validContext.state.entities) {
    if (!registeredEntityIds.has(entity.id)) {
      registeredEntityIds.add(entity.id);
      registerNode("entity", { kind: "entity", entityId: entity.id }, entity.label);
    }
  }

  // 4b. External action target entities (unseen IDs)
  for (const target of validContext.action.targets) {
    if (!registeredEntityIds.has(target.entityId)) {
      registeredEntityIds.add(target.entityId);
      registerNode("entity", { kind: "entity", entityId: target.entityId });
    }
  }

  // 4c. External consequence affected entities (unseen IDs)
  if (validAssessment) {
    for (const csq of validAssessment.consequences) {
      for (const affId of csq.affectedEntities) {
        if (!registeredEntityIds.has(affId)) {
          registeredEntityIds.add(affId);
          registerNode("entity", { kind: "entity", entityId: affId });
        }
      }
    }
  }

  // 5. State facts in canonical source order
  for (const fact of validContext.state.facts) {
    registerNode("fact", { kind: "fact", factId: fact.id }, fact.key);
  }

  // 6. Fact evidence in owner/source order
  for (const fact of validContext.state.facts) {
    const factEvidences = fact.evidence ?? [];
    for (const ev of factEvidences) {
      registerNode(
        "evidence",
        {
          kind: "evidence",
          evidenceId: ev.id,
          owner: { kind: "fact", factId: fact.id },
        },
        ev.summary,
      );
    }
  }

  // 7. Assessment if present
  let asmtNode: ActionGraphNode | undefined;
  if (validAssessment) {
    asmtNode = registerNode(
      "assessment",
      { kind: "assessment", assessmentId: validAssessment.id },
      `Assessment (${validAssessment.id})`,
    );

    // 8. Consequences in canonical source order
    for (const csq of validAssessment.consequences) {
      registerNode("consequence", { kind: "consequence", consequenceId: csq.id }, csq.summary);
    }

    // 9. Consequence evidence in owner/source order
    for (const csq of validAssessment.consequences) {
      for (const ev of csq.evidence) {
        registerNode(
          "evidence",
          {
            kind: "evidence",
            evidenceId: ev.id,
            owner: { kind: "consequence", consequenceId: csq.id },
          },
          ev.summary,
        );
      }
    }
  }

  // 7. Deterministic Edge Construction
  const edges: ActionGraphEdge[] = [];

  function registerEdge(
    relation: ActionGraphRelation,
    sourceNodeId: ActionGraphNodeId,
    targetNodeId: ActionGraphNodeId,
    targetRole?: import("@futureclick/action-schema").ActionTargetRole,
  ): ActionGraphEdge {
    const edgeId = generateId<"ActionGraphEdgeId">("edge");
    if (seenEdgeIds.has(edgeId)) {
      throw new Error(
        `Failed to build ActionGraph: Duplicate ActionGraphEdgeId "${edgeId}" generated during construction.`,
      );
    }
    seenEdgeIds.add(edgeId);

    const edge: ActionGraphEdge = {
      id: edgeId,
      relation,
      sourceNodeId,
      targetNodeId,
      ...(targetRole !== undefined ? { targetRole } : {}),
    };
    edges.push(edge);
    return edge;
  }

  function getNodeIdOrThrow(key: string): ActionGraphNodeId {
    const nodeId = subjectNodeIdMap.get(key);
    if (!nodeId) {
      throw new Error(`Internal error: node for subject key "${key}" not found in graph builder.`);
    }
    return nodeId;
  }

  // Edge Order:
  // 1. context-has-state
  registerEdge("context-has-state", ctxNode.id, stateNode.id);

  // 2. context-has-action
  registerEdge("context-has-action", ctxNode.id, actionNode.id);

  // 3. state-has-entity in entity order (STRICTLY for StateSnapshot entities, Finding M5 / Section 28)
  for (const entity of validContext.state.entities) {
    const entNodeId = getNodeIdOrThrow(getSubjectKey({ kind: "entity", entityId: entity.id }));
    registerEdge("state-has-entity", stateNode.id, entNodeId);
  }

  // 4. state-has-fact in fact order
  for (const fact of validContext.state.facts) {
    const factNodeId = getNodeIdOrThrow(getSubjectKey({ kind: "fact", factId: fact.id }));
    registerEdge("state-has-fact", stateNode.id, factNodeId);
  }

  // 5. fact-describes-entity in fact order
  for (const fact of validContext.state.facts) {
    const factNodeId = getNodeIdOrThrow(getSubjectKey({ kind: "fact", factId: fact.id }));
    const entNodeId = getNodeIdOrThrow(
      getSubjectKey({ kind: "entity", entityId: fact.subjectEntityId }),
    );
    registerEdge("fact-describes-entity", factNodeId, entNodeId);
  }

  // 6. fact-supported-by-evidence in fact order, then evidence order
  for (const fact of validContext.state.facts) {
    const factNodeId = getNodeIdOrThrow(getSubjectKey({ kind: "fact", factId: fact.id }));
    const factEvidences = fact.evidence ?? [];
    for (const ev of factEvidences) {
      const evNodeId = getNodeIdOrThrow(
        getSubjectKey({
          kind: "evidence",
          evidenceId: ev.id,
          owner: { kind: "fact", factId: fact.id },
        }),
      );
      registerEdge("fact-supported-by-evidence", factNodeId, evNodeId);
    }
  }

  // 7. action-targets-entity in targets order
  for (const target of validContext.action.targets) {
    const targetEntNodeId = getNodeIdOrThrow(
      getSubjectKey({ kind: "entity", entityId: target.entityId }),
    );
    registerEdge("action-targets-entity", actionNode.id, targetEntNodeId, target.role);
  }

  // Assessment edges (if assessment present):
  if (validAssessment && asmtNode) {
    // 8. assessment-for-context
    registerEdge("assessment-for-context", asmtNode.id, ctxNode.id);

    // 9. assessment-has-consequence in consequences order
    for (const csq of validAssessment.consequences) {
      const csqNodeId = getNodeIdOrThrow(
        getSubjectKey({ kind: "consequence", consequenceId: csq.id }),
      );
      registerEdge("assessment-has-consequence", asmtNode.id, csqNodeId);
    }

    // 10. consequence-affects-entity in consequences order, then affectedEntities order
    for (const csq of validAssessment.consequences) {
      const csqNodeId = getNodeIdOrThrow(
        getSubjectKey({ kind: "consequence", consequenceId: csq.id }),
      );
      for (const affEntityId of csq.affectedEntities) {
        const affEntNodeId = getNodeIdOrThrow(
          getSubjectKey({ kind: "entity", entityId: affEntityId }),
        );
        registerEdge("consequence-affects-entity", csqNodeId, affEntNodeId);
      }
    }

    // 11. consequence-supported-by-evidence in consequences order, then evidence order
    for (const csq of validAssessment.consequences) {
      const csqNodeId = getNodeIdOrThrow(
        getSubjectKey({ kind: "consequence", consequenceId: csq.id }),
      );
      for (const ev of csq.evidence) {
        const evNodeId = getNodeIdOrThrow(
          getSubjectKey({
            kind: "evidence",
            evidenceId: ev.id,
            owner: { kind: "consequence", consequenceId: csq.id },
          }),
        );
        registerEdge("consequence-supported-by-evidence", csqNodeId, evNodeId);
      }
    }
  }

  // 8. Construct candidate graph root
  const candidateGraph: ActionGraph = {
    schemaVersion: ACTION_GRAPH_SCHEMA_VERSION,
    id: generateId<"ActionGraphId">("graph"),
    generatedAt,
    source: {
      context: validContext,
      ...(validAssessment ? { assessment: validAssessment } : {}),
    },
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  };

  // 9. Authoritative candidate validation (Finding M3 / Section 15)
  // Guarantees buildActionGraph returning => returned graph passes validateActionGraph.
  const validation = validateActionGraph(candidateGraph);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Failed to build ActionGraph: Candidate graph validation failed: ${errorMessages}`,
    );
  }

  // validation.value is already deeply frozen by validateActionGraph
  return validation.value;
}

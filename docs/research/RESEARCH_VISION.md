# FutureClick Research Vision

## Initial Research Theme

**Human-centered pre-execution consequence prediction for graphical computer actions.**

Modern graphical operating systems and web applications are optimized for immediate execution. When a user clicks a button, invokes a hotkey, or executes a confirmation dialog, the action is dispatched instantly. For consequential actions—such as irreversible deletions, unintended permission grants, broad asset sharing, or critical configuration updates—post-execution regret is common, and recovery is often impossible or costly.

FutureClick investigates whether computer systems can model, predict, and preview the state transitions caused by proposed actions *before* execution occurs, providing users with human-centered, calibrated consequence previews.

## Canonical Domain Foundation (Sprint FC-002 / FC-002A)

The canonical domain model established and hardened in Sprint FC-002 and FC-002A (`StateSnapshot` + `ProposedAction` → `ActionEvaluationContext` → `ConsequenceAssessment`) provides a rigorous candidate data foundation for prospective ActionGraph and FutureBench research.

By establishing platform-neutral contracts for state observations, proposed operations, and consequence envelopes, this representation directly enhances empirical research:
- **Cross-Adapter Normalization:** Platform adapters normalize heterogeneous native GUI primitives into a controlled vocabulary of `ActionVerb`, `ActionTargetRole`, `KnownEntityKind`, and namespaced fact keys (`namespace.property`), enabling comparative analysis across macOS, Windows, Linux, and Web environments.
- **FutureBench Comparability:** Structured target roles, orthogonal temporal descriptors (`timing` and `frequency`), and tri-modal evidence records provide standardized, benchmarkable dimensions for comparing consequence prediction algorithms.
- **Evidence and Assessment Lineage:** Explicit binding of `ConsequenceAssessment` to `evaluationContextId` and `actionId`, along with strict evidence identity uniqueness, guarantees reproducible evaluation traces across benchmark datasets.
- **Epistemological Integrity:** Preserves the tri-modal boundary (`VERIFIED`, `SIMULATED`, `PREDICTED`), ensuring machine learning predictions are never conflated with deterministic verification or empirical simulation.

## ActionGraph Structural Intermediate Representation (Sprint FC-003)

Sprint FC-003 establishes the `ActionGraph` representation over canonical evaluation records. The ActionGraph serves as a candidate structural intermediate representation (IR) connecting entities, facts, actions, assessments, consequences, and evidence via a controlled structural vocabulary.

In future research milestones, the ActionGraph may serve as an analytical substrate for investigating:
- **Cross-Application Structural Consistency:** Whether heterogeneous desktop, terminal, and web environments produce topologically consistent graph relationships for semantically equivalent actions.
- **Graph Coverage & Representation Completeness:** Measuring the proportion of observable domain entities and side effects captured in the graph versus unmodeled background state.
- **Canonical Relation Consistency:** Verifying that structural edges (e.g. target roles, affected entities, and evidence bindings) remain invariant across diverse adapter implementations.
- **Future Consequence-Path Prediction:** Serving as a potential input representation for prospective downstream models exploring multi-hop consequence propagation (strictly future work; FC-003 provides no causal or predictive logic).
- **Representation Transfer:** Exploring whether relational patterns learned in one application domain can transfer to distinct software environments without retraining.

### Conceptual Relationship to FutureBench
Future FutureBench benchmark examples may conceptually include:
1. Canonical `ActionEvaluationContext`
2. Canonical `ConsequenceAssessment`
3. Derived `ActionGraph` structural representation

This pairing may later support quantitative benchmarking of representation coverage, relational consistency, and downstream consequence prediction quality. No datasets or benchmark runs have been collected at this stage.

## Central Research Questions & Measurable Future Investigations

1. **Representation Coverage Across Applications:** What percentage of common desktop and web user actions can be mapped into the canonical State → Action schema without loss of critical semantic nuance?
2. **Semantic Consistency Across Adapters:** Do independent platform adapters (macOS Accessibility, Windows UI Automation, Chrome DevTools Protocol) generate structurally comparable and semantically consistent canonical snapshots for identical workflows? Normalization conventions established in FC-002A must be empirically evaluated across diverse adapter implementations.
3. **Consequence Prediction Accuracy Conditioned on Canonical State/Action:** How accurately can downstream predictive evaluators project post-action state mutations when conditioned exclusively on normalized canonical envelopes?
4. **Generalization to Unseen Applications:** Can consequence evaluators trained or configured on common GUI paradigms generalize effectively to unseen, proprietary, or custom enterprise applications?
5. **Modality Triage:** Under what formal criteria should the consequence engine dispatch evaluation to deterministic rules (VERIFIED), isolated sandboxes (SIMULATED), or learned models (PREDICTED)?
6. **Uncertainty Calibration:** Can prediction uncertainty be calibrated so that numerical confidence scores accurately reflect empirical real-world error distributions?
7. **Human Decision Quality & Cognitive Load:** Can lightweight, non-modal consequence previews measurably reduce critical user errors without causing notification fatigue or habitual dismissal?

## Scientific Status and Non-Claim Statement

**Explicit Statement on Current Scientific Status:**
FutureClick is in early architectural and domain-modeling development (`Sprint FC-003`). No benchmark results, accuracy metrics, user study data, novel algorithmic proofs, generalization claims, or publication-ready findings exist at this stage. All research questions and normalization conventions outlined above represent prospective avenues of empirical investigation.

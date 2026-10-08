/**
 * FC-008 Sprint 5B — map a captured BrowserObservation to a sanitized
 * ActionObservation payload.
 *
 * THE MAPPER MAY ONLY EMIT SEMANTIC EVIDENCE DERIVED FROM PRIVACY-SAFE
 * OBSERVED UI FIELDS ON BrowserObservation, OR A DOCUMENTED CAPTURE-API
 * CONSTANT.
 *
 * Fixture / machine / oracle metadata is unread and must not enter primary
 * features, tokens, fingerprints, or class reconstruction:
 *
 *   metadata.operation              data-futureclick-operation
 *   metadata.currentVisibility      data-futureclick-current-visibility
 *   metadata.requestedVisibility    data-futureclick-requested-visibility
 *   metadata.fixtureContract        data-futureclick-fixture-contract
 *   metadata.entityKey              data-futureclick-entity-key
 *   page.origin / page.routeId      capture-location identity
 *
 * Current FC-005 BrowserObservation does not carry trustworthy observed
 * control text, accessible name, heading, nearby labels, object kind, or
 * measured ancestor depth. The frozen extractor refuses an empty token
 * set (`no-retained-semantic-tokens`). Inventing tokens or `ancestorDepth: 0`
 * would fabricate primary features (`cnt:surface-depth:0` is a real bucket).
 *
 * Honest outcome: extraction-refused. Later capture work may supply real
 * UI semantics; do not compensate here.
 */

import {
  CONTROL_KINDS,
  CONTROL_ROLES,
  type ControlKind,
  type ControlRole,
  type Fc008UnderstandActionMessage,
  type FormMethod,
  INTERACTION_KINDS,
  type InteractionKind,
} from "@futureclick/action-understanding";
import type { BrowserObservation } from "@futureclick/browser-adapter";
import type { IsoTimestamp } from "@futureclick/shared";

const CONTROL_KIND_SET = new Set<string>(CONTROL_KINDS);
const CONTROL_ROLE_SET = new Set<string>(CONTROL_ROLES);
const INTERACTION_KIND_SET = new Set<string>(INTERACTION_KINDS);

function asControlKind(value: string): ControlKind {
  return CONTROL_KIND_SET.has(value) ? (value as ControlKind) : "other";
}

function asControlRole(value: string): ControlRole {
  return CONTROL_ROLE_SET.has(value) ? (value as ControlRole) : "other";
}

function asInteractionKind(value: string): InteractionKind {
  return INTERACTION_KIND_SET.has(value) ? (value as InteractionKind) : "other";
}

/**
 * `element.buttonType` is a native HTML control property, not fixture metadata.
 * Documented for a future capture that can retain observed text. Unused while
 * extraction refuses an empty token set.
 */
function formMethodFromButtonType(buttonType: string): FormMethod {
  const normalized = buttonType.trim().toLowerCase();
  if (normalized === "button" || normalized === "reset") {
    return "none";
  }
  return "other";
}

export type BrowserObservationMapResult =
  | { readonly ok: true; readonly message: Fc008UnderstandActionMessage }
  | { readonly ok: false; readonly reason: "extraction-refused" };

/**
 * Project a BrowserObservation into a closed FC-008 message.
 *
 * Observed structural fields (element.kind / role / buttonType,
 * interaction.kind) are read only to prove they are available and are not
 * fixture tokens. They cannot form a valid ActionObservation without
 * retained semantic tokens, and ancestor depth is not measured, so this
 * function does not call `buildObservationFromSurface`.
 *
 * `now` is accepted for call-site compatibility with the publication clock.
 */
export function mapBrowserObservationToMessage(
  observation: BrowserObservation,
  _observationSequence: number,
  _now: IsoTimestamp,
): BrowserObservationMapResult {
  // Read only observed control/interaction descriptors. Do not touch
  // observation.metadata or observation.page.
  void asControlKind(observation.element.kind);
  void asControlRole(observation.element.role);
  void asInteractionKind(observation.interaction.kind);
  void formMethodFromButtonType(observation.element.buttonType);
  return { ok: false, reason: "extraction-refused" };
}

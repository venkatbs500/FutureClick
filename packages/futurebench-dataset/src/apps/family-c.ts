/**
 * Application family C — "Riverbed Research Commons".
 *
 * A synthetic research-data catalogue: a library metaphor rather than a workspace
 * or a developer platform. Its conventions are drawn from archival software —
 * "collections" instead of folders, "stewards" instead of members or principals,
 * "deposits" instead of uploads, card-based browsing with a persistent metadata
 * sidebar, and a habit of narrating consequences in a sentence under the control
 * rather than inside a confirmation dialog.
 *
 * WHY THIS FAMILY IS PARTIAL
 *
 * C exists to be HELD OUT. It is the out-of-application partition, so the question
 * it answers is whether a model trained on other products generalizes to a UI
 * language it has never seen. That only needs the classes under repeated
 * out-of-application analysis, not all thirteen, and padding it to thirteen would
 * add authoring surface without adding evidence.
 *
 * Every class here is deliberately one that families A and B also cover, because the
 * held-out measurement is meaningless if the class is absent from training: a model
 * cannot be shown to have failed to generalize a concept it was never taught. The
 * partitioner enforces that rather than trusting this comment.
 */

import {
  control,
  establishes,
  nameLikeText,
  scenario,
  semanticText,
  state,
  surfaceSnapshot,
  transition,
  userEnteredText,
} from "../authoring.js";
import type { ApplicationFamily, ScenarioSpecification } from "../scenario.js";
import { STANDARD_VARIANT_KINDS, deriveVariants } from "../variants.js";

const FAMILY_ID = "family-c-riverbed-commons";

interface AuthoredLineage {
  readonly lineageId: string;
  readonly scenario: ScenarioSpecification;
}

function lineage(
  lineageId: string,
  intent: ReturnType<typeof establishes>,
  surface: ReturnType<typeof surfaceSnapshot>,
): AuthoredLineage {
  return {
    lineageId,
    scenario: scenario({
      scenarioId: `c-${lineageId}`,
      applicationFamilyId: FAMILY_ID,
      templateLineageId: `c-${lineageId}`,
      intent,
      surface,
    }),
  };
}

const LINEAGES: readonly AuthoredLineage[] = [
  // ---- class 1: delete / file / existence ---------------------------------
  lineage(
    "deposit-withdraw",
    establishes(transition("delete", "file", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Deposit record"), nameLikeText("spectra-run-114")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file", "resource"],
      candidates: [
        control({
          ownText: semanticText("Cite this deposit"),
          controlKind: "link",
          controlRole: "link",
        }),
        control({ ownText: semanticText("Request embargo"), controlKind: "button" }),
        control({
          ownText: semanticText("Withdraw deposit from the catalogue"),
          accessibleName: semanticText("Withdraw this deposited data file"),
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("The stored copy is destroyed and the citation stops resolving"),
            semanticText("Stewards are notified"),
          ],
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 3: share / file / access -------------------------------------
  lineage(
    "deposit-open-to-readers",
    establishes(transition("share", "file", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("Availability"), semanticText("Held under restriction")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Release to readers of this collection"),
          accessibleName: semanticText("Release this data file to collection readers"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          nearbyLabels: [semanticText("Currently only stewards may retrieve it")],
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("View retrieval log"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  ),

  // ---- class 5: rename / file / name --------------------------------------
  lineage(
    "deposit-retitle",
    establishes(transition("rename", "file", "name", "current", "replaced")),
    surfaceSnapshot({
      surfaceKind: "non-modal-dialog",
      headings: [semanticText("Correct the deposit title")],
      stateSignals: [state("name", "current")],
      objectKindEvidence: ["file"],
      candidates: [
        control({ ownText: semanticText("Discard correction"), interactionKind: "dismiss" }),
        control({
          ownText: semanticText("Record the corrected title"),
          controlKind: "input-button",
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [
            userEnteredText("Spectral survey, revised pass"),
            semanticText("The previous title is kept in the revision history"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 8: change-access / repository / visibility -------------------
  lineage(
    "collection-open-catalogue",
    establishes(transition("change-access", "repository", "visibility", "private", "public")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("Collection stewardship"),
        semanticText("Closed catalogue"),
        nameLikeText("Coastal Sediment Archive"),
      ],
      stateSignals: [state("visibility", "private")],
      objectKindEvidence: ["repository", "resource"],
      candidates: [
        control({ ownText: semanticText("Invite a steward"), controlKind: "button" }),
        control({
          ownText: semanticText("Open this collection to the public catalogue"),
          accessibleName: semanticText("Open the collection so anyone may browse it"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("Every deposit inside becomes browsable by anyone"),
            semanticText("Listed in the national index within a day"),
            semanticText("This cannot be reversed for already-cited deposits"),
          ],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("Export metadata"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Close catalogue"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 9: grant / permission / grant-state --------------------------
  lineage(
    "steward-capability-grant",
    establishes(transition("grant", "permission", "grant-state", "absent", "granted")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Stewardship capabilities")],
      stateSignals: [state("grant-state", "absent")],
      objectKindEvidence: ["permission", "account"],
      candidates: [
        control({
          ownText: semanticText("Allow this steward to accept deposits"),
          accessibleName: semanticText("Allow the steward to accept deposits into the collection"),
          controlKind: "other",
          controlRole: "checkbox",
          interactionKind: "toggle",
          formMethod: "post",
          nearbyLabels: [
            semanticText("Not currently permitted"),
            nameLikeText("Dr Amara Oyelaran"),
          ],
          ancestorDepth: 2,
        }),
        control({ ownText: semanticText("Leave unchanged"), interactionKind: "dismiss" }),
      ],
    }),
  ),

  // ---- class 12: send / message / delivery -------------------------------
  lineage(
    "steward-notice-dispatch",
    establishes(transition("send", "message", "delivery", "draft", "sent")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("Notices"), semanticText("Held as a draft")],
      stateSignals: [state("delivery", "draft")],
      objectKindEvidence: ["message"],
      candidates: [
        control({
          ownText: semanticText("Preview notice"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Circulate the notice to stewards"),
          accessibleName: semanticText("Circulate this notice now"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "activate",
          nearbyLabels: [
            userEnteredText("The embargo on the sediment cores lifts next month."),
            semanticText("Nine recipients"),
          ],
          ancestorDepth: 7,
        }),
      ],
      targetIndex: 1,
    }),
  ),
];

export const FAMILY_C: ApplicationFamily = {
  applicationFamilyId: FAMILY_ID,
  description:
    "Riverbed Research Commons: a research-data catalogue of collections, deposits, " +
    "stewards, embargoes, and citations.",
  independenceBasis:
    "Independently authored archival product: library/catalogue information " +
    "architecture, 'collection' and 'deposit' and 'steward' terminology, " +
    "consequence narrated as prose beneath the control rather than in a dialog, " +
    "card browsing with a persistent metadata sidebar. Partial class coverage " +
    "because this family is held out for out-of-application measurement.",
  scenarios: LINEAGES.flatMap((authored) => [
    authored.scenario,
    ...deriveVariants(authored.scenario, STANDARD_VARIANT_KINDS),
  ]),
};

/**
 * Application family A — "Atlas Workspace".
 *
 * A synthetic file-and-document collaboration product. Its conventions: noun-first
 * headings, explicit verb buttons, confirmation modals for destructive work,
 * settings expressed as panels with a "danger zone", and the word "member" for
 * people.
 *
 * Two independently authored lineages per class, each reaching the same semantic
 * transition through a different part of the product — a row menu versus a bulk
 * toolbar, a settings panel versus an inline dropdown. Reaching one meaning by two
 * routes is what makes within-family generalization measurable; a second lineage
 * that merely restated the first with new words would be a variant, and variants
 * are generated rather than authored.
 *
 * None of this text is derived from a class name or a tuple. Where a verb coincides
 * with the canonical verb it is because that is what such a product would actually
 * put on the button, and the authored intent is stated separately in every case.
 */

import {
  control,
  establishes,
  establishesNothingSupported,
  establishesSubmission,
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

const FAMILY_ID = "family-a-atlas-workspace";

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
      scenarioId: `a-${lineageId}`,
      applicationFamilyId: FAMILY_ID,
      templateLineageId: `a-${lineageId}`,
      intent,
      surface,
    }),
  };
}

const LINEAGES: readonly AuthoredLineage[] = [
  // ---- class 1: delete / file / existence ---------------------------------
  lineage(
    "file-row-delete",
    establishes(transition("delete", "file", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Delete this file?"), nameLikeText("quarterly-costs.xlsx")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Delete file"),
          accessibleName: semanticText("Delete file permanently"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [semanticText("This cannot be undone"), semanticText("Owned by you")],
          ancestorDepth: 2,
        }),
        control({ ownText: semanticText("Cancel"), interactionKind: "dismiss" }),
      ],
    }),
  ),
  lineage(
    "file-bulk-delete",
    establishes(transition("delete", "file", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("3 files selected"), semanticText("Storage")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file", "folder"],
      candidates: [
        control({
          ownText: semanticText("Download"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Erase selected files"),
          accessibleName: semanticText("Erase the selected files from storage"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          destructiveStyle: true,
          nearbyLabels: [semanticText("Files are not recoverable after 30 days")],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("Clear selection"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 2: delete / document / existence -----------------------------
  lineage(
    "doc-editor-delete",
    establishes(transition("delete", "document", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("Document actions")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("Version history"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Duplicate"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Delete document"),
          accessibleName: semanticText("Delete this document"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          destructiveStyle: true,
          nearbyLabels: [semanticText("Editors will lose access")],
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 2,
    }),
  ),
  lineage(
    "doc-library-discard",
    establishes(transition("delete", "document", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("Library"), nameLikeText("Onboarding handbook")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("Discard this document"),
          interactionKind: "activate",
          destructiveStyle: true,
          nearbyLabels: [semanticText("Last edited by a member of your team")],
          ancestorDepth: 6,
        }),
        control({ ownText: semanticText("Open"), controlKind: "link", controlRole: "link" }),
      ],
    }),
  ),

  // ---- class 3: share / file / access -------------------------------------
  lineage(
    "file-share-dialog",
    establishes(transition("share", "file", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Who can see this file"), semanticText("Currently private")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Share file with team"),
          accessibleName: semanticText("Give the team access to this file"),
          interactionKind: "confirm",
          nearbyLabels: [semanticText("Anyone in the workspace will be able to open it")],
          ancestorDepth: 3,
        }),
        control({ ownText: semanticText("Keep private"), interactionKind: "dismiss" }),
      ],
    }),
  ),
  lineage(
    "file-row-access-toggle",
    establishes(transition("share", "file", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("File access")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["file", "account"],
      candidates: [
        control({
          ownText: semanticText("Allow workspace members to view"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          nearbyLabels: [semanticText("Restricted to you"), semanticText("No link exists yet")],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("Copy link"),
          controlKind: "button",
          controlRole: "button",
        }),
      ],
    }),
  ),

  // ---- class 4: share / document / access ---------------------------------
  lineage(
    "doc-share-panel",
    establishes(transition("share", "document", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Document sharing"), semanticText("Only you have access")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("Manage members"),
          controlKind: "link",
          controlRole: "link",
        }),
        control({
          ownText: semanticText("Share document"),
          accessibleName: semanticText("Share this document with the workspace"),
          nearbyLabels: [semanticText("Members will be able to comment")],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "doc-invite-collaborators",
    establishes(transition("share", "document", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Invite collaborators")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["document", "account"],
      candidates: [
        control({
          ownText: semanticText("Give access to this document"),
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [
            userEnteredText("hanna.lindqvist@example.com"),
            semanticText("Collaborators can edit"),
          ],
          ancestorDepth: 2,
        }),
        control({ ownText: semanticText("Close"), interactionKind: "dismiss" }),
      ],
    }),
  ),

  // ---- class 5: rename / file / name --------------------------------------
  lineage(
    "file-rename-dialog",
    establishes(transition("rename", "file", "name", "current", "replaced")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Rename file")],
      stateSignals: [state("name", "current")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Save new name"),
          accessibleName: semanticText("Apply the new file name"),
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [
            userEnteredText("budget-v7-final.xlsx"),
            semanticText("Extension unchanged"),
          ],
          ancestorDepth: 3,
        }),
        control({ ownText: semanticText("Cancel"), interactionKind: "dismiss" }),
      ],
    }),
  ),
  lineage(
    "file-inline-rename",
    establishes(transition("rename", "file", "name", "current", "replaced")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [],
      stateSignals: [state("name", "current")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Confirm title change"),
          controlKind: "input-button",
          interactionKind: "confirm",
          nearbyLabels: [semanticText("Press enter to apply")],
          ancestorDepth: 7,
        }),
        control({ ownText: semanticText("Revert"), controlKind: "link", controlRole: "link" }),
      ],
    }),
  ),

  // ---- class 6: move / file / container -----------------------------------
  lineage(
    "file-move-picker",
    establishes(transition("move", "file", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Choose a destination"), semanticText("Moving 1 file")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["file", "folder"],
      candidates: [
        control({ ownText: semanticText("New folder"), controlKind: "link", controlRole: "link" }),
        control({
          ownText: semanticText("Move file here"),
          accessibleName: semanticText("Move the file into the selected folder"),
          interactionKind: "confirm",
          nearbyLabels: [semanticText("The file leaves its current folder")],
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "file-relocate-menu",
    establishes(transition("move", "file", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("Organise")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Add to starred"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Put file in another folder"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          nearbyLabels: [semanticText("Current folder shown above")],
          ancestorDepth: 5,
        }),
        control({ ownText: semanticText("Pin"), controlKind: "menuitem", controlRole: "menuitem" }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 7: move / folder / container ---------------------------------
  lineage(
    "folder-move-dialog",
    establishes(transition("move", "folder", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Move folder"), semanticText("Includes 42 items")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["folder"],
      candidates: [
        control({
          ownText: semanticText("Move folder and contents"),
          accessibleName: semanticText("Move this folder and everything inside it"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("Subfolders move too"),
            semanticText("Permissions are inherited"),
          ],
          ancestorDepth: 3,
        }),
        control({ ownText: semanticText("Cancel"), interactionKind: "dismiss" }),
      ],
    }),
  ),
  lineage(
    "folder-tree-drop",
    establishes(transition("move", "folder", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "non-modal-dialog",
      headings: [semanticText("Confirm reorganisation")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["folder", "file"],
      candidates: [
        control({ ownText: semanticText("Undo"), controlKind: "link", controlRole: "link" }),
        control({
          ownText: semanticText("Nest folder under the selected parent"),
          interactionKind: "confirm",
          nearbyLabels: [semanticText("Dragged from the sidebar")],
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 8: change-access / repository / visibility -------------------
  lineage(
    "repo-danger-zone-visibility",
    establishes(transition("change-access", "repository", "visibility", "private", "public")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Danger zone"), semanticText("Repository settings")],
      stateSignals: [state("visibility", "private")],
      objectKindEvidence: ["repository"],
      candidates: [
        control({
          ownText: semanticText("Make repository public"),
          accessibleName: semanticText("Change repository visibility to public"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("Anyone on the internet will be able to read the code"),
            semanticText("Currently restricted to members"),
          ],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("Transfer ownership"),
          controlKind: "button",
          controlRole: "button",
        }),
        control({ ownText: semanticText("Archive"), controlKind: "button", controlRole: "button" }),
      ],
    }),
  ),
  lineage(
    "repo-visibility-dropdown",
    establishes(transition("change-access", "repository", "visibility", "private", "public")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("Visibility")],
      stateSignals: [state("visibility", "private")],
      objectKindEvidence: ["repository"],
      candidates: [
        control({
          ownText: semanticText("Everyone can view this repository"),
          controlKind: "menuitem",
          controlRole: "radio",
          interactionKind: "select",
          nearbyLabels: [
            semanticText("Only members can view this repository"),
            semanticText("Selected"),
          ],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("Only members"),
          controlKind: "menuitem",
          controlRole: "radio",
          interactionKind: "select",
        }),
      ],
    }),
  ),

  // ---- class 9: grant / permission / grant-state --------------------------
  lineage(
    "permission-request-approve",
    establishes(transition("grant", "permission", "grant-state", "absent", "granted")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Access request"), semanticText("Pending approval")],
      stateSignals: [state("grant-state", "absent")],
      objectKindEvidence: ["permission", "account"],
      candidates: [
        control({
          ownText: semanticText("Approve access"),
          accessibleName: semanticText("Approve this access request"),
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [
            semanticText("The member currently has no access"),
            nameLikeText("Hanna Lindqvist"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("Deny"),
          interactionKind: "dismiss",
          destructiveStyle: true,
        }),
      ],
    }),
  ),
  lineage(
    "role-assignment-panel",
    establishes(transition("grant", "permission", "grant-state", "absent", "granted")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Roles and capabilities")],
      stateSignals: [state("grant-state", "absent")],
      objectKindEvidence: ["permission"],
      candidates: [
        control({ ownText: semanticText("Audit log"), controlKind: "link", controlRole: "link" }),
        control({
          ownText: semanticText("Give this member edit rights"),
          controlKind: "other",
          controlRole: "checkbox",
          interactionKind: "toggle",
          nearbyLabels: [
            semanticText("Not permitted yet"),
            semanticText("Applies across the workspace"),
          ],
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 10: subscribe / subscription / status ------------------------
  lineage(
    "plan-upgrade",
    establishes(transition("subscribe", "subscription", "status", "inactive", "active")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [semanticText("Choose a plan"), semanticText("No plan is running")],
      stateSignals: [state("status", "inactive")],
      objectKindEvidence: ["subscription"],
      candidates: [
        control({
          ownText: semanticText("Start the team plan"),
          accessibleName: semanticText("Begin the team subscription"),
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [semanticText("Billed monthly"), semanticText("Cancel at any time")],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("Compare plans"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  ),
  lineage(
    "billing-reactivate",
    establishes(transition("subscribe", "subscription", "status", "inactive", "active")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("Billing"), semanticText("Lapsed")],
      stateSignals: [state("status", "inactive")],
      objectKindEvidence: ["subscription", "account"],
      candidates: [
        control({
          ownText: semanticText("Resume paid service"),
          interactionKind: "activate",
          nearbyLabels: [semanticText("Your plan ended last month")],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("Download invoices"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  ),

  // ---- class 11: install / application / installation --------------------
  lineage(
    "marketplace-install",
    establishes(transition("install", "application", "installation", "absent", "installed")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [semanticText("Marketplace"), semanticText("Not added to this workspace")],
      stateSignals: [state("installation", "absent")],
      objectKindEvidence: ["application"],
      candidates: [
        control({
          ownText: semanticText("Install app"),
          accessibleName: semanticText("Install this application into the workspace"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("Requests access to your files"),
            semanticText("Published by a verified partner"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("Read documentation"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  ),
  lineage(
    "integration-add",
    establishes(transition("install", "application", "installation", "absent", "installed")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Integrations")],
      stateSignals: [state("installation", "absent")],
      objectKindEvidence: ["application", "permission"],
      candidates: [
        control({ ownText: semanticText("Browse all"), controlKind: "link", controlRole: "link" }),
        control({
          ownText: semanticText("Add this integration"),
          interactionKind: "activate",
          formMethod: "post",
          nearbyLabels: [semanticText("Nothing is connected yet")],
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 12: send / message / delivery -------------------------------
  lineage(
    "compose-send",
    establishes(transition("send", "message", "delivery", "draft", "sent")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("New message"), semanticText("Draft")],
      stateSignals: [state("delivery", "draft")],
      objectKindEvidence: ["message"],
      candidates: [
        control({
          ownText: semanticText("Send message"),
          accessibleName: semanticText("Send this message now"),
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            userEnteredText("Hi team, please review before Friday."),
            semanticText("4 recipients"),
          ],
          ancestorDepth: 3,
        }),
        control({ ownText: semanticText("Save draft"), interactionKind: "activate" }),
      ],
    }),
  ),
  lineage(
    "draft-list-dispatch",
    establishes(transition("send", "message", "delivery", "draft", "sent")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("Drafts")],
      stateSignals: [state("delivery", "draft")],
      objectKindEvidence: ["message", "account"],
      candidates: [
        control({
          ownText: semanticText("Deliver now"),
          interactionKind: "activate",
          nearbyLabels: [semanticText("Not yet delivered"), semanticText("Scheduled for later")],
          ancestorDepth: 7,
        }),
        control({ ownText: semanticText("Edit"), controlKind: "link", controlRole: "link" }),
        control({ ownText: semanticText("Discard draft"), destructiveStyle: true }),
      ],
    }),
  ),

  // ---- class 13: submit / form / submission ------------------------------
  // The submission IS the semantic action here: nothing in classes 1 to 12 is
  // established, so there is no more specific reading available.
  lineage(
    "access-request-form",
    establishesSubmission(),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [semanticText("Workspace access request"), semanticText("Ready to send")],
      stateSignals: [state("submission", "ready")],
      objectKindEvidence: ["form"],
      candidates: [
        control({
          ownText: semanticText("Submit request"),
          accessibleName: semanticText("Submit this access request form"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            semanticText("A reviewer will respond within two days"),
            semanticText("All fields complete"),
          ],
          ancestorDepth: 4,
        }),
        control({ ownText: semanticText("Save for later"), interactionKind: "activate" }),
      ],
    }),
  ),
  lineage(
    "feedback-form-submit",
    establishesSubmission(),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Tell us what you think")],
      stateSignals: [state("submission", "ready")],
      objectKindEvidence: ["form"],
      candidates: [
        control({ ownText: semanticText("Not now"), interactionKind: "dismiss" }),
        control({
          ownText: semanticText("Send feedback"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            userEnteredText("The sidebar is hard to find."),
            semanticText("Anonymous"),
          ],
          ancestorDepth: 2,
        }),
      ],
      targetIndex: 1,
    }),
  ),
];

/**
 * Surfaces whose action is outside the thirteen supported tuples.
 *
 * Abstention is the CORRECT answer on every one of these, which makes them a
 * different measurement from the out-of-application family: there the product is
 * unfamiliar but the action is known, here the product is familiar but the action
 * has no supported meaning. Conflating the two would let an abstention look like a
 * generalization failure, so the partitioner keeps them apart.
 *
 * They live inside family A on purpose. An unsupported action encountered in a
 * well-known product is the realistic case — exporting, printing, archiving, and
 * unsubscribing sit on the same toolbars as the actions FutureClick does model —
 * and it is a harder test than a novel action on a novel surface, because the
 * surrounding vocabulary is all familiar.
 *
 * Each one declares no supported transition, so the oracle declines and the record
 * carries a rejected disposition rather than a class. Some carry state signals over
 * properties outside the frozen set; the extractor drops those, which is the
 * intended behaviour and is why they appear here.
 */
const NOVELTY_LINEAGES: readonly ScenarioSpecification[] = [
  /**
   * A search form, which is where `formMethod: "get"` legitimately belongs.
   *
   * Every one of the thirteen supported classes is a state transition, and a state
   * transition behind a GET form is implausible product copy — GET is for retrieval,
   * and authoring a destructive GET would have put a bad pattern into the corpus
   * purely to fill in an enum value. Searching retrieves, changes nothing, and has no
   * supported meaning, so it belongs here rather than under a learned class.
   *
   * This is the only surface in the corpus carrying `fm:get`, and it is deliberately
   * confined to test-novelty, so the train-fitted vocabulary never contains the value
   * and the projector meets it as an unseen feature and ignores it. That is the
   * behaviour worth having a fixture for: an unfamiliar form method must not crash the
   * projector and must not be quietly mapped onto a familiar one.
   */
  scenario({
    scenarioId: "a-novelty-search-files",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-search-files",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Find in workspace")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Search"),
          accessibleName: semanticText("Search this workspace"),
          controlKind: "input-button",
          controlRole: "button",
          interactionKind: "submit",
          formMethod: "get",
          nearbyLabels: [
            semanticText("Results update as you refine the filters"),
            semanticText("Searching does not change anything"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("Clear filters"),
          controlKind: "other",
          controlRole: "button",
          formMethod: "get",
        }),
      ],
    }),
  }),
  scenario({
    scenarioId: "a-novelty-export-csv",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-export-csv",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("Export")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("Export as a spreadsheet"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
        control({
          ownText: semanticText("Export as plain text"),
          controlKind: "menuitem",
          controlRole: "menuitem",
        }),
      ],
    }),
  }),
  scenario({
    scenarioId: "a-novelty-start-call",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-start-call",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("Meet now")],
      objectKindEvidence: ["process"],
      candidates: [
        control({
          ownText: semanticText("Start a video call"),
          nearbyLabels: [semanticText("Camera and microphone are required")],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("Schedule instead"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  }),
  scenario({
    scenarioId: "a-novelty-archive-repository",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-archive-repository",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Archive"), semanticText("Repository settings")],
      objectKindEvidence: ["repository"],
      candidates: [
        control({
          ownText: semanticText("Mark this repository read-only"),
          accessibleName: semanticText("Archive the repository and make it read-only"),
          interactionKind: "confirm",
          nearbyLabels: [semanticText("Nothing is deleted and visibility does not change")],
          ancestorDepth: 5,
        }),
        control({ ownText: semanticText("Cancel"), interactionKind: "dismiss" }),
      ],
    }),
  }),
  scenario({
    scenarioId: "a-novelty-unsubscribe",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-unsubscribe",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "page",
      headings: [semanticText("Billing"), semanticText("Team plan is running")],
      objectKindEvidence: ["subscription"],
      candidates: [
        control({ ownText: semanticText("Keep my plan"), interactionKind: "dismiss" }),
        control({
          ownText: semanticText("End the plan at the next renewal"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [semanticText("Access continues until the period ends")],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  }),
  scenario({
    scenarioId: "a-novelty-reorder-columns",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-reorder-columns",
    intendedForNovelty: true,
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("Table layout")],
      objectKindEvidence: ["ui_control"],
      candidates: [
        control({
          ownText: semanticText("Move this column to the front"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "select",
          nearbyLabels: [semanticText("Affects only your own view")],
          ancestorDepth: 8,
        }),
        control({
          ownText: semanticText("Reset layout"),
          controlKind: "link",
          controlRole: "link",
        }),
      ],
    }),
  }),
  scenario({
    scenarioId: "a-novelty-revoke-access",
    applicationFamilyId: FAMILY_ID,
    templateLineageId: "a-novelty-revoke-access",
    intendedForNovelty: true,
    // The REVERSE of class 9. The matrix supports absent -> granted, not the other
    // direction, so this is genuinely unsupported rather than merely unusual, and
    // it is the most instructive novelty case here: a model keying on the words
    // "access" and "permission" will reach for class 9 when it should abstain.
    intent: establishesNothingSupported(),
    surface: surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [semanticText("Remove access")],
      objectKindEvidence: ["permission", "account"],
      candidates: [
        control({
          ownText: semanticText("Take away edit rights"),
          accessibleName: semanticText("Revoke this member's edit rights"),
          interactionKind: "confirm",
          destructiveStyle: true,
          formMethod: "post",
          nearbyLabels: [semanticText("They keep read access")],
          ancestorDepth: 2,
        }),
        control({ ownText: semanticText("Keep rights"), interactionKind: "dismiss" }),
      ],
    }),
  }),
];

/**
 * The family, with its canonical scenarios and their generated variants.
 *
 * `independenceBasis` records WHY this family counts as independent evidence. A
 * recolour or a rename would not; a separately designed information architecture
 * with its own vocabulary does.
 */
export const FAMILY_A: ApplicationFamily = {
  applicationFamilyId: FAMILY_ID,
  description:
    "Atlas Workspace: a file and document collaboration product with storage, " +
    "repositories, billing, integrations, and messaging.",
  independenceBasis:
    "Independently authored product: panel-and-modal information architecture, " +
    "noun-first headings, explicit verb buttons, confirmation modals for destructive " +
    "actions, 'member' terminology, danger-zone settings convention.",
  scenarios: [
    ...LINEAGES.flatMap((authored) => [
      authored.scenario,
      ...deriveVariants(authored.scenario, STANDARD_VARIANT_KINDS),
    ]),
    // Novelty surfaces get a narrower variant set. Wording and layout perturbation
    // is the part that matters for abstention; the adversarial and secret-shaped
    // variants are exercised thoroughly on the labelled lineages, and repeating
    // them here would add records without adding a distinct measurement.
    ...NOVELTY_LINEAGES.flatMap((canonical) => [
      canonical,
      ...deriveVariants(canonical, ["wording", "layout", "nearby-distractor"]),
    ]),
  ],
};

/**
 * Application family B — "Lathe", an internal developer platform.
 *
 * THE PRODUCT
 *
 * Lathe is the control plane an engineering org runs its own software on: a service
 * catalogue, the repos behind those services, an artifact registry, deploy
 * environments, on-call rotations, API keys and their scopes, a seat-based plan, an
 * extension directory, and a review queue where people ask for things and other
 * people approve them. Nothing in it is a drive, a shelf, or a folder tree you
 * browse for fun — every object exists because something runs in production.
 *
 * UI CONVENTIONS, AND WHY THEY ARE THE POINT
 *
 * Four conventions are held consistently across all twenty-six surfaces here, and
 * each one was chosen because it changes the *shape* of the evidence rather than
 * its skin:
 *
 *   1. Navigation is breadcrumb-and-tab, not sidebar-and-folder. A heading reads
 *      "artifacts › retention", so context arrives as a path through an ownership
 *      hierarchy (service → environment → artifact) instead of a containment
 *      hierarchy. Headings carry less object identity and more location-in-a-system.
 *
 *   2. Confirmation happens inline, on a chip or a switch next to the thing, and
 *      only genuinely irreversible operations get a modal. So destructive meaning
 *      frequently arrives on `surfaceKind: "inline"` or a `switch` role — the
 *      opposite of the convention where "serious" implies "modal with a red button".
 *      A family that only learned "modal + destructiveStyle ⇒ delete" gets nothing
 *      transferable from this one.
 *
 *   3. Control text is terse, lowercase-leaning, and verb-first in the register
 *      engineers actually speak: purge, reparent, flip, attach, enqueue, roll out,
 *      hand off. The ordinary product verbs — share, move, install, submit — are
 *      largely absent from the visible text, which is exactly the condition under
 *      which token overlap stops being a shortcut.
 *
 *   4. People are "principals" or "identities" and objects are slugs, not titles.
 *      Every such name is marked name-like and is therefore redacted before
 *      projection, so this family contributes almost no proper nouns to the
 *      vocabulary.
 *
 * WHY THIS IS INDEPENDENT EVIDENCE
 *
 * Independence here is not a palette swap. The domain framing (operating software
 * versus storing documents), the vocabulary register (ops jargon versus consumer
 * English), the information architecture (ownership path versus containment path),
 * and the confirmation idiom (inline chip versus modal) vary together. What
 * survives the move from another family to this one is only the structural
 * relationship between the state signal, the control's affordance, and the object
 * evidence — which is the thing the benchmark claims to measure. Had the family
 * been a reskin, an out-of-application score would have measured nothing but
 * whether the paraphrase table was wide enough.
 */

import {
  control,
  establishes,
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

const FAMILY_ID = "family-b-lathe-devplatform";

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
      scenarioId: `b-${lineageId}`,
      applicationFamilyId: FAMILY_ID,
      templateLineageId: `b-${lineageId}`,
      intent,
      surface,
    }),
  };
}

const LINEAGES: readonly AuthoredLineage[] = [
  // ---- class 1: delete / file / existence ---------------------------------
  // Reached twice from opposite ends of the build system: the registry that keeps
  // artifacts, and the run console that produced one.
  lineage(
    "c01-artifact-purge",
    establishes(transition("delete", "file", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [
        semanticText("artifacts › retention"),
        nameLikeText("checkout-api"),
        semanticText("build output · 214 mb · kept for 90 days"),
      ],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file", "resource"],
      candidates: [
        control({
          ownText: semanticText("fetch"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("purge from the registry"),
          accessibleName: semanticText("purge this build output from the artifact registry"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("nothing can pull it once the sweep has run"),
            nameLikeText("build-2419"),
          ],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("pin against retention"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c01-run-output-drop",
    establishes(transition("delete", "file", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("pipeline run › outputs")],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("copy checksum"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("re-upload from the agent"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("drop it from the run output"),
          accessibleName: semanticText("drop the coverage report this run produced"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "activate",
          destructiveStyle: true,
          nearbyLabels: [semanticText("the run keeps its logs, the report goes")],
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("open in the viewer"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 7,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 2: delete / document / existence -----------------------------
  // One is a typed-name modal, which Lathe reserves for the truly irreversible;
  // the other is the bulk governance console, where the same meaning arrives as a
  // posted form action on a selected table row.
  lineage(
    "c02-runbook-retire",
    establishes(transition("delete", "document", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [
        semanticText("retire this runbook"),
        nameLikeText("db failover runbook"),
        semanticText("owned by the storage guild"),
      ],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("keep it"),
          interactionKind: "dismiss",
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("erase it for good"),
          accessibleName: semanticText("erase the runbook and every revision of it"),
          controlKind: "input-button",
          interactionKind: "confirm",
          formMethod: "post",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("four incident timelines link here and will dangle"),
            userEnteredText("db failover runbook"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c02-decision-record-shred",
    establishes(transition("delete", "document", "existence", "present", "absent")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [
        semanticText("governance console › decision records"),
        semanticText("one row selected"),
      ],
      stateSignals: [state("existence", "present")],
      objectKindEvidence: ["document", "resource"],
      candidates: [
        control({
          ownText: semanticText("shred the selected record"),
          controlKind: "input-button",
          controlRole: "button",
          interactionKind: "submit",
          formMethod: "post",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("the record and its revisions go together"),
            nameLikeText("adr-0042 ingest rewrite"),
          ],
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("export the selection"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("clear the selection"),
          interactionKind: "dismiss",
          ancestorDepth: 2,
        }),
      ],
      targetIndex: 0,
    }),
  ),

  // ---- class 3: share / file / access -------------------------------------
  // Partner distribution of a signed bundle, versus letting an incident bridge read
  // an evidence capture. Same meaning, different half of the product.
  lineage(
    "c03-bundle-outside-pull",
    establishes(transition("share", "file", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "non-modal-dialog",
      headings: [
        semanticText("distribution"),
        nameLikeText("otel-collector-bundle"),
        semanticText("signed six hours ago · nobody outside can pull it"),
      ],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("let the vendor pull this bundle"),
          accessibleName: semanticText("allow the partner org to pull the signed bundle"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          formMethod: "other",
          nearbyLabels: [
            semanticText("pull stays scoped to the partner org"),
            semanticText("turn it back off from this tab at any time"),
          ],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("rotate the signing key"),
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("close"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 0,
    }),
  ),
  lineage(
    "c03-evidence-bridge-read",
    establishes(transition("share", "file", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [
        semanticText("incident evidence"),
        semanticText("only you can open this capture so far"),
      ],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["file", "resource"],
      candidates: [
        control({
          ownText: semanticText("attach another capture"),
          controlKind: "input-button",
          interactionKind: "activate",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("mark the capture triaged"),
          controlKind: "other",
          controlRole: "checkbox",
          interactionKind: "toggle",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("let the bridge read it"),
          accessibleName: semanticText("give every responder on the bridge read on this capture"),
          interactionKind: "confirm",
          nearbyLabels: [
            nameLikeText("api-gw-5xx-capture"),
            semanticText("twenty-seven responders are on the bridge"),
          ],
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 4: share / document / access ---------------------------------
  lineage(
    "c04-postmortem-circulate",
    establishes(transition("share", "document", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("postmortem › review"),
        nameLikeText("payments outage, february"),
        semanticText("three principals can open it"),
      ],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["document"],
      candidates: [
        control({
          ownText: semanticText("add a reviewer"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("open reading to the whole org"),
          accessibleName: semanticText("let every principal in the org read the postmortem"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("anyone with a lathe identity will be able to read it"),
            semanticText("comments stay with the review circle"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("keep it with the review circle"),
          interactionKind: "dismiss",
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c04-spec-guest-read",
    establishes(transition("share", "document", "access", "private", "shared")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("spec actions")],
      stateSignals: [state("access", "private")],
      objectKindEvidence: ["document", "account"],
      candidates: [
        control({
          ownText: semanticText("duplicate into my drafts"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 8,
        }),
        control({
          ownText: semanticText("watch for revisions"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "toggle",
          ancestorDepth: 8,
        }),
        control({
          ownText: semanticText("pin to the guild sidebar"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 8,
        }),
        control({
          ownText: semanticText("mint a read link for an outside reviewer"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          nearbyLabels: [nameLikeText("edge auth rfc"), semanticText("the link lapses in 14 days")],
          ancestorDepth: 8,
        }),
      ],
      targetIndex: 3,
    }),
  ),

  // ---- class 5: rename / file / name --------------------------------------
  // The registry does it inline with the text field in the candidate list; the
  // service config tab does it in a modal that writes back through the repo.
  lineage(
    "c05-artifact-relabel",
    establishes(transition("rename", "file", "name", "current", "replaced")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("registry › label this artifact again")],
      stateSignals: [state("name", "current")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: userEnteredText("otel-collector-1.9.2-rc3.tgz"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "other",
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("commit the new label"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [semanticText("pulls against the old label keep working for 30 days")],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("leave it alone"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c05-manifest-retitle",
    establishes(transition("rename", "file", "name", "current", "replaced")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [
        semanticText("call this manifest something else"),
        nameLikeText("checkout-api"),
        semanticText("config tab · prod overlay"),
      ],
      stateSignals: [state("name", "current")],
      objectKindEvidence: ["file", "resource"],
      candidates: [
        control({
          ownText: semanticText("discard the edit"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("preview the diff"),
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("write it back to the repo"),
          accessibleName: semanticText("write the manifest back under what you typed"),
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            semanticText("the deploy pipeline picks it up on the next sync"),
            userEnteredText("ingress-prod.yaml"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 6: move / file / container -----------------------------------
  // Promotion between registries, and a retention tier change. Neither says "move".
  lineage(
    "c06-artifact-promote",
    establishes(transition("move", "file", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [
        semanticText("promote this build"),
        nameLikeText("checkout-api 1.42.0"),
        semanticText("staging registry → release channel"),
      ],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["file"],
      candidates: [
        control({
          ownText: semanticText("promote to the release channel"),
          accessibleName: semanticText("put the build in the release channel instead"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("staging stops serving it once it lands"),
            semanticText("checksums are carried over untouched"),
          ],
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("not now"),
          interactionKind: "dismiss",
          ancestorDepth: 2,
        }),
      ],
      targetIndex: 0,
    }),
  ),
  lineage(
    "c06-logblob-tier",
    establishes(transition("move", "file", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("retention › tiers"), semanticText("3.1 gb picked")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["file", "resource"],
      candidates: [
        control({
          ownText: semanticText("keep it hot"),
          controlKind: "other",
          controlRole: "radio",
          interactionKind: "select",
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("hand this blob off to the cold tier"),
          nearbyLabels: [
            nameLikeText("gw-access-january"),
            semanticText("reads take up to a minute afterwards"),
          ],
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("schedule it for the weekend"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 7,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 7: move / folder / container ---------------------------------
  lineage(
    "c07-dir-reparent",
    establishes(transition("move", "folder", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("tree › reparent")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["folder"],
      candidates: [
        control({
          ownText: semanticText("pick the new parent"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "select",
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("preview the resulting tree"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("reparent the directory"),
          accessibleName: semanticText("hang the directory off the package root you picked"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            nameLikeText("telemetry"),
            semanticText("import paths are rewritten in one commit"),
          ],
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 2,
    }),
  ),
  lineage(
    "c07-configgroup-handoff",
    establishes(transition("move", "folder", "container", "source", "destination")),
    surfaceSnapshot({
      surfaceKind: "menu",
      headings: [semanticText("config group actions")],
      stateSignals: [state("container", "source")],
      objectKindEvidence: ["folder", "resource"],
      candidates: [
        control({
          ownText: semanticText("duplicate the group"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("lock the group"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "toggle",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("hand the group to the platform workspace"),
          controlKind: "link",
          controlRole: "menuitem",
          interactionKind: "select",
          nearbyLabels: [
            nameLikeText("edge-configs"),
            semanticText("every key inside travels with it"),
          ],
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("pin to the sidebar"),
          controlKind: "menuitem",
          controlRole: "menuitem",
          interactionKind: "select",
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 8: change-access / repository / visibility -------------------
  // A settings page with a weighty button, and a checklist step where the whole
  // thing is a switch. The inline one is the harder sample on purpose.
  lineage(
    "c08-repo-open",
    establishes(transition("change-access", "repository", "visibility", "private", "public")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("repo settings › exposure"),
        nameLikeText("lathe-edge-proxy"),
        semanticText("twelve principals can read it today"),
      ],
      stateSignals: [state("visibility", "private")],
      objectKindEvidence: ["repository"],
      candidates: [
        control({
          ownText: semanticText("transfer ownership"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("open the repo to everyone"),
          accessibleName: semanticText("let anyone outside the org read this repo"),
          interactionKind: "confirm",
          destructiveStyle: true,
          nearbyLabels: [
            semanticText("history, issues and tags all become readable outside"),
            semanticText("secret scanning stays on either way"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("archive the repo"),
          destructiveStyle: true,
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c08-oss-flip",
    establishes(transition("change-access", "repository", "visibility", "private", "public")),
    surfaceSnapshot({
      surfaceKind: "inline",
      headings: [semanticText("release checklist · step four of five")],
      stateSignals: [state("visibility", "private")],
      objectKindEvidence: ["repository", "process"],
      candidates: [
        control({
          ownText: semanticText("legal review is done"),
          controlKind: "other",
          controlRole: "checkbox",
          interactionKind: "toggle",
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("flip it to world-readable"),
          accessibleName: semanticText("make the repo readable by anyone on the internet"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          nearbyLabels: [
            nameLikeText("otel-exporter-lathe"),
            semanticText("this is the step people cannot take back"),
          ],
          ancestorDepth: 5,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 9: grant / permission / grant-state --------------------------
  // The key's own scopes tab, and the central review queue. The queue sample posts
  // a form, which is the case where submission is the mechanism and not the action.
  lineage(
    "c09-scope-attach",
    establishes(transition("grant", "permission", "grant-state", "absent", "granted")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("api key › scopes"), semanticText("this key can only read today")],
      stateSignals: [state("grant-state", "absent")],
      objectKindEvidence: ["permission", "account"],
      candidates: [
        control({
          ownText: semanticText("rotate the key"),
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("attach the deploy scope"),
          accessibleName: semanticText("add deploy rights to this key"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("effective at the next token exchange"),
            nameLikeText("ci-runner key"),
          ],
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("revoke the key"),
          destructiveStyle: true,
          ancestorDepth: 4,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c09-review-queue-approve",
    establishes(transition("grant", "permission", "grant-state", "absent", "granted")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("access review › queue"),
        semanticText("request nineteen of forty-four"),
      ],
      stateSignals: [state("grant-state", "absent")],
      objectKindEvidence: ["permission", "process"],
      candidates: [
        control({
          ownText: semanticText("turn the request down"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          destructiveStyle: true,
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("ask for context"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("let this identity deploy to prod"),
          accessibleName: semanticText("give the identity deploy rights in the prod environment"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            nameLikeText("Ingrid Falk"),
            semanticText("two principals have already looked at it"),
          ],
          ancestorDepth: 2,
        }),
      ],
      targetIndex: 2,
    }),
  ),

  // ---- class 10: subscribe / subscription / status ------------------------
  lineage(
    "c10-tier-activate",
    establishes(transition("subscribe", "subscription", "status", "inactive", "active")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("plan › seats"),
        semanticText("the scale tier is switched off for this org"),
      ],
      stateSignals: [state("status", "inactive")],
      objectKindEvidence: ["subscription", "account"],
      candidates: [
        control({
          ownText: semanticText("compare the tiers"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("activate forty seats on the scale tier"),
          accessibleName: semanticText("start the scale tier for forty principals"),
          interactionKind: "confirm",
          formMethod: "post",
          nearbyLabels: [
            semanticText("billed monthly from today"),
            semanticText("the finance owner is told"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c10-addon-switch",
    establishes(transition("subscribe", "subscription", "status", "inactive", "active")),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("add-ons"), semanticText("trace retention is off")],
      stateSignals: [state("status", "inactive")],
      objectKindEvidence: ["subscription"],
      candidates: [
        control({
          ownText: semanticText("turn on thirty-day trace retention"),
          accessibleName: semanticText("start paying for the trace retention add-on"),
          controlKind: "other",
          controlRole: "switch",
          interactionKind: "toggle",
          nearbyLabels: [
            semanticText("it joins the monthly invoice"),
            semanticText("no redeploy needed"),
          ],
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("see what it costs"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 6,
        }),
        control({
          ownText: semanticText("talk to the platform guild"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 6,
        }),
      ],
      targetIndex: 0,
    }),
  ),

  // ---- class 11: install / application / installation ---------------------
  lineage(
    "c11-integration-connect",
    establishes(transition("install", "application", "installation", "absent", "installed")),
    surfaceSnapshot({
      surfaceKind: "modal-dialog",
      headings: [
        semanticText("integration directory"),
        nameLikeText("pagertree"),
        semanticText("not connected to this workspace"),
      ],
      stateSignals: [state("installation", "absent")],
      objectKindEvidence: ["application"],
      candidates: [
        control({
          ownText: semanticText("read the setup notes"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("connect it to the workspace"),
          accessibleName: semanticText("put this integration into the workspace"),
          interactionKind: "confirm",
          nearbyLabels: [
            semanticText("it will be able to read service metadata"),
            semanticText("disconnect from the same tab whenever"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c11-plugin-rollout",
    establishes(transition("install", "application", "installation", "absent", "installed")),
    surfaceSnapshot({
      surfaceKind: "other",
      headings: [
        semanticText("extensions › environment rollout"),
        semanticText("prod · eu-west · fourteen nodes"),
      ],
      stateSignals: [state("installation", "absent")],
      objectKindEvidence: ["application", "resource"],
      candidates: [
        control({
          ownText: semanticText("dry run it first"),
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("roll the collector plugin out here"),
          accessibleName: semanticText("put the plugin on every node in this environment"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            nameLikeText("lathe-otel-plugin"),
            semanticText("nodes pick it up within ten minutes"),
          ],
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("choose a different environment"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "select",
          ancestorDepth: 5,
        }),
      ],
      targetIndex: 1,
    }),
  ),

  // ---- class 12: send / message / delivery --------------------------------
  // A status-page update and an on-call handover note. Both are composed and then
  // released; neither uses the word "send".
  lineage(
    "c12-incident-broadcast",
    establishes(transition("send", "message", "delivery", "draft", "sent")),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [semanticText("incident comms › update three"), semanticText("held as a draft")],
      stateSignals: [state("delivery", "draft")],
      objectKindEvidence: ["message"],
      candidates: [
        control({
          ownText: userEnteredText("mitigation is rolling out to eu-west now"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "other",
          ancestorDepth: 4,
        }),
        control({
          ownText: semanticText("dispatch it to subscribers"),
          accessibleName: semanticText("push the update out to everyone watching the status page"),
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            semanticText("twelve hundred people are watching the status page"),
            semanticText("there is no unsaying it"),
          ],
          ancestorDepth: 3,
        }),
        control({
          ownText: semanticText("keep editing"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 1,
    }),
  ),
  lineage(
    "c12-handoff-note",
    establishes(transition("send", "message", "delivery", "draft", "sent")),
    surfaceSnapshot({
      surfaceKind: "non-modal-dialog",
      headings: [
        semanticText("rotation handover"),
        nameLikeText("Tobias Reiter"),
        semanticText("your shift ends in eleven minutes"),
      ],
      stateSignals: [state("delivery", "draft")],
      objectKindEvidence: ["message", "account"],
      candidates: [
        control({
          ownText: semanticText("enqueue the note for the next principal"),
          accessibleName: semanticText("put the handover note in the incoming principal's inbox"),
          interactionKind: "confirm",
          nearbyLabels: [semanticText("it lands in their pager inbox at handover")],
          ancestorDepth: 7,
        }),
        control({
          ownText: semanticText("park it as a draft"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 7,
        }),
      ],
      targetIndex: 0,
    }),
  ),

  // ---- class 13: submit / form / submission -------------------------------
  // Two intake surfaces where the act of handing the answers in is the entire
  // point. Nothing is granted, moved, or published by either one — the review
  // board and the survey pipeline are downstream of the click, not part of it.
  lineage(
    "c13-onboarding-intake",
    establishesSubmission(),
    surfaceSnapshot({
      surfaceKind: "page",
      headings: [
        semanticText("new service intake"),
        semanticText("step five of five · every question answered"),
      ],
      stateSignals: [state("submission", "ready")],
      objectKindEvidence: ["form", "process"],
      candidates: [
        control({
          ownText: semanticText("back to the tier questions"),
          controlKind: "link",
          controlRole: "link",
          ancestorDepth: 5,
        }),
        control({
          ownText: userEnteredText("tier one, storage guild, two on-call rotations"),
          controlKind: "other",
          controlRole: "none",
          interactionKind: "other",
          ancestorDepth: 5,
        }),
        control({
          ownText: semanticText("hand the intake to the review board"),
          accessibleName: semanticText("give your answers to the architecture review board"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            semanticText("the board sits on tuesdays"),
            semanticText("a copy goes to your inbox"),
          ],
          ancestorDepth: 3,
        }),
      ],
      targetIndex: 2,
    }),
  ),
  lineage(
    "c13-dx-survey",
    establishesSubmission(),
    surfaceSnapshot({
      surfaceKind: "panel",
      headings: [semanticText("developer experience survey · first quarter")],
      stateSignals: [state("submission", "ready")],
      objectKindEvidence: ["form"],
      candidates: [
        control({
          ownText: semanticText("record my answers"),
          accessibleName: semanticText("hand in the twelve answers you gave"),
          controlKind: "input-button",
          interactionKind: "submit",
          formMethod: "post",
          nearbyLabels: [
            semanticText("answers are aggregated before anyone reads them"),
            semanticText("twelve of twelve answered"),
          ],
          ancestorDepth: 2,
        }),
        control({
          ownText: semanticText("skip this quarter"),
          controlKind: "link",
          controlRole: "link",
          interactionKind: "dismiss",
          ancestorDepth: 2,
        }),
      ],
      targetIndex: 0,
    }),
  ),
];

export const FAMILY_B: ApplicationFamily = {
  applicationFamilyId: FAMILY_ID,
  description:
    "Lathe, an internal developer platform: services and the repos behind them, an artifact registry, deploy environments, on-call rotations, API key scopes, seat-based billing, an extension directory, and an access review queue. Everything in it exists because something runs in production.",
  independenceBasis:
    "Lathe frames its domain as operating software rather than keeping documents, so its objects are artifacts, manifests, scopes, rotations and environments instead of files in folders; its information architecture is a breadcrumb-and-tab path through ownership (service → environment → artifact) rather than a containment tree; it confirms destructive and irreversible work on inline chips and switches next to the object, reserving modals for the genuinely unrecoverable, which decouples severity from surface kind; and its control text is terse, lowercase-leaning ops jargon — purge, reparent, flip, attach, enqueue, roll out — that largely avoids the plain product verbs, while people are principals and identities and every object is a redacted slug. The only thing transferable between this family and another is the structural relation between state signal, control affordance and object evidence, which is exactly what the out-of-application measurement is supposed to isolate.",
  scenarios: LINEAGES.flatMap((authored) => [
    authored.scenario,
    ...deriveVariants(authored.scenario, STANDARD_VARIANT_KINDS),
  ]),
};

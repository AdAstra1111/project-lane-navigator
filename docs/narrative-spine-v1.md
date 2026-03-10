# IFFY Narrative Spine — Canonical v1 Specification

**Authors:** Sebastian Street, ChatGPT, Lara Lane
**Status:** Canonical v1 — ratified March 2026
**Supersedes:** none (first edition)

---

## 1. What the Narrative Spine Is

The Narrative Spine is a project-level structural model representing the constitutional story physics of a project. It is not a beat sheet, writing template, or production document. It is a small set of locked structural axes that define how the story fundamentally behaves — the constraints within which all downstream generation, validation, and rewriting operate.

The Spine transforms IFFY from a write-then-validate system into a define-then-generate-within-structure system.

---

## 2. The Nine Axes — Final v1 Semantics

**axis 1 — story_engine**
The dominant narrative mechanism. Defines how the story moves forward: what drives it, how pressure accumulates, what kind of engine powers the escalation. This is the deepest structural descriptor of the project.
*Type: StoryEngine enum (existing)*
*Class: A — Constitutional*

**axis 2 — pressure_system**
The causal grammar of the conflict. Defines how pressure is applied to characters and story: revelation, accumulation, erosion, collision, attrition, etc.
*Type: CausalGrammar enum (existing)*
*Class: B — Bounded modulation*

**axis 3 — central_conflict**
The dominant constitutional conflict topology of the project. Defines the structural shape of the conflict at the project level: person vs system, self, institution, family, law, power hierarchy, etc. Season and episode conflict differences are treated as local expressions of this topology, not separate axis values, unless they begin to challenge the project topology itself. Note: a future v2 may split this into `conflict_topology` (Class A) and `conflict_expression` (Class B); see section 8.
*Type: ConflictMode enum (existing)*
*Class: B — Bounded modulation (toward stricter end)*

**axis 4 — inciting_incident**
The structural trigger category that initiates the project's central story. Defines what kind of disruption begins the narrative engine. Each level (project / season / episode) defines its own scope-local inciting category. Lower-level values must be coherent with the project value but are not copies of it.
*Type: inciting_incident_category (existing)*
*Class: S — Scope-specific structural realization*

**axis 5 — resolution_type**
The constitutional end-state promise of the overall project. Defines how the story resolves: justice, tragedy, redemption, acceptance, ambiguity, pyrrhic, etc. At project level this is constitutional. Season and episode resolutions may take different local shapes while honouring the project covenant.
*Type: ending_type enum (existing)*
*Class: B — Bounded modulation*

**axis 6 — stakes_class**
The emotional register of what is at risk. Defines what the protagonist is fundamentally fighting for or against: life, justice, identity, family, status, truth, love, survival, etc.
*Type: stakes_type enum (existing)*
*Class: B — Bounded modulation*

**axis 7 — protagonist_arc**
The internal transformation journey of the central protagonist across the full project. Defines where they start, what they need to learn or lose, and where they end: redemption, disillusionment, sacrifice, acceptance, corruption, awakening, etc.
*Type: string union (new — defined in _shared/narrativeSpine.ts)*
*Class: A — Constitutional*

**axis 8 — midpoint_reversal**
The structural pivot type that functions as the midpoint of the narrative at any given scope level. Each level (project / season / episode) defines its own midpoint realization. Values must be structurally coherent within their scope and compatible with the parent spine. Pattern-of-midpoints drift is monitored across levels, not individual value identity.
*Type: string union (new — defined in _shared/narrativeSpine.ts)*
*Class: S — Scope-specific structural realization*

**axis 9 — tonal_gravity**
The gravitational emotional register of the project. Defines the overall tone the story inhabits: dark, bittersweet, ambiguous, playful, ironic, hopeful, tragic, etc. This axis has the most legitimate local variation across levels.
*Type: string union (new — defined in _shared/narrativeSpine.ts)*
*Class: C — Expressive modulation*

---

## 3. The Four Inheritance Classes

**Class A — Constitutional**
Set at project level. Season and episode levels inherit without override. Changing a Class A axis at project level requires the full constitutional amendment flow regardless of project stage. There is no downstream-only scoping for Class A amendments.
*Axes: story_engine, protagonist_arc*

**Class B — Bounded modulation**
Season and episode levels may express variation within a coherent envelope. Variation must directionally serve the parent value — it must be recognisably derived, not contradictory. Cumulative drift across a rolling window of validated documents is monitored.
*Axes: pressure_system, central_conflict, resolution_type, stakes_class*

**Class S — Scope-specific structural realization**
Each scope level (project / season / episode) defines its own value independently. Values at lower levels must be coherent with the parent spine but are not copies. The validation check is structural coherence and pattern compatibility, not value identity. The system must not flag a lower-level value as drift simply because it differs from the project value — it checks whether the pattern of values across levels collectively serves the project spine.
*Axes: inciting_incident, midpoint_reversal*

**Class C — Expressive modulation**
Varies freely at any scope level. Monitored for cumulative drift across a rolling window. A single episode departing from the project value is valid modulation. A rolling 3-episode trend away from the project value triggers a soft drift advisory. A sustained 5-episode departure triggers a high_impact note.
*Axes: tonal_gravity*

---

## 4. Lifecycle Derivation Logic

Spine lifecycle state is derived from two canonical sources. No `spine_state` column exists on the projects table; state is always computed, never stored.

**Terminology note:** user-facing lifecycle state uses the term `confirmed`; the corresponding `decision_ledger` entry carries `status='pending_lock'`. These refer to the same transition, named for their respective layers.

```
getSpineState(projectId):

  projects.narrative_spine_json = null
    → state: none

  projects.narrative_spine_json exists
  + no decision_ledger entry (decision_key='narrative_spine')
    → state: provisional
      (AI-inferred at DevSeed, not yet user-reviewed)

  decision_ledger entry exists, locked=false, status='pending_lock'
    → state: confirmed
      (user-reviewed and accepted; ledger status='pending_lock' awaiting Concept Brief lock trigger)

  decision_ledger entry exists, locked=true, status='active'
  + no superseded entries
    → state: locked

  decision_ledger entry exists, locked=true, status='active'
  + ≥1 entry with status='superseded'
    → state: locked_amended
      (constitutional history present; full amendment audit trail available)
```

**Transition triggers:**

| Transition | Trigger | System action |
|---|---|---|
| none → provisional | promote-to-devseed executes | Write narrative_spine_json; guard: only if currently null |
| provisional → confirmed | User clicks "Confirm Narrative Spine" in UI | Create decision_ledger entry: locked=false, status='pending_lock' |
| confirmed → locked | Concept Brief reaches approval_status='approved' | Update decision_ledger entry: locked=true, status='active' |
| locked → locked_amended | Constitutional amendment approved | Old entry: status='superseded'; new entry created: locked=true, status='active' |

---

## 5. Amendment Model

A locked spine axis cannot be edited in place. Change requires the constitutional amendment flow.

**Amendment flow:**
1. User proposes amendment: select axis → new value → written justification
2. System computes constitutional severity (from axis matrix) and revalidation scope (from floor × approved documents)
3. User reviews both outputs separately, confirms or cancels
4. On confirm: old decision_ledger entry → `status='superseded'`, `meta.superseded_by=<new_id>`, `meta.superseded_at=<timestamp>`, `meta.supersession_reason=<justification>`; new entry created: `locked=true`, `status='active'`, `meta.amends=<old_id>`, `meta.amendment_severity=<level>`
5. `projects.narrative_spine_json` updated with new axis value
6. Revalidation tasks queued for all affected approved documents

**Constitutional severity matrix:**

| Axis | Constitutional severity |
|---|---|
| story_engine | constitutional |
| protagonist_arc | constitutional |
| pressure_system | severe |
| central_conflict | severe-moderate |
| resolution_type | moderate |
| inciting_incident | moderate |
| stakes_class | moderate |
| midpoint_reversal | moderate |
| tonal_gravity | light |

**Revalidation scope** is computed separately at amendment time:

```
revalidation_tasks = approved_documents
  .filter(doc => doc.stage_index >= AXIS_REVALIDATION_FLOOR[axis])
```

Revalidation floors by axis:

| Axis | Floor stage |
|---|---|
| story_engine | Concept Brief (all downstream) |
| protagonist_arc | Concept Brief (all downstream) |
| pressure_system | Concept Brief |
| central_conflict | Character Bible |
| resolution_type | Season Arc |
| inciting_incident | Concept Brief |
| stakes_class | Concept Brief |
| midpoint_reversal | Season Arc |
| tonal_gravity | Next unapproved stage only (if upstream docs compatible; see note below) |

**tonal_gravity revalidation note:** "Next unapproved stage only" applies when at least one unapproved stage exists downstream. If all stages are already approved and no unapproved stage remains, the system escalates to a compatibility review against all approved downstream materials before the amendment can be confirmed. This prevents silent tonal drift into a fully-approved document set.

Constitutional severity and revalidation scope are always shown to the user as two separate values before amendment confirmation. A `tonal_gravity` change late in production may show: severity=light, revalidation scope=6 documents. A `pressure_system` change early may show: severity=severe, revalidation scope=1 document. The user decides with full information.

**Downstream-only amendment rule:** Permitted only when (a) constitutional severity is `light` AND (b) all currently approved upstream documents pass an automated semantic compatibility check against the new axis value AND (c) the user explicitly accepts downstream-only scoping. If the upstream compatibility check fails, the system escalates to full revalidation regardless of severity classification.

---

## 6. Enforcement Rollout Plan

**Phase 1 — Prompt guidance — STATUS: COMPLETE**
Spine injected as constitutional instructions via `spineToPromptBlock()` in `mergedDirections`. No validation. No blocking. Spine influences generation implicitly.

**Phase 2 — Advisory findings — STATUS: COMPLETE**
`dev-engine-v2` reviewer prompt explicitly checks alignment of each document against the locked spine: inciting alignment, midpoint type, resolution shape. Misalignments generate `high_impact` notes tagged with `note_source: 'spine_alignment'` in the note's `meta` field. This provenance tag allows telemetry to distinguish spine alignment findings from ordinary CI/GP findings throughout all reporting and dashboards. Notes enter the existing convergence loop. No new blocking paths.
*Prerequisite: spine confirmation UI live and spine acceptance telemetry flowing.*

**Phase 3 — Class A Spine Check — STATUS: OPERATIONAL (commit 3ce2008b)**
Dedicated `Class A Spine Check` pass runs inside the `notes` action in `dev-engine-v2`, after the general LLM reviewer. It is a narrow, deterministic comparison — not a general review — that checks the two Class A axes (`story_engine`, `protagonist_arc`) against the locked spine. Contradictions generate blocker-severity `spine_drift` notes with `note_key = class_a_spine_{axis}`. DB-level deduplication prevents duplicate unresolved notes. The check is advisory only in v1: it appends notes to the normal note flow and does not block promotion. Fail-closed: any error in the Class A pass is logged and suppressed — it never corrupts the main analyze result. `class_a_spine_*` notes are excluded from the general auto-resolution loop because they are managed by this dedicated pass, not by LLM output presence/absence.
*Runtime validated: contradiction detection, dedupe, aligned-case passthrough, guard (unlocked spine skips check).*
*Implementation: `_shared/narrativeSpine.ts` (prompts, parser, types), `dev-engine-v2/index.ts` (invocation, note insertion, auto-resolution exclusion).*

**Phase 4 Stage 1 — Amendment Consequence Engine (stale note closure) — STATUS: OPERATIONAL**
When `confirm_amendment` succeeds in `spine-amendment/index.ts`, stale `class_a_spine_{amended_axis}` notes are auto-resolved for the amended axis only. This closes the governance loop: amending the constitutional spec invalidates violations raised against the superseded spec. Only the exact amended axis is resolved; other axes and unrelated notes are untouched. The response payload includes `stale_notes_resolved` count and `stale_note_key`. This is advisory closure only — no auto-reanalysis or broader change-impact logic is triggered.
*Implementation: `spine-amendment/index.ts` step 4a, after ledger entry creation.*

**Phase 4 Stage 2 — Amendment Consequence Engine (revalidation flagging) — STATUS: OPERATIONAL**
When `confirm_amendment` succeeds, all affected downstream documents (computed via the existing revalidation-floor logic) are flagged with `needs_reconcile = true` and `reconcile_reasons` containing the spine amendment metadata (axis, previous/new value, severity, amendment entry ID). This reuses the existing `project_documents` reconciliation mechanism rather than adding a new column. No auto-reanalysis is triggered — the flag persists until a future reanalysis explicitly clears it. The response payload includes `docs_flagged_for_revalidation` count and `affected_doc_ids_flagged`.
*Implementation: `spine-amendment/index.ts` step 4c, after revalidation scope computation.*

**Phase 4 Stage 3+ — Deferred**
- Auto-reanalysis after amendment (trigger dev-engine-v2 rerun)
- Broader change-impact logic (Class B validators, revalidation queue)
- Hard gates: projects with `meta_json.spine_hard_gates=true` get hard validation; `constitutional_drift` on a Class A axis blocks promotion. Explicit opt-in only.
*Prerequisite: spine acceptance rate ≥95% AND explicit user opt-in per project.*

---

## 7. V1 Scope — Included vs Deferred

**Included in v1:**
- Nine-axis spine extracted at DevSeed promotion via `promote-to-devseed/index.ts`
- Spine stored in `projects.narrative_spine_json` (provisional)
- `getSpineState()` derived-state helper (no spine_state schema column)
- Spine confirmation UI (all 9 axes, per-axis editing, explicit confirm)
- `decision_ledger` entry created at user confirmation (locked=false, status='pending_lock')
- Concept Brief approval as lock trigger (locked=true, status='active')
- Full amendment flow for locked spines
- Constitutional severity matrix (9 axes)
- Revalidation scope computation (floor × approved documents)
- Both outputs surfaced to user during amendment review
- Supersession history in decision_ledger (never deleted, fully auditable)
- Advisory spine alignment check in dev-engine-v2 reviewer, Phase 2 with provenance tagging
- `_shared/narrativeSpine.ts` as canonical type source; enum duplication debt documented

**Deferred to v2:**
- Stacked spines (season_spine_json, episode_spine_json tables and lifecycle)
- Class S deep validation logic (scope coherence and pattern-of-values drift)
- Cumulative drift rolling window (requires instrumented document validation history)
- Phase 4 hard gates (gated on acceptance rate threshold + explicit opt-in)
- `conflict_topology` / `conflict_expression` axis split (revisit after telemetry)
- Spine coherence compatibility matrix (valid/risky/disallowed axis pairings)
- Character orbit mapping derived from spine
- Narrative Intelligence Dashboard
- Change Impact Engine

---

## 8. Questions Consciously Postponed to v2

**Q1 — central_conflict axis split**
Should `central_conflict` be split into `conflict_topology` (Class A constitutional) and `conflict_expression` (Class B modulated)? Answer: probably yes in theory, not in v1. Revisit after telemetry from confirmed spines shows whether the single axis is causing classification confusion in practice.

**Q2 — Spine coherence validator**
Which axis pairings are incompatible, high-complexity, or risky? A compatibility matrix is the right long-term answer but requires empirical data from real confirmed spines before the rules can be written with confidence.

**Q3 — Class S pattern drift threshold**
What is the right rolling window and threshold for detecting when a pattern of scope-local values (inciting_incident, midpoint_reversal) constitutes drift rather than valid structural expression? Cannot be designed without real stacked spine data.

**Q4 — Spine amendment at episode level**
When stacked spines exist, can a Class A project-level axis ever be locally overridden at episode level for creative purposes? If so, what governance applies? Deferred until stacked spines are built.

**Q5 — Extraction confidence measurement**
The Phase 2→3→4 transition depends on user acceptance rate telemetry from the confirmation UI. The precise methodology for measuring extraction confidence (per-axis acceptance, weighted composite, confidence bands) is not yet specified. Design when data is flowing.

# IFFY — ROLLING ARCHITECTURE MEMORY BLOCK (RAMB)
Version: 2026-03-10
Maintained by: Sebastian Street + ChatGPT + Lara Lane

This document records the current architectural state of the IFFY system.
It is updated after each major architecture discussion.

---

## SYSTEM OVERVIEW

IFFY (Intelligent Film Flow & Yield) is an AI-native cinematic development OS.

**Purpose:** Guide narrative IP from idea → investor-ready pitch deck using a deterministic development pipeline.

Documents evolve through automated generation, scoring, iteration, and promotion.

**Core metrics:**
- CI — Creative Integrity
- GP — Green Package / commercial viability

**Weighting:** CI = 2×, GP = 1×

**Global rules:** GLOBAL_MIN_CI = 85, CI_TARGET = 90

Documents iterate until convergence before promotion.

---

## CURRENT FEATURE FILM DEVELOPMENT LADDER

```
idea → concept_brief → market_sheet → treatment → story_outline
→ character_bible → beat_sheet → feature_script → production_draft → deck
```

---

## MAJOR ARCHITECTURE — NARRATIVE SPINE v1

### STATUS: BUILT ✅

IFFY includes a Narrative Spine. The spine defines the constitutional structural physics of the story.

**Purpose:** Move IFFY from a write → validate system to a define structure → generate within structure system.

The spine is NOT a beat sheet. It defines the narrative rules of the project.

---

## NARRATIVE SPINE — STRUCTURAL AXES

Each project has a 9-axis spine stored in `projects.narrative_spine_json`.

| Axis | Class | Description |
|------|-------|-------------|
| `story_engine` | A — Constitutional | Core narrative engine |
| `protagonist_arc` | A — Constitutional | Protagonist's transformation arc |
| `pressure_system` | B — Bounded modulation | How pressure is applied |
| `central_conflict` | B — Bounded modulation | The central dramatic conflict |
| `resolution_type` | B — Bounded modulation | How the story resolves |
| `stakes_class` | B — Bounded modulation | Scale of what's at stake |
| `inciting_incident` | S — Scope-specific | Per-scope structural realization |
| `midpoint_reversal` | S — Scope-specific | Per-scope structural realization |
| `tonal_gravity` | C — Expressive modulation | Tone (freely varying, drift monitored) |

---

## SPINE LIFECYCLE MODEL

State is derived — no `spine_state` column exists.

Derived from: `projects.narrative_spine_json` + `decision_ledger` entries where `decision_key = "narrative_spine"`

| State | Trigger |
|-------|---------|
| `none` | No spine data |
| `provisional` | DevSeed promotion |
| `confirmed` | User confirmation in Spine Review UI |
| `locked` | Concept Brief receives approval |
| `locked_amended` | Constitutional amendment applied |

All amendments create new `decision_ledger` entries. Previous entries become "superseded". Spine history is never deleted.

---

## AXIS INHERITANCE CLASSES

**Class A — Constitutional** (strict inheritance)
- `story_engine`, `protagonist_arc`

**Class B — Bounded modulation** (variation if recognizably derived)
- `pressure_system`, `central_conflict`, `resolution_type`, `stakes_class`

**Class S — Scope-specific structural realization** (independently defined per scope)
- `inciting_incident`, `midpoint_reversal`

**Class C — Expressive modulation** (freely varying, drift monitored)
- `tonal_gravity`

---

## AMENDMENT GOVERNANCE

Locked spines cannot be edited directly. All changes use the constitutional amendment flow.

**Process:**
1. User proposes axis change
2. System computes constitutional severity + revalidation scope
3. User reviews impact
4. Confirmation creates superseding ledger entry
5. Revalidation tasks scheduled

**Severity matrix:**

| Severity | Axes |
|----------|------|
| Constitutional | `story_engine`, `protagonist_arc` |
| Severe | `pressure_system` |
| Moderate | `central_conflict`, `resolution_type`, `inciting_incident`, `stakes_class`, `midpoint_reversal` |
| Light | `tonal_gravity` |

Revalidation scope computed dynamically using AXIS_REVALIDATION_FLOOR × approved documents.

---

## ENFORCEMENT PHASES

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Prompt guidance — spine injected into generation instructions | ✅ BUILT |
| 2 | Advisory findings — reviewer emits `spine_alignment` / `spine_drift` notes | 🔲 NEXT |
| 3 | Bounded validators — structured alignment validator | 🔲 PLANNED |
| 4 | Optional hard gates — opt-in strict enforcement | 🔲 DEFERRED |

---

## NEXT INTELLIGENCE LAYER

### 1. Structural Alignment Engine
Checks document alignment with Narrative Spine.

Outputs:
- Alignment status
- Axis-level checks
- `spine_alignment` / `spine_drift` findings

### 2. Drift & Change Impact Engine
Governance for structural drift and amendments.

Capabilities:
- Drift classification
- Rewrite cascade analysis
- Impact forecasting

Outputs:
- Constitutional severity
- Revalidation scope
- Affected documents

### 3. Story Pattern Intelligence Engine
Higher-order narrative analysis across projects.

Capabilities:
- Spine coherence scoring
- Pattern complexity analysis
- Blueprint routing intelligence
- Cross-project structural analytics

Requires accumulated project telemetry.

---

## ARCHITECTURE STACK (INTELLIGENCE LAYER MODEL)

```
Narrative Spine
  → Structural Alignment Engine
  → Drift & Change Impact Engine
  → Story Pattern Intelligence Engine
  → Dev Engine document generation
```

---

## CURRENT DEVELOPMENT PRIORITIES

**Active:**
1. Narrative Spine v1 stabilization
2. Spine confirmation UI ✅ (SpineConfirmationPanel built)
3. `decision_ledger` integration
4. Concept Brief lock trigger ✅ (built)
5. Amendment governance
6. Advisory spine alignment findings in `dev-engine-v2` (Phase 2)

**Deferred:**
- Stacked spines (season / episode level)
- Hard validation gates (Phase 4)
- Pattern analytics (requires telemetry accumulation)
- Spine compatibility matrices

---

## IMPLEMENTATION STATUS (as of 2026-03-10)

### Built ✅
- `projects.narrative_spine_json` column
- `_shared/narrativeSpine.ts` — axis definitions, inheritance classes, severity matrix
- Lock trigger (Concept Brief approval → spine locked)
- Phase 1 prompt injection (spine axes injected into generation context)
- `SpineConfirmationPanel` UI component
- `SeedAppliedBanner` UI component
- Format Rules seed doc in DevSeed
- `decision_ledger` table structure

### In Progress 🔄
- Advisory `spine_alignment` / `spine_drift` note types in `dev-engine-v2` (Phase 2)
- Amendment governance UI

### Not Started 🔲
- Structural Alignment Engine (dedicated function)
- Drift & Change Impact Engine
- Story Pattern Intelligence Engine
- Phase 3 bounded validators
- Phase 4 hard gates

---

*This document represents the current architectural state of IFFY. Future discussions should assume this model unless explicitly revised.*

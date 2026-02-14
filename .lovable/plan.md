

# IFFY Development Operating System Upgrade

## Overview
This is a structural upgrade transforming IFFY from a script-centric analysis tool into a unified, deliverable-aware Development Operating System supporting all formats (Feature Film, TV Series, Vertical Drama, Documentary) with behavior-driven intelligence and convergence control.

The upgrade is sequenced into 8 phases. Each phase is backward-compatible -- legacy projects default to `script` deliverable type and `market` behavior mode.

---

## Phase 1: Database Migrations

Add new columns to existing tables. No destructive changes.

**projects table:**
- `development_behavior TEXT DEFAULT 'market'` (with validation trigger for `efficiency`, `market`, `prestige`)
- `episode_target_duration_seconds INTEGER` (nullable, used only for vertical drama)

**project_document_versions table:**
- `deliverable_type TEXT` (nullable, stores deliverable classification)
- `stage TEXT` (nullable, tracks pipeline position)

**development_runs table** (the actual run table used by dev-engine-v2):
- `deliverable_type TEXT`
- `development_behavior TEXT`
- `format TEXT`
- `episode_target_duration_seconds INTEGER`
- `schema_version TEXT DEFAULT 'v2'`

**coverage_runs table:**
- Same five columns as above

**improvement_runs table:**
- Same five columns as above

**Backfill:** Set `deliverable_type = 'script'` on existing `project_document_versions` rows where null.

Note: We use TEXT columns (not an enum) for `deliverable_type` to match the existing codebase pattern and avoid migration complexity. Validation happens in application code.

---

## Phase 2: Types and Configuration

**New file: `src/lib/dev-os-config.ts`**

Single source of truth containing:

- `DevelopmentBehavior` type (`efficiency | market | prestige`)
- `DeliverableType` type (11 values: `idea`, `concept_brief`, `market_sheet`, `blueprint`, `architecture`, `character_bible`, `beat_sheet`, `script`, `production_draft`, `deck`, `documentary_outline`)
- `behaviorConfig` object with convergence multipliers, rewrite intensity, packaging depth, and beat density settings per behavior
- `verticalBeatMinimum(durationSeconds)` function returning required beat count based on episode length
- `DELIVERABLE_LABELS` and `DELIVERABLE_PIPELINE_ORDER` for UI rendering
- Format-aware guardrail constants (feature: 90-110 min, vertical: adaptive, etc.)

The existing `ProjectFormat` type in `src/lib/types.ts` is preserved as-is -- no breaking rename.

---

## Phase 3: Deliverable-Aware Review Engine

**New file: `src/lib/review-schema-registry.ts`**

A registry mapping each `DeliverableType` to:
- `rubricSections` -- what dimensions to evaluate
- `analysisPromptModifier` -- injected into the dev-engine-v2 system prompt
- `rewritePromptModifier` -- scopes rewrite behavior
- `convergenceRules` -- thresholds for declaring convergence
- `forbiddenCritique` -- what NOT to evaluate (e.g., no dialogue notes on blueprints, no invented scenes on documentaries)

**Edge function update: `supabase/functions/dev-engine-v2/index.ts`**

The `analyze`, `notes`, and `rewrite` actions will:
1. Accept `deliverableType` and `developmentBehavior` in the request payload
2. Look up the appropriate rubric from the registry (passed as prompt context)
3. Inject format-specific and behavior-specific modifiers into system prompts
4. Store the `deliverable_type`, `development_behavior`, `format`, and `schema_version` on the resulting `development_runs` row

Key rubric examples:
- **idea**: Concept spark, emotional promise, audience clarity
- **blueprint**: Act logic, escalation curve, midpoint shift (NO line edits)
- **script**: Full scene construction, dialogue, subtext, visual storytelling
- **deck / documentary_outline**: Strict factual integrity, no invented content

---

## Phase 4: Format-Aware Intelligence

**Update: `src/lib/review-schema-registry.ts`**

Format overlays applied on top of deliverable rubrics:

- **Feature Film**: 3-act spine required, midpoint reversal expected, 90-110 min soft guardrail
- **TV Series**: Pilot engine clarity, season escalation logic, character longevity
- **Vertical Drama**: Adaptive `episode_target_duration_seconds`, hook within 3-10 seconds, mandatory cliffhanger, beat minimum from `verticalBeatMinimum()`
- **Documentary**: No fictionalization, emotional truth allowed, discovery arc, structure shaping only

The edge function composes the final prompt as: `base rubric + deliverable modifier + format overlay + behavior modifier`.

---

## Phase 5: Convergence Engine Upgrade

**Update: `src/lib/dev-os-config.ts`**

Per-deliverable convergence thresholds, modified by behavior:

- `efficiency`: Lower thresholds (CI >= 65, GP >= 65), faster convergence
- `market`: Balanced (CI >= 75, GP >= 75)
- `prestige`: Higher (CI >= 85, GP >= 80), minimum 2 rewrite cycles required

**Update: `src/hooks/useDevEngineV2.ts`**

- `isConverged` logic updated to check behavior-specific thresholds
- New `convergenceStatus` computed property: `Not Started | In Progress | Converged`
- Convergence stored per deliverable in run output

**Update: `supabase/functions/dev-engine-v2/index.ts`**

- `analyze` action includes `convergence_met: boolean` and `convergence_blockers: string[]` in output JSON
- Behavior multiplier applied to allowed_gap calculation

---

## Phase 6: Packaging Intelligence Gate

**Update: `src/components/intelligence/PackagingIntelligencePanel.tsx`**

- Check convergence status before enabling packaging analysis
- Show locked state with message: "Script must converge before packaging analysis"
- When unlocked, scope packaging depth by behavior:
  - `efficiency`: Budget realism check only
  - `market`: Full casting, director, territory, streamer analysis
  - `prestige`: Festival strategy, awards pathway, cultural positioning

**Update: `supabase/functions/packaging-intelligence/index.ts`**

- Accept `development_behavior` parameter
- Adjust packaging prompt depth accordingly

---

## Phase 7: UI Upgrades

**Update: `src/pages/ProjectDevelopmentEngine.tsx`**

New controls in the top bar:
- **Deliverable Type selector** (required, defaults based on doc_type)
- **Behavior Mode selector** (project-level: Efficiency / Market / Prestige)
- **Episode Duration field** (visible only for vertical drama format)

New badges displayed:
- Behavior mode badge (color-coded)
- Format badge
- Active deliverable type

**New component: `src/components/DeliverablePipeline.tsx`**

Visual pipeline strip: Idea > Concept > Market > Blueprint > Architecture > Character > Beats > Script > Production

- Grey = Not Started (no version with this deliverable type)
- Yellow = In Progress (version exists, not converged)
- Green = Converged

Clicking a stage filters the document list to that deliverable type.

**Behavior switching:**
- Changing behavior mode shows a warning dialog
- Offers to re-evaluate current document with new behavior settings

**Update: `src/components/project/ProjectSummaryBar.tsx`**
- Add behavior mode badge next to packaging mode

---

## Phase 8: Non-Hallucination Safeguards

**Update: `src/lib/review-schema-registry.ts`**

For `deck` and `documentary_outline` deliverable types:
- Explicit `forbiddenCritique` rules injected into prompts
- "Do NOT invent characters, fabricate scenes, or generate scene headings"
- "Use [PLACEHOLDER] for missing information"
- Flag if AI output contains INT./EXT. sluglines for documentary outlines

**Update: `supabase/functions/dev-engine-v2/index.ts`**

- For documentary formats: append hallucination guard to all prompts
- For `rewrite` action on deck/documentary_outline: second-pass validation checks output for fabricated content markers

---

## Implementation Sequence

The work is ordered to maintain stability at every step:

1. **Phase 1** -- Database migrations (safe, additive columns only)
2. **Phase 2** -- TypeScript config file (no existing code changes)
3. **Phase 3** -- Review schema registry (new file) + edge function prompt injection
4. **Phase 4** -- Format overlays added to registry
5. **Phase 5** -- Convergence logic upgrade (hook + edge function)
6. **Phase 7** -- UI selectors and pipeline view
7. **Phase 6** -- Packaging gate (depends on convergence being visible)
8. **Phase 8** -- Hallucination safeguards (final hardening)

---

## Files Created
- `src/lib/dev-os-config.ts` -- Behavior config, deliverable types, vertical beat logic
- `src/lib/review-schema-registry.ts` -- Rubrics, prompts, convergence rules per deliverable
- `src/components/DeliverablePipeline.tsx` -- Visual pipeline component

## Files Modified
- `supabase/functions/dev-engine-v2/index.ts` -- Prompt injection, behavior/deliverable context, hallucination guards
- `supabase/functions/packaging-intelligence/index.ts` -- Behavior-scoped packaging depth
- `src/hooks/useDevEngineV2.ts` -- Pass deliverable/behavior params, updated convergence logic
- `src/pages/ProjectDevelopmentEngine.tsx` -- New selectors, badges, pipeline view
- `src/components/project/ProjectSummaryBar.tsx` -- Behavior badge
- `src/lib/types.ts` -- Add `development_behavior` and `episode_target_duration_seconds` to Project interface

## Backward Compatibility
- All new columns have defaults or are nullable
- Legacy projects auto-resolve to `deliverable_type = 'script'` and `development_behavior = 'market'`
- Existing RLS policies are untouched (new columns are on existing tables)
- No existing type unions are renamed or removed


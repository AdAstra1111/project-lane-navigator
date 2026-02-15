# IFFY Architecture Audit — Production Guardrail Framework Preparation

**Date**: 2026-02-15  
**Purpose**: Map all LLM-powered engines, prompt assembly patterns, data flow, and identify optimal injection points for a global Production Guardrail Framework.  
**Status**: ANALYSIS ONLY — no implementation.

---

## SECTION A — ENGINE INVENTORY

### A1. Core Development Engines (High-Frequency, Iterative)

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 1 | **dev-engine-v2** | `supabase/functions/dev-engine-v2/index.ts` (1866 lines) | Tiered: PRO/FAST/BALANCED per action | projectId, documentId, versionId, action (analyze/rewrite/convert/rewrite-plan/rewrite-chunk/rewrite-assemble) | `buildAnalyzeSystem()` / `buildRewriteSystem()` — inline prompt builders using `DELIVERABLE_RUBRICS`, `BEHAVIOR_MODIFIERS`, `FORMAT_EXPECTATIONS` dicts | `development_versions`, `development_runs`, `convergence_scores` | `/projects/:id/development` |
| 2 | **script-engine** | `supabase/functions/script-engine/index.ts` (1788 lines) | Tiered per action | projectId, scriptId, action (blueprint/architecture/draft/score/rewrite/improve/rollback/lock/fetch-draft/import-to-docs) | `getBlueprintPrompt()`, `getArchitecturePrompt()`, `getDraftPrompt()`, `getScoringPrompt()`, `getImprovementPrompt()` — all inline builders | `scripts`, `script_scenes`, `script_versions`, `improvement_runs` | `/projects/:id/development` (Script Pipeline) |
| 3 | **script-coverage** | `supabase/functions/script-coverage/index.ts` (1184 lines) | `google/gemini-2.5-pro` (COVERAGE_MODEL) | scriptText, format, genres, lane, documentaryMode, promptVersionId | Inline builder assembling: prompt version template + corpus calibration + masterwork canon + commercial proof + failure contrast blocks | `coverage_runs` | `/projects/:id` (Coverage Lab) |

### A2. Project Analysis & Intelligence Engines

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 4 | **analyze-project** | `supabase/functions/analyze-project/index.ts` (816 lines) | Via tool-calling schema | projectInput, documentPaths | Inline system prompt + `ANALYSIS_TOOLS` tool-calling schema with `classify_project` function | `projects.analysis_passes`, `projects.reasoning`, `projects.assigned_lane`, `projects.confidence_score` | `/projects/:id` |
| 5 | **convergence-engine** | `supabase/functions/convergence-engine/index.ts` (387 lines) | `google/gemini-2.5-pro` | projectTitle, format, genres, lane, budget, scoringGrid, riskFlags, coverageSummary, strategicPriority, developmentStage, analysisMode | `CONVERGENCE_SYSTEM` constant + `buildUserPrompt()` inline builder | `convergence_scores` | `/projects/:id` (Convergence Panel) |
| 6 | **greenlight-simulate** | `supabase/functions/greenlight-simulate/index.ts` (555 lines) | Tiered via ENGINE_REGISTRY: REASONING_PREMIUM / REASONING_STANDARD / FAST | format, all project data | **ROUTER** → `route(format)` → `getSpecialistPrompt(engineType)` + **CALIBRATOR** second pass | `projects.analysis_passes` | `/projects/:id` (Greenlight Simulator) |

### A3. Packaging, Finance & Market Intelligence

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 7 | **packaging-intelligence** | `supabase/functions/packaging-intelligence/index.ts` (266 lines) | `google/gemini-3-flash-preview` | projectTitle, format, genres, lane, budget, characters, developmentBehavior | Inline system prompt + `formatPackagingRules(format)` per-format rules + behavior directive | Returns JSON directly (not persisted) | `/projects/:id` (Packaging tab) |
| 8 | **finance-predict** | `supabase/functions/finance-predict/index.ts` (261 lines) | `google/gemini-3-flash-preview` | projectTitle, format, genres, lane, budget, packagingProfile, coverageSummary, castSummary | Inline system prompt + `formatFinanceRules(format)` per-format rules | Returns JSON directly | `/projects/:id` (Finance tab) |
| 9 | **smart-packaging** | `supabase/functions/smart-packaging/index.ts` (189 lines) | `google/gemini-3-flash-preview` | projectTitle, format, genres, budgetRange, tone, assignedLane, targetCharacter, mode (cast/crew) | Inline prompt builder + `FORMAT_LABELS` + format-specific packaging context | Returns JSON directly | `/projects/:id` (Packaging panel) |
| 10 | **suggest-cast** | `supabase/functions/suggest-cast/index.ts` (141 lines) | Lovable AI (model not specified in header visible) | projectTitle, format, genres, budgetRange, tone, assignedLane, targetCharacter | Inline prompt builder | Returns JSON directly | `/projects/:id` (Talent panel) |
| 11 | **comp-analysis** | `supabase/functions/comp-analysis/index.ts` (159 lines) | `google/gemini-3-flash-preview` + optional Perplexity grounding | title, format, genres, budget_range, tone, comparable_titles | Inline prompt with optional Perplexity grounded research injected | Returns JSON directly | `/projects/:id` (Comp Analysis) |

### A4. Research & External Intelligence

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 12 | **research-person** | `supabase/functions/research-person/index.ts` (277 lines) | `google/gemini-3-flash-preview` (disambig) + `google/gemini-2.5-flash` (assessment) | person_name, role, project_context, mode, disambiguation_hint | 2-step: disambig tool-call + Perplexity grounding + assessment tool-call | Returns JSON directly | Talent search |
| 13 | **research-incentives** | `supabase/functions/research-incentives/index.ts` (302 lines) | Lovable AI + optional Perplexity | jurisdiction, format, budget_range, genres | Inline prompt + Perplexity grounding | `project_incentives` (cached) | Incentive Finder |
| 14 | **research-buyers** | `supabase/functions/research-buyers/index.ts` (289 lines) | Lovable AI + optional Perplexity | format, genres, budget_range, tone, target_audience, territories | Inline prompt + Perplexity grounding + cache layer | Returns / caches JSON | Buyer CRM |
| 15 | **research-copro** | `supabase/functions/research-copro/index.ts` (194 lines) | Lovable AI | countries, format, budget_range, genres | Inline prompt | Returns JSON directly | Co-Pro Planner |
| 16 | **refresh-trends** | `supabase/functions/refresh-trends/index.ts` (460 lines) | Lovable AI + Perplexity | production_type filter | Perplexity grounded + AI structuring | `cast_trends`, `story_trends` | Trends pages |

### A5. Development Pipeline Engines

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 17 | **generate-pitch** | `supabase/functions/generate-pitch/index.ts` (208 lines) | `google/gemini-3-flash-preview` | productionType, genre, subgenre, budgetBand, region, platformTarget, audienceDemo, riskLevel, count, coverageContext, feedbackContext, briefNotes | Inline system prompt + tool-calling (`submit_pitches`) | Returns JSON (saved client-side to `pitch_ideas`) | Pitch Ideas |
| 18 | **expand-concept** | `supabase/functions/expand-concept/index.ts` (218 lines) | `google/gemini-3-flash-preview` | pitchIdea, productionType | `PRODUCTION_TYPE_PROMPTS[typeKey]` inline dict | `concept_expansions` | Pitch Ideas (Expand) |
| 19 | **stress-test-concept** | `supabase/functions/stress-test-concept/index.ts` (165 lines) | `google/gemini-2.5-pro` | pitchIdea, expansion, productionType | Inline system prompt + tool-calling (`stress_test_results`) | `concept_stress_tests` | Pitch Ideas (Stress Test) |
| 20 | **treatment-compare** | `supabase/functions/treatment-compare/index.ts` (177 lines) | Lovable AI | treatmentText, scriptText, projectContext | Inline system prompt | Returns JSON directly | Script Studio |

### A6. Production & Scheduling

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 21 | **schedule-intelligence** | `supabase/functions/schedule-intelligence/index.ts` (129 lines) | Lovable AI | scenes, shootDays, schedule, format, genres, budgetRange | Inline system prompt | Returns JSON directly | Schedule tab |
| 22 | **script-to-budget** | `supabase/functions/script-to-budget/index.ts` (135 lines) | Lovable AI | scriptText, format, genres, budgetRange, lane, totalBudget | Inline system prompt | Returns JSON directly | Script-to-Budget panel |

### A7. Corpus Intelligence (Non-generative)

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 23 | **analyze-corpus** | `supabase/functions/analyze-corpus/index.ts` (998 lines) | `google/gemini-2.5-flash` | action (analyze/calibrate/self_test/etc), scriptId | `callAIWithTools()` — inline prompts per action with tool-calling | `corpus_scripts`, `corpus_insights`, `corpus_scene_patterns`, `corpus_character_profiles` | Settings → Corpus |

### A8. Utility / Note Analysis

| # | Function | File | Model | Inputs | Prompt Assembly | Output Storage | UI Route |
|---|----------|------|-------|--------|-----------------|----------------|----------|
| 24 | **analyze-note** | `supabase/functions/analyze-note/index.ts` (165 lines) | `google/gemini-2.5-flash` | project_id, note | Inline system prompt with project context injected | `project_updates.impact_summary` | Project Notes |
| 25 | **project-chat** | `supabase/functions/project-chat/index.ts` (130 lines) | `google/gemini-2.5-flash` | projectId, question | Inline system prompt with full project dossier | SSE stream (not persisted) | Project Chat |

### Non-LLM Functions (for completeness)

- `extract-documents`, `extract-budget`, `extract-characters`, `extract-scenes` — document parsing, no AI
- `ingest-corpus`, `embed-corpus` — corpus ingestion/embedding pipeline
- `nightly-corpus-integrity`, `nightly-outcome-rollup` — cron jobs
- `recalibrate-weights`, `score-engines` — deterministic scoring
- `stripe-webhook`, `tmdb-lookup`, `parse-integration-import` — integrations
- `create-project-from-pitch-idea`, `promote-locked-idea`, `generate-pitch-deck`, `auto-schedule`, `audit-sources`, `project-incentive-insights` — utility functions (some may call AI internally)

---

## SECTION B — PROMPT ASSEMBLY CHOKE POINTS

### B1. Current Architecture: **Multiple Isolated Prompt Builders**

There is **NO shared prompt builder, middleware, or utility function** across edge functions. Each of the 25 LLM-calling functions assembles its own prompts independently.

**Shared Patterns** (duplicated, not centralized):
- `extractJSON()` — regex-based JSON extraction from LLM output. Duplicated in: `dev-engine-v2`, `convergence-engine`, `greenlight-simulate`
- `callAI()` — basic fetch wrapper. Duplicated with variations in: `dev-engine-v2`, `script-coverage`, `convergence-engine`. Each has different retry logic, timeout handling, and error recovery.
- `FORMAT_LABELS` dict — duplicated in `script-coverage`, `smart-packaging`, `expand-concept`
- Format-specific rules — duplicated as `formatPackagingRules()` in `packaging-intelligence`, `formatFinanceRules()` in `finance-predict`, `FORMAT_EXPECTATIONS` in `dev-engine-v2`, `FORMAT_TO_ENGINE` in `convergence-engine` and `greenlight-simulate`

### B2. Context Injection Points

| Context Type | Where Injected | Method |
|---|---|---|
| **Production Type** | `dev-engine-v2` (FORMAT_EXPECTATIONS), `greenlight-simulate` (specialist prompts), `packaging-intelligence` (formatPackagingRules), `finance-predict` (formatFinanceRules), `expand-concept` (PRODUCTION_TYPE_PROMPTS), `generate-pitch` (typeLabel) | Inline string interpolation per function |
| **Development Behavior** | `dev-engine-v2` (BEHAVIOR_MODIFIERS dict), `packaging-intelligence` (behaviorPackagingDirective) | Inline conditional strings |
| **Corpus Calibration** | `script-engine` (corpusBlock), `script-coverage` (corpusDeviationBlock + goldBaseline + masterworkBlock + commercialBlock + failureBlock) | Fetched from `corpus_insights` table, concatenated into prompt |
| **Lane/Format** | Every function independently reads `project.assigned_lane` and `project.format` | Direct field injection |
| **Deliverable Type** | `dev-engine-v2` only (DELIVERABLE_RUBRICS) | Dict lookup |

### B3. Best Single Injection Layer for Global Guardrails

**RECOMMENDED: A shared `buildGuardrailContext()` utility function** importable by all edge functions.

Why not a middleware edge function:
- Supabase edge functions don't support middleware chaining
- A proxy function would add latency and complexity
- Each function has different prompt assembly patterns

Why a shared utility:
- Can be imported as a Deno module from a shared path (e.g., `supabase/functions/_shared/guardrails.ts`)
- Each function calls `buildGuardrailContext(project)` which returns a string block to prepend/inject into any system prompt
- Production type rules from `production-type-rules.ts` can be ported to this shared module
- Zero architectural change to existing functions — additive only

---

## SECTION C — DATA FLOW MAP

```
Project Creation
    │
    ▼
analyze-project ──► projects.analysis_passes, assigned_lane, confidence_score
    │                        │
    ▼                        ▼
convergence-engine ──► convergence_scores (CI/GP/gap/trajectory)
    │
    ▼
dev-engine-v2 (analyze) ──► development_versions (notes, scores, convergence)
    │                              │
    │                              ├── blocking_issues (gate convergence)
    │                              ├── high_impact_notes
    │                              └── polish_notes
    │
    ▼
dev-engine-v2 (rewrite) ──► development_versions (new version, rewritten text)
    │
    ▼ (loop: analyze → select notes → rewrite → analyze)
    │
    ▼
script-engine (blueprint) ──► scripts.blueprint_json
    │
    ▼
script-engine (architecture) ──► script_scenes
    │
    ▼
script-engine (draft) ──► script_versions (batched, stored in Supabase Storage)
    │
    ▼
script-engine (score) ──► scripts (structural/dialogue/economy/budget/lane scores)
    │
    ▼
script-coverage ──► coverage_runs (full coverage report)
    │
    ▼
packaging-intelligence ──► UI only (not persisted)
finance-predict ──► UI only (not persisted)
greenlight-simulate ──► projects.analysis_passes (IFFY_ANALYSIS_V1)
```

### C1. Where Drift Can Occur

1. **Between analyze-project and dev-engine-v2**: `analyze-project` sets `assigned_lane` once. `dev-engine-v2` reads it but never validates if content has drifted from lane assumptions.
2. **Between convergence-engine and dev-engine-v2**: Both compute convergence independently. `convergence-engine` uses its own scoring; `dev-engine-v2` has its own `convergence` output field. No reconciliation.
3. **Between script-engine and dev-engine-v2**: Script pipeline operates on `scripts`/`script_versions`/`script_scenes` tables. Dev engine operates on `development_versions`. Document import bridges them (`import-to-docs` action), but there's no automatic validation that script content matches the development document being analyzed.
4. **Corpus influence is only injected into script-engine and script-coverage**, not into dev-engine-v2. A development version rewrite in dev-engine has no corpus calibration awareness.
5. **Lane drift**: A project's lane is set at analysis time but never re-validated as content evolves. A prestige drama could drift toward commercial without triggering lane reassignment.

---

## SECTION D — NOTE TIER & ROUTING LOGIC

### D1. Note Generation

Notes are generated exclusively by `dev-engine-v2` in the `analyze` action. The system prompt instructs the AI to produce three tiers:

- **`blocking_issues`** (severity: `blocker`, red) — max 5. Gate convergence. Convergence = "converged" only if blockers = 0.
- **`high_impact_notes`** (severity: `high`, amber) — max 5. Significant improvements, do NOT block convergence.
- **`polish_notes`** (severity: `polish`, grey) — max 5. Optional refinements. Never block convergence.

### D2. Note Structure

Each note has:
- `id` / `note_key`: stable snake_case identifier (e.g., `weak_act2_midpoint`)
- `category`: structural | character | escalation | lane | packaging | risk | pacing | hook | cliffhanger
- `description`, `why_it_matters`, `severity`

### D3. Convergence Logic

Convergence is computed in two places:
1. **AI-side** (in `dev-engine-v2` prompt): AI sets `convergence.status` based on blocker count and score thresholds.
2. **Client-side** (in `src/lib/dev-os-config.ts`): `computeConvergenceStatus()` function uses blocker count + CI/GP thresholds per behavior mode.

**Convergence rules**:
- `efficiency`: CI ≥ 65, GP ≥ 65, 0 min rewrite cycles
- `market`: CI ≥ 75, GP ≥ 75, 0 min rewrite cycles
- `prestige`: CI ≥ 85, GP ≥ 80, 2 min rewrite cycles

### D4. Can Notes Converge or Loop?

- **Convergence**: Yes. Once blockers reach zero, the AI prompt explicitly says "do NOT invent new blockers unless drift or regression is detected."
- **Looping risk**: YES. If the rewrite introduces a new issue, the analyze pass can generate a new blocker, causing an infinite loop. The "structurally stable" guardrail (zero blockers → stop generating blockers) is PROMPT-ONLY — there is no programmatic enforcement.
- **Note persistence**: Note keys are designed to be stable across runs, but the AI generates them fresh each time. There is no server-side note diffing or history tracking between versions — each analysis run produces a new set.

### D5. Where Guardrails Could Influence Convergence

- **Pre-analysis**: Inject guardrail constraints BEFORE the AI generates notes (e.g., "this project's production guardrail profile forbids X, Y, Z").
- **Post-analysis**: Validate AI-generated notes against guardrail rules and filter/upgrade/downgrade before storage.
- **Rewrite gating**: Only approved notes are sent to the rewrite prompt. Guardrails can add mandatory notes or block certain rewrite directions.

---

## SECTION E — CORPUS & LANE INFLUENCE

### E1. Corpus Influence on Prompts

| Engine | Corpus Data Used | Injection Method | Hard or Soft? |
|---|---|---|---|
| `script-engine` (blueprint) | `corpus_insights.calibration` — median pages, scenes, dialogue ratio | `corpusBlock` string appended to prompt: "Structure this blueprint to support ~X pages" | **Soft** — "Deviate only with creative justification" |
| `script-engine` (architecture) | Same calibration data | Injected as "Corpus Calibration" block with targets | **Soft** |
| `script-engine` (score) | Calibration + lane norms + gold baseline | Three separate blocks injected | **Soft** — scoring penalizes deviation but doesn't hard-reject |
| `script-coverage` | Calibration + gold baseline + masterwork canon + commercial proof + failure contrast | Five separate blocks, each with comparison rules | **Soft** — flags deviations but doesn't block |
| `dev-engine-v2` | **NONE** | — | **No corpus influence on development engine** |

### E2. Production Type / Format / Lane Weighting

| Where | What | Hard or Soft? |
|---|---|---|
| `production-type-rules.ts` (client) | `PRODUCTION_TYPE_RULES` — allowed/disallowed concepts, AI conditioning context, financing models, stakeholder templates | **Client-side reference only** — NOT injected into LLM prompts |
| `dev-engine-v2` | `FORMAT_EXPECTATIONS` dict — format-specific structural expectations | **Soft** — AI guidance, not validated |
| `dev-engine-v2` | `DELIVERABLE_RUBRICS` dict — what to score per deliverable type | **Soft** — AI guidance |
| `greenlight-simulate` | `ENGINE_REGISTRY` + specialist prompts per type — scoring axes, budget caps | **Mixed** — budget caps are hard rules in the prompt, but AI compliance isn't validated post-output |
| `packaging-intelligence` | `formatPackagingRules()` — per-format packaging psychology | **Soft** |
| `finance-predict` | `formatFinanceRules()` — per-format finance model rules | **Soft** |

### E3. Critical Gap

**`PRODUCTION_TYPE_RULES.aiConditioningContext`** is defined in `src/lib/production-type-rules.ts` but is **NEVER injected into any edge function prompt**. This is the most comprehensive production-type-aware context block in the system, and it's unused by the AI.

---

## SECTION F — RISK ASSESSMENT

### F1. Where Guardrails MUST Be Hard Locks

| Risk | Current State | Required Lock |
|---|---|---|
| Documentary fabrication | Prompt-only guard in `dev-engine-v2` + post-processing `validateDocSafety()` | **Hard lock**: Post-output validation that rejects any fabricated content. Currently implemented but only for scene headings. |
| Lane contamination | No validation | **Hard lock**: If a documentary project generates equity/gap-finance recommendations, reject and re-prompt. |
| Disallowed concepts per production type | `PRODUCTION_TYPE_RULES.disallowedConcepts` exists but is never enforced | **Hard lock**: Post-output scan for disallowed concept keywords. |
| Budget cap enforcement | Prompt-only in `greenlight-simulate` | **Hard lock**: Deterministic cap application on scores post-AI-output. Already partially implemented in greenlight. |
| Convergence blocker looping | Prompt-only instruction | **Hard lock**: Programmatic cap on blocker generation after N stable iterations. |

### F2. Where Guardrails Should Be Soft Bias

| Area | Rationale |
|---|---|
| Corpus calibration targets | Creative deviation from corpus norms may be intentional |
| Packaging style suggestions | Different producers have different packaging philosophies |
| Development behavior (efficiency/market/prestige) | Already user-selectable — guardrails should inform, not override |
| Lane recommendations | Lane drift should trigger a warning, not an automatic reassignment |
| Note categories and severity | AI judgment on severity should be guided but not overridden |

### F3. Duplication Risks if Guardrails Layered Incorrectly

1. **Format rules**: Currently duplicated across 5+ functions (`FORMAT_EXPECTATIONS`, `formatPackagingRules()`, `formatFinanceRules()`, `FORMAT_TO_ENGINE`, `PRODUCTION_TYPE_PROMPTS`). Adding guardrails per-function would create 6th+ copy.
2. **Production type conditioning**: `PRODUCTION_TYPE_RULES.aiConditioningContext` already defines the perfect per-type conditioning. Duplicating this in guardrails would create maintenance hell.
3. **Convergence thresholds**: Defined in both `dev-os-config.ts` (client) and `dev-engine-v2` (AI prompt). A guardrail system must not create a third source of truth.
4. **Allowed/disallowed concepts**: If guardrails re-specify these, they'll diverge from `PRODUCTION_TYPE_RULES` over time.

---

## SECTION G — RECOMMENDED INJECTION STRATEGY

### G1. Cleanest Architectural Layer

**Create `supabase/functions/_shared/guardrails.ts`** — a single shared Deno module.

```
supabase/functions/_shared/
├── guardrails.ts          ← Global guardrail context builder
├── production-profiles.ts ← Port of PRODUCTION_TYPE_RULES for server-side
├── format-rules.ts        ← Unified format expectations (replaces 5 duplicates)
└── ai-utils.ts            ← Shared callAI(), extractJSON(), parseAIJson()
```

### G2. How to Apply Production Guardrail Profiles Across ALL Engines

**Pattern**: Every edge function that calls an LLM imports and calls:

```typescript
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const guardrailBlock = buildGuardrailBlock({
  productionType: project.format,
  lane: project.assigned_lane,
  budget: project.budget_range,
  behavior: project.development_behavior,
  deliverable: currentDeliverable,
  // Optional: project-specific bespoke rules
  customGuardrails: project.custom_guardrails,
});

// Inject into system prompt:
const systemPrompt = `${guardrailBlock}\n\n${existingSystemPrompt}`;
```

`buildGuardrailBlock()` returns a deterministic string containing:
1. Production type conditioning (from ported `PRODUCTION_TYPE_RULES.aiConditioningContext`)
2. Allowed/disallowed concepts list
3. Format structural expectations
4. Budget-appropriate constraints
5. Lane-specific guidance
6. Any bespoke project guardrails

### G3. Project-Specific Bespoke Guardrails

Add a `custom_guardrails` JSONB column to the `projects` table. Structure:

```json
{
  "hard_locks": ["no_violence", "pg_13_language", "no_supernatural"],
  "soft_biases": ["favor_practical_effects", "prefer_european_locations"],
  "protect": ["protagonist_must_be_female", "must_include_climate_theme"],
  "forbidden_concepts": ["time_travel", "zombie"],
  "tone_lock": "dark_comedy"
}
```

These are merged into the guardrail block at build time. Hard locks are enforced post-output; soft biases are prompt-injected.

### G4. Drift Detection Validator

**Implement as a post-output validator function** in `_shared/guardrails.ts`:

```typescript
export function validateGuardrailCompliance(
  output: any,
  profile: GuardrailProfile
): { passed: boolean; violations: string[]; severity: 'warn' | 'reject' }
```

This function:
1. Scans AI output text/JSON for disallowed concepts (keyword matching against `disallowedConcepts`)
2. Validates structural expectations (e.g., doc safety — no fabricated INT/EXT headings)
3. Checks score consistency (budget caps applied correctly)
4. Detects lane drift (if output recommends actions outside the assigned lane)
5. Returns a violations list with severity

**Integration pattern**:
- `severity: 'warn'` → Log warning, return output with `guardrail_warnings` appended
- `severity: 'reject'` → Re-prompt with violations as additional context, or return original text unchanged

### G5. Implementation Priority Order

1. **Phase 1**: Create `_shared/` module with `buildGuardrailBlock()` + `validateGuardrailCompliance()` + shared `callAI()` + shared `extractJSON()`
2. **Phase 2**: Integrate into `dev-engine-v2` (highest frequency, most drift-prone)
3. **Phase 3**: Integrate into `script-engine` and `script-coverage`
4. **Phase 4**: Integrate into `packaging-intelligence`, `finance-predict`, `convergence-engine`
5. **Phase 5**: Integrate into remaining engines (generate-pitch, expand-concept, etc.)
6. **Phase 6**: Add `custom_guardrails` column and UI for project-specific rules

---

## APPENDIX: Function Line Counts

| Function | Lines | Complexity |
|---|---|---|
| dev-engine-v2 | 1866 | Very High — multi-action router with chunked rewriting |
| script-engine | 1788 | Very High — 10+ actions, batched drafting |
| script-coverage | 1184 | High — multi-source calibration assembly |
| analyze-corpus | 998 | High — multiple analysis modes |
| analyze-project | 816 | High — PDF/DOCX extraction + analysis |
| greenlight-simulate | 555 | Medium — router + specialist + calibrator pipeline |
| refresh-trends | 460 | Medium — Perplexity + AI structuring |
| convergence-engine | 387 | Medium |
| research-incentives | 302 | Medium |
| research-buyers | 289 | Medium |
| research-person | 277 | Medium |
| packaging-intelligence | 266 | Medium |
| finance-predict | 261 | Medium |
| expand-concept | 218 | Low |
| generate-pitch | 208 | Low |
| research-copro | 194 | Low |
| treatment-compare | 177 | Low |
| analyze-note | 165 | Low |
| stress-test-concept | 165 | Low |
| suggest-cast | 141 | Low |
| script-to-budget | 135 | Low |
| project-chat | 130 | Low |
| schedule-intelligence | 129 | Low |

---

**END OF AUDIT**

# IFFY Architecture Snapshot — Structural Export for External Review

---

## SECTION 1 — EDGE FUNCTION INVENTORY

| # | File Path | Function Name | Model | Prompt Assembly | Imports Shared Utils | Output Storage Table(s) | Run Logging Table |
|---|-----------|--------------|-------|-----------------|---------------------|------------------------|-------------------|
| 1 | `supabase/functions/dev-engine-v2/index.ts` | `dev-engine-v2` | `google/gemini-2.5-pro` (PRO), `google/gemini-2.5-flash` (FAST), `google/gemini-3-flash-preview` (BALANCED) | Inline helpers: `buildAnalyzeSystem()`, `buildRewriteSystem()`, `getBlueprintPrompt()`, `getArchitecturePrompt()`, `getDraftPrompt()`, `getScoringPrompt()`, `getRewritePrompt()`, `getImprovementPrompt()` | `buildGuardrailBlock`, `validateOutput`, `buildRegenerationPrompt` from `guardrails.ts` | `scripts`, `script_versions`, `script_scenes`, `project_documents` | `console.log` only |
| 2 | `supabase/functions/script-engine/index.ts` | `script-engine` | `google/gemini-2.5-pro` | Inline `getBlueprintPrompt()`, `getArchitecturePrompt()`, `getDraftPrompt()`, `getScoringPrompt()` — identical to dev-engine-v2 | `buildGuardrailBlock` from `guardrails.ts` | `scripts`, `script_versions`, `script_scenes`, `project_documents` | `console.log` only |
| 3 | `supabase/functions/script-coverage/index.ts` | `script-coverage` | `google/gemini-2.5-pro` (COVERAGE_MODEL), `google/gemini-2.5-flash` (FAST_MODEL) | Inline multi-pass: Pass A (analyst), Pass B (producer). Uses `promptVersion.analyst_prompt` + `promptVersion.producer_prompt` from `coverage_prompt_versions` table | `buildGuardrailBlock` from `guardrails.ts` | `coverage_runs` | `coverage_runs` row |
| 4 | `supabase/functions/development-engine/index.ts` | `development-engine` | `google/gemini-2.5-pro` (REVIEW), `google/gemini-3-flash-preview` (REWRITE) | Inline constants: `REVIEW_SYSTEM_BASE`, `NOTES_SYSTEM`, `REWRITE_SYSTEM`, `REASSESS_SYSTEM` | `buildGuardrailBlock` from `guardrails.ts` | `dev_engine_sessions`, `dev_engine_iterations` | `dev_engine_iterations` row |
| 5 | `supabase/functions/convergence-engine/index.ts` | `convergence-engine` | `google/gemini-2.5-pro` | Inline: `CONVERGENCE_SYSTEM` constant + `buildUserPrompt()` | `buildGuardrailBlock` from `guardrails.ts` | `convergence_scores` | `convergence_scores` row |
| 6 | `supabase/functions/analyze-project/index.ts` | `analyze-project` | `google/gemini-3-flash-preview` | Inline: `FORMAT_CONDITIONING` dict + `ANALYSIS_TOOLS` + system prompt string | `buildGuardrailBlock` from `guardrails.ts` | `projects.analysis_passes` (JSON field) | `console.log` only |
| 7 | `supabase/functions/analyze-note/index.ts` | `analyze-note` | `google/gemini-2.5-flash` | Inline system prompt string | `buildGuardrailBlock` from `guardrails.ts` | `project_updates` | None |
| 8 | `supabase/functions/generate-pitch/index.ts` | `generate-pitch` | varies | Inline | `buildGuardrailBlock` | `pitch_ideas` or related | None |
| 9 | `supabase/functions/expand-concept/index.ts` | `expand-concept` | varies | Inline | `buildGuardrailBlock` | `concept_expansions` | None |
| 10 | `supabase/functions/stress-test-concept/index.ts` | `stress-test-concept` | varies | Inline | `buildGuardrailBlock` | `concept_stress_tests` | None |
| 11 | `supabase/functions/smart-packaging/index.ts` | `smart-packaging` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 12 | `supabase/functions/suggest-cast/index.ts` | `suggest-cast` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 13 | `supabase/functions/packaging-intelligence/index.ts` | `packaging-intelligence` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 14 | `supabase/functions/finance-predict/index.ts` | `finance-predict` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 15 | `supabase/functions/greenlight-simulate/index.ts` | `greenlight-simulate` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 16 | `supabase/functions/comp-analysis/index.ts` | `comp-analysis` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 17 | `supabase/functions/schedule-intelligence/index.ts` | `schedule-intelligence` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 18 | `supabase/functions/score-engines/index.ts` | `score-engines` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 19 | `supabase/functions/treatment-compare/index.ts` | `treatment-compare` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 20 | `supabase/functions/refresh-trends/index.ts` | `refresh-trends` | varies | Inline | `buildGuardrailBlock` | `story_trends`, `cast_trends` | None |
| 21 | `supabase/functions/research-buyers/index.ts` | `research-buyers` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 22 | `supabase/functions/research-person/index.ts` | `research-person` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 23 | `supabase/functions/research-incentives/index.ts` | `research-incentives` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 24 | `supabase/functions/research-copro/index.ts` | `research-copro` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 25 | `supabase/functions/project-chat/index.ts` | `project-chat` | varies | Inline | `buildGuardrailBlock` | `project_chat_messages` | None |
| 26 | `supabase/functions/auto-schedule/index.ts` | `auto-schedule` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 27 | `supabase/functions/generate-pitch-deck/index.ts` | `generate-pitch-deck` | varies | Inline | `buildGuardrailBlock` | Response only | None |
| 28 | `supabase/functions/project-incentive-insights/index.ts` | `project-incentive-insights` | `google/gemini-2.5-flash` | Inline with tool_choice | `buildGuardrailBlock` | Response only | None |
| 29 | `supabase/functions/script-to-budget/index.ts` | `script-to-budget` | varies | Inline | `buildGuardrailBlock` | Response only | None |

**Non-LLM functions** (no AI calls): `ingest-corpus`, `embed-corpus`, `nightly-corpus-integrity`, `nightly-outcome-rollup`, `extract-documents`, `extract-characters`, `extract-scenes`, `extract-budget`, `parse-integration-import`, `promote-locked-idea`, `create-project-from-pitch-idea`, `recalibrate-weights`, `stripe-webhook`, `tmdb-lookup`, `audit-sources`.

---

## SECTION 2 — PROMPT ASSEMBLY CODE

### 2A — dev-engine-v2 (`buildAnalyzeSystem`)

```typescript
function buildAnalyzeSystem(deliverable: string, format: string, behavior: string, episodeDuration?: number): string {
  const rubric = DELIVERABLE_RUBRICS[deliverable] || DELIVERABLE_RUBRICS.script;
  const behaviorMod = BEHAVIOR_MODIFIERS[behavior] || BEHAVIOR_MODIFIERS.market;
  const formatExp = FORMAT_EXPECTATIONS[format] || FORMAT_EXPECTATIONS.film;

  let verticalRules = "";
  if (format === "vertical-drama" && episodeDuration) {
    const beatMin = episodeDuration <= 90 ? 3 : episodeDuration <= 120 ? 4 : episodeDuration <= 150 ? 5 : episodeDuration <= 180 ? 6 : 7;
    const beatsPerMin = behavior === "efficiency" ? 2.5 : behavior === "prestige" ? 2.5 : 3.0;
    verticalRules = `\nVERTICAL DRAMA RULES: Episode duration = ${episodeDuration}s. Required beat minimum = ${beatMin}. Required beats-per-minute ≥ ${beatsPerMin}. Hook within first 10s. Cliffhanger ending required.`;
  }

  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);
  const docGuard = isDocSafe
    ? "\nDOCUMENTARY/DECK GUARD: Do NOT invent characters, fabricate scenes, or generate INT./EXT. sluglines. Use [PLACEHOLDER] for missing information."
    : "";

  return `You are IFFY, a Creative–Commercial Alignment Architect.

${rubric}

${formatExp}

${behaviorMod}
${verticalRules}${docGuard}

Return ONLY valid JSON matching this EXACT schema:
{
  "meta": { "deliverable_type", "format", "development_behavior", "schema_version" },
  "summary": ["max 5 bullet points"],
  "scores": { "ci_score": 0-100, "gp_score": 0-100, "gap": number, "allowed_gap": number },
  "blocking_issues": [...],
  "high_impact_notes": [...],
  "polish_notes": [...],
  "rewrite_plan": [...],
  "convergence": { "status", "reasons", "blockers_remaining", "high_impact_remaining", "polish_remaining", "next_best_document" },
  "protect": [...],
  "verdict": "Invest" | "Develop Further" | "Major Rethink" | "Pass",
  "executive_snapshot": "...",
  "trajectory": null | "Converging" | "Eroding" | "Stalled" | "Strengthened" | "Over-Optimised",
  "primary_creative_risk": "...",
  "primary_commercial_risk": "...",
  "extracted_core": { protagonist, antagonist, stakes, midpoint, climax, tone, audience, genre }
}

RULES FOR NOTE GENERATION:
- blocking_issues: ONLY items that fundamentally prevent the document from working. Max 5. Gate convergence.
- high_impact_notes: Significant improvements but do NOT block convergence. Max 5.
- polish_notes: Optional refinements. NEVER block convergence. Max 5.
- CONVERGENCE RULE: convergence.status = "converged" if and only if blocking_issues is empty.`;
}
```

**Production type/format injection point:** `FORMAT_EXPECTATIONS[format]` dict inline in function.

**Corpus injection point:** `getBlueprintPrompt()` receives `calibration` parameter:
```typescript
if (calibration) {
  corpusBlock = `
CORPUS CALIBRATION (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Target page range: ${pageLow}–${pageHigh} pages (corpus median: ${mp})
- Target scene count: ${sceneLow}–${sceneHigh} scenes (corpus median: ${ms})
...
`;
}
```

**Lane injection point:** Inline in blueprint prompt:
```typescript
Lane: ${project.assigned_lane || "unassigned"}
```

**Guardrail injection point (new):**
```typescript
const guardrails = buildGuardrailBlock({
  productionType: project.format,
  project,
  corpusEnabled: body.corpusEnabled,
  corpusCalibration: calibration,
});
// injected into system messages
```

### 2B — script-engine (`getBlueprintPrompt`)

```typescript
function getBlueprintPrompt(productionType: string, project: any, conceptDocs: any[], calibration?: any) {
  const conceptContext = conceptDocs.map(d => `[${d.doc_type}]\n${d.content?.substring(0, 3000)}`).join("\n\n");

  let corpusBlock = "";
  if (calibration) {
    corpusBlock = `
CORPUS CALIBRATION (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Target page range: ${pageLow}–${pageHigh} pages
- Target scene count: ${sceneLow}–${sceneHigh} scenes
- Median midpoint position: ${calibration.median_midpoint_position}
- Median dialogue ratio: ${...}
- Median cast size: ${...}
...`;
  }

  const base = `You are IFFY, an elite script development AI.
PROJECT CONTEXT:
Title: ${project.title}
Production Type: ${productionType}
Format: ${project.format}
Genres: ${(project.genres || []).join(", ")}
Budget Range: ${project.budget_range}
Lane: ${project.assigned_lane || "unassigned"}
Tone: ${project.tone}
Comparable Titles: ${project.comparable_titles || "none"}
Logline: ${project.reasoning || ""}
${corpusBlock}
CONCEPT LOCK DOCUMENTS:
${conceptContext || "No concept lock documents available."}
`;
  // Then branches by production type:
  // pt.includes("tv") → TV SERIES BLUEPRINT
  // pt.includes("vertical") → VERTICAL DRAMA BLUEPRINT
  // pt.includes("documentary") → DOCUMENTARY BLUEPRINT (with REALITY LOCK)
  // default → FILM SCRIPT BLUEPRINT
}
```

**Note:** `script-engine` and `dev-engine-v2` share identical blueprint/architecture/draft prompt functions (duplicated code).

### 2C — script-coverage (multi-pass)

**Pass A — Analyst:**
```typescript
const passAResult = await callAI(
  LOVABLE_API_KEY,
  promptVersion.analyst_prompt       // from coverage_prompt_versions table
    + corpusDeviationBlock            // corpus calibration data
    + masterworkBlock                 // masterwork_canon benchmarks
    + commercialBlock                 // commercial_proof benchmarks
    + failureBlock                    // failure_contrast patterns
    + formatEngineBlock,              // format-specific engine (documentary/vertical/TV)
  `${projectMeta}\n\nSCRIPT:\n${truncatedScript}`,
  0.2
);
```

**Pass B — Producer:**
```typescript
const passBSystem = promptVersion.producer_prompt
  + formatScoringInstructions        // format-specific scoring grid
  + filmScoringBlock                 // (only for non-TV, non-vertical)
  + calibrationBlock;                // masterwork/commercial/failure stance
```

**Corpus injection:** `corpusDeviationBlock` built from `corpus_insights.calibration` + `corpus_insights.gold_baseline`:
```typescript
let corpusDeviationBlock = "";
if (corpusCalibration) {
  corpusDeviationBlock = `
CORPUS CALIBRATION DATA (from ${corpusCalibration.sample_size} analyzed scripts):
- Median page count: ${corpusCalibration.median_page_count}
- Median scene count: ${corpusCalibration.median_scene_count}
- Median dialogue ratio: ${...}
...
Include a "Deviation from Corpus Norms" section in your analysis.`;
}
```

**Lane injection:** Via `projectMeta`:
```typescript
const projectMeta = `TYPE: ${formatLabel} | GENRES: ${genres.join(", ")} | LANE: ${lane || "N/A"}`;
```

### 2D — development-engine (4-phase loop)

```typescript
const REVIEW_SYSTEM_BASE = `You are IFFY, a Creative–Commercial Alignment Architect operating in iterative loop mode.
Your goal is convergence: High Creative Integrity AND High Greenlight Probability.
You produce strategic evolution, not random notes.

Evaluate the submitted material and return ONLY valid JSON:
{
  "ci_score": 0-100,
  "gp_score": 0-100,
  "gap": number,
  "convergence_status": "Healthy Divergence" | "Strategic Tension" | "Dangerous Misalignment",
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "protect": [...],
  "strengthen": [...],
  "clarify": [...],
  "elevate": [...],
  "remove": [...]
}`;

// Guardrails injected at runtime:
const REVIEW_SYSTEM = REVIEW_SYSTEM_BASE + "\n" + guardrails.textBlock;
```

**No corpus injection in development-engine.** This is the "corpus gap" identified in the audit.

### 2E — convergence-engine

```typescript
const CONVERGENCE_SYSTEM = `You are IFFY, a Creative–Commercial Alignment Architect.
...
You MUST return ONLY valid JSON matching this exact structure:
{
  "executive_snapshot": "3 blunt sentences",
  "creative_integrity": { score, originality_delta, emotional_conviction, ... },
  "greenlight_probability": { score, packaging_probability, finance_viability, ... },
  "primary_creative_risk": "...",
  "primary_commercial_risk": "...",
  "leverage_moves": [...],
  "format_advisory": { triggered, alternative_formats, ... },
  "executive_guidance": "Accelerate | Refine | Protect & Rebuild | Reposition | Hold"
}`;

// Guardrails:
const guardrails = buildGuardrailBlock({ productionType: format || "film" });
const guardrailedSystem = `${CONVERGENCE_SYSTEM}\n${guardrails.textBlock}`;
```

**No corpus injection in convergence-engine.**

---

## SECTION 3 — SHARED UTILITIES

### 3A — `supabase/functions/_shared/guardrails.ts` (server-side only)

```typescript
// Types
export type EngineMode = "hard-lock" | "soft-bias" | "advisory";

export interface GuardrailPolicy {
  productionType: string;
  engineMode: EngineMode;
  disallowedConcepts: string[];
  documentaryFabricationCheck: boolean;
  customText: string | null;
  profileName: string;
}

export interface GuardrailBlock {
  textBlock: string;
  policy: GuardrailPolicy;
  hash: string;
  profileName: string;
}

// Core exports
export function buildGuardrailBlock(input: GuardrailInput): GuardrailBlock { ... }
export function validateOutput(text: string, policy: GuardrailPolicy): ValidationResult { ... }
export function buildRegenerationPrompt(violations: ValidationResult["violations"]): string { ... }

// ENGINE_MODE_DEFAULTS:
// documentary, documentary-series, hybrid-documentary → "hard-lock"
// film, tv-series, limited-series, vertical-drama, etc. → "soft-bias"
// hybrid → "advisory"
```

**Status:** Server-side only. Created as part of guardrail implementation.

### 3B — `supabase/functions/_shared/productionTypeRules.ts` (server-side only)

```typescript
export interface ProductionTypeContext {
  type: string;
  label: string;
  aiConditioningContext: string;
  allowedConcepts: string[];
  disallowedConcepts: string[];
  financingModel: string[];
  marketStrategyFocus: string[];
}

const RULES: Record<string, ProductionTypeContext> = {
  film: { ... }, 'tv-series': { ... }, documentary: { ... },
  // 18 production types total
};

export function getProductionTypeContext(productionType: string): ProductionTypeContext { ... }
export function getConditioningBlock(productionType: string): string { ... }
export function checkDisallowedConcepts(productionType: string, text: string): string[] { ... }
```

**Status:** Server-side only. Created as part of guardrail implementation.

### 3C — `src/lib/production-type-rules.ts` (client-side only)

```typescript
export interface ProductionTypeRule {
  type: ProjectFormat;
  label: string;
  emoji: string;
  allowedConcepts: string[];
  disallowedConcepts: string[];
  financingModel: string[];
  stakeholderTemplate: string[];
  deliverablesTemplate: string[];
  aiConditioningContext: string;       // ← DEFINED HERE but never sent to server
  marketStrategyFocus: string[];
  dashboardSummaryLabel: string;
}

export const PRODUCTION_TYPE_RULES: Record<ProjectFormat, ProductionTypeRule> = { ... };
// 18 production types. Includes stakeholderTemplate, deliverablesTemplate, emoji — client-only concerns.
```

**Status:** Client-side only. `aiConditioningContext` is defined but **not injected into LLM prompts** — now superseded by server-side `productionTypeRules.ts`.

**Duplication:** The `aiConditioningContext`, `allowedConcepts`, `disallowedConcepts`, `financingModel`, and `marketStrategyFocus` fields are duplicated between client (`src/lib/production-type-rules.ts`) and server (`supabase/functions/_shared/productionTypeRules.ts`).

### 3D — `src/lib/dev-os-config.ts` (client-side only)

```typescript
// Defines:
export type DeliverableType = 'idea' | 'concept_brief' | 'market_sheet' | 'blueprint' | ...;
export type DevelopmentBehavior = 'efficiency' | 'market' | 'prestige';

export const convergenceThresholds: Record<DevelopmentBehavior, ConvergenceThresholds> = {
  efficiency: { minCI: 65, minGP: 65, minRewriteCycles: 0 },
  market: { minCI: 75, minGP: 75, minRewriteCycles: 0 },
  prestige: { minCI: 85, minGP: 80, minRewriteCycles: 2 },
};

export function computeConvergenceStatus(ciScore, gpScore, gap, allowedGap, behavior, rewriteCycles, blockersRemaining): ConvergenceStatus { ... }

export const FORMAT_GUARDRAILS: Record<string, FormatGuardrails> = {
  film: { softMinMinutes: 90, softMaxMinutes: 110, requiresThreeActSpine: true, requiresMidpointReversal: true },
  documentary: { noFictionalization: true },
  'vertical-drama': { requiresCliffhanger: true, hookWindowSeconds: [3, 10] },
  // ...
};
```

**Status:** Client-side only. Convergence logic is computed both here (client) AND inside `dev-engine-v2` prompts (server, via AI output).

### 3E — `src/lib/lane-classifier.ts` (client-side only)

```typescript
export function classifyProject(input: ProjectInput, trendLaneInfluences?): ClassificationResult {
  // Deterministic scoring: budget → genre → audience → tone → format
  // Returns { lane, confidence, reasoning, recommendations }
}
```

**Status:** Client-side only. Lane classification also done by `analyze-project` (server-side, AI-based).

### 3F — No shared `llm.ts` or `composeMessages()` utility exists.

Each edge function has its own `callAI()` helper with slightly different signatures:
- dev-engine-v2: `callAI(apiKey, model, system, user, temperature, maxTokens)` with retry logic
- script-coverage: `callAI(apiKey, systemPrompt, userPrompt, temperature)` with AbortController
- development-engine: `callAI(apiKey, model, system, user, temperature, maxTokens)` without retry
- convergence-engine: `callAI(apiKey, model, system, user, temperature)` without retry
- analyze-project: Direct `fetch()` call with no wrapper

---

## SECTION 4 — DATA MODELS

### `projects` (key columns)

| Column | Type |
|--------|------|
| id | uuid PK |
| user_id | uuid |
| title | text |
| format | text |
| genres | text[] |
| budget_range | text |
| assigned_lane | text |
| tone | text |
| target_audience | text |
| comparable_titles | text |
| reasoning | text |
| analysis_passes | jsonb |
| pipeline_stage | text |
| development_behavior | text |
| created_at | timestamptz |
| updated_at | timestamptz |

**JSON field `analysis_passes`:** Stores the full AI analysis output from `analyze-project`.

**No `guardrails` JSON field exists yet.** The guardrail framework reads from `project.format` / `project.production_type` for default profiles.

### `scripts`

| Column | Type |
|--------|------|
| id | uuid PK |
| project_id | uuid FK |
| created_by | uuid |
| owner_id | uuid |
| version | integer |
| version_label | text |
| status | text (`BLUEPRINT`, `ARCHITECTURE`, `DRAFTING`, `DRAFT_N`) |
| draft_number | integer |
| latest_draft_number | integer |
| latest_batch_index | integer |
| latest_batch_storage_path | text |
| latest_page_count_est | integer |
| latest_runtime_min_est | integer |
| text_content | text |
| created_at | timestamptz |

### `script_versions`

| Column | Type |
|--------|------|
| id | uuid PK |
| script_id | uuid FK |
| draft_number | integer |
| batch_index | integer |
| is_partial | boolean |
| full_text_storage_path | text |
| blueprint_json | jsonb |
| notes | text |
| word_count | integer |
| line_count | integer |
| page_count_est | integer |
| runtime_min_est | integer |
| runtime_min_low | integer |
| runtime_min_high | integer |
| runtime_per_episode_est | integer |
| created_at | timestamptz |

### `script_scenes`

| Column | Type |
|--------|------|
| id | uuid PK |
| script_id | uuid FK |
| scene_number | integer |
| beat_summary | text |
| pov_character | text |
| objective | text |
| obstacle | text |
| conflict_type | text |
| turn_summary | text |
| escalation_notes | text |
| location | text |
| cast_size | integer |
| production_weight | text |

### `coverage_runs`

| Column | Type |
|--------|------|
| id | uuid PK |
| project_id | uuid FK |
| script_id | uuid FK |
| prompt_version_id | uuid FK |
| model | text |
| project_type | text |
| lane | text |
| inputs | jsonb |
| pass_a | text |
| pass_b | text |
| pass_c | text |
| final_coverage | text |
| structured_notes | jsonb |
| metrics | jsonb |
| draft_label | text |
| deliverable_type | text |
| development_behavior | text |
| format | text |
| episode_target_duration_seconds | integer |
| schema_version | text |
| created_at | timestamptz |
| created_by | uuid |

### `dev_engine_sessions`

| Column | Type |
|--------|------|
| id | uuid PK |
| user_id | uuid |
| project_id | uuid |
| title | text |
| input_text | text |
| input_type | text |
| format | text |
| genres | text[] |
| lane | text |
| budget | text |
| current_iteration | integer |
| latest_ci | numeric |
| latest_gp | numeric |
| latest_gap | numeric |
| convergence_status | text |
| trajectory | text |
| created_at | timestamptz |

### `dev_engine_iterations`

| Column | Type |
|--------|------|
| id | uuid PK |
| session_id | uuid FK |
| user_id | uuid |
| iteration_number | integer |
| phase | text (`review`, `notes`, `rewrite`, `reassess`) |
| ci_score | numeric |
| gp_score | numeric |
| gap | numeric |
| convergence_status | text |
| primary_creative_risk | text |
| primary_commercial_risk | text |
| protect_items | jsonb |
| strengthen_items | jsonb |
| clarify_items | jsonb |
| elevate_items | jsonb |
| remove_items | jsonb |
| structural_adjustments | jsonb |
| character_enhancements | jsonb |
| escalation_improvements | jsonb |
| lane_clarity_moves | jsonb |
| packaging_magnetism_moves | jsonb |
| risk_mitigation_fixes | jsonb |
| rewritten_text | text |
| changes_summary | text |
| creative_preserved | text |
| commercial_improvements | text |
| approved_notes | jsonb |
| reassess_ci | numeric |
| reassess_gp | numeric |
| reassess_gap | numeric |
| reassess_convergence | text |
| delta_ci | numeric |
| delta_gp | numeric |
| delta_gap | numeric |
| trajectory | text |
| raw_ai_response | jsonb |
| drift_level | text |
| created_at | timestamptz |

### `convergence_scores`

| Column | Type |
|--------|------|
| id | uuid PK |
| project_id | uuid FK |
| user_id | uuid |
| creative_integrity_score | integer |
| greenlight_probability | integer |
| gap | integer |
| allowed_gap | integer |
| convergence_status | text |
| trajectory | text |
| strategic_priority | text |
| development_stage | text |
| analysis_mode | text |
| executive_snapshot | text |
| primary_creative_risk | text |
| primary_commercial_risk | text |
| leverage_moves | jsonb |
| format_advisory | jsonb |
| executive_guidance | text |
| full_result | jsonb |
| created_at | timestamptz |

---

## SECTION 5 — LANE & CORPUS LOGIC

### Lane Weighting Storage

- `projects.assigned_lane` — text field. Values: `studio-streamer`, `independent-film`, `low-budget`, `international-copro`, `genre-market`, `prestige-awards`, `fast-turnaround`.
- Client-side classification: `src/lib/lane-classifier.ts` → `classifyProject()` — deterministic scoring.
- Server-side classification: `analyze-project` function → AI-determined, stored in `projects.analysis_passes`.

### Format/Production Type Storage

- `projects.format` — text field. Values: `film`, `tv-series`, `documentary`, `documentary-series`, `hybrid-documentary`, `commercial`, `branded-content`, `short-film`, `music-video`, `proof-of-concept`, `digital-series`, `vertical-drama`, `limited-series`, `hybrid`, `anim-feature`, `anim-series`, `reality`, `podcast-ip`.
- No separate `production_type` column — `format` is the canonical field.

### Corpus Toggle Storage

- No explicit `corpus_enabled` column on `projects`.
- Corpus influence is conditionally injected based on the **existence of data** in `corpus_insights` table.
- `corpus_insights` table stores: `calibration`, `gold_baseline`, `baseline_profile`, `lane_norm`, `playbook` insight types.
- Coverage and script engines query `corpus_insights` at runtime.

### Corpus Injection Code (script-engine / dev-engine-v2)

```typescript
// In getBlueprintPrompt():
if (calibration) {
  const mp = calibration.median_page_count;
  const ms = calibration.median_scene_count;
  const pageLow = mp ? Math.round(mp * 0.85) : null;
  const pageHigh = mp ? Math.round(mp * 1.15) : null;
  corpusBlock = `
CORPUS CALIBRATION (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Target page range: ${pageLow}–${pageHigh} pages (corpus median: ${mp})
- Target scene count: ${sceneLow}–${sceneHigh} scenes (corpus median: ${ms})
...
Structure this blueprint to support ~${mp || 'standard'} pages and ~${ms || 'standard'} scenes.
IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus.`;
}
```

### dev-engine-v2 Corpus Status

- **Blueprint:** ✅ Receives corpus calibration via `getCorpusCalibration()`.
- **Architecture:** ✅ Receives corpus calibration.
- **Draft:** ✅ Receives corpus calibration for minimum page enforcement.
- **Scoring:** ✅ Receives corpus calibration + gold baseline + lane norms.
- **Improvement:** ❌ No corpus injection (playbooks applied but no calibration data).
- **Analyze (buildAnalyzeSystem):** ❌ No corpus calibration injected into analyze prompts.

### development-engine Corpus Status

- **All phases:** ❌ No corpus injection. No `corpus_insights` query. This is the "corpus gap."

---

## SECTION 6 — NOTE TIER LOGIC

### Note Generation (dev-engine-v2)

Three tiers defined in `buildAnalyzeSystem()`:
```
"blocking_issues": Max 5. severity: "blocker". Gate convergence.
"high_impact_notes": Max 5. severity: "high". Do NOT block convergence.
"polish_notes": Max 5. severity: "polish". NEVER block convergence.
```

Convergence rule in prompt:
```
CONVERGENCE RULE: convergence.status = "converged" if and only if blocking_issues is empty.
```

### Note Generation (development-engine)

Five categories in `NOTES_SYSTEM`:
```
structural_adjustments, character_enhancements, escalation_improvements,
lane_clarity_moves, packaging_magnetism_moves, risk_mitigation_fixes
```
Each note has: `note`, `impact` (high/medium/low), `convergence_lift` (numeric).

### Convergence Logic (client-side)

`src/lib/dev-os-config.ts`:
```typescript
export function computeConvergenceStatus(
  ciScore, gpScore, gap, allowedGap, behavior, rewriteCycles, blockersRemaining
): ConvergenceStatus {
  // If blockersRemaining is provided:
  //   blockersRemaining > 0 → "In Progress"
  //   blockersRemaining == 0 AND scores meet thresholds → "Converged"
  // Legacy path: score-based convergence using thresholds per behavior mode
}
```

Thresholds:
```
efficiency: { minCI: 65, minGP: 65, minRewriteCycles: 0 }
market:     { minCI: 75, minGP: 75, minRewriteCycles: 0 }
prestige:   { minCI: 85, minGP: 80, minRewriteCycles: 2 }
```

### Convergence Logic (server-side, convergence-engine)

Deterministic calculation in function:
```typescript
function classifyConvergence(gap: number, allowed: number): string {
  if (gap <= allowed) return "Healthy Divergence";
  if (gap <= allowed + 15) return "Strategic Tension";
  return "Dangerous Misalignment";
}
```

### Drift Detection

- `dev_engine_iterations.drift_level` column exists (values: `none`, `moderate`, `major`).
- `dev_engine_iterations.trajectory` column exists (values: `Converging`, `Eroding`, `Stalled`, `Strengthened`, `Over-Optimised`).
- `convergence-engine` computes trajectory via `classifyTrajectory()` comparing current vs previous scores.
- No automated drift-triggered guardrail intervention exists.

### Note Convergence/Looping

- Notes **can** loop: dev-engine-v2 runs analyze → notes are rendered → user selects notes → rewrite applied → re-analyze.
- Notes **can** converge: When `blocking_issues` reaches zero and scores meet thresholds.
- Notes **cannot** currently loop automatically (user must trigger each cycle).
- No mechanism prevents note thrashing (same blocker appearing/disappearing across iterations).

---

## SECTION 7 — FILE TREE SNAPSHOT

### `/supabase/functions/`

```
supabase/functions/
├── _shared/
│   ├── guardrails.ts
│   └── productionTypeRules.ts
├── analyze-corpus/index.ts
├── analyze-note/index.ts
├── analyze-project/index.ts
├── audit-sources/index.ts
├── auto-schedule/index.ts
├── comp-analysis/index.ts
├── convergence-engine/index.ts
├── create-project-from-pitch-idea/index.ts
├── dev-engine-v2/index.ts
├── development-engine/index.ts
├── embed-corpus/index.ts
├── expand-concept/index.ts
├── extract-budget/index.ts
├── extract-characters/index.ts
├── extract-documents/index.ts
├── extract-scenes/index.ts
├── finance-predict/index.ts
├── generate-pitch-deck/index.ts
├── generate-pitch/index.ts
├── greenlight-simulate/index.ts
├── ingest-corpus/index.ts
├── nightly-corpus-integrity/index.ts
├── nightly-outcome-rollup/index.ts
├── packaging-intelligence/index.ts
├── parse-integration-import/index.ts
├── project-chat/index.ts
├── project-incentive-insights/index.ts
├── promote-locked-idea/index.ts
├── recalibrate-weights/index.ts
├── refresh-trends/index.ts
├── research-buyers/index.ts
├── research-copro/index.ts
├── research-incentives/index.ts
├── research-person/index.ts
├── schedule-intelligence/index.ts
├── score-engines/index.ts
├── script-coverage/index.ts
├── script-engine/index.ts
├── script-to-budget/index.ts
├── smart-packaging/index.ts
├── stress-test-concept/index.ts
├── stripe-webhook/index.ts
├── suggest-cast/index.ts
├── tmdb-lookup/index.ts
└── treatment-compare/index.ts
```

### `/src/` (UI conditioning)

```
src/lib/
├── production-type-rules.ts       ← Client-side PRODUCTION_TYPE_RULES (18 types, includes aiConditioningContext)
├── lane-classifier.ts             ← Client-side lane classification
├── dev-os-config.ts               ← Deliverable types, behavior modes, convergence thresholds, format guardrails
├── mode-engine.ts                 ← Mode engine logic
├── mode-readiness.ts              ← Mode readiness scoring
├── readiness-score.ts             ← Readiness scoring
├── stage-readiness.ts             ← Stage readiness
├── pipeline-gates.ts              ← Pipeline gate logic
├── finance-readiness.ts           ← Finance readiness scoring
├── master-viability.ts            ← Master viability engine
├── tv-readiness-score.ts          ← TV readiness scoring
├── paradox-house-mode.ts          ← Paradox House mode logic
├── visibility.ts                  ← UI visibility rules per format
├── lifecycle-stages.ts            ← Lifecycle stage definitions
├── types.ts                       ← Core type definitions including ProjectFormat union
└── ...
```

---

*End of structural export.*

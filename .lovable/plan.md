

# Script Corpus Ingestion + Learning Pipeline

## Summary

Upgrade the existing corpus ingestion system from a basic parse-and-chunk pipeline into a full **structured intelligence extraction** system. The 103 seeded IMSDB scripts will be analyzed with AI to produce format calibration models, and those models will feed back into the Script Engine, Coverage, and Rewrite systems.

---

## Phase 1: Schema Upgrades

Extend the existing `corpus_scripts` table with new analysis columns and create three new tables.

**Alter `corpus_scripts`** -- add columns:
- `title`, `production_type`, `format_subtype`, `genre`, `subgenre`
- `page_count` (integer), `runtime_est` (numeric), `scene_count`, `word_count`
- `avg_scene_length`, `avg_dialogue_ratio`, `cast_count`, `location_count`
- `int_ext_ratio`, `day_night_ratio`
- `vfx_flag` (boolean), `budget_tier_est`, `quality_score_est` (numeric)
- `market_success_flag` (boolean)
- `midpoint_position`, `climax_position`
- `analysis_status` (text, default 'pending')

**New table: `corpus_scene_patterns`**
- `corpus_script_id` (FK to corpus_scripts), `scene_number`, `act_estimate`
- `has_turn`, `conflict_type`, `scene_length_est`

**New table: `corpus_character_profiles`**
- `corpus_script_id` (FK), `character_name`, `dialogue_ratio`
- `arc_type`, `protagonist_flag`

**New table: `corpus_insights`** (aggregated calibration data)
- `insight_type`, `production_type`, `lane`, `pattern` (jsonb), `weight`

All tables get `user_id` columns and RLS policies matching existing corpus tables.

---

## Phase 2: Deep Analysis Edge Function

Create a new `analyze-corpus` edge function (or add an `analyze` action to the existing `ingest-corpus` function) that runs a structured AI analysis pass on an already-ingested script.

**Per-script extraction** (using Gemini Flash via tool calling):
1. Format detection (film/TV/short/doc)
2. Genre and subgenre classification
3. Act break positions, midpoint, climax
4. Scene-by-scene pattern extraction (conflict type, turns, length estimates)
5. Character extraction with dialogue ratios and arc types
6. Dialogue vs action ratio, average line length
7. Location count, INT/EXT ratio, DAY/NIGHT ratio
8. VFX intensity markers
9. Budget tier estimation
10. Quality score estimation

Store structured results back into the extended `corpus_scripts` columns, `corpus_scene_patterns`, and `corpus_character_profiles`.

---

## Phase 3: Aggregation + Calibration Models

Add an `aggregate` action that:
1. Groups completed analyses by `production_type` + `format_subtype`
2. Calculates medians for: page count, scene count, runtime, dialogue ratio, cast size, location count, midpoint position
3. Stores results in `corpus_insights` as typed JSON patterns
4. These become the "Format Calibration Models" -- live reference data for other systems

---

## Phase 4: Script Engine Integration

Modify the `script-engine` edge function to:
1. Before blueprint generation, fetch relevant `corpus_insights` for the project's production type
2. Replace static page targets (e.g., "90-120") with corpus median ranges
3. Scene count targeting uses `median_scene_count` with a tolerance band
4. Architecture prompt includes corpus-derived structural norms

Add a helper function `getCorpusCalibration(db, productionType)` that returns the median targets.

---

## Phase 5: Coverage Integration

Modify the `script-coverage` edge function to:
1. Fetch corpus calibration for the project's format
2. Add "Deviation from corpus norms" section to the analyst prompt
3. Score adjustments: penalize significant deviations from median structure, dialogue ratio, and length without creative justification
4. Add deviation metrics to the coverage output

---

## Phase 6: Rewrite Playbook Generation

Add a `generate-playbooks` action to the analyze-corpus function:
1. Extract patterns from top-scoring corpus scripts (quality_score_est > threshold)
2. Identify common structural patterns (Act 2 complications, B-story density, climax intensity)
3. Generate playbook entries stored in `corpus_insights` with `insight_type = 'playbook'`
4. Script Engine's "Improve Draft" mode retrieves relevant playbooks as rewrite strategy templates

---

## Phase 7: Retrieval Augmentation

Before drafting/rewriting in the Script Engine:
1. Query `corpus_scripts` for 3 structurally similar scripts (same production_type + genre)
2. Extract **metrics only** (page count, scene count, act breaks, dialogue ratio) -- never full text
3. Include these as constraint guidance in the generation prompt

---

## Phase 8: UI Additions

**Corpus Insights Dashboard** (new component, accessible from Settings or Development view):
- Median film length, pilot length by format
- Dialogue averages by genre (bar chart)
- Scene counts by format
- Cast size and location complexity averages
- Uses Recharts (already installed)

**Deviation Gauge** (added to ScriptEnginePanel):
- Structure deviation % vs corpus median
- Dialogue deviation %
- Length deviation %
- Visual gauge/badge indicators

---

## Phase 9: Batch Ingestion Trigger

Add a "Analyze All" button in the CorpusSourceManager that:
1. Iterates through all ingested but unanalyzed scripts
2. Queues them for the deep analysis pass (one at a time to avoid rate limits)
3. Shows progress
4. Triggers aggregation after all complete

---

## Technical Details

### Files to Create
- `supabase/functions/analyze-corpus/index.ts` -- deep analysis + aggregation + playbook generation
- `src/components/CorpusInsightsDashboard.tsx` -- admin insights UI
- `src/components/DeviationGauge.tsx` -- deviation display component
- `src/hooks/useCorpusInsights.ts` -- hook for fetching calibration data

### Files to Modify
- `supabase/functions/ingest-corpus/index.ts` -- minor: set `analysis_status = 'pending'` on new scripts
- `supabase/functions/script-engine/index.ts` -- inject corpus calibration into prompts
- `supabase/functions/script-coverage/index.ts` -- add deviation scoring
- `src/components/CorpusSourceManager.tsx` -- add "Analyze All" button
- `src/components/CorpusLibrary.tsx` -- show analysis metrics
- `src/components/ScriptEnginePanel.tsx` -- add deviation gauges
- `src/components/ScriptCoverage.tsx` -- show deviation section
- `src/hooks/useCorpus.ts` -- add hooks for analysis, aggregation, insights
- `supabase/config.toml` -- register new edge function

### Security
- All new tables get RLS with `user_id = auth.uid()` policies
- `corpus_insights` readable by all authenticated users (shared calibration data)
- Full script text never exposed in UI -- only structural metrics and short snippets (<=25 words)

### Performance
- Analysis uses `google/gemini-2.5-flash` with tool calling for structured output
- Scripts analyzed one at a time with progress tracking
- Aggregation is a lightweight SQL/JS pass over completed analyses
- Rate limit handling with 429/402 error surfacing


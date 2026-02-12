
# Permissioned Script Corpus Ingestion Pipeline

## Overview

Build a corpus ingestion system that downloads approved professional scripts, parses their structure, generates embeddings, and produces derived craft artifacts -- making professional screenplay patterns searchable and usable inside IFFY's Coverage and Rewrite engines.

## What Gets Built

1. **Approved Sources admin panel** -- a table where you manually add script URLs with rights status
2. **Ingestion edge function** -- downloads, extracts text, parses scenes, chunks, embeds, and generates craft artifacts
3. **Corpus Library UI** -- browse ingested scripts with their beat structures, arcs, and budget flags
4. **Coverage integration** -- toggle to benchmark user scripts against the corpus

## Database Changes

New tables (all with RLS scoped to the user):

- **approved_sources** -- allowlist of URLs with `rights_status` (only `APPROVED` triggers ingestion), `format` (pdf/html), `license_reference`, `title`
- **corpus_scripts** -- stores metadata for each ingested script: `source_id`, `checksum`, `raw_storage_path`, `parsed_storage_path`, `page_count_estimate`, `ingestion_status`, `ingestion_log`
- **corpus_scenes** -- parsed scenes: `script_id`, `scene_number`, `slugline`, `location`, `time_of_day`, `scene_text`
- **corpus_chunks** -- text chunks with embeddings: `script_id`, `chunk_index`, `chunk_text`, `embedding` (vector(1536))
- **derived_artifacts** -- LLM-generated analysis: `script_id`, `artifact_type` (beats/character_arcs/pacing_map/budget_flags), `json_data`

These use "corpus_" prefixed names to avoid collision with the existing `scripts` and `script_scenes` tables that power the Script Engine.

Enable the `vector` (pgvector) extension for embedding storage.

## Edge Function: `ingest-corpus`

A single edge function handling multiple actions:

- **`ingest`** -- For a given `source_id`:
  1. Verify `rights_status = 'APPROVED'`
  2. Download the file (PDF or HTML)
  3. Extract text (PDF: use raw text extraction via Deno; HTML: strip tags, prefer `<pre>` blocks)
  4. Normalize formatting, compute SHA256 checksum
  5. Upload raw text to `scripts` storage bucket under `corpus/raw/{checksum}.txt`
  6. Parse screenplay structure (detect sluglines via `^(INT\.|EXT\.|INT/EXT\.|I/E\.)` regex, split into scenes)
  7. Store scenes in `corpus_scenes`
  8. Chunk text (1500-2500 token chunks, respecting scene boundaries)
  9. Generate embeddings via Lovable AI gateway (using text-embedding model or Gemini for summary embeddings)
  10. Store chunks + vectors in `corpus_chunks`
  11. Call Lovable AI to produce derived artifacts (15-beat structure, character arcs, pacing map, budget drivers)
  12. Store in `derived_artifacts`
  13. Update `corpus_scripts.ingestion_status = 'complete'`

- **`search`** -- Accepts a query text, generates its embedding, performs vector similarity search against `corpus_chunks`, returns top matches with their parent script metadata and relevant `derived_artifacts`.

### Safety Rules (enforced in function)
- Refuse ingestion if `rights_status != 'APPROVED'`
- Log all activity to `ingestion_log` column
- Maintain `license_reference` for audit trail

## PDF + HTML Extraction Strategy

Since Deno edge functions cannot use `pdf-parse` (Node-only), the approach will be:

- **PDF**: Download as binary, send to Lovable AI (Gemini) with a "extract all text from this screenplay" prompt, or use the existing `extract-documents` function pattern that already handles PDF extraction via Gemini document understanding
- **HTML**: Fetch HTML, extract text from `<pre>` tags first; fallback to stripping all tags from `<body>`

## UI Changes

### Admin Tab: "Script Corpus" (within Settings or a new admin section)

- Table of `approved_sources` with columns: Title, URL, Format, Rights Status, Added By, Actions
- "Add Source" form with URL, title, format dropdown, license reference
- "Ingest" button per row (only enabled when status = APPROVED)
- Progress indicator showing ingestion status
- Link to view parsed results

### Corpus Library View (alongside Great Notes Library)

- List of ingested scripts showing: Title, Page Estimate, Beat Count, Character Arc Count, Budget Complexity
- Expandable detail view with: beat structure summary, character arc overview, pacing map visualization, budget flags

### Coverage Integration Toggle

- Checkbox in Coverage panel: "Use Great Script Benchmarking"
- When enabled, coverage runs will retrieve similar corpus chunks and inject structural patterns into the coverage prompt

## Integration with Coverage + Rewrite Engines

The `script-coverage` edge function will be updated to:
1. Accept a `useCorpusBenchmark` flag
2. If enabled, generate an embedding of the user's script excerpt
3. Query `corpus_chunks` for top-5 similar passages
4. Fetch related `derived_artifacts` (beats, arcs)
5. Inject into the analyst/producer prompts as reference patterns

The `script-engine` improvement/rewrite actions will similarly gain access to corpus patterns when the toggle is on.

## Technical Details

### Embedding Approach

Since Lovable AI doesn't expose a dedicated embeddings endpoint, we'll use Gemini to generate a compact text summary per chunk and store it. For similarity search, we'll use cosine similarity on pgvector. Alternatively, if the gateway supports embeddings in the future, we can swap in. For now, a pragmatic approach: generate a "semantic fingerprint" JSON per chunk via Gemini and use keyword/full-text search as a fallback.

**Revised approach**: Use PostgreSQL full-text search (`tsvector`/`tsquery`) as the primary search mechanism, with the `embedding` column reserved for future use when an embeddings endpoint becomes available. This avoids hallucinating an API that doesn't exist.

### File Structure

```text
supabase/functions/ingest-corpus/index.ts    -- new edge function
supabase/config.toml                         -- add function config
src/components/CorpusLibrary.tsx              -- corpus browse UI
src/components/CorpusSourceManager.tsx        -- admin source management
src/hooks/useCorpus.ts                       -- data hooks
```

### Implementation Order

1. Database migration (tables + pgvector + RLS + full-text search indexes)
2. Edge function `ingest-corpus` with `ingest` and `search` actions
3. Hook `useCorpus` for CRUD on sources and querying corpus
4. UI: `CorpusSourceManager` (add/manage approved sources)
5. UI: `CorpusLibrary` (browse ingested scripts + artifacts)
6. Update `script-coverage` to optionally inject corpus benchmarks
7. Add "Use Great Script Benchmarking" toggle to Coverage UI

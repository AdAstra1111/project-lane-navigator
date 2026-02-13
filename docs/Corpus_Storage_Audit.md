# CORPUS STORAGE & RETRIEVAL AUDIT

## 1. Storage Architecture

| Layer | Table / Bucket | What's Stored |
|---|---|---|
| **Raw text files** | Storage bucket `scripts`, path `corpus/raw/{checksum}.txt` | Full script plaintext (98 files) |
| **Script metadata** | `corpus_scripts` (44 columns) | Title, genre, page count, dialogue ratio, midpoint, climax, quality score, gold_flag, analysis_status, etc. |
| **Scene breakdown** | `corpus_scenes` | 7,130 rows — full scene text, sluglines, locations |
| **Text chunks** | `corpus_chunks` | 2,029 chunks with `chunk_text`, `search_vector` (tsvector), `embedding` (vector column) |
| **Scene patterns** | `corpus_scene_patterns` | Per-scene conflict type, act estimate, turns |
| **Character profiles** | `corpus_character_profiles` | Character name, dialogue ratio, arc type, protagonist flag |
| **Aggregated insights** | `corpus_insights` | 24 rows: calibration (1), gold_baseline (9), playbook (8), lane_norm (2), style_profile (1), baseline_profile (3) |
| **Derived artifacts** | `corpus_derived_artifacts` | JSON artifacts per script |

## 2. Answers

| Question | Answer |
|---|---|
| **A) Full script texts in DB?** | Yes — stored in `corpus_scenes.scene_text` (scene-level) and `corpus_chunks.chunk_text` (chunk-level). Raw files also in Storage. |
| **B) Files in Storage?** | Yes — 98 `.txt` files at `corpus/raw/{checksum}.txt` in `scripts` bucket |
| **C) Scripts chunked?** | Yes — 2,029 chunks in `corpus_chunks` |
| **D) Chunks & embeddings exist?** | Chunks: yes. **Embeddings: 0 populated** (all null). Vector column exists but is empty. |
| **E) Vector column?** | Yes — `corpus_chunks.embedding` is type `USER-DEFINED` (pgvector). Plus `search_vector` (tsvector for full-text search). |
| **F) Vector search in Dev Engine?** | **No.** Neither `script-engine` nor `dev-engine-v2` queries `corpus_chunks` or calls `search_corpus_semantic`. The DB function `search_corpus_semantic` exists but is **never called** from generation code. |

## 3. What IS Wired

The **Script Engine** and **Script Coverage** both query `corpus_insights` extensively:
- **Blueprint generation** → `getCorpusCalibration()` fetches median page/scene counts
- **Architecture** → same calibration data
- **Draft scoring** → calibration + lane norms + gold baseline
- **Improve Draft** → playbooks with trigger conditions + deviation metrics
- **Coverage** → corpus deviation block injected into analyst prompt

## 4. Conclusion

| Status | Description |
|---|---|
| ✅ **Metadata: Fully wired** | 98 scripts analyzed, 24 insight rows actively consumed by Script Engine + Coverage |
| ✅ **Files: Stored** | Raw text in Storage bucket |
| ✅ **Scenes: Stored** | 7,130 scene rows with full text |
| ⚠️ **Chunks: Stored but UNUSED** | 2,029 chunks exist but are never queried during generation |
| ❌ **Embeddings: Empty** | Vector column exists, 0 embeddings populated |
| ❌ **RAG: Not wired** | `search_corpus_semantic` DB function exists but is never called from Script Engine or Dev Engine. No retrieval-augmented generation happening. |

**TL;DR: The system uses corpus *aggregate statistics* (medians, playbooks, gold baselines) effectively. But the RAG pipeline (Phase 7 of the plan) — chunked text retrieval via vector similarity to inform individual drafts — is built at the schema/function level but has zero embeddings and zero integration into generation prompts.**

/**
 * narrativeDnaExtractor.ts — Extracts Narrative DNA from source story text.
 *
 * Supports:
 *   - Single-pass extraction for texts under SINGLE_PASS_THRESHOLD
 *   - Chunked extraction + synthesis for large texts
 *
 * Produces a structured DNA profile aligned to the existing NarrativeSpine shape
 * (9 axes) plus extended DNA dimensions and mutation constraints.
 *
 * Used by: narrative-dna edge function (Phase 1 only).
 * Does NOT modify project canon, pitch_ideas, or DevSeed.
 */

import { SPINE_AXES } from "./narrativeSpine.ts";
import { resolveGateway, callLLMWithJsonRetry, MODELS } from "./llm.ts";

// ── Constants ──

/** Texts under this char count use single-pass extraction. Above → chunked. */
export const SINGLE_PASS_THRESHOLD = 40_000;

/** Target chunk size in characters (with paragraph-boundary alignment). */
const CHUNK_TARGET_SIZE = 15_000;

/** Minimum chunk size — avoid tiny trailing chunks. */
const CHUNK_MIN_SIZE = 3_000;

// ── Constants ──

/** The 12 canonical engine keys. Classification MUST be constrained to this set. */
export const CANONICAL_ENGINE_KEYS = [
  "outsider_defends_system",
  "survival_against_intruder",
  "revenge_chain",
  "ambition_corrupts",
  "forbidden_union",
  "investigation_reveals_rot",
  "race_against_time",
  "power_transfer_succession_struggle",
  "institutional_rebellion",
  "false_utopia_hidden_horror",
  "mentor_betrayal_corrupted_guidance",
  "descent_into_the_unknown",
] as const;

// ── Types ──

export interface DnaExtractionResult {
  spine_json: Record<string, string | null>;
  escalation_architecture: string | null;
  antagonist_pattern: string | null;
  thematic_spine: string | null;
  emotional_cadence: string[];
  world_logic_rules: string[];
  set_piece_grammar: string | null;
  ending_logic: string | null;
  power_dynamic: string | null;
  forbidden_carryovers: string[];
  mutable_variables: string[];
  surface_expression_notes: string | null;
  extraction_confidence: number;
  extraction_json: Record<string, any>;
  primary_engine_key: string | null;
  secondary_engine_key: string | null;
}

export interface ChunkBoundary {
  index: number;
  start: number;
  end: number;
  charCount: number;
}

export interface ExtractionRunMeta {
  extraction_mode: "single_pass" | "chunked";
  normalized_text_length: number;
  chunk_count: number;
  chunk_boundaries: ChunkBoundary[];
  chunk_signals: any[];
  synthesis_model: string | null;
}

// ── Extraction Prompt ──

const ENGINE_KEY_LIST = CANONICAL_ENGINE_KEYS.join(", ");

const EXTRACTION_SYSTEM = `You are a structural narrative analyst. You extract the deep invariant "Narrative DNA" from a source story — the underlying engine, not the surface plot.

Your task: analyse the provided text and extract STRUCTURAL INVARIANTS that could drive a completely different story with a different setting, era, and characters.

Return a single JSON object with EXACTLY these keys:

{
  "spine": {
    "story_engine": "<string: the repeatable narrative mechanism — e.g. quest, mystery, survival, heist, revenge, transformation, escape, countdown, pursuit, revelation>",
    "pressure_system": "<string: causal logic driving drama — e.g. escalation_cascade, ticking_clock, pursuit, moral_dilemma, conspiracy, betrayal_chain, resource_depletion>",
    "central_conflict": "<string: primary conflict topology — e.g. man_vs_monster, man_vs_self, man_vs_society, man_vs_nature, man_vs_fate, man_vs_machine, group_vs_group>",
    "inciting_incident": "<string: category of trigger event — e.g. external_threat, loss, discovery, arrival, transgression, accusation, challenge>",
    "resolution_type": "<string: how the story resolves — e.g. pyrrhic_victory, restoration, sacrifice, escape, revelation, acceptance, defeat, transformation>",
    "stakes_class": "<string: what is at risk — e.g. survival, identity, community, civilizational, moral, familial, romantic, professional>",
    "protagonist_arc": "<string: protagonist transformation — e.g. redemption, corruption, revelation, survival, transcendence, sacrifice, coming_of_age, revenge, acceptance, disillusionment, awakening>",
    "midpoint_reversal": "<string: structural pivot at midpoint — e.g. false_victory, false_defeat, revelation, mirror_moment, point_of_no_return, betrayal, ally_betrayal, identity_reveal, power_shift, sacrifice>",
    "tonal_gravity": "<string: emotional register — e.g. tragedy, catharsis, triumph, ambiguity, irony, elegy, satire, dark, bittersweet, hopeful, playful>"
  },
  "extended": {
    "escalation_architecture": "<string: pattern of escalation>",
    "antagonist_pattern": "<string: antagonist structural pattern>",
    "thematic_spine": "<string: one sentence capturing the core thematic argument>",
    "emotional_cadence": ["<ordered list of 3-5 dominant emotional beats>"],
    "world_logic_rules": ["<3-5 rules that govern the story world's internal logic>"],
    "set_piece_grammar": "<string: structural pattern of major sequences>",
    "ending_logic": "<string: structural ending pattern>",
    "power_dynamic": "<string: core power relationship>"
  },
  "mutation": {
    "forbidden_carryovers": ["<list of specific names, places, creatures from the source>"],
    "mutable_variables": ["<list of dimensions that SHOULD change in derived works>"],
    "surface_expression_notes": "<string: brief guidance on surface vs engine>"
  },
  "engine_classification": {
    "primary_engine_key": "<REQUIRED: exactly one of: ${ENGINE_KEY_LIST}>",
    "secondary_engine_key": "<one of the same keys above, or null if no strong secondary engine>"
  },
  "confidence": <number 0.0-1.0>
}

RULES:
- Extract STRUCTURAL INVARIANTS, not plot summaries
- spine values should be lowercase_snake_case enum-style strings
- thematic_spine must be a single sentence, not a list
- forbidden_carryovers must list SPECIFIC names/places from the source text
- confidence should be lower for very short or ambiguous texts
- engine_classification.primary_engine_key MUST be exactly one of the listed engine keys — do NOT invent new keys
- engine_classification.secondary_engine_key must also be from the list or null
- Return ONLY the JSON object, no commentary`;

// ── Chunk Signal Prompt (lighter-weight for per-chunk extraction) ──

const CHUNK_SIGNAL_SYSTEM = `You are a structural narrative analyst. You are analysing ONE SECTION of a longer source text.

Extract structural narrative signals from this section. Not every section will contain all signals — only extract what is clearly present.

Return a JSON object:
{
  "spine_signals": {
    "story_engine": "<string or null>",
    "pressure_system": "<string or null>",
    "central_conflict": "<string or null>",
    "inciting_incident": "<string or null>",
    "resolution_type": "<string or null>",
    "stakes_class": "<string or null>",
    "protagonist_arc": "<string or null>",
    "midpoint_reversal": "<string or null>",
    "tonal_gravity": "<string or null>"
  },
  "extended_signals": {
    "escalation_architecture": "<string or null>",
    "antagonist_pattern": "<string or null>",
    "thematic_hints": ["<thematic elements observed>"],
    "emotional_beats": ["<emotional beats in this section>"],
    "world_rules": ["<world logic rules observed>"],
    "set_piece_pattern": "<string or null>",
    "power_dynamic": "<string or null>"
  },
  "mutation_signals": {
    "specific_names": ["<character/place/creature names found>"],
    "setting_elements": ["<setting-specific elements>"]
  },
  "section_summary": "<1-2 sentence structural summary of this section>",
  "signal_confidence": <number 0.0-1.0>
}

RULES:
- Only report signals clearly present in THIS section
- Use null for axes not evidenced in this section
- spine values should be lowercase_snake_case
- Return ONLY JSON`;

// ── Synthesis Prompt ──

const SYNTHESIS_SYSTEM = `You are a structural narrative analyst. You are synthesizing Narrative DNA from multiple chunk-level signal extractions of a long source text.

You will receive an array of chunk signals (one per section of the source). Your job is to synthesize these into a single unified DNA profile, resolving conflicts and identifying the dominant patterns across the full work.

Return a single JSON object with EXACTLY these keys:

{
  "spine": {
    "story_engine": "<string>",
    "pressure_system": "<string>",
    "central_conflict": "<string>",
    "inciting_incident": "<string>",
    "resolution_type": "<string>",
    "stakes_class": "<string>",
    "protagonist_arc": "<string>",
    "midpoint_reversal": "<string>",
    "tonal_gravity": "<string>"
  },
  "extended": {
    "escalation_architecture": "<string>",
    "antagonist_pattern": "<string>",
    "thematic_spine": "<single sentence>",
    "emotional_cadence": ["<3-5 beats>"],
    "world_logic_rules": ["<3-5 rules>"],
    "set_piece_grammar": "<string>",
    "ending_logic": "<string>",
    "power_dynamic": "<string>"
  },
  "mutation": {
    "forbidden_carryovers": ["<all specific names/places collected across chunks>"],
    "mutable_variables": ["<dimensions that should change>"],
    "surface_expression_notes": "<string>"
  },
  "confidence": <number 0.0-1.0>
}

RULES:
- Synthesize across ALL chunks — don't just use the first or last
- Resolve conflicting signals by choosing the DOMINANT pattern
- spine values must be lowercase_snake_case
- forbidden_carryovers should be the UNION of all specific names found
- confidence reflects overall extraction quality across all chunks
- Return ONLY JSON`;

// ── Deterministic Chunking ──

/**
 * Split text into deterministic chunks at paragraph boundaries.
 * Chunk order is stable and reproducible for the same input.
 */
export function chunkText(text: string): { chunks: string[]; boundaries: ChunkBoundary[] } {
  if (text.length <= SINGLE_PASS_THRESHOLD) {
    return {
      chunks: [text],
      boundaries: [{ index: 0, start: 0, end: text.length, charCount: text.length }],
    };
  }

  const chunks: string[] = [];
  const boundaries: ChunkBoundary[] = [];
  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    const remaining = text.length - pos;

    // If remaining fits in one chunk or is below min, take it all
    if (remaining <= CHUNK_TARGET_SIZE + CHUNK_MIN_SIZE) {
      chunks.push(text.slice(pos));
      boundaries.push({ index, start: pos, end: text.length, charCount: remaining });
      break;
    }

    // Find paragraph boundary near target size
    let splitAt = pos + CHUNK_TARGET_SIZE;

    // Search backward for double-newline paragraph break
    let searchFrom = splitAt;
    let found = false;
    while (searchFrom > pos + CHUNK_MIN_SIZE) {
      const doubleNl = text.lastIndexOf("\n\n", searchFrom);
      if (doubleNl > pos + CHUNK_MIN_SIZE && doubleNl < splitAt) {
        splitAt = doubleNl + 2; // include the newlines
        found = true;
        break;
      }
      // Try single newline as fallback
      const singleNl = text.lastIndexOf("\n", searchFrom);
      if (singleNl > pos + CHUNK_MIN_SIZE && singleNl < splitAt) {
        splitAt = singleNl + 1;
        found = true;
        break;
      }
      searchFrom -= 500;
    }

    // If no paragraph break found, split at target size
    if (!found) {
      splitAt = pos + CHUNK_TARGET_SIZE;
    }

    const chunk = text.slice(pos, splitAt);
    chunks.push(chunk);
    boundaries.push({ index, start: pos, end: splitAt, charCount: chunk.length });

    pos = splitAt;
    index++;
  }

  return { chunks, boundaries };
}

// ── Single-Pass Extraction ──

export async function extractNarrativeDna(
  sourceText: string,
  opts: { model?: string } = {},
): Promise<DnaExtractionResult> {
  const model = opts.model || MODELS.BALANCED;
  const { apiKey } = resolveGateway();

  // For single-pass, cap at context-safe limit
  const safeText = sourceText.length > SINGLE_PASS_THRESHOLD
    ? sourceText.slice(0, SINGLE_PASS_THRESHOLD)
    : sourceText;

  const raw = await callLLMWithJsonRetry<any>(
    {
      apiKey,
      model,
      system: EXTRACTION_SYSTEM,
      user: `Analyse this source text and extract its Narrative DNA:\n\n${safeText}`,
      temperature: 0.3,
      maxTokens: 4000,
    },
    {
      handler: "narrative_dna_extract",
      validate: (data): data is any => {
        return data && typeof data === "object" && data.spine && typeof data.spine === "object";
      },
    },
  );

  return mapRawToResult(raw);
}

// ── Chunked Extraction ──

/**
 * Extract DNA from a large text using chunk-level signal extraction + synthesis.
 * Returns the final DNA result plus the run metadata for provenance.
 */
export async function extractNarrativeDnaChunked(
  sourceText: string,
  opts: { model?: string } = {},
): Promise<{ result: DnaExtractionResult; runMeta: ExtractionRunMeta }> {
  const model = opts.model || MODELS.BALANCED;
  const { apiKey } = resolveGateway();

  const { chunks, boundaries } = chunkText(sourceText);

  console.log(`[dna-chunked] Extracting signals from ${chunks.length} chunks`);

  // Step 1: Extract signals from each chunk
  const chunkSignals: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[dna-chunked] Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
    try {
      const signal = await callLLMWithJsonRetry<any>(
        {
          apiKey,
          model,
          system: CHUNK_SIGNAL_SYSTEM,
          user: `Section ${i + 1} of ${chunks.length} of the source text:\n\n${chunks[i]}`,
          temperature: 0.3,
          maxTokens: 3000,
        },
        {
          handler: `dna_chunk_signal_${i}`,
          validate: (data): data is any => {
            return data && typeof data === "object";
          },
        },
      );
      chunkSignals.push({ chunk_index: i, ...signal });
    } catch (err: any) {
      console.error(`[dna-chunked] Chunk ${i} failed: ${err.message}`);
      chunkSignals.push({ chunk_index: i, error: err.message, signal_confidence: 0 });
    }
  }

  // Step 2: Filter out fully failed chunks
  const validSignals = chunkSignals.filter(s => !s.error);
  if (validSignals.length === 0) {
    throw new Error("All chunk extractions failed — cannot synthesize DNA");
  }

  // Step 3: Synthesize chunk signals into final DNA
  console.log(`[dna-chunked] Synthesizing ${validSignals.length} chunk signals`);
  const synthesisModel = MODELS.PRO; // Use stronger model for synthesis

  const raw = await callLLMWithJsonRetry<any>(
    {
      apiKey,
      model: synthesisModel,
      system: SYNTHESIS_SYSTEM,
      user: `Synthesize these ${validSignals.length} chunk-level signal extractions into a unified Narrative DNA profile:\n\n${JSON.stringify(validSignals, null, 2)}`,
      temperature: 0.3,
      maxTokens: 4000,
    },
    {
      handler: "narrative_dna_synthesis",
      validate: (data): data is any => {
        return data && typeof data === "object" && data.spine && typeof data.spine === "object";
      },
    },
  );

  const result = mapRawToResult(raw);

  const runMeta: ExtractionRunMeta = {
    extraction_mode: "chunked",
    normalized_text_length: sourceText.length,
    chunk_count: chunks.length,
    chunk_boundaries: boundaries,
    chunk_signals: chunkSignals.map(s => ({
      chunk_index: s.chunk_index,
      signal_confidence: s.signal_confidence ?? null,
      section_summary: s.section_summary ?? null,
      error: s.error ?? null,
    })),
    synthesis_model: synthesisModel,
  };

  return { result, runMeta };
}

// ── Shared mapper ──

function mapRawToResult(raw: any): DnaExtractionResult {
  const spineJson: Record<string, string | null> = {};
  for (const axis of SPINE_AXES) {
    spineJson[axis] = raw.spine?.[axis] ?? null;
  }

  const ext = raw.extended || {};
  const mut = raw.mutation || {};

  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.5;

  return {
    spine_json: spineJson,
    escalation_architecture: ext.escalation_architecture || null,
    antagonist_pattern: ext.antagonist_pattern || null,
    thematic_spine: ext.thematic_spine || null,
    emotional_cadence: Array.isArray(ext.emotional_cadence) ? ext.emotional_cadence : [],
    world_logic_rules: Array.isArray(ext.world_logic_rules) ? ext.world_logic_rules : [],
    set_piece_grammar: ext.set_piece_grammar || null,
    ending_logic: ext.ending_logic || null,
    power_dynamic: ext.power_dynamic || null,
    forbidden_carryovers: Array.isArray(mut.forbidden_carryovers) ? mut.forbidden_carryovers : [],
    mutable_variables: Array.isArray(mut.mutable_variables) ? mut.mutable_variables : [],
    surface_expression_notes: mut.surface_expression_notes || null,
    extraction_confidence: confidence,
    extraction_json: raw,
  };
}

// ── Hash Utility ──

export async function computeTextHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

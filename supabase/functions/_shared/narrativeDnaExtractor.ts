/**
 * narrativeDnaExtractor.ts — Extracts Narrative DNA from source story text.
 *
 * Produces a structured DNA profile aligned to the existing NarrativeSpine shape
 * (9 axes) plus extended DNA dimensions and mutation constraints.
 *
 * Used by: narrative-dna edge function (Phase 1 only).
 * Does NOT modify project canon, pitch_ideas, or DevSeed.
 */

import { SPINE_AXES } from "./narrativeSpine.ts";
import { resolveGateway, callLLMWithJsonRetry, MODELS } from "./llm.ts";

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
}

// ── Extraction Prompt ──

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
    "escalation_architecture": "<string: pattern of escalation — e.g. three_escalating_confrontations, rising_betrayals, narrowing_options, expanding_scope>",
    "antagonist_pattern": "<string: antagonist structural pattern — e.g. successive_greater_threats, hidden_manipulator, mirror_protagonist, systemic_force, absent_antagonist>",
    "thematic_spine": "<string: one sentence capturing the core thematic argument>",
    "emotional_cadence": ["<ordered list of 3-5 dominant emotional beats — e.g. triumph, dread, elegy>"],
    "world_logic_rules": ["<3-5 rules that govern the story world's internal logic — invariant, not setting-specific>"],
    "set_piece_grammar": "<string: structural pattern of major sequences — e.g. confrontation_ceremony_aftermath, discovery_chase_revelation, test_failure_growth>",
    "ending_logic": "<string: structural ending pattern — e.g. torch_passed_at_cost, cycle_repeats, order_restored, protagonist_transcends>",
    "power_dynamic": "<string: core power relationship — e.g. leader_vs_chaos, individual_vs_institution, mentor_vs_student, equal_rivals>"
  },
  "mutation": {
    "forbidden_carryovers": ["<list of specific names, places, creatures, objects from the source that must NOT appear in any derived work>"],
    "mutable_variables": ["<list of dimensions that SHOULD change in derived works — e.g. setting, era, specific characters, technology, iconography, cultural context>"],
    "surface_expression_notes": "<string: brief guidance on what constitutes 'surface expression' vs 'engine' for this source>"
  },
  "confidence": <number 0.0-1.0: how confident you are in this extraction>
}

RULES:
- Extract STRUCTURAL INVARIANTS, not plot summaries
- spine values should be lowercase_snake_case enum-style strings
- thematic_spine must be a single sentence, not a list
- forbidden_carryovers must list SPECIFIC names/places from the source text
- confidence should be lower for very short or ambiguous texts
- Return ONLY the JSON object, no commentary`;

// ── Extraction Function ──

export async function extractNarrativeDna(
  sourceText: string,
  opts: { model?: string } = {},
): Promise<DnaExtractionResult> {
  const model = opts.model || MODELS.BALANCED;
  const { apiKey } = resolveGateway();

  // Truncate to ~50k chars to stay within context window
  const truncatedText = sourceText.length > 50_000
    ? sourceText.slice(0, 50_000) + "\n\n[TEXT TRUNCATED AT 50,000 CHARACTERS]"
    : sourceText;

  const raw = await callLLMWithJsonRetry<any>(
    {
      apiKey,
      model,
      system: EXTRACTION_SYSTEM,
      user: `Analyse this source text and extract its Narrative DNA:\n\n${truncatedText}`,
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

  // Map spine to canonical axis names
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

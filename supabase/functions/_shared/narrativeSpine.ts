/**
 * Narrative Spine Foundation — shared types and constants.
 * 9-axis structural story constraints locked at DevSeed level.
 *
 * Canonical location: supabase/functions/_shared/narrativeSpine.ts
 * Do NOT redefine these types elsewhere.
 */

// ── 3 new string literal unions (story_engine / causal_grammar / conflict_mode reuse existing enums) ──

export const PROTAGONIST_ARCS = [
  'redemption',
  'corruption',
  'revelation',
  'survival',
  'transcendence',
  'sacrifice',
  'coming_of_age',
  'revenge',
] as const;
export type ProtagonistArc = typeof PROTAGONIST_ARCS[number];

export const MIDPOINT_REVERSALS = [
  'false_victory',
  'false_defeat',
  'revelation',
  'mirror_moment',
  'point_of_no_return',
  'betrayal',
] as const;
export type MidpointReversal = typeof MIDPOINT_REVERSALS[number];

export const TONAL_GRAVITIES = [
  'tragedy',
  'catharsis',
  'triumph',
  'ambiguity',
  'irony',
  'elegy',
  'satire',
] as const;
export type TonalGravity = typeof TONAL_GRAVITIES[number];

// ── NarrativeSpine — the 9-axis structural lock ──

export interface NarrativeSpine {
  /** Repeatable narrative mechanism (maps to StoryEngine enum) */
  story_engine: string | null;
  /** Causal logic driving the drama (maps to CausalGrammar enum) */
  pressure_system: string | null;
  /** Primary conflict driver (maps to ConflictMode enum) */
  central_conflict: string | null;
  /** Category of the inciting event */
  inciting_incident: string | null;
  /** How the story ends / resolution shape */
  resolution_type: string | null;
  /** Stakes category / scale */
  stakes_class: string | null;
  /** Protagonist's transformation arc */
  protagonist_arc: ProtagonistArc | null;
  /** The structural reversal at the story midpoint */
  midpoint_reversal: MidpointReversal | null;
  /** Overall tonal gravity / emotional register */
  tonal_gravity: TonalGravity | null;
  /** ISO timestamp when the spine was locked */
  locked_at?: string;
  /** Source that locked the spine */
  locked_by?: string;
}

export const NARRATIVE_SPINE_EMPTY: NarrativeSpine = {
  story_engine: null,
  pressure_system: null,
  central_conflict: null,
  inciting_incident: null,
  resolution_type: null,
  stakes_class: null,
  protagonist_arc: null,
  midpoint_reversal: null,
  tonal_gravity: null,
};

/**
 * Returns a human-readable summary of the locked spine axes for injection
 * into stage generation prompts. Only includes non-null axes.
 */
export function spineToPromptBlock(spine: NarrativeSpine | null | undefined): string {
  if (!spine) return '';
  const lines: string[] = [];
  if (spine.story_engine)       lines.push(`- Story Engine: ${spine.story_engine}`);
  if (spine.pressure_system)    lines.push(`- Pressure System: ${spine.pressure_system}`);
  if (spine.central_conflict)   lines.push(`- Central Conflict: ${spine.central_conflict}`);
  if (spine.inciting_incident)  lines.push(`- Inciting Incident: ${spine.inciting_incident}`);
  if (spine.resolution_type)    lines.push(`- Resolution Type: ${spine.resolution_type}`);
  if (spine.stakes_class)       lines.push(`- Stakes: ${spine.stakes_class}`);
  if (spine.protagonist_arc)    lines.push(`- Protagonist Arc: ${spine.protagonist_arc}`);
  if (spine.midpoint_reversal)  lines.push(`- Midpoint Reversal: ${spine.midpoint_reversal}`);
  if (spine.tonal_gravity)      lines.push(`- Tonal Gravity: ${spine.tonal_gravity}`);
  if (lines.length === 0) return '';
  return `\n\nNARRATIVE SPINE (LOCKED — do not deviate from these structural constraints):\n${lines.join('\n')}\n`;
}

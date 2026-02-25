/**
 * Nuance Control Stack — Edge function version (Deno-compatible)
 * Mirrors src/lib/nuance/ but runs in edge function context.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NuanceParams {
  restraint: number;
  story_engine: string;
  causal_grammar: string;
  drama_budget: number;
  anti_tropes: string[];
  diversify: boolean;
}

export interface NuanceMetrics {
  absolute_words_rate: number;
  twist_keyword_rate: number;
  conspiracy_markers: number;
  shock_events_early: number;
  speech_length_proxy: number;
  named_factions: number;
  plot_thread_count: number;
  new_character_density: number;
  subtext_scene_count: number;
  quiet_beats_count: number;
  meaning_shift_count: number;
  antagonist_legitimacy: boolean;
  cost_of_action_markers: number;
}

export interface GateAttempt {
  pass: boolean;
  failures: string[];
  metrics: NuanceMetrics;
  melodrama_score: number;
  nuance_score: number;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

const ABSOLUTE_WORDS = /\b(always|never|everything|nothing|only hope|impossible|forever|completely|utterly|total(?:ly)?)\b/gi;
const TWIST_KEYWORDS = /\b(reveals?|turns? out|secretly|suddenly|betrayal|double.?cross|shocking|plot twist|unmasked|all along)\b/gi;
const CONSPIRACY_MARKERS_RE = /\b(organization|conspiracy|shadow|syndicate|cabal|secret society|hidden agenda|puppet master|pulling the strings)\b/gi;
const SHOCK_EVENTS = /\b(kidnap|murder|explosion|assassin|bomb|massacre|hostage|poisoned?|gunshot|stabbed?)\b/gi;
const LONG_SPEECH_RE = /["'](.*?)["']/gs;
const SUBTEXT_MARKERS = /\b(subtext|unspoken|withheld|won't say|say instead|tactic|tell|beneath the surface|underlying)\b/gi;
const QUIET_BEAT_MARKERS = /\b(silence|pause|stillness|quiet moment|breath|contemplat|reflect|stare|sit with)\b/gi;
const MEANING_SHIFT_MARKERS = /\b(reinterpret|re-?read|new light|different meaning|realize|understand now|see differently|meaning shift|changes everything we thought)\b/gi;
const ANTAGONIST_LEGITIMACY_RE = /\b(legitimate|valid point|understandable|reasonable|their perspective|from their view|not wrong|has a point)\b/gi;
const COST_MARKERS = /\b(cost|price|consequence|sacrifice|trade-?off|lose|risk|penalty|repercussion|fallout)\b/gi;
const FACTION_MARKERS = /\b(faction|group|alliance|coalition|clan|family|house|organization|agency|department|team|side)\b/gi;
const THREAD_MARKERS = /\b(meanwhile|subplot|thread|strand|parallel|B-story|C-story|side plot)\b/gi;
const CHARACTER_INTRO = /\b(introduce|introducing|we meet|enter|arrives?|new character|first appearance)\b/gi;

function countMatches(text: string, regex: RegExp): number {
  return (text.match(regex) || []).length;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function computeMetrics(text: string): NuanceMetrics {
  const words = wordCount(text);
  if (words === 0) {
    return {
      absolute_words_rate: 0, twist_keyword_rate: 0, conspiracy_markers: 0,
      shock_events_early: 0, speech_length_proxy: 0, named_factions: 0,
      plot_thread_count: 0, new_character_density: 0, subtext_scene_count: 0,
      quiet_beats_count: 0, meaning_shift_count: 0, antagonist_legitimacy: false,
      cost_of_action_markers: 0,
    };
  }
  const earlyPortion = text.slice(0, Math.floor(text.length * 0.2));
  const speeches = text.match(LONG_SPEECH_RE) || [];
  const longSpeeches = speeches.filter(s => s.length > 150);

  return {
    absolute_words_rate: countMatches(text, ABSOLUTE_WORDS) / (words / 1000),
    twist_keyword_rate: countMatches(text, TWIST_KEYWORDS) / (words / 1000),
    conspiracy_markers: countMatches(text, CONSPIRACY_MARKERS_RE),
    shock_events_early: countMatches(earlyPortion, SHOCK_EVENTS),
    speech_length_proxy: longSpeeches.length,
    named_factions: countMatches(text, FACTION_MARKERS),
    plot_thread_count: countMatches(text, THREAD_MARKERS),
    new_character_density: countMatches(text, CHARACTER_INTRO) / Math.max(1, words / 1000),
    subtext_scene_count: countMatches(text, SUBTEXT_MARKERS),
    quiet_beats_count: countMatches(text, QUIET_BEAT_MARKERS),
    meaning_shift_count: countMatches(text, MEANING_SHIFT_MARKERS),
    antagonist_legitimacy: countMatches(text, ANTAGONIST_LEGITIMACY_RE) > 0,
    cost_of_action_markers: countMatches(text, COST_MARKERS),
  };
}

export function melodramaScore(m: NuanceMetrics): number {
  let s = 0;
  s += Math.min(1, m.absolute_words_rate / 10) * 0.2;
  s += Math.min(1, m.twist_keyword_rate / 8) * 0.2;
  s += Math.min(1, m.conspiracy_markers / 5) * 0.15;
  s += Math.min(1, m.shock_events_early / 3) * 0.2;
  s += Math.min(1, m.speech_length_proxy / 4) * 0.1;
  s += Math.min(1, m.named_factions / 8) * 0.15;
  return Math.min(1, Math.max(0, s));
}

export function nuanceScore(m: NuanceMetrics): number {
  let s = 0;
  s += Math.min(1, m.subtext_scene_count / 3) * 0.25;
  s += Math.min(1, m.quiet_beats_count / 2) * 0.2;
  s += Math.min(1, m.meaning_shift_count) * 0.2;
  s += m.antagonist_legitimacy ? 0.15 : 0;
  s += Math.min(1, m.cost_of_action_markers / 2) * 0.1;
  s += (1 - Math.min(1, (m.twist_keyword_rate + m.conspiracy_markers) / 10)) * 0.1;
  return Math.min(1, Math.max(0, s));
}

// ─── Gate ───────────────────────────────────────────────────────────────────

const MELODRAMA_THRESHOLDS: Record<string, number> = {
  documentary: 0.15, vertical_drama: 0.45, series: 0.35, feature_film: 0.30, default: 0.35,
};

function getMelodramaThreshold(lane: string): number {
  const l = lane.toLowerCase();
  if (l.includes('documentary')) return MELODRAMA_THRESHOLDS.documentary;
  if (l.includes('vertical')) return MELODRAMA_THRESHOLDS.vertical_drama;
  if (l.includes('series')) return MELODRAMA_THRESHOLDS.series;
  if (l.includes('feature')) return MELODRAMA_THRESHOLDS.feature_film;
  return MELODRAMA_THRESHOLDS.default;
}

export function runGate(
  metrics: NuanceMetrics,
  lane: string,
  params: NuanceParams,
  similarityRisk: number,
): GateAttempt {
  const failures: string[] = [];
  const ms = melodramaScore(metrics);
  const ns = nuanceScore(metrics);

  const threshold = getMelodramaThreshold(lane) * (1 - (params.restraint - 50) / 200);
  if (ms > threshold) failures.push('MELODRAMA');
  if (metrics.plot_thread_count > 6 || metrics.named_factions > 6 || metrics.new_character_density > 5) failures.push('OVERCOMPLEXITY');
  if (params.diversify && similarityRisk > 0.7) failures.push('TEMPLATE_SIMILARITY');
  if (metrics.shock_events_early > 2) failures.push('STAKES_TOO_BIG_TOO_EARLY');
  if (metrics.twist_keyword_rate > 6) failures.push('TWIST_OVERUSE');
  if (metrics.subtext_scene_count < 3) failures.push('SUBTEXT_MISSING');
  if (metrics.quiet_beats_count < 2) failures.push('QUIET_BEATS_MISSING');
  if (metrics.meaning_shift_count < 1) failures.push('MEANING_SHIFT_MISSING');

  return { pass: failures.length === 0, failures, metrics, melodrama_score: ms, nuance_score: ns };
}

// ─── Repair Instruction Builder ─────────────────────────────────────────────

export function buildRepairInstruction(failures: string[], antiTropes: string[]): string {
  const d: string[] = [];
  if (failures.includes('MELODRAMA')) {
    d.push('REDUCE MELODRAMA:', '- Convert screaming confessions to withheld corrections.', '- Replace physical threats with resource withdrawal or social leverage.', '- Replace villain monologues with bureaucratic language.', '- Cut absolute language by half.');
  }
  if (failures.includes('OVERCOMPLEXITY')) {
    d.push('REDUCE COMPLEXITY:', '- Collapse plot threads to at most 3.', '- Limit core characters to 5.', '- Remove non-essential factions.');
  }
  if (failures.includes('STAKES_TOO_BIG_TOO_EARLY')) {
    d.push('REFRAME EARLY STAKES:', '- Keep stakes personal in the first 80%.', '- Remove global/life-threatening stakes from early acts.');
  }
  if (failures.includes('TWIST_OVERUSE')) {
    d.push('REDUCE TWISTS:', '- Keep at most 1 major reveal.', '- Replace removed twists with character insight.');
  }
  if (failures.includes('SUBTEXT_MISSING')) {
    d.push('ADD SUBTEXT:', '- Include 3+ subtext scenes with wants/won\'t say/says instead/tactic/tell.');
  }
  if (failures.includes('QUIET_BEATS_MISSING')) {
    d.push('ADD QUIET BEATS:', '- Include 2+ quiet beats with tension through behavior, not dialogue.');
  }
  if (failures.includes('MEANING_SHIFT_MISSING')) {
    d.push('ADD MEANING SHIFTS:', '- Include 1+ moment per act reinterpreting existing information.');
  }
  if (antiTropes.length > 0) {
    d.push('AVOID TROPES:', ...antiTropes.map(t => `- No ${t.replace(/_/g, ' ')}.`));
  }
  d.push('', 'CRITICAL: Do NOT add new plot elements. Only remove, replace, or reframe.');
  return d.join('\n');
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

export function computeFingerprint(text: string, lane: string, engine: string, grammar: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  let stakesType = 'personal';
  if (/\b(world|global|humanity|civilization|nation|war)\b/.test(lower)) stakesType = 'global';
  else if (/\b(systemic|institution|policy|government|corporate)\b/.test(lower)) stakesType = 'systemic';
  else if (/\b(community|social|group|family|neighborhood)\b/.test(lower)) stakesType = 'social';

  const twists = (lower.match(/\b(reveals?|turns? out|twist|secretly|all along)\b/g) || []).length;

  return {
    lane, story_engine: engine, causal_grammar: grammar, stakes_type: stakesType,
    twist_count_bucket: twists === 0 ? '0' : twists === 1 ? '1' : '2+',
  };
}

export function computeSimilarityRisk(current: Record<string, unknown>, recent: Record<string, unknown>[]): number {
  if (recent.length === 0) return 0;
  const fields = ['story_engine', 'causal_grammar', 'stakes_type', 'twist_count_bucket'];
  let total = 0;
  for (const prev of recent) {
    let matches = 0;
    for (const f of fields) { if (current[f] === prev[f]) matches++; }
    total += matches / fields.length;
  }
  return Math.min(1, total / recent.length);
}

// ─── Nuance Prompt Block ────────────────────────────────────────────────────

const ENGINE_DESCRIPTIONS: Record<string, string> = {
  pressure_cooker: 'Characters trapped in escalating constraints with diminishing options.',
  two_hander: 'Two central characters in an evolving power dynamic.',
  slow_burn_investigation: 'Gradual revelation through methodical inquiry and observation.',
  social_realism: 'Grounded in everyday reality, institutional friction, economic pressure.',
  moral_trap: 'Protagonist faces an impossible choice with legitimate arguments on all sides.',
  character_spiral: 'Internal deterioration or transformation driven by a core flaw.',
  rashomon: 'Multiple perspectives revealing contradictory truths.',
  anti_plot: 'Deliberately subverts narrative expectations; meaning emerges from pattern, not arc.',
};

const GRAMMAR_DESCRIPTIONS: Record<string, string> = {
  accumulation: 'Small pressures compound until a threshold breaks.',
  erosion: 'Something valued is gradually worn away.',
  exchange: 'Every gain requires a specific loss.',
  mirror: 'Characters in parallel situations make different choices.',
  constraint: 'External systems limit what characters can do.',
  misalignment: 'Characters want compatible things but can\'t coordinate.',
  contagion: 'One person\'s choice cascades through a network.',
  revelation_without_facts: 'Understanding shifts without new information.',
};

export function buildNuancePromptBlock(params: NuanceParams): string {
  const lines: string[] = [
    `## NUANCE CONSTRAINTS (MANDATORY)`,
    ``,
    `### Story Engine: ${params.story_engine}`,
    ENGINE_DESCRIPTIONS[params.story_engine] || '',
    ``,
    `### Causal Grammar: ${params.causal_grammar}`,
    GRAMMAR_DESCRIPTIONS[params.causal_grammar] || '',
    ``,
    `### Drama Budget`,
    `- Maximum ${params.drama_budget} major escalations allowed.`,
    `- Maximum 1 big reveal unless explicitly stated.`,
    `- Maximum 5 core characters.`,
    `- Maximum 3 major plot threads.`,
    `- Stakes must remain personal/relational until the final 20%.`,
    ``,
    `### Restraint Level: ${params.restraint}/100`,
    params.restraint >= 70
      ? `- Prefer understatement, implication, behavioral tells over explicit confrontation.`
      : params.restraint >= 40
        ? `- Balance direct conflict with subtext and restraint.`
        : `- Allow bold dramatic choices but ground them in character logic.`,
    ``,
    `### Required Elements`,
    `- At least 3 SUBTEXT SCENES: for each, specify what each character wants, what they won't say, what they say instead, their tactic, and the tell.`,
    `- At least 2 QUIET BEATS WITH TEETH: tension present but unexpressed, character revealed through behavior.`,
    `- At least 1 MEANING SHIFT per act: reinterpretation of existing information, no new facts needed.`,
    `- Opposition must be LEGITIMATE: values collision, systemic constraint, or reasonable disagreement — not evil mastermind.`,
    ``,
    `### Melodrama Translator`,
    `Convert any of these patterns to their adult equivalents:`,
    `- Screaming confession → withheld correction / loaded silence with consequence`,
    `- Physical threat → resource withdrawal / contract clause / social leverage`,
    `- Villain monologue → polite email / policy / bureaucratic language`,
    `- Sudden violence → reputational, financial, or procedural consequence`,
  ];

  if (params.anti_tropes.length > 0) {
    lines.push(``, `### Forbidden Tropes`);
    for (const t of params.anti_tropes) {
      lines.push(`- Do NOT use: ${t.replace(/_/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Ruleset Engine — Heuristic scoring (no LLM)
 */

const ABSOLUTE_WORDS = /\b(always|never|everything|nothing|only hope|impossible|forever|completely|utterly|total(ly)?)\b/gi;
const TWIST_KEYWORDS = /\b(reveals?|turns? out|secretly|suddenly|betrayal|double.?cross|shocking|plot twist|unmasked|all along)\b/gi;
const CONSPIRACY_MARKERS = /\b(organization|conspiracy|shadow|syndicate|cabal|secret society|hidden agenda|puppet master|pulling the strings)\b/gi;
const SHOCK_EVENTS = /\b(kidnap|murder|explosion|assassin|bomb|massacre|hostage|poisoned?|gunshot|stabbed?)\b/gi;
const LONG_SPEECH_RE = /["'](.*?)["']/gs;
const SUBTEXT_MARKERS = /\b(subtext|unspoken|withheld|won't say|say instead|tactic|tell|beneath the surface|underlying)\b/gi;
const QUIET_BEAT_MARKERS = /\b(silence|pause|stillness|quiet moment|breath|contemplat|reflect|stare|sit with)\b/gi;
const MEANING_SHIFT_MARKERS = /\b(reinterpret|re-?read|new light|different meaning|realize|understand now|see differently|meaning shift|changes everything we thought)\b/gi;
const ANTAGONIST_LEGITIMACY = /\b(legitimate|valid point|understandable|reasonable|their perspective|from their view|not wrong|has a point)\b/gi;
const COST_MARKERS = /\b(cost|price|consequence|sacrifice|trade-?off|lose|risk|penalty|repercussion|fallout)\b/gi;
const FACTION_MARKERS = /\b(faction|group|alliance|coalition|clan|family|house|organization|agency|department|team|side)\b/gi;
const THREAD_MARKERS = /\b(meanwhile|subplot|thread|strand|parallel|B-story|C-story|side plot)\b/gi;
const CHARACTER_INTRO = /\b(introduce|introducing|we meet|enter|arrives?|new character|first appearance)\b/gi;

export interface RulesetMetrics {
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

function countMatches(text: string, regex: RegExp): number {
  return (text.match(regex) || []).length;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function computeRulesetMetrics(text: string): RulesetMetrics {
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
    conspiracy_markers: countMatches(text, CONSPIRACY_MARKERS),
    shock_events_early: countMatches(earlyPortion, SHOCK_EVENTS),
    speech_length_proxy: longSpeeches.length,
    named_factions: countMatches(text, FACTION_MARKERS),
    plot_thread_count: countMatches(text, THREAD_MARKERS),
    new_character_density: countMatches(text, CHARACTER_INTRO) / Math.max(1, words / 1000),
    subtext_scene_count: countMatches(text, SUBTEXT_MARKERS),
    quiet_beats_count: countMatches(text, QUIET_BEAT_MARKERS),
    meaning_shift_count: countMatches(text, MEANING_SHIFT_MARKERS),
    antagonist_legitimacy: countMatches(text, ANTAGONIST_LEGITIMACY) > 0,
    cost_of_action_markers: countMatches(text, COST_MARKERS),
  };
}

export function computeRulesetMelodramaScore(m: RulesetMetrics): number {
  let score = 0;
  score += Math.min(1, m.absolute_words_rate / 10) * 0.2;
  score += Math.min(1, m.twist_keyword_rate / 8) * 0.2;
  score += Math.min(1, m.conspiracy_markers / 5) * 0.15;
  score += Math.min(1, m.shock_events_early / 3) * 0.2;
  score += Math.min(1, m.speech_length_proxy / 4) * 0.1;
  score += Math.min(1, m.named_factions / 8) * 0.15;
  return Math.min(1, Math.max(0, score));
}

export function computeRulesetNuanceScore(m: RulesetMetrics): number {
  let score = 0;
  score += Math.min(1, m.subtext_scene_count / 3) * 0.25;
  score += Math.min(1, m.quiet_beats_count / 2) * 0.2;
  score += Math.min(1, m.meaning_shift_count) * 0.2;
  score += m.antagonist_legitimacy ? 0.15 : 0;
  score += Math.min(1, m.cost_of_action_markers / 2) * 0.1;
  const lowMelodrama = 1 - Math.min(1, (m.twist_keyword_rate + m.conspiracy_markers) / 10);
  score += lowMelodrama * 0.1;
  return Math.min(1, Math.max(0, score));
}

/**
 * Detect forbidden moves present in text.
 */
export function detectForbiddenMoves(text: string, forbidden: string[]): string[] {
  const lower = text.toLowerCase();
  return forbidden.filter(move => {
    const pattern = move.replace(/_/g, '[_ ]?');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(lower);
  });
}

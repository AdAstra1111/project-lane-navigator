import { describe, it, expect } from 'vitest';

// We can't import Deno edge function modules directly, so we inline the core logic for testing.
// These functions mirror supabase/functions/_shared/styleDeviation.ts exactly.

// ── Inline core functions for testing ──

const CHARACTER_CUE_RE = /^\s{10,}[A-Z][A-Z\s.''`\-]{1,40}(?:\s*\(.*\))?\s*$/;
const SLUGLINE_RE = /^\s*(?:\d+\s+)?(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;
const PARENTHETICAL_RE = /^\s*\(.*\)\s*$/;

const SUBTEXT_MARKERS = [
  "...", "(beat)", "looks", "hesitates", "pauses", "silence",
  "glances", "trails off", "unspoken", "almost", "barely",
];
const HUMOR_MARKERS = [
  "laughs", "joke", "winks", "smirks", "deadpan", "sarcastic",
  "ironic", "dry", "chuckles", "grins", "quips", "wry",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function countPer1k(text: string, patterns: string[]): number {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).length || 1;
  let count = 0;
  for (const p of patterns) {
    let idx = 0;
    const pl = p.toLowerCase();
    while ((idx = lower.indexOf(pl, idx)) !== -1) { count++; idx += pl.length; }
  }
  return Math.round((count / words) * 1000 * 100) / 100;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

type Density = "low" | "medium" | "high";
type DriftLevel = "low" | "medium" | "high";

interface StyleFingerprint {
  char_count: number; line_count: number; avg_line_len: number;
  sentence_count: number; avg_sentence_len: number;
  sentence_len_p50: number; sentence_len_p90: number;
  dialogue_ratio: number; caps_character_cues: number;
  parenthetical_count: number; action_line_ratio: number;
  description_density: Density;
  subtext_markers_per_1k: number; humor_markers_per_1k: number;
  punctuation_profile: { ellipses_per_1k: number; dashes_per_1k: number; exclam_per_1k: number; question_per_1k: number };
  lexical_variety: number;
}

interface StyleTarget {
  dialogue_ratio?: number;
  sentence_len_band?: [number, number];
  description_density?: Density;
  subtext_level?: "low" | "medium" | "high";
  humor_temperature?: "none" | "light" | "witty" | "high";
  pace?: "calm" | "standard" | "punchy";
  voice_source: "team_voice" | "writing_voice" | "none";
}

function extractFingerprint(text: string): StyleFingerprint {
  if (!text || text.length === 0) {
    return {
      char_count: 0, line_count: 0, avg_line_len: 0,
      sentence_count: 0, avg_sentence_len: 0, sentence_len_p50: 0, sentence_len_p90: 0,
      dialogue_ratio: 0, caps_character_cues: 0, parenthetical_count: 0, action_line_ratio: 0,
      description_density: "low", subtext_markers_per_1k: 0, humor_markers_per_1k: 0,
      punctuation_profile: { ellipses_per_1k: 0, dashes_per_1k: 0, exclam_per_1k: 0, question_per_1k: 0 },
      lexical_variety: 0,
    };
  }
  const lines = text.split("\n");
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const totalNonEmpty = nonEmptyLines.length || 1;

  const lineLens = nonEmptyLines.map(l => l.trim().length);
  const avgLineLen = lineLens.length > 0 ? Math.round((lineLens.reduce((a, b) => a + b, 0) / lineLens.length) * 10) / 10 : 0;

  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 2);
  const sentenceLens = sentences.map(s => s.trim().split(/\s+/).length).sort((a, b) => a - b);
  const avgSentenceLen = sentenceLens.length > 0 ? Math.round((sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length) * 10) / 10 : 0;

  let dialogueLines = 0, capsCharCues = 0, parentheticalCount = 0, inDialogue = false;
  for (const line of lines) {
    if (CHARACTER_CUE_RE.test(line)) { capsCharCues++; inDialogue = true; continue; }
    if (PARENTHETICAL_RE.test(line.trim())) { parentheticalCount++; continue; }
    if (inDialogue) {
      const trimmed = line.trim();
      if (trimmed === "" || SLUGLINE_RE.test(line)) { inDialogue = false; }
      else if (!trimmed.startsWith("(")) { dialogueLines++; }
    }
  }

  const dialogueRatio = Math.round((dialogueLines / totalNonEmpty) * 1000) / 1000;
  const actionLines = totalNonEmpty - dialogueLines - capsCharCues - parentheticalCount;
  const actionLineRatio = Math.round((Math.max(0, actionLines) / totalNonEmpty) * 1000) / 1000;

  let descriptionDensity: Density = "medium";
  if (avgSentenceLen > 18 && actionLineRatio > 0.55) descriptionDensity = "high";
  else if (avgSentenceLen < 12 || dialogueRatio > 0.6) descriptionDensity = "low";

  const subtextPer1k = countPer1k(text, SUBTEXT_MARKERS);
  const humorPer1k = countPer1k(text, HUMOR_MARKERS);

  const words = text.split(/\s+/).length || 1;
  const wordTokens = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 1000);
  const uniqueWords = new Set(wordTokens);

  return {
    char_count: text.length,
    line_count: lines.length,
    avg_line_len: avgLineLen,
    sentence_count: sentences.length,
    avg_sentence_len: avgSentenceLen,
    sentence_len_p50: percentile(sentenceLens, 50),
    sentence_len_p90: percentile(sentenceLens, 90),
    dialogue_ratio: dialogueRatio,
    caps_character_cues: capsCharCues,
    parenthetical_count: parentheticalCount,
    action_line_ratio: actionLineRatio,
    description_density: descriptionDensity,
    subtext_markers_per_1k: subtextPer1k,
    humor_markers_per_1k: humorPer1k,
    punctuation_profile: {
      ellipses_per_1k: Math.round(((text.match(/\.{3}/g) || []).length / words) * 1000 * 100) / 100,
      dashes_per_1k: Math.round(((text.match(/[—–-]{2,}|—/g) || []).length / words) * 1000 * 100) / 100,
      exclam_per_1k: Math.round(((text.match(/!/g) || []).length / words) * 1000 * 100) / 100,
      question_per_1k: Math.round(((text.match(/\?/g) || []).length / words) * 1000 * 100) / 100,
    },
    lexical_variety: wordTokens.length > 0 ? Math.round((uniqueWords.size / wordTokens.length) * 1000) / 1000 : 0,
  };
}

function inferPace(fp: StyleFingerprint): "calm" | "standard" | "punchy" {
  if (fp.avg_sentence_len < 10 && fp.dialogue_ratio > 0.35) return "punchy";
  if (fp.avg_sentence_len > 16 && fp.dialogue_ratio < 0.25) return "calm";
  return "standard";
}

function inferHumor(humorPer1k: number): "none" | "light" | "witty" | "high" {
  if (humorPer1k < 0.5) return "none";
  if (humorPer1k < 2) return "light";
  if (humorPer1k < 5) return "witty";
  return "high";
}

function inferSubtext(subtextPer1k: number): "low" | "medium" | "high" {
  if (subtextPer1k < 1) return "low";
  if (subtextPer1k < 4) return "medium";
  return "high";
}

function computeDeviation(fp: StyleFingerprint, target: StyleTarget): { score: number; drift_level: DriftLevel; deltas: Record<string, any>; top_3_drivers: string[] } {
  if (target.voice_source === "none") return { score: 1, drift_level: "low", deltas: {}, top_3_drivers: [] };
  const penalties: Array<{ name: string; penalty: number; detail: string }> = [];

  if (target.dialogue_ratio != null) {
    const diff = Math.abs(fp.dialogue_ratio - target.dialogue_ratio);
    const penalty = clamp(diff / 0.25) * 0.25;
    if (penalty > 0.01) penalties.push({ name: "dialogue_ratio", penalty, detail: `target=${target.dialogue_ratio}, actual=${fp.dialogue_ratio}` });
  }
  if (target.sentence_len_band) {
    const [lo, hi] = target.sentence_len_band;
    let distance = 0;
    if (fp.avg_sentence_len < lo) distance = lo - fp.avg_sentence_len;
    else if (fp.avg_sentence_len > hi) distance = fp.avg_sentence_len - hi;
    const penalty = clamp(distance / 10) * 0.20;
    if (penalty > 0.01) penalties.push({ name: "sentence_len", penalty, detail: `target=[${lo},${hi}], actual=${fp.avg_sentence_len}` });
  }
  if (target.description_density && target.description_density !== fp.description_density) {
    penalties.push({ name: "description_density", penalty: 0.12, detail: `target=${target.description_density}, actual=${fp.description_density}` });
  }
  if (target.pace) {
    const paceMatch = inferPace(fp);
    if (paceMatch !== target.pace) penalties.push({ name: "pace", penalty: 0.12, detail: `target=${target.pace}, actual=${paceMatch}` });
  }
  if (target.humor_temperature) {
    const humorMatch = inferHumor(fp.humor_markers_per_1k);
    if (humorMatch !== target.humor_temperature) penalties.push({ name: "humor_temperature", penalty: 0.08, detail: `target=${target.humor_temperature}, actual=${humorMatch}` });
  }
  if (target.subtext_level) {
    const subtextMatch = inferSubtext(fp.subtext_markers_per_1k);
    if (subtextMatch !== target.subtext_level) penalties.push({ name: "subtext_level", penalty: 0.08, detail: `target=${target.subtext_level}, actual=${subtextMatch}` });
  }

  const totalPenalty = penalties.reduce((s, p) => s + p.penalty, 0);
  const score = Math.round(clamp(1 - totalPenalty, 0, 1) * 100) / 100;
  const drift_level: DriftLevel = score >= 0.80 ? "low" : score >= 0.60 ? "medium" : "high";
  const sorted = [...penalties].sort((a, b) => b.penalty - a.penalty);
  const top_3_drivers = sorted.slice(0, 3).map(p => `${p.name}: ${p.detail}`);
  const deltas: Record<string, any> = {};
  for (const p of penalties) deltas[p.name] = { penalty: p.penalty, detail: p.detail };
  deltas.top_3_drivers = top_3_drivers;
  return { score, drift_level, deltas, top_3_drivers };
}

function selectBestAttempt(a0: number, a1: number): 0 | 1 {
  if (a1 > a0) return 1;
  if (a0 < 0.60 && a1 >= 0.60) return 1;
  return 0;
}

// ── Tests ──

describe('extractFingerprint', () => {
  it('returns empty fingerprint for empty text', () => {
    const fp = extractFingerprint('');
    expect(fp.char_count).toBe(0);
    expect(fp.dialogue_ratio).toBe(0);
  });

  it('extracts dialogue ratio from screenplay snippet', () => {
    const script = `INT. COFFEE SHOP - DAY

Sarah enters and sits down.

            SARAH
Hey, what are you doing here?

            MARK
Just waiting for you.

Sarah smiles.`;
    const fp = extractFingerprint(script);
    expect(fp.caps_character_cues).toBe(2);
    expect(fp.dialogue_ratio).toBeGreaterThan(0);
    expect(fp.dialogue_ratio).toBeLessThan(1);
  });

  it('computes sentence stats', () => {
    const text = 'Short one. Another short. This is a medium length sentence here. And this is quite a long sentence that goes on and on forever.';
    const fp = extractFingerprint(text);
    expect(fp.sentence_count).toBeGreaterThanOrEqual(3);
    expect(fp.avg_sentence_len).toBeGreaterThan(0);
    expect(fp.sentence_len_p50).toBeGreaterThan(0);
  });

  it('detects description density', () => {
    // Short sentences, high dialogue → low density
    const dialogueHeavy = `            ALICE
Hi.

            BOB
Hi.

            ALICE
How are you?

            BOB
Fine.`;
    const fp = extractFingerprint(dialogueHeavy);
    expect(fp.description_density).toBe('low');
  });
});

describe('computeDeviation', () => {
  it('returns score 1 for voice_source=none', () => {
    const fp = extractFingerprint('Some text here.');
    const result = computeDeviation(fp, { voice_source: 'none' });
    expect(result.score).toBe(1);
    expect(result.drift_level).toBe('low');
  });

  it('penalizes dialogue ratio mismatch', () => {
    const fp = extractFingerprint('Simple prose text with no dialogue at all. More prose here.');
    const result = computeDeviation(fp, {
      voice_source: 'team_voice',
      dialogue_ratio: 0.5,
    });
    expect(result.score).toBeLessThan(1);
    expect(result.deltas.dialogue_ratio).toBeDefined();
  });

  it('penalizes sentence length outside band', () => {
    const fp = extractFingerprint('Short. Very short. Tiny.');
    const result = computeDeviation(fp, {
      voice_source: 'team_voice',
      sentence_len_band: [15, 20],
    });
    expect(result.score).toBeLessThan(1);
  });

  it('drift level thresholds work correctly', () => {
    const fp = extractFingerprint('Simple text.');
    // With many penalties stacked, should get high drift
    const result = computeDeviation(fp, {
      voice_source: 'team_voice',
      dialogue_ratio: 0.8,
      sentence_len_band: [20, 30],
      description_density: 'high',
      pace: 'calm',
      humor_temperature: 'high',
      subtext_level: 'high',
    });
    expect(result.drift_level).toBe('high');
    expect(result.score).toBeLessThan(0.60);
  });
});

describe('selectBestAttempt', () => {
  it('chooses attempt1 when it scores higher', () => {
    expect(selectBestAttempt(0.5, 0.7)).toBe(1);
  });

  it('keeps attempt0 when attempt1 is worse', () => {
    expect(selectBestAttempt(0.8, 0.6)).toBe(0);
  });

  it('chooses attempt1 when a0 < 0.60 and a1 >= 0.60', () => {
    expect(selectBestAttempt(0.55, 0.60)).toBe(1);
  });

  it('keeps attempt0 when both below 0.60 and a0 >= a1', () => {
    expect(selectBestAttempt(0.55, 0.50)).toBe(0);
  });
});

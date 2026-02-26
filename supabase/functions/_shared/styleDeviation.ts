/**
 * Style Deviation Engine v1.0
 * Deterministic fingerprint extraction + deviation scoring.
 * No LLM calls — pure heuristics.
 */

export const STYLE_ENGINE_VERSION = "v1.0";

// ── Types ────────────────────────────────────────────────────────────

export interface StyleFingerprint {
  char_count: number;
  line_count: number;
  avg_line_len: number;
  sentence_count: number;
  avg_sentence_len: number;
  sentence_len_p50: number;
  sentence_len_p90: number;
  dialogue_ratio: number;
  caps_character_cues: number;
  parenthetical_count: number;
  action_line_ratio: number;
  description_density: "low" | "medium" | "high";
  subtext_markers_per_1k: number;
  humor_markers_per_1k: number;
  punctuation_profile: {
    ellipses_per_1k: number;
    dashes_per_1k: number;
    exclam_per_1k: number;
    question_per_1k: number;
  };
  lexical_variety: number;
}

export interface StyleTarget {
  dialogue_ratio?: number;
  sentence_len_band?: [number, number];
  description_density?: "low" | "medium" | "high";
  subtext_level?: "low" | "medium" | "high";
  humor_temperature?: "none" | "light" | "witty" | "high";
  pace?: "calm" | "standard" | "punchy";
  tone_tags?: string[];
  voice_source: "team_voice" | "writing_voice" | "none";
  voice_id?: string;
  voice_label?: string;
}

export interface StyleDeviation {
  score: number;
  drift_level: "low" | "medium" | "high";
  deltas: Record<string, any>;
  top_3_drivers: string[];
}

export interface StyleEvalResult {
  score: number;
  drift_level: "low" | "medium" | "high";
  fingerprint: StyleFingerprint;
  target: StyleTarget;
  deltas: Record<string, any>;
  evaluated_at: string;
  engine_version: string;
  voice_source: string;
}

// ── Constants ────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────

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
    while ((idx = lower.indexOf(pl, idx)) !== -1) {
      count++;
      idx += pl.length;
    }
  }
  return Math.round((count / words) * 1000 * 100) / 100;
}

// ── Fingerprint Extraction ───────────────────────────────────────────

export function extractFingerprint(text: string): StyleFingerprint {
  if (!text || text.length === 0) {
    return emptyFingerprint();
  }

  const lines = text.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const totalNonEmpty = nonEmptyLines.length || 1;
  const charCount = text.length;

  // Line lengths
  const lineLens = nonEmptyLines.map((l) => l.trim().length);
  const avgLineLen = lineLens.length > 0
    ? Math.round((lineLens.reduce((a, b) => a + b, 0) / lineLens.length) * 10) / 10
    : 0;

  // Sentences
  const sentences = text
    .split(/[.!?]+(?:\s|$)/)
    .filter((s) => s.trim().length > 2);
  const sentenceLens = sentences
    .map((s) => s.trim().split(/\s+/).length)
    .sort((a, b) => a - b);
  const avgSentenceLen = sentenceLens.length > 0
    ? Math.round(
        (sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length) * 10,
      ) / 10
    : 0;

  // Dialogue detection
  let dialogueLines = 0;
  let capsCharCues = 0;
  let parentheticalCount = 0;
  let inDialogue = false;

  for (const line of lines) {
    if (CHARACTER_CUE_RE.test(line)) {
      capsCharCues++;
      inDialogue = true;
      continue;
    }
    if (PARENTHETICAL_RE.test(line.trim())) {
      parentheticalCount++;
      continue;
    }
    if (inDialogue) {
      const trimmed = line.trim();
      if (trimmed === "" || SLUGLINE_RE.test(line)) {
        inDialogue = false;
      } else if (!trimmed.startsWith("(")) {
        dialogueLines++;
      }
    }
  }

  const dialogueRatio =
    Math.round((dialogueLines / totalNonEmpty) * 1000) / 1000;
  const actionLines = totalNonEmpty - dialogueLines - capsCharCues - parentheticalCount;
  const actionLineRatio =
    Math.round((Math.max(0, actionLines) / totalNonEmpty) * 1000) / 1000;

  // Description density
  let descriptionDensity: "low" | "medium" | "high" = "medium";
  if (avgSentenceLen > 18 && actionLineRatio > 0.55) descriptionDensity = "high";
  else if (avgSentenceLen < 12 || dialogueRatio > 0.6) descriptionDensity = "low";

  // Marker counts
  const subtextPer1k = countPer1k(text, SUBTEXT_MARKERS);
  const humorPer1k = countPer1k(text, HUMOR_MARKERS);

  // Punctuation profile
  const words = text.split(/\s+/).length || 1;
  const ellipsesCount = (text.match(/\.{3}/g) || []).length;
  const dashesCount = (text.match(/[—–-]{2,}|—/g) || []).length;
  const exclamCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;

  // Lexical variety (simple type-token ratio on first 1000 words)
  const wordTokens = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 1000);
  const uniqueWords = new Set(wordTokens);
  const lexicalVariety = wordTokens.length > 0
    ? Math.round((uniqueWords.size / wordTokens.length) * 1000) / 1000
    : 0;

  return {
    char_count: charCount,
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
      ellipses_per_1k: Math.round((ellipsesCount / words) * 1000 * 100) / 100,
      dashes_per_1k: Math.round((dashesCount / words) * 1000 * 100) / 100,
      exclam_per_1k: Math.round((exclamCount / words) * 1000 * 100) / 100,
      question_per_1k: Math.round((questionCount / words) * 1000 * 100) / 100,
    },
    lexical_variety: lexicalVariety,
  };
}

function emptyFingerprint(): StyleFingerprint {
  return {
    char_count: 0, line_count: 0, avg_line_len: 0,
    sentence_count: 0, avg_sentence_len: 0,
    sentence_len_p50: 0, sentence_len_p90: 0,
    dialogue_ratio: 0, caps_character_cues: 0,
    parenthetical_count: 0, action_line_ratio: 0,
    description_density: "low",
    subtext_markers_per_1k: 0, humor_markers_per_1k: 0,
    punctuation_profile: { ellipses_per_1k: 0, dashes_per_1k: 0, exclam_per_1k: 0, question_per_1k: 0 },
    lexical_variety: 0,
  };
}

// ── Target Builder ───────────────────────────────────────────────────

export function buildTargetFromTeamVoice(profile: any, voiceId: string, voiceLabel: string): StyleTarget {
  const knobs = profile?.knobs || {};
  return {
    dialogue_ratio: typeof knobs.dialogue_ratio === "number" ? knobs.dialogue_ratio : undefined,
    sentence_len_band: Array.isArray(knobs.sentence_len_band) ? knobs.sentence_len_band : undefined,
    description_density: knobs.description_density || undefined,
    subtext_level: knobs.subtext_level || undefined,
    humor_temperature: knobs.humor_temperature || undefined,
    pace: knobs.pace || undefined,
    tone_tags: knobs.tone_tags || undefined,
    voice_source: "team_voice",
    voice_id: voiceId,
    voice_label: voiceLabel,
  };
}

export function buildTargetFromWritingVoice(preset: any): StyleTarget {
  const knobs = preset?.knobs || {};
  const constraints = preset?.constraints || {};
  return {
    dialogue_ratio: constraints.dialogue_ratio_band
      ? (constraints.dialogue_ratio_band[0] + constraints.dialogue_ratio_band[1]) / 2
      : undefined,
    sentence_len_band: constraints.sentence_len_band || undefined,
    description_density: knobs.prose_density > 7 ? "high" : knobs.prose_density < 4 ? "low" : "medium",
    subtext_level: knobs.subtext > 7 ? "high" : knobs.subtext < 4 ? "low" : "medium",
    humor_temperature: undefined,
    pace: knobs.hook_intensity > 7 ? "punchy" : knobs.hook_intensity < 4 ? "calm" : "standard",
    voice_source: "writing_voice",
    voice_id: preset?.id,
    voice_label: preset?.label,
  };
}

// ── Deviation Scorer ─────────────────────────────────────────────────

export function computeDeviation(
  fingerprint: StyleFingerprint,
  target: StyleTarget,
): StyleDeviation {
  if (target.voice_source === "none") {
    return { score: 1, drift_level: "low", deltas: {}, top_3_drivers: [] };
  }

  const penalties: Array<{ name: string; penalty: number; detail: string }> = [];

  // Dialogue ratio
  if (target.dialogue_ratio != null) {
    const diff = Math.abs(fingerprint.dialogue_ratio - target.dialogue_ratio);
    const penalty = clamp(diff / 0.25) * 0.25;
    if (penalty > 0.01) {
      penalties.push({
        name: "dialogue_ratio",
        penalty,
        detail: `target=${target.dialogue_ratio}, actual=${fingerprint.dialogue_ratio}`,
      });
    }
  }

  // Sentence length band
  if (target.sentence_len_band) {
    const [lo, hi] = target.sentence_len_band;
    const avg = fingerprint.avg_sentence_len;
    let distance = 0;
    if (avg < lo) distance = lo - avg;
    else if (avg > hi) distance = avg - hi;
    const penalty = clamp(distance / 10) * 0.20;
    if (penalty > 0.01) {
      penalties.push({
        name: "sentence_len",
        penalty,
        detail: `target=[${lo},${hi}], actual=${avg}`,
      });
    }
  }

  // Description density
  if (target.description_density && target.description_density !== fingerprint.description_density) {
    penalties.push({
      name: "description_density",
      penalty: 0.12,
      detail: `target=${target.description_density}, actual=${fingerprint.description_density}`,
    });
  }

  // Pace
  if (target.pace) {
    const paceMatch = inferPace(fingerprint);
    if (paceMatch !== target.pace) {
      penalties.push({
        name: "pace",
        penalty: 0.12,
        detail: `target=${target.pace}, actual=${paceMatch}`,
      });
    }
  }

  // Humor temperature
  if (target.humor_temperature) {
    const humorMatch = inferHumor(fingerprint.humor_markers_per_1k);
    if (humorMatch !== target.humor_temperature) {
      penalties.push({
        name: "humor_temperature",
        penalty: 0.08,
        detail: `target=${target.humor_temperature}, actual=${humorMatch}`,
      });
    }
  }

  // Subtext level
  if (target.subtext_level) {
    const subtextMatch = inferSubtext(fingerprint.subtext_markers_per_1k);
    if (subtextMatch !== target.subtext_level) {
      penalties.push({
        name: "subtext_level",
        penalty: 0.08,
        detail: `target=${target.subtext_level}, actual=${subtextMatch}`,
      });
    }
  }

  const totalPenalty = penalties.reduce((s, p) => s + p.penalty, 0);
  const score = Math.round(clamp(1 - totalPenalty, 0, 1) * 100) / 100;
  const drift_level: "low" | "medium" | "high" =
    score >= 0.80 ? "low" : score >= 0.60 ? "medium" : "high";

  // Top drivers
  const sorted = [...penalties].sort((a, b) => b.penalty - a.penalty);
  const top_3_drivers = sorted.slice(0, 3).map((p) => `${p.name}: ${p.detail}`);

  const deltas: Record<string, any> = {};
  for (const p of penalties) {
    deltas[p.name] = { penalty: p.penalty, detail: p.detail };
  }
  deltas.top_3_drivers = top_3_drivers;

  return { score, drift_level, deltas, top_3_drivers };
}

// ── Repair Selection ─────────────────────────────────────────────────

export function selectBestAttempt(
  attempt0Score: number,
  attempt1Score: number,
): 0 | 1 {
  // Use attempt1 if it improved, or if attempt0 was <0.60 and attempt1 >=0.60
  if (attempt1Score > attempt0Score) return 1;
  if (attempt0Score < 0.60 && attempt1Score >= 0.60) return 1;
  return 0;
}

// ── Build style repair prompt ────────────────────────────────────────

export function buildStyleRepairPrompt(
  target: StyleTarget,
  deviation: StyleDeviation,
): string {
  const lines: string[] = [];
  lines.push("=== STYLE REPAIR INSTRUCTIONS ===");
  lines.push("The generated text drifts from the target writing style. Adjust expression ONLY — preserve story meaning.");
  lines.push("");

  if (target.dialogue_ratio != null) {
    lines.push(`Target dialogue ratio: ${target.dialogue_ratio}`);
  }
  if (target.sentence_len_band) {
    lines.push(`Target sentence length band: ${target.sentence_len_band[0]}-${target.sentence_len_band[1]} words`);
  }
  if (target.description_density) {
    lines.push(`Target description density: ${target.description_density}`);
  }
  if (target.pace) {
    lines.push(`Target pace: ${target.pace}`);
  }
  if (target.humor_temperature) {
    lines.push(`Target humor level: ${target.humor_temperature}`);
  }
  if (target.subtext_level) {
    lines.push(`Target subtext level: ${target.subtext_level}`);
  }

  if (deviation.top_3_drivers.length > 0) {
    lines.push("");
    lines.push("Top deviations to fix:");
    for (const d of deviation.top_3_drivers) {
      lines.push(`  - ${d}`);
    }
  }

  lines.push("");
  lines.push("Rewrite the text to match these targets. Do NOT change plot, characters, or story events.");
  lines.push("=== END STYLE REPAIR ===");
  return lines.join("\n");
}

// ── Build meta_json summary ──────────────────────────────────────────

export function buildStyleEvalMeta(
  evalResult: StyleEvalResult,
): Record<string, any> {
  return {
    style_eval_summary: {
      score: evalResult.score,
      drift_level: evalResult.drift_level,
      voice_source: evalResult.voice_source,
      evaluated_at: evalResult.evaluated_at,
      engine_version: evalResult.engine_version,
    },
    style_eval: evalResult,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function inferPace(fp: StyleFingerprint): "calm" | "standard" | "punchy" {
  // Punchy = short sentences + high dialogue
  if (fp.avg_sentence_len < 10 && fp.dialogue_ratio > 0.35) return "punchy";
  // Calm = long sentences + low dialogue
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

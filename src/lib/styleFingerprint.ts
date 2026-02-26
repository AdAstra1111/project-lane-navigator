/**
 * Style Fingerprint — compute writing metrics from script text.
 * Used to derive a "writing style band" from selected reference scripts.
 */

export interface StyleMetrics {
  sentence_len_avg: number;
  sentence_len_p50: number;
  sentence_len_p90: number;
  dialogue_ratio: number;
  avg_dialogue_line_len: number;
  slugline_density: number; // per 100 lines
  word_count: number;
}

export interface StyleFingerprint {
  source: 'internal_scripts';
  sources: Array<{ doc_id: string; title: string; project_id: string }>;
  targets: {
    sentence_len_avg: { min: number; max: number };
    sentence_len_p50: { min: number; max: number };
    sentence_len_p90: { min: number; max: number };
    dialogue_ratio: { min: number; max: number };
    avg_dialogue_line_len: { min: number; max: number };
    slugline_density: { min: number; max: number };
  };
  rules: { do: string[]; dont: string[] };
  updated_at: string;
}

// ── Percentile helper ────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Slugline regex ───────────────────────────────────────────────────
const SLUGLINE_RE = /^\s*(?:\d+\s+)?(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;

// ── Dialogue heuristic ──────────────────────────────────────────────
// Character cue: line that is ALL CAPS (possibly with (V.O.), (O.S.), (CONT'D))
const CHARACTER_CUE_RE = /^\s{10,}[A-Z][A-Z\s.''`-]{1,40}(?:\s*\(.*\))?\s*$/;

/**
 * Compute writing style metrics from a single script's plaintext.
 */
export function computeMetrics(text: string): StyleMetrics {
  const lines = text.split('\n');
  const totalLines = lines.length || 1;

  // Sentences (split on . ! ? followed by space or end)
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 2);
  const sentenceLens = sentences.map(s => s.trim().split(/\s+/).length).sort((a, b) => a - b);

  const sentAvg = sentenceLens.length > 0
    ? sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length
    : 0;

  // Dialogue detection
  let dialogueLines = 0;
  let dialogueLineLens: number[] = [];
  let inDialogue = false;

  for (const line of lines) {
    if (CHARACTER_CUE_RE.test(line)) {
      inDialogue = true;
      continue;
    }
    if (inDialogue) {
      const trimmed = line.trim();
      if (trimmed === '' || SLUGLINE_RE.test(line)) {
        inDialogue = false;
      } else if (!trimmed.startsWith('(')) {
        // Actual dialogue line (not parenthetical)
        dialogueLines++;
        dialogueLineLens.push(trimmed.split(/\s+/).length);
      }
    }
  }

  // Slugline count
  const sluglineCount = lines.filter(l => SLUGLINE_RE.test(l)).length;

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    sentence_len_avg: Math.round(sentAvg * 10) / 10,
    sentence_len_p50: percentile(sentenceLens, 50),
    sentence_len_p90: percentile(sentenceLens, 90),
    dialogue_ratio: Math.round((dialogueLines / totalLines) * 1000) / 1000,
    avg_dialogue_line_len: dialogueLineLens.length > 0
      ? Math.round((dialogueLineLens.reduce((a, b) => a + b, 0) / dialogueLineLens.length) * 10) / 10
      : 0,
    slugline_density: Math.round((sluglineCount / totalLines) * 100 * 100) / 100,
    word_count: wordCount,
  };
}

/**
 * Build a style fingerprint from multiple scripts' metrics.
 */
export function buildFingerprint(
  metricsArr: StyleMetrics[],
  sources: Array<{ doc_id: string; title: string; project_id: string }>,
): StyleFingerprint {
  const band = (key: keyof StyleMetrics) => {
    const vals = metricsArr.map(m => m[key]);
    return { min: Math.round(Math.min(...vals) * 100) / 100, max: Math.round(Math.max(...vals) * 100) / 100 };
  };

  const targets = {
    sentence_len_avg: band('sentence_len_avg'),
    sentence_len_p50: band('sentence_len_p50'),
    sentence_len_p90: band('sentence_len_p90'),
    dialogue_ratio: band('dialogue_ratio'),
    avg_dialogue_line_len: band('avg_dialogue_line_len'),
    slugline_density: band('slugline_density'),
  };

  // Auto-generate do/don't rules from the band
  const rules = generateRules(targets);

  return {
    source: 'internal_scripts',
    sources,
    targets,
    rules,
    updated_at: new Date().toISOString(),
  };
}

function generateRules(targets: StyleFingerprint['targets']): { do: string[]; dont: string[] } {
  const doRules: string[] = [];
  const dontRules: string[] = [];

  // Dialogue ratio
  if (targets.dialogue_ratio.max > 0.35) {
    doRules.push('Keep dialogue-heavy scenes; aim for 35%+ dialogue content');
  } else if (targets.dialogue_ratio.max < 0.2) {
    doRules.push('Favor action/description over dialogue; keep dialogue under 20%');
  }

  // Sentence length
  if (targets.sentence_len_avg.max < 12) {
    doRules.push('Use short, punchy sentences (avg under 12 words)');
    dontRules.push('Avoid long compound sentences over 20 words');
  } else if (targets.sentence_len_avg.min > 15) {
    doRules.push('Use flowing, literary sentences (avg 15+ words)');
    dontRules.push('Avoid choppy one-word fragments as style');
  }

  // Dialogue line length
  if (targets.avg_dialogue_line_len.max < 8) {
    doRules.push('Keep dialogue lines sharp and brief (under 8 words avg)');
    dontRules.push('Avoid monologue-length dialogue lines');
  } else if (targets.avg_dialogue_line_len.min > 10) {
    doRules.push('Allow characters to speak in longer, more developed lines');
  }

  // Slugline density
  if (targets.slugline_density.max > 3) {
    doRules.push('Use frequent scene transitions (high slugline density)');
    dontRules.push('Avoid scenes that run longer than 2 pages without a transition');
  } else if (targets.slugline_density.max < 1.5) {
    doRules.push('Use extended scenes with fewer transitions');
  }

  // Pad to at least 3 each
  while (doRules.length < 3) doRules.push('Match the tonal register of the reference scripts');
  while (dontRules.length < 3) dontRules.push('Avoid deviating from the established pacing pattern');

  return { do: doRules.slice(0, 5), dont: dontRules.slice(0, 5) };
}

/**
 * Check compliance of generated text against a fingerprint.
 */
export function checkCompliance(
  text: string,
  fingerprint: StyleFingerprint,
): Array<{ metric: string; value: number; min: number; max: number; within: boolean; delta: string }> {
  const m = computeMetrics(text);
  const results: Array<{ metric: string; value: number; min: number; max: number; within: boolean; delta: string }> = [];

  const check = (label: string, value: number, band: { min: number; max: number }) => {
    const within = value >= band.min && value <= band.max;
    let delta = '';
    if (value < band.min) delta = `${Math.round((band.min - value) * 100) / 100} below min`;
    else if (value > band.max) delta = `${Math.round((value - band.max) * 100) / 100} above max`;
    results.push({ metric: label, value: Math.round(value * 100) / 100, min: band.min, max: band.max, within, delta });
  };

  check('Sentence Length (avg)', m.sentence_len_avg, fingerprint.targets.sentence_len_avg);
  check('Dialogue Ratio', m.dialogue_ratio, fingerprint.targets.dialogue_ratio);
  check('Avg Dialogue Line Len', m.avg_dialogue_line_len, fingerprint.targets.avg_dialogue_line_len);
  check('Slugline Density', m.slugline_density, fingerprint.targets.slugline_density);

  return results;
}

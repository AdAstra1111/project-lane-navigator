/**
 * Beat Sheet Scope Detection + Screenplay Format Validation
 * Used by vertical_drama pipeline to distinguish season-level vs episode-level beat sheets,
 * and to validate that generated scripts are actual formatted screenplays.
 */

// ── Beat Sheet Scope Detection ──

export interface BeatSheetScopeResult {
  scope: 'season' | 'episode' | 'unknown';
  confidence: number;
  signals: string[];
}

const SEASON_SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /episode\s*\d+\s*[:—\-]/gi, weight: 2, label: 'Episode headings found' },
  { pattern: /season\s*(arc|finale|premiere)/gi, weight: 2, label: 'Season-level language' },
  { pattern: /mid[- ]?season/gi, weight: 1.5, label: 'Mid-season reference' },
  { pattern: /across\s+the\s+season/gi, weight: 2, label: '"Across the season" phrase' },
  { pattern: /episodes?\s*\d+\s*[-–]\s*\d+/gi, weight: 2, label: 'Episode range mentioned' },
  { pattern: /finale/gi, weight: 1, label: 'Finale reference' },
];

const EPISODE_SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /cold\s*open/gi, weight: 2, label: 'Cold open reference' },
  { pattern: /hook\s*[:—\-]/gi, weight: 1.5, label: 'Hook beat' },
  { pattern: /cliffhanger\s*[:—\-]/gi, weight: 1.5, label: 'Cliffhanger beat' },
  { pattern: /^(INT\.|EXT\.)/gm, weight: 2, label: 'Scene headings present' },
  { pattern: /beat\s*\d+\s*[:—\-]/gi, weight: 1, label: 'Numbered beats' },
];

export function detectBeatSheetScope(text: string): BeatSheetScopeResult {
  if (!text || text.length < 50) {
    return { scope: 'unknown', confidence: 0, signals: ['Text too short to determine scope'] };
  }

  let seasonScore = 0;
  let episodeScore = 0;
  const signals: string[] = [];

  // Check season signals
  for (const s of SEASON_SIGNALS) {
    const matches = text.match(s.pattern);
    if (matches && matches.length > 0) {
      seasonScore += s.weight * Math.min(matches.length, 3);
      signals.push(`Season: ${s.label} (×${matches.length})`);
    }
  }

  // Check episode signals
  for (const s of EPISODE_SIGNALS) {
    const matches = text.match(s.pattern);
    if (matches && matches.length > 0) {
      episodeScore += s.weight * Math.min(matches.length, 3);
      signals.push(`Episode: ${s.label} (×${matches.length})`);
    }
  }

  // Beat count heuristic: >25 beats without scene headings → season-level
  const beatLines = text.split('\n').filter(l => /^[\-•\*]\s/.test(l.trim()) || /^\d+[\.\)]\s/.test(l.trim()));
  if (beatLines.length > 25) {
    const sceneHeadings = (text.match(/^(INT\.|EXT\.)/gm) || []).length;
    if (sceneHeadings < 3) {
      seasonScore += 2;
      signals.push(`Season: ${beatLines.length} beats without scene-level granularity`);
    }
  }

  // Multiple "Episode X" headings → strong season signal
  const episodeHeadings = text.match(/episode\s*\d+\s*[:—\-]/gi) || [];
  if (episodeHeadings.length >= 3) {
    seasonScore += 3;
    signals.push(`Season: ${episodeHeadings.length} distinct episode headings`);
  }

  // Decision
  const gap = seasonScore - episodeScore;
  let scope: BeatSheetScopeResult['scope'];
  if (gap >= 2) scope = 'season';
  else if (gap <= -2) scope = 'episode';
  else scope = 'unknown';

  const totalScore = seasonScore + episodeScore;
  const confidence = totalScore === 0 ? 0 : Math.min(100, Math.round((Math.abs(gap) / Math.max(totalScore, 1)) * 100));

  return { scope, confidence, signals };
}

// ── Screenplay Format Validation ──

export interface ScreenplayValidationResult {
  passed: boolean;
  sceneHeadingCount: number;
  dialogueBlockCount: number;
  outlineLinePercent: number;
  bannedPhrases: string[];
  reasons: string[];
}

const BANNED_PHRASES = [
  'overview',
  'synopsis',
  'in this episode',
  'across the season',
  'season overview',
  'episode summary',
];

export function validateScreenplayFormat(text: string): ScreenplayValidationResult {
  const lines = text.split('\n');
  const totalLines = lines.length;

  // Count scene headings
  const sceneHeadingPattern = /^(INT\.|EXT\.|INT\.\/?EXT\.)\s+/;
  const sceneHeadingCount = lines.filter(l => sceneHeadingPattern.test(l.trim())).length;

  // Count dialogue blocks (character name in CAPS followed by dialogue)
  let dialogueBlockCount = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    // Character cue: all caps, 2-30 chars, possibly with (V.O.) etc
    if (/^[A-Z][A-Z\s.']{1,29}(\s*\(.*\))?\s*$/.test(line) && lines[i + 1]?.trim().length > 0) {
      dialogueBlockCount++;
    }
  }

  // Outline-style lines (starting with - or numbered)
  const outlineLines = lines.filter(l => /^\s*[-•*]\s/.test(l) || /^\s*\d+[\.\)]\s/.test(l));
  const outlineLinePercent = totalLines > 0 ? Math.round((outlineLines.length / totalLines) * 100) : 0;

  // Banned phrases
  const lowerText = text.toLowerCase();
  const foundBanned = BANNED_PHRASES.filter(p => lowerText.includes(p));

  // Evaluate
  const reasons: string[] = [];
  let passed = true;

  if (sceneHeadingCount < 6) {
    reasons.push(`Only ${sceneHeadingCount} scene headings (minimum 6 required)`);
    passed = false;
  }
  if (dialogueBlockCount < 12) {
    reasons.push(`Only ${dialogueBlockCount} dialogue blocks (minimum 12 required)`);
    passed = false;
  }
  if (outlineLinePercent > 8) {
    reasons.push(`${outlineLinePercent}% of lines are outline-style (max 8% allowed)`);
    passed = false;
  }
  if (foundBanned.length > 0) {
    reasons.push(`Banned phrases found: ${foundBanned.join(', ')}`);
    passed = false;
  }

  return { passed, sceneHeadingCount, dialogueBlockCount, outlineLinePercent, bannedPhrases: foundBanned, reasons };
}

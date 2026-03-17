/**
 * Input Intelligence Layer — Deterministic, rule-driven suggestion engine
 * for must_include, avoid, and additional_direction fields.
 *
 * All suggestions are:
 * - visible & editable by the user
 * - non-canonical (never enter canon_json or drift enforcement)
 * - deterministic (same inputs → same outputs)
 */

// ── Types ────────────────────────────────────────────────────────────

export interface InputSuggestions {
  mustInclude: string[];
  avoid: string[];
  additionalDirection: string;
}

interface SuggestionContext {
  productionType: string;
  genre: string;
  subgenre: string;
  budgetBand: string;
  lane: string;
  toneAnchor: string;
  settingType: string;
  riskLevel: string;
  audience: string;
  worldPopulationDensity?: string;
}

// ── Pattern Library (tagged by lane, budget, tone) ───────────────────

interface MustIncludePattern {
  label: string;
  lanes: string[];       // empty = all lanes
  budgets: string[];     // empty = all budgets
  tones: string[];       // empty = all tones
  genres: string[];      // empty = all genres
  ciWeight: number;      // 0-10 contribution to CI
  gpWeight: number;      // 0-10 contribution to GP
}

const MUST_INCLUDE_PATTERNS: MustIncludePattern[] = [
  // Universal high-value structural constraints
  { label: 'Clear protagonist objective with personal stakes from scene one', lanes: [], budgets: [], tones: [], genres: [], ciWeight: 9, gpWeight: 8 },
  { label: 'Defined power structure or institutional system that shapes the world', lanes: [], budgets: [], tones: [], genres: [], ciWeight: 8, gpWeight: 7 },
  { label: 'Escalating conflict mechanism that tightens every act', lanes: [], budgets: [], tones: [], genres: [], ciWeight: 9, gpWeight: 8 },
  { label: 'At least one embedded relational tension between core characters', lanes: [], budgets: [], tones: [], genres: [], ciWeight: 8, gpWeight: 7 },

  // Prestige / Awards
  { label: 'Moral complexity — no clean heroes or villains', lanes: ['prestige-awards'], budgets: [], tones: [], genres: [], ciWeight: 9, gpWeight: 6 },
  { label: 'Subtext-driven dialogue — characters speak around what they mean', lanes: ['prestige-awards'], budgets: [], tones: [], genres: [], ciWeight: 9, gpWeight: 5 },

  // Studio / Streamer
  { label: 'Strong antagonist or opposition force with clear motivation', lanes: ['studio-streamer'], budgets: [], tones: [], genres: [], ciWeight: 8, gpWeight: 9 },
  { label: 'Castable lead role with star-turn potential', lanes: ['studio-streamer'], budgets: [], tones: [], genres: [], ciWeight: 6, gpWeight: 9 },

  // Low Budget
  { label: 'Contained but expandable world — minimal locations, maximum tension', lanes: ['low-budget'], budgets: ['micro', 'low'], tones: [], genres: [], ciWeight: 7, gpWeight: 9 },
  { label: 'Small cast with intense interpersonal dynamics', lanes: ['low-budget'], budgets: ['micro', 'low'], tones: [], genres: [], ciWeight: 7, gpWeight: 8 },

  // Genre / Market
  { label: 'Genre-satisfying set pieces at regular intervals', lanes: ['genre-market'], budgets: [], tones: [], genres: [], ciWeight: 7, gpWeight: 9 },
  { label: 'Hook-clear premise pitchable in one sentence', lanes: ['genre-market'], budgets: [], tones: [], genres: [], ciWeight: 6, gpWeight: 10 },

  // Fast turnaround / Vertical
  { label: 'Immediate hook within first 30 seconds of content', lanes: ['fast-turnaround'], budgets: [], tones: [], genres: [], ciWeight: 7, gpWeight: 9 },
  { label: 'Cliffhanger structure at every episode break', lanes: ['fast-turnaround'], budgets: [], tones: [], genres: [], ciWeight: 7, gpWeight: 9 },

  // Thriller / Mystery genre
  { label: 'Information asymmetry between audience and characters', lanes: [], budgets: [], tones: [], genres: ['thriller', 'mystery', 'crime'], ciWeight: 9, gpWeight: 7 },
  { label: 'Ticking-clock pressure that accelerates in final act', lanes: [], budgets: [], tones: [], genres: ['thriller', 'action'], ciWeight: 8, gpWeight: 8 },

  // Romance genre
  { label: 'Clear romantic obstacle rooted in character flaw, not circumstance', lanes: [], budgets: [], tones: [], genres: ['romance', 'romcom'], ciWeight: 8, gpWeight: 8 },

  // Drama
  { label: 'World that visibly costs characters something to operate within', lanes: [], budgets: [], tones: [], genres: ['drama'], ciWeight: 9, gpWeight: 6 },

  // Comedy
  { label: 'Comedic engine rooted in character contradiction, not gags', lanes: [], budgets: [], tones: [], genres: ['comedy', 'dark-comedy'], ciWeight: 8, gpWeight: 7 },

  // Period / Historical
  { label: 'Period-authentic social hierarchy visible in every scene', lanes: [], budgets: [], tones: [], genres: [], ciWeight: 8, gpWeight: 7 },
];

// ── Avoid patterns ───────────────────────────────────────────────────

interface AvoidPattern {
  label: string;
  lanes: string[];
  budgets: string[];
  genres: string[];
  ciPenalty: number;   // how much CI drops if present
  gpPenalty: number;
}

const AVOID_PATTERNS: AvoidPattern[] = [
  // Universal
  { label: 'Vague protagonist motivations — "wants to find themselves"', lanes: [], budgets: [], genres: [], ciPenalty: 8, gpPenalty: 7 },
  { label: 'Passive protagonist who reacts but never drives', lanes: [], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 8 },
  { label: 'Excessive world-building exposition before story begins', lanes: [], budgets: [], genres: [], ciPenalty: 7, gpPenalty: 8 },
  { label: 'Tonal inconsistency — mixing gravitas with slapstick without intent', lanes: [], budgets: [], genres: [], ciPenalty: 8, gpPenalty: 7 },
  { label: 'Unmotivated twists or reveals with no setup', lanes: [], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 6 },

  // Budget-aware
  { label: 'Large-scale battle sequences requiring hundreds of extras', lanes: [], budgets: ['micro', 'low'], genres: [], ciPenalty: 2, gpPenalty: 9 },
  { label: 'Multiple international locations requiring travel crews', lanes: [], budgets: ['micro', 'low'], genres: [], ciPenalty: 2, gpPenalty: 9 },
  { label: 'Heavy VFX/CGI dependency for core story elements', lanes: [], budgets: ['micro', 'low', 'medium'], genres: [], ciPenalty: 2, gpPenalty: 8 },

  // Genre-specific
  { label: 'Over-complicated mythology or lore that overshadows character', lanes: [], budgets: [], genres: ['fantasy', 'sci-fi'], ciPenalty: 7, gpPenalty: 8 },
  { label: 'Red herrings that feel dishonest rather than strategic', lanes: [], budgets: [], genres: ['thriller', 'mystery'], ciPenalty: 8, gpPenalty: 6 },

  // Prestige
  { label: 'Sentimentality substituting for earned emotion', lanes: ['prestige-awards'], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 5 },
  { label: 'On-the-nose dialogue stating theme directly', lanes: ['prestige-awards'], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 4 },

  // Fast turnaround
  { label: 'Slow-burn pacing with no hooks in first episode', lanes: ['fast-turnaround'], budgets: [], genres: [], ciPenalty: 5, gpPenalty: 9 },

  // Studio
  { label: 'Niche premise with no broad audience entry point', lanes: ['studio-streamer'], budgets: [], genres: [], ciPenalty: 3, gpPenalty: 9 },
];

// ── Direction Templates ──────────────────────────────────────────────

interface DirectionTemplate {
  lanes: string[];
  budgets: string[];
  genres: string[];
  tones: string[];
  direction: string;
}

const DIRECTION_TEMPLATES: DirectionTemplate[] = [
  // Prestige
  { lanes: ['prestige-awards'], budgets: [], genres: [], tones: [],
    direction: 'Prioritise structural restraint and earned complexity. Every scene must advance both external plot and internal character pressure. Favour subtext over exposition. World should feel institutional and consequential.' },
  // Studio
  { lanes: ['studio-streamer'], budgets: [], genres: [], tones: [],
    direction: 'Balance commercial accessibility with narrative distinctiveness. Lead must be immediately compelling with a clear want/need split. Story should be pitchable in one line. Ensure trailer-ready moments every 15–20 pages.' },
  // Low budget
  { lanes: ['low-budget'], budgets: ['micro', 'low'], genres: [], tones: [],
    direction: 'Maximise tension through character proximity and contained geography. Dialogue-driven scenes with high subtext. Avoid set pieces that require large crews or VFX. Focus on performances and atmosphere.' },
  // Genre market
  { lanes: ['genre-market'], budgets: [], genres: [], tones: [],
    direction: 'Deliver genre-satisfying beats at reliable intervals. Premise must be hook-clear and internationally translatable. Build toward a climactic set piece. Ensure the concept has franchise or sequel potential.' },
  // Fast turnaround / Vertical
  { lanes: ['fast-turnaround'], budgets: [], genres: [], tones: [],
    direction: 'Open with maximum velocity. Every episode must end on a cliffhanger or revelation. Short scenes, fast cuts, emotional spikes. Mobile-first pacing — no scene longer than 90 seconds without a turn.' },
  // International co-pro
  { lanes: ['international-copro'], budgets: [], genres: [], tones: [],
    direction: 'Design for cross-territory appeal. Universal themes with culturally specific texture. Ensure the story travels without heavy localisation. Co-production-friendly locations and cast diversity.' },

  // Tone-specific
  { lanes: [], budgets: [], genres: [], tones: ['dark', 'gritty', 'noir'],
    direction: 'Commit to tonal darkness without nihilism. Characters must still want something and fight for it. Use environmental decay and institutional rot as texture. Avoid gratuitous shock — every dark beat must serve story.' },
  { lanes: [], budgets: [], genres: [], tones: ['warm', 'hopeful', 'uplifting'],
    direction: 'Ground warmth in real stakes — hope must be earned, not given. Characters face genuine obstacles but respond with resilience. Avoid saccharine resolution — the tone should feel honest, not manufactured.' },

  // Genre-specific
  { lanes: [], budgets: [], genres: ['thriller', 'mystery'], tones: [],
    direction: 'Build information asymmetry as the primary engine. Audience should have just enough to suspect but never enough to confirm. Each act narrows the possibility space. Avoid information dumps — reveal through action and consequence.' },
  { lanes: [], budgets: [], genres: ['romance', 'romcom'], tones: [],
    direction: 'Root the romantic obstacle in character flaw, not external circumstance. Chemistry must be demonstrated through conflict, not description. The relationship should pressure both characters to change. Avoid meet-cute as the sole structural foundation.' },
  { lanes: [], budgets: [], genres: ['horror'], tones: [],
    direction: 'Escalate dread through implication before revelation. The threat should have internal logic. Characters must make understandable choices even under fear. Avoid jump-scare reliance — build atmospheric tension that compounds.' },
  { lanes: [], budgets: [], genres: ['comedy', 'dark-comedy'], tones: [],
    direction: 'Root humour in character contradiction and social observation. The comedic engine must also drive the plot forward. Avoid episodic gag structures — comedy should emerge from escalating situation pressure.' },
];

// ── World population density additions ───────────────────────────────

const WORLD_DENSITY_ADDITIONS: Record<string, { mustInclude: string; direction: string }> = {
  moderate: {
    mustInclude: 'Background social texture — occasional secondary characters reinforcing hierarchy and environment',
    direction: 'Include light world population — guards, attendants, passersby — to create a lived-in feel without expanding canon.',
  },
  rich: {
    mustInclude: 'Multi-layered social environment with visible hierarchy — servants, officials, merchants, enforcers present in scenes',
    direction: 'Populate the world richly — multiple layers of social activity visible in every major scene. Secondary characters reinforce scale and realism. These are atmospheric, not canonical.',
  },
};

// ── Setting-specific patterns ────────────────────────────────────────

const SETTING_MUST_INCLUDES: Record<string, string> = {
  'Period / Historical': 'Period-authentic social hierarchy visible in every scene',
  'Near Future': 'Grounded near-future technology that shapes social dynamics without dominating plot',
  'Far Future': 'Future-world rules established clearly in first act — no retroactive worldbuilding',
  'Alt-Reality / Fantasy': 'Fantasy/alternate rules limited and internally consistent — magic system has cost',
};

// ── Core Suggestion Generator ────────────────────────────────────────

function matchesFilter(patternValues: string[], contextValue: string): boolean {
  if (patternValues.length === 0) return true; // empty = matches all
  return patternValues.some(v => contextValue.toLowerCase().includes(v.toLowerCase()));
}

function scoreAndSelect<T extends { ciWeight?: number; gpWeight?: number; ciPenalty?: number; gpPenalty?: number; lanes: string[]; budgets: string[]; genres: string[] }>(
  patterns: T[],
  ctx: SuggestionContext,
  maxCount: number,
): T[] {
  const scored = patterns
    .filter(p => {
      const laneMatch = matchesFilter(p.lanes, ctx.lane);
      const budgetMatch = matchesFilter(p.budgets, ctx.budgetBand);
      const genreMatch = matchesFilter(p.genres, ctx.genre + ' ' + ctx.subgenre);
      return laneMatch && budgetMatch && genreMatch;
    })
    .map(p => ({
      pattern: p,
      score: ((p.ciWeight ?? p.ciPenalty ?? 5) * 2 + (p.gpWeight ?? p.gpPenalty ?? 5)) / 3,
    }))
    .sort((a, b) => b.score - a.score);

  // Deduplicate by taking top N
  return scored.slice(0, maxCount).map(s => s.pattern);
}

export function generateSuggestions(ctx: SuggestionContext): InputSuggestions {
  // 1. Must-include
  const mustPatterns = scoreAndSelect(MUST_INCLUDE_PATTERNS, ctx, 5);
  const mustInclude = mustPatterns.map(p => p.label);

  // Add setting-specific must-include
  if (ctx.settingType && SETTING_MUST_INCLUDES[ctx.settingType]) {
    const settingInc = SETTING_MUST_INCLUDES[ctx.settingType];
    if (!mustInclude.includes(settingInc)) {
      mustInclude.push(settingInc);
    }
  }

  // Add world density must-include
  const density = ctx.worldPopulationDensity || 'minimal';
  if (density !== 'minimal' && WORLD_DENSITY_ADDITIONS[density]) {
    mustInclude.push(WORLD_DENSITY_ADDITIONS[density].mustInclude);
  }

  // 2. Avoid
  const avoidPatterns = scoreAndSelect(AVOID_PATTERNS, ctx, 5);
  const avoid = avoidPatterns.map(p => p.label);

  // 3. Additional direction — pick best matching template
  const directionParts: string[] = [];

  // Lane-based direction
  const laneDir = DIRECTION_TEMPLATES.find(t =>
    t.lanes.length > 0 && matchesFilter(t.lanes, ctx.lane)
  );
  if (laneDir) directionParts.push(laneDir.direction);

  // Tone-based direction
  if (ctx.toneAnchor) {
    const toneDir = DIRECTION_TEMPLATES.find(t =>
      t.tones.length > 0 && matchesFilter(t.tones, ctx.toneAnchor)
    );
    if (toneDir) directionParts.push(toneDir.direction);
  }

  // Genre-based direction
  const genreDir = DIRECTION_TEMPLATES.find(t =>
    t.genres.length > 0 && matchesFilter(t.genres, ctx.genre + ' ' + ctx.subgenre)
  );
  if (genreDir) directionParts.push(genreDir.direction);

  // World density direction
  if (density !== 'minimal' && WORLD_DENSITY_ADDITIONS[density]) {
    directionParts.push(WORLD_DENSITY_ADDITIONS[density].direction);
  }

  const additionalDirection = directionParts.join('\n\n');

  return { mustInclude, avoid, additionalDirection };
}

/**
 * Check if context has enough data to generate useful suggestions.
 */
export function canGenerateSuggestions(ctx: Partial<SuggestionContext>): boolean {
  return !!(ctx.genre || ctx.lane || ctx.productionType);
}

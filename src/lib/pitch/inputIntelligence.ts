/**
 * Input Intelligence v2 — Combination-optimised suggestion engine.
 *
 * Selects a coherent SET of must_include, avoid, prohibitedComps, and
 * additionalDirection that maximises downstream CI/GP as a combination,
 * not just individually high-scoring items.
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
  prohibitedComps: string[];
  additionalDirection: string;
  /** Dev-facing diagnostics — not shown in UI */
  _debug?: SuggestionDebug;
}

export interface SuggestionDebug {
  matchedBundle: string | null;
  selectedMustIds: string[];
  selectedAvoidIds: string[];
  rejectedForRedundancy: string[];
  rejectedForIncompatibility: string[];
  dimensionCoverage: Record<Dimension, boolean>;
}

export interface SuggestionContext {
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

// ── Dimensions for set-level coverage ────────────────────────────────

const DIMENSIONS = [
  'story_engine',       // A. conflict architecture
  'protagonist',        // B. protagonist pressure & agency
  'antagonist',         // C. antagonist / opposition clarity
  'world_density',      // D. world / system density
  'feasibility',        // E. production feasibility
  'tonal_stability',    // F. anti-drift / tonal protection
  'commercial',         // G. commercial distinctiveness
] as const;
type Dimension = typeof DIMENSIONS[number];

// ── Pattern definitions ──────────────────────────────────────────────

interface MustPattern {
  id: string;
  label: string;
  dimension: Dimension;
  lanes: string[];
  budgets: string[];
  tones: string[];
  genres: string[];
  settings: string[];
  ciWeight: number;
  gpWeight: number;
  /** IDs of patterns this is redundant with */
  redundantWith?: string[];
  /** IDs of patterns this is incompatible with */
  incompatibleWith?: string[];
  /** IDs of patterns that create positive synergy */
  synergyWith?: string[];
}

interface AvoidPattern {
  id: string;
  label: string;
  dimension: Dimension;
  lanes: string[];
  budgets: string[];
  genres: string[];
  ciPenalty: number;
  gpPenalty: number;
  /** Must-pattern IDs this avoid reinforces (synergy) */
  reinforces?: string[];
  redundantWith?: string[];
}

// ── Must-Include Pattern Library ─────────────────────────────────────

const MUST_PATTERNS: MustPattern[] = [
  // A. Story engine / conflict architecture
  { id: 'M_ESCALATING_CONFLICT', label: 'Escalating conflict mechanism that tightens every act', dimension: 'story_engine',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 9, gpWeight: 8,
    redundantWith: ['M_CLIFFHANGER_STRUCTURE'], synergyWith: ['M_ANTAGONIST_CLEAR'] },
  { id: 'M_INFO_ASYMMETRY', label: 'Information asymmetry between audience and characters driving tension', dimension: 'story_engine',
    lanes: [], budgets: [], tones: [], genres: ['thriller', 'mystery', 'crime'], settings: [], ciWeight: 9, gpWeight: 7,
    incompatibleWith: ['M_COMEDIC_ENGINE'] },
  { id: 'M_TICKING_CLOCK', label: 'Ticking-clock pressure that accelerates through final act', dimension: 'story_engine',
    lanes: [], budgets: [], tones: [], genres: ['thriller', 'action', 'crime'], settings: [], ciWeight: 8, gpWeight: 8,
    synergyWith: ['M_PROTAGONIST_OBJECTIVE'] },
  { id: 'M_ROMANTIC_OBSTACLE', label: 'Romantic obstacle rooted in character flaw, not external circumstance', dimension: 'story_engine',
    lanes: [], budgets: [], tones: [], genres: ['romance', 'romcom'], settings: [], ciWeight: 8, gpWeight: 8 },
  { id: 'M_COMEDIC_ENGINE', label: 'Comedic engine rooted in character contradiction, not gags', dimension: 'story_engine',
    lanes: [], budgets: [], tones: [], genres: ['comedy', 'dark-comedy'], settings: [], ciWeight: 8, gpWeight: 7,
    incompatibleWith: ['M_INFO_ASYMMETRY'] },
  { id: 'M_CLIFFHANGER_STRUCTURE', label: 'Cliffhanger or revelation at every episode break', dimension: 'story_engine',
    lanes: ['fast-turnaround'], budgets: [], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 9,
    redundantWith: ['M_ESCALATING_CONFLICT'] },
  { id: 'M_MORAL_COMPLEXITY', label: 'Moral complexity — no clean heroes or villains', dimension: 'story_engine',
    lanes: ['prestige-awards'], budgets: [], tones: [], genres: ['drama'], settings: [], ciWeight: 9, gpWeight: 6,
    synergyWith: ['M_SUBTEXT_DIALOGUE', 'M_WORLD_COSTS'] },

  // B. Protagonist pressure & agency
  { id: 'M_PROTAGONIST_OBJECTIVE', label: 'Clear protagonist objective with personal stakes from scene one', dimension: 'protagonist',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 9, gpWeight: 8,
    synergyWith: ['M_ESCALATING_CONFLICT', 'M_ANTAGONIST_CLEAR'] },
  { id: 'M_CASTABLE_LEAD', label: 'Castable lead role with star-turn potential', dimension: 'protagonist',
    lanes: ['studio-streamer', 'genre-market'], budgets: [], tones: [], genres: [], settings: [], ciWeight: 6, gpWeight: 9,
    redundantWith: ['M_PROTAGONIST_OBJECTIVE'] },
  { id: 'M_IMMEDIATE_HOOK', label: 'Immediate hook within first 30 seconds of content', dimension: 'protagonist',
    lanes: ['fast-turnaround'], budgets: [], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 9 },

  // C. Antagonist / opposition
  { id: 'M_ANTAGONIST_CLEAR', label: 'Strong antagonist or opposition force with clear motivation', dimension: 'antagonist',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 8, gpWeight: 9,
    synergyWith: ['M_PROTAGONIST_OBJECTIVE', 'M_POWER_STRUCTURE'] },
  { id: 'M_INSTITUTIONAL_ANTAGONISM', label: 'Institutional or systemic antagonism — the system itself is the obstacle', dimension: 'antagonist',
    lanes: ['prestige-awards', 'international-copro'], budgets: [], tones: ['dark', 'gritty'], genres: ['drama'], settings: [], ciWeight: 9, gpWeight: 6,
    redundantWith: ['M_ANTAGONIST_CLEAR'], synergyWith: ['M_POWER_STRUCTURE', 'M_WORLD_COSTS'] },

  // D. World / system density
  { id: 'M_POWER_STRUCTURE', label: 'Defined power structure or institutional system that shapes the world', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 8, gpWeight: 7,
    synergyWith: ['M_ANTAGONIST_CLEAR', 'M_WORLD_POPULATION_MOD', 'M_WORLD_POPULATION_RICH'] },
  { id: 'M_RELATIONAL_TENSION', label: 'At least one embedded relational tension between core characters', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 8, gpWeight: 7 },
  { id: 'M_WORLD_COSTS', label: 'World that visibly costs characters something to operate within', dimension: 'world_density',
    lanes: ['prestige-awards'], budgets: [], tones: [], genres: ['drama'], settings: [], ciWeight: 9, gpWeight: 6,
    synergyWith: ['M_POWER_STRUCTURE', 'M_MORAL_COMPLEXITY'] },
  { id: 'M_PERIOD_HIERARCHY', label: 'Period-authentic social hierarchy visible in every scene', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: [], settings: ['Period / Historical'], ciWeight: 8, gpWeight: 7,
    synergyWith: ['M_POWER_STRUCTURE'], redundantWith: ['M_WORLD_POPULATION_RICH'] },
  { id: 'M_NEAR_FUTURE_TECH', label: 'Grounded near-future technology that shapes social dynamics without dominating plot', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: ['sci-fi'], settings: ['Near Future'], ciWeight: 8, gpWeight: 7 },
  { id: 'M_FANTASY_RULES', label: 'Fantasy/alternate rules limited and internally consistent — magic system has cost', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: ['fantasy'], settings: ['Alt-Reality / Fantasy', 'Far Future'], ciWeight: 8, gpWeight: 7 },
  { id: 'M_WORLD_POPULATION_MOD', label: 'Background social texture — secondary characters reinforcing hierarchy and environment', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 6, gpWeight: 5,
    redundantWith: ['M_WORLD_POPULATION_RICH'] },
  { id: 'M_WORLD_POPULATION_RICH', label: 'Multi-layered social environment with visible hierarchy — servants, officials, merchants, enforcers present', dimension: 'world_density',
    lanes: [], budgets: [], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 6,
    redundantWith: ['M_WORLD_POPULATION_MOD'] },

  // E. Production feasibility
  { id: 'M_CONTAINED_WORLD', label: 'Contained but expandable world — minimal locations, maximum tension', dimension: 'feasibility',
    lanes: ['low-budget'], budgets: ['micro', 'low'], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 9,
    incompatibleWith: ['M_WORLD_POPULATION_RICH'] },
  { id: 'M_SMALL_CAST', label: 'Small cast with intense interpersonal dynamics', dimension: 'feasibility',
    lanes: ['low-budget'], budgets: ['micro', 'low'], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 8,
    synergyWith: ['M_CONTAINED_WORLD'] },

  // F. Tonal stability
  { id: 'M_SUBTEXT_DIALOGUE', label: 'Subtext-driven dialogue — characters speak around what they mean', dimension: 'tonal_stability',
    lanes: ['prestige-awards'], budgets: [], tones: [], genres: ['drama'], settings: [], ciWeight: 9, gpWeight: 5,
    synergyWith: ['M_MORAL_COMPLEXITY'] },

  // G. Commercial distinctiveness
  { id: 'M_HOOK_PREMISE', label: 'Hook-clear premise pitchable in one sentence', dimension: 'commercial',
    lanes: ['studio-streamer', 'genre-market'], budgets: [], tones: [], genres: [], settings: [], ciWeight: 6, gpWeight: 10,
    synergyWith: ['M_CASTABLE_LEAD'] },
  { id: 'M_GENRE_SET_PIECES', label: 'Genre-satisfying set pieces at regular intervals', dimension: 'commercial',
    lanes: ['genre-market', 'studio-streamer'], budgets: ['medium', 'high', 'studio'], tones: [], genres: [], settings: [], ciWeight: 7, gpWeight: 9,
    incompatibleWith: ['M_CONTAINED_WORLD'] },
];

// ── Avoid Pattern Library ────────────────────────────────────────────

const AVOID_PATTERNS: AvoidPattern[] = [
  // Protagonist dimension
  { id: 'A_VAGUE_MOTIVATION', label: 'Vague protagonist motivations — "wants to find themselves"', dimension: 'protagonist',
    lanes: [], budgets: [], genres: [], ciPenalty: 8, gpPenalty: 7, reinforces: ['M_PROTAGONIST_OBJECTIVE'] },
  { id: 'A_PASSIVE_PROTAGONIST', label: 'Passive protagonist who reacts but never drives', dimension: 'protagonist',
    lanes: [], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 8, reinforces: ['M_PROTAGONIST_OBJECTIVE'],
    redundantWith: ['A_VAGUE_MOTIVATION'] },
  // Story engine
  { id: 'A_EXPOSITION_DUMP', label: 'Excessive world-building exposition before story begins', dimension: 'story_engine',
    lanes: [], budgets: [], genres: [], ciPenalty: 7, gpPenalty: 8, reinforces: ['M_ESCALATING_CONFLICT'] },
  { id: 'A_UNMOTIVATED_TWIST', label: 'Unmotivated twists or reveals with no setup', dimension: 'story_engine',
    lanes: [], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 6 },
  { id: 'A_DISHONEST_HERRINGS', label: 'Red herrings that feel dishonest rather than strategic', dimension: 'story_engine',
    lanes: [], budgets: [], genres: ['thriller', 'mystery'], ciPenalty: 8, gpPenalty: 6 },
  // Tonal stability
  { id: 'A_TONAL_INCONSISTENCY', label: 'Tonal inconsistency — mixing gravitas with slapstick without intent', dimension: 'tonal_stability',
    lanes: [], budgets: [], genres: [], ciPenalty: 8, gpPenalty: 7 },
  { id: 'A_SENTIMENTALITY', label: 'Sentimentality substituting for earned emotion', dimension: 'tonal_stability',
    lanes: ['prestige-awards'], budgets: [], genres: [], ciPenalty: 9, gpPenalty: 5,
    reinforces: ['M_SUBTEXT_DIALOGUE'] },
  { id: 'A_ON_THE_NOSE', label: 'On-the-nose dialogue stating theme directly', dimension: 'tonal_stability',
    lanes: ['prestige-awards'], budgets: [], genres: ['drama'], ciPenalty: 9, gpPenalty: 4,
    reinforces: ['M_SUBTEXT_DIALOGUE'], redundantWith: ['A_SENTIMENTALITY'] },
  // Feasibility
  { id: 'A_LARGE_BATTLES', label: 'Large-scale battle sequences requiring hundreds of extras', dimension: 'feasibility',
    lanes: [], budgets: ['micro', 'low'], genres: [], ciPenalty: 2, gpPenalty: 9, reinforces: ['M_CONTAINED_WORLD'] },
  { id: 'A_MULTI_LOCATIONS', label: 'Multiple international locations requiring travel crews', dimension: 'feasibility',
    lanes: [], budgets: ['micro', 'low'], genres: [], ciPenalty: 2, gpPenalty: 9, reinforces: ['M_CONTAINED_WORLD'],
    redundantWith: ['A_LARGE_BATTLES'] },
  { id: 'A_HEAVY_VFX', label: 'Heavy VFX/CGI dependency for core story elements', dimension: 'feasibility',
    lanes: [], budgets: ['micro', 'low', 'medium'], genres: [], ciPenalty: 2, gpPenalty: 8 },
  // World density
  { id: 'A_OVERCOMPLICATED_LORE', label: 'Over-complicated mythology or lore that overshadows character', dimension: 'world_density',
    lanes: [], budgets: [], genres: ['fantasy', 'sci-fi'], ciPenalty: 7, gpPenalty: 8 },
  // Commercial
  { id: 'A_SLOW_BURN_NO_HOOKS', label: 'Slow-burn pacing with no hooks in first episode', dimension: 'commercial',
    lanes: ['fast-turnaround'], budgets: [], genres: [], ciPenalty: 5, gpPenalty: 9,
    reinforces: ['M_IMMEDIATE_HOOK', 'M_CLIFFHANGER_STRUCTURE'] },
  { id: 'A_NICHE_NO_ENTRY', label: 'Niche premise with no broad audience entry point', dimension: 'commercial',
    lanes: ['studio-streamer'], budgets: [], genres: [], ciPenalty: 3, gpPenalty: 9,
    reinforces: ['M_HOOK_PREMISE'] },
  { id: 'A_GENERIC_PROCEDURAL', label: 'Generic procedural structure without distinctive voice or angle', dimension: 'commercial',
    lanes: [], budgets: [], genres: ['crime', 'thriller', 'mystery'], ciPenalty: 7, gpPenalty: 7 },
];

// ── Prohibited Comp Library ──────────────────────────────────────────

interface ProhibitedCompEntry {
  title: string;
  reason: string;
  lanes: string[];
  budgets: string[];
  genres: string[];
  tones: string[];
  settings: string[];
  /** Only suggest when steering value is high */
  steeringValue: number; // 1-10
}

const PROHIBITED_COMP_LIBRARY: ProhibitedCompEntry[] = [
  // Fantasy lore drift
  { title: 'Game of Thrones', reason: 'lore-heavy, massive scale mismatch for contained projects', lanes: [], budgets: ['micro', 'low', 'medium'], genres: ['fantasy', 'drama'], tones: [], settings: ['Alt-Reality / Fantasy'], steeringValue: 9 },
  { title: 'Lord of the Rings', reason: 'epic scale, high-VFX expectation', lanes: [], budgets: ['micro', 'low', 'medium'], genres: ['fantasy'], tones: [], settings: ['Alt-Reality / Fantasy'], steeringValue: 8 },
  // Sci-fi scale drift
  { title: 'Interstellar', reason: 'VFX-dependent, cosmic scale', lanes: [], budgets: ['micro', 'low', 'medium'], genres: ['sci-fi'], tones: [], settings: ['Far Future', 'Near Future'], steeringValue: 7 },
  // Tone drift — prestige
  { title: 'Fast & Furious', reason: 'tonal mismatch for prestige/grounded work', lanes: ['prestige-awards'], budgets: [], genres: [], tones: ['dark', 'gritty', 'prestige'], settings: [], steeringValue: 8 },
  // Structural misdirection
  { title: 'Inception', reason: 'overly complex nested structure can derail grounded narratives', lanes: [], budgets: ['micro', 'low'], genres: ['thriller', 'sci-fi'], tones: [], settings: [], steeringValue: 6 },
  // Over-familiar market positioning
  { title: 'Twilight', reason: 'saturated YA supernatural positioning', lanes: [], budgets: [], genres: ['romance', 'fantasy'], tones: [], settings: [], steeringValue: 7 },
  { title: 'Fifty Shades of Grey', reason: 'tonal and market stigma for serious drama', lanes: ['prestige-awards'], budgets: [], genres: ['romance', 'drama'], tones: [], settings: [], steeringValue: 8 },
  // Vertical drama anti-patterns
  { title: 'The Crown', reason: 'slow prestige pacing incompatible with vertical format', lanes: ['fast-turnaround'], budgets: [], genres: ['drama'], tones: [], settings: [], steeringValue: 7 },
  // Low-budget anti-patterns
  { title: 'Avatar', reason: 'VFX-defined — sets wrong visual expectations', lanes: [], budgets: ['micro', 'low', 'medium'], genres: ['sci-fi', 'action', 'fantasy'], tones: [], settings: [], steeringValue: 9 },
  { title: 'Transformers', reason: 'spectacle-driven, budget-intensive, generic plotting', lanes: [], budgets: ['micro', 'low', 'medium'], genres: ['action', 'sci-fi'], tones: [], settings: [], steeringValue: 7 },
  // Genre market anti-patterns
  { title: 'Terrence Malick films', reason: 'anti-plot, non-commercial pacing', lanes: ['genre-market', 'studio-streamer', 'fast-turnaround'], budgets: [], genres: [], tones: [], settings: [], steeringValue: 6 },
];

// ── High-Value Combination Bundles ───────────────────────────────────

interface CombinationBundle {
  id: string;
  name: string;
  /** Context match conditions — all must pass to activate */
  matchLanes: string[];
  matchGenres: string[];
  matchBudgets: string[];
  matchTones: string[];
  matchSettings: string[];
  /** Preferred pattern IDs — get boosted scoring */
  boostMust: string[];
  boostAvoid: string[];
  prohibitedComps: string[];
  /** Synthesized direction override */
  directionSynthesis: string;
  /** How strongly this bundle matches (for selecting best) */
  specificity: number;
}

const COMBINATION_BUNDLES: CombinationBundle[] = [
  {
    id: 'BUNDLE_PRESTIGE_HISTORICAL_GROUNDED',
    name: 'Prestige Historical Grounded',
    matchLanes: ['prestige-awards'], matchGenres: ['drama', 'thriller'], matchBudgets: [], matchTones: ['dark', 'gritty', 'prestige'], matchSettings: ['Period / Historical'],
    boostMust: ['M_MORAL_COMPLEXITY', 'M_POWER_STRUCTURE', 'M_PERIOD_HIERARCHY', 'M_WORLD_COSTS', 'M_SUBTEXT_DIALOGUE', 'M_PROTAGONIST_OBJECTIVE'],
    boostAvoid: ['A_SENTIMENTALITY', 'A_ON_THE_NOSE', 'A_OVERCOMPLICATED_LORE', 'A_EXPOSITION_DUMP'],
    prohibitedComps: ['Game of Thrones'],
    directionSynthesis: 'Build a grounded period world where power costs are visible in every interaction. Protagonist must navigate institutional pressure with clear personal stakes. Dialogue operates through subtext — never state theme. Social hierarchy is environmental, not expositional. Every character occupies a specific position in the power structure. Moral terrain is grey; the audience should understand every side. Restraint over spectacle.',
    specificity: 8,
  },
  {
    id: 'BUNDLE_CONTAINED_COMMERCIAL_THRILLER',
    name: 'Contained Commercial Thriller',
    matchLanes: ['genre-market', 'low-budget', 'independent-film'], matchGenres: ['thriller', 'mystery', 'crime'], matchBudgets: ['micro', 'low', 'medium'], matchTones: [], matchSettings: [],
    boostMust: ['M_PROTAGONIST_OBJECTIVE', 'M_TICKING_CLOCK', 'M_CONTAINED_WORLD', 'M_ANTAGONIST_CLEAR', 'M_HOOK_PREMISE'],
    boostAvoid: ['A_HEAVY_VFX', 'A_MULTI_LOCATIONS', 'A_EXPOSITION_DUMP', 'A_GENERIC_PROCEDURAL'],
    prohibitedComps: ['Inception', 'Avatar'],
    directionSynthesis: 'Maximise tension through containment — fewer locations, tighter cast, escalating pressure. Protagonist has a concrete objective with a deadline. Antagonist is motivated and proximate. The hook must be pitchable in one sentence. Every scene either raises stakes or reveals information. No passive investigation sequences — the protagonist must be forced to act. Production-lean but narratively dense.',
    specificity: 7,
  },
  {
    id: 'BUNDLE_VERTICAL_EMOTIONAL_ENGINE',
    name: 'Vertical Drama Emotional Engine',
    matchLanes: ['fast-turnaround'], matchGenres: ['drama', 'romance', 'romcom'], matchBudgets: [], matchTones: [], matchSettings: [],
    boostMust: ['M_IMMEDIATE_HOOK', 'M_CLIFFHANGER_STRUCTURE', 'M_PROTAGONIST_OBJECTIVE', 'M_RELATIONAL_TENSION'],
    boostAvoid: ['A_SLOW_BURN_NO_HOOKS', 'A_EXPOSITION_DUMP', 'A_PASSIVE_PROTAGONIST'],
    prohibitedComps: ['The Crown'],
    directionSynthesis: 'Mobile-first pacing — every episode opens with emotional velocity and closes on a hook. Protagonist wants something concrete and faces escalating personal obstacles. Relational tension drives episode-to-episode momentum. No scene runs longer than 90 seconds without a turn. Emotional spikes replace slow-build arcs. Dialogue is punchy and reveals character through conflict.',
    specificity: 7,
  },
  {
    id: 'BUNDLE_GROUNDED_SCIFI_PRESSURE',
    name: 'Grounded Sci-Fi Pressure Cooker',
    matchLanes: [], matchGenres: ['sci-fi', 'thriller'], matchBudgets: ['low', 'medium'], matchTones: ['dark', 'gritty'], matchSettings: ['Near Future'],
    boostMust: ['M_NEAR_FUTURE_TECH', 'M_PROTAGONIST_OBJECTIVE', 'M_TICKING_CLOCK', 'M_CONTAINED_WORLD', 'M_ANTAGONIST_CLEAR'],
    boostAvoid: ['A_HEAVY_VFX', 'A_OVERCOMPLICATED_LORE', 'A_EXPOSITION_DUMP'],
    prohibitedComps: ['Interstellar', 'Avatar'],
    directionSynthesis: 'Technology is environmental, not spectacle — it shapes social dynamics and creates new forms of pressure. Protagonist operates under constraint in a near-future system with real costs. The science fiction is grounded: one or two speculative elements, rigorously applied. Tension comes from character and system, not visual effects. Contained geography keeps the budget feasible and the drama intimate.',
    specificity: 7,
  },
  {
    id: 'BUNDLE_ELEVATED_GENRE_ANTI_LORE',
    name: 'Elevated Genre with Anti-Lore Guardrails',
    matchLanes: ['studio-streamer', 'international-copro'], matchGenres: ['fantasy', 'sci-fi'], matchBudgets: ['medium', 'high'], matchTones: [], matchSettings: ['Alt-Reality / Fantasy'],
    boostMust: ['M_FANTASY_RULES', 'M_PROTAGONIST_OBJECTIVE', 'M_ANTAGONIST_CLEAR', 'M_POWER_STRUCTURE', 'M_HOOK_PREMISE'],
    boostAvoid: ['A_OVERCOMPLICATED_LORE', 'A_EXPOSITION_DUMP', 'A_NICHE_NO_ENTRY'],
    prohibitedComps: ['Lord of the Rings'],
    directionSynthesis: 'The speculative world has strict, limited rules with real cost. Character drives plot, not lore. The audience enters through a relatable protagonist, not through worldbuilding. Power structures are clear and human-readable. Genre satisfaction comes from emotional and structural payoffs, not from mythology depth. Avoid encyclopaedic backstory — the world reveals itself through action.',
    specificity: 7,
  },
  {
    id: 'BUNDLE_STUDIO_COMMERCIAL_DRAMA',
    name: 'Studio Commercial Drama',
    matchLanes: ['studio-streamer'], matchGenres: ['drama'], matchBudgets: ['high', 'studio'], matchTones: [], matchSettings: [],
    boostMust: ['M_PROTAGONIST_OBJECTIVE', 'M_CASTABLE_LEAD', 'M_HOOK_PREMISE', 'M_ANTAGONIST_CLEAR', 'M_RELATIONAL_TENSION'],
    boostAvoid: ['A_NICHE_NO_ENTRY', 'A_PASSIVE_PROTAGONIST', 'A_TONAL_INCONSISTENCY'],
    prohibitedComps: [],
    directionSynthesis: 'Lead must be immediately compelling — a character actors want to play and audiences want to watch. Premise is pitchable in one sentence with a clear dramatic question. Conflict is relational and escalating. The story has trailer-ready moments every 15–20 pages. Balance narrative ambition with commercial accessibility. Emotional payoffs are earned through structural setup, not sentimentality.',
    specificity: 6,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function matchesFilter(values: string[], contextValue: string): boolean {
  if (values.length === 0) return true;
  const norm = contextValue.toLowerCase();
  return values.some(v => norm.includes(v.toLowerCase()));
}

function contextMatchScore(
  lanes: string[], genres: string[], budgets: string[], tones: string[], settings: string[],
  ctx: SuggestionContext,
): number {
  let score = 0;
  const laneMatch = matchesFilter(lanes, ctx.lane);
  const genreMatch = matchesFilter(genres, ctx.genre + ' ' + ctx.subgenre);
  const budgetMatch = matchesFilter(budgets, ctx.budgetBand);
  const toneMatch = matchesFilter(tones, ctx.toneAnchor);
  const settingMatch = matchesFilter(settings, ctx.settingType);
  if (!laneMatch || !genreMatch || !budgetMatch || !toneMatch || !settingMatch) return -1;
  // More specific filters = higher score
  if (lanes.length > 0) score += 2;
  if (genres.length > 0) score += 2;
  if (budgets.length > 0) score += 1;
  if (tones.length > 0) score += 1;
  if (settings.length > 0) score += 2;
  return score;
}

// ── Combination Engine ───────────────────────────────────────────────

function selectOptimalMustSet(
  ctx: SuggestionContext,
  bundle: CombinationBundle | null,
  maxCount: number,
): { selected: MustPattern[]; debug: Pick<SuggestionDebug, 'rejectedForRedundancy' | 'rejectedForIncompatibility' | 'dimensionCoverage'> } {
  const boostIds = new Set(bundle?.boostMust ?? []);
  const rejectedRedundancy: string[] = [];
  const rejectedIncompat: string[] = [];

  // Score each pattern for this context
  const candidates = MUST_PATTERNS
    .map(p => {
      const cScore = contextMatchScore(p.lanes, p.genres, p.budgets, p.tones, p.settings, ctx);
      if (cScore < 0) return null;
      const baseScore = (p.ciWeight * 2 + p.gpWeight) / 3;
      const contextBoost = cScore * 0.5;
      const bundleBoost = boostIds.has(p.id) ? 3 : 0;
      // World population density injection
      let densityBoost = 0;
      const density = ctx.worldPopulationDensity || 'minimal';
      if (p.id === 'M_WORLD_POPULATION_MOD' && density === 'moderate') densityBoost = 4;
      if (p.id === 'M_WORLD_POPULATION_RICH' && density === 'rich') densityBoost = 4;
      if (p.id === 'M_WORLD_POPULATION_MOD' && density !== 'moderate') return null;
      if (p.id === 'M_WORLD_POPULATION_RICH' && density !== 'rich') return null;

      return { pattern: p, totalScore: baseScore + contextBoost + bundleBoost + densityBoost };
    })
    .filter(Boolean) as { pattern: MustPattern; totalScore: number }[];

  candidates.sort((a, b) => b.totalScore - a.totalScore);

  // Greedy set selection with dimension coverage, redundancy, and incompatibility checks
  const selected: MustPattern[] = [];
  const selectedIds = new Set<string>();
  const coveredDimensions = new Set<Dimension>();

  for (const c of candidates) {
    if (selected.length >= maxCount) break;
    const p = c.pattern;

    // Redundancy check
    if (p.redundantWith?.some(rid => selectedIds.has(rid))) {
      rejectedRedundancy.push(p.id);
      continue;
    }
    // Incompatibility check
    if (p.incompatibleWith?.some(iid => selectedIds.has(iid))) {
      rejectedIncompat.push(p.id);
      continue;
    }

    // Dimension diversity: if we already have 2 items in this dimension, prefer uncovered
    const dimCount = selected.filter(s => s.dimension === p.dimension).length;
    if (dimCount >= 2 && selected.length < maxCount - 1) {
      // Check if uncovered dimensions exist
      const uncovered = DIMENSIONS.filter(d => !coveredDimensions.has(d));
      if (uncovered.length > 0 && !uncovered.includes(p.dimension)) {
        // Defer — might pick later if nothing better
        continue;
      }
    }

    selected.push(p);
    selectedIds.add(p.id);
    coveredDimensions.add(p.dimension);
  }

  // Fill remaining slots from deferred candidates if still under maxCount
  if (selected.length < maxCount) {
    for (const c of candidates) {
      if (selected.length >= maxCount) break;
      if (selectedIds.has(c.pattern.id)) continue;
      if (c.pattern.redundantWith?.some(rid => selectedIds.has(rid))) continue;
      if (c.pattern.incompatibleWith?.some(iid => selectedIds.has(iid))) continue;
      selected.push(c.pattern);
      selectedIds.add(c.pattern.id);
      coveredDimensions.add(c.pattern.dimension);
    }
  }

  // Apply synergy scoring for ordering (synergy doesn't change the set, just validates)
  const dimensionCoverage: Record<Dimension, boolean> = {} as any;
  for (const d of DIMENSIONS) dimensionCoverage[d] = coveredDimensions.has(d);

  return { selected, debug: { rejectedForRedundancy: rejectedRedundancy, rejectedForIncompatibility: rejectedIncompat, dimensionCoverage } };
}

function selectOptimalAvoidSet(
  ctx: SuggestionContext,
  bundle: CombinationBundle | null,
  selectedMustIds: Set<string>,
  maxCount: number,
): AvoidPattern[] {
  const boostIds = new Set(bundle?.boostAvoid ?? []);

  const candidates = AVOID_PATTERNS
    .map(p => {
      const cScore = contextMatchScore(p.lanes, p.genres, p.budgets, [], [], ctx);
      if (cScore < 0) return null;
      const baseScore = (p.ciPenalty * 2 + p.gpPenalty) / 3;
      const contextBoost = cScore * 0.5;
      const bundleBoost = boostIds.has(p.id) ? 3 : 0;
      // Synergy bonus: if this avoid reinforces a selected must-include
      const synergyBonus = p.reinforces?.some(rid => selectedMustIds.has(rid)) ? 1.5 : 0;
      return { pattern: p, totalScore: baseScore + contextBoost + bundleBoost + synergyBonus };
    })
    .filter(Boolean) as { pattern: AvoidPattern; totalScore: number }[];

  candidates.sort((a, b) => b.totalScore - a.totalScore);

  const selected: AvoidPattern[] = [];
  const selectedIds = new Set<string>();
  const coveredDims = new Set<Dimension>();

  for (const c of candidates) {
    if (selected.length >= maxCount) break;
    const p = c.pattern;
    if (p.redundantWith?.some(rid => selectedIds.has(rid))) continue;
    // Dimension diversity for avoids too
    const dimCount = selected.filter(s => s.dimension === p.dimension).length;
    if (dimCount >= 2 && selected.length < maxCount - 1) {
      const uncovered = DIMENSIONS.filter(d => !coveredDims.has(d));
      if (uncovered.length > 0 && !uncovered.includes(p.dimension)) continue;
    }
    selected.push(p);
    selectedIds.add(p.id);
    coveredDims.add(p.dimension);
  }

  return selected;
}

function selectProhibitedComps(
  ctx: SuggestionContext,
  bundle: CombinationBundle | null,
  maxCount: number,
): string[] {
  // Start with bundle comps
  const comps: string[] = [...(bundle?.prohibitedComps ?? [])];
  const seen = new Set(comps.map(c => c.toLowerCase()));

  // Add from library where steering value is high enough
  const candidates = PROHIBITED_COMP_LIBRARY
    .filter(pc => {
      if (seen.has(pc.title.toLowerCase())) return false;
      const score = contextMatchScore(pc.lanes, pc.genres, pc.budgets, pc.tones, pc.settings, ctx);
      return score >= 0 && pc.steeringValue >= 7;
    })
    .sort((a, b) => b.steeringValue - a.steeringValue);

  for (const c of candidates) {
    if (comps.length >= maxCount) break;
    comps.push(c.title);
  }

  return comps;
}

// ── Direction Synthesis ──────────────────────────────────────────────

function synthesizeDirection(
  ctx: SuggestionContext,
  bundle: CombinationBundle | null,
  selectedMust: MustPattern[],
  selectedAvoid: AvoidPattern[],
): string {
  // If bundle has a synthesized direction, use it as the core
  if (bundle?.directionSynthesis) {
    const density = ctx.worldPopulationDensity || 'minimal';
    if (density === 'moderate') {
      return bundle.directionSynthesis + ' Include light world population — guards, attendants, passersby — to create a lived-in feel without expanding canon.';
    }
    if (density === 'rich') {
      return bundle.directionSynthesis + ' Populate the world richly — multiple layers of social activity in every major scene. Secondary characters reinforce scale and realism. These are atmospheric, not canonical.';
    }
    return bundle.directionSynthesis;
  }

  // No bundle — build synthesis from context
  const parts: string[] = [];

  // Core structural instruction based on covered dimensions
  const dims = new Set(selectedMust.map(m => m.dimension));

  if (dims.has('story_engine')) {
    parts.push('Every scene must advance both external conflict and internal character pressure.');
  }
  if (dims.has('protagonist')) {
    parts.push('The protagonist must drive the story with clear agency — never passive, never waiting.');
  }
  if (dims.has('antagonist')) {
    parts.push('Opposition must be motivated, proximate, and escalating.');
  }
  if (dims.has('world_density')) {
    parts.push('The world must feel inhabited and consequential — characters operate within visible systems.');
  }
  if (dims.has('feasibility')) {
    parts.push('Keep production footprint lean — maximise narrative density per location and cast member.');
  }
  if (dims.has('tonal_stability')) {
    parts.push('Commit to tonal consistency — every beat serves the established register.');
  }
  if (dims.has('commercial')) {
    parts.push('Ensure the premise is hook-clear and commercially distinctive.');
  }

  // Anti-drift from avoid selections
  const avoidDims = new Set(selectedAvoid.map(a => a.dimension));
  if (avoidDims.has('story_engine') && !dims.has('story_engine')) {
    parts.push('Reveal through action and consequence, not exposition.');
  }

  // World density
  const density = ctx.worldPopulationDensity || 'minimal';
  if (density === 'moderate') {
    parts.push('Include light world population — guards, attendants, passersby — to create a lived-in feel without expanding canon.');
  } else if (density === 'rich') {
    parts.push('Populate the world richly — multiple layers of social activity in every major scene. Secondary characters reinforce scale and realism.');
  }

  return parts.join(' ');
}

// ── Bundle Matching ──────────────────────────────────────────────────

function findBestBundle(ctx: SuggestionContext): CombinationBundle | null {
  let best: CombinationBundle | null = null;
  let bestScore = -1;

  for (const b of COMBINATION_BUNDLES) {
    const score = contextMatchScore(b.matchLanes, b.matchGenres, b.matchBudgets, b.matchTones, b.matchSettings, ctx);
    if (score < 0) continue;
    const total = score + b.specificity;
    if (total > bestScore) {
      bestScore = total;
      best = b;
    }
  }

  return best;
}

// ── Public API ───────────────────────────────────────────────────────

export function generateSuggestions(ctx: SuggestionContext): InputSuggestions {
  const bundle = findBestBundle(ctx);

  // 1. Select optimal must-include set (5-6 items, covering dimensions)
  const { selected: mustPatterns, debug: mustDebug } = selectOptimalMustSet(ctx, bundle, 6);
  const mustInclude = mustPatterns.map(p => p.label);
  const mustIds = new Set(mustPatterns.map(p => p.id));

  // 2. Select optimal avoid set (4-5 items, synergistic with must-includes)
  const avoidPatterns = selectOptimalAvoidSet(ctx, bundle, mustIds, 5);
  const avoid = avoidPatterns.map(p => p.label);

  // 3. Select prohibited comps (0-3, only when high steering value)
  const prohibitedComps = selectProhibitedComps(ctx, bundle, 3);

  // 4. Synthesize direction (not fragment-stacked)
  const additionalDirection = synthesizeDirection(ctx, bundle, mustPatterns, avoidPatterns);

  // 5. Debug info
  const _debug: SuggestionDebug = {
    matchedBundle: bundle?.id ?? null,
    selectedMustIds: mustPatterns.map(p => p.id),
    selectedAvoidIds: avoidPatterns.map(p => p.id),
    rejectedForRedundancy: mustDebug.rejectedForRedundancy,
    rejectedForIncompatibility: mustDebug.rejectedForIncompatibility,
    dimensionCoverage: mustDebug.dimensionCoverage,
  };

  return { mustInclude, avoid, prohibitedComps, additionalDirection, _debug };
}

/**
 * Check if context has enough data to generate useful suggestions.
 */
export function canGenerateSuggestions(ctx: Partial<SuggestionContext>): boolean {
  return !!(ctx.genre || ctx.lane || ctx.productionType);
}

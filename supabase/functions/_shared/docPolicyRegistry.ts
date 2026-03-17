/**
 * Document Policy Registry v1
 * Classifies doc types and provides acceptance profiles for the convergence engine.
 * Used by auto-run and (later) doc-os / NUE.
 *
 * INVARIANT: Unknown doc types FAIL CLOSED — no silent defaults.
 */

// ── Doc Class ──
export type DocClass = "UNIT" | "SINGLE" | "AGGREGATE" | "UNKNOWN";

export interface DocPolicy {
  docClass: DocClass;
  /** UNIT docs require meta_json.episode_index for slot identification */
  requiresEpisodeIndex?: boolean;
  /** Acceptance profile key for convergence thresholds */
  acceptanceProfile: string;
}

// ── Acceptance Profiles ──
export interface AcceptanceProfile {
  regressionThreshold: number;   // PROMOTE_DELTA: max drop to auto-promote to is_current
  exploreThreshold: number;      // EXPLORE_DELTA: max drop to continue exploring (without promoting)
  maxFrontierAttempts: number;   // bounded frontier exploration attempts
  minCI: number;
  minGP: number;
}

export const ACCEPTANCE_PROFILES: Record<string, AcceptanceProfile> = {
  UNIT_PROFILE_DEFAULT:   { regressionThreshold: 5, exploreThreshold: 15, maxFrontierAttempts: 3, minCI: 0, minGP: 0 },
  SINGLE_PROFILE_DEFAULT: { regressionThreshold: 5, exploreThreshold: 15, maxFrontierAttempts: 3, minCI: 0, minGP: 0 },
  AGG_PROFILE_DEFAULT:    { regressionThreshold: 0, exploreThreshold: 0,  maxFrontierAttempts: 0, minCI: 0, minGP: 0 },
};

// ── Registry ──
const REGISTRY: Record<string, DocPolicy> = {
  // UNIT docs (per-episode)
  episode_outline:  { docClass: "UNIT", requiresEpisodeIndex: true, acceptanceProfile: "UNIT_PROFILE_DEFAULT" },
  episode_script:   { docClass: "UNIT", requiresEpisodeIndex: true, acceptanceProfile: "UNIT_PROFILE_DEFAULT" },

  // SINGLE docs — every ladder doc type must be registered here
  concept_brief:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  logline:          { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  idea:             { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  treatment:        { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  story_outline:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  character_bible:  { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  feature_script:   { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  beat_sheet:       { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  production_draft: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  // NOTE: "blueprint" and "script" are ALIASES, not canonical doc types.
  // They must be resolved via resolveDocType() BEFORE policy lookup.
  // Do NOT register aliases here — registry is canonical-type only.
  deck:             { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  market_sheet:     { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  season_arc:       { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  format_rules:     { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  documentary_outline: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  vertical_episode_beats: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  vertical_market_sheet: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  // PATCH 1: season_script + episode_beats — previously missing, caused DOC_TYPE_UNREGISTERED halts
  season_script:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  episode_beats:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  // Seed / support doc types that auto-run may encounter
  project_overview: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  creative_brief:   { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  market_positioning: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  canon:            { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  nec:              { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },

  // AGGREGATE docs (compile-only — no LLM rewrites)
  episode_grid:           { docClass: "AGGREGATE", acceptanceProfile: "AGG_PROFILE_DEFAULT" },
  season_master_script:   { docClass: "AGGREGATE", acceptanceProfile: "AGG_PROFILE_DEFAULT" },
  // complete_season_script removed — season_script is now terminal for VD
};

/**
 * Soft lookup — returns UNKNOWN policy for unregistered types.
 * Use requireDocPolicy() for write paths that must fail closed.
 */
export function getDocPolicy(docType: string): DocPolicy & { registered: boolean } {
  const p = REGISTRY[docType];
  if (p) return { ...p, registered: true };
  return { docClass: "UNKNOWN", acceptanceProfile: "SINGLE_PROFILE_DEFAULT", registered: false };
}

/**
 * FAIL-CLOSED lookup — throws if doc type is not in registry.
 * Must be used on all write/rewrite paths.
 */
export function requireDocPolicy(docType: string): DocPolicy {
  const p = REGISTRY[docType];
  if (!p) throw new Error(`DOC_TYPE_UNREGISTERED:${docType}`);
  return p;
}

/**
 * Check if doc type is AGGREGATE (compile-only). Uses docClass, not compileOnly flag.
 * Throws if doc type is unregistered.
 */
export function isAggregate(docType: string): boolean {
  return requireDocPolicy(docType).docClass === "AGGREGATE";
}

export function getRegressionThreshold(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.regressionThreshold ?? 5;
}

export function getExploreThreshold(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.exploreThreshold ?? 15;
}

export function getMaxFrontierAttempts(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.maxFrontierAttempts ?? 3;
}

/**
 * PATCH 1b: Ladder integrity validator.
 * Validates all doc_types in a format ladder are registered in the policy registry.
 * Returns { valid: true } or { valid: false, missing: string[] }.
 */
export function validateLadderIntegrity(ladder: string[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const docType of ladder) {
    if (!REGISTRY[docType]) {
      missing.push(docType);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * PATCH 4: Deterministic canon alignment validator.
 * Validates generated content contains expected entities from canon sources.
 * Returns { pass: boolean, entityCoverage: number, foreignEntities: string[] }.
 */
export function validateCanonAlignment(
  generatedText: string,
  canonEntities: string[],
  opts: { minCoverage?: number; maxForeignRatio?: number } = {}
): { pass: boolean; entityCoverage: number; matchedEntities: string[]; missingEntities: string[]; foreignEntities: string[]; reason?: string } {
  const minCoverage = opts.minCoverage ?? 0.6;
  const maxForeignRatio = opts.maxForeignRatio ?? 0.5;

  if (!canonEntities.length) {
    return { pass: true, entityCoverage: 1, matchedEntities: [], missingEntities: [], foreignEntities: [], reason: "no_canon_entities" };
  }

  const textLower = generatedText.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];

  for (const entity of canonEntities) {
    if (!entity || entity.length < 2) continue;
    if (textLower.includes(entity.toLowerCase())) {
      matched.push(entity);
    } else {
      missing.push(entity);
    }
  }

  const coverage = matched.length / canonEntities.length;

  // Extract capitalized multi-word names from generated text (simple heuristic)
  const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const foundNames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(generatedText)) !== null) {
    foundNames.add(match[0]);
  }

  // Common structural/generic phrases that are NOT character names
  const GENERIC_PHRASES = new Set([
    "the hook", "the conflict", "the stakes", "the resolution", "the climax",
    "the premise", "the concept", "the logline", "the theme", "the tone",
    "the world", "the setting", "the format", "the audience", "the market",
    "the vertical experience", "the memory fold", "the inciting incident",
    "the midpoint", "the turning point", "the denouement", "the epilogue",
    "act one", "act two", "act three", "cold open", "the reveal",
    "as akari", "but kaito", "crimson crane", // contextual phrase fragments
  ]);

  // Filter out canon entities and generic phrases to find truly foreign ones
  const canonLower = new Set(canonEntities.map(e => e.toLowerCase()));
  const foreign: string[] = [];
  for (const name of foundNames) {
    const lower = name.toLowerCase();
    if (canonLower.has(lower)) continue;
    if (GENERIC_PHRASES.has(lower)) continue;
    // Skip phrases starting with common articles/prepositions that indicate structural text
    if (/^(The|A|An|In|On|At|By|For|With|From|But|And|Or|As|To)\s/i.test(name) && name.split(/\s+/).length <= 3) continue;
    // Skip if any canon entity is a substring match
    let partialMatch = false;
    for (const ce of canonLower) {
      if (lower.includes(ce) || ce.includes(lower)) { partialMatch = true; break; }
    }
    if (partialMatch) continue;
    foreign.push(name);
  }

  const foreignRatio = foundNames.size > 0 ? foreign.length / foundNames.size : 0;

  const pass = coverage >= minCoverage && foreignRatio <= maxForeignRatio;

  return {
    pass,
    entityCoverage: Math.round(coverage * 100) / 100,
    matchedEntities: matched,
    missingEntities: missing,
    foreignEntities: foreign,
    reason: !pass
      ? (coverage < minCoverage ? `entity_coverage_${Math.round(coverage * 100)}%_below_${Math.round(minCoverage * 100)}%` : `foreign_entity_ratio_${Math.round(foreignRatio * 100)}%_above_${Math.round(maxForeignRatio * 100)}%`)
      : undefined,
  };
}

// ── PATCH 4: Canon alignment gate for auto-run completion ──

/**
 * Extract canon entity names from document plaintext using deterministic heuristics.
 * Looks for: **Name**, # Name, UPPERCASE NAME, Name: patterns.
 */
// Structural/meta terms commonly found as section headers in character bibles,
// treatments, etc. — these are NOT narrative entities and must be excluded.
const STRUCTURAL_TERMS = new Set([
  "WORLD RULES", "ROLE", "PHYSICAL DESCRIPTION", "BACKSTORY", "MOTIVATION",
  "PERSONALITY", "TRAITS", "GOALS", "SECRETS", "RELATIONSHIPS", "APPEARANCE",
  "DESCRIPTION", "OVERVIEW", "SUMMARY", "BACKGROUND", "HISTORY", "ARC",
  "CHARACTER ARC", "INTERNAL CONFLICT", "EXTERNAL CONFLICT", "CONFLICT",
  "STAKES", "THEME", "TONE", "STYLE", "FORMAT", "GENRE", "SETTING",
  "LOCATION", "LOCATIONS", "TIMELINE", "PREMISE", "LOGLINE", "CONCEPT",
  "SYNOPSIS", "TREATMENT", "OUTLINE", "NOTES", "DIALOGUE STYLE",
  "VOICE", "MANNERISMS", "FLAWS", "STRENGTHS", "WEAKNESSES",
  "EMOTIONAL ARC", "TRANSFORMATION", "WANT", "NEED", "FEAR",
  "OCCUPATION", "AGE", "GENDER", "ETHNICITY", "NATIONALITY",
  "KEY RELATIONSHIPS", "FAMILY", "ALLIES", "ENEMIES", "MENTOR",
  "FORBIDDEN CHANGES", "LOCKED FACTS", "ONGOING THREADS",
  "FORMAT CONSTRAINTS", "TONE AND STYLE", "TONE STYLE",
  "ACT ONE", "ACT TWO", "ACT THREE", "COLD OPEN", "TEASER",
  "INCITING INCIDENT", "MIDPOINT", "CLIMAX", "RESOLUTION", "DENOUEMENT",
]);

function isStructuralTerm(name: string): boolean {
  return STRUCTURAL_TERMS.has(name.toUpperCase().trim());
}

function extractEntitiesFromText(text: string): string[] {
  if (!text) return [];
  const entities = new Set<string>();

  // **Name** patterns — use [ \t] (not \s) to prevent cross-line captures
  for (const m of text.matchAll(/\*\*([A-Z][A-Za-z \t'-]{1,30}?)\*\*/g)) {
    const name = m[1].trim();
    if (!isStructuralTerm(name)) entities.add(name);
  }
  // # Name or ## Name headers — anchor to single line content only
  for (const m of text.matchAll(/^#+[ \t]*([A-Z][A-Za-z \t'-]{1,30})/gm)) {
    const name = m[1].trim();
    if (!isStructuralTerm(name)) entities.add(name);
  }
  // UPPERCASE NAME (2-25 chars) at start of line followed by : or (
  for (const m of text.matchAll(/^([A-Z][A-Z \t'-]{1,24})[ \t]*[(:]/gm)) {
    const name = m[1].trim();
    if (name.length >= 2 && !name.includes("SCENE") && !name.includes("FADE") && !name.includes("CUT") && !isStructuralTerm(name)) {
      entities.add(name);
    }
  }
  return [...entities];
}

/**
 * Strip the "WORLD CHARACTERS (NON-CANONICAL)" section and everything after it
 * from character_bible text to prevent non-canonical world characters from
 * entering the canon entity set.
 */
function stripWorldCharactersSection(text: string): string {
  // Match common heading patterns for the world characters section
  const patterns = [
    /^#{1,3}\s+WORLD CHARACTERS\b.*$/mi,
    /^#{1,3}\s+World Characters\b.*$/mi,
    /^\*\*WORLD CHARACTERS\b.*$/mi,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m.index !== undefined) {
      return text.slice(0, m.index).trimEnd();
    }
  }
  return text;
}

/**
 * Build canon entity list from DB current versions of key doc types.
 * Sources (in order): canon, character_bible, vertical_episode_beats, season_arc.
 * Returns null if no source docs found (caller should use INPUT_INCOMPLETE stop).
 *
 * For character_bible: strips the "WORLD CHARACTERS" section to prevent
 * non-canonical world characters from entering the entity set.
 */
export async function buildCanonEntitiesFromDB(
  supabase: any,
  projectId: string,
): Promise<{ entities: string[]; sources: string[] } | null> {
  const CANON_SOURCE_TYPES = ["canon", "character_bible", "vertical_episode_beats", "season_arc"];
  const entities: string[] = [];
  const sources: string[] = [];

  for (const docType of CANON_SOURCE_TYPES) {
    const { data: doc } = await supabase
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!doc) continue;

    const { data: ver } = await supabase
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", doc.id)
      .eq("is_current", true)
      .maybeSingle();

    if (ver?.plaintext) {
      // Strip world characters section from character_bible to prevent
      // non-canonical entities entering the canon entity set
      const textForExtraction = docType === "character_bible"
        ? stripWorldCharactersSection(ver.plaintext)
        : ver.plaintext;
      const docEntities = extractEntitiesFromText(textForExtraction);
      entities.push(...docEntities);
      sources.push(docType);
    }
  }

  if (entities.length === 0 && sources.length === 0) return null;
  // Deduplicate
  return { entities: [...new Set(entities)], sources };
}

/**
 * Run canon alignment validation for a given document against project canon.
 * Returns alignment result or null if no canon sources exist.
 */
export async function runCanonAlignmentGate(
  supabase: any,
  projectId: string,
  generatedText: string,
): Promise<{ pass: boolean; result: ReturnType<typeof validateCanonAlignment>; sources: string[] } | null> {
  const canon = await buildCanonEntitiesFromDB(supabase, projectId);
  if (!canon) return null; // No canon sources — caller decides policy

  const result = validateCanonAlignment(generatedText, canon.entities);
  return { pass: result.pass, result, sources: canon.sources };
}

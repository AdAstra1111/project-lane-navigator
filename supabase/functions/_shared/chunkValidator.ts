/**
 * Chunk Validator — Hard enforcement against summarization/truncation.
 *
 * Runs after chunk assembly AND on individual chunks.
 * Detects: missing episodes, banned language, missing sections, incomplete schemas.
 *
 * Used by: generate-document, dev-engine-v2, auto-run, chunk runner.
 */

// ── Types ──

export interface ValidationResult {
  pass: boolean;
  failures: ValidationFailure[];
  missingIndices: number[];
  missingSections: string[];
  bannedPhraseHits: string[];
  repairAction: "none" | "regen_missing" | "regen_all";
}

export interface ValidationFailure {
  type: "missing_episode" | "missing_section" | "banned_phrase" | "density_low" | "wrong_content_type" | "incomplete_schema";
  detail: string;
  indices?: number[];
  sections?: string[];
}

// ── Banned Phrases ──

const BANNED_PHRASES = [
  "remaining episodes follow a similar",
  "remaining episodes",
  "and so on",
  "episodes follow the same",
  "continue in a similar",
  "topline narrative",
  "# TOPLINE NARRATIVE",
  "highlights only",
  "selected highlights",
  "key episodes",
  "anchor episodes",
  "summary of episodes",
  "episodes can be summarized",
  "for brevity",
  "condensed version",
  "abbreviated version",
  "rest of the episodes",
  "the remaining",
  "episodes follow this pattern",
  "similar structure continues",
  "this pattern repeats",
  "etc.",
  "…and more",
];

const BANNED_PATTERNS = [
  /episodes?\s+\d+[\s–\-—]+\d+\s*(follow|continue|are similar|share|mirror)/i,
  /eps?\s+\d+[\s–\-—]+\d+:\s*(same|similar|as above|see above)/i,
  /\(episodes?\s+\d+[\s–\-—]+\d+\s+(omitted|skipped|summarized)\)/i,
];

// ── Topline Content Detection ──

const TOPLINE_MARKERS = [
  "## LOGLINE",
  "## SHORT SYNOPSIS",
  "## LONG SYNOPSIS",
  "## STORY PILLARS",
  "# TOPLINE NARRATIVE",
];

// ── Episode Number Extraction ──

function extractEpisodeNumbers(text: string): number[] {
  const patterns = [
    /(?:^|\n)\s*#{1,4}\s*(?:EPISODE|EP\.?)\s*(\d+)/gim,
    /\*\*\s*(?:EPISODE|EP\.?)\s*(\d+)/gim,
    /(?:^|\n)\s*(?:EPISODE|EP\.?)\s*(\d+)\s*[:\-–—]/gim,
  ];

  const found = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.add(parseInt(match[1], 10));
    }
  }
  return [...found].sort((a, b) => a - b);
}

// ── Collapsed Range Detection ──

function detectCollapsedRanges(text: string): string[] {
  const hits: string[] = [];
  const pattern = /episodes?\s+(\d+)[\s–\-—]+(\d+)/gi;
  for (const match of text.matchAll(pattern)) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    if (end - start >= 3) {
      hits.push(match[0]);
    }
  }
  return hits;
}

// ── Section Heading Detection ──

function findSectionHeadings(content: string): Set<string> {
  const found = new Set<string>();
  // Match markdown headings and normalize to lowercase/underscore
  const headingPattern = /^#{1,4}\s+(.+)$/gm;
  for (const match of content.matchAll(headingPattern)) {
    const normalized = match[1].trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    found.add(normalized);
  }
  // Also match bold section markers
  const boldPattern = /\*\*([A-Z][A-Z\s:]+)\*\*/g;
  for (const match of content.matchAll(boldPattern)) {
    const normalized = match[1].trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    found.add(normalized);
  }
  return found;
}

// ── Public API ──

/**
 * Validate episodic content for completeness.
 */
export function validateEpisodicContent(
  content: string,
  expectedCount: number,
  docType: string = "episode_grid"
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const bannedHits: string[] = [];

  // 1. Extract episode numbers present
  const foundEpisodes = extractEpisodeNumbers(content);
  const expectedSet = new Set(Array.from({ length: expectedCount }, (_, i) => i + 1));
  const foundSet = new Set(foundEpisodes);
  const missingIndices = [...expectedSet].filter(n => !foundSet.has(n));

  if (missingIndices.length > 0) {
    failures.push({
      type: "missing_episode",
      detail: `Missing ${missingIndices.length} of ${expectedCount} episodes: ${missingIndices.slice(0, 10).join(", ")}${missingIndices.length > 10 ? "..." : ""}`,
      indices: missingIndices,
    });
  }

  // 2. Banned phrase scan
  const lowerContent = content.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowerContent.includes(phrase.toLowerCase())) {
      bannedHits.push(phrase);
    }
  }
  for (const pattern of BANNED_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      bannedHits.push(match[0]);
    }
  }
  if (bannedHits.length > 0) {
    failures.push({
      type: "banned_phrase",
      detail: `Found ${bannedHits.length} banned summarization phrases: ${bannedHits.slice(0, 5).join("; ")}`,
    });
  }

  // 3. Collapsed range detection
  const collapsed = detectCollapsedRanges(content);
  if (collapsed.length > 0) {
    failures.push({
      type: "incomplete_schema",
      detail: `Detected ${collapsed.length} collapsed episode range(s): ${collapsed.slice(0, 3).join(", ")}`,
    });
  }

  // 4. Wrong content type
  if (docType !== "topline_narrative") {
    const toplineHits = TOPLINE_MARKERS.filter(m => content.includes(m));
    if (toplineHits.length >= 2) {
      failures.push({
        type: "wrong_content_type",
        detail: `Content resembles a Topline Narrative (found ${toplineHits.length} markers). Wrong content for ${docType}.`,
      });
    }
  }

  // 5. Density check
  if (foundEpisodes.length > 0 && expectedCount > 0) {
    const avgCharsPerEp = content.length / foundEpisodes.length;
    const minCharsPerEp = docType.includes("script") ? 800 : 100;
    if (avgCharsPerEp < minCharsPerEp) {
      failures.push({
        type: "density_low",
        detail: `Average ${Math.round(avgCharsPerEp)} chars/episode — below minimum ${minCharsPerEp} for ${docType}`,
      });
    }
  }

  const repairAction = missingIndices.length > 0
    ? "regen_missing"
    : failures.length > 0
    ? "regen_all"
    : "none";

  return {
    pass: failures.length === 0,
    failures,
    missingIndices,
    missingSections: [],
    bannedPhraseHits: bannedHits,
    repairAction,
  };
}

/**
 * Validate a single chunk of episodic content.
 */
export function validateEpisodicChunk(
  chunkContent: string,
  expectedEpisodes: number[],
  docType: string = "episode_grid"
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const bannedHits: string[] = [];

  const foundEpisodes = extractEpisodeNumbers(chunkContent);
  const foundSet = new Set(foundEpisodes);
  const missingIndices = expectedEpisodes.filter(n => !foundSet.has(n));

  if (missingIndices.length > 0) {
    failures.push({
      type: "missing_episode",
      detail: `Chunk missing episodes: ${missingIndices.join(", ")}`,
      indices: missingIndices,
    });
  }

  const lowerContent = chunkContent.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowerContent.includes(phrase.toLowerCase())) {
      bannedHits.push(phrase);
    }
  }
  if (bannedHits.length > 0) {
    failures.push({
      type: "banned_phrase",
      detail: `Chunk contains banned phrases: ${bannedHits.slice(0, 3).join("; ")}`,
    });
  }

  return {
    pass: failures.length === 0,
    failures,
    missingIndices,
    missingSections: [],
    bannedPhraseHits: bannedHits,
    repairAction: missingIndices.length > 0 ? "regen_missing" : failures.length > 0 ? "regen_all" : "none",
  };
}

/**
 * Validate sectioned content (scripts, treatments, bibles).
 * NOW checks actual section completeness against expected sections.
 */
export function validateSectionedContent(
  content: string,
  expectedSections: string[],
  docType: string
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const bannedHits: string[] = [];
  const missingSections: string[] = [];

  // 1. Check for banned phrases
  const lowerContent = content.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowerContent.includes(phrase.toLowerCase())) {
      bannedHits.push(phrase);
    }
  }
  if (bannedHits.length > 0) {
    failures.push({
      type: "banned_phrase",
      detail: `Found banned summarization phrases: ${bannedHits.slice(0, 5).join("; ")}`,
    });
  }

  // 2. Wrong content type check
  if (docType !== "topline_narrative") {
    const toplineHits = TOPLINE_MARKERS.filter(m => content.includes(m));
    if (toplineHits.length >= 2) {
      failures.push({
        type: "wrong_content_type",
        detail: `Content resembles a Topline Narrative, wrong for ${docType}.`,
      });
    }
  }

  // 3. TRUE SECTION COMPLETENESS CHECK
  const foundHeadings = findSectionHeadings(content);
  for (const expectedSection of expectedSections) {
    const normalized = expectedSection.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    // Check if any found heading contains or matches the expected section key
    const found = [...foundHeadings].some(h => 
      h.includes(normalized) || normalized.includes(h) || h === normalized
    );
    // Also do a simple content search for the section name
    const altFound = lowerContent.includes(normalized.replace(/_/g, " "));
    if (!found && !altFound) {
      missingSections.push(expectedSection);
    }
  }

  if (missingSections.length > 0) {
    failures.push({
      type: "missing_section",
      detail: `Missing ${missingSections.length} section(s): ${missingSections.join(", ")}`,
      sections: missingSections,
    });
  }

  // 4. Script structure checks
  if (docType.includes("script") || docType === "screenplay_draft" || docType === "production_draft") {
    const sluglineCount = (content.match(/^(INT\.|EXT\.|INT\/EXT\.)\s/gm) || []).length;
    if (sluglineCount < 3) {
      failures.push({
        type: "incomplete_schema",
        detail: `Script has only ${sluglineCount} scene headings — expected at least 3`,
      });
    }
    const dialogueBlocks = (content.match(/^[A-Z][A-Z\s]+$/gm) || []).length;
    if (dialogueBlocks < 5) {
      failures.push({
        type: "density_low",
        detail: `Script has only ${dialogueBlocks} dialogue character names — expected at least 5`,
      });
    }
  }

  const repairAction = missingSections.length > 0
    ? "regen_missing"
    : failures.length > 0
    ? "regen_all"
    : "none";

  return {
    pass: failures.length === 0,
    failures,
    missingIndices: [],
    missingSections,
    bannedPhraseHits: bannedHits,
    repairAction,
  };
}

/**
 * Quick check: does content contain banned summarization language?
 */
export function hasBannedSummarizationLanguage(content: string): boolean {
  const lower = content.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return true;
  }
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

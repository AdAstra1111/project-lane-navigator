/**
 * Deterministic text builders for embedding generation.
 * All outputs are stable, normalized, and reproducible.
 */

// ─── Helpers ───

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeTags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return [...tags]
    .map(t => t.toLowerCase().replace(/[\s-]+/g, "_").trim())
    .filter(Boolean)
    .sort()
    .join(", ");
}

/** Deterministic truncation: head + tail with marker */
export function truncateText(text: string, maxLen = 20000): string {
  if (text.length <= maxLen) return text;
  const headLen = Math.floor(maxLen * 0.8);
  const tailLen = maxLen - headLen - 30; // 30 for marker
  return text.slice(0, headLen) + "\n[...TRUNCATED...]\n" + text.slice(-tailLen);
}

/** SHA-256 hex hash (Deno native) */
export async function sha256Hash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Project Vector Types → doc_type mapping ───

export const PROJECT_VECTOR_DOC_MAP: Record<string, string[]> = {
  logline: ["concept_brief", "creative_brief", "idea"],
  summary: ["topline_narrative", "concept_brief", "project_overview", "story_outline"],
  treatment: ["treatment"],
  character_dna: ["character_bible"],
  market_positioning: ["market_positioning", "market_sheet", "concept_brief"],
  creative_brief: ["creative_brief", "concept_brief"],
};

export const ALL_PROJECT_VECTOR_TYPES = Object.keys(PROJECT_VECTOR_DOC_MAP);

// ─── Trend Signal Embedding Text ───

export function buildTrendSignalEmbeddingText(signal: {
  name: string;
  explanation: string;
  description?: string;
  dimension?: string;
  modality?: string;
  category?: string;
  cycle_phase?: string;
  production_type?: string;
  genre_tags?: string[];
  tone_tags?: string[];
  format_tags?: string[];
  style_tags?: string[];
  narrative_tags?: string[];
  signal_tags?: string[];
  tags?: string[];
}): string {
  const parts: string[] = [];

  parts.push(`signal: ${signal.name}`);
  if (signal.dimension) parts.push(`dimension: ${signal.dimension}`);
  if (signal.modality) parts.push(`modality: ${signal.modality}`);
  if (signal.category) parts.push(`category: ${signal.category}`);
  if (signal.cycle_phase) parts.push(`cycle_phase: ${signal.cycle_phase}`);
  if (signal.production_type) parts.push(`production_type: ${signal.production_type}`);

  // Explanation (primary semantic content)
  parts.push(`explanation: ${signal.explanation}`);
  if (signal.description) parts.push(`description: ${signal.description}`);

  // All taxonomy tags, sorted and normalized
  const tagGroups = [
    ["genre", signal.genre_tags],
    ["tone", signal.tone_tags],
    ["format", signal.format_tags],
    ["style", signal.style_tags],
    ["narrative", signal.narrative_tags],
    ["signal", signal.signal_tags],
    ["tags", signal.tags],
  ] as const;

  for (const [label, tags] of tagGroups) {
    const normalized = normalizeTags(tags as string[] | undefined);
    if (normalized) parts.push(`${label}_tags: ${normalized}`);
  }

  return normalizeWhitespace(parts.join(". "));
}

// ─── Project Embedding Text ───

/**
 * Build embedding text for a specific project vector surface.
 * Takes pre-fetched doc texts keyed by doc_type.
 */
export function buildProjectEmbeddingText(
  vectorType: string,
  projectTitle: string,
  projectGenre: string | null,
  projectFormat: string | null,
  docTexts: Record<string, string>,
): string | null {
  const docTypes = PROJECT_VECTOR_DOC_MAP[vectorType];
  if (!docTypes) return null;

  // Find first available doc text in priority order
  let sourceText: string | null = null;
  let sourceDocType: string | null = null;
  for (const dt of docTypes) {
    if (docTexts[dt] && docTexts[dt].trim().length > 10) {
      sourceText = docTexts[dt];
      sourceDocType = dt;
      break;
    }
  }

  if (!sourceText) return null;

  const parts: string[] = [];
  parts.push(`project: ${projectTitle}`);
  if (projectGenre) parts.push(`genre: ${projectGenre}`);
  if (projectFormat) parts.push(`format: ${projectFormat}`);
  parts.push(`vector_surface: ${vectorType}`);
  parts.push(`source_doc_type: ${sourceDocType}`);
  parts.push(`content: ${sourceText}`);

  return truncateText(normalizeWhitespace(parts.join(". ")));
}

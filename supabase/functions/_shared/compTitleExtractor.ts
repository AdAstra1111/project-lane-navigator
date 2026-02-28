/**
 * Deterministic comparable title extractor.
 * Parses project document plaintext to find mentioned comparable titles.
 * No LLM required — pure regex/heuristic extraction.
 */

export interface ExtractedComp {
  raw_text: string;
  title: string;
  normalized_title: string;
  kind: string; // film, series, vertical, kdrama, unknown
  confidence: number;
}

export interface ExtractionResult {
  candidates: ExtractedComp[];
  scanned_chars: number;
  drop_reasons: string[];
}

// ── Kind inference from suffix tags ──
const KIND_MAP: Record<string, string> = {
  film: "film",
  movie: "film",
  feature: "film",
  "feature film": "film",
  series: "series",
  "tv series": "series",
  "tv show": "series",
  show: "series",
  "limited series": "series",
  miniseries: "series",
  "mini-series": "series",
  "k-drama": "series",
  kdrama: "series",
  "korean drama": "series",
  "j-drama": "series",
  drama: "series",
  "web series": "vertical",
  "short-form": "vertical",
  vertical: "vertical",
  "vertical drama": "vertical",
  documentary: "film",
  doc: "film",
  "doc series": "series",
  "documentary series": "series",
  anime: "series",
  "anime film": "film",
  special: "film",
};

function inferKind(tag: string): string {
  const normalized = tag.toLowerCase().trim();
  return KIND_MAP[normalized] || "unknown";
}

// ── Normalization ──
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[""''`]/g, "")              // strip quotes
    .replace(/\s*\([^)]*\)\s*/g, " ")     // strip parenthetical tags
    .replace(/\s*\[[^\]]*\]\s*/g, " ")    // strip bracketed tags
    .replace(/[—–-]\s*$/, "")             // strip trailing dashes
    .replace(/[.,;:!?]+$/, "")            // strip trailing punctuation
    .replace(/\s+/g, " ")                 // collapse whitespace
    .trim();
}

// ── Patterns ──

// ### Title (Tag) or ## Title (Tag)
const HEADING_PATTERN = /^#{1,4}\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/;

// **Title** (Tag) or *Title* (Tag) — bold/italic markers
const BOLD_PATTERN = /^\*{1,2}(.+?)\*{1,2}(?:\s*\(([^)]+)\))?\s*$/;

// - Title (Tag) or * Title (Tag) or 1. Title (Tag) — list items
const LIST_PATTERN = /^(?:[-*•]|\d+[.)]\s)\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/;

// "Comparable: Title" or "Comp: Title" or "Reference: Title"
const LABELED_PATTERN = /^(?:Comparable|Comp|Reference|Similar to|See also|Ref)\s*[:—–-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/i;

// Title — description (em-dash prefix)
const EMDASH_PATTERN = /^(.+?)\s*[—–]\s+.{10,}$/;

// Inline mentions: "films like Title (Year)" or "inspired by Title"
const INLINE_LIKE_PATTERN = /(?:like|such as|inspired by|similar to|reminiscent of|echoes of|in the vein of)\s+[""]?([A-Z][A-Za-z0-9\s':&!,.-]+?)[""]?\s*(?:\((\d{4})\)|\(([^)]+)\))?(?:[,;.]|\s+and\s|\s*$)/gi;

// Title (Year) pattern — common inline reference
const TITLE_YEAR_PATTERN = /(?:^|[,;]\s*)([A-Z][A-Za-z0-9\s':&!.-]{2,40})\s*\((\d{4})\)/g;

// Minimum title length and blocklist
const MIN_TITLE_LENGTH = 2;
const BLOCKLIST = new Set([
  "act", "scene", "episode", "chapter", "section", "part", "draft",
  "version", "revision", "note", "notes", "summary", "overview",
  "introduction", "conclusion", "appendix", "table of contents",
  "character", "characters", "setting", "plot", "theme", "themes",
  "genre", "tone", "audience", "budget", "schedule", "timeline",
  "the end", "fade in", "fade out", "cut to", "int", "ext",
  "comparable", "comparables", "reference", "references",
  "film", "series", "vertical", "drama", "treatment",
]);

function isBlocklisted(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (lower.length < MIN_TITLE_LENGTH) return true;
  if (BLOCKLIST.has(lower)) return true;
  // Pure numbers or single words < 3 chars
  if (/^\d+$/.test(lower)) return true;
  // Too generic
  if (/^(the|a|an)\s*$/i.test(lower)) return true;
  return false;
}

/**
 * Extract comparable titles from document plaintext.
 */
export function extractCompsFromText(text: string): ExtractionResult {
  const seen = new Set<string>();
  const candidates: ExtractedComp[] = [];
  const dropReasons: string[] = [];

  function addCandidate(raw: string, title: string, kindTag: string | undefined, confidence: number) {
    const normalized = normalizeTitle(title);
    if (isBlocklisted(normalized)) {
      dropReasons.push(`Blocked: "${title}" (generic/blocklisted)`);
      return;
    }
    if (normalized.length < MIN_TITLE_LENGTH) {
      dropReasons.push(`Too short: "${title}"`);
      return;
    }
    if (seen.has(normalized)) {
      return; // de-dup silently
    }
    seen.add(normalized);

    const kind = kindTag ? inferKind(kindTag) : "unknown";
    candidates.push({ raw_text: raw.trim(), title: title.trim(), normalized_title: normalized, kind, confidence });
  }

  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Heading pattern: ### Title (Film)
    let m = trimmed.match(HEADING_PATTERN);
    if (m) {
      addCandidate(trimmed, m[1].trim(), m[2], 0.9);
      continue;
    }

    // Bold pattern: **Title** (Film)
    m = trimmed.match(BOLD_PATTERN);
    if (m) {
      addCandidate(trimmed, m[1].trim(), m[2], 0.85);
      continue;
    }

    // Labeled pattern: Comparable: Title
    m = trimmed.match(LABELED_PATTERN);
    if (m) {
      addCandidate(trimmed, m[1].trim(), m[2], 0.9);
      continue;
    }

    // List item pattern: - Title (Film)
    m = trimmed.match(LIST_PATTERN);
    if (m && m[2]) {
      // Only if it has a kind tag — otherwise list items are too noisy
      addCandidate(trimmed, m[1].trim(), m[2], 0.8);
      continue;
    }
  }

  // Inline patterns across entire text
  let inlineMatch: RegExpExecArray | null;

  // "like Title (Year)" patterns
  INLINE_LIKE_PATTERN.lastIndex = 0;
  while ((inlineMatch = INLINE_LIKE_PATTERN.exec(text)) !== null) {
    const title = inlineMatch[1].trim();
    const yearOrKind = inlineMatch[2] || inlineMatch[3];
    const isYear = yearOrKind && /^\d{4}$/.test(yearOrKind);
    addCandidate(inlineMatch[0].trim(), title, isYear ? undefined : yearOrKind, 0.7);
  }

  // Title (Year) patterns
  TITLE_YEAR_PATTERN.lastIndex = 0;
  while ((inlineMatch = TITLE_YEAR_PATTERN.exec(text)) !== null) {
    const title = inlineMatch[1].trim();
    // Skip if it looks like a sentence fragment
    if (title.split(" ").length > 6) continue;
    addCandidate(inlineMatch[0].trim(), title, undefined, 0.6);
  }

  return { candidates, scanned_chars: text.length, drop_reasons: dropReasons };
}

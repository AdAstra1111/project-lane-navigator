/**
 * Section Repair Engine — Phase 2D
 *
 * Deterministic section extraction, replacement, and issue-to-section
 * resolution for supported document types.
 *
 * Fail-closed: if a section cannot be resolved or extracted with confidence,
 * returns a full_doc_fallback result rather than guessing.
 *
 * NOTE: Phase 2D applies to auto-run repair flow only.
 * Manual rewrite path is NOT yet wired.
 */

import {
  getSectionConfig,
  findSectionDef,
  type SectionDefinition,
  type DocTypeSectionConfig,
} from "./deliverableSectionRegistry.ts";

// ── Types ──

export interface SectionBoundary {
  section_key: string;
  start_line: number;
  end_line: number;
  heading_line: string;
  content: string;
}

export type RepairTargetType = "section" | "full_doc";

export interface RepairTarget {
  repair_target_type: RepairTargetType;
  section_key: string | null;
  section_label: string | null;
  reason: string;
  fallback_reason: string | null;
  section_content: string | null;
  /** Full document content (always passed through for fallback path) */
  full_content: string;
}

export interface SectionReplaceResult {
  success: boolean;
  new_content: string;
  repair_target_type: RepairTargetType;
  section_key: string | null;
  reason: string;
  sections_found: number;
  sections_total: number;
}

// ── Section Parsing ──

/**
 * Parse a document into section boundaries using the registry definitions.
 * Uses heading_regex match mode to find section boundaries.
 *
 * Returns sections in document order. Lines between the document start and
 * the first matched heading are captured as a "__preamble" pseudo-section.
 */
export function parseSections(
  content: string,
  docType: string,
): SectionBoundary[] {
  const config = getSectionConfig(docType);
  if (!config || config.sections.length === 0) return [];

  const lines = content.split("\n");
  const boundaries: SectionBoundary[] = [];

  // Build compiled patterns
  const compiledSections: Array<{ def: SectionDefinition; regex: RegExp }> = [];
  for (const sec of config.sections) {
    if (sec.match_mode === "heading_regex") {
      try {
        compiledSections.push({ def: sec, regex: new RegExp(sec.match_pattern, "i") });
      } catch {
        console.warn(`[section-repair] Invalid regex for ${docType}/${sec.section_key}: ${sec.match_pattern}`);
      }
    } else if (sec.match_mode === "heading_exact") {
      compiledSections.push({
        def: sec,
        regex: new RegExp(`^#+\\s*${escapeRegex(sec.match_pattern)}\\s*$`, "i"),
      });
    }
  }

  if (compiledSections.length === 0) return [];

  // Find all heading matches
  const matches: Array<{ line_idx: number; section_key: string; def: SectionDefinition; heading: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("#")) continue;

    for (const { def, regex } of compiledSections) {
      if (regex.test(trimmed)) {
        matches.push({ line_idx: i, section_key: def.section_key, def, heading: trimmed });
        break; // first match wins per line
      }
    }
  }

  // Build boundaries from matches
  // Capture preamble (content before first heading)
  if (matches.length > 0 && matches[0].line_idx > 0) {
    const preambleContent = lines.slice(0, matches[0].line_idx).join("\n");
    if (preambleContent.trim()) {
      boundaries.push({
        section_key: "__preamble",
        start_line: 0,
        end_line: matches[0].line_idx - 1,
        heading_line: "",
        content: preambleContent,
      });
    }
  }

  for (let mi = 0; mi < matches.length; mi++) {
    const m = matches[mi];
    const endLine = mi < matches.length - 1 ? matches[mi + 1].line_idx - 1 : lines.length - 1;
    boundaries.push({
      section_key: m.section_key,
      start_line: m.line_idx,
      end_line: endLine,
      heading_line: m.heading,
      content: lines.slice(m.line_idx, endLine + 1).join("\n"),
    });
  }

  return boundaries;
}

// ── Issue-to-Section Resolution ──

/**
 * Attempt to resolve an issue/note to a specific section key.
 *
 * Uses category, title, and summary to infer section targeting.
 * Fails closed: returns null if no confident match.
 */
export function resolveIssueToSectionKey(
  issue: {
    category?: string | null;
    title?: string;
    summary?: string;
    owning_doc_type?: string | null;
  },
  docType: string,
  content: string,
): { section_key: string; confidence: "high" | "medium"; reason: string } | null {
  const config = getSectionConfig(docType);
  if (!config || !config.section_repair_supported) return null;

  const parsed = parseSections(content, docType);
  if (parsed.length < config.min_sections_required) return null;

  const searchText = [
    issue.category || "",
    issue.title || "",
    issue.summary || "",
  ].join(" ").toLowerCase();

  if (!searchText.trim()) return null;

  // Category-based mapping (high confidence)
  const categoryMap = buildCategoryMap(docType);
  if (issue.category) {
    const catKey = issue.category.toLowerCase().replace(/[\s_-]+/g, "_");
    const mapped = categoryMap[catKey];
    if (mapped) {
      // Verify section actually exists in parsed content
      const exists = parsed.some(s => s.section_key === mapped);
      if (exists) {
        return { section_key: mapped, confidence: "high", reason: `category_match:${issue.category}->${mapped}` };
      }
    }
  }

  // Keyword-based section targeting (medium confidence)
  const sectionScores: Array<{ key: string; score: number }> = [];
  for (const sec of config.sections) {
    const keywords = buildSectionKeywords(sec);
    let score = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }
    if (score > 0) {
      // Verify section exists in content
      const exists = parsed.some(s => s.section_key === sec.section_key);
      if (exists) {
        sectionScores.push({ key: sec.section_key, score });
      }
    }
  }

  if (sectionScores.length === 0) return null;

  // Only return if there's a clear winner (top score > second by at least 1)
  sectionScores.sort((a, b) => b.score - a.score);
  if (sectionScores.length === 1 || sectionScores[0].score > sectionScores[1].score) {
    return {
      section_key: sectionScores[0].key,
      confidence: "medium",
      reason: `keyword_match:score=${sectionScores[0].score}`,
    };
  }

  // Ambiguous — fail closed
  return null;
}

// ── Section Extract / Replace ──

/**
 * Extract a specific section's content from a document.
 * Returns null if section not found.
 */
export function extractSection(
  content: string,
  docType: string,
  sectionKey: string,
): { content: string; boundary: SectionBoundary } | null {
  const parsed = parseSections(content, docType);
  const match = parsed.find(s => s.section_key === sectionKey);
  if (!match) return null;
  return { content: match.content, boundary: match };
}

/**
 * Replace a specific section's content within a document, preserving all other sections.
 * Fails closed if the section is not found.
 */
export function replaceSection(
  content: string,
  docType: string,
  sectionKey: string,
  newSectionContent: string,
): SectionReplaceResult {
  const parsed = parseSections(content, docType);
  const config = getSectionConfig(docType);

  if (!config) {
    return {
      success: false,
      new_content: content,
      repair_target_type: "full_doc",
      section_key: null,
      reason: "doc_type_not_in_registry",
      sections_found: 0,
      sections_total: 0,
    };
  }

  const matchIdx = parsed.findIndex(s => s.section_key === sectionKey);
  if (matchIdx === -1) {
    return {
      success: false,
      new_content: content,
      repair_target_type: "full_doc",
      section_key: sectionKey,
      reason: `section_not_found:${sectionKey}`,
      sections_found: parsed.length,
      sections_total: config.sections.length,
    };
  }

  // Reconstruct document with replaced section
  const lines = content.split("\n");
  const target = parsed[matchIdx];
  const before = lines.slice(0, target.start_line);
  const after = lines.slice(target.end_line + 1);
  const newContent = [...before, newSectionContent, ...after].join("\n");

  return {
    success: true,
    new_content: newContent,
    repair_target_type: "section",
    section_key: sectionKey,
    reason: `section_replaced:${sectionKey}`,
    sections_found: parsed.length,
    sections_total: config.sections.length,
  };
}

// ── Repair Target Resolution (Main Entry Point) ──

/**
 * Determine the optimal repair target for an issue against a document.
 *
 * Returns either a section-level target or a full_doc fallback with reason.
 * This is the primary integration point for the auto-run repair flow.
 */
export function getRepairTarget(
  issue: {
    category?: string | null;
    title?: string;
    summary?: string;
    owning_doc_type?: string | null;
  },
  docType: string,
  content: string,
): RepairTarget {
  const config = getSectionConfig(docType);

  // Not in registry → full doc
  if (!config || !config.section_repair_supported) {
    return {
      repair_target_type: "full_doc",
      section_key: null,
      section_label: null,
      reason: "doc_type_not_supported_for_section_repair",
      fallback_reason: null,
      section_content: null,
      full_content: content,
    };
  }

  // Parse sections
  const parsed = parseSections(content, docType);
  if (parsed.length < config.min_sections_required) {
    return {
      repair_target_type: "full_doc",
      section_key: null,
      section_label: null,
      reason: "insufficient_sections_found",
      fallback_reason: `found=${parsed.length}, required=${config.min_sections_required}`,
      section_content: null,
      full_content: content,
    };
  }

  // Attempt issue-to-section resolution
  const resolution = resolveIssueToSectionKey(issue, docType, content);
  if (!resolution) {
    return {
      repair_target_type: "full_doc",
      section_key: null,
      section_label: null,
      reason: "section_resolution_failed_closed",
      fallback_reason: "no_confident_section_match_for_issue",
      section_content: null,
      full_content: content,
    };
  }

  // Extract section
  const extracted = extractSection(content, docType, resolution.section_key);
  if (!extracted) {
    return {
      repair_target_type: "full_doc",
      section_key: resolution.section_key,
      section_label: null,
      reason: "section_extraction_failed",
      fallback_reason: `matched_key=${resolution.section_key}_but_extract_failed`,
      section_content: null,
      full_content: content,
    };
  }

  const secDef = findSectionDef(docType, resolution.section_key);

  return {
    repair_target_type: "section",
    section_key: resolution.section_key,
    section_label: secDef?.label || resolution.section_key,
    reason: `section_targeted:${resolution.reason}:confidence=${resolution.confidence}`,
    fallback_reason: null,
    section_content: extracted.content,
    full_content: content,
  };
}

// ── Internal Helpers ──

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build category → section_key mapping per doc type.
 * High-confidence: evaluator categories map directly to structural sections.
 */
function buildCategoryMap(docType: string): Record<string, string> {
  switch (docType) {
    case "character_bible":
      return {
        character: "protagonists",
        protagonist: "protagonists",
        antagonist: "antagonists",
        supporting: "supporting_cast",
        relationship: "relationships",
        character_arc: "character_arcs",
        arc: "character_arcs",
        depth: "protagonists",
      };
    case "treatment":
    case "long_treatment":
      return {
        setup: "act_1_setup",
        act_1: "act_1_setup",
        rising_action: "act_2a_rising_action",
        act_2a: "act_2a_rising_action",
        complications: "act_2b_complications",
        act_2b: "act_2b_complications",
        midpoint: "act_2b_complications",
        climax: "act_3_climax_resolution",
        resolution: "act_3_climax_resolution",
        act_3: "act_3_climax_resolution",
      };
    case "beat_sheet":
      return {
        act_1: "act_1_beats",
        act_2a: "act_2a_beats",
        act_2b: "act_2b_beats",
        act_3: "act_3_beats",
        setup: "act_1_beats",
        climax: "act_3_beats",
      };
    case "story_outline":
      return {
        setup: "setup",
        inciting_incident: "inciting_incident",
        catalyst: "inciting_incident",
        rising_action: "rising_action",
        midpoint: "midpoint",
        climax: "climax",
        resolution: "resolution",
      };
    case "concept_brief":
      return {
        logline: "logline",
        premise: "premise",
        protagonist: "protagonist",
        conflict: "central_conflict",
        tone: "tone_and_style",
        audience: "audience",
        hook: "unique_hook",
      };
    case "season_arc":
      return {
        premise: "season_premise",
        arc: "arc_overview",
        turning_point: "turning_points",
        character_arc: "character_season_arcs",
        theme: "thematic_throughline",
        finale: "season_finale",
      };
    default:
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.5 — Verbatim passage search (extraction-time verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of an extraction-time verbatim-quote search.
 * Persisted inside payload_json — zero schema migrations required.
 */
export interface PassageSearchResult {
  verified: boolean;
  section_key: string | null;
  line_start: number | null;
  line_end: number | null;
  match_method: 'exact' | 'none';
}

/**
 * Deterministically locate `verbatimQuote` inside a pre-parsed set of section
 * boundaries (from parseSections).
 *
 * Normalise whitespace to tolerate minor LLM spacing variants.
 * Scan: single-line, then multi-line window (≤4 lines).
 * Fail-closed: returns verified=false on any doubt.
 *
 * Complexity: O(n_sections × n_lines × quote_len) — acceptable for typical docs.
 */
export function findVerbatimInSections(
  sections: SectionBoundary[],
  verbatimQuote: string,
): PassageSearchResult {
  const NONE: PassageSearchResult = { verified: false, section_key: null, line_start: null, line_end: null, match_method: 'none' };
  if (!verbatimQuote || verbatimQuote.trim().length < 5) return NONE;

  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normQuote = normalise(verbatimQuote);

  for (const boundary of sections) {
    // Fast guard: check whole section first
    const normSection = normalise(boundary.content);
    if (!normSection.includes(normQuote)) continue;

    const sectionLines = boundary.content.split('\n');

    // Single-line match
    for (let i = 0; i < sectionLines.length; i++) {
      if (normalise(sectionLines[i]).includes(normQuote)) {
        return {
          verified:    true,
          section_key: boundary.section_key,
          line_start:  boundary.start_line + i,
          line_end:    boundary.start_line + i,
          match_method: 'exact',
        };
      }
    }

    // Multi-line window (quote spans up to 4 lines)
    const WINDOW = 4;
    const quotePrefix = normQuote.slice(0, Math.min(20, normQuote.length));
    for (let i = 0; i < sectionLines.length; i++) {
      if (!normalise(sectionLines[i]).includes(quotePrefix.slice(0, 10))) continue;
      const windowEnd = Math.min(i + WINDOW, sectionLines.length);
      const windowText = normalise(sectionLines.slice(i, windowEnd).join(' '));
      if (windowText.includes(normQuote)) {
        return {
          verified:    true,
          section_key: boundary.section_key,
          line_start:  boundary.start_line + i,
          line_end:    boundary.start_line + windowEnd - 1,
          match_method: 'exact',
        };
      }
    }

    // Section contained the quote when normalised but line scan missed — still a hit.
    // Emit section_key with line_start=boundary.start_line as conservative bound.
    return {
      verified:    true,
      section_key: boundary.section_key,
      line_start:  boundary.start_line,
      line_end:    boundary.end_line,
      match_method: 'exact',
    };
  }

  return NONE;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build keyword list for a section definition for fuzzy matching.
 */
function buildSectionKeywords(sec: SectionDefinition): string[] {
  const keywords: string[] = [];
  // From section_key
  keywords.push(...sec.section_key.split("_").filter(w => w.length > 2));
  // From label
  keywords.push(...sec.label.toLowerCase().split(/[\s&–—-]+/).filter(w => w.length > 2));
  return [...new Set(keywords)];
}

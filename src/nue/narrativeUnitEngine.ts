/**
 * NUE — Narrative Unit Engine
 *
 * Extracts atomic narrative units from generated document text and stores
 * them in Canon OS (canon_units, canon_unit_mentions, canon_unit_relations).
 *
 * SHADOW MODE: Extraction runs after document generation but NEVER mutates
 * documents. Results are stored for observation and future graph computation.
 *
 * Extraction pipeline:
 *   document generated → NUE parses text → entities/events/themes detected
 *   → units stored in canon_units → mentions stored in canon_unit_mentions
 */

import {
  upsertCanonUnit,
  createMention,
  createRelation,
  type CanonUnitType,
  type CanonUnit,
  type CreateUnitInput,
} from '@/canon/canonOS';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExtractionContext {
  projectId: string;
  documentId: string;
  versionId: string;
  docType: string;
  format: string;
  plaintext: string;
}

export interface ExtractedUnit {
  unit_type: CanonUnitType;
  label: string;
  confidence: number;
  offset_start?: number;
  offset_end?: number;
  attributes?: Record<string, unknown>;
}

export interface ExtractionResult {
  success: boolean;
  units_extracted: number;
  units_stored: number;
  mentions_created: number;
  relations_created: number;
  errors: string[];
  duration_ms: number;
}

// ── Extraction Patterns ────────────────────────────────────────────────────────
// Deterministic heuristic extraction — no LLM dependency.
// These patterns identify narrative units from document text structure.

const CHARACTER_PATTERNS = [
  // "CHARACTER_NAME:" at line start (screenplay format)
  /^([A-Z][A-Z\s]{1,30})(?:\s*\(.*?\))?\s*$/gm,
  // "**Name**" in markdown character bibles
  /\*\*([A-Z][a-zA-Z\s'-]{1,40})\*\*/g,
  // "# Character:" or "## Name" in character sections
  /^#{1,3}\s*(?:Character[:\s]*)?([A-Z][a-zA-Z\s'-]{2,40})\s*$/gm,
];

const LOCATION_PATTERNS = [
  // Screenplay sluglines: INT./EXT.
  /^(?:INT\.|EXT\.|INT\/EXT\.)\s+(.+?)(?:\s*[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|CONTINUOUS|LATER))?$/gm,
  // "Location:" field
  /^Location:\s*(.+)$/gm,
];

const EVENT_PATTERNS = [
  // Beat descriptions: "Beat N:" or "BEAT N:"
  /^(?:Beat|BEAT)\s*\d+[:\s]+(.{10,120})/gm,
  // "Episode N:" headlines
  /^Episode\s+\d+[:\s]+(.{5,100})/gm,
];

const THEME_PATTERNS = [
  // "Theme:" or "Themes:" fields
  /^Themes?:\s*(.+)$/gm,
  // "Central Theme:" 
  /^Central\s+Theme:\s*(.+)$/gm,
];

// ── Extraction Functions ───────────────────────────────────────────────────────

function extractByPattern(
  text: string,
  patterns: RegExp[],
  unitType: CanonUnitType,
): ExtractedUnit[] {
  const seen = new Set<string>();
  const units: ExtractedUnit[] = [];

  for (const pattern of patterns) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const label = (match[1] || '').trim();
      if (!label || label.length < 2 || label.length > 60) continue;

      const normalizedLabel = label.replace(/\s+/g, ' ');
      const key = `${unitType}:${normalizedLabel.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Filter out common false positives
      if (isGenericPhrase(normalizedLabel, unitType)) continue;

      units.push({
        unit_type: unitType,
        label: normalizedLabel,
        confidence: computeConfidence(normalizedLabel, unitType, text),
        offset_start: match.index,
        offset_end: match.index + match[0].length,
      });
    }
  }

  return units;
}

function isGenericPhrase(label: string, unitType: CanonUnitType): boolean {
  const lower = label.toLowerCase();
  const GENERIC = new Set([
    'the', 'and', 'but', 'or', 'not', 'this', 'that', 'with', 'for', 'from',
    'continued', 'cont', 'fade in', 'fade out', 'cut to', 'dissolve',
    'interior', 'exterior', 'day', 'night', 'morning', 'evening',
    'act one', 'act two', 'act three', 'act 1', 'act 2', 'act 3',
    'scene', 'sequence', 'montage', 'flashback',
    'synopsis', 'summary', 'overview', 'notes', 'draft', 'revision',
  ]);
  if (GENERIC.has(lower)) return true;
  // Single word all-caps that are likely headers, not characters
  if (unitType === 'character' && /^[A-Z]+$/.test(label) && label.length <= 3) return true;
  return false;
}

function computeConfidence(label: string, unitType: CanonUnitType, fullText: string): number {
  // Base confidence
  let conf = 0.7;

  // Boost for multiple mentions
  const mentionCount = (fullText.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  if (mentionCount >= 5) conf += 0.2;
  else if (mentionCount >= 3) conf += 0.15;
  else if (mentionCount >= 2) conf += 0.1;

  // Boost for named entities (capitalized)
  if (/^[A-Z]/.test(label)) conf += 0.05;

  return Math.min(conf, 1.0);
}

// ── Main Extraction Pipeline ───────────────────────────────────────────────────

/**
 * Extract narrative units from a document's plaintext.
 * This is a pure extraction step — no document mutation.
 */
export function extractUnitsFromText(text: string): ExtractedUnit[] {
  if (!text || text.length < 20) return [];

  const units: ExtractedUnit[] = [
    ...extractByPattern(text, CHARACTER_PATTERNS, 'character'),
    ...extractByPattern(text, LOCATION_PATTERNS, 'location'),
    ...extractByPattern(text, EVENT_PATTERNS, 'event'),
    ...extractByPattern(text, THEME_PATTERNS, 'theme'),
  ];

  return units;
}

/**
 * Run the full NUE pipeline: extract → store → link.
 * SHADOW MODE: This does not affect document content or pipeline flow.
 */
export async function runNUEExtraction(ctx: ExtractionContext): Promise<ExtractionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let unitsStored = 0;
  let mentionsCreated = 0;
  let relationsCreated = 0;

  console.log(`[IEL] nue_extraction_started { project: "${ctx.projectId}", doc: "${ctx.documentId}", version: "${ctx.versionId}", doc_type: "${ctx.docType}", format: "${ctx.format}" }`);

  // 1. Extract units from text
  const extracted = extractUnitsFromText(ctx.plaintext);

  if (extracted.length === 0) {
    console.log(`[IEL] nue_extraction_empty { project: "${ctx.projectId}", doc_type: "${ctx.docType}" }`);
    return {
      success: true,
      units_extracted: 0,
      units_stored: 0,
      mentions_created: 0,
      relations_created: 0,
      errors: [],
      duration_ms: Date.now() - startTime,
    };
  }

  // 2. Store units in Canon OS
  const storedUnits: CanonUnit[] = [];
  for (const unit of extracted) {
    try {
      const stored = await upsertCanonUnit({
        project_id: ctx.projectId,
        unit_type: unit.unit_type,
        label: unit.label,
        attributes: unit.attributes || {},
        confidence: unit.confidence,
        source_document_id: ctx.documentId,
        source_version_id: ctx.versionId,
      });
      if (stored) {
        storedUnits.push(stored);
        unitsStored++;
      }
    } catch (err: any) {
      errors.push(`unit "${unit.label}": ${err?.message || 'unknown'}`);
    }
  }

  // 3. Create mentions (link units to document version)
  for (let i = 0; i < extracted.length; i++) {
    const unit = extracted[i];
    const stored = storedUnits[i];
    if (!stored) continue;

    try {
      const mention = await createMention({
        unit_id: stored.id,
        document_id: ctx.documentId,
        version_id: ctx.versionId,
        offset_start: unit.offset_start,
        offset_end: unit.offset_end,
        confidence: unit.confidence,
      });
      if (mention) mentionsCreated++;
    } catch (err: any) {
      errors.push(`mention for "${unit.label}": ${err?.message || 'unknown'}`);
    }
  }

  // 4. Create implicit relations (co-occurrence in same document)
  const characters = storedUnits.filter(u => u.unit_type === 'character');
  const locations = storedUnits.filter(u => u.unit_type === 'location');

  // Character ↔ Location co-occurrence
  for (const char of characters) {
    for (const loc of locations) {
      try {
        const rel = await createRelation({
          project_id: ctx.projectId,
          unit_id_from: char.id,
          unit_id_to: loc.id,
          relation_type: 'appears_at',
          confidence: 0.6,
        });
        if (rel) relationsCreated++;
      } catch {
        // Non-fatal: co-occurrence relations are best-effort
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[IEL] nue_units_extracted { project: "${ctx.projectId}", extracted: ${extracted.length}, stored: ${unitsStored}, mentions: ${mentionsCreated}, relations: ${relationsCreated}, duration_ms: ${duration} }`);

  return {
    success: errors.length === 0,
    units_extracted: extracted.length,
    units_stored: unitsStored,
    mentions_created: mentionsCreated,
    relations_created: relationsCreated,
    errors,
    duration_ms: duration,
  };
}

/**
 * NUE — Narrative Unit Engine (NON-CANON experimental extraction)
 *
 * Extracts atomic narrative units from generated document text and stores
 * them in the experimental canon_units index.
 *
 * QUARANTINED: Gated behind CANON_UNITS_EXPERIMENTAL (default OFF).
 * Extraction runs after document generation but NEVER mutates documents.
 * Results are stored for observation only — NOT used by pipeline.
 *
 * Extraction pipeline:
 *   document generated → NUE parses text → entities/events/themes detected
 *   → units stored in canon_units → mentions stored in canon_unit_mentions
 */

import {
  CANON_UNITS_EXPERIMENTAL,
  upsertCanonUnit,
  createMention,
  createRelation,
  type CanonUnitType,
  type CanonUnit,
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

const CHARACTER_PATTERNS = [
  /^([A-Z][A-Z\s]{1,30})(?:\s*\(.*?\))?\s*$/gm,
  /\*\*([A-Z][a-zA-Z\s'-]{1,40})\*\*/g,
  /^#{1,3}\s*(?:Character[:\s]*)?([A-Z][a-zA-Z\s'-]{2,40})\s*$/gm,
];

const LOCATION_PATTERNS = [
  /^(?:INT\.|EXT\.|INT\/EXT\.)\s+(.+?)(?:\s*[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|CONTINUOUS|LATER))?$/gm,
  /^Location:\s*(.+)$/gm,
];

const EVENT_PATTERNS = [
  /^(?:Beat|BEAT)\s*\d+[:\s]+(.{10,120})/gm,
  /^Episode\s+\d+[:\s]+(.{5,100})/gm,
];

const THEME_PATTERNS = [
  /^Themes?:\s*(.+)$/gm,
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
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const label = (match[1] || '').trim();
      if (!label || label.length < 2 || label.length > 60) continue;

      const normalizedLabel = label.replace(/\s+/g, ' ');
      const key = `${unitType}::${normalizedLabel.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

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
  if (unitType === 'character' && /^[A-Z]+$/.test(label) && label.length <= 3) return true;
  return false;
}

function computeConfidence(label: string, _unitType: CanonUnitType, fullText: string): number {
  let conf = 0.7;
  const mentionCount = (fullText.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  if (mentionCount >= 5) conf += 0.2;
  else if (mentionCount >= 3) conf += 0.15;
  else if (mentionCount >= 2) conf += 0.1;
  if (/^[A-Z]/.test(label)) conf += 0.05;
  return Math.min(conf, 1.0);
}

// ── Main Extraction Pipeline ───────────────────────────────────────────────────

/**
 * Extract narrative units from a document's plaintext.
 * Pure extraction — no document mutation, no DB writes.
 */
export function extractUnitsFromText(text: string): ExtractedUnit[] {
  if (!text || text.length < 20) return [];

  return [
    ...extractByPattern(text, CHARACTER_PATTERNS, 'character'),
    ...extractByPattern(text, LOCATION_PATTERNS, 'location'),
    ...extractByPattern(text, EVENT_PATTERNS, 'event'),
    ...extractByPattern(text, THEME_PATTERNS, 'theme'),
  ];
}

/**
 * Run the full NUE pipeline: extract → store → link.
 * QUARANTINED: Returns immediately with skip log if CANON_UNITS_EXPERIMENTAL is OFF.
 */
export async function runNUEExtraction(ctx: ExtractionContext): Promise<ExtractionResult> {
  const startTime = Date.now();

  // ── Feature flag gate ──
  if (!CANON_UNITS_EXPERIMENTAL) {
    console.log(`[narrative-intelligence][IEL] nue_extraction_skipped_flag_off { project: "${ctx.projectId}", doc_type: "${ctx.docType}" }`);
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

  const errors: string[] = [];
  let unitsStored = 0;
  let mentionsCreated = 0;
  let relationsCreated = 0;

  console.log(`[narrative-intelligence][IEL] nue_extraction_started { project: "${ctx.projectId}", doc: "${ctx.documentId}", version: "${ctx.versionId}", doc_type: "${ctx.docType}", format: "${ctx.format}" }`);

  // 1. Extract units from text
  const extracted = extractUnitsFromText(ctx.plaintext);

  if (extracted.length === 0) {
    console.log(`[narrative-intelligence][IEL] nue_extraction_empty { project: "${ctx.projectId}", doc_type: "${ctx.docType}" }`);
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

  // 2. Store units in Canon OS — use stable key map (NOT index-based alignment)
  const storedByKey = new Map<string, CanonUnit>();
  for (const unit of extracted) {
    const stableKey = `${unit.unit_type}::${unit.label.trim().toLowerCase()}`;
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
        storedByKey.set(stableKey, stored);
        unitsStored++;
      }
    } catch (err: any) {
      errors.push(`unit "${unit.label}": ${err?.message || 'unknown'}`);
    }
  }

  // 3. Create mentions — linked via stable key, NOT index
  for (const unit of extracted) {
    const stableKey = `${unit.unit_type}::${unit.label.trim().toLowerCase()}`;
    const stored = storedByKey.get(stableKey);
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

  // 4. Create implicit relations (co-occurrence) — dedupe handled by createRelation
  const characters = Array.from(storedByKey.values()).filter(u => u.unit_type === 'character');
  const locations = Array.from(storedByKey.values()).filter(u => u.unit_type === 'location');

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
  console.log(`[narrative-intelligence][IEL] nue_units_extracted { project: "${ctx.projectId}", extracted: ${extracted.length}, stored: ${unitsStored}, mentions: ${mentionsCreated}, relations: ${relationsCreated}, duration_ms: ${duration} }`);

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

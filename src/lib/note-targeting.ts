/**
 * Note Targeting Helpers — shared logic for determining target doc type,
 * deferral status, and due_when for notes.
 * 
 * Used by both frontend (display logic) and can be mirrored in backend.
 */

import ladderData from '../../supabase/_shared/stage-ladders.json';

const FORMAT_LADDERS: Record<string, string[]> = ladderData.FORMAT_LADDERS as any;
const DOC_TYPE_ALIASES: Record<string, string> = ladderData.DOC_TYPE_ALIASES as any;

/**
 * Get the pipeline stages for a given format.
 */
export function getPipelineForFormat(format: string): string[] {
  return FORMAT_LADDERS[format] || FORMAT_LADDERS['feature'] || [];
}

/**
 * Normalize a doc type using the alias map.
 */
export function normalizeDocType(docType: string): string {
  if (!docType) return docType;
  const lower = docType.toLowerCase().replace(/[\s-]+/g, '_');
  return DOC_TYPE_ALIASES[lower] || lower;
}

/**
 * Check if a doc type exists in the pipeline for a given format.
 */
export function isDocTypeInPipeline(docType: string, format: string): boolean {
  const pipeline = getPipelineForFormat(format);
  const normalized = normalizeDocType(docType);
  return pipeline.includes(normalized);
}

/**
 * Get the stage index of a doc type in a pipeline (-1 if not found).
 */
export function getStageIndex(docType: string, format: string): number {
  const pipeline = getPipelineForFormat(format);
  return pipeline.indexOf(normalizeDocType(docType));
}

/**
 * Determine if a note should be deferred based on its target and the current pipeline state.
 */
export function shouldDefer(params: {
  targetDocType: string;
  currentDocType: string;
  format: string;
}): { defer: boolean; reason: string | null } {
  const { targetDocType, currentDocType, format } = params;
  const pipeline = getPipelineForFormat(format);
  const normalizedTarget = normalizeDocType(targetDocType);
  const normalizedCurrent = normalizeDocType(currentDocType);

  // Not in pipeline at all
  if (!pipeline.includes(normalizedTarget)) {
    return { defer: true, reason: `Target stage "${targetDocType}" is not in the ${format} pipeline` };
  }

  const targetIdx = pipeline.indexOf(normalizedTarget);
  const currentIdx = pipeline.indexOf(normalizedCurrent);

  // Target is more than 1 stage ahead
  if (targetIdx > currentIdx + 1) {
    return { defer: true, reason: `Will resurface at ${normalizedTarget} stage` };
  }

  return { defer: false, reason: null };
}

/**
 * Compute the due_when resurfacing rule for a deferred note.
 */
export function computeDueWhen(targetDocType: string): Record<string, unknown> {
  return {
    when_doc_type_active: normalizeDocType(targetDocType),
  };
}

/**
 * Find the nearest equivalent stage in the pipeline for an out-of-pipeline doc type.
 */
export function findNearestEquivalent(docType: string, format: string): string | null {
  const pipeline = getPipelineForFormat(format);
  const normalized = normalizeDocType(docType);

  // Direct alias resolution
  if (pipeline.includes(normalized)) return normalized;

  // Blueprint → beat_sheet for formats without blueprint
  const REMAP: Record<string, string[]> = {
    blueprint: ['beat_sheet', 'season_arc', 'concept_brief'],
    architecture: ['blueprint', 'beat_sheet', 'season_arc'],
    beat_sheet: ['blueprint', 'season_arc'],
  };

  const candidates = REMAP[normalized] || [];
  for (const c of candidates) {
    if (pipeline.includes(c)) return c;
  }

  return null;
}

/**
 * Human-readable label for a resurfacing condition.
 */
export function dueWhenLabel(dueWhen: any): string {
  if (!dueWhen) return 'Unknown';
  if (dueWhen.when_doc_type_active) {
    return `When working on ${dueWhen.when_doc_type_active.replace(/_/g, ' ')}`;
  }
  if (dueWhen.when_doc_exists) {
    return `When ${dueWhen.when_doc_exists.replace(/_/g, ' ')} exists`;
  }
  if (dueWhen.when_stage_index_reached != null) {
    return `At pipeline stage ${dueWhen.when_stage_index_reached}`;
  }
  return 'Later stage';
}

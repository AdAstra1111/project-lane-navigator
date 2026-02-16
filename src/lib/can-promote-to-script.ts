/**
 * canPromoteToScript — single shared gate for "Publish as Script" CTA visibility.
 * Returns true ONLY if the artifact is eligible for script promotion.
 */

const SCRIPT_DOC_TYPES = new Set([
  'screenplay_draft',
  'pilot_script',
  'episode_script',
  'script',
  'season_scripts_bundle',
]);

export interface PromoteToScriptInput {
  docType: string | null | undefined;
  linkedScriptId?: string | null;
  /** Minimum text length to qualify as script-promotable content */
  contentLength?: number;
}

export interface PromoteToScriptResult {
  eligible: boolean;
  reason: string;
}

export function canPromoteToScript(input: PromoteToScriptInput): PromoteToScriptResult {
  const normalized = (input.docType || '').toLowerCase().replace(/[\s\-]+/g, '_');

  // Gate 1: Already a script doc_type
  if (SCRIPT_DOC_TYPES.has(normalized)) {
    return {
      eligible: false,
      reason: `already_script_doc_type: ${normalized}`,
    };
  }

  // Gate 2: Already has a linked script record
  if (input.linkedScriptId) {
    return {
      eligible: false,
      reason: `linked_script_exists: ${input.linkedScriptId}`,
    };
  }

  // Gate 3: Content threshold (must have meaningful content)
  if (input.contentLength !== undefined && input.contentLength < 100) {
    return {
      eligible: false,
      reason: `content_too_short: ${input.contentLength} chars`,
    };
  }

  return {
    eligible: true,
    reason: 'eligible',
  };
}

/**
 * Returns true if the doc_type is already a script type.
 */
export function isScriptDocType(docType: string | null | undefined): boolean {
  const normalized = (docType || '').toLowerCase().replace(/[\s\-]+/g, '_');
  return SCRIPT_DOC_TYPES.has(normalized);
}

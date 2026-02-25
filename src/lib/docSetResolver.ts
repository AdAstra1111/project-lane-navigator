/**
 * docSetResolver — Shared deterministic document-context resolution for all workflows.
 *
 * Used by Writers' Room, Trailer, Storyboard, and Analysis to assemble
 * includeDocumentIds from doc sets in a stable, deterministic way.
 */

import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/* ── Resolution reasons ── */

export type ResolutionReason =
  | 'doc_set_explicit'
  | 'doc_set_default'
  | 'explicit_include_ids'
  | 'legacy_fallback'
  | 'none';

export type WorkflowMode = 'writers_room' | 'trailer' | 'storyboard' | 'analysis';

export interface ResolvedContext {
  includeDocumentIds: string[] | null;
  resolutionReason: ResolutionReason;
}

/* ── Pure helpers ── */

/**
 * getDefaultDocSetId — deterministically select the default doc set.
 * Prefer is_default=true. Else oldest created_at, tiebreak by id asc.
 */
export function getDefaultDocSetId(docSets: DocSet[]): string | undefined {
  if (docSets.length === 0) return undefined;
  const def = docSets.find(s => s.is_default);
  if (def) return def.id;
  // Fallback: oldest created_at, then smallest id
  const sorted = [...docSets].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0]?.id;
}

/**
 * getDocSetDocumentIds — return document_ids from items sorted by sort_order asc.
 */
export function getDocSetDocumentIds(items: DocSetItem[]): string[] {
  return [...items]
    .sort((a, b) => {
      const so = a.sort_order - b.sort_order;
      if (so !== 0) return so;
      const ca = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (ca !== 0) return ca;
      return a.document_id < b.document_id ? -1 : a.document_id > b.document_id ? 1 : 0;
    })
    .map(i => i.document_id);
}

/* ── Resolver ── */

export interface ResolveParams {
  docSets: DocSet[];
  docSetItemsBySetId: Record<string, DocSetItem[]>;
  explicitDocSetId?: string | null;
  explicitIncludeDocumentIds?: string[] | null;
  mode: WorkflowMode;
}

/**
 * resolveContextDocumentIds — deterministic resolution of which documents
 * should be included in a workflow's context.
 *
 * Priority:
 * 1. explicitDocSetId → use that doc set's items
 * 2. doc sets exist → use default doc set's items
 * 3. explicitIncludeDocumentIds → use as-is
 * 4. nothing → return null (legacy fallback)
 */
export function resolveContextDocumentIds(params: ResolveParams): ResolvedContext {
  const { docSets, docSetItemsBySetId, explicitDocSetId, explicitIncludeDocumentIds, mode: _mode } = params;

  // 1. Explicit doc set selection
  if (explicitDocSetId) {
    const items = docSetItemsBySetId[explicitDocSetId] || [];
    return {
      includeDocumentIds: getDocSetDocumentIds(items),
      resolutionReason: 'doc_set_explicit',
    };
  }

  // 2. Default doc set (if doc sets exist)
  if (docSets.length > 0) {
    const defaultId = getDefaultDocSetId(docSets);
    if (defaultId) {
      const items = docSetItemsBySetId[defaultId] || [];
      return {
        includeDocumentIds: getDocSetDocumentIds(items),
        resolutionReason: 'doc_set_default',
      };
    }
  }

  // 3. Explicit include IDs
  if (explicitIncludeDocumentIds && explicitIncludeDocumentIds.length > 0) {
    return {
      includeDocumentIds: [...explicitIncludeDocumentIds],
      resolutionReason: 'explicit_include_ids',
    };
  }

  // 4. Legacy fallback
  return {
    includeDocumentIds: null,
    resolutionReason: 'legacy_fallback',
  };
}

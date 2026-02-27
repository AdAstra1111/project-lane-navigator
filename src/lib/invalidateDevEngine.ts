/**
 * invalidateDevEngine — Centralised React Query invalidation for the
 * Development Engine.  Call this after EVERY action that touches notes,
 * issues, versions, or documents so every panel in the system stays in sync.
 *
 * Rules:
 *  - Always invalidate docs + runs (broad keys) so list views refresh.
 *  - When docId is known, also invalidate the narrow per-doc keys.
 *  - When versionId is known, also invalidate the narrow per-version keys.
 *  - "deep" mode additionally invalidates project-issues, resolved-notes,
 *    and canon-audit keys — use for apply-fix / patch / resolve actions.
 */

import type { QueryClient } from '@tanstack/react-query';

export interface InvalidateOptions {
  projectId: string | undefined;
  docId?: string | null;
  versionId?: string | null;
  episodeNumber?: number | null;
  /** When true, also clears the persistent-issue and canon-audit caches. Default true. */
  deep?: boolean;
}

export function invalidateDevEngine(
  qc: QueryClient,
  {
    projectId,
    docId,
    versionId,
    episodeNumber,
    deep = true,
  }: InvalidateOptions,
) {
  // ── Always: broad doc + run keys ──────────────────────────────────────────
  qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
  qc.invalidateQueries({ queryKey: ['dev-v2-versions'] });
  qc.invalidateQueries({ queryKey: ['dev-v2-runs'] });
  qc.invalidateQueries({ queryKey: ['dev-v2-doc-runs'] });
  qc.invalidateQueries({ queryKey: ['dev-v2-convergence'] });
  qc.invalidateQueries({ queryKey: ['dev-v2-approved', projectId] });
  qc.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] });

  // ── Per-document keys ──────────────────────────────────────────────────────
  if (docId) {
    qc.invalidateQueries({ queryKey: ['dev-v2-versions', docId] });
    qc.invalidateQueries({ queryKey: ['dev-v2-doc-runs', docId] });
    qc.invalidateQueries({ queryKey: ['dev-v2-convergence', docId] });
  }

  // ── Per-version keys ───────────────────────────────────────────────────────
  if (versionId) {
    qc.invalidateQueries({ queryKey: ['dev-v2-runs', versionId] });
    qc.invalidateQueries({ queryKey: ['dev-v2-drift', versionId] });
  }

  if (!deep) return;

  // ── Deep: persistent issues + resolved notes + canon + series ─────────────
  if (projectId) {
    qc.invalidateQueries({ queryKey: ['project-issues', projectId] });
    qc.invalidateQueries({ queryKey: ['resolved-notes', projectId] });
    // Canon audit (Series Writer)
    if (episodeNumber != null) {
      qc.invalidateQueries({ queryKey: ['canon-audit-run', projectId, episodeNumber] });
      qc.invalidateQueries({ queryKey: ['canon-audit-issues', projectId, episodeNumber] });
    } else {
      // Invalidate all episode canon caches for this project
      qc.invalidateQueries({ queryKey: ['canon-audit-run', projectId] });
      qc.invalidateQueries({ queryKey: ['canon-audit-issues', projectId] });
    }
    // Series episodes (script pointer updates after fix)
    qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
    // Document package / active folder
    qc.invalidateQueries({ queryKey: ['active-folder', projectId] });
    qc.invalidateQueries({ queryKey: ['document-package', projectId] });
  }
}

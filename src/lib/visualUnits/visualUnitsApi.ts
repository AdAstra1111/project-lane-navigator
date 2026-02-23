/**
 * Visual Unit Engine v1.0 — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callVUE(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/visual-unit-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Visual Unit Engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted.';
    if (resp.status === 409) msg = JSON.parse(text).error || 'Conflict';
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export const visualUnitsApi = {
  selectSources: (projectId: string, preferApproved = true) =>
    callVUE('select_sources', { projectId, preferApproved }),

  createRun: (projectId: string, sourceVersions?: Record<string, string>, scope?: string, unitKey?: string) =>
    callVUE('create_run', { projectId, sourceVersions, scope, unitKey }),

  listRuns: (projectId: string, limit?: number) =>
    callVUE('list_runs', { projectId, limit }),

  listCandidates: (projectId: string, runId?: string, unitKey?: string, statuses?: string[]) =>
    callVUE('list_candidates', { projectId, runId, unitKey, statuses }),

  getCandidate: (projectId: string, candidateId: string) =>
    callVUE('get_candidate', { projectId, candidateId }),

  getUnit: (projectId: string, unitKey: string) =>
    callVUE('get_unit', { projectId, unitKey }),

  acceptCandidate: (projectId: string, candidateId: string) =>
    callVUE('accept_candidate', { projectId, candidateId }),

  rejectCandidate: (projectId: string, candidateId: string, reason?: string) =>
    callVUE('reject_candidate', { projectId, candidateId, reason }),

  modifyCandidate: (projectId: string, candidateId: string, patch: Record<string, any>, note?: string) =>
    callVUE('modify_candidate', { projectId, candidateId, patch, note }),

  lockUnit: (projectId: string, unitKey: string) =>
    callVUE('lock_unit', { projectId, unitKey }),

  unlockUnit: (projectId: string, unitKey: string) =>
    callVUE('unlock_unit', { projectId, unitKey }),

  markStale: (projectId: string, unitKey: string, stale: boolean, reason?: string) =>
    callVUE('mark_stale', { projectId, unitKey, stale, reason }),

  compare: (projectId: string, from: Record<string, any>, to: Record<string, any>, write = false) =>
    callVUE('compare', { projectId, from, to, write }),
};

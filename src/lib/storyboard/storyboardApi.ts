/**
 * Storyboard Pipeline v1 — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callSBE(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storyboard-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Storyboard engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted.';
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export const storyboardApi = {
  listCanonicalUnits: (projectId: string, unitKeys?: string[]) =>
    callSBE('list_canonical_units', { projectId, unitKeys }),

  createRunAndPanels: (projectId: string, unitKeys?: string[], stylePreset?: string, aspectRatio?: string, includeDocumentIds?: string[], castContext?: any[]) =>
    callSBE('create_run_and_panels', { projectId, unitKeys, stylePreset, aspectRatio, includeDocumentIds, castContext }),

  listRuns: (projectId: string, limit?: number) =>
    callSBE('list_runs', { projectId, limit }),

  listPanels: (projectId: string, runId: string) =>
    callSBE('list_panels', { projectId, runId }),

  getPanel: (projectId: string, panelId: string) =>
    callSBE('get_panel', { projectId, panelId }),

  generateFrame: (projectId: string, panelId: string, opts?: { seed?: string; override_prompt?: string; override_negative?: string }) =>
    callSBE('generate_frame', { projectId, panelId, ...opts }),

  regenerateFrame: (projectId: string, panelId: string, opts?: { seed?: string; override_prompt?: string; override_negative?: string }) =>
    callSBE('regenerate_frame', { projectId, panelId, ...opts }),
};

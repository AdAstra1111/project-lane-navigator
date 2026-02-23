/**
 * Storyboard Render Queue — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callRQ(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storyboard-render-queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Render queue error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export const storyboardRenderApi = {
  enqueue: (projectId: string, runId: string, unitKeys?: string[], mode?: string, priority?: number) =>
    callRQ('enqueue', { projectId, runId, unitKeys, mode, priority }),

  getRenderRun: (projectId: string, renderRunId: string) =>
    callRQ('get_render_run', { projectId, renderRunId }),

  listRenderRuns: (projectId: string, runId?: string) =>
    callRQ('list_render_runs', { projectId, runId }),

  claimNextJob: (projectId: string, renderRunId?: string) =>
    callRQ('claim_next_job', { projectId, renderRunId }),

  processJob: (projectId: string, jobId: string) =>
    callRQ('process_job', { projectId, jobId }),

  cancel: (projectId: string, renderRunId: string) =>
    callRQ('cancel', { projectId, renderRunId }),
};

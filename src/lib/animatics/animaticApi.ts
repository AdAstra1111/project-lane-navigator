/**
 * Animatic API — wrapper for animatic-manager edge function
 */
import { supabase } from '@/integrations/supabase/client';

async function callAnimatic(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/animatic-manager`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Animatic error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export const animaticApi = {
  createRun: (projectId: string, storyboardRunId: string, options?: any) =>
    callAnimatic('create_run', { projectId, storyboardRunId, options }),

  getRun: (projectId: string, animaticRunId: string) =>
    callAnimatic('get_run', { projectId, animaticRunId }),

  getAssets: (projectId: string, storyboardRunId: string, animaticRunId: string) =>
    callAnimatic('get_assets', { projectId, storyboardRunId, animaticRunId }),

  setStatus: (projectId: string, animaticRunId: string, status: string, payload?: any) =>
    callAnimatic('set_status', { projectId, animaticRunId, status, ...payload }),

  completeUpload: (projectId: string, animaticRunId: string, storagePath: string, publicUrl: string) =>
    callAnimatic('complete_upload', { projectId, animaticRunId, storagePath, publicUrl }),

  listRuns: (projectId: string, storyboardRunId?: string) =>
    callAnimatic('list_runs', { projectId, storyboardRunId }),
};

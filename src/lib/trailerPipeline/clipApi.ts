/**
 * Trailer Clip Generator v1 — API wrappers
 */
import { supabase } from '@/integrations/supabase/client';

async function callClipEngine(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trailer-clip-generator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Clip engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    throw new Error(msg);
  }
  return resp.json();
}

export const clipEngineApi = {
  enqueueForRun: (projectId: string, blueprintId: string, force = false, enabledProviders?: string[]) =>
    callClipEngine('enqueue_for_run', { projectId, blueprintId, force, enabledProviders }),

  claimNextJob: (projectId: string, blueprintId: string) =>
    callClipEngine('claim_next_job', { projectId, blueprintId }),

  processJob: (projectId: string, jobId: string) =>
    callClipEngine('process_job', { projectId, jobId }),

  processQueue: (projectId: string, blueprintId: string, maxJobs = 5) =>
    callClipEngine('process_queue', { projectId, blueprintId, maxJobs }),

  progress: (projectId: string, blueprintId: string) =>
    callClipEngine('progress', { projectId, blueprintId }),

  retryJob: (projectId: string, jobId: string) =>
    callClipEngine('retry_job', { projectId, jobId }),

  cancelJob: (projectId: string, jobId: string) =>
    callClipEngine('cancel_job', { projectId, jobId }),

  selectClip: (projectId: string, clipId: string, blueprintId: string, beatIndex: number) =>
    callClipEngine('select_clip', { projectId, clipId, blueprintId, beatIndex }),

  listClips: (projectId: string, blueprintId: string) =>
    callClipEngine('list_clips', { projectId, blueprintId }),

  listJobs: (projectId: string, blueprintId: string) =>
    callClipEngine('list_jobs', { projectId, blueprintId }),

  cancelAll: (projectId: string, blueprintId: string) =>
    callClipEngine('cancel_all', { projectId, blueprintId }),

  resetFailed: (projectId: string, blueprintId: string) =>
    callClipEngine('reset_failed', { projectId, blueprintId }),
};

/**
 * Trailer Audio Engine v1.1 — API wrappers
 */
import { supabase } from '@/integrations/supabase/client';

async function callAudioFn(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trailer-audio-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Audio engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}

export const audioApi = {
  listAudioAssets: (projectId: string, kind?: string) =>
    callAudioFn('list_audio_assets', { projectId, kind }),

  getAudioRun: (projectId: string, trailerCutId: string) =>
    callAudioFn('get_audio_run', { projectId, trailerCutId }),

  upsertAudioRun: (projectId: string, trailerCutId: string, options: {
    blueprintId?: string;
    musicBedAssetId?: string | null;
    sfxPackTag?: string | null;
    mixOverrides?: Record<string, any>;
  }) => callAudioFn('upsert_audio_run', { projectId, trailerCutId, ...options }),

  generateAudioPlan: (projectId: string, audioRunId: string) =>
    callAudioFn('generate_audio_plan', { projectId, audioRunId }),

  enqueueRender: (projectId: string, trailerCutId: string, options?: {
    audioRunId?: string;
    force?: boolean;
    preset?: '720p' | '1080p';
  }) => callAudioFn('enqueue_render', { projectId, trailerCutId, ...(options || {}) }),

  renderProgress: (projectId: string, trailerCutId: string) =>
    callAudioFn('render_progress', { projectId, trailerCutId }),

  retryRender: (projectId: string, renderJobId: string) =>
    callAudioFn('retry_render', { projectId, renderJobId }),

  cancelRender: (projectId: string, renderJobId: string) =>
    callAudioFn('cancel_render', { projectId, renderJobId }),
};

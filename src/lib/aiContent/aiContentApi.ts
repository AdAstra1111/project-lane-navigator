/**
 * AI Content Orchestrator — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callOrchestrator(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-content-orchestrator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'AI Content error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export type ContentMode = 'storyboard' | 'animatic' | 'teaser' | 'trailer';
export type ContentPreset = 'fast' | 'balanced' | 'quality';

export const aiContentApi = {
  start: (projectId: string, mode: ContentMode, preset: ContentPreset, opts?: {
    storyboardRunId?: string;
    blueprintId?: string;
  }) =>
    callOrchestrator('start', { projectId, mode, preset, ...opts }),

  status: (projectId: string, runId?: string) =>
    callOrchestrator('status', { projectId, runId }),

  tick: (projectId: string, runId: string) =>
    callOrchestrator('tick', { projectId, runId }),

  pause: (projectId: string, runId: string) =>
    callOrchestrator('pause', { projectId, runId }),

  resume: (projectId: string, runId: string) =>
    callOrchestrator('resume', { projectId, runId }),

  stop: (projectId: string, runId: string) =>
    callOrchestrator('stop', { projectId, runId }),
};

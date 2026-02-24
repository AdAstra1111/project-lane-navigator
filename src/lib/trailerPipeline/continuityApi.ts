/**
 * Continuity Intelligence v1 — API wrappers
 */
import { supabase } from '@/integrations/supabase/client';

async function callContinuityEngine(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trailer-continuity-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Continuity engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted.';
    throw new Error(msg);
  }
  return resp.json();
}

export const continuityApi = {
  /** Tag clips with continuity metadata */
  tagClips: (params: {
    projectId: string;
    clipRunId?: string;
    blueprintId?: string;
    limit?: number;
  }) => callContinuityEngine('tag_clips_continuity_v1', params),

  /** Run continuity judge on a cut */
  runJudge: (params: {
    projectId: string;
    trailerCutId: string;
    continuitySettings?: Record<string, any>;
  }) => callContinuityEngine('run_continuity_judge_v1', params),

  /** Build a non-destructive fix plan */
  buildFixPlan: (params: {
    projectId: string;
    trailerCutId: string;
    continuityRunId: string;
  }) => callContinuityEngine('build_continuity_fix_plan_v1', params),

  /** Apply fix plan (dry-run or live) */
  applyFixPlan: (params: {
    projectId: string;
    trailerCutId: string;
    continuityRunId?: string;
    plan: any;
    dryRun?: boolean;
  }) => callContinuityEngine('apply_continuity_fix_plan_v1', params),
};

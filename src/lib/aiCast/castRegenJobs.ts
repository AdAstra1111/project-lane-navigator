/**
 * castRegenJobs — Canonical cast regeneration job creation module.
 *
 * Converts planner output into queued jobs in cast_regen_jobs.
 * Backend-authoritative via edge function. No execution logic.
 */

import { supabase } from '@/integrations/supabase/client';
import { buildCastRegenPlan, type RegenReason, type RegenItem } from './castRegenPlanner';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueueResult {
  created_count: number;
  skipped_duplicates: number;
  jobs: Array<{
    id: string;
    output_id: string;
    character_key: string;
    reason: RegenReason;
  }>;
}

export interface CastRegenJob {
  id: string;
  project_id: string;
  character_key: string;
  output_id: string;
  output_type: string;
  reason: string;
  status: string;
  requested_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

// ── List ────────────────────────────────────────────────────────────────────

export async function listCastRegenJobs(projectId: string): Promise<CastRegenJob[]> {
  const { data, error } = await (supabase as any)
    .from('cast_regen_jobs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data || []) as CastRegenJob[];
}

// ── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelCastRegenJob(jobId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('cast_regen_jobs')
    .update({ status: 'cancelled' })
    .eq('id', jobId)
    .eq('status', 'queued');

  if (error) throw error;
}

// ── Queue via edge function ─────────────────────────────────────────────────

export async function queueCastRegenJobs(
  projectId: string,
  opts?: { characterKey?: string; reasons?: RegenReason[] },
): Promise<QueueResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/queue-cast-regen`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        projectId,
        characterKey: opts?.characterKey,
        reasons: opts?.reasons,
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Queue failed';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }

  return resp.json();
}

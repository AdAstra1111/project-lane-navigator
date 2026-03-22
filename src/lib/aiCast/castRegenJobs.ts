/**
 * castRegenJobs — Canonical cast regeneration job module.
 *
 * Queue: calls backend-authoritative edge function (queue-cast-regen)
 * Process: calls backend-authoritative worker (process-cast-regen)
 * Retry: creates a new queued job for a failed job (respects dedup)
 * List / Cancel: direct DB operations on cast_regen_jobs
 */

import { supabase } from '@/integrations/supabase/client';
import type { RegenReason } from './castRegenPlanner';

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueueResult {
  created_count: number;
  skipped_duplicates: number;
  jobs: Array<{
    id: string;
    output_id: string;
    character_key: string;
    reason: string;
  }>;
}

export interface ProcessResult {
  processed: number;
  results: Array<{
    job_id: string;
    output_id: string;
    character_key: string;
    reason: string;
    result: string;
    error?: string;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getSessionToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session.access_token;
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

// ── Queue via backend-authoritative edge function ───────────────────────────

export async function queueCastRegenJobs(
  projectId: string,
  opts?: { characterKey?: string; reasons?: RegenReason[] },
): Promise<QueueResult> {
  const token = await getSessionToken();

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/queue-cast-regen`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

// ── Process via backend-authoritative worker ────────────────────────────────

export async function processCastRegenJobs(
  limit: number = 1,
): Promise<ProcessResult> {
  const token = await getSessionToken();

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-cast-regen`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ limit }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Processing failed';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }

  return resp.json();
}

// ── Retry a failed job ─────────────────────────────────────────────────────

export async function retryCastRegenJob(jobId: string): Promise<{ created: boolean; skipped: boolean }> {
  // 1. Fetch the failed job
  const { data: failedJob, error: fetchErr } = await (supabase as any)
    .from('cast_regen_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('status', 'failed')
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!failedJob) throw new Error('Job not found or not in failed status');

  // 2. Check dedup — skip if queued/running duplicate already exists
  const { data: existing } = await (supabase as any)
    .from('cast_regen_jobs')
    .select('id')
    .eq('project_id', failedJob.project_id)
    .eq('character_key', failedJob.character_key)
    .eq('output_id', failedJob.output_id)
    .eq('reason', failedJob.reason)
    .in('status', ['queued', 'running'])
    .limit(1);

  if (existing && existing.length > 0) {
    return { created: false, skipped: true };
  }

  // 3. Get current user
  const { data: { session } } = await supabase.auth.getSession();

  // 4. Insert new queued job
  const { error: insertErr } = await (supabase as any)
    .from('cast_regen_jobs')
    .insert({
      project_id: failedJob.project_id,
      character_key: failedJob.character_key,
      output_id: failedJob.output_id,
      output_type: failedJob.output_type,
      reason: failedJob.reason,
      status: 'queued',
      requested_by: session?.user?.id || null,
    });

  if (insertErr) throw insertErr;
  return { created: true, skipped: false };
}

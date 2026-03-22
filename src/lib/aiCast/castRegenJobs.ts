/**
 * castRegenJobs — Canonical cast regeneration job creation module.
 *
 * Converts planner output into queued jobs in cast_regen_jobs.
 * Backend-authoritative via edge function. No execution logic.
 *
 * IMPORTANT: This module calls the canonical planner (castRegenPlanner.ts)
 * and sends the resulting items to the edge function for insertion.
 * The edge function is a pure job inserter — no planner logic lives there.
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

// ── Queue via canonical planner + edge function ─────────────────────────────

export async function queueCastRegenJobs(
  projectId: string,
  opts?: { characterKey?: string; reasons?: RegenReason[] },
): Promise<QueueResult> {
  // 1. Run canonical planner (single source of truth)
  const plan = await buildCastRegenPlan(projectId);

  // 2. Collect all items from the plan
  let items: RegenItem[] = [];
  for (const reason of Object.keys(plan.by_reason) as RegenReason[]) {
    items.push(...plan.by_reason[reason]);
  }

  // 3. Filter by opts
  if (opts?.characterKey) {
    const normKey = normalizeCharacterKey(opts.characterKey);
    items = items.filter(i => i.character_key === normKey);
  }
  if (opts?.reasons && opts.reasons.length > 0) {
    const reasonSet = new Set(opts.reasons);
    items = items.filter(i => reasonSet.has(i.reason));
  }

  // 4. Nothing to queue
  if (items.length === 0) {
    return { created_count: 0, skipped_duplicates: 0, jobs: [] };
  }

  // 5. Send planned items to edge function for insertion
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
        items: items.map(i => ({
          output_id: i.output_id,
          output_type: i.output_type,
          character_key: i.character_key,
          reason: i.reason,
        })),
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

/**
 * castRegenPlanner — Client-side wrapper for the canonical regen planner.
 *
 * The CANONICAL planner implementation lives in the edge function
 * `queue-cast-regen` (server-side, backend-authoritative).
 *
 * This module provides:
 * 1. Type exports used across the client codebase
 * 2. A thin `buildCastRegenPlan()` that calls the edge function
 *    with `dryRun: true` to retrieve the plan without creating jobs.
 *
 * NO planner logic lives here. Single source of truth is server-side.
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types (shared across client codebase) ───────────────────────────────────

export type RegenReason =
  | 'out_of_sync_with_current_cast'
  | 'unbound'
  | 'stale_roster_revoked'
  | 'invalid_missing_version';

export interface RegenItem {
  output_id: string;
  output_type: 'ai_generated_media';
  character_key: string;
  reason: RegenReason;
  stored_actor_version_id: string | null;
  current_actor_version_id: string | null;
}

export interface RegenPlan {
  total_items: number;
  by_reason: Record<RegenReason, RegenItem[]>;
  by_character: Record<string, RegenItem[]>;
}

// ── Client wrapper — calls canonical server-side planner ────────────────────

export async function buildCastRegenPlan(projectId: string): Promise<RegenPlan> {
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
      body: JSON.stringify({ projectId, dryRun: true }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Plan fetch failed';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }

  const result = await resp.json();
  return result.plan as RegenPlan;
}

/**
 * autoRepairEngine — Phase 14: Controlled Auto-Repair.
 *
 * Converts Phase 13 regeneration policy into queued regen jobs.
 * User-triggered only. No background automation.
 *
 * Sends EXACT filtered policy items to the backend for canonical
 * validation and insertion. The backend validates each item against
 * its own canonical planner output before inserting.
 */

import { buildRegenPolicy } from './regenPolicyEngine';
import type { QueueResult } from './castRegenJobs';
import type { RegenReason } from './castRegenPlanner';
import { supabase } from '@/integrations/supabase/client';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AutoRepairOptions {
  priorities?: ('high' | 'medium' | 'low')[];
  limit?: number;
}

export interface AutoRepairItemResult {
  output_id: string;
  character_key: string | null;
  reason: string;
  status: 'created' | 'skipped';
}

export interface AutoRepairResult {
  attempted: number;
  created: number;
  skipped_duplicates: number;
  items: AutoRepairItemResult[];
}

// ── Allowed reasons that map to RegenReason ─────────────────────────────────

const POLICY_TO_REGEN_REASON: Record<string, RegenReason | null> = {
  scene_broken: 'out_of_sync_with_current_cast',
  scene_partial: 'out_of_sync_with_current_cast',
  character_misaligned: 'out_of_sync_with_current_cast',
  character_unbound: 'unbound',
  continuity_broken: 'out_of_sync_with_current_cast',
  continuity_mixed: 'out_of_sync_with_current_cast',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getSessionToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session.access_token;
}

// ── Core ────────────────────────────────────────────────────────────────────

export async function executeAutoRepair(
  projectId: string,
  options?: AutoRepairOptions,
): Promise<AutoRepairResult> {
  if (!projectId) throw new Error('projectId is required');

  // 1. Load policy (Phase 13 — no recomputation of diagnostics)
  const policy = await buildRegenPolicy(projectId);

  if (policy.total_items === 0) {
    return { attempted: 0, created: 0, skipped_duplicates: 0, items: [] };
  }

  // 2. Filter by priority (default: high only)
  const allowedPriorities = new Set(options?.priorities ?? ['high']);
  let filtered = policy.items.filter(i => allowedPriorities.has(i.priority));

  // 3. Apply deterministic limit
  if (options?.limit != null && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  if (filtered.length === 0) {
    return { attempted: 0, created: 0, skipped_duplicates: 0, items: [] };
  }

  // 4. Build exact item list from filtered policy items
  // Each policy item may have multiple reasons; expand into individual queue items
  // Deduplicate by (output_id, character_key, mapped_reason)
  const seen = new Set<string>();
  const exactItems: Array<{ output_id: string; character_key: string; reason: RegenReason }> = [];

  for (const item of filtered) {
    for (const policyReason of item.reasons) {
      const regenReason = POLICY_TO_REGEN_REASON[policyReason];
      if (!regenReason) continue;

      const dedupKey = `${item.output_id}|${item.character_key ?? ''}|${regenReason}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      exactItems.push({
        output_id: item.output_id,
        character_key: item.character_key ?? '',
        reason: regenReason,
      });
    }
  }

  if (exactItems.length === 0) {
    return { attempted: filtered.length, created: 0, skipped_duplicates: 0, items: [] };
  }

  // 5. Send exact items to backend for canonical validation + insertion
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
        exactItems,
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Auto-repair queue failed';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }

  const result: QueueResult = await resp.json();

  // 6. Build result items
  const resultItems: AutoRepairItemResult[] = [];
  const createdSet = new Set(result.jobs.map(j => `${j.output_id}|${j.character_key}|${j.reason}`));

  for (const ei of exactItems) {
    const key = `${ei.output_id}|${ei.character_key}|${ei.reason}`;
    resultItems.push({
      output_id: ei.output_id,
      character_key: ei.character_key || null,
      reason: ei.reason,
      status: createdSet.has(key) ? 'created' : 'skipped',
    });
  }

  return {
    attempted: filtered.length,
    created: result.created_count,
    skipped_duplicates: result.skipped_duplicates,
    items: resultItems,
  };
}

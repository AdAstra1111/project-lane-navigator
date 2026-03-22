/**
 * autoRepairEngine — Phase 14: Controlled Auto-Repair.
 *
 * Converts Phase 13 regeneration policy into queued regen jobs.
 * User-triggered only. No background automation.
 * Consumes buildRegenPolicy output → groups → calls queueCastRegenJobs.
 */

import { buildRegenPolicy, type RegenPolicyItem } from './regenPolicyEngine';
import { queueCastRegenJobs, type QueueResult } from './castRegenJobs';
import type { RegenReason } from './castRegenPlanner';

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

// ── Core ────────────────────────────────────────────────────────────────────

export async function executeAutoRepair(
  projectId: string,
  options?: AutoRepairOptions,
): Promise<AutoRepairResult> {
  if (!projectId) throw new Error('projectId is required');

  // 1. Load policy (Phase 13 — no recomputation)
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

  // 4. Group by (character_key, mapped_reason) for queue calls
  const groups = new Map<string, { characterKey: string | null; reason: RegenReason; items: RegenPolicyItem[] }>();

  for (const item of filtered) {
    // Map each policy reason to a queue-compatible RegenReason
    for (const policyReason of item.reasons) {
      const regenReason = POLICY_TO_REGEN_REASON[policyReason];
      if (!regenReason) continue;

      const groupKey = `${item.character_key ?? '__ALL__'}|${regenReason}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(groupKey, {
          characterKey: item.character_key,
          reason: regenReason,
          items: [item],
        });
      }
    }
  }

  // 5. Execute queue calls sequentially (each is backend-authoritative)
  let totalCreated = 0;
  let totalSkipped = 0;
  const resultItems: AutoRepairItemResult[] = [];

  for (const group of groups.values()) {
    try {
      const queueResult: QueueResult = await queueCastRegenJobs(projectId, {
        characterKey: group.characterKey ?? undefined,
        reasons: [group.reason],
      });

      totalCreated += queueResult.created_count;
      totalSkipped += queueResult.skipped_duplicates;

      // Map queue jobs back to result items
      for (const job of queueResult.jobs) {
        resultItems.push({
          output_id: job.output_id,
          character_key: job.character_key,
          reason: job.reason,
          status: 'created',
        });
      }

      // Track skipped items from this group
      const createdOutputIds = new Set(queueResult.jobs.map(j => j.output_id));
      for (const item of group.items) {
        if (!createdOutputIds.has(item.output_id)) {
          resultItems.push({
            output_id: item.output_id,
            character_key: item.character_key,
            reason: group.reason,
            status: 'skipped',
          });
        }
      }
    } catch (err) {
      // On failure, mark all group items as skipped
      for (const item of group.items) {
        resultItems.push({
          output_id: item.output_id,
          character_key: item.character_key,
          reason: group.reason,
          status: 'skipped',
        });
      }
    }
  }

  return {
    attempted: filtered.length,
    created: totalCreated,
    skipped_duplicates: totalSkipped,
    items: resultItems,
  };
}

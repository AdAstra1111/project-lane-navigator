/**
 * castRegenPlanner — Deterministic regeneration planner.
 *
 * Read-only. Produces a structured plan of which generated outputs
 * must be regenerated due to cast drift, grouped by reason and character.
 *
 * Uses existing provenance (cast_provenance / cast_context) from
 * ai_generated_media.generation_params and compares against current
 * project_ai_cast bindings + actor roster state.
 *
 * NO mutations. NO job creation. Planning layer only.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Planner ─────────────────────────────────────────────────────────────────

export async function buildCastRegenPlan(projectId: string): Promise<RegenPlan> {
  // A. Fetch current bindings
  const { data: bindings } = await (supabase as any)
    .from('project_ai_cast')
    .select('character_key, ai_actor_id, ai_actor_version_id')
    .eq('project_id', projectId) as { data: any[] | null };

  const bindingMap: Record<string, { actor_id: string; version_id: string | null }> = {};
  const boundActorIds = new Set<string>();
  for (const b of bindings || []) {
    const key = normalizeCharacterKey(b.character_key || '');
    bindingMap[key] = {
      actor_id: b.ai_actor_id,
      version_id: b.ai_actor_version_id,
    };
    if (b.ai_actor_id) boundActorIds.add(b.ai_actor_id);
  }

  // B. Fetch generated outputs
  const { data: media } = await supabase
    .from('ai_generated_media')
    .select('id, generation_params')
    .eq('project_id', projectId)
    .limit(500);

  // C. Extract all provenance entries and collect actor IDs for batch fetch
  interface RawEntry {
    outputId: string;
    charKey: string;
    storedVersionId: string | null;
    storedActorId: string | null;
  }
  const rawEntries: RawEntry[] = [];
  const allActorIds = new Set(boundActorIds);

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;
    if (!Array.isArray(provenance)) continue;

    for (const p of provenance) {
      const charKey = normalizeCharacterKey(p.character_key || '');
      if (!charKey) continue;

      const actorId = p.actor_id || null;
      if (actorId) allActorIds.add(actorId);

      rawEntries.push({
        outputId: item.id,
        charKey,
        storedVersionId: p.actor_version_id || null,
        storedActorId: actorId,
      });
    }
  }

  // E. Batch fetch actor roster state (for stale_roster_revoked)
  const actorState: Record<string, { roster_ready: boolean }> = {};
  const actorIdArr = [...allActorIds];
  if (actorIdArr.length > 0) {
    const { data: actorRows } = await supabase
      .from('ai_actors')
      .select('id, roster_ready')
      .in('id', actorIdArr);

    for (const a of actorRows || []) {
      actorState[a.id] = { roster_ready: a.roster_ready };
    }
  }

  // F. Batch fetch version existence (for invalid_missing_version)
  const boundVersionIds = [...new Set(
    (bindings || []).map((b: any) => b.ai_actor_version_id).filter(Boolean)
  )];
  const versionExists = new Set<string>();
  if (boundVersionIds.length > 0) {
    const { data: versionRows } = await supabase
      .from('ai_actor_versions')
      .select('id')
      .in('id', boundVersionIds);

    for (const v of versionRows || []) {
      versionExists.add(v.id);
    }
  }

  // G. Classify each entry
  // Order: A) unbound → B) invalid_missing_version → C) stale_roster_revoked → D) in-sync skip → E) out_of_sync
  const items: RegenItem[] = [];

  for (const entry of rawEntries) {
    const binding = bindingMap[entry.charKey];
    const currentVersionId = binding?.version_id ?? null;

    // A. No current binding → unbound
    if (!binding) {
      items.push({
        output_id: entry.outputId,
        output_type: 'ai_generated_media',
        character_key: entry.charKey,
        reason: 'unbound',
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: null,
      });
      continue;
    }

    // B. Bound version row does not exist → invalid_missing_version
    if (currentVersionId && !versionExists.has(currentVersionId)) {
      items.push({
        output_id: entry.outputId,
        output_type: 'ai_generated_media',
        character_key: entry.charKey,
        reason: 'invalid_missing_version',
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: currentVersionId,
      });
      continue;
    }

    // C. Bound actor roster revoked → stale_roster_revoked
    const bindingActor = binding.actor_id ? actorState[binding.actor_id] : null;
    if (bindingActor && !bindingActor.roster_ready) {
      items.push({
        output_id: entry.outputId,
        output_type: 'ai_generated_media',
        character_key: entry.charKey,
        reason: 'stale_roster_revoked',
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: currentVersionId,
      });
      continue;
    }

    // D. In sync → skip
    if (entry.storedVersionId === currentVersionId) continue;

    // E. Version mismatch → out_of_sync_with_current_cast
    items.push({
      output_id: entry.outputId,
      output_type: 'ai_generated_media',
      character_key: entry.charKey,
      reason: 'out_of_sync_with_current_cast',
      stored_actor_version_id: entry.storedVersionId,
      current_actor_version_id: currentVersionId,
    });

    items.push({
      output_id: entry.outputId,
      output_type: 'ai_generated_media',
      character_key: entry.charKey,
      reason,
      stored_actor_version_id: entry.storedVersionId,
      current_actor_version_id: currentVersionId,
    });
  }

  // F. Build grouped structure
  const byReason: Record<RegenReason, RegenItem[]> = {
    out_of_sync_with_current_cast: [],
    unbound: [],
    stale_roster_revoked: [],
    invalid_missing_version: [],
  };
  const byCharacter: Record<string, RegenItem[]> = {};

  for (const item of items) {
    byReason[item.reason].push(item);
    if (!byCharacter[item.character_key]) byCharacter[item.character_key] = [];
    byCharacter[item.character_key].push(item);
  }

  return {
    total_items: items.length,
    by_reason: byReason,
    by_character: byCharacter,
  };
}

/**
 * pendingBindRecovery — Phase 17.1: Persistent pending-bind workflow context.
 *
 * This is WORKFLOW METADATA ONLY. NOT canonical cast truth.
 * Used to preserve project/character context when an actor is created
 * from ProjectCasting but is not yet roster-ready/bindable.
 *
 * Survives navigation/refresh via DB persistence.
 * Cleared when resolved (bound) or abandoned (dismissed).
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PendingActorBindContext {
  id: string;
  actor_id: string;
  project_id: string;
  character_key: string;
  source: string;
  status: 'pending_bind' | 'resolved' | 'abandoned';
  created_at: string;
  resolved_at: string | null;
  user_id: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function createPendingActorBindContext(
  actorId: string,
  projectId: string,
  characterKey: string,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { error } = await (supabase as any)
    .from('pending_actor_binds')
    .upsert(
      {
        actor_id: actorId,
        project_id: projectId,
        character_key: characterKey,
        source: 'project-casting-inline-create',
        status: 'pending_bind',
        user_id: session.user.id,
      },
      { onConflict: 'actor_id,project_id,character_key' },
    );

  if (error) throw new Error(`Failed to create pending bind context: ${error.message}`);
}

export async function getPendingActorBindContextsForProject(
  projectId: string,
): Promise<PendingActorBindContext[]> {
  const { data, error } = await (supabase as any)
    .from('pending_actor_binds')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'pending_bind')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch pending binds: ${error.message}`);
  return (data || []) as PendingActorBindContext[];
}

export async function getPendingActorBindContextForActor(
  actorId: string,
): Promise<PendingActorBindContext | null> {
  const { data, error } = await (supabase as any)
    .from('pending_actor_binds')
    .select('*')
    .eq('actor_id', actorId)
    .eq('status', 'pending_bind')
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch pending bind: ${error.message}`);
  return data as PendingActorBindContext | null;
}

export async function resolvePendingActorBindContext(
  actorId: string,
  projectId: string,
  characterKey: string,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('pending_actor_binds')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('actor_id', actorId)
    .eq('project_id', projectId)
    .eq('character_key', characterKey)
    .eq('status', 'pending_bind');

  if (error) throw new Error(`Failed to resolve pending bind: ${error.message}`);
}

export async function abandonPendingActorBindContext(
  actorId: string,
  projectId: string,
  characterKey: string,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('pending_actor_binds')
    .update({ status: 'abandoned', resolved_at: new Date().toISOString() })
    .eq('actor_id', actorId)
    .eq('project_id', projectId)
    .eq('character_key', characterKey)
    .eq('status', 'pending_bind');

  if (error) throw new Error(`Failed to abandon pending bind: ${error.message}`);
}

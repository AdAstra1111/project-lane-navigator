/**
 * marketplaceIntelligence — Phase 16: Marketplace metrics + listing management.
 *
 * Derives marketplace-relevant metrics from existing system data.
 * All metrics are deterministic and read-only.
 * Listing management is explicit, owner-controlled only.
 */

import { supabase } from '@/integrations/supabase/client';
import { buildActorIntelligence, type ActorIntelligenceProfile } from './actorIntelligence';

// ── Types ───────────────────────────────────────────────────────────────────

export type PricingTier = 'free' | 'standard' | 'premium' | 'signature';
export type ActorVisibility = 'private' | 'team' | 'public';
export type LicensingMode = 'private' | 'internal' | 'marketplace';

export interface MarketplaceListing {
  id: string;
  actor_id: string;
  is_active: boolean;
  pricing_tier: PricingTier;
  visibility: ActorVisibility;
  listed_at: string;
  updated_at: string;
  listed_by: string | null;
}

export interface MarketplaceActorProfile {
  actor_id: string;
  actor_name: string;
  description: string;
  tags: string[];
  // Ownership
  owner_user_id: string;
  licensing_mode: LicensingMode;
  visibility: ActorVisibility;
  is_listed: boolean;
  pricing_tier: PricingTier;
  // Derived metrics (from intelligence)
  usage_count: number;
  project_count: number;
  quality_score: number | null;
  quality_band: string | null;
  reusability_tier: 'signature' | 'reliable' | 'emerging' | 'unvalidated';
  continuity_score: number | null;
  roster_ready: boolean;
  approved_version_id: string | null;
  // Listing state
  listing: MarketplaceListing | null;
}

export interface MarketplaceSummary {
  total_listed: number;
  by_tier: Record<string, number>;
  by_visibility: Record<string, number>;
  actors: MarketplaceActorProfile[];
}

// ── Core: Build marketplace profiles ────────────────────────────────────────

export async function buildMarketplaceProfiles(): Promise<MarketplaceSummary> {
  // 1. Get intelligence data (reuse, no duplication)
  const intelligence = await buildActorIntelligence();

  // 2. Fetch actor marketplace fields
  const { data: actors } = await supabase
    .from('ai_actors')
    .select('id, name, description, tags, user_id, roster_ready, approved_version_id, licensing_mode, visibility, is_listed, pricing_tier')
    .order('name');

  // 3. Fetch active listings
  const { data: listings } = await (supabase as any)
    .from('actor_marketplace_listings')
    .select('*');

  const listingMap = new Map<string, MarketplaceListing>();
  for (const l of listings || []) {
    listingMap.set(l.actor_id, l as MarketplaceListing);
  }

  // 4. Build intelligence lookup
  const intelMap = new Map<string, ActorIntelligenceProfile>();
  for (const a of intelligence.actors) {
    intelMap.set(a.actor_id, a);
  }

  // 5. Build profiles
  const profiles: MarketplaceActorProfile[] = (actors || []).map((actor: any) => {
    const intel = intelMap.get(actor.id);
    const listing = listingMap.get(actor.id) || null;

    return {
      actor_id: actor.id,
      actor_name: actor.name,
      description: actor.description || '',
      tags: actor.tags || [],
      owner_user_id: actor.user_id,
      licensing_mode: (actor.licensing_mode || 'private') as LicensingMode,
      visibility: (actor.visibility || 'private') as ActorVisibility,
      is_listed: actor.is_listed || false,
      pricing_tier: (actor.pricing_tier || 'free') as PricingTier,
      usage_count: intel?.character_count || 0,
      project_count: intel?.project_count || 0,
      quality_score: intel?.quality_score ?? null,
      quality_band: intel?.quality_band ?? null,
      reusability_tier: intel?.reusability_tier || 'unvalidated',
      continuity_score: null, // Phase 11 integration — derived if needed
      roster_ready: actor.roster_ready || false,
      approved_version_id: actor.approved_version_id || null,
      listing,
    };
  });

  // 6. Summary
  const listed = profiles.filter(p => p.is_listed && p.listing?.is_active);
  const by_tier: Record<string, number> = {};
  const by_visibility: Record<string, number> = {};
  for (const p of listed) {
    by_tier[p.pricing_tier] = (by_tier[p.pricing_tier] || 0) + 1;
    by_visibility[p.visibility] = (by_visibility[p.visibility] || 0) + 1;
  }

  return {
    total_listed: listed.length,
    by_tier,
    by_visibility,
    actors: profiles,
  };
}

// ── Listing Management ──────────────────────────────────────────────────────

export async function listActorOnMarketplace(
  actorId: string,
  opts?: { pricing_tier?: PricingTier; visibility?: ActorVisibility }
): Promise<{ success: boolean; error?: string }> {
  const tier = opts?.pricing_tier || 'free';
  const vis = opts?.visibility || 'public';

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Verify actor ownership + roster readiness
  const { data: actor } = await supabase
    .from('ai_actors')
    .select('id, user_id, roster_ready, approved_version_id')
    .eq('id', actorId)
    .single();

  if (!actor) return { success: false, error: 'Actor not found' };
  if (actor.user_id !== user.id) return { success: false, error: 'Not the actor owner' };
  if (!actor.roster_ready) return { success: false, error: 'Actor must be roster-ready to list' };
  if (!actor.approved_version_id) return { success: false, error: 'Actor must have an approved version' };

  // Upsert listing
  const { error: listingErr } = await (supabase as any)
    .from('actor_marketplace_listings')
    .upsert({
      actor_id: actorId,
      is_active: true,
      pricing_tier: tier,
      visibility: vis,
      listed_by: user.id,
      listed_at: new Date().toISOString(),
    }, { onConflict: 'actor_id' });

  if (listingErr) return { success: false, error: listingErr.message };

  // Update actor flags
  const { error: actorErr } = await supabase
    .from('ai_actors')
    .update({
      is_listed: true,
      pricing_tier: tier,
      visibility: vis,
      licensing_mode: 'marketplace',
    } as any)
    .eq('id', actorId);

  if (actorErr) return { success: false, error: actorErr.message };

  return { success: true };
}

export async function unlistActorFromMarketplace(actorId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Deactivate listing
  const { error: listingErr } = await (supabase as any)
    .from('actor_marketplace_listings')
    .update({ is_active: false })
    .eq('actor_id', actorId);

  if (listingErr) return { success: false, error: listingErr.message };

  // Update actor flags
  const { error: actorErr } = await supabase
    .from('ai_actors')
    .update({
      is_listed: false,
      licensing_mode: 'private',
      visibility: 'private',
    } as any)
    .eq('id', actorId);

  if (actorErr) return { success: false, error: actorErr.message };

  return { success: true };
}

// ── Public marketplace query (for browsing) ─────────────────────────────────

export async function getPublicMarketplaceActors(): Promise<MarketplaceActorProfile[]> {
  const summary = await buildMarketplaceProfiles();
  return summary.actors
    .filter(a => a.is_listed && a.listing?.is_active && a.visibility === 'public' && a.roster_ready)
    .sort((a, b) => {
      // Sort by tier weight, then quality, then usage
      const tierOrder = { signature: 0, reliable: 1, emerging: 2, unvalidated: 3 };
      const ta = tierOrder[a.reusability_tier] ?? 3;
      const tb = tierOrder[b.reusability_tier] ?? 3;
      if (ta !== tb) return ta - tb;
      if ((b.quality_score ?? -1) !== (a.quality_score ?? -1)) return (b.quality_score ?? -1) - (a.quality_score ?? -1);
      return b.project_count - a.project_count;
    });
}

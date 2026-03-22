/**
 * castResolver — SINGLE SOURCE OF TRUTH for project-bound cast identity resolution.
 *
 * All production generation flows MUST use this resolver.
 * Reads ONLY from project_ai_cast with pinned ai_actor_version_id.
 *
 * Rules:
 * - MUST NOT fallback to ai_actors.approved_version_id
 * - MUST NOT fallback to latest version
 * - MUST NOT use is_approved
 * - If no binding exists → explicit null result (no silent fallback)
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CastResolverResult {
  bound: true;
  actor_id: string;
  actor_name: string;
  actor_version_id: string;
  version_number: number;
  recipe_json: Record<string, unknown>;
  assets: {
    headshot: string | null;
    full_body: string | null;
    references: string[];
  };
}

export interface CastUnboundResult {
  bound: false;
  reason: 'no_cast_binding';
}

export type CastContextResult = CastResolverResult | CastUnboundResult;

export interface ProjectCastMap {
  [characterKey: string]: CastContextResult;
}

// ── Single Character Resolver ────────────────────────────────────────────────

/**
 * Resolve cast context for a single character in a project.
 * Reads ONLY from project_ai_cast — no fallback.
 */
export async function resolveProjectCastContext(params: {
  projectId: string;
  characterKey: string;
}): Promise<CastContextResult> {
  const { projectId, characterKey } = params;
  const normalizedKey = normalizeCharacterKey(characterKey);

  // Query project_ai_cast binding
  const { data: binding, error } = await (supabase as any)
    .from('project_ai_cast')
    .select(`
      ai_actor_id,
      ai_actor_version_id,
      ai_actors!inner(id, name)
    `)
    .eq('project_id', projectId)
    .eq('character_key', characterKey)
    .maybeSingle();

  if (error) {
    console.warn('[CastResolver] Query error:', error.message);
  }

  // Also try normalized key match if exact didn't work
  if (!binding) {
    const { data: bindingNorm } = await (supabase as any)
      .from('project_ai_cast')
      .select(`
        ai_actor_id,
        ai_actor_version_id,
        character_key,
        ai_actors!inner(id, name)
      `)
      .eq('project_id', projectId);

    const match = (bindingNorm || []).find(
      (b: any) => normalizeCharacterKey(b.character_key || '') === normalizedKey
    );

    if (!match || !match.ai_actor_version_id) {
      return { bound: false, reason: 'no_cast_binding' };
    }

    return resolveVersionAssets(match);
  }

  if (!binding.ai_actor_version_id) {
    return { bound: false, reason: 'no_cast_binding' };
  }

  return resolveVersionAssets(binding);
}

// ── Full Project Cast Map ────────────────────────────────────────────────────

/**
 * Resolve cast context for ALL characters in a project.
 * Returns a map keyed by lowercased character name.
 */
export async function resolveFullProjectCast(projectId: string): Promise<ProjectCastMap> {
  const map: ProjectCastMap = {};

  const { data: bindings, error } = await (supabase as any)
    .from('project_ai_cast')
    .select(`
      character_key,
      ai_actor_id,
      ai_actor_version_id,
      ai_actors!inner(id, name)
    `)
    .eq('project_id', projectId);

  if (error) {
    console.warn('[CastResolver] Full project query error:', error.message);
    return map;
  }

  if (!bindings || bindings.length === 0) return map;

  // Collect all version IDs for batch asset fetch
  const versionIds = [...new Set(
    (bindings as any[])
      .map(b => b.ai_actor_version_id)
      .filter(Boolean)
  )];

  // Batch fetch versions + assets
  let versionsMap: Record<string, { version_number: number; recipe_json: any }> = {};
  let assetsMap: Record<string, any[]> = {};

  if (versionIds.length > 0) {
    const { data: versions } = await (supabase as any)
      .from('ai_actor_versions')
      .select('id, version_number, recipe_json')
      .in('id', versionIds);

    for (const v of versions || []) {
      versionsMap[v.id] = { version_number: v.version_number, recipe_json: v.recipe_json };
    }

    const { data: assets } = await (supabase as any)
      .from('ai_actor_assets')
      .select('actor_version_id, asset_type, public_url, storage_path, meta_json')
      .in('actor_version_id', versionIds);

    for (const a of assets || []) {
      if (!assetsMap[a.actor_version_id]) assetsMap[a.actor_version_id] = [];
      assetsMap[a.actor_version_id].push(a);
    }
  }

  for (const binding of bindings as any[]) {
    const key = normalizeCharacterKey(binding.character_key || '');
    if (!key) continue;

    const versionId = binding.ai_actor_version_id;
    if (!versionId) {
      map[key] = { bound: false, reason: 'no_cast_binding' };
      continue;
    }

    const version = versionsMap[versionId];
    const versionAssets = assetsMap[versionId] || [];

    map[key] = {
      bound: true,
      actor_id: binding.ai_actor_id,
      actor_name: binding.ai_actors?.name || '',
      actor_version_id: versionId,
      version_number: version?.version_number || 0,
      recipe_json: version?.recipe_json || {},
      assets: classifyAssets(versionAssets),
    };
  }

  return map;
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

async function resolveVersionAssets(binding: any): Promise<CastResolverResult> {
  const versionId = binding.ai_actor_version_id;

  const [{ data: version }, { data: assets }] = await Promise.all([
    (supabase as any)
      .from('ai_actor_versions')
      .select('id, version_number, recipe_json')
      .eq('id', versionId)
      .maybeSingle(),
    (supabase as any)
      .from('ai_actor_assets')
      .select('asset_type, public_url, storage_path, meta_json')
      .eq('actor_version_id', versionId),
  ]);

  return {
    bound: true,
    actor_id: binding.ai_actor_id,
    actor_name: binding.ai_actors?.name || '',
    actor_version_id: versionId,
    version_number: version?.version_number || 0,
    recipe_json: version?.recipe_json || {},
    assets: classifyAssets(assets || []),
  };
}

function classifyAssets(assets: any[]): CastResolverResult['assets'] {
  let headshot: string | null = null;
  let fullBody: string | null = null;
  const references: string[] = [];

  for (const asset of assets) {
    const url = asset.public_url || asset.storage_path;
    if (!url) continue;

    const assetType = (asset.asset_type || '').toLowerCase();
    const metaShotType = ((asset.meta_json as any)?.shot_type || '').toLowerCase();

    if (
      assetType === 'reference_headshot' ||
      metaShotType === 'identity_headshot' ||
      metaShotType === 'headshot'
    ) {
      if (!headshot) headshot = url;
      else references.push(url);
    } else if (
      assetType === 'reference_full_body' ||
      metaShotType === 'identity_full_body' ||
      metaShotType === 'full_body'
    ) {
      if (!fullBody) fullBody = url;
      else references.push(url);
    } else if (
      assetType === 'reference_image' ||
      assetType === 'screen_test_still'
    ) {
      if (!headshot && metaShotType !== 'full_body') {
        headshot = url;
      } else {
        references.push(url);
      }
    }
  }

  return { headshot, full_body: fullBody, references };
}

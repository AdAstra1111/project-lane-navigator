/**
 * AI Cast Library — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callAiCast(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-cast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'AI Cast error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export interface AIActor {
  id: string;
  user_id: string;
  name: string;
  description: string;
  negative_prompt: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
  ai_actor_versions?: AIActorVersion[];
}

export interface AIActorVersion {
  id: string;
  actor_id: string;
  version_number: number;
  recipe_json: {
    invariants?: string[];
    allowed_variations?: string[];
    camera_rules?: string[];
    lighting_rules?: string[];
  };
  is_approved: boolean;
  created_at: string;
  created_by: string | null;
  ai_actor_assets?: AIActorAsset[];
}

export interface AIActorAsset {
  id: string;
  actor_version_id: string;
  asset_type: string;
  storage_path: string;
  public_url: string;
  meta_json: Record<string, any>;
  created_at: string;
}

export interface CastContextEntry {
  character_key: string;
  actor_name: string;
  description: string;
  negative_prompt: string;
  recipe: Record<string, any>;
  reference_images: string[];
  screen_test_images: string[];
  wardrobe_pack: string | null;
}

export const aiCastApi = {
  createActor: (params: { name: string; description?: string; negative_prompt?: string; tags?: string[] }) =>
    callAiCast('create_actor', params),

  updateActor: (actorId: string, params: Partial<{ name: string; description: string; negative_prompt: string; tags: string[]; status: string }>) =>
    callAiCast('update_actor', { actorId, ...params }),

  listActors: () =>
    callAiCast('list_actors', {}),

  getActor: (actorId: string) =>
    callAiCast('get_actor', { actorId }),

  createVersion: (actorId: string, recipe_json?: any) =>
    callAiCast('create_version', { actorId, recipe_json }),

  approveVersion: (actorId: string, versionId: string) =>
    callAiCast('approve_version', { actorId, versionId }),

  addAsset: (versionId: string, params: { asset_type?: string; storage_path?: string; public_url?: string; meta_json?: any }) =>
    callAiCast('add_asset', { versionId, ...params }),

  deleteAsset: (assetId: string) =>
    callAiCast('delete_asset', { assetId }),

  generateScreenTest: (actorId: string, versionId: string, count?: number) =>
    callAiCast('generate_screen_test', { actorId, versionId, count }),

  getCastContext: (projectId: string) =>
    callAiCast('get_cast_context', { projectId }),
};

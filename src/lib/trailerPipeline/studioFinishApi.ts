/**
 * Studio Finishing Layer — API wrappers
 */
import { supabase } from '@/integrations/supabase/client';

async function callFinish(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trailer-studio-finish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Studio finish error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}

export const studioFinishApi = {
  listProfiles: (projectId: string) =>
    callFinish('list_profiles', { projectId }),

  createProfile: (projectId: string, profile: Record<string, any>) =>
    callFinish('create_profile', { projectId, ...profile }),

  createRenderVariants: (projectId: string, params: {
    cutId: string;
    audioRunId?: string;
    finishingProfileId?: string;
    variantKeys?: string[];
  }) => callFinish('create_render_variants', { projectId, ...params }),

  getRenderVariants: (projectId: string, cutId: string) =>
    callFinish('get_render_variants', { projectId, cutId }),

  updateVariantStatus: (projectId: string, variantId: string, status: string, extra?: any) =>
    callFinish('update_variant_status', { projectId, variantId, status, ...extra }),
};

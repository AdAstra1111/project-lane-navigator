/**
 * Bridge: Register a poster from project_posters into the canonical project_images table.
 * Called after poster generation to maintain the unified image registry.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ProjectImageRole, CanonConstraints } from './types';

interface RegisterPosterInput {
  projectId: string;
  posterId: string;
  storagePath: string;
  storageBucket?: string;
  promptUsed?: string;
  negativePrompt?: string;
  canonConstraints?: CanonConstraints;
  isPrimary?: boolean;
  role?: ProjectImageRole;
  width?: number;
  height?: number;
}

/**
 * Register a poster as a canonical project image.
 * Enforces primary uniqueness: only one poster_primary per project.
 */
export async function registerPosterAsCanonicalImage(input: RegisterPosterInput): Promise<string | null> {
  const {
    projectId, posterId, storagePath,
    storageBucket = 'project-posters',
    promptUsed = '', negativePrompt = '',
    canonConstraints = {},
    isPrimary = true,
    role = 'poster_primary',
    width, height,
  } = input;

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user?.id) return null;

  // If setting as primary, deactivate existing primaries for same role
  if (isPrimary && (role === 'poster_primary' || role === 'lookbook_cover')) {
    await (supabase as any)
      .from('project_images')
      .update({ is_primary: false, is_active: false })
      .eq('project_id', projectId)
      .eq('role', role)
      .eq('is_primary', true);
  }

  const { data, error } = await (supabase as any)
    .from('project_images')
    .insert({
      project_id: projectId,
      role,
      asset_group: 'poster',
      curation_state: 'active',
      prompt_used: promptUsed,
      negative_prompt: negativePrompt,
      canon_constraints: canonConstraints,
      storage_path: storagePath,
      storage_bucket: storageBucket,
      width: width || null,
      height: height || null,
      is_primary: isPrimary,
      is_active: true,
      source_poster_id: posterId,
      user_id: user.user.id,
      created_by: user.user.id,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[registerPosterAsCanonicalImage]', error.message);
    return null;
  }

  return data?.id || null;
}

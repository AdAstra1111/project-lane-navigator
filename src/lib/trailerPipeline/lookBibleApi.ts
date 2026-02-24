/**
 * Look Bible API — CRUD + retrieval for trailer look bibles
 */
import { supabase } from '@/integrations/supabase/client';

export interface LookBible {
  id: string;
  project_id: string;
  scope: string;
  scope_ref_id: string | null;
  title: string;
  palette: string | null;
  lighting_style: string | null;
  contrast: string | null;
  camera_language: string | null;
  grain: string | null;
  color_grade: string | null;
  reference_assets_notes: string | null;
  avoid_list: string[] | null;
  custom_directives: string | null;
  is_locked: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function fetchLookBible(projectId: string, scopeRefId?: string): Promise<LookBible | null> {
  // Priority: scope_ref_id match → project scope
  if (scopeRefId) {
    const { data } = await supabase
      .from('trailer_look_bibles')
      .select('*')
      .eq('project_id', projectId)
      .eq('scope_ref_id', scopeRefId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as LookBible;
  }

  const { data } = await supabase
    .from('trailer_look_bibles')
    .select('*')
    .eq('project_id', projectId)
    .eq('scope', 'project')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as LookBible) || null;
}

export async function upsertLookBible(lb: Partial<LookBible> & { project_id: string }): Promise<LookBible> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  if (lb.id) {
    const { data, error } = await supabase
      .from('trailer_look_bibles')
      .update({
        title: lb.title,
        palette: lb.palette,
        lighting_style: lb.lighting_style,
        contrast: lb.contrast,
        camera_language: lb.camera_language,
        grain: lb.grain,
        color_grade: lb.color_grade,
        reference_assets_notes: lb.reference_assets_notes,
        avoid_list: lb.avoid_list,
        custom_directives: lb.custom_directives,
        is_locked: lb.is_locked,
      } as any)
      .eq('id', lb.id)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as LookBible;
  }

  const { data, error } = await supabase
    .from('trailer_look_bibles')
    .insert({
      project_id: lb.project_id,
      scope: lb.scope || 'project',
      scope_ref_id: lb.scope_ref_id || null,
      title: lb.title || 'Look Bible',
      palette: lb.palette || null,
      lighting_style: lb.lighting_style || null,
      contrast: lb.contrast || null,
      camera_language: lb.camera_language || null,
      grain: lb.grain || null,
      color_grade: lb.color_grade || null,
      reference_assets_notes: lb.reference_assets_notes || null,
      avoid_list: lb.avoid_list || null,
      custom_directives: lb.custom_directives || null,
      is_locked: lb.is_locked || false,
      created_by: session.user.id,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as LookBible;
}

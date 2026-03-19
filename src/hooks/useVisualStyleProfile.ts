/**
 * useVisualStyleProfile — CRUD hook for project_visual_style.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface VisualStyleProfile {
  id?: string;
  project_id: string;
  period: string;
  cultural_context: string;
  lighting_philosophy: string;
  camera_philosophy: string;
  composition_philosophy: string;
  texture_materiality: string;
  color_response: string;
  environment_realism: string;
  forbidden_traits: string[];
  is_complete: boolean;
}

const EMPTY_PROFILE: Omit<VisualStyleProfile, 'project_id'> = {
  period: '',
  cultural_context: '',
  lighting_philosophy: '',
  camera_philosophy: '',
  composition_philosophy: '',
  texture_materiality: '',
  color_response: '',
  environment_realism: '',
  forbidden_traits: [],
  is_complete: false,
};

const REQUIRED_FIELDS: (keyof VisualStyleProfile)[] = [
  'period', 'lighting_philosophy', 'camera_philosophy',
  'composition_philosophy', 'texture_materiality', 'color_response',
  'environment_realism',
];

function checkComplete(p: Partial<VisualStyleProfile>): boolean {
  return REQUIRED_FIELDS.every(f => {
    const v = p[f];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function useVisualStyleProfile(projectId: string | undefined) {
  const [profile, setProfile] = useState<VisualStyleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('project_visual_style')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) {
      console.error('[VSAL] load error:', error.message);
    }
    setProfile(data || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (updates: Partial<VisualStyleProfile>) => {
    if (!projectId) return;
    setSaving(true);

    const merged = { ...EMPTY_PROFILE, ...profile, ...updates, project_id: projectId };
    merged.is_complete = checkComplete(merged);

    try {
      if (profile?.id) {
        // Update
        const { error } = await (supabase as any)
          .from('project_visual_style')
          .update({
            period: merged.period,
            cultural_context: merged.cultural_context,
            lighting_philosophy: merged.lighting_philosophy,
            camera_philosophy: merged.camera_philosophy,
            composition_philosophy: merged.composition_philosophy,
            texture_materiality: merged.texture_materiality,
            color_response: merged.color_response,
            environment_realism: merged.environment_realism,
            forbidden_traits: merged.forbidden_traits,
            is_complete: merged.is_complete,
          })
          .eq('id', profile.id);
        if (error) throw error;
      } else {
        // Insert
        const { data: user } = await supabase.auth.getUser();
        const { error } = await (supabase as any)
          .from('project_visual_style')
          .insert({
            project_id: projectId,
            period: merged.period,
            cultural_context: merged.cultural_context,
            lighting_philosophy: merged.lighting_philosophy,
            camera_philosophy: merged.camera_philosophy,
            composition_philosophy: merged.composition_philosophy,
            texture_materiality: merged.texture_materiality,
            color_response: merged.color_response,
            environment_realism: merged.environment_realism,
            forbidden_traits: merged.forbidden_traits,
            is_complete: merged.is_complete,
            created_by: user?.user?.id || null,
          });
        if (error) throw error;
      }
      toast.success('Visual style profile saved');
      await load();
    } catch (err: any) {
      console.error('[VSAL] save error:', err.message);
      toast.error('Failed to save visual style profile');
    } finally {
      setSaving(false);
    }
  }, [projectId, profile, load]);

  return { profile, loading, saving, save, reload: load };
}

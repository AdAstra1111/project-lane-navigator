/**
 * useVisualStyleProfile — CRUD hook for project_visual_style.
 * Now supports auto-hydration from inferred values.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { resolveInferredVisualStyle, type InferredVisualStyle } from '@/lib/visual/resolveInferredVisualStyle';

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
  const [inferred, setInferred] = useState<InferredVisualStyle | null>(null);
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);

    // Load saved profile and inferred values in parallel
    const [dbResult, inferredResult] = await Promise.all([
      (supabase as any)
        .from('project_visual_style')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle(),
      resolveInferredVisualStyle(projectId).catch(() => null),
    ]);

    if (dbResult.error) {
      console.error('[VSAL] load error:', dbResult.error.message);
    }

    if (inferredResult) {
      setInferred(inferredResult);
    }

    if (dbResult.data) {
      setProfile(dbResult.data);
      setIsAutoFilled(false);
    } else if (inferredResult) {
      // No saved profile — use inferred as the initial view
      setProfile({
        project_id: projectId,
        ...inferredResult,
        is_complete: checkComplete(inferredResult),
      });
      setIsAutoFilled(true);
    } else {
      setProfile(null);
      setIsAutoFilled(false);
    }

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
      setIsAutoFilled(false);
      await load();
    } catch (err: any) {
      console.error('[VSAL] save error:', err.message);
      toast.error('Failed to save visual style profile');
    } finally {
      setSaving(false);
    }
  }, [projectId, profile, load]);

  return { profile, inferred, isAutoFilled, loading, saving, save, reload: load };
}

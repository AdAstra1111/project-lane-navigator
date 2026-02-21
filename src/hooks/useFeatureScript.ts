import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Types ──

export interface ScriptUnit {
  id: string;
  project_id: string;
  blueprint_id: string | null;
  unit_type: string;
  parent_unit_id: string | null;
  order_index: number;
  title: string | null;
  slugline: string | null;
  time_of_day: string | null;
  location: string | null;
  page_estimate: number | null;
  plaintext: string;
  unit_json: any;
  created_at: string;
  updated_at: string;
}

export interface ScriptBlueprint {
  id: string;
  project_id: string;
  blueprint_json: any;
  created_at: string;
  updated_at: string;
}

export interface ScriptUnitLink {
  id: string;
  from_unit_id: string;
  to_unit_id: string;
  link_type: string;
  strength: number;
  note: string | null;
}

export interface AnalysisNote {
  id: string;
  severity: 'must' | 'should' | 'could';
  scope: 'scene' | 'dependency' | 'blueprint';
  summary: string;
  detail: string;
  impacted_unit_ids: string[];
  suggested_fixes: Array<{
    fix_id: string;
    label: string;
    action: 'rewrite_scene' | 'patch_impacted' | 'update_blueprint';
    payload: any;
  }>;
}

export interface AnalysisResult {
  notes: AnalysisNote[];
  impacts: Array<{ unit_id: string; why: string }>;
  updated_unit_json_preview: any;
}

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session.access_token;
}

async function callEdgeFunction(name: string, body: any) {
  const token = await getAccessToken();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    if (resp.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
    if (resp.status === 402) throw new Error('Usage credits exhausted. Please add credits.');
    throw new Error(err.error || `Edge function error: ${resp.status}`);
  }
  return resp.json();
}

export function useFeatureScript(projectId: string) {
  const qc = useQueryClient();
  const [isIngesting, setIsIngesting] = useState(false);
  const [isBuildingBlueprint, setIsBuildingBlueprint] = useState(false);

  // ── Queries ──

  const { data: blueprint, isLoading: blueprintLoading } = useQuery({
    queryKey: ['feature-blueprint', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('script_blueprints')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ScriptBlueprint | null;
    },
    enabled: !!projectId,
  });

  const { data: scenes = [], isLoading: scenesLoading } = useQuery({
    queryKey: ['feature-scenes', projectId, blueprint?.id],
    queryFn: async () => {
      if (!blueprint?.id) return [];
      const { data, error } = await supabase
        .from('script_units')
        .select('*')
        .eq('project_id', projectId)
        .eq('blueprint_id', blueprint.id)
        .eq('unit_type', 'scene')
        .order('order_index');
      if (error) throw error;
      return (data || []) as ScriptUnit[];
    },
    enabled: !!projectId && !!blueprint?.id,
  });

  const { data: links = [] } = useQuery({
    queryKey: ['feature-links', projectId, blueprint?.id],
    queryFn: async () => {
      if (!blueprint?.id) return [];
      const { data, error } = await supabase
        .from('script_unit_links')
        .select('*')
        .eq('blueprint_id', blueprint.id);
      if (error) throw error;
      return (data || []) as ScriptUnitLink[];
    },
    enabled: !!projectId && !!blueprint?.id,
  });

  const { data: worldState } = useQuery({
    queryKey: ['feature-world-state', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('script_world_state')
        .select('state_json')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return data?.state_json || null;
    },
    enabled: !!projectId,
  });

  // ── Mutations ──

  const ingestScript = useCallback(async (plaintextScript: string, sourceVersionId?: string) => {
    setIsIngesting(true);
    try {
      const result = await callEdgeFunction('feature-script-ingest', {
        projectId,
        sourceVersionId: sourceVersionId || null,
        plaintextScript,
      });
      toast.success(`Ingested ${result.unitsCreated} scenes`);
      qc.invalidateQueries({ queryKey: ['feature-blueprint', projectId] });
      qc.invalidateQueries({ queryKey: ['feature-scenes', projectId] });
      return result;
    } catch (err: any) {
      toast.error(err.message || 'Ingestion failed');
      throw err;
    } finally {
      setIsIngesting(false);
    }
  }, [projectId, qc]);

  const buildBlueprint = useCallback(async (blueprintId: string) => {
    setIsBuildingBlueprint(true);
    try {
      const result = await callEdgeFunction('feature-blueprint-build', { projectId, blueprintId });
      toast.success('Blueprint built successfully');
      qc.invalidateQueries({ queryKey: ['feature-blueprint', projectId] });
      qc.invalidateQueries({ queryKey: ['feature-links', projectId] });
      qc.invalidateQueries({ queryKey: ['feature-world-state', projectId] });
      return result;
    } catch (err: any) {
      toast.error(err.message || 'Blueprint build failed');
      throw err;
    } finally {
      setIsBuildingBlueprint(false);
    }
  }, [projectId, qc]);

  const analyseScene = useCallback(async (unitId: string, proposedPlaintext?: string): Promise<AnalysisResult> => {
    const result = await callEdgeFunction('feature-scene-analyse', {
      projectId,
      unitId,
      proposedPlaintext: proposedPlaintext || undefined,
    });
    return result;
  }, [projectId]);

  const applyFix = useCallback(async (unitId: string, fix: { action: string; payload: any }) => {
    const result = await callEdgeFunction('feature-scene-apply-fix', { projectId, unitId, fix });
    qc.invalidateQueries({ queryKey: ['feature-scenes', projectId] });
    qc.invalidateQueries({ queryKey: ['feature-blueprint', projectId] });
    qc.invalidateQueries({ queryKey: ['feature-world-state', projectId] });
    toast.success('Fix applied');
    return result;
  }, [projectId, qc]);

  const saveSceneVersion = useCallback(async (unitId: string, newPlaintext: string) => {
    // Get next version number
    const { data: maxVer } = await supabase
      .from('script_unit_versions')
      .select('version_number')
      .eq('unit_id', unitId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (maxVer?.version_number || 0) + 1;
    const { data: { user } } = await supabase.auth.getUser();

    // Create new version
    await supabase.from('script_unit_versions').insert({
      unit_id: unitId,
      version_number: nextVersion,
      plaintext: newPlaintext,
      unit_json: {},
      created_by: user?.id,
    });

    // Update current unit
    await supabase
      .from('script_units')
      .update({ plaintext: newPlaintext })
      .eq('id', unitId);

    qc.invalidateQueries({ queryKey: ['feature-scenes', projectId] });
    toast.success(`Saved version ${nextVersion}`);
  }, [projectId, qc]);

  const exportScreenplay = useCallback(() => {
    if (scenes.length === 0) {
      toast.error('No scenes to export');
      return;
    }
    const fullText = scenes.map(s => s.plaintext).join('\n\n');
    const blob = new Blob([fullText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenplay-export-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Screenplay exported');
  }, [scenes]);

  return {
    blueprint,
    scenes,
    links,
    worldState,
    blueprintLoading,
    scenesLoading,
    isIngesting,
    isBuildingBlueprint,
    ingestScript,
    buildBlueprint,
    analyseScene,
    applyFix,
    saveSceneVersion,
    exportScreenplay,
  };
}

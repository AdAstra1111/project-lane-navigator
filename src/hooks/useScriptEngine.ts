import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EngineScript {
  id: string;
  project_id: string;
  version: number;
  draft_number: number;
  status: string;
  structural_score: number | null;
  dialogue_score: number | null;
  economy_score: number | null;
  budget_score: number | null;
  lane_alignment_score: number | null;
  version_label: string | null;
  is_current: boolean;
  created_at: string;
}

export interface ScriptScene {
  id: string;
  script_id: string;
  scene_number: number;
  beat_summary: string | null;
  pov_character: string | null;
  objective: string | null;
  obstacle: string | null;
  conflict_type: string | null;
  turn_summary: string | null;
  escalation_notes: string | null;
  location: string | null;
  cast_size: number;
  production_weight: string;
  scene_score: number | null;
}

export interface ScriptVersion {
  id: string;
  script_id: string;
  draft_number: number;
  full_text_storage_path: string | null;
  blueprint_json: any;
  structural_score: number | null;
  dialogue_score: number | null;
  economy_score: number | null;
  budget_score: number | null;
  lane_alignment_score: number | null;
  rewrite_pass: string | null;
  notes: string | null;
  created_at: string;
}

export function useScriptEngine(projectId: string) {
  const qc = useQueryClient();
  const keys = {
    scripts: ['engine-scripts', projectId],
    scenes: (sid: string) => ['engine-scenes', sid],
    versions: (sid: string) => ['engine-versions', sid],
  };

  // Fetch engine scripts for project
  const { data: scripts = [], isLoading } = useQuery({
    queryKey: keys.scripts,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scripts')
        .select('id, project_id, version, draft_number, status, structural_score, dialogue_score, economy_score, budget_score, lane_alignment_score, version_label, is_current, created_at')
        .eq('project_id', projectId)
        .not('status', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EngineScript[];
    },
    enabled: !!projectId,
  });

  const activeScript = scripts.find(s => s.is_current) || scripts[0] || null;

  // Fetch scenes for active script
  const { data: scenes = [] } = useQuery({
    queryKey: keys.scenes(activeScript?.id || ''),
    queryFn: async () => {
      if (!activeScript) return [];
      const { data, error } = await supabase
        .from('script_scenes')
        .select('*')
        .eq('script_id', activeScript.id)
        .order('scene_number', { ascending: true });
      if (error) throw error;
      return (data || []) as ScriptScene[];
    },
    enabled: !!activeScript?.id,
  });

  // Fetch versions for active script
  const { data: versions = [] } = useQuery({
    queryKey: keys.versions(activeScript?.id || ''),
    queryFn: async () => {
      if (!activeScript) return [];
      const { data, error } = await supabase
        .from('script_versions')
        .select('*')
        .eq('script_id', activeScript.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ScriptVersion[];
    },
    enabled: !!activeScript?.id,
  });

  const blueprint = versions.find(v => v.blueprint_json)?.blueprint_json || null;

  // Generic action caller
  async function callEngine(action: string, extra: Record<string, any> = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/script-engine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, projectId, scriptId: activeScript?.id, ...extra }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Engine error');
    return result;
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: keys.scripts });
    if (activeScript) {
      qc.invalidateQueries({ queryKey: keys.scenes(activeScript.id) });
      qc.invalidateQueries({ queryKey: keys.versions(activeScript.id) });
    }
  }

  const generateBlueprint = useMutation({
    mutationFn: () => callEngine('blueprint'),
    onSuccess: (data) => {
      toast.success('Blueprint generated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateArchitecture = useMutation({
    mutationFn: () => callEngine('architecture'),
    onSuccess: () => {
      toast.success('Scene architecture generated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateDraft = useMutation({
    mutationFn: (params?: { batchStart?: number; batchEnd?: number }) =>
      callEngine('draft', params || {}),
    onSuccess: (data) => {
      if (data.isComplete) {
        toast.success(`Draft ${data.draftNumber || ''} complete`);
      } else {
        toast.success(`Batch ${data.batchStart}-${data.batchEnd} drafted`);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scoreScript = useMutation({
    mutationFn: () => callEngine('score'),
    onSuccess: () => {
      toast.success('Quality scores updated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rewritePass = useMutation({
    mutationFn: (pass: string) => callEngine('rewrite', { pass }),
    onSuccess: (data) => {
      toast.success(`Rewrite pass (${data.pass}) complete — Draft ${data.draftNumber}`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lockScript = useMutation({
    mutationFn: () => callEngine('lock'),
    onSuccess: () => {
      toast.success('Script locked');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    scripts, activeScript, scenes, versions, blueprint, isLoading,
    generateBlueprint, generateArchitecture, generateDraft,
    scoreScript, rewritePass, lockScript,
  };
}

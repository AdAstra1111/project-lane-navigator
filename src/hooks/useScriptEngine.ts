import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState } from 'react';

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
  latest_batch_storage_path: string | null;
  latest_draft_number: number | null;
  latest_batch_index: number | null;
  latest_page_count_est: number | null;
  latest_runtime_min_est: number | null;
  latest_runtime_min_low: number | null;
  latest_runtime_min_high: number | null;
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
  batch_index: number | null;
  is_partial: boolean | null;
  word_count: number | null;
  line_count: number | null;
  page_count_est: number | null;
  runtime_min_est: number | null;
  runtime_min_low: number | null;
  runtime_min_high: number | null;
  runtime_per_episode_est: number | null;
  notes: string | null;
  created_at: string;
}

export interface ImprovementRun {
  id: string;
  goal: string;
  intensity: string;
  before_scores: any;
  after_scores: any;
  score_deltas: any;
  regression_detected: boolean;
  rolled_back: boolean;
  changes_summary: string;
  scene_ops: any[];
  status: string;
  playbooks_used: any[];
  created_at: string;
  pre_rewrite_viability: number | null;
  post_rewrite_viability: number | null;
  viability_delta: number | null;
  inflation_flag: boolean;
  inflation_reason: string | null;
  pre_rewrite_breakdown: any;
  post_rewrite_breakdown: any;
}

export interface ImproveResult {
  draftNumber: number;
  storagePath: string;
  runId: string;
  beforeScores: Record<string, number>;
  afterScores: Record<string, number>;
  deltas: Record<string, number>;
  regression: boolean;
  changesSummary: string;
  sceneOps: any[];
  metrics: any;
}

export function useScriptEngine(projectId: string) {
  const qc = useQueryClient();
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftStoragePath, setDraftStoragePath] = useState<string | null>(null);
  const [lastImproveResult, setLastImproveResult] = useState<ImproveResult | null>(null);

  const keys = {
    scripts: ['engine-scripts', projectId],
    scenes: (sid: string) => ['engine-scenes', sid],
    versions: (sid: string) => ['engine-versions', sid],
    runs: (sid: string) => ['improvement-runs', sid],
  };

  const { data: scripts = [], isLoading } = useQuery({
    queryKey: keys.scripts,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scripts')
        .select('id, project_id, version, draft_number, status, structural_score, dialogue_score, economy_score, budget_score, lane_alignment_score, version_label, is_current, latest_batch_storage_path, latest_draft_number, latest_batch_index, latest_page_count_est, latest_runtime_min_est, latest_runtime_min_low, latest_runtime_min_high, created_at')
        .eq('project_id', projectId)
        .not('status', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EngineScript[];
    },
    enabled: !!projectId,
  });

  const activeScript = scripts.find(s => s.is_current) || scripts[0] || null;

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

  const { data: improvementRuns = [] } = useQuery({
    queryKey: keys.runs(activeScript?.id || ''),
    queryFn: async () => {
      if (!activeScript) return [];
      const { data, error } = await supabase
        .from('improvement_runs')
        .select('*')
        .eq('script_id', activeScript.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as ImprovementRun[];
    },
    enabled: !!activeScript?.id,
  });

  const blueprint = versions.find(v => v.blueprint_json)?.blueprint_json || null;

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
      qc.invalidateQueries({ queryKey: keys.runs(activeScript.id) });
    }
  }

  const generateBlueprint = useMutation({
    mutationFn: () => callEngine('blueprint'),
    onSuccess: () => { toast.success('Blueprint generated'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateArchitecture = useMutation({
    mutationFn: () => callEngine('architecture'),
    onSuccess: () => { toast.success('Scene architecture generated'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateDraft = useMutation({
    mutationFn: (params?: { batchStart?: number; batchEnd?: number }) =>
      callEngine('draft', params || {}),
    onSuccess: (data) => {
      if (data.batchTextPreview) {
        setDraftText(data.batchTextPreview);
        setDraftStoragePath(data.storagePath || null);
      }
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
    onSuccess: () => { toast.success('Quality scores updated'); invalidateAll(); },
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

  const improveDraft = useMutation({
    mutationFn: (params: { goal: string; intensity: string }) =>
      callEngine('improve', params),
    onSuccess: (data: ImproveResult) => {
      setLastImproveResult(data);
      if (data.regression) {
        toast.warning('Regression detected — scores dropped. Consider rolling back.');
      } else {
        toast.success(`Draft improved to #${data.draftNumber}`);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollbackImprovement = useMutation({
    mutationFn: (runId: string) => callEngine('rollback', { runId }),
    onSuccess: () => {
      toast.success('Rolled back to previous draft');
      setLastImproveResult(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lockScript = useMutation({
    mutationFn: () => callEngine('lock'),
    onSuccess: () => { toast.success('Script locked'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const fetchDraft = useMutation({
    mutationFn: (storagePath: string) => callEngine('fetch-draft', { storagePath }),
    onSuccess: (data) => {
      setDraftText(data.text);
      setDraftStoragePath(data.storagePath);
    },
    onError: (e: Error) => toast.error(`Failed to load draft: ${e.message}`),
  });

  const importToDocs = useMutation({
    mutationFn: () => callEngine('import-to-docs'),
    onSuccess: (data) => {
      toast.success(`Draft imported as "${data.fileName}" — now available for coverage`);
    },
    onError: (e: Error) => toast.error(`Import failed: ${e.message}`),
  });

  // Smart default goal based on lowest score
  function getSmartDefaultGoal(): string {
    if (!activeScript) return 'make_commercial';
    const scoreMap: [string, number | null][] = [
      ['tighten_pacing', activeScript.economy_score],
      ['sharper_dialogue', activeScript.dialogue_score],
      ['make_commercial', activeScript.lane_alignment_score],
      ['lower_budget', activeScript.budget_score],
      ['character_arcs', activeScript.structural_score],
    ];
    const scored = scoreMap.filter(([, s]) => s != null).sort((a, b) => (a[1] || 100) - (b[1] || 100));
    return scored[0]?.[0] || 'make_commercial';
  }

  // Smart default intensity based on scores
  function getSmartDefaultIntensity(): string {
    if (!activeScript) return 'balanced';
    const scores = [
      activeScript.structural_score,
      activeScript.dialogue_score,
      activeScript.economy_score,
      activeScript.budget_score,
      activeScript.lane_alignment_score,
    ].filter(s => s != null) as number[];
    if (scores.length === 0) return 'balanced';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 50) return 'bold';
    if (avg >= 75) return 'light';
    return 'balanced';
  }

  return {
    scripts, activeScript, scenes, versions, blueprint, isLoading,
    draftText, draftStoragePath, setDraftText,
    improvementRuns, lastImproveResult,
    generateBlueprint, generateArchitecture, generateDraft,
    scoreScript, rewritePass, lockScript, fetchDraft, importToDocs,
    improveDraft, rollbackImprovement,
    getSmartDefaultGoal, getSmartDefaultIntensity,
  };
}

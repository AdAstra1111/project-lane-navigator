/**
 * useSeriesWriterV2 — Manages continuity ledgers, compliance reports, retcon events,
 * episode packaging, and session state for the Series Writer v2 workspace.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCallback } from 'react';

// ── Types ──

export interface ContinuityLedger {
  id: string;
  project_id: string;
  episode_number: number;
  status: string;
  resolver_hash: string;
  summary: {
    timeline?: { day: number; time_of_day: string; location: string };
    character_states?: Record<string, { goal: string; emotion: string; injury?: string; secret_known?: string[] }>;
    relationship_deltas?: Array<{ a: string; b: string; change: string; why: string }>;
    secrets_revealed?: string[];
    props_locations_introduced?: string[];
    open_threads?: string[];
    cliffhanger?: { type: string; text: string };
  };
  created_at: string;
  updated_at: string;
}

export interface ComplianceReport {
  id: string;
  project_id: string;
  episode_number: number;
  scores: {
    tone_match: number;
    pacing_match: number;
    dialogue_voice: number;
    cliffhanger_strength: number;
    overall: number;
  };
  flags: string[];
  suggestions: string;
  override_reason?: string;
  created_at: string;
}

export interface RetconEvent {
  id: string;
  project_id: string;
  change_summary: string;
  changed_doc_type: string;
  changed_version_id: string;
  resolver_hash: string;
  impact_analysis: any;
  patch_suggestions: any;
  status: string;
  created_at: string;
}

// ── Helper ──
async function callEdge(fnName: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || `${fnName} failed`);
  return result;
}

export function useSeriesWriterV2(projectId: string) {
  const qc = useQueryClient();

  // ── Continuity Ledgers ──
  const { data: ledgers = [] } = useQuery({
    queryKey: ['sw-ledgers', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('episode_continuity_ledgers')
        .select('*')
        .eq('project_id', projectId)
        .order('episode_number', { ascending: true });
      if (error) throw error;
      return (data || []) as ContinuityLedger[];
    },
    enabled: !!projectId,
  });

  const generateLedger = useMutation({
    mutationFn: async (episodeNumber: number) => {
      return callEdge('generate-continuity-ledger', { projectId, episodeNumber });
    },
    onSuccess: (data, epNum) => {
      qc.invalidateQueries({ queryKey: ['sw-ledgers', projectId] });
      if (data.contradictions?.length > 0) {
        toast.warning(`${data.contradictions.length} continuity conflict(s) detected for EP ${epNum}`);
      } else {
        toast.success(`Continuity ledger generated for EP ${epNum}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Compliance Reports ──
  const { data: complianceReports = [] } = useQuery({
    queryKey: ['sw-compliance', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('episode_compliance_reports')
        .select('*')
        .eq('project_id', projectId)
        .order('episode_number', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ComplianceReport[];
    },
    enabled: !!projectId,
  });

  const runCompliance = useMutation({
    mutationFn: async (episodeNumber: number) => {
      return callEdge('episode-compliance', { projectId, episodeNumber });
    },
    onSuccess: (data, epNum) => {
      qc.invalidateQueries({ queryKey: ['sw-compliance', projectId] });
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      const overall = data.scores?.overall || 0;
      if (overall >= 65) {
        toast.success(`EP ${epNum} compliance: ${overall}% — Pass`);
      } else {
        toast.warning(`EP ${epNum} compliance: ${overall}% — Needs work`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Retcon Events ──
  const { data: retconEvents = [] } = useQuery({
    queryKey: ['sw-retcon', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('retcon_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as RetconEvent[];
    },
    enabled: !!projectId,
  });

  const createRetconEvent = useMutation({
    mutationFn: async (params: { changeSummary: string; changedDocType?: string; changedVersionId?: string; resolverHash?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('retcon_events').insert({
        project_id: projectId,
        change_summary: params.changeSummary,
        changed_doc_type: params.changedDocType || null,
        changed_version_id: params.changedVersionId || null,
        resolver_hash: params.resolverHash || '',
        status: 'pending',
        user_id: user.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sw-retcon', projectId] });
      toast.success('Retcon event created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const analyzeRetcon = useMutation({
    mutationFn: async (retconEventId: string) => {
      return callEdge('analyze-retcon-impact', { retconEventId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sw-retcon', projectId] });
      toast.success('Retcon impact analysis complete');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeRetconPatches = useMutation({
    mutationFn: async (params: { retconEventId: string; episodeNumbers: number[] }) => {
      return callEdge('propose-retcon-patches', params);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sw-retcon', projectId] });
      toast.success('Retcon patches proposed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Episode Packaging ──
  const exportEpisodePackage = useCallback(async (episodeNumber: number, scriptContent: string, ledger?: ContinuityLedger, compliance?: ComplianceReport) => {
    const epNum = String(episodeNumber).padStart(2, '0');
    const basePath = `${projectId}/package/episodes/EP${epNum}`;

    // Upload script
    const scriptBlob = new Blob([scriptContent], { type: 'text/markdown' });
    await supabase.storage.from('projects').upload(`${basePath}/SCRIPT_LATEST.md`, scriptBlob, { upsert: true });

    // Upload ledger
    if (ledger) {
      const ledgerBlob = new Blob([JSON.stringify(ledger.summary, null, 2)], { type: 'application/json' });
      await supabase.storage.from('projects').upload(`${basePath}/CONTINUITY_LEDGER.json`, ledgerBlob, { upsert: true });
    }

    // Upload compliance
    if (compliance) {
      const compBlob = new Blob([JSON.stringify({ scores: compliance.scores, flags: compliance.flags, suggestions: compliance.suggestions }, null, 2)], { type: 'application/json' });
      await supabase.storage.from('projects').upload(`${basePath}/COMPLIANCE_REPORT.json`, compBlob, { upsert: true });
    }

    toast.success(`EP${epNum} package exported`);
  }, [projectId]);

  const exportSeasonBinder = useCallback(async (
    episodes: Array<{ episode_number: number; title: string; logline: string; status: string }>,
    seasonEpisodeCount: number,
    episodeDuration: number,
    resolverHash: string,
  ) => {
    const lines = [
      `# Season Binder`,
      ``,
      `## Canonical Qualifications`,
      `- Episodes: ${seasonEpisodeCount}`,
      `- Duration: ${episodeDuration}s per episode`,
      `- Resolver Hash: ${resolverHash}`,
      ``,
      `## Episode Index`,
      ``,
      ...episodes.map(ep => {
        const num = String(ep.episode_number).padStart(2, '0');
        return `### EP${num} — ${ep.title} [${ep.status}]\n${ep.logline || '(no logline)'}\nPackage: episodes/EP${num}/\n`;
      }),
    ];

    const binderBlob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    await supabase.storage.from('projects').upload(`${projectId}/package/SEASON_BINDER.md`, binderBlob, { upsert: true });
    toast.success('Season binder exported');
  }, [projectId]);

  // ── Session Management ──
  const upsertSession = useCallback(async (activeEpisodeNumber: number, workingSet: Record<string, string>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('series_writer_sessions').upsert({
      project_id: projectId,
      user_id: user.id,
      resolver_hash: '',
      active_episode_number: activeEpisodeNumber,
      working_set: workingSet,
    }, { onConflict: 'project_id,user_id' });
  }, [projectId]);

  return {
    // Continuity
    ledgers,
    generateLedger,
    // Compliance
    complianceReports,
    runCompliance,
    // Retcon
    retconEvents,
    createRetconEvent,
    analyzeRetcon,
    proposeRetconPatches,
    // Packaging
    exportEpisodePackage,
    exportSeasonBinder,
    // Session
    upsertSession,
  };
}

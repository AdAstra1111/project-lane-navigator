/**
 * IFFY Signals Engine v1 — React Hooks
 *
 * Hooks for: observations, signal matches, project features, fact ledger, settings.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { ProjectSignalMatch, DocFactLedgerItem, SignalsApplyConfig } from '@/lib/signals-types';

// ── Project Signal Matches ──

export function useProjectSignalMatches(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-signal-matches', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_signal_matches')
        .select('*, cluster:cluster_id(name, category, strength, velocity, saturation_risk, cluster_scoring, genre_tags, tone_tags, format_tags, explanation, sources_used)')
        .eq('project_id', projectId)
        .order('impact_score', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectSignalMatch[];
    },
    enabled: !!projectId,
  });
}

// ── Refresh Signals for a Project ──

export function useRefreshProjectSignals(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('Missing project');

      const { data, error } = await supabase.functions.invoke('signals-engine', {
        body: { action: 'match-project', projectId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { matchCount: data.matchCount ?? 0, features: data.features ?? [] };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['project-signal-matches', projectId] });
      toast.success(`${result.matchCount} signals matched`);
    },
    onError: () => toast.error('Failed to refresh signals'),
  });
}

// ── Project Signals Settings ──

export function useProjectSignalsSettings(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['project-signals-settings', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('signals_influence, signals_apply')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return {
        influence: (data as any)?.signals_influence ?? 0.5,
        apply: (data as any)?.signals_apply ?? { pitch: true, dev: true, grid: true, doc: true },
      };
    },
    enabled: !!projectId,
  });

  const updateSettings = useMutation({
    mutationFn: async (update: { influence?: number; apply?: SignalsApplyConfig }) => {
      if (!projectId) throw new Error('No project');
      const patch: any = {};
      if (update.influence !== undefined) patch.signals_influence = update.influence;
      if (update.apply !== undefined) patch.signals_apply = update.apply;
      const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-signals-settings', projectId] });
    },
  });

  return {
    influence: query.data?.influence ?? 0.5,
    apply: query.data?.apply as SignalsApplyConfig ?? { pitch: true, dev: true, grid: true, doc: true },
    isLoading: query.isLoading,
    updateSettings,
  };
}

// ── Doc Fact Ledger ──

export function useDocFactLedger(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['doc-fact-ledger', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('doc_fact_ledger_items')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocFactLedgerItem[];
    },
    enabled: !!projectId,
  });

  const addItem = useMutation({
    mutationFn: async (input: { claim: string; evidence_type?: string; evidence_link?: string; status?: string }) => {
      if (!projectId || !user) throw new Error('Missing context');
      const { error } = await supabase.from('doc_fact_ledger_items').insert({
        project_id: projectId,
        user_id: user.id,
        claim: input.claim,
        evidence_type: input.evidence_type || 'unknown',
        evidence_link: input.evidence_link || null,
        status: input.status || 'needs_check',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doc-fact-ledger', projectId] });
      toast.success('Fact ledger item added');
    },
    onError: () => toast.error('Failed to add fact'),
  });

  const updateItem = useMutation({
    mutationFn: async (input: { id: string; status?: string; notes?: string; evidence_link?: string }) => {
      if (!projectId) throw new Error('No project');
      const patch: any = {};
      if (input.status) patch.status = input.status;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.evidence_link !== undefined) patch.evidence_link = input.evidence_link;
      const { error } = await supabase.from('doc_fact_ledger_items').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doc-fact-ledger', projectId] });
    },
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    addItem,
    updateItem,
  };
}

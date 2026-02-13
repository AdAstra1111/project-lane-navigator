import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DevEngineSession {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  input_text: string;
  input_type: string;
  format: string | null;
  genres: string[] | null;
  lane: string | null;
  budget: string | null;
  status: string;
  current_iteration: number;
  latest_ci: number | null;
  latest_gp: number | null;
  latest_gap: number | null;
  convergence_status: string | null;
  trajectory: string | null;
  created_at: string;
}

export interface DevEngineIteration {
  id: string;
  session_id: string;
  iteration_number: number;
  phase: string;
  ci_score: number | null;
  gp_score: number | null;
  gap: number | null;
  convergence_status: string | null;
  primary_creative_risk: string | null;
  primary_commercial_risk: string | null;
  protect_items: any[];
  strengthen_items: any[];
  clarify_items: any[];
  elevate_items: any[];
  remove_items: any[];
  structural_adjustments: any[];
  character_enhancements: any[];
  escalation_improvements: any[];
  lane_clarity_moves: any[];
  packaging_magnetism_moves: any[];
  risk_mitigation_fixes: any[];
  rewritten_text: string | null;
  changes_summary: string | null;
  creative_preserved: string | null;
  commercial_improvements: string | null;
  reassess_ci: number | null;
  reassess_gp: number | null;
  reassess_gap: number | null;
  reassess_convergence: string | null;
  delta_ci: number | null;
  delta_gp: number | null;
  delta_gap: number | null;
  trajectory: string | null;
  approved_notes: any[];
  created_at: string;
}

async function callEngine(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/development-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

export function useDevEngine(sessionId?: string) {
  const qc = useQueryClient();
  const [currentPhase, setCurrentPhase] = useState<string>('idle');

  const { data: sessions = [] } = useQuery({
    queryKey: ['dev-engine-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dev_engine_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as DevEngineSession[];
    },
  });

  const { data: iterations = [] } = useQuery({
    queryKey: ['dev-engine-iterations', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from('dev_engine_iterations')
        .select('*')
        .eq('session_id', sessionId)
        .order('iteration_number', { ascending: true });
      if (error) throw error;
      return data as DevEngineIteration[];
    },
    enabled: !!sessionId,
  });

  const { data: activeSession } = useQuery({
    queryKey: ['dev-engine-session', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      const { data, error } = await supabase
        .from('dev_engine_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      if (error) throw error;
      return data as DevEngineSession;
    },
    enabled: !!sessionId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['dev-engine-sessions'] });
    if (sessionId) {
      qc.invalidateQueries({ queryKey: ['dev-engine-iterations', sessionId] });
      qc.invalidateQueries({ queryKey: ['dev-engine-session', sessionId] });
    }
  }

  const createSession = useMutation({
    mutationFn: (params: { title: string; inputText: string; inputType?: string; format?: string; genres?: string[]; lane?: string; budget?: string; projectId?: string }) =>
      callEngine('create-session', params),
    onSuccess: () => { toast.success('Session created'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runReview = useMutation({
    mutationFn: (params?: { inputText?: string }) => {
      setCurrentPhase('review');
      return callEngine('review', { sessionId, ...params });
    },
    onSuccess: () => { toast.success('Review complete'); setCurrentPhase('review-done'); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setCurrentPhase('error'); },
  });

  const runNotes = useMutation({
    mutationFn: () => {
      setCurrentPhase('notes');
      return callEngine('notes', { sessionId });
    },
    onSuccess: () => { toast.success('Strategic notes generated'); setCurrentPhase('notes-done'); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setCurrentPhase('error'); },
  });

  const runRewrite = useMutation({
    mutationFn: (approvedNotes: any[]) => {
      setCurrentPhase('rewrite');
      return callEngine('rewrite', { sessionId, approvedNotes });
    },
    onSuccess: () => { toast.success('Rewrite complete'); setCurrentPhase('rewrite-done'); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setCurrentPhase('error'); },
  });

  const runReassess = useMutation({
    mutationFn: () => {
      setCurrentPhase('reassess');
      return callEngine('reassess', { sessionId });
    },
    onSuccess: () => { toast.success('Reassessment complete'); setCurrentPhase('reassess-done'); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setCurrentPhase('error'); },
  });

  const applyRewrite = useMutation({
    mutationFn: () => callEngine('apply-rewrite', { sessionId }),
    onSuccess: () => { toast.success('Rewrite applied as new input'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const latestIteration = iterations.length > 0 ? iterations[iterations.length - 1] : null;

  const isConverged = activeSession && 
    (activeSession.latest_ci ?? 0) > 75 && 
    (activeSession.latest_gp ?? 0) > 75;

  return {
    sessions, activeSession, iterations, latestIteration,
    currentPhase, setCurrentPhase, isConverged,
    createSession, runReview, runNotes, runRewrite, runReassess, applyRewrite,
  };
}

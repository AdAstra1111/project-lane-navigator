/**
 * useEpisodeDevValidation — Combined Canon Audit + Dev Notes hook.
 * Triggers both checks from a single action and exposes unified state.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import { useCanonAudit } from './useCanonAudit';

export interface DevNote {
  tier: 'blocking' | 'high_impact' | 'polish';
  category: string;
  title: string;
  detail: string;
  suggestion: string;
  canon_safe: boolean;
}

// ── Structured Episode Reviewer Sections ──────────────────────────────────────

export interface BeatCheck {
  beat: string;
  status: 'PRESENT' | 'PARTIAL' | 'MISSING';
  evidence: string;
  fix: string;
}

export interface SetupCheck {
  setup: string;
  status: 'PRESENT' | 'PARTIAL' | 'MISSING' | 'NOT_REQUIRED';
  evidence: string;
  fix: string;
}

export interface SectionA {
  required_beats: string[];
  must_plant_setups: string[];
  end_state_promise: string;
}

export interface SectionB {
  beat_checks: BeatCheck[];
  setup_checks: SetupCheck[];
}

export interface SectionC {
  cold_open_hook: string;
  act_turns: string;
  climax_button: string;
  character_turns: string;
  pacing: string;
}

export interface SectionD {
  canon_conflicts: (string | { issue: string; evidence: string; fix: string })[];
  season_alignment: 'on track' | 'off track';
  alignment_bullets: string[];
  later_pivot_notes: string[];
}

export interface EpisodePatch {
  name: string;
  where: string;
  what: string;
  why: string;
}

export interface SectionE {
  patches: EpisodePatch[];
}

export interface DevNotesRun {
  id: string;
  project_id: string;
  episode_number: number;
  script_id: string | null;
  status: 'running' | 'completed' | 'failed';
  summary: string | null;
  results_json: {
    episode_number?: number;
    overall_grade?: string;
    summary?: string;
    strengths?: string[];
    notes?: DevNote[];
    canon_risk_notes?: DevNote[];
    canon_risk_count?: number;
    overall_recommendations?: string;
    // Structured sections (new episode reviewer)
    section_a?: SectionA;
    section_b?: SectionB;
    section_c?: SectionC;
    section_d?: SectionD;
    section_e?: SectionE;
  };
  created_at: string;
  finished_at: string | null;
}

export function useEpisodeDevValidation(projectId: string, episodeNumber: number | null) {
  const qc = useQueryClient();
  const canonAudit = useCanonAudit(projectId, episodeNumber);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const devNotesKey = ['dev-notes-run', projectId, episodeNumber];

  // ── Latest dev notes run ──
  const { data: devNotesRun, isLoading: devNotesLoading } = useQuery({
    queryKey: devNotesKey,
    queryFn: async () => {
      if (!episodeNumber) return null;
      const { data } = await (supabase as any)
        .from('series_dev_notes_runs')
        .select('*')
        .eq('project_id', projectId)
        .eq('episode_number', episodeNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as DevNotesRun) || null;
    },
    enabled: !!projectId && !!episodeNumber,
  });

  // ── Poll while running ──
  const devStatus = devNotesRun?.status as string | undefined;
  useEffect(() => {
    if (devStatus === 'running') {
      pollRef.current = setInterval(() => {
        qc.invalidateQueries({ queryKey: devNotesKey });
      }, 5000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [devStatus]);

  // ── Start dev notes ──
  const startDevNotes = useMutation({
    mutationFn: async (params: { episodeScriptId?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('series-dev-notes', {
        body: {
          projectId,
          episodeNumber,
          episodeScriptId: params.episodeScriptId || null,
        },
      });
      if (resp.error) throw new Error(resp.error.message || 'Dev notes failed');
      return resp.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devNotesKey });
      toast.success('Episode review complete');
    },
    onError: (e: Error) => toast.error(`Episode review failed: ${e.message}`),
  });

  // ── Combined "run all checks" ──
  const runAllChecks = useMutation({
    mutationFn: async (params: { episodeScriptId?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const episodeVersionId = params.episodeScriptId || null;
      const [auditResp, notesResp] = await Promise.allSettled([
        supabase.functions.invoke('series-continuity-audit', {
          body: { projectId, episodeNumber, episodeVersionId },
        }),
        supabase.functions.invoke('series-dev-notes', {
          body: { projectId, episodeNumber, episodeScriptId: episodeVersionId },
        }),
      ]);

      const errors: string[] = [];
      if (auditResp.status === 'rejected') errors.push(`Canon: ${auditResp.reason}`);
      else if (auditResp.value.error) errors.push(`Canon: ${auditResp.value.error.message}`);
      if (notesResp.status === 'rejected') errors.push(`Review: ${notesResp.reason}`);
      else if (notesResp.value.error) errors.push(`Review: ${notesResp.value.error.message}`);

      if (errors.length === 2) throw new Error(errors.join('; '));
      if (errors.length === 1) toast.warning(errors[0]);

      return { auditResp, notesResp };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canon-audit-run', projectId, episodeNumber] });
      qc.invalidateQueries({ queryKey: ['canon-audit-issues', projectId, episodeNumber] });
      qc.invalidateQueries({ queryKey: devNotesKey });
      toast.success('Dev Engine checks complete');
    },
    onError: (e: Error) => toast.error(`Dev Engine failed: ${e.message}`),
  });

  // ── Derived state ──
  const devNotes = (devNotesRun?.results_json?.notes || []) as DevNote[];
  const blockingNotes = devNotes.filter(n => n.tier === 'blocking');
  const highImpactNotes = devNotes.filter(n => n.tier === 'high_impact');
  const polishNotes = devNotes.filter(n => n.tier === 'polish');
  const isDevNotesRunning = devNotesRun?.status === 'running' || startDevNotes.isPending;
  const isAnyRunning = canonAudit.isRunning || isDevNotesRunning || runAllChecks.isPending;

  return {
    // Canon audit (pass-through)
    canonAudit,
    // Dev notes / episode review
    devNotesRun,
    devNotes,
    blockingNotes,
    highImpactNotes,
    polishNotes,
    isDevNotesRunning,
    devNotesLoading,
    // Combined
    runAllChecks,
    isAnyRunning,
    startDevNotes,
  };
}

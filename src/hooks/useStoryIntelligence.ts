import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface TopBlocker {
  summary: string;
  severity: string;
  load_class: string;
  resolution_state: string;
  next_action: string | null;
}

export interface FragilityEntry {
  area: string;
  area_type: string;
  issue_count: number;
  max_severity: string;
  description: string;
}

export interface EvidenceSummary {
  total_diagnostics: number;
  severity_counts: Record<string, number>;
  resolution_state_counts: Record<string, number>;
  repair_queue_summary: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };
  core_issue_count: number;
  failed_repair_count: number;
  proposal_required_count: number;
  blocked_issue_count: number;
  manual_only_count: number;
}

export interface StoryIntelligenceData {
  computed_at: string;
  narrative_health_score: number;
  narrative_health_band: 'stable' | 'watch' | 'at_risk' | 'critical';
  story_risk_score: number;
  story_risk_band: 'low' | 'moderate' | 'elevated' | 'severe';
  repair_readiness: string;
  blocker_count: number;
  top_blockers: TopBlocker[];
  structural_fragility: FragilityEntry[];
  recommended_next_moves: string[];
  evidence_summary: EvidenceSummary;
  scoring_note: string;
}

export function useStoryIntelligence(projectId: string | undefined) {
  const [data, setData] = useState<StoryIntelligenceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ action: 'get_story_intelligence', projectId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Story intelligence request failed');
      setData({
        computed_at: json.computed_at,
        narrative_health_score: json.narrative_health_score,
        narrative_health_band: json.narrative_health_band,
        story_risk_score: json.story_risk_score,
        story_risk_band: json.story_risk_band,
        repair_readiness: json.repair_readiness,
        blocker_count: json.blocker_count,
        top_blockers: json.top_blockers ?? [],
        structural_fragility: json.structural_fragility ?? [],
        recommended_next_moves: json.recommended_next_moves ?? [],
        evidence_summary: json.evidence_summary ?? {},
        scoring_note: json.scoring_note ?? '',
      });
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!hasLoaded && projectId && !isLoading && !data && !error) {
      setHasLoaded(true);
      refresh();
    }
  }, [hasLoaded, projectId, isLoading, data, error, refresh]);

  return { data, isLoading, error, refresh };
}

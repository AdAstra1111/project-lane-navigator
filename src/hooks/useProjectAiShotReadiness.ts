/**
 * useProjectAiShotReadiness — Project-level AI shot readiness data + computed scores.
 * Fetches scene_shots + ai_generated_media and derives tier distribution, coverage, and heatmap data.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AiShotRow {
  id: string;
  project_id: string;
  shot_title: string | null;
  shot_type: string | null;
  framing: string | null;
  camera_movement: string | null;
  blocking_notes: string | null;
  location_hint: string | null;
  time_of_day_hint: string | null;
  emotional_intent: string | null;
  characters_in_frame: string[] | null;
  ai_candidate: boolean | null;
  ai_readiness_tier: string | null;
  ai_confidence: number | null;
  ai_last_labeled_at: string | null;
}

export interface MediaCountMap {
  [shotId: string]: { frames: number; motionStills: number; selectedFrames: number };
}

export interface TierDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  unlabeled: number;
}

export interface ProjectAiScores {
  totalShots: number;
  labeledShots: number;
  labelCoverage: number;
  aiCandidateCount: number;
  aiCandidateRate: number;
  avgConfidence: number;
  tierDistribution: TierDistribution;
  generationCoverage: number; // % of labeled shots with at least one frame
  motionStillCoverage: number; // % of A/B shots with motion stills
  readinessScore: number; // weighted 0–100 project-level readiness
}

export function useProjectAiShotReadiness(projectId: string | undefined) {
  const shotsQuery = useQuery({
    queryKey: ['ai-readiness-shots', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('scene_shots')
        .select(`
          id,
          project_id,
          shot_title,
          shot_type,
          framing,
          camera_movement,
          blocking_notes,
          location_hint,
          time_of_day_hint,
          emotional_intent,
          characters_in_frame,
          ai_candidate,
          ai_readiness_tier,
          ai_confidence,
          ai_last_labeled_at
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as AiShotRow[];
    },
    enabled: !!projectId,
  });

  const mediaQuery = useQuery({
    queryKey: ['ai-readiness-media', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ai_generated_media')
        .select('id, shot_id, media_type, selected')
        .eq('project_id', projectId)
        .not('shot_id', 'is', null);
      if (error) throw error;
      return (data || []) as { id: string; shot_id: string; media_type: string; selected: boolean }[];
    },
    enabled: !!projectId,
  });

  const shots = shotsQuery.data || [];
  const mediaRows = mediaQuery.data || [];

  // Build per-shot media counts
  const mediaByShotId: MediaCountMap = {};
  for (const m of mediaRows) {
    if (!m.shot_id) continue;
    if (!mediaByShotId[m.shot_id]) mediaByShotId[m.shot_id] = { frames: 0, motionStills: 0, selectedFrames: 0 };
    if (m.media_type === 'storyboard_frame') {
      mediaByShotId[m.shot_id].frames++;
      if (m.selected) mediaByShotId[m.shot_id].selectedFrames++;
    }
    if (m.media_type === 'motion_still') mediaByShotId[m.shot_id].motionStills++;
  }

  // Compute tier distribution
  const tierDistribution: TierDistribution = { A: 0, B: 0, C: 0, D: 0, unlabeled: 0 };
  let totalConfidence = 0;
  let labeledCount = 0;

  for (const s of shots) {
    const t = s.ai_readiness_tier;
    if (t === 'A' || t === 'B' || t === 'C' || t === 'D') {
      tierDistribution[t]++;
      labeledCount++;
      totalConfidence += s.ai_confidence ?? 0;
    } else {
      tierDistribution.unlabeled++;
    }
  }

  const totalShots = shots.length;
  const labelCoverage = totalShots > 0 ? Math.round((labeledCount / totalShots) * 100) : 0;
  const aiCandidateCount = shots.filter(s => s.ai_candidate).length;
  const aiCandidateRate = totalShots > 0 ? Math.round((aiCandidateCount / totalShots) * 100) : 0;
  const avgConfidence = labeledCount > 0 ? Math.round(totalConfidence / labeledCount) : 0;

  // Generation coverage: % of labeled shots with ≥1 frame
  const labeledShotIds = shots.filter(s => s.ai_readiness_tier).map(s => s.id);
  const shotsWithFrames = labeledShotIds.filter(id => (mediaByShotId[id]?.frames ?? 0) > 0).length;
  const generationCoverage = labeledCount > 0 ? Math.round((shotsWithFrames / labeledCount) * 100) : 0;

  // Motion still coverage: % of A/B shots with motion stills
  const abShotIds = shots.filter(s => s.ai_readiness_tier === 'A' || s.ai_readiness_tier === 'B').map(s => s.id);
  const abWithMotion = abShotIds.filter(id => (mediaByShotId[id]?.motionStills ?? 0) > 0).length;
  const motionStillCoverage = abShotIds.length > 0 ? Math.round((abWithMotion / abShotIds.length) * 100) : 0;

  // Readiness score: weighted composite 0–100
  // 30% label coverage + 25% candidate rate + 25% avg confidence + 10% gen coverage + 10% motion coverage
  const readinessScore = Math.round(
    labelCoverage * 0.30 +
    aiCandidateRate * 0.25 +
    avgConfidence * 0.25 +
    generationCoverage * 0.10 +
    motionStillCoverage * 0.10
  );

  const scores: ProjectAiScores = {
    totalShots,
    labeledShots: labeledCount,
    labelCoverage,
    aiCandidateCount,
    aiCandidateRate,
    avgConfidence,
    tierDistribution,
    generationCoverage,
    motionStillCoverage,
    readinessScore,
  };

  return {
    shots,
    mediaByShotId,
    scores,
    isLoading: shotsQuery.isLoading || mediaQuery.isLoading,
    isError: shotsQuery.isError || mediaQuery.isError,
    refetch: () => { shotsQuery.refetch(); mediaQuery.refetch(); },
  };
}

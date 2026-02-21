/**
 * useEpisodeEngagement — Calls the analyze-episode-engagement edge function
 * and returns structured metrics for UI consumption.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BeatDensityMetrics {
  detected_beats: number;
  turns_per_min: number;
  estimated_runtime_seconds: number;
  longest_gap_seconds: number;
  distribution: 'even' | 'front_loaded' | 'back_loaded' | 'uneven';
  flags: string[];
}

export interface TensionPoint { t: number; value: number; }

export interface TensionCurveMetrics {
  points: TensionPoint[];
  peaks: number[];
  troughs: number[];
  end_hook_strength: number;
  hook_time_seconds: number;
  shape: string;
}

export interface RetentionScoreMetrics {
  total: number;
  components: {
    hook_strength: number;
    pattern_interrupt_frequency: number;
    stakes_clarity: number;
    payoff_cadence: number;
    cliffhanger_strength: number;
    confusion_risk: number;
  };
  key_risks: string[];
}

export interface EngagementScoreMetrics {
  total: number;
  components: {
    comment_bait: number;
    shareability: number;
    rewatch_magnet: number;
    character_attachment: number;
  };
}

export interface EngagementRecommendation {
  title: string;
  why: string;
  severity: 'low' | 'med' | 'high';
  target_section: string;
  suggested_fix: string;
}

export interface EpisodeEngagementResult {
  beat_density: BeatDensityMetrics;
  tension_curve: TensionCurveMetrics;
  retention_score: RetentionScoreMetrics;
  engagement_score: EngagementScoreMetrics;
  recommendations: EngagementRecommendation[];
  targets: {
    beatCountRange: string;
    beatSpacing: string;
    hookWindow: [number, number];
  };
  episodeLengthRange: string;
}

export function useEpisodeEngagement() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<EpisodeEngagementResult | null>(null);

  const analyze = useCallback(async (params: {
    projectId: string;
    episodeNumber?: number;
    docVersionId?: string;
    content?: string;
    mode?: 'beats' | 'script';
    episodeLengthMin?: number;
    episodeLengthMax?: number;
  }) => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'analyze-episode-engagement',
        { body: params },
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const engagement: EpisodeEngagementResult = {
        beat_density: data.metrics.beat_density,
        tension_curve: data.metrics.tension_curve,
        retention_score: data.metrics.retention_score,
        engagement_score: data.metrics.engagement_score,
        recommendations: data.metrics.recommendations || [],
        targets: data.targets,
        episodeLengthRange: data.episodeLengthRange,
      };

      setResult(engagement);
      return engagement;
    } catch (err: any) {
      console.error('Engagement analysis error:', err);
      toast.error(`Engagement analysis failed: ${err.message}`);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const clear = useCallback(() => setResult(null), []);

  return { analyze, isAnalyzing, result, clear };
}

/**
 * Validation Scoring Service — Phase 3
 * 
 * Single source of truth for scoring validation packs.
 * Computes: intra-slot stability, cross-slot persistence, regeneration stability,
 * pack coverage score, hard fail detection (HF-08, HF-COV).
 * 
 * Scoring is triggered client-side after pack_generated, calling the
 * score-actor-validation edge function.
 */
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ValidationRun, ValidationResult } from './actorValidation';

// ── Score Band Definitions ──────────────────────────────────────────────────

export type ScoreBand = 'weak' | 'promising' | 'stable' | 'elite';

export function getScoreBand(score: number): ScoreBand {
  if (score >= 90) return 'elite';
  if (score >= 75) return 'stable';
  if (score >= 60) return 'promising';
  return 'weak';
}

export function getScoreBandColor(band: ScoreBand | string | null): string {
  switch (band) {
    case 'elite': return 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10';
    case 'stable': return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
    case 'promising': return 'text-amber-400 border-amber-400/30 bg-amber-400/10';
    case 'weak': return 'text-red-400 border-red-400/30 bg-red-400/10';
    default: return 'text-muted-foreground border-border bg-muted/10';
  }
}

export function getConfidenceColor(confidence: string | null): string {
  switch (confidence) {
    case 'high': return 'text-emerald-400';
    case 'medium': return 'text-amber-400';
    case 'low': return 'text-red-400';
    default: return 'text-muted-foreground';
  }
}

// ── Trigger Scoring ─────────────────────────────────────────────────────────

export async function triggerValidationScoring(runId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('score-actor-validation', {
    body: { runId },
  });

  if (error) {
    throw new Error(error.message || 'Scoring failed');
  }
  if (data?.error) {
    throw new Error(data.error);
  }
}

// ── React Query Hooks ───────────────────────────────────────────────────────

export function useTriggerScoring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => triggerValidationScoring(runId),
    onSuccess: (_, runId) => {
      toast.success('Scoring complete');
      // Invalidate all related queries
      qc.invalidateQueries({ queryKey: ['actor-validation-run'] });
      qc.invalidateQueries({ queryKey: ['actor-validation-result'] });
    },
    onError: (e: Error) => toast.error(`Scoring failed: ${e.message}`),
  });
}

/**
 * Actor Validation Service — Client-side orchestration for validation runs.
 * 
 * Responsibilities:
 * - Create validation runs
 * - Trigger quick pack generation via edge function
 * - Query validation state
 * - Provide hooks for UI consumption
 */
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────────

export type ValidationRunStatus = 'pending' | 'generating' | 'scoring' | 'pack_generated' | 'scored' | 'complete' | 'failed';
export type ValidationPhase = 'quick' | 'full';

export interface ValidationRun {
  id: string;
  actor_id: string;
  actor_version_id: string | null;
  status: ValidationRunStatus;
  validation_phase: ValidationPhase;
  pack_coverage: {
    total_slots?: number;
    covered_slots?: number;
    total_images?: number;
    completed_images?: number;
    failed_images?: number;
    coverage_percent?: number;
  };
  error: string | null;
  created_at: string;
  completed_at: string | null;
  triggered_by: string | null;
}

export interface ValidationImage {
  id: string;
  validation_run_id: string;
  slot_key: string;
  variant_index: number;
  public_url: string | null;
  storage_path: string | null;
  generation_config: Record<string, any>;
  status: string;
  error: string | null;
  created_at: string;
}

export interface ValidationResult {
  id: string;
  validation_run_id: string;
  overall_score: number | null;
  score_band: string | null;
  confidence: string;
  axis_scores: Record<string, any>;
  hard_fail_codes: string[];
  advisory_penalty_codes: string[];
  promotable: boolean;
  failure_reasons: string[];
  scoring_model: string | null;
  created_at: string;
}

// ── Canonical Slot Definitions ──────────────────────────────────────────────

export const VALIDATION_SLOTS = [
  { key: 'neutral_headshot', label: 'Neutral Headshot', purpose: 'Baseline facial identity' },
  { key: 'true_profile', label: 'True Profile', purpose: 'Profile structure agreement' },
  { key: 'three_quarter_portrait', label: '¾ Portrait', purpose: 'Angle consistency' },
  { key: 'standing_full_body', label: 'Standing Full Body', purpose: 'Body proportion consistency' },
  { key: 'seated_medium', label: 'Seated Medium', purpose: 'Pose variation robustness' },
  { key: 'emotional_closeup', label: 'Emotional Close-up', purpose: 'Expression robustness' },
  { key: 'daylight_variant', label: 'Daylight', purpose: 'Lighting robustness (bright)' },
  { key: 'lowkey_variant', label: 'Low-Key', purpose: 'Lighting robustness (dark)' },
  { key: 'wardrobe_variation', label: 'Wardrobe Change', purpose: 'Wardrobe robustness' },
  { key: 'partner_scene', label: 'Partner Scene', purpose: 'Multi-person identity persistence' },
  { key: 'narrative_context', label: 'Narrative Context', purpose: 'Scene transfer stability' },
] as const;

// ── Service Functions ───────────────────────────────────────────────────────

/** Create a validation run and trigger quick pack generation. Enforces PG gates. */
export async function startValidationRun(actorId: string, actorVersionId?: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // ── PG Gate Enforcement ─────────────────────────────────────────────────
  // Check persisted anchor gate statuses before allowing run creation
  const { data: actorRow } = await (supabase as any)
    .from('ai_actors')
    .select('anchor_coverage_status, anchor_coherence_status')
    .eq('id', actorId)
    .single();

  const coverageStatus = actorRow?.anchor_coverage_status || 'insufficient';
  const coherenceStatus = actorRow?.anchor_coherence_status || 'unknown';

  if (coverageStatus === 'insufficient') {
    throw new Error('PG-00: Insufficient anchor coverage. Upload headshot, profile, and full-body references before running validation.');
  }
  if (coherenceStatus === 'incoherent') {
    throw new Error('PG-01: Anchor set is incoherent — identity references contradict each other. Fix anchors before validation.');
  }

  // Check for existing active run
  const { data: existing } = await (supabase as any)
    .from('actor_validation_runs')
    .select('id, status')
    .eq('actor_id', actorId)
    .in('status', ['pending', 'generating', 'scoring', 'pack_generated'])
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error(`A validation run is already ${existing[0].status}. Please wait for it to complete.`);
  }

  // Resolve latest version if not provided
  if (!actorVersionId) {
    const { data: versions } = await (supabase as any)
      .from('ai_actor_versions')
      .select('id')
      .eq('actor_id', actorId)
      .order('version_number', { ascending: false })
      .limit(1);
    actorVersionId = versions?.[0]?.id || null;
  }

  // Create run
  const { data: run, error: runErr } = await (supabase as any)
    .from('actor_validation_runs')
    .insert({
      actor_id: actorId,
      actor_version_id: actorVersionId || null,
      status: 'pending',
      validation_phase: 'quick',
      triggered_by: user.id,
    })
    .select('id')
    .single();

  if (runErr || !run) throw new Error(runErr?.message || 'Failed to create validation run');

  // Trigger edge function (fire-and-forget — function updates status)
  supabase.functions.invoke('run-actor-validation', {
    body: { runId: run.id },
  }).catch((e: any) => {
    console.error('[ActorValidation] Edge function invoke error:', e);
  });

  return run.id;
}

/** Fetch the latest validation run for an actor. */
export async function getLatestValidationRun(actorId: string): Promise<ValidationRun | null> {
  const { data } = await (supabase as any)
    .from('actor_validation_runs')
    .select('*')
    .eq('actor_id', actorId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

/** Fetch validation images for a run. */
export async function getValidationImages(runId: string): Promise<ValidationImage[]> {
  const { data } = await (supabase as any)
    .from('actor_validation_images')
    .select('*')
    .eq('validation_run_id', runId)
    .order('slot_key', { ascending: true })
    .order('variant_index', { ascending: true });
  return data || [];
}

/** Fetch validation result for a run. */
export async function getValidationResult(runId: string): Promise<ValidationResult | null> {
  const { data } = await (supabase as any)
    .from('actor_validation_results')
    .select('*')
    .eq('validation_run_id', runId)
    .single();
  return data || null;
}

// ── React Query Hooks ───────────────────────────────────────────────────────

export function useLatestValidationRun(actorId: string | undefined) {
  return useQuery({
    queryKey: ['actor-validation-run', actorId],
    queryFn: () => getLatestValidationRun(actorId!),
    enabled: !!actorId,
    refetchInterval: (query) => {
      const run = query.state.data as ValidationRun | null;
      // Poll while run is active (including scoring and pack_generated for auto-trigger)
      if (run && ['pending', 'generating', 'scoring', 'pack_generated'].includes(run.status)) return 5000;
      return false;
    },
  });
}

export function useValidationImages(runId: string | undefined) {
  return useQuery({
    queryKey: ['actor-validation-images', runId],
    queryFn: () => getValidationImages(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const images = query.state.data as ValidationImage[] | undefined;
      if (images && images.some(i => i.status === 'pending' || i.status === 'generating')) return 5000;
      return false;
    },
  });
}

export function useValidationResult(runId: string | undefined) {
  return useQuery({
    queryKey: ['actor-validation-result', runId],
    queryFn: () => getValidationResult(runId!),
    enabled: !!runId,
  });
}

export function useStartValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ actorId, actorVersionId }: { actorId: string; actorVersionId?: string }) =>
      startValidationRun(actorId, actorVersionId),
    onSuccess: (runId, { actorId }) => {
      toast.success('Validation run started — generating 22 test images…');
      qc.invalidateQueries({ queryKey: ['actor-validation-run', actorId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

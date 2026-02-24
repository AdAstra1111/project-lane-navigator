/**
 * Trailer Cinematic Engine — API wrappers for v2 cinematic intelligence layer
 */
import { supabase } from '@/integrations/supabase/client';

async function callCinematicEngine(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trailer-cinematic-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Cinematic engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted.';
    throw new Error(msg);
  }
  return resp.json();
}

export interface TrailerStyleOptions {
  tonePreset?: string;
  pacingProfile?: string;
  revealStrategy?: string;
  movementOverall?: number;
  cameraStyle?: string;
  lensBias?: string;
  microMontageIntensity?: string;
  dropStyle?: string;
  minSilenceWindows?: number;
  sfxEmphasis?: string;
  strictCanonMode?: 'strict' | 'balanced';
  targetLengthMs?: number;
  referenceNotes?: string;
  avoidNotes?: string;
  inspirationRefs?: { title: string; url?: string; notes?: string }[];
}

export const cinematicApi = {
  /** Create a cinematic trailer script (step 1) */
  createTrailerScript: (params: {
    projectId: string;
    canonPackId: string;
    trailerType?: string;
    genreKey?: string;
    platformKey?: string;
    seed?: string;
    idempotencyKey?: string;
    styleOptions?: TrailerStyleOptions;
    inspirationRefs?: { title: string; url?: string; notes?: string }[];
    referenceNotes?: string;
    avoidNotes?: string;
    strictCanonMode?: 'strict' | 'balanced';
    targetLengthMs?: number;
    stylePresetKey?: string;
  }) => callCinematicEngine('create_trailer_script_v2', params),

  /** Create rhythm grid from script (step 2) */
  createRhythmGrid: (params: {
    projectId: string;
    scriptRunId: string;
    seed?: string;
  }) => callCinematicEngine('create_rhythm_grid_v2', params),

  /** Create shot design from script + rhythm (step 3) */
  createShotDesign: (params: {
    projectId: string;
    scriptRunId: string;
    rhythmRunId?: string;
    seed?: string;
  }) => callCinematicEngine('create_shot_design_v2', params),

  /** Run cinematic judge (step 4) */
  runJudge: (params: {
    projectId: string;
    scriptRunId: string;
    rhythmRunId?: string;
    shotDesignRunId?: string;
  }) => callCinematicEngine('run_cinematic_judge_v2', params),

  /** Repair trailer script based on judge feedback (step 5) */
  repairScript: (params: {
    projectId: string;
    scriptRunId: string;
    judgeRunId?: string;
    canonPackId?: string;
  }) => callCinematicEngine('repair_trailer_script_v2', params),

  /** Gate-checked clip generation start (step 6) */
  startClipGeneration: (params: {
    projectId: string;
    scriptRunId: string;
    shotDesignRunId: string;
  }) => callCinematicEngine('start_clip_generation_from_shot_specs', params),

  /** Full orchestrated plan: steps 1-4 in one call */
  createFullPlan: (params: {
    projectId: string;
    canonPackId: string;
    trailerType?: string;
    genreKey?: string;
    platformKey?: string;
    seed?: string;
    idempotencyKey?: string;
    styleOptions?: TrailerStyleOptions;
    inspirationRefs?: { title: string; url?: string; notes?: string }[];
    referenceNotes?: string;
    avoidNotes?: string;
    strictCanonMode?: 'strict' | 'balanced';
    targetLengthMs?: number;
    stylePresetKey?: string;
  }) => callCinematicEngine('create_full_cinematic_trailer_plan', params),

  /** Export trailer script as a project document */
  exportTrailerScriptDocument: (params: {
    projectId: string;
    scriptRunId: string;
    forceNewVersion?: boolean;
  }) => callCinematicEngine('export_trailer_script_document_v1', params),
};

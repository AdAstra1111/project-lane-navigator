/**
 * Trailer Pipeline v2 — API wrappers
 */
import { supabase } from '@/integrations/supabase/client';

async function callFn(fnName: string, action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = `${fnName} error`;
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted.';
    throw new Error(msg);
  }
  return resp.json();
}

// ─── Blueprint Engine ───
export const blueprintApi = {
  getArcTemplates: () => callFn('trailer-blueprint-engine', 'get_arc_templates', {}),
  createBlueprint: (projectId: string, storyboardRunId?: string, arcType?: string, options?: any) =>
    callFn('trailer-blueprint-engine', 'create_blueprint', { projectId, storyboardRunId, arcType, options }),
  listBlueprints: (projectId: string) =>
    callFn('trailer-blueprint-engine', 'list_blueprints', { projectId }),
  getBlueprint: (projectId: string, blueprintId: string) =>
    callFn('trailer-blueprint-engine', 'get_blueprint', { projectId, blueprintId }),
};

// ─── Clip Generator ───
export const clipApi = {
  generateClips: (projectId: string, blueprintId: string, provider?: string, beatIndices?: number[], candidateCount?: number) =>
    callFn('trailer-clip-generator', 'enqueue_for_run', { projectId, blueprintId, provider, beatIndices, candidateCount }),
  listClips: (projectId: string, blueprintId: string) =>
    callFn('trailer-clip-generator', 'list_clips', { projectId, blueprintId }),
  rateClip: (projectId: string, clipId: string, rating: number) =>
    callFn('trailer-clip-generator', 'select_clip', { projectId, clipId, rating }),
  selectClip: (projectId: string, clipId: string, blueprintId: string, beatIndex: number) =>
    callFn('trailer-clip-generator', 'select_clip', { projectId, clipId, blueprintId, beatIndex }),
};

// ─── Assembler ───
export const assemblerApi = {
  createCut: (projectId: string, blueprintId: string, options?: any) =>
    callFn('trailer-assembler', 'create_cut', { projectId, blueprintId, options }),
  updateBeat: (projectId: string, cutId: string, beatIndex: number, updates: {
    duration_ms?: number; trim_in_ms?: number; trim_out_ms?: number; clip_id?: string | null;
  }) => callFn('trailer-assembler', 'update_beat', { projectId, cutId, beatIndex, ...updates }),
  reorderBeats: (projectId: string, cutId: string, orderedBeatIndices: number[]) =>
    callFn('trailer-assembler', 'reorder_beats', { projectId, cutId, orderedBeatIndices }),
  renderManifest: (projectId: string, cutId: string) =>
    callFn('trailer-assembler', 'render_manifest', { projectId, cutId }),
  finalizeRun: (projectId: string, cutId: string, outputPath?: string, publicUrl?: string) =>
    callFn('trailer-assembler', 'finalize_run', { projectId, cutId, outputPath, publicUrl }),
  exportBeatlist: (projectId: string, cutId: string) =>
    callFn('trailer-assembler', 'export_beatlist', { projectId, cutId }),
  listCuts: (projectId: string, blueprintId?: string) =>
    callFn('trailer-assembler', 'list_cuts', { projectId, blueprintId }),
  getCut: (projectId: string, cutId: string) =>
    callFn('trailer-assembler', 'get_cut', { projectId, cutId }),
  setCutStatus: (projectId: string, cutId: string, status: string, extra?: any) =>
    callFn('trailer-assembler', 'set_cut_status', { projectId, cutId, status, ...extra }),
  getTimeline: (projectId: string, blueprintId: string) =>
    callFn('trailer-assembler', 'get_timeline', { projectId, blueprintId }),
  fixTrims: (projectId: string, cutId: string) =>
    callFn('trailer-assembler', 'fix_trims', { projectId, cutId }),
  validateTrims: (projectId: string, cutId: string) =>
    callFn('trailer-assembler', 'validate_trims', { projectId, cutId }),
};

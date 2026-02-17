/**
 * Client helper to call the decisions-engine edge function.
 */
import { supabase } from '@/integrations/supabase/client';

async function callDecisionsEngine(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const resp = await supabase.functions.invoke('decisions-engine', {
    body: { action, ...payload },
  });

  if (resp.error) throw new Error(resp.error.message || 'Decisions engine error');
  return resp.data;
}

/**
 * Record resolved notes + decisions after a rewrite or decision apply.
 */
export async function recordResolutions(params: {
  projectId: string;
  source: 'dev_engine_rewrite' | 'dev_engine_decision' | 'canon_fix';
  sourceRunId?: string;
  notes?: any[];
  selectedOptions?: Array<{ note_id: string; option_id: string; custom_direction?: string }>;
  globalDirections?: any[];
  currentDocTypeKey?: string;
}) {
  return callDecisionsEngine('record-resolutions', params);
}

/**
 * Record a canon fix resolution.
 */
export async function recordCanonFix(params: {
  projectId: string;
  runId?: string;
  issueId: string;
  episodeNumber?: number;
  selectedFixOption?: string;
}) {
  return callDecisionsEngine('record-canon-fix', params);
}

/**
 * Fetch active decisions for prompt injection.
 */
export async function listDecisions(projectId: string) {
  return callDecisionsEngine('list-decisions', { projectId });
}

/**
 * Fetch resolved note fingerprints.
 */
export async function listResolvedNotes(projectId: string) {
  return callDecisionsEngine('list-resolved-notes', { projectId });
}

/**
 * Clear reconcile flags.
 */
export async function clearReconcile(projectId: string, documentId?: string) {
  return callDecisionsEngine('clear-reconcile', { projectId, documentId });
}

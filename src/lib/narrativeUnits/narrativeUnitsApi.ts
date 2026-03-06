/**
 * Narrative Unit Engine — Phase 1 API wrapper
 * READ-ONLY extraction and listing of narrative units.
 */
import { supabase } from '@/integrations/supabase/client';

async function callNUE(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/narrative-unit-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Narrative Unit Engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}

export const narrativeUnitsApi = {
  /** Run deterministic extraction for a project */
  extract: (projectId: string) =>
    callNUE('extract', { projectId }),

  /** List narrative units for a project */
  list: (projectId: string, unitType?: string) =>
    callNUE('list', { projectId, unitType }),
};

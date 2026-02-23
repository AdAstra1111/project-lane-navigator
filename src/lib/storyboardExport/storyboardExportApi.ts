/**
 * Storyboard Export — API wrapper
 */
import { supabase } from '@/integrations/supabase/client';

async function callExport(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storyboard-export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Export error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    const err: any = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export const storyboardExportApi = {
  createExport: (projectId: string, runId: string, exportType: string, options?: any) =>
    callExport('create_export', { projectId, runId, exportType, options }),

  getExports: (projectId: string, runId?: string) =>
    callExport('get_exports', { projectId, runId }),

  deleteExport: (projectId: string, exportId: string) =>
    callExport('delete_export', { projectId, exportId }),
};

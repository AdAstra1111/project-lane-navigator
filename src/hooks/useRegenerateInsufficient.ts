import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RegenResult {
  doc_type: string;
  document_id: string | null;
  old_version_id: string | null;
  new_version_id: string | null;
  reason: string;
  chars: number;
  retry_used: boolean;
  upstream: string;
}

export interface RegenSkipped {
  doc_type: string;
  status: string;
  note: string;
}

export interface RegenSummary {
  success: boolean;
  dry_run: boolean;
  scanned: number;
  regenerated: RegenResult[];
  skipped: RegenSkipped[];
}

async function callDevEngine(action: string, body: Record<string, any>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Request failed');
  return result;
}

export function useRegenerateInsufficient(projectId: string | undefined) {
  const [dryRunResult, setDryRunResult] = useState<RegenSummary | null>(null);
  const [result, setResult] = useState<RegenSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await callDevEngine('regenerate-insufficient-docs', { projectId, dryRun: true });
      setDryRunResult(res);
      return res as RegenSummary;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const regenerate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await callDevEngine('regenerate-insufficient-docs', { projectId, dryRun: false });
      setResult(res);
      setDryRunResult(null);
      return res as RegenSummary;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setDryRunResult(null);
    setResult(null);
    setError(null);
  }, []);

  return { scan, regenerate, clear, dryRunResult, result, loading, error };
}

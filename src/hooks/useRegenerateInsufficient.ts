import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type RegenReason = 'stub_marker' | 'too_short' | 'missing_current_version';

export interface RegenResult {
  doc_type: string;
  document_id: string | null;
  reason: RegenReason;
  char_before: number;
  char_after: number;
  regenerated: boolean;
  error?: string;
  upstream?: string | null;
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
  results?: RegenResult[];
  skipped: RegenSkipped[];
}

export interface RegenProgress {
  total: number;
  completed: number;
  status: 'idle' | 'scanning' | 'running' | 'complete' | 'error';
  jobId?: string;
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
  const [progress, setProgress] = useState<RegenProgress>({ total: 0, completed: 0, status: 'idle' });
  const abortRef = useRef(false);

  const scan = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setProgress(p => ({ ...p, status: 'scanning' }));
    try {
      const res = await callDevEngine('regen-insufficient-start', { projectId, dryRun: true });
      // Map queued items to RegenSummary format for backward compat
      const mapped: RegenSummary = {
        success: true,
        dry_run: true,
        scanned: res.total_count || 0,
        regenerated: [],
        results: (res.items || []).map((it: any) => ({
          doc_type: it.doc_type,
          document_id: it.document_id,
          reason: it.reason,
          char_before: it.char_before,
          char_after: it.char_before,
          regenerated: false,
          upstream: it.upstream,
        })),
        skipped: [],
      };
      setDryRunResult(mapped);
      setProgress({ total: res.total_count, completed: 0, status: 'idle', jobId: res.job_id });
      return mapped;
    } catch (e: any) {
      setError(e.message);
      setProgress(p => ({ ...p, status: 'error' }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const regenerate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    abortRef.current = false;
    setProgress({ total: 0, completed: 0, status: 'running' });

    try {
      // 1. Start the job
      const startRes = await callDevEngine('regen-insufficient-start', { projectId, dryRun: false });
      const jobId = startRes.job_id;
      const total = startRes.total_count || 0;
      setProgress({ total, completed: 0, status: 'running', jobId });

      if (total === 0) {
        setProgress({ total: 0, completed: 0, status: 'complete', jobId });
        const emptySummary: RegenSummary = { success: true, dry_run: false, scanned: 0, regenerated: [], results: [], skipped: [] };
        setResult(emptySummary);
        setDryRunResult(null);
        return emptySummary;
      }

      // 2. Tick until complete
      let done = false;
      const allProcessed: RegenResult[] = [];
      let backoff = 500;

      while (!done && !abortRef.current) {
        const tickRes = await callDevEngine('regen-insufficient-tick', { jobId, maxItemsPerTick: 3 });
        done = tickRes.done === true;

        for (const p of (tickRes.processed || [])) {
          allProcessed.push({
            doc_type: p.doc_type,
            document_id: p.document_id || null,
            reason: p.reason || 'missing_current_version',
            char_before: p.char_before || 0,
            char_after: p.char_after || 0,
            regenerated: p.status === 'regenerated',
            error: p.error,
            upstream: p.upstream,
          });
        }

        const completed = tickRes.job?.completed_count || allProcessed.length;
        setProgress({ total, completed, status: done ? 'complete' : 'running', jobId });

        if (!done) {
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 1.2, 3000);
        }
      }

      const summary: RegenSummary = {
        success: true,
        dry_run: false,
        scanned: total,
        regenerated: allProcessed.filter(r => r.regenerated),
        results: allProcessed,
        skipped: [],
      };
      setResult(summary);
      setDryRunResult(null);
      setProgress({ total, completed: total, status: 'complete', jobId });
      return summary;
    } catch (e: any) {
      setError(e.message);
      setProgress(p => ({ ...p, status: 'error' }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setDryRunResult(null);
    setResult(null);
    setError(null);
    setProgress({ total: 0, completed: 0, status: 'idle' });
    abortRef.current = true;
  }, []);

  return { scan, regenerate, clear, dryRunResult, result, loading, error, progress };
}

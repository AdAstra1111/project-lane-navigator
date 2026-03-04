/**
 * useEnrichedPendingDecisions — Client-side enrichment fallback for legacy pending_decisions payloads.
 *
 * When a job was paused before the backend enrichment patch, pending_decisions
 * contains bare {id, impact, source} items. This hook detects that shape,
 * fetches full decision_ledger rows, and returns enriched items for the UI.
 *
 * Fail-closed: if fetch fails, returns explicit error items (never silent).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface RawPendingDecision {
  id?: string;
  impact?: string;
  source?: string;
  question?: string;
  options?: any[];
  [key: string]: any;
}

function isLegacyItem(d: RawPendingDecision): boolean {
  return !!d.id && !d.question && !Array.isArray(d.options);
}

export function useEnrichedPendingDecisions(
  pendingDecisions: RawPendingDecision[] | null | undefined,
  jobId: string | undefined,
) {
  const legacyIds = (pendingDecisions || [])
    .filter(isLegacyItem)
    .map((d) => d.id!)
    .filter(Boolean);

  const needsEnrichment = legacyIds.length > 0;

  const { data: enrichedMap, isLoading, error } = useQuery({
    queryKey: ['pending-decision-enrich', jobId, legacyIds.join(',')],
    queryFn: async () => {
      console.log('[ui][IEL] pending_decision_client_enrich_start', JSON.stringify({
        job_id: jobId, legacy_ids: legacyIds,
      }));
      const { data, error: fetchErr } = await supabase
        .from('decision_ledger')
        .select('id, decision_key, title, decision_text, decision_value')
        .in('id', legacyIds);
      if (fetchErr) {
        console.error('[ui][IEL] pending_decision_fetch_failed', JSON.stringify({
          job_id: jobId, decision_ids: legacyIds, error: fetchErr.message,
        }));
        throw fetchErr;
      }
      const map = new Map<string, any>();
      for (const row of data || []) {
        map.set(row.id, row);
      }
      return map;
    },
    enabled: needsEnrichment && !!jobId,
    staleTime: 60_000,
    retry: 1,
  });

  if (!pendingDecisions || pendingDecisions.length === 0) {
    return { decisions: [], isLoading: false, enrichmentFailed: false };
  }

  if (!needsEnrichment) {
    return { decisions: pendingDecisions, isLoading: false, enrichmentFailed: false };
  }

  if (isLoading) {
    return { decisions: pendingDecisions, isLoading: true, enrichmentFailed: false };
  }

  if (error || !enrichedMap) {
    // Fail-closed: return explicit error items
    const errorItems = pendingDecisions.map((d) => {
      if (!isLegacyItem(d)) return d;
      return {
        ...d,
        question: 'Decision details could not be loaded. Try Refresh, or Resume Auto-Run to re-emit the decision payload.',
        options: [],
        reason: 'CLIENT_FETCH_FAILED',
      };
    });
    console.warn('[ui][IEL] pending_decision_fetch_failed', JSON.stringify({
      job_id: jobId, decision_ids: legacyIds, error: (error as any)?.message || 'unknown',
    }));
    return { decisions: errorItems, isLoading: false, enrichmentFailed: true };
  }

  // Merge fetched data
  const merged = pendingDecisions.map((d) => {
    if (!isLegacyItem(d)) return d;
    const row = enrichedMap.get(d.id!);
    if (!row) {
      return {
        ...d,
        question: 'Decision details unavailable (missing decision record)',
        options: [],
        reason: 'MISSING_DECISION_LEDGER_ROW',
      };
    }
    const dv = (row as any).decision_value || {};
    return {
      ...d,
      question: dv.question || (row as any).title || (row as any).decision_text || `Decision required: ${(row as any).decision_key}`,
      options: Array.isArray(dv.options) ? dv.options : [],
      recommended: dv.recommendation?.value || null,
      decision_key: (row as any).decision_key,
      classification: dv.classification || 'BLOCKING_NOW',
      reason: (row as any).decision_text || dv.question || null,
    };
  });

  console.log('[ui][IEL] pending_decision_client_enriched', JSON.stringify({
    job_id: jobId, enriched_count: legacyIds.length,
    missing_rows: legacyIds.filter((id) => !enrichedMap.has(id)),
  }));

  return { decisions: merged, isLoading: false, enrichmentFailed: false };
}

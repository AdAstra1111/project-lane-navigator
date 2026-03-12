/**
 * useDevSeedDrift — Calls compare_dev_seed_v2 to retrieve narrative essence drift.
 * Read-only. No mutations. Fail-closed on missing data.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DimensionDetail {
  authored: unknown;
  derived: unknown;
  drift_score: number;
  notes?: string;
}

export interface DevSeedDriftResult {
  premise_drift_score: number;
  emotional_drift_score: number;
  theme_drift_score: number;
  beat_drift_score: number;
  axis_unit_drift_score: number;
  relationship_drift_score: number;
  overall_soul_drift_score: number;
  drift_band: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  primary_drift_causes: string[];
  restoration_targets: string[];
  dimension_details: Record<string, DimensionDetail>;
}

interface UseDevSeedDriftReturn {
  data: DevSeedDriftResult | null;
  isLoading: boolean;
  error: string | null;
  load: (authoredSeedId: string, derivedSeedId: string) => void;
}

export function useDevSeedDrift(projectId: string | undefined): UseDevSeedDriftReturn {
  const [data, setData] = useState<DevSeedDriftResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (authoredSeedId: string, derivedSeedId: string) => {
    if (!projectId) {
      setError('No project ID');
      return;
    }
    setIsLoading(true);
    setError(null);
    setData(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const funcUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/story-dev-seed-engine`;

      const resp = await fetch(funcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'compare_dev_seed_v2',
          projectId,
          authored_seed_id: authoredSeedId,
          derived_seed_id: derivedSeedId,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const json = await resp.json();

      if (!json.ok) {
        throw new Error(json.error || 'Backend returned failure');
      }

      if (
        json.overall_soul_drift_score === undefined ||
        json.drift_band === undefined
      ) {
        throw new Error('Invalid response — missing drift fields');
      }

      setData(json as DevSeedDriftResult);
    } catch (err: any) {
      setError(err?.message || 'Unable to compute seed comparison.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  return { data, isLoading, error, load };
}

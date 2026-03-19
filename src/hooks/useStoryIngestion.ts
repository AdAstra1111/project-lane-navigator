import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface IngestionManifest {
  scenes_parsed: number;
  scenes_written: number;
  characters: number;
  locations: number;
  props: number;
  costume_looks: number;
  state_transitions: number;
  participation_records: number;
  canon_locations_created: number;
  entity_visual_states_created: number;
  entities_total: number;
}

export interface IngestionRun {
  id: string;
  project_id: string;
  source_kind: string;
  status: string;
  manifest_json: IngestionManifest | null;
  stage_summary: any;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export function useStoryIngestion(projectId: string | undefined) {
  const [isRunning, setIsRunning] = useState(false);
  const [latestRun, setLatestRun] = useState<IngestionRun | null>(null);

  const runIngestion = useCallback(async (opts?: { force?: boolean; sourceKind?: string }) => {
    if (!projectId) return null;
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('story-ingestion-engine', {
        body: {
          action: 'ingest',
          projectId,
          force: opts?.force ?? true,
          sourceKind: opts?.sourceKind ?? 'feature_script',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const manifest = data.manifest as IngestionManifest;
      toast.success(
        `Ingestion complete: ${manifest.scenes_parsed} scenes, ${manifest.characters} characters, ${manifest.locations} locations, ${manifest.state_transitions} state transitions`
      );
      setLatestRun({
        id: data.run_id,
        project_id: projectId,
        source_kind: opts?.sourceKind ?? 'feature_script',
        status: 'completed',
        manifest_json: manifest,
        stage_summary: manifest,
        failure_reason: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      return data;
    } catch (err: any) {
      console.error('[useStoryIngestion] Error:', err);
      toast.error(err.message || 'Ingestion failed');
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [projectId]);

  const fetchStatus = useCallback(async () => {
    if (!projectId) return [];
    try {
      const { data, error } = await supabase.functions.invoke('story-ingestion-engine', {
        body: { action: 'status', projectId },
      });
      if (error) throw error;
      const runs = (data?.runs || []) as IngestionRun[];
      if (runs.length > 0) setLatestRun(runs[0]);
      return runs;
    } catch (err: any) {
      console.error('[useStoryIngestion] Status error:', err);
      return [];
    }
  }, [projectId]);

  const fetchReview = useCallback(async (runId: string) => {
    if (!projectId) return null;
    try {
      const { data, error } = await supabase.functions.invoke('story-ingestion-engine', {
        body: { action: 'review', projectId, runId },
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.error('[useStoryIngestion] Review error:', err);
      return null;
    }
  }, [projectId]);

  return { isRunning, latestRun, runIngestion, fetchStatus, fetchReview };
}

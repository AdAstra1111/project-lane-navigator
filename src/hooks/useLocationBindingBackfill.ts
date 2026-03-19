/**
 * useLocationBindingBackfill — Client hook for triggering and viewing
 * location binding backfill results.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface BackfillReport {
  scenes: { scanned: number; bound: number; unresolved: number; ambiguous: number };
  images: { scanned: number; bound: number; unresolved: number; ambiguous: number };
}

export interface BackfillResult {
  status: string;
  project_id: string;
  dry_run: boolean;
  report: BackfillReport;
}

export function useLocationBindingBackfill(projectId: string | undefined) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BackfillResult | null>(null);

  const runBackfill = useCallback(async (dryRun = false) => {
    if (!projectId || running) return null;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-location-bindings', {
        body: { project_id: projectId, dry_run: dryRun },
      });
      if (error) throw new Error(error.message);
      const result = data as BackfillResult;
      setLastResult(result);

      const totalBound = result.report.scenes.bound + result.report.images.bound;
      const totalUnresolved = result.report.scenes.unresolved + result.report.images.unresolved;
      const totalAmbiguous = result.report.scenes.ambiguous + result.report.images.ambiguous;

      if (dryRun) {
        toast.info(`Dry run: ${totalBound} bindable, ${totalUnresolved} unresolved, ${totalAmbiguous} ambiguous`);
      } else {
        toast.success(`Backfill: ${totalBound} bound, ${totalUnresolved} unresolved, ${totalAmbiguous} ambiguous`);
        qc.invalidateQueries({ queryKey: ['location-scene-usage', projectId] });
        qc.invalidateQueries({ queryKey: ['location-image-stats', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      }
      return result;
    } catch (e: any) {
      toast.error(`Backfill failed: ${e.message}`);
      return null;
    } finally {
      setRunning(false);
    }
  }, [projectId, running, qc]);

  return { runBackfill, running, lastResult };
}

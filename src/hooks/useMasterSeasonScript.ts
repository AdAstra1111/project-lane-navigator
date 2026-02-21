/**
 * useMasterSeasonScript — Tracks master season script status, out-of-date detection,
 * and compilation for the Series Writer panel.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { SeriesEpisode } from '@/hooks/useSeriesWriter';

export interface MasterScriptStatus {
  exists: boolean;
  documentId: string | null;
  latestVersionId: string | null;
  lastCompiledAt: string | null;
  isOutOfDate: boolean;
  /** Episode numbers that changed since last compile */
  changedEpisodes: number[];
  /** Latest compilation manifest */
  lastManifest: Array<{
    episode_id: string;
    episode_number: number;
    script_id: string | null;
    version_id: string | null;
    source_type: string;
  }> | null;
  isApproved: boolean;
}

export function useMasterSeasonScript(projectId: string, episodes: SeriesEpisode[]) {
  const qc = useQueryClient();

  // Fetch master script document status
  const { data: status, isLoading } = useQuery<MasterScriptStatus>({
    queryKey: ['master-season-script', projectId],
    queryFn: async () => {
      // 1. Find master doc
      const { data: doc } = await (supabase as any)
        .from('project_documents')
        .select('id, latest_version_id, last_compiled_at, is_out_of_date')
        .eq('project_id', projectId)
        .eq('doc_type', 'season_master_script')
        .maybeSingle();

      if (!doc) {
        return {
          exists: false,
          documentId: null,
          latestVersionId: null,
          lastCompiledAt: null,
          isOutOfDate: false,
          changedEpisodes: [],
          lastManifest: null,
          isApproved: false,
        };
      }

      // 2. Check if latest version is approved
      let isApproved = false;
      if (doc.latest_version_id) {
        const { data: ver } = await (supabase as any)
          .from('project_document_versions')
          .select('status')
          .eq('id', doc.latest_version_id)
          .single();
        isApproved = ver?.status === 'final';
      }

      // 3. Get latest compilation manifest
      const { data: compilations } = await (supabase as any)
        .from('season_master_compilations')
        .select('episode_manifest, compiled_at')
        .eq('project_id', projectId)
        .eq('master_document_id', doc.id)
        .order('compiled_at', { ascending: false })
        .limit(1);

      const lastManifest = compilations?.[0]?.episode_manifest || null;

      // 4. Detect which episodes changed since last compile
      const changedEpisodes: number[] = [];
      if (lastManifest && Array.isArray(lastManifest)) {
        for (const ep of episodes) {
          const manifestEntry = lastManifest.find(
            (m: any) => m.episode_id === ep.id
          );
          if (!manifestEntry) {
            // New episode not in manifest
            if (ep.script_id) changedEpisodes.push(ep.episode_number);
          } else if (manifestEntry.script_id !== ep.script_id) {
            // Script changed
            changedEpisodes.push(ep.episode_number);
          }
        }
        // Also check if manifest has episodes no longer present
        for (const m of lastManifest as any[]) {
          if (!episodes.find((e) => e.id === m.episode_id)) {
            changedEpisodes.push(m.episode_number);
          }
        }
      }

      const isOutOfDate = doc.is_out_of_date || changedEpisodes.length > 0;

      // Update out-of-date flag in DB if we detected changes
      if (changedEpisodes.length > 0 && !doc.is_out_of_date) {
        await (supabase as any)
          .from('project_documents')
          .update({ is_out_of_date: true })
          .eq('id', doc.id);
      }

      return {
        exists: true,
        documentId: doc.id,
        latestVersionId: doc.latest_version_id,
        lastCompiledAt: doc.last_compiled_at,
        isOutOfDate,
        changedEpisodes,
        lastManifest,
        isApproved,
      };
    },
    enabled: !!projectId && episodes.length > 0,
    staleTime: 10_000,
  });

  // Compile mutation
  const compile = useMutation({
    mutationFn: async (opts?: { useApproved?: boolean; includeEpisodeTitles?: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compile-season`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            project_id: projectId,
            use_approved: opts?.useApproved ?? false,
            include_episode_titles: opts?.includeEpisodeTitles ?? true,
          }),
        }
      );

      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Compile failed');
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['master-season-script', projectId] });
      qc.invalidateQueries({ queryKey: ['project-package', projectId] });
      toast.success(`Master script compiled — v${data.version_number}, ${data.episode_count} episodes`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    status: status ?? {
      exists: false,
      documentId: null,
      latestVersionId: null,
      lastCompiledAt: null,
      isOutOfDate: false,
      changedEpisodes: [],
      lastManifest: null,
      isApproved: false,
    },
    isLoading,
    compile,
  };
}

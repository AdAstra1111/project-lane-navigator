/**
 * useScreenplayIntakeRun
 *
 * Reads the latest screenplay intake run and its stage outcomes for a given
 * project. Used by the project page to show import status and surface retry
 * controls without replacing downstream truth tables.
 *
 * Returns:
 *   - latestRun    — top-level run record (status, initiated_at, metadata)
 *   - stages       — per-stage outcomes in canonical order
 *   - isLoading
 *   - canRetry     — true if ≥1 retryable stage is in 'failed' state
 *   - retryStage   — trigger a targeted retry of a single failed stage
 *   - refetch      — force re-query (e.g. after manual retry)
 *
 * Architecture contract:
 *   - This hook READS observability records only.
 *   - It does NOT derive scene graph readiness from stage status —
 *     scene_graph_scenes row count is the authoritative measure for that.
 *   - Retry invocations call the same functions/actions as the original run
 *     and update the existing stage_run row (no ghost records).
 */

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { STAGE_DEFINITIONS } from './useScriptDropProject';

const FUNC_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export type SceneGraphHealthState = 'EMPTY_GRAPH' | 'PARTIAL_GRAPH' | 'POPULATED_GRAPH';

export interface SceneGraphHealth {
  state:               SceneGraphHealthState;
  scene_count:         number;
  orphan_count:        number;
  missing_order_count: number;
  key_gap_count:       number;
  signals:             string[];
}

export interface IntakeStageRecord {
  id:              string;
  stage_key:       string;
  stage_order:     number;
  label:           string;       // derived from STAGE_DEFINITIONS
  status:          'pending' | 'running' | 'done' | 'failed' | 'skipped';
  started_at:      string | null;
  completed_at:    string | null;
  error:           string | null;
  output_summary:  Record<string, unknown> | null;
  function_name:   string | null;
  action_name:     string | null;
  retryable:       boolean;
}

export interface IntakeRunRecord {
  id:               string;
  project_id:       string;
  status:           'running' | 'done' | 'partial' | 'failed';
  initiated_at:     string;
  completed_at:     string | null;
  metadata:         Record<string, unknown>;
  source_doc_id:    string | null;
  script_version_id:string | null;
}

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  token: string,
): Promise<any> {
  const resp = await fetch(`${FUNC_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `${name} HTTP ${resp.status}`);
  if (json?.error) throw new Error(json.error);
  return json;
}

const LABEL_MAP = Object.fromEntries(STAGE_DEFINITIONS.map(s => [s.key, s.label]));

export function useScreenplayIntakeRun(projectId: string | undefined) {
  const qc = useQueryClient();
  const [retryingStage, setRetryingStage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['screenplay-intake-run', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      // Fetch latest run for this project
      const { data: runs, error: runErr } = await (supabase as any)
        .from('screenplay_intake_runs')
        .select('*')
        .eq('project_id', projectId!)
        .order('initiated_at', { ascending: false })
        .limit(1);
      if (runErr) throw runErr;
      if (!runs || runs.length === 0) return null;

      const run = runs[0] as IntakeRunRecord;

      // Fetch stage outcomes for this run
      const { data: stageRows, error: stageErr } = await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .select('*')
        .eq('run_id', run.id)
        .order('stage_order', { ascending: true });
      if (stageErr) throw stageErr;

      // Merge with STAGE_DEFINITIONS to guarantee label + order even if DB rows are sparse
      const stageMap = new Map<string, any>((stageRows || []).map((r: any) => [r.stage_key, r]));
      const stages: IntakeStageRecord[] = STAGE_DEFINITIONS.map((def, i) => {
        const row = stageMap.get(def.key);
        return {
          id:             row?.id ?? '',
          stage_key:      def.key,
          stage_order:    i,
          label:          def.label,
          status:         row?.status ?? 'pending',
          started_at:     row?.started_at ?? null,
          completed_at:   row?.completed_at ?? null,
          error:          row?.error ?? null,
          output_summary: row?.output_summary ?? null,
          function_name:  row?.function_name ?? def.functionName,
          action_name:    row?.action_name ?? def.actionName ?? null,
          retryable:      row?.retryable ?? def.retryable,
        };
      });

      return { run, stages };
    },
    staleTime: 10_000,
    refetchInterval: (q) => {
      // Poll while run is still active
      if (q.state.data?.run?.status === 'running') return 5_000;
      return false;
    },
  });

  const retryStage = useCallback(async (stageKey: string) => {
    if (!projectId || !data?.run?.id) return;
    const stage = data.stages.find(s => s.stage_key === stageKey);
    if (!stage || !stage.retryable) {
      toast.error(`Stage '${stageKey}' is not retryable`);
      return;
    }

    setRetryingStage(stageKey);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      // Mark running in DB
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'running', started_at: new Date().toISOString(), error: null, completed_at: null })
        .eq('run_id', data.run.id)
        .eq('stage_key', stageKey)
        .catch(() => {});

      let result: any;
      switch (stageKey) {
        case 'ingest':
          result = await callFunction('script-intake', {
            action:     'ingest_pdf',
            projectId,
            storagePath: data.run.metadata?.storage_path,
            documentId:  data.run.source_doc_id,
            versionId:   data.run.script_version_id,
          }, token);
          break;
        case 'scene_extract': {
          // Pre-flight: check whether the scene graph already has active scenes.
          //
          // Retry policy for scene_extract:
          //   EMPTY graph  → safe to re-run with force:false (normal retry path)
          //   NON-EMPTY    → blocked; would create duplicate/overlapping scenes
          //                  because scene_graph_scenes has no UNIQUE guard.
          //                  User must use explicit rebuild (force:true) — which
          //                  is a separate destructive action, not a normal retry.
          //
          // If the count query fails, we fail-closed (do not proceed).
          const { data: sceneRows, error: sceneCountErr } = await (supabase as any)
            .from('scene_graph_scenes')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .is('deprecated_at', null);
          const existingSceneCount: number =
            typeof sceneRows?.count === 'number' ? sceneRows.count
            : sceneCountErr ? -1   // unknown — fail-closed
            : 0;

          if (sceneCountErr || existingSceneCount !== 0) {
            // Blocked — persist the reason and surface to the user
            const reason = sceneCountErr
              ? `scene_count_check_failed:${sceneCountErr.message}`
              : `retry_blocked:scene_graph_not_empty:${existingSceneCount}`;

            await (supabase as any)
              .from('screenplay_intake_stage_runs')
              .update({
                status:          'skipped',
                completed_at:    new Date().toISOString(),
                error:           reason,
                output_summary:  {
                  retry_blocked:        true,
                  reason:               sceneCountErr ? 'scene_count_check_failed' : 'scene_graph_not_empty',
                  existing_scene_count: existingSceneCount,
                  message:              existingSceneCount > 0
                    ? `Scene graph already has ${existingSceneCount} active scene(s). Use explicit rebuild (force) to replace.`
                    : 'Could not verify scene graph state — retry blocked.',
                },
              })
              .eq('run_id', data!.run.id)
              .eq('stage_key', stageKey)
              .catch(() => {});

            throw new Error(
              existingSceneCount > 0
                ? `Scene graph already has ${existingSceneCount} scene(s). Retry is blocked — use Rebuild to replace the scene graph.`
                : `Could not verify scene graph state. Retry blocked.`
            );
          }

          result = await callFunction('dev-engine-v2', {
            action:           'scene_graph_extract',
            projectId,
            sourceDocumentId: data.run.source_doc_id,
            sourceVersionId:  data.run.script_version_id,
            force:            false,
          }, token);
          break;
        }
        case 'nit_dialogue':
          result = await callFunction('nit-sync', { projectId, action: 'sync_dialogue_characters' }, token);
          break;
        case 'role_classify':
          result = await callFunction('dev-engine-v2', {
            action: 'scene_graph_classify_roles_heuristic', projectId, force: true,
          }, token);
          break;
        case 'spine_sync':
          result = await callFunction('dev-engine-v2', { action: 'scene_graph_sync_spine_links', projectId }, token);
          break;
        case 'binding_derive':
          result = await callFunction('dev-engine-v2', { action: 'scene_derive_blueprint_bindings', projectId }, token);
          break;
        default:
          throw new Error(`No retry handler for stage '${stageKey}'`);
      }

      // Mark done
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'done', completed_at: new Date().toISOString(), output_summary: result ?? {} })
        .eq('run_id', data.run.id)
        .eq('stage_key', stageKey)
        .catch(() => {});

      // Check if all stages are now done and update top-level run status
      const { data: allStages } = await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .select('status')
        .eq('run_id', data.run.id);
      const allDone = (allStages || []).every((s: any) => s.status === 'done' || s.status === 'skipped');
      if (allDone) {
        await (supabase as any)
          .from('screenplay_intake_runs')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('id', data.run.id)
          .catch(() => {});
      }

      toast.success(`Stage '${LABEL_MAP[stageKey] ?? stageKey}' completed`);
      qc.invalidateQueries({ queryKey: ['screenplay-intake-run', projectId] });

    } catch (err: any) {
      // Mark failed
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error: err.message.slice(0, 500) })
        .eq('run_id', data!.run.id)
        .eq('stage_key', stageKey)
        .catch(() => {});
      toast.error(`Retry failed: ${err.message}`);
      qc.invalidateQueries({ queryKey: ['screenplay-intake-run', projectId] });
    } finally {
      setRetryingStage(null);
    }
  }, [projectId, data, qc]);

  const [rebuilding, setRebuilding] = useState(false);

  const rebuildSceneGraph = useCallback(async () => {
    if (!projectId || !data?.run) return;
    setRebuilding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      // Mark stage as running
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'running', started_at: new Date().toISOString(), error: null, completed_at: null })
        .eq('run_id', data.run.id)
        .eq('stage_key', 'scene_extract')
        .catch(() => {});

      const result = await callFunction('dev-engine-v2', {
        action:           'scene_graph_extract',
        projectId,
        sourceDocumentId: data.run.source_doc_id,
        sourceVersionId:  data.run.script_version_id,
        force:            true,
      }, token);

      // Mark done
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'done', completed_at: new Date().toISOString(), output_summary: result ?? {} })
        .eq('run_id', data.run.id)
        .eq('stage_key', 'scene_extract')
        .catch(() => {});

      toast.success('Scene graph rebuilt successfully');
      qc.invalidateQueries({ queryKey: ['screenplay-intake-run', projectId] });
    } catch (err: any) {
      await (supabase as any)
        .from('screenplay_intake_stage_runs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error: err.message?.slice(0, 500) })
        .eq('run_id', data!.run.id)
        .eq('stage_key', 'scene_extract')
        .catch(() => {});
      toast.error(`Rebuild failed: ${err.message}`);
      qc.invalidateQueries({ queryKey: ['screenplay-intake-run', projectId] });
    } finally {
      setRebuilding(false);
    }
  }, [projectId, data, qc]);

  const refetch = () => qc.invalidateQueries({ queryKey: ['screenplay-intake-run', projectId] });

  const failedRetryableStages = (data?.stages ?? []).filter(
    s => s.status === 'failed' && s.retryable,
  );

  // Detect rebuild-required state for scene_extract
  const sceneExtractStage = (data?.stages ?? []).find(s => s.stage_key === 'scene_extract');
  const rebuildRequired = sceneExtractStage?.status === 'skipped'
    && typeof sceneExtractStage?.error === 'string'
    && sceneExtractStage.error.startsWith('retry_blocked:scene_graph_not_empty');
  const rebuildSceneCount = rebuildRequired
    ? (sceneExtractStage?.output_summary as any)?.existing_scene_count ?? null
    : null;

  return {
    latestRun:     data?.run ?? null,
    stages:        data?.stages ?? [],
    isLoading,
    error,
    canRetry:      failedRetryableStages.length > 0,
    failedStages:  failedRetryableStages,
    retryingStage,
    retryStage,
    rebuilding,
    rebuildRequired,
    rebuildSceneCount,
    rebuildSceneGraph,
    refetch,
  };
}

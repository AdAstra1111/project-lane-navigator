/**
 * useRunSnapshot — deterministic, stage-scoped provenance for Mission Control.
 *
 * Computes a RunSnapshot contract from auto_run_jobs + auto_run_steps,
 * scoped to the job's current_document (doc_type).
 *
 * Eliminates the global-best mismatch bug where provenance showed scores
 * from a different doc_type than the one being worked on.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';

export interface StageScopedProvenance {
  doc_type: string;
  scope: 'job+doc_type' | 'doc_type';
  baseline_version_id: string | null;
  best: {
    version_id: string | null;
    ci: number | null;
    gp: number | null;
    gap: number | null;
    step_index: number | null;
    scored_at: string | null;
  };
  frontier: {
    version_id: string | null;
    ci: number | null;
    gp: number | null;
    gap: number | null;
    step_index: number | null;
  };
  candidates_seen_count: number;
}

export interface RunSnapshot {
  job_id: string;
  status: string;
  current_document: string;
  step_count: number;
  max_total_steps: number;
  provenance: StageScopedProvenance;
  /** Global best (from job row) for cross-reference */
  global_best: {
    version_id: string | null;
    document_id: string | null;
    ci: number | null;
    gp: number | null;
    score: number | null;
  };
}

/**
 * Derive stage-scoped provenance from auto_run_steps for the current doc_type.
 */
function computeStageScopedProvenance(
  job: AutoRunJob,
  steps: AutoRunStep[],
): StageScopedProvenance {
  const docType = job.current_document;

  // Filter to review steps for this doc_type (these have scores)
  const docReviews = steps.filter(
    s => s.document === docType && s.action === 'review' && s.ci != null
  );

  // Find best by CI+GP sum (same logic as backend best_score)
  let best: StageScopedProvenance['best'] = {
    version_id: null, ci: null, gp: null, gap: null, step_index: null, scored_at: null,
  };
  let bestScore = -Infinity;

  for (const s of docReviews) {
    const score = (s.ci ?? 0) + (s.gp ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = {
        version_id: (s as any).output_ref?.input_version_id ?? null,
        ci: s.ci ?? null,
        gp: s.gp ?? null,
        gap: s.gap ?? null,
        step_index: s.step_index,
        scored_at: (s as any).created_at ?? null,
      };
    }
  }

  // Frontier = latest review step for this doc_type
  const latestReview = docReviews[0]; // steps should be sorted desc
  const frontier: StageScopedProvenance['frontier'] = latestReview
    ? {
        version_id: (latestReview as any).output_ref?.input_version_id ?? null,
        ci: latestReview.ci ?? null,
        gp: latestReview.gp ?? null,
        gap: latestReview.gap ?? null,
        step_index: latestReview.step_index,
      }
    : { version_id: null, ci: null, gp: null, gap: null, step_index: null };

  // Baseline = resume_version_id (set by backend when entering a stage)
  const baseline_version_id = (job as any).resume_version_id ?? null;

  // IEL log
  console.log('[mission-control][IEL] provenance_selected', {
    project_id: job.project_id,
    job_id: job.id,
    doc_type: docType,
    scope: 'job+doc_type',
    best_version_id: best.version_id,
    best_ci: best.ci,
    best_gp: best.gp,
    best_gap: best.gap,
    candidates_seen: docReviews.length,
  });

  return {
    doc_type: docType,
    scope: 'job+doc_type',
    baseline_version_id,
    best,
    frontier,
    candidates_seen_count: docReviews.length,
  };
}

/**
 * useRunSnapshot — single deterministic fetch for Mission Control.
 *
 * Returns null when no active job exists.
 * Fail-closed: if job.current_document is empty, logs error and returns null.
 */
export function useRunSnapshot(
  job: AutoRunJob | null,
  steps: AutoRunStep[],
): RunSnapshot | null {
  return useMemo(() => {
    if (!job) {
      console.log('[mission-control][IEL] snapshot_fail_closed', { reason: 'no_active_job' });
      return null;
    }

    if (!job.current_document) {
      console.log('[mission-control][IEL] snapshot_fail_closed', {
        reason: 'current_document_empty',
        job_id: job.id,
        status: job.status,
      });
      return null;
    }

    const provenance = computeStageScopedProvenance(job, steps);

    const snapshot: RunSnapshot = {
      job_id: job.id,
      status: job.status,
      current_document: job.current_document,
      step_count: job.step_count,
      max_total_steps: job.max_total_steps,
      provenance,
      global_best: {
        version_id: (job as any).best_version_id ?? null,
        document_id: (job as any).best_document_id ?? null,
        ci: (job as any).best_ci ?? null,
        gp: (job as any).best_gp ?? null,
        score: (job as any).best_score ?? null,
      },
    };

    console.log('[mission-control][IEL] run_snapshot_loaded', {
      project_id: job.project_id,
      job_id: job.id,
      status: job.status,
      current_document: job.current_document,
      provenance_doc_type: provenance.doc_type,
      provenance_scope: provenance.scope,
      best_ci: provenance.best.ci,
      best_gp: provenance.best.gp,
      global_best_doc_type: snapshot.global_best.document_id ? 'cross-doc' : 'none',
    });

    return snapshot;
  }, [job, steps]);
}

/**
 * useDocTypeScopedBest — for VersionsPanel.
 * Fetches the best-scored version for a specific document (by document_id),
 * from the latest auto_run_steps rather than the global job.best_version_id.
 */
export function useDocTypeScopedBest(projectId: string | undefined, documentId: string | undefined) {
  return useQuery({
    queryKey: ['doc-type-scoped-best', projectId, documentId],
    queryFn: async () => {
      if (!projectId || !documentId) return null;

      // Get the doc_type for this document
      const { data: doc } = await (supabase as any)
        .from('project_documents')
        .select('doc_type')
        .eq('id', documentId)
        .maybeSingle();
      if (!doc?.doc_type) return null;

      // Get the latest job
      const { data: jobRow } = await supabase
        .from('auto_run_jobs')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!jobRow) return null;

      // Get best review step for this doc_type in this job
      const { data: steps } = await (supabase as any)
        .from('auto_run_steps')
        .select('ci, gp, output_ref, created_at')
        .eq('job_id', jobRow.id)
        .eq('document', doc.doc_type)
        .eq('action', 'review')
        .not('ci', 'is', null)
        .order('ci', { ascending: false })
        .limit(20);

      if (!steps || steps.length === 0) return null;

      // Find best by CI+GP
      let best: any = null;
      let bestScore = -Infinity;
      for (const s of steps) {
        const score = (s.ci ?? 0) + (s.gp ?? 0);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }

      if (!best?.output_ref?.input_version_id) return null;

      return {
        versionId: best.output_ref.input_version_id as string,
        score: bestScore,
        ci: best.ci,
        gp: best.gp,
        docType: doc.doc_type,
      };
    },
    enabled: !!projectId && !!documentId,
    staleTime: 15_000,
  });
}

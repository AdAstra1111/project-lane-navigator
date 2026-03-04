/**
 * useRunSnapshot — deterministic, stage-scoped provenance for Mission Control.
 *
 * Computes a RunSnapshot contract from auto_run_jobs + auto_run_steps,
 * scoped to the job's current_document (doc_type).
 *
 * Eliminates the global-best mismatch bug where provenance showed scores
 * from a different doc_type than the one being worked on.
 *
 * v2: Adds latest-per-version grouping, global best doc_type resolution,
 *     and deterministic version selection policy.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';

// ── Canonical best_score = CI + GP (matches backend blocker-aware tracking) ──
function canonicalBestScore(ci: number | null, gp: number | null): number {
  return (ci ?? 0) + (gp ?? 0);
}

// ── Deterministic version-id resolver (strict precedence, fail-closed) ──
type VersionIdSource = 'output_ref.output_version_id' | 'output_ref.version_id' | 'output_ref.input_version_id' | null;

function resolveScoredVersionId(step: AutoRunStep): { versionId: string | null; source: VersionIdSource } {
  const ref = step.output_ref;
  if (!ref) {
    console.warn('[mission-control][IEL] provenance_fail_closed', {
      reason: 'output_ref_missing', step_index: step.step_index, action: step.action,
    });
    return { versionId: null, source: null };
  }
  // Precedence: output_version_id > version_id > input_version_id
  if (ref.output_version_id) return { versionId: ref.output_version_id, source: 'output_ref.output_version_id' };
  if (ref.version_id) return { versionId: ref.version_id, source: 'output_ref.version_id' };
  if (ref.input_version_id) return { versionId: ref.input_version_id, source: 'output_ref.input_version_id' };
  console.warn('[mission-control][IEL] provenance_fail_closed', {
    reason: 'no_version_id_in_output_ref', step_index: step.step_index, ref_keys: Object.keys(ref),
  });
  return { versionId: null, source: null };
}

export interface StageScopedProvenance {
  doc_type: string;
  scope: 'job+doc_type' | 'doc_type';
  baseline_version_id: string | null;
  baseline_source: 'first_review_step' | 'job.resume_version_id' | 'none';
  best: {
    version_id: string | null;
    version_id_source: VersionIdSource;
    ci: number | null;
    gp: number | null;
    gap: number | null;
    step_index: number | null;
    scored_at: string | null;
  };
  frontier: {
    version_id: string | null;
    version_id_source: VersionIdSource;
    ci: number | null;
    gp: number | null;
    gap: number | null;
    step_index: number | null;
  };
  candidates_seen_count: number;
  versions_considered_count: number;
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
    doc_type: string | null;
    ci: number | null;
    gp: number | null;
    score: number | null;
  };
}

/**
 * Derive stage-scoped provenance from auto_run_steps for the current doc_type.
 * Steps arrive sorted ASCENDING by step_index (backend sends desc, client reverses).
 *
 * Uses latest-per-version grouping: when multiple reviews reference the same version,
 * only the latest review (highest step_index) contributes its score.
 */
function computeStageScopedProvenance(
  job: AutoRunJob,
  steps: AutoRunStep[],
): StageScopedProvenance {
  const docType = job.current_document;

  // Filter to review steps for this doc_type with scores
  const docReviews = steps.filter(
    s => s.document === docType && s.action === 'review' && s.ci != null
  );

  // ── LATEST-PER-VERSION GROUPING ──
  // Group by resolved version_id, keep only the latest review per version (highest step_index).
  const versionMap = new Map<string, { step: AutoRunStep; resolved: ReturnType<typeof resolveScoredVersionId> }>();
  for (const s of docReviews) {
    const resolved = resolveScoredVersionId(s);
    if (!resolved.versionId) continue;
    const existing = versionMap.get(resolved.versionId);
    if (!existing || s.step_index > existing.step.step_index) {
      versionMap.set(resolved.versionId, { step: s, resolved });
    }
  }

  const versionsConsidered = versionMap.size;

  // ── BEST: highest canonical score across deduplicated versions ──
  let best: StageScopedProvenance['best'] = {
    version_id: null, version_id_source: null,
    ci: null, gp: null, gap: null, step_index: null, scored_at: null,
  };
  let bestScore = -Infinity;

  for (const [versionId, { step: s, resolved }] of versionMap) {
    const score = canonicalBestScore(s.ci, s.gp);
    if (score > bestScore || (score === bestScore && s.step_index > (best.step_index ?? -1))) {
      bestScore = score;
      best = {
        version_id: versionId,
        version_id_source: resolved.source,
        ci: s.ci ?? null,
        gp: s.gp ?? null,
        gap: s.gap ?? null,
        step_index: s.step_index,
        scored_at: s.created_at ?? null,
      };
    }
  }

  // ── FRONTIER: latest review step (steps are ascending, so last element) ──
  const latestReview = docReviews.length > 0 ? docReviews[docReviews.length - 1] : null;
  let frontier: StageScopedProvenance['frontier'];
  if (latestReview) {
    const resolved = resolveScoredVersionId(latestReview);
    frontier = {
      version_id: resolved.versionId,
      version_id_source: resolved.source,
      ci: latestReview.ci ?? null,
      gp: latestReview.gp ?? null,
      gap: latestReview.gap ?? null,
      step_index: latestReview.step_index,
    };
  } else {
    frontier = { version_id: null, version_id_source: null, ci: null, gp: null, gap: null, step_index: null };
  }

  // ── BASELINE: earliest review step's version for this doc_type (deterministic) ──
  let baseline_version_id: string | null = null;
  let baseline_source: StageScopedProvenance['baseline_source'] = 'none';

  if (docReviews.length > 0) {
    const earliest = docReviews[0]; // ascending order → first = earliest
    const resolved = resolveScoredVersionId(earliest);
    baseline_version_id = resolved.versionId;
    baseline_source = 'first_review_step';
  } else if ((job as any).resume_version_id) {
    baseline_version_id = (job as any).resume_version_id;
    baseline_source = 'job.resume_version_id';
  }

  // IEL logs
  console.log('[mission-control][IEL] provenance_selected', {
    job_id: job.id,
    doc_type: docType,
    scope: 'job+doc_type',
    best_version_id: best.version_id,
    version_id_source: best.version_id_source,
    best_ci: best.ci,
    best_gp: best.gp,
    score_formula: 'CI+GP',
    baseline_version_id,
    baseline_source,
    candidates_seen: docReviews.length,
    versions_considered: versionsConsidered,
  });

  console.log('[mission-control][IEL] version_selection_policy', {
    policy: 'latest_per_version',
    doc_type: docType,
    total_reviews: docReviews.length,
    versions_considered: versionsConsidered,
    deduplicated: docReviews.length - versionsConsidered,
  });

  return {
    doc_type: docType,
    scope: 'job+doc_type',
    baseline_version_id,
    baseline_source,
    best,
    frontier,
    candidates_seen_count: docReviews.length,
    versions_considered_count: versionsConsidered,
  };
}

/**
 * useGlobalBestDocType — resolves job.best_document_id → project_documents.doc_type.
 */
function useGlobalBestDocType(documentId: string | null | undefined) {
  return useQuery({
    queryKey: ['global-best-doc-type', documentId],
    queryFn: async () => {
      if (!documentId) return null;
      const { data } = await (supabase as any)
        .from('project_documents')
        .select('doc_type')
        .eq('id', documentId)
        .maybeSingle();
      return (data?.doc_type as string) ?? null;
    },
    enabled: !!documentId,
    staleTime: 60_000,
  });
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
  const globalBestDocId = job ? (job as any).best_document_id ?? null : null;
  const { data: globalBestDocType } = useGlobalBestDocType(globalBestDocId);

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
        doc_type: globalBestDocType ?? null,
        ci: (job as any).best_ci ?? null,
        gp: (job as any).best_gp ?? null,
        score: (job as any).best_score ?? null,
      },
    };

    console.log('[mission-control][IEL] run_snapshot_loaded', {
      job_id: job.id,
      status: job.status,
      current_document: job.current_document,
      provenance_doc_type: provenance.doc_type,
      provenance_scope: provenance.scope,
      best_ci: provenance.best.ci,
      best_gp: provenance.best.gp,
      best_version_id_source: provenance.best.version_id_source,
      baseline_source: provenance.baseline_source,
      score_formula: 'CI+GP',
      version_selection_policy: 'latest_per_version',
      versions_considered: provenance.versions_considered_count,
      global_best_version_id: snapshot.global_best.version_id,
      global_best_doc_type: snapshot.global_best.doc_type,
    });

    // IEL: global best doc_type resolution
    if (snapshot.global_best.version_id && snapshot.global_best.doc_type) {
      console.log('[mission-control][IEL] global_best_doc_type_resolved', {
        job_id: job.id,
        best_version_id: snapshot.global_best.version_id,
        best_document_id: snapshot.global_best.document_id,
        best_doc_type: snapshot.global_best.doc_type,
        matches_current_stage: snapshot.global_best.doc_type === provenance.doc_type,
      });
    }

    return snapshot;
  }, [job, steps, globalBestDocType]);
}

/**
 * useDocTypeScopedBest — for VersionsPanel.
 * Fetches the best-scored version for a specific document (by document_id),
 * from the latest auto_run_steps rather than the global job.best_version_id.
 *
 * Uses latest-per-version grouping and canonical CI+GP scoring.
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

      // Get review steps for this doc_type — ordered by created_at DESC, larger cap
      const { data: steps } = await (supabase as any)
        .from('auto_run_steps')
        .select('ci, gp, gap, output_ref, created_at, step_index')
        .eq('job_id', jobRow.id)
        .eq('document', doc.doc_type)
        .eq('action', 'review')
        .not('ci', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!steps || steps.length === 0) return null;

      // Latest-per-version grouping
      const versionMap = new Map<string, typeof steps[0]>();
      for (const s of steps) {
        const ref = s.output_ref;
        const versionId = ref?.output_version_id || ref?.version_id || ref?.input_version_id;
        if (!versionId) continue;
        const existing = versionMap.get(versionId);
        if (!existing || s.step_index > existing.step_index) {
          versionMap.set(versionId, s);
        }
      }

      // Find best by canonical CI+GP from deduplicated versions
      let best: any = null;
      let bestVersionId: string | null = null;
      let bestScore = -Infinity;
      let bestSource: VersionIdSource = null;

      for (const [versionId, s] of versionMap) {
        const score = canonicalBestScore(s.ci, s.gp);
        if (score > bestScore || (score === bestScore && s.step_index > (best?.step_index ?? -1))) {
          bestScore = score;
          best = s;
          bestVersionId = versionId;
          const ref = s.output_ref;
          bestSource = ref?.output_version_id ? 'output_ref.output_version_id'
            : ref?.version_id ? 'output_ref.version_id'
            : ref?.input_version_id ? 'output_ref.input_version_id'
            : null;
        }
      }

      if (!bestVersionId) return null;

      return {
        versionId: bestVersionId,
        score: bestScore,
        ci: best.ci as number,
        gp: best.gp as number,
        gap: best.gap as number | null,
        docType: doc.doc_type as string,
        versionIdSource: bestSource,
        versionsConsidered: versionMap.size,
      };
    },
    enabled: !!projectId && !!documentId,
    staleTime: 15_000,
  });
}

/**
 * useProjectPackage — Single source of truth for Project Package contents.
 *
 * Selection logic per deliverable_type:
 *  - If any APPROVED (final) version exists → select the MOST RECENT approved version.
 *  - Else → select the MOST RECENT version overall.
 *
 * Season scripts (season_master_script) are treated separately and grouped by
 * the season_number embedded in their title (if any). Episodes are NEVER included.
 *
 * This hook is consumed by:
 *  - DocumentPackagePanel (list UI, progress bar)
 *  - PackageBar (deliverable chain chips)
 *  - DownloadPackageButton (ZIP contents)
 *  - ShareWithModal (share link export)
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getLadderForFormat } from '@/lib/stages/registry';
import { ALL_DOC_TYPE_LABELS } from '@/lib/can-promote-to-script';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PackageDeliverable {
  deliverable_type: string;
  label: string;
  ladder_index: number;
  document_id: string;
  version_id: string;
  created_at: string;
  is_approved: boolean;
  selected_by: 'approved' | 'latest';
}

export interface PackageSeasonScript {
  season_number: number | null;
  document_id: string;
  version_id: string;
  created_at: string;
  is_approved: boolean;
  selected_by: 'approved' | 'latest';
}

export interface ProjectPackage {
  /** Non-script deliverables (all types in the ladder except season_master_script) */
  deliverables: PackageDeliverable[];
  /** One entry per season_master_script document (grouped by season) */
  season_scripts: PackageSeasonScript[];
  /** Ladder order for the project format */
  ladder: string[];
  /** Project metadata */
  projectTitle: string;
  format: string;
  pipelineStage: string;
  /** Readiness stats */
  approvedCount: number;
  totalRequired: number;
  packageReadyPct: number;
}

function getLabel(docType: string): string {
  return (
    ALL_DOC_TYPE_LABELS[docType] ??
    docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Extract season number from a document title like "Master Season Script — Season 2" */
function extractSeasonNumber(title: string | null | undefined): number | null {
  if (!title) return null;
  const match = title.match(/season\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProjectPackage(projectId: string | undefined) {
  const { data, isLoading, error, refetch } = useQuery<ProjectPackage>({
    queryKey: ['project-package', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No projectId');

      // 1. Fetch project metadata
      const { data: project, error: projErr } = await (supabase as any)
        .from('projects')
        .select('id, title, format, pipeline_stage')
        .eq('id', projectId)
        .single();

      if (projErr) throw projErr;

      const format: string = project?.format || 'film';
      const pipelineStage: string = project?.pipeline_stage || 'development';
      const projectTitle: string = project?.title || 'Project';
      const ladder = getLadderForFormat(format);

      // 2. Fetch all project_documents for this project
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title, latest_version_id, updated_at')
        .eq('project_id', projectId);

      const allDocs: any[] = docs || [];

      // Build doc_type → document map (only primary deliverables, skip episode_script etc.)
      // For season_master_script there can be multiple docs (one per season)
      const docsByType = new Map<string, any[]>();
      for (const doc of allDocs) {
        const existing = docsByType.get(doc.doc_type) || [];
        existing.push(doc);
        docsByType.set(doc.doc_type, existing);
      }

      // 3. Collect all document IDs to fetch versions
      const allDocIds = allDocs.map((d: any) => d.id as string);
      if (allDocIds.length === 0) {
        return emptyPackage(projectTitle, format, pipelineStage, ladder);
      }

      // 4. Fetch the latest approved (final) version per document
      //    Using the "highest version_number where status=final" approach
      const { data: finalVersions } = await (supabase as any)
        .from('project_document_versions')
        .select('id, document_id, status, created_at, version_number, plaintext')
        .in('document_id', allDocIds)
        .eq('status', 'final')
        .order('version_number', { ascending: false });

      // Keep only the most recent approved version per document_id
      const approvedByDocId = new Map<string, any>();
      for (const v of finalVersions || []) {
        if (!approvedByDocId.has(v.document_id)) {
          approvedByDocId.set(v.document_id, v);
        }
      }

      // 5. Fetch the latest version per document (any status)
      //    Prefer latest_version_id pointer; fall back to highest version_number for docs
      //    where latest_version_id is null (common when pointer was never set).
      const latestByDocId = new Map<string, any>();

      // First: resolve via latest_version_id where available
      const latestVersionIds = allDocs
        .filter((d: any) => d.latest_version_id)
        .map((d: any) => d.latest_version_id as string);

      if (latestVersionIds.length > 0) {
        const { data: latestVersions } = await (supabase as any)
          .from('project_document_versions')
          .select('id, document_id, status, created_at, version_number, plaintext')
          .in('id', latestVersionIds);

        for (const v of latestVersions || []) {
          latestByDocId.set(v.document_id, v);
        }
      }

      // Second: for docs still missing a latest version, fetch highest version_number
      const docsWithoutLatest = allDocs.filter(
        (d: any) => !latestByDocId.has(d.id)
      );
      if (docsWithoutLatest.length > 0) {
        const missingDocIds = docsWithoutLatest.map((d: any) => d.id as string);
        const { data: fallbackVersions } = await (supabase as any)
          .from('project_document_versions')
          .select('id, document_id, status, created_at, version_number, plaintext')
          .in('document_id', missingDocIds)
          .order('version_number', { ascending: false });

        // Keep only highest version_number per document_id
        for (const v of fallbackVersions || []) {
          if (!latestByDocId.has(v.document_id)) {
            latestByDocId.set(v.document_id, v);
          }
        }
      }

      // 6. Selection helper: approved preferred → latest fallback
      function selectVersion(docId: string): {
        version_id: string;
        created_at: string;
        is_approved: boolean;
        selected_by: 'approved' | 'latest';
        plaintext?: string;
      } | null {
        const approved = approvedByDocId.get(docId);
        if (approved) {
          return {
            version_id: approved.id,
            created_at: approved.created_at,
            is_approved: true,
            selected_by: 'approved',
            plaintext: approved.plaintext,
          };
        }
        const latest = latestByDocId.get(docId);
        if (latest) {
          return {
            version_id: latest.id,
            created_at: latest.created_at,
            is_approved: false,
            selected_by: 'latest',
            plaintext: latest.plaintext,
          };
        }
        return null;
      }

      // 7. Build deliverables from the ladder (exclude season_master_script — handled separately)
      const deliverables: PackageDeliverable[] = [];
      for (let i = 0; i < ladder.length; i++) {
        const docType = ladder[i];
        if (docType === 'season_master_script') continue; // handled below

        const docsForType = docsByType.get(docType) || [];
        if (docsForType.length === 0) continue; // missing — not in package

        // For non-season types, take the first (there should only be one)
        const doc = docsForType[0];
        const sel = selectVersion(doc.id);
        if (!sel) continue;

        deliverables.push({
          deliverable_type: docType,
          label: getLabel(docType),
          ladder_index: i,
          document_id: doc.id,
          version_id: sel.version_id,
          created_at: sel.created_at,
          is_approved: sel.is_approved,
          selected_by: sel.selected_by,
        });
      }

      // 8. Build season_scripts entries
      const seasonScriptDocs = docsByType.get('season_master_script') || [];
      const season_scripts: PackageSeasonScript[] = [];
      for (const doc of seasonScriptDocs) {
        const sel = selectVersion(doc.id);
        if (!sel) continue;
        season_scripts.push({
          season_number: extractSeasonNumber(doc.title),
          document_id: doc.id,
          version_id: sel.version_id,
          created_at: sel.created_at,
          is_approved: sel.is_approved,
          selected_by: sel.selected_by,
        });
      }
      // Sort by season number
      season_scripts.sort((a, b) => (a.season_number ?? 0) - (b.season_number ?? 0));

      // 9. Compute readiness
      const allItems = [
        ...deliverables,
        ...season_scripts.map(s => ({ is_approved: s.is_approved })),
      ];
      const approvedCount = allItems.filter(d => d.is_approved).length;
      const totalRequired = allItems.length;
      const packageReadyPct =
        totalRequired > 0 ? Math.round((approvedCount / totalRequired) * 100) : 0;

      return {
        deliverables,
        season_scripts,
        ladder,
        projectTitle,
        format,
        pipelineStage,
        approvedCount,
        totalRequired,
        packageReadyPct,
      };
    },
    enabled: !!projectId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  return {
    pkg: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

function emptyPackage(
  projectTitle: string,
  format: string,
  pipelineStage: string,
  ladder: string[],
): ProjectPackage {
  return {
    deliverables: [],
    season_scripts: [],
    ladder,
    projectTitle,
    format,
    pipelineStage,
    approvedCount: 0,
    totalRequired: 0,
    packageReadyPct: 0,
  };
}

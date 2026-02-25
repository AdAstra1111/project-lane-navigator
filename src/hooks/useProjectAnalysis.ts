import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getDefaultDocSetId, getDocSetDocumentIds } from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/** Shape of the analysis_passes JSON stored on projects table */
export interface AnalysisPasses {
  verdict?: string;
  structural_read?: {
    format_detected?: string;
    genre_as_written?: string;
    protagonist_goal_clarity?: string;
    structure_clarity?: string;
  };
  creative_signal?: {
    originality?: string;
    tone_consistency?: string;
    emotional_engine?: string;
    standout_elements?: string;
  };
  market_reality?: {
    likely_audience?: string;
    comparable_titles?: string;
    budget_implications?: string;
    commercial_risks?: string;
  };
  lane?: string;
  confidence?: number;
  rationale?: string;
  do_next?: string[];
  avoid?: string[];
  lane_not_suitable?: string;
  partial_read?: boolean;
  documents?: Array<{
    file_name: string;
    file_path: string;
    extraction_status: string;
  }>;
}

export interface ProjectAnalysis {
  projectId: string;
  title: string;
  format: string;
  genres: string[];
  budgetRange: string;
  assignedLane: string | null;
  confidence: number | null;
  reasoning: string | null;
  analysis: AnalysisPasses | null;
}

/** Fetch analysis_passes + key fields from a project */
export function useProjectAnalysis(projectId: string | null) {
  return useQuery<ProjectAnalysis | null>({
    queryKey: ['project-analysis', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('id, title, format, genres, budget_range, assigned_lane, confidence, reasoning, analysis_passes')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      if (!data) return null;
      return {
        projectId: data.id,
        title: data.title,
        format: data.format,
        genres: data.genres || [],
        budgetRange: data.budget_range,
        assignedLane: data.assigned_lane,
        confidence: data.confidence,
        reasoning: data.reasoning,
        analysis: data.analysis_passes as unknown as AnalysisPasses | null,
      };
    },
  });
}

/** Trigger a re-analysis for a project using its existing documents */
export function useRunAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: string | { projectId: string; docSetId?: string | null }) => {
      const projectId = typeof params === 'string' ? params : params.projectId;
      const explicitDocSetId = typeof params === 'string' ? null : (params.docSetId ?? null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get project details
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('id, title, format, genres, budget_range, target_audience, tone, comparable_titles')
        .eq('id', projectId)
        .single();
      if (projErr || !project) throw new Error('Project not found');

      // Check for doc set to filter documents (explicit override or default)
      let docSetDocIds: string[] | null = null;
      try {
        const { data: docSetsData } = await (supabase as any)
          .from('project_doc_sets')
          .select('*')
          .eq('project_id', projectId);
        const docSets: DocSet[] = docSetsData || [];

        // Determine which doc set to use: explicit > default
        const targetDocSetId = explicitDocSetId || (docSets.length > 0 ? getDefaultDocSetId(docSets) : undefined);
        if (targetDocSetId) {
          const { data: itemsData } = await (supabase as any)
            .from('project_doc_set_items')
            .select('*')
            .eq('doc_set_id', targetDocSetId)
            .order('sort_order');
          const items: DocSetItem[] = itemsData || [];
          if (items.length > 0) {
            docSetDocIds = getDocSetDocumentIds(items);
          }
        }
      } catch {
        // Doc sets not available; continue with legacy behavior
      }

      // Get document paths — filtered by doc set if available
      let docsQuery = supabase
        .from('project_documents')
        .select('id, file_path')
        .eq('project_id', projectId);

      if (docSetDocIds && docSetDocIds.length > 0) {
        docsQuery = docsQuery.in('id', docSetDocIds);
      }

      const { data: docs } = await docsQuery;

      const documentPaths = (docs || []).map(d => d.file_path).filter(Boolean);
      if (documentPaths.length === 0) {
        throw new Error('No documents uploaded yet. Upload a script first.');
      }

      // Run analysis
      const { data: analysis, error } = await supabase.functions.invoke('analyze-project', {
        body: {
          projectInput: {
            id: projectId,
            title: project.title,
            format: project.format,
            genres: project.genres,
            budget_range: project.budget_range,
            target_audience: project.target_audience,
            tone: project.tone,
            comparable_titles: project.comparable_titles,
          },
          documentPaths,
        },
      });

      if (error) throw new Error(error.message || 'Analysis failed');
      if (analysis?.error) throw new Error(analysis.error);

      // Store result on project
      if (analysis?.lane) {
        await supabase
          .from('projects')
          .update({
            analysis_passes: analysis as any,
            assigned_lane: analysis.lane || null,
            confidence: analysis.confidence ?? null,
            reasoning: analysis.rationale || null,
          })
          .eq('id', projectId);
      }

      return analysis;
    },
    onSuccess: (_data, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project-analysis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Analysis complete');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Analysis failed');
    },
  });
}

/** Map lane slugs to human-readable labels */
export const LANE_LABELS: Record<string, string> = {
  'studio-streamer': 'Studio / Streamer',
  'independent-film': 'Independent Film',
  'low-budget': 'Low-Budget / Microbudget',
  'international-copro': 'International Co-Production',
  'genre-market': 'Genre / Market-Driven',
  'prestige-awards': 'Prestige / Awards',
  'fast-turnaround': 'Fast-Turnaround',
};

/* ── Pure helpers (exported for tests) ── */

export interface AnalyzeProjectPayloadParams {
  project: {
    id: string;
    title: string;
    format: string;
    genres: string[] | null;
    budget_range: string;
    target_audience: string | null;
    tone: string | null;
    comparable_titles: string[] | null;
  };
  documentPaths: string[];
}

/**
 * buildAnalyzeProjectPayload — deterministic payload assembly for analyze-project.
 */
export function buildAnalyzeProjectPayload(params: AnalyzeProjectPayloadParams) {
  return {
    projectInput: {
      id: params.project.id,
      title: params.project.title,
      format: params.project.format,
      genres: params.project.genres,
      budget_range: params.project.budget_range,
      target_audience: params.project.target_audience,
      tone: params.project.tone,
      comparable_titles: params.project.comparable_titles,
    },
    documentPaths: params.documentPaths,
  };
}

/**
 * parseAnalysisResponse — extract ProjectAnalysis from raw DB row.
 * Returns null if data is null/undefined.
 */
export function parseAnalysisResponse(data: {
  id: string;
  title: string;
  format: string;
  genres: string[] | null;
  budget_range: string;
  assigned_lane: string | null;
  confidence: number | null;
  reasoning: string | null;
  analysis_passes: unknown;
} | null): ProjectAnalysis | null {
  if (!data) return null;
  return {
    projectId: data.id,
    title: data.title,
    format: data.format,
    genres: data.genres || [],
    budgetRange: data.budget_range,
    assignedLane: data.assigned_lane,
    confidence: data.confidence,
    reasoning: data.reasoning,
    analysis: data.analysis_passes as AnalysisPasses | null,
  };
}

export interface AnalysisRun {
  id: string;
  created_at: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * selectCanonicalAnalysisRun — deterministically pick the "current" analysis run.
 * 1. Prefer latest successful/complete run (status === 'complete' or 'success')
 * 2. Otherwise latest by created_at
 * 3. Tiebreak: id ascending for stability
 */
export function selectCanonicalAnalysisRun(runs: AnalysisRun[]): AnalysisRun | undefined {
  if (runs.length === 0) return undefined;

  const stableSort = (a: AnalysisRun, b: AnalysisRun): number => {
    const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const successStatuses = ['complete', 'success'];
  const successful = runs
    .filter(r => r.status && successStatuses.includes(r.status))
    .sort(stableSort);

  if (successful.length > 0) return successful[0];

  return [...runs].sort(stableSort)[0];
}

/**
 * filterDocumentPathsByDocSet — given all docs and a doc set's document IDs,
 * return only the paths for docs in the doc set, preserving doc set order.
 */
export function filterDocumentPathsByDocSet(
  allDocs: Array<{ id: string; file_path: string | null }>,
  docSetDocIds: string[]
): string[] {
  const docMap = new Map(allDocs.map(d => [d.id, d.file_path]));
  return docSetDocIds
    .map(id => docMap.get(id))
    .filter((p): p is string => !!p && p.trim() !== '');
}

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
    mutationFn: async (projectId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get project details
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('id, title, format, genres, budget_range, target_audience, tone, comparable_titles')
        .eq('id', projectId)
        .single();
      if (projErr || !project) throw new Error('Project not found');

      // Check for default doc set to filter documents
      let docSetDocIds: string[] | null = null;
      try {
        const { data: docSetsData } = await (supabase as any)
          .from('project_doc_sets')
          .select('*')
          .eq('project_id', projectId);
        const docSets: DocSet[] = docSetsData || [];
        if (docSets.length > 0) {
          const defaultId = getDefaultDocSetId(docSets);
          if (defaultId) {
            const { data: itemsData } = await (supabase as any)
              .from('project_doc_set_items')
              .select('*')
              .eq('doc_set_id', defaultId)
              .order('sort_order');
            const items: DocSetItem[] = itemsData || [];
            if (items.length > 0) {
              docSetDocIds = getDocSetDocumentIds(items);
            }
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

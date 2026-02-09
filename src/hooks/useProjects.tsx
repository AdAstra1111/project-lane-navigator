import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Project, ProjectInput, AnalysisResponse, ProjectDocument } from '@/lib/types';
import { classifyProject } from '@/lib/lane-classifier';
import { toast } from 'sonner';

async function uploadDocuments(files: File[], userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${timestamp}-${safeName}`;
    const { error } = await supabase.storage.from('project-documents').upload(path, file);
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

async function analyzeWithAI(
  projectInput: ProjectInput,
  documentPaths: string[]
): Promise<AnalysisResponse> {
  const { data, error } = await supabase.functions.invoke('analyze-project', {
    body: { projectInput, documentPaths },
  });

  if (error) {
    console.error('AI analysis error:', error);
    throw new Error(error.message || 'AI analysis failed');
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data as AnalysisResponse;
}

export function useProjects() {
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Project[];
    },
  });

  const createProject = useMutation({
    mutationFn: async ({ input, files }: { input: ProjectInput; files: File[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Upload files to storage
      let documentPaths: string[] = [];
      if (files.length > 0) {
        documentPaths = await uploadDocuments(files, user.id);
      }

      // 2. Run AI analysis (falls back to rules-based if AI fails and no docs)
      let analysis: AnalysisResponse | null = null;
      let fallbackClassification = null;

      try {
        analysis = await analyzeWithAI(input, documentPaths);
      } catch (err) {
        if (files.length > 0) {
          // If documents were uploaded, we need AI — can't fall back
          throw err;
        }
        console.warn('AI analysis unavailable, using rules-based classifier:', err);
        fallbackClassification = classifyProject(input);
      }

      // 3. Build analysis_passes for storage
      const analysisPasses = analysis
        ? {
            structural_read: analysis.structural_read,
            creative_signal: analysis.creative_signal,
            market_reality: analysis.market_reality,
            do_next: analysis.do_next,
            avoid: analysis.avoid,
            partial_read: analysis.partial_read || null,
          }
        : null;

      // 4. Insert project
      const { data: project, error: insertError } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: input.title,
          format: input.format,
          genres: input.genres,
          budget_range: input.budget_range,
          target_audience: input.target_audience,
          tone: input.tone,
          comparable_titles: input.comparable_titles,
          assigned_lane: analysis?.lane || fallbackClassification?.lane || null,
          confidence: analysis?.confidence ?? fallbackClassification?.confidence ?? null,
          reasoning: analysis?.rationale || fallbackClassification?.reasoning || null,
          recommendations: fallbackClassification
            ? (fallbackClassification.recommendations as unknown as Json)
            : null,
          document_urls: documentPaths,
          analysis_passes: analysisPasses as unknown as Json,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 5. Save document records
      if (analysis?.documents) {
        for (const doc of analysis.documents) {
          const { error: docError } = await supabase.from('project_documents').insert({
            project_id: (project as any).id,
            user_id: user.id,
            file_name: doc.file_name,
            file_path: doc.file_path,
            extracted_text: doc.extracted_text || null,
            extraction_status: doc.extraction_status,
            total_pages: doc.total_pages,
            pages_analyzed: doc.pages_analyzed,
            error_message: doc.error_message,
          });
          if (docError) console.error('Failed to save document record:', docError);
        }
      }

      return project as unknown as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create project');
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete project');
    },
  });

  return { projects, isLoading, error, createProject, deleteProject };
}

export function useProject(id: string | undefined) {
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      if (!id) throw new Error('No project ID');
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as Project;
    },
    enabled: !!id,
  });

  return { project, isLoading, error };
}

export function useProjectDocuments(projectId: string | undefined) {
  const { data: documents = [], isLoading, error } = useQuery({
    queryKey: ['project-documents', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project ID');
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, project_id, user_id, file_name, file_path, extraction_status, total_pages, pages_analyzed, error_message, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectDocument[];
    },
    enabled: !!projectId,
  });

  return { documents, isLoading, error };
}

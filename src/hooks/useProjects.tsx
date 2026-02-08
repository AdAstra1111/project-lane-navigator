import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Project, ProjectInput, ClassificationResult } from '@/lib/types';
import { classifyProject } from '@/lib/lane-classifier';
import { toast } from 'sonner';

async function uploadDocuments(files: File[], userId: string): Promise<string[]> {
  const paths: string[] = [];

  for (const file of files) {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${timestamp}-${safeName}`;

    const { error } = await supabase.storage
      .from('project-documents')
      .upload(path, file);

    if (error) {
      console.error(`Failed to upload ${file.name}:`, error);
      throw new Error(`Failed to upload ${file.name}`);
    }

    paths.push(path);
  }

  return paths;
}

async function analyzeWithAI(
  projectInput: ProjectInput,
  documentPaths: string[]
): Promise<ClassificationResult> {
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

  return data as ClassificationResult;
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

      // Upload documents if any
      let documentPaths: string[] = [];
      if (files.length > 0) {
        documentPaths = await uploadDocuments(files, user.id);
      }

      // Use AI analysis if documents are uploaded, otherwise fall back to rules-based
      let classification: ClassificationResult;
      if (files.length > 0) {
        classification = await analyzeWithAI(input, documentPaths);
      } else {
        // Try AI analysis first even without docs, fall back to rules-based
        try {
          classification = await analyzeWithAI(input, []);
        } catch (err) {
          console.warn('AI analysis unavailable, using rules-based classifier:', err);
          classification = classifyProject(input);
        }
      }

      const { data, error } = await supabase
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
          assigned_lane: classification.lane,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          recommendations: classification.recommendations as unknown as Json,
          document_urls: documentPaths,
          analysis_passes: (classification.passes || null) as unknown as Json,
        })
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create project');
    },
  });

  return { projects, isLoading, error, createProject };
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

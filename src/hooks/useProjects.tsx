import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Project, ProjectInput } from '@/lib/types';
import { classifyProject } from '@/lib/lane-classifier';

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
    mutationFn: async (input: ProjectInput) => {
      const classification = classifyProject(input);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

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
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as unknown as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect } from 'react';

// ---- Types ----

export type ProjectRole = 'producer' | 'sales_agent' | 'lawyer' | 'creative';

export interface ProjectCollaborator {
  id: string;
  project_id: string;
  user_id: string;
  invited_by: string;
  email: string;
  role: ProjectRole;
  status: string;
  created_at: string;
  updated_at: string;
  display_name?: string; // joined from profiles
}

export interface ProjectComment {
  id: string;
  project_id: string;
  user_id: string;
  parent_id: string | null;
  section: string;
  content: string;
  created_at: string;
  updated_at: string;
  display_name?: string; // joined from profiles
  replies?: ProjectComment[];
}

export const ROLE_LABELS: Record<ProjectRole, string> = {
  producer: 'Producer / Lead',
  sales_agent: 'Sales Agent',
  lawyer: 'Lawyer / Business Affairs',
  creative: 'Creative (Writer/Director)',
};

export const ROLE_VISIBILITY: Record<ProjectRole | 'owner', string[]> = {
  owner: ['all'],
  producer: ['all'],
  sales_agent: ['analysis', 'cast', 'packaging', 'general'],
  lawyer: ['finance', 'incentives', 'general'],
  creative: ['analysis', 'script', 'general'],
};

export const SECTION_LABELS: Record<string, string> = {
  general: 'General',
  analysis: 'Analysis',
  cast: 'Cast & Packaging',
  finance: 'Finance',
  incentives: 'Incentives',
  packaging: 'Packaging',
  script: 'Script',
};

// ---- Collaborators ----

export function useProjectCollaborators(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-collaborators', projectId];

  const { data: collaborators = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_collaborators')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Enrich with display names
      const userIds = (data as any[]).map((c: any) => c.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name]));
      return (data as any[]).map((c: any) => ({
        ...c,
        display_name: profileMap.get(c.user_id) || c.email,
      })) as ProjectCollaborator[];
    },
    enabled: !!projectId,
  });

  const invite = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: ProjectRole }) => {
      if (!projectId) throw new Error('No project');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Look up user by email in profiles
      // For now, we store the email and user_id will be set when they accept
      // We use a placeholder user_id (the inviter's) until the invited user signs up/accepts
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('display_name', email)
        .maybeSingle();

      const targetUserId = targetProfile?.user_id || user.id; // fallback

      const { error } = await supabase
        .from('project_collaborators')
        .insert({
          project_id: projectId,
          user_id: targetUserId,
          invited_by: user.id,
          email,
          role,
          status: 'pending',
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Invitation sent');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const { error } = await supabase
        .from('project_collaborators')
        .delete()
        .eq('id', collaboratorId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Collaborator removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ collaboratorId, role }: { collaboratorId: string; role: ProjectRole }) => {
      const { error } = await supabase
        .from('project_collaborators')
        .update({ role } as any)
        .eq('id', collaboratorId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Role updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { collaborators, isLoading, invite, remove, updateRole };
}

// ---- Comments with Realtime ----

export function useProjectComments(projectId: string | undefined, section?: string) {
  const queryClient = useQueryClient();
  const queryKey = ['project-comments', projectId, section];

  const { data: comments = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      let query = supabase
        .from('project_comments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (section) {
        query = query.eq('section', section);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Enrich with display names
      const userIds = [...new Set((data as any[]).map((c: any) => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name]));

      const enriched = (data as any[]).map((c: any) => ({
        ...c,
        display_name: profileMap.get(c.user_id) || 'Team member',
      })) as ProjectComment[];

      // Build thread tree
      const rootComments = enriched.filter(c => !c.parent_id);
      const childMap = new Map<string, ProjectComment[]>();
      enriched.filter(c => c.parent_id).forEach(c => {
        const existing = childMap.get(c.parent_id!) || [];
        existing.push(c);
        childMap.set(c.parent_id!, existing);
      });

      return rootComments.map(c => ({
        ...c,
        replies: childMap.get(c.id) || [],
      }));
    },
    enabled: !!projectId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`comments-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_comments',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, queryKey]);

  const addComment = useMutation({
    mutationFn: async ({ content, parentId, commentSection }: { content: string; parentId?: string; commentSection?: string }) => {
      if (!projectId) throw new Error('No project');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('project_comments')
        .insert({
          project_id: projectId,
          user_id: user.id,
          parent_id: parentId || null,
          section: commentSection || section || 'general',
          content,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteComment = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase
        .from('project_comments')
        .delete()
        .eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { comments, isLoading, addComment, deleteComment };
}

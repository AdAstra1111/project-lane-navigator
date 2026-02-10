import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectRole } from '@/hooks/useCollaboration';

export function useInviteLinks(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['invite-links', projectId];

  const { data: links = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_invite_links' as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  const create = useMutation({
    mutationFn: async ({ role }: { role: ProjectRole }) => {
      if (!projectId) throw new Error('No project');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('project_invite_links' as any)
        .insert({ project_id: projectId, role, created_by: user.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('project_invite_links' as any)
        .delete()
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Invite link removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getInviteUrl = (token: string) => {
    return `${window.location.origin}/invite?token=${token}`;
  };

  return { links, isLoading, create, remove, getInviteUrl };
}

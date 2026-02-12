import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SharedSignal {
  id: string;
  signal_id: string;
  signal_type: string;
  signal_name: string;
  shared_by: string;
  shared_with: string;
  project_id: string | null;
  note: string;
  created_at: string;
  sharer_name?: string;
}

export function useSharedSignals() {
  const queryClient = useQueryClient();

  const { data: received = [], isLoading } = useQuery({
    queryKey: ['shared-signals-received'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('shared_signals')
        .select('*')
        .eq('shared_with', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Enrich with sharer names
      const sharerIds = [...new Set((data as any[]).map((s: any) => s.shared_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', sharerIds);

      const nameMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name]));
      return (data as any[]).map((s: any) => ({
        ...s,
        sharer_name: nameMap.get(s.shared_by) || 'A collaborator',
      })) as SharedSignal[];
    },
  });

  const share = useMutation({
    mutationFn: async (params: {
      signalId: string;
      signalType: string;
      signalName: string;
      recipientIds: string[];
      projectId?: string;
      note?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const rows = params.recipientIds.map(rid => ({
        signal_id: params.signalId,
        signal_type: params.signalType,
        signal_name: params.signalName,
        shared_by: user.id,
        shared_with: rid,
        project_id: params.projectId || null,
        note: params.note || '',
      }));

      const { error } = await supabase.from('shared_signals').insert(rows as any);
      if (error) throw error;

      // Create notifications for each recipient
      for (const rid of params.recipientIds) {
        const link = params.signalType === 'coverage' && params.projectId
          ? `/projects/${params.projectId}`
          : '/trends';
        await supabase.from('notifications').insert({
          user_id: rid,
          type: 'shared-signal',
          title: `Signal shared: ${params.signalName}`,
          body: params.note || `A team member shared a ${params.signalType} signal with you.`,
          link,
        } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-signals-received'] });
      toast.success('Signal shared');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { received, isLoading, share };
}

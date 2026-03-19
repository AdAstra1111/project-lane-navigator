/**
 * useCharacterIdentityNotes — CRUD hook for character_identity_notes table.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CharacterIdentityNote {
  id: string;
  project_id: string;
  character_name: string;
  notes: string;
  canon_check_status: string;
  canon_check_messages: string[];
  updated_at: string;
  user_id: string;
}

const NOTES_KEY = (pid: string, charName: string) => ['character-identity-notes', pid, charName];

export function useCharacterIdentityNotes(projectId: string | undefined, characterName: string) {
  const qc = useQueryClient();

  const { data: noteRecord, isLoading } = useQuery<CharacterIdentityNote | null>({
    queryKey: NOTES_KEY(projectId!, characterName),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('character_identity_notes')
        .select('*')
        .eq('project_id', projectId)
        .eq('character_name', characterName)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    enabled: !!projectId && !!characterName,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ notes, canonCheckStatus, canonCheckMessages }: {
      notes: string;
      canonCheckStatus: string;
      canonCheckMessages: string[];
    }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) throw new Error('Not authenticated');

      const { data, error } = await (supabase as any)
        .from('character_identity_notes')
        .upsert({
          project_id: projectId,
          character_name: characterName,
          notes,
          canon_check_status: canonCheckStatus,
          canon_check_messages: canonCheckMessages,
          updated_at: new Date().toISOString(),
          user_id: user.user.id,
        }, { onConflict: 'project_id,character_name' })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(NOTES_KEY(projectId!, characterName), data);
      toast.success('Identity notes saved');
    },
    onError: (err: any) => {
      toast.error('Failed to save notes: ' + (err.message || 'Unknown'));
    },
  });

  return {
    notes: noteRecord?.notes || '',
    canonCheckStatus: (noteRecord?.canon_check_status || 'unchecked') as string,
    canonCheckMessages: (noteRecord?.canon_check_messages || []) as string[],
    isLoading,
    isSaving: saveMutation.isPending,
    save: saveMutation.mutate,
  };
}

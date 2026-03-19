/**
 * useVisualDNA — Hook for managing Character Visual DNA resolution and persistence.
 */
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  resolveCharacterVisualDNA,
  serializeDNAForStorage,
  type CharacterVisualDNA,
} from '@/lib/images/visualDNA';
import { resolveCharacterIdentity } from '@/lib/images/identityResolver';

export function useVisualDNA(projectId: string | undefined, characterName: string | undefined) {
  const qc = useQueryClient();
  
  // Fetch current DNA from database
  const dnaQuery = useQuery({
    queryKey: ['visual-dna', projectId, characterName],
    queryFn: async () => {
      if (!projectId || !characterName) return null;
      const { data } = await (supabase as any)
        .from('character_visual_dna')
        .select('*')
        .eq('project_id', projectId)
        .eq('character_name', characterName)
        .eq('is_current', true)
        .maybeSingle();
      return data;
    },
    enabled: !!projectId && !!characterName,
  });
  
  // Resolve DNA from canon (client-side computation)
  const resolveMutation = useMutation({
    mutationFn: async (params: {
      canonCharacter: Record<string, unknown> | null;
      canonJson: Record<string, unknown> | null;
      userNotes: string;
    }) => {
      if (!projectId || !characterName) throw new Error('Missing project/character');
      
      // Check identity lock
      const identity = await resolveCharacterIdentity(projectId, characterName);
      
      // Resolve DNA
      const dna = resolveCharacterVisualDNA(
        characterName,
        params.canonCharacter,
        params.canonJson,
        params.userNotes,
        identity.locked,
      );
      
      // Get next version number
      const { data: existing } = await (supabase as any)
        .from('character_visual_dna')
        .select('version_number')
        .eq('project_id', projectId)
        .eq('character_name', characterName)
        .order('version_number', { ascending: false })
        .limit(1);
      
      const nextVersion = (existing?.[0]?.version_number || 0) + 1;
      
      // Mark old versions as not current
      await (supabase as any)
        .from('character_visual_dna')
        .update({ is_current: false })
        .eq('project_id', projectId)
        .eq('character_name', characterName);
      
      // Persist new DNA
      const serialized = serializeDNAForStorage(dna);
      const { data: session } = await supabase.auth.getSession();
      
      const { error } = await (supabase as any)
        .from('character_visual_dna')
        .insert({
          project_id: projectId,
          character_name: characterName,
          version_number: nextVersion,
          ...serialized,
          is_current: true,
          created_by: session?.session?.user?.id,
        });
      
      if (error) throw error;
      
      return dna;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visual-dna', projectId, characterName] });
      toast.success('Visual DNA resolved and saved');
    },
    onError: (e: Error) => toast.error(`DNA resolution failed: ${e.message}`),
  });
  
  return {
    currentDNA: dnaQuery.data,
    isLoading: dnaQuery.isLoading,
    resolveDNA: resolveMutation,
  };
}

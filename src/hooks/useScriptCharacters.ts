import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ScriptCharacter {
  name: string;
  description: string;
}

export function useScriptCharacters(projectId: string | undefined) {
  return useQuery({
    queryKey: ['script-characters', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.functions.invoke('extract-characters', {
        body: { projectId },
      });
      if (error) {
        console.error('Character extraction error:', error);
        return [];
      }
      return (data?.characters || []) as ScriptCharacter[];
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 10, // cache for 10 minutes
    retry: 1,
  });
}

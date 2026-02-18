import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ScriptCharacter {
  name: string;
  description: string;
  scene_count?: number;
  gender?: 'male' | 'female' | 'unknown';
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
        // supabase.functions.invoke wraps HTTP errors — check the context for status
        const msg: string = (error as any)?.message || '';
        const context = (error as any)?.context;
        const status = context?.status ?? 0;

        if (status === 402 || msg.toLowerCase().includes('credits')) {
          toast.error('AI credits exhausted. Please add funds to your workspace under Settings → Usage.');
          return [];
        }
        if (status === 429 || msg.toLowerCase().includes('rate limit')) {
          toast.error('Rate limit reached. Please try again in a moment.');
          return [];
        }

        console.error('Character extraction error:', error);
        return [];
      }

      // Edge function returned 402/429 in the body (non-throw path)
      if (data?.error) {
        const errMsg: string = data.error;
        if (errMsg.toLowerCase().includes('credits') || errMsg.toLowerCase().includes('payment')) {
          toast.error('AI credits exhausted. Please add funds to your workspace under Settings → Usage.');
        } else if (errMsg.toLowerCase().includes('rate limit')) {
          toast.error('Rate limit reached. Please try again in a moment.');
        }
        return [];
      }

      return (data?.characters || []) as ScriptCharacter[];
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 10, // cache for 10 minutes
    retry: false, // don't retry on payment/rate-limit errors
  });
}

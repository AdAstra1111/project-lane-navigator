import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CorpusIntegrityResult {
  id: string;
  pass: boolean;
  checks: Record<string, boolean>;
  evidence: any;
  failures: string[];
  created_at: string;
}

export function useCorpusIntegrityStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['corpus-integrity-status', user?.id],
    queryFn: async (): Promise<CorpusIntegrityResult | null> => {
      const { data, error } = await (supabase as any)
        .from('system_health_checks')
        .select('*')
        .eq('check_name', 'corpus_integrity')
        .or(`user_id.is.null,user_id.eq.${user!.id}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('Failed to fetch corpus integrity status:', error);
        return null;
      }
      return data as CorpusIntegrityResult | null;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

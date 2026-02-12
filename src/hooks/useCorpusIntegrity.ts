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
      const db = supabase as any;

      // 1) Try user-specific result first
      const { data: userResult, error: userErr } = await db
        .from('system_health_checks')
        .select('*')
        .eq('check_name', 'corpus_integrity')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!userErr && userResult) return userResult as CorpusIntegrityResult;

      // 2) Fallback to global (user_id IS NULL)
      const { data: globalResult, error: globalErr } = await db
        .from('system_health_checks')
        .select('*')
        .eq('check_name', 'corpus_integrity')
        .is('user_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!globalErr && globalResult) return globalResult as CorpusIntegrityResult;

      return null;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

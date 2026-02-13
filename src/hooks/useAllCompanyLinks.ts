import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LinkRow {
  project_id: string;
  company_id: string;
}

/**
 * Fetches all project↔company links for the current user.
 * Returns a map: companyId → Set<projectId>
 */
export function useAllCompanyLinks() {
  const { data: links = [] } = useQuery({
    queryKey: ['all-company-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_company_links')
        .select('project_id, company_id');
      if (error) throw error;
      return data as LinkRow[];
    },
  });

  const linkMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const l of links) {
      if (!map[l.company_id]) map[l.company_id] = new Set();
      map[l.company_id].add(l.project_id);
    }
    return map;
  }, [links]);

  return { links, linkMap };
}

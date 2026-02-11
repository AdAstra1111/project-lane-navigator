import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';

interface DashboardScores {
  [projectId: string]: { readiness: number; financeReadiness: number };
}

async function fetchAttachmentsForProjects(projectIds: string[]) {
  if (projectIds.length === 0) return { cast: [], partners: [], scripts: [], finance: [], hods: [] };

  const [castRes, partnersRes, scriptsRes, financeRes, hodsRes] = await Promise.all([
    supabase.from('project_cast').select('*').in('project_id', projectIds),
    supabase.from('project_partners').select('*').in('project_id', projectIds),
    supabase.from('project_scripts').select('*').in('project_id', projectIds),
    supabase.from('project_finance_scenarios').select('*').in('project_id', projectIds),
    supabase.from('project_hods').select('*').in('project_id', projectIds),
  ]);

  return {
    cast: (castRes.data || []) as unknown as ProjectCastMember[],
    partners: (partnersRes.data || []) as unknown as ProjectPartner[],
    scripts: (scriptsRes.data || []) as unknown as ProjectScript[],
    finance: (financeRes.data || []) as unknown as ProjectFinanceScenario[],
    hods: (hodsRes.data || []) as unknown as ProjectHOD[],
  };
}

export function useDashboardScores(projects: Project[]) {
  return useQuery<DashboardScores>({
    queryKey: ['dashboard-scores', projects.map(p => p.id).join(',')],
    queryFn: async () => {
      const ids = projects.map(p => p.id);
      const { cast, partners, scripts, finance, hods } = await fetchAttachmentsForProjects(ids);

      const scores: DashboardScores = {};
      for (const p of projects) {
        const pCast = cast.filter(c => c.project_id === p.id);
        const pPartners = partners.filter(x => x.project_id === p.id);
        const pScripts = scripts.filter(x => x.project_id === p.id);
        const pFinance = finance.filter(x => x.project_id === p.id);
        const pHods = hods.filter(x => x.project_id === p.id);
        const hasIncentive = !!(p as any).incentive_insights;

        const r = calculateReadiness(p, pCast, pPartners, pScripts, pFinance, pHods, hasIncentive);
        const fr = calculateFinanceReadiness(p, pCast, pPartners, pScripts, pFinance, pHods, hasIncentive);
        scores[p.id] = { readiness: r.score, financeReadiness: fr.score };
      }
      return scores;
    },
    enabled: projects.length > 0,
    staleTime: 60_000,
  });
}

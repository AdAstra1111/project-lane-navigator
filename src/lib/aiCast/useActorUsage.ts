/**
 * useActorUsage — Query hook for AI actor project usage derived from project_ai_cast.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ActorUsageEntry {
  actorId: string;
  projectId: string;
  projectTitle: string;
  characterKey: string;
}

/**
 * Fetch all project_ai_cast rows for the current user's actors,
 * joined with project titles.
 */
export function useActorUsage() {
  return useQuery({
    queryKey: ['actor-usage'],
    queryFn: async () => {
      // Get all cast mappings — we'll join project titles client-side
      const { data: castRows, error: castErr } = await (supabase as any)
        .from('project_ai_cast')
        .select('ai_actor_id, project_id, character_key');

      if (castErr) throw castErr;
      if (!castRows || castRows.length === 0) return [] as ActorUsageEntry[];

      // Get unique project IDs and fetch titles
      const projectIds = [...new Set((castRows as any[]).map(r => r.project_id))] as string[];
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title')
        .in('id', projectIds);

      const titleMap = new Map<string, string>();
      for (const p of projects || []) {
        titleMap.set(p.id, p.title || 'Untitled');
      }

      return (castRows as any[]).map(r => ({
        actorId: r.ai_actor_id,
        projectId: r.project_id,
        projectTitle: titleMap.get(r.project_id) || 'Unknown Project',
        characterKey: r.character_key,
      })) as ActorUsageEntry[];
    },
  });
}

/**
 * Derive a usage count map: actorId → number of projects.
 */
export function getActorUsageCounts(usageEntries: ActorUsageEntry[]): Map<string, number> {
  const map = new Map<string, Set<string>>();
  for (const e of usageEntries) {
    if (!map.has(e.actorId)) map.set(e.actorId, new Set());
    map.get(e.actorId)!.add(e.projectId);
  }
  const counts = new Map<string, number>();
  for (const [actorId, projects] of map) {
    counts.set(actorId, projects.size);
  }
  return counts;
}

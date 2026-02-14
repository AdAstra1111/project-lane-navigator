import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity, Users, DollarSign, Handshake, FileText, Package,
  MessageSquare, Film, Briefcase, ScrollText, Clock, ChevronDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface ActivityEntry {
  id: string;
  project_id: string;
  user_id: string;
  action: string;
  section: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const SECTION_ICONS: Record<string, React.ElementType> = {
  project_cast: Users,
  project_deals: Handshake,
  project_budgets: DollarSign,
  project_contracts: FileText,
  project_deliverables: Package,
  project_hods: Briefcase,
  project_partners: Users,
  project_documents: ScrollText,
  project_comments: MessageSquare,
  project_scripts: Film,
};

const SECTION_LABELS: Record<string, string> = {
  project_cast: 'Cast',
  project_deals: 'Deals',
  project_budgets: 'Budgets',
  project_contracts: 'Contracts',
  project_deliverables: 'Deliverables',
  project_hods: 'HODs',
  project_partners: 'Partners',
  project_documents: 'Documents',
  project_comments: 'Comments',
  project_scripts: 'Scripts',
};

const ACTION_VERBS: Record<string, Record<string, string>> = {
  project_documents: { create: 'uploaded a document', update: 'updated a document', delete: 'removed a document' },
  project_cast: { create: 'added cast', update: 'updated cast', delete: 'removed cast' },
  project_deals: { create: 'logged a deal', update: 'updated a deal', delete: 'removed a deal' },
  project_budgets: { create: 'added a budget', update: 'updated budget', delete: 'removed a budget' },
  project_contracts: { create: 'added a contract', update: 'updated a contract', delete: 'removed a contract' },
  project_deliverables: { create: 'added a deliverable', update: 'updated a deliverable', delete: 'removed a deliverable' },
  project_hods: { create: 'added an HOD', update: 'updated an HOD', delete: 'removed an HOD' },
  project_partners: { create: 'added a partner', update: 'updated a partner', delete: 'removed a partner' },
  project_comments: { create: 'left a comment', update: 'edited a comment', delete: 'deleted a comment' },
  project_scripts: { create: 'added a script', update: 'updated a script', delete: 'removed a script' },
};

const ACTION_COLORS: Record<string, string> = {
  create: 'text-emerald-400',
  update: 'text-sky-400',
  delete: 'text-red-400',
};

const INITIAL_VISIBLE = 8;

function humanSummary(entry: ActivityEntry): string {
  const sectionVerbs = ACTION_VERBS[entry.section];
  if (sectionVerbs?.[entry.action]) return sectionVerbs[entry.action];
  // Fallback: clean up the raw summary
  const label = SECTION_LABELS[entry.section] || entry.section.replace(/_/g, ' ');
  const verb = entry.action === 'create' ? 'added' : entry.action === 'delete' ? 'removed' : 'updated';
  return `${verb} ${label.toLowerCase()}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Deduplicate consecutive identical actions (e.g. 10x "uploaded a document" in a row) */
function deduplicateEntries(entries: ActivityEntry[]): (ActivityEntry & { count: number })[] {
  const result: (ActivityEntry & { count: number })[] = [];
  for (const entry of entries) {
    const prev = result[result.length - 1];
    if (prev && prev.user_id === entry.user_id && prev.section === entry.section && prev.action === entry.action) {
      prev.count += 1;
    } else {
      result.push({ ...entry, count: 1 });
    }
  }
  return result;
}

interface Props {
  projectId: string;
}

export function ProjectActivityFeed({ projectId }: Props) {
  const queryClient = useQueryClient();
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['project-activity', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_activity_log')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as ActivityEntry[];
    },
  });

  const { data: profileMap = {} } = useQuery({
    queryKey: ['activity-profiles', projectId],
    queryFn: async () => {
      const userIds = [...new Set(activities.map(a => a.user_id))];
      if (!userIds.length) return {};
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const map: Record<string, string> = {};
      (data || []).forEach(p => { map[p.user_id] = p.display_name || 'User'; });
      return map;
    },
    enabled: activities.length > 0,
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`activity-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_activity_log', filter: `project_id=eq.${projectId}` },
        () => queryClient.invalidateQueries({ queryKey: ['project-activity', projectId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, queryClient]);

  const sections = useMemo(() => {
    const set = new Set(activities.map(a => a.section));
    return Array.from(set);
  }, [activities]);

  const filtered = useMemo(() => {
    if (sectionFilter === 'all') return activities;
    return activities.filter(a => a.section === sectionFilter);
  }, [activities, sectionFilter]);

  const deduplicated = useMemo(() => deduplicateEntries(filtered), [filtered]);
  const visible = showAll ? deduplicated : deduplicated.slice(0, INITIAL_VISIBLE);
  const hasMore = deduplicated.length > INITIAL_VISIBLE;

  if (isLoading) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        <Clock className="h-4 w-4 mx-auto mb-1.5 animate-pulse" />
        Loading activity…
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-semibold text-foreground text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Activity
        </h4>
        {sections.length > 1 && (
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="w-28 h-7 text-[10px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {sections.map(s => (
                <SelectItem key={s} value={s}>{SECTION_LABELS[s] || s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center py-4 text-xs text-muted-foreground">
          No activity yet. Changes will appear here.
        </p>
      ) : (
        <div className="space-y-0.5">
          {visible.map((entry, i) => {
            const Icon = SECTION_ICONS[entry.section] || Activity;
            const userName = profileMap[entry.user_id] || 'Unknown';
            const summary = humanSummary(entry);
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.015 }}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', ACTION_COLORS[entry.action] || 'text-muted-foreground')} />
                <p className="flex-1 min-w-0 text-xs text-foreground truncate">
                  <span className="font-medium">{userName}</span>
                  <span className="text-muted-foreground"> {summary}</span>
                  {entry.count > 1 && (
                    <span className="text-muted-foreground/70"> ×{entry.count}</span>
                  )}
                </p>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">{timeAgo(entry.created_at)}</span>
              </motion.div>
            );
          })}
        </div>
      )}

      {hasMore && !showAll && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-[10px] text-muted-foreground h-7 gap-1"
          onClick={() => setShowAll(true)}
        >
          <ChevronDown className="h-3 w-3" />
          Show {deduplicated.length - INITIAL_VISIBLE} more
        </Button>
      )}
      {showAll && hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-[10px] text-muted-foreground h-7"
          onClick={() => setShowAll(false)}
        >
          Show less
        </Button>
      )}
    </div>
  );
}

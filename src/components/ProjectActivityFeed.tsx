import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity, Users, DollarSign, Handshake, FileText, Package,
  MessageSquare, Film, Briefcase, ScrollText, Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

const ACTION_COLORS: Record<string, string> = {
  create: 'text-emerald-400',
  update: 'text-sky-400',
  delete: 'text-red-400',
};

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

interface Props {
  projectId: string;
}

export function ProjectActivityFeed({ projectId }: Props) {
  const queryClient = useQueryClient();
  const [sectionFilter, setSectionFilter] = useState<string>('all');

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

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, ActivityEntry[]> = {};
    for (const a of filtered) {
      const d = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (!groups[d]) groups[d] = [];
      groups[d].push(a);
    }
    return groups;
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <Clock className="h-5 w-5 mx-auto mb-2 animate-pulse" />
        Loading activity…
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-display font-semibold text-foreground text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Activity Feed
        </h4>
        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="All sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {sections.map(s => (
              <SelectItem key={s} value={s}>{SECTION_LABELS[s] || s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No activity recorded yet. Changes to cast, deals, budgets, and more will appear here.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{date}</p>
              <div className="space-y-1">
                {entries.map((entry, i) => {
                  const Icon = SECTION_ICONS[entry.section] || Activity;
                  const userName = profileMap[entry.user_id] || 'Unknown';
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', ACTION_COLORS[entry.action] || 'text-muted-foreground')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{userName}</span>
                          <span className="text-muted-foreground"> · {entry.summary}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">{timeAgo(entry.created_at)}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {SECTION_LABELS[entry.section] || entry.section}
                      </Badge>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

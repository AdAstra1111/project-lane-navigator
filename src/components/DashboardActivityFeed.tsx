import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ActivityEntry {
  id: string;
  project_id: string;
  action: string;
  section: string;
  entity_type: string;
  summary: string;
  created_at: string;
  project_title?: string;
}

export function DashboardActivityFeed() {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['dashboard-activity-feed'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_activity_log')
        .select('id, project_id, action, section, entity_type, summary, created_at')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;

      // Fetch project titles
      const projectIds = [...new Set((data || []).map(d => d.project_id))];
      if (projectIds.length === 0) return [];

      const { data: projects } = await supabase
        .from('projects')
        .select('id, title')
        .in('id', projectIds);

      const titleMap = new Map((projects || []).map(p => [p.id, p.title]));

      return (data || []).map(d => ({
        ...d,
        project_title: titleMap.get(d.project_id) || 'Unknown',
      })) as ActivityEntry[];
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Recent Activity</h3>
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="h-2 w-2 rounded-full bg-muted mt-2" />
              <div className="flex-1">
                <div className="h-3 w-48 bg-muted rounded mb-1" />
                <div className="h-2 w-24 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activities.length === 0) return null;

  const actionLabel = (action: string) => {
    switch (action) {
      case 'create': return 'Added';
      case 'update': return 'Updated';
      case 'delete': return 'Removed';
      default: return action;
    }
  };

  const sectionLabel = (section: string) => {
    return section.replace('project_', '').replace(/_/g, ' ');
  };

  return (
    <div className="glass-card rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-sm">Recent Activity</h3>
      </div>
      <div className="space-y-3">
        {activities.map(a => (
          <div key={a.id} className="flex gap-3 items-start">
            <div className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">
                {actionLabel(a.action)}{' '}
                <span className="text-muted-foreground">{sectionLabel(a.section)}</span>
                {' on '}
                <Link to={`/projects/${a.project_id}`} className="text-primary hover:underline">
                  {a.project_title}
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

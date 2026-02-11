import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bell, Check, Trash2, MessageSquare, TrendingUp, Landmark, Info,
  AlertTriangle, FileText, Handshake, Clock, Filter, CheckCheck,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNotifications, type Notification } from '@/hooks/useNotifications';
import { useProjects } from '@/hooks/useProjects';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';

/* ── icon map ── */
const TYPE_ICONS: Record<string, React.ElementType> = {
  comment: MessageSquare,
  trend_match: TrendingUp,
  incentive_update: Landmark,
  milestone: TrendingUp,
  'deal-milestone': Handshake,
  system: Info,
  info: Info,
  'contract-expiry': FileText,
  'deadline-approaching': Clock,
  'market-window': AlertTriangle,
};

const TYPE_LABELS: Record<string, string> = {
  comment: 'Comments',
  trend_match: 'Trend Matches',
  incentive_update: 'Incentives',
  milestone: 'Milestones',
  'deal-milestone': 'Deals',
  system: 'System',
  info: 'Info',
  'contract-expiry': 'Contract Expiry',
  'deadline-approaching': 'Deadlines',
  'market-window': 'Market Windows',
};

const TYPE_COLORS: Record<string, string> = {
  comment: 'text-blue-400',
  trend_match: 'text-emerald-400',
  incentive_update: 'text-amber-400',
  milestone: 'text-emerald-400',
  'deal-milestone': 'text-violet-400',
  system: 'text-muted-foreground',
  info: 'text-muted-foreground',
  'contract-expiry': 'text-red-400',
  'deadline-approaching': 'text-amber-400',
  'market-window': 'text-sky-400',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ── Smart alerts from live data ── */
interface SmartAlert {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  urgency: 'high' | 'medium' | 'low';
  projectTitle?: string;
}

function useSmartAlerts(): SmartAlert[] {
  const { user } = useAuth();

  const { data: contracts = [] } = useQuery({
    queryKey: ['smart-alerts-contracts', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_contracts')
        .select('id, title, status, expires_at, project_id')
        .in('status', ['executed', 'under-review', 'negotiating']);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: deliverables = [] } = useQuery({
    queryKey: ['smart-alerts-deliverables', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_deliverables')
        .select('id, item_name, due_date, status, project_id, buyer_name')
        .in('status', ['pending', 'in-progress']);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: projectMap = {} } = useQuery({
    queryKey: ['smart-alerts-projects', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, title');
      const map: Record<string, string> = {};
      (data || []).forEach(p => { map[p.id] = p.title; });
      return map;
    },
    enabled: !!user,
  });

  return useMemo(() => {
    const alerts: SmartAlert[] = [];
    const now = Date.now();

    // Contract expiry alerts
    for (const c of contracts) {
      if (!c.expires_at) continue;
      const days = Math.ceil((new Date(c.expires_at).getTime() - now) / (1000 * 60 * 60 * 24));
      if (days > 90) continue;
      const urgency = days <= 0 ? 'high' : days <= 30 ? 'high' : 'medium';
      const label = days <= 0 ? 'Expired' : `${days} days until expiry`;
      alerts.push({
        id: `contract-${c.id}`,
        type: 'contract-expiry',
        title: `${c.title || 'Contract'} — ${label}`,
        body: `Status: ${c.status}. Review or renew before it lapses.`,
        link: `/projects/${c.project_id}`,
        urgency,
        projectTitle: projectMap[c.project_id],
      });
    }

    // Deliverable deadline alerts
    for (const d of deliverables) {
      if (!d.due_date) continue;
      const days = Math.ceil((new Date(d.due_date).getTime() - now) / (1000 * 60 * 60 * 24));
      if (days > 14) continue;
      const urgency = days <= 0 ? 'high' : days <= 3 ? 'high' : 'medium';
      const label = days <= 0 ? 'Overdue' : `${days} days left`;
      alerts.push({
        id: `deliverable-${d.id}`,
        type: 'deadline-approaching',
        title: `${d.item_name || 'Deliverable'} — ${label}`,
        body: `${d.buyer_name ? `For ${d.buyer_name}. ` : ''}Currently ${d.status}.`,
        link: `/projects/${d.project_id}`,
        urgency,
        projectTitle: projectMap[d.project_id],
      });
    }

    return alerts.sort((a, b) => {
      const o = { high: 0, medium: 1, low: 2 };
      return o[a.urgency] - o[b.urgency];
    });
  }, [contracts, deliverables, projectMap]);
}

/* ── Page ── */
export default function Notifications() {
  const { notifications, unreadCount, markAsRead, markAllRead, clearAll } = useNotifications();
  const smartAlerts = useSmartAlerts();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [readFilter, setReadFilter] = useState<string>('all');

  const types = useMemo(() => {
    const set = new Set(notifications.map(n => n.type));
    return Array.from(set);
  }, [notifications]);

  const filtered = useMemo(() => {
    let list = notifications;
    if (typeFilter !== 'all') list = list.filter(n => n.type === typeFilter);
    if (readFilter === 'unread') list = list.filter(n => !n.read);
    if (readFilter === 'read') list = list.filter(n => n.read);
    return list;
  }, [notifications, typeFilter, readFilter]);

  const handleClick = (n: Notification) => {
    if (!n.read) markAsRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Notifications & Alerts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'} · {smartAlerts.length} smart alert{smartAlerts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
                <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => clearAll.mutate()}>
                <Trash2 className="h-4 w-4 mr-1" /> Clear all
              </Button>
            )}
          </div>
        </div>

        {/* Smart Alerts */}
        {smartAlerts.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Proactive Alerts
            </h2>
            <div className="space-y-2">
              {smartAlerts.map((a, i) => {
                const Icon = TYPE_ICONS[a.type] || AlertTriangle;
                return (
                  <motion.button
                    key={a.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => navigate(a.link)}
                    className={cn(
                      'w-full text-left p-4 rounded-xl border flex gap-3 transition-colors hover:bg-muted/50',
                      a.urgency === 'high' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', TYPE_COLORS[a.type])} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground">{a.title}</span>
                        {a.urgency === 'high' && (
                          <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">Urgent</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{a.body}</p>
                      {a.projectTitle && (
                        <p className="text-[10px] text-muted-foreground mt-1">{a.projectTitle}</p>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => (
                <SelectItem key={t} value={t}>{TYPE_LABELS[t] || t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Notification list */}
        <div className="rounded-xl border border-border overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {notifications.length === 0 ? 'No notifications yet' : 'No notifications match your filters'}
              </p>
            </div>
          ) : (
            filtered.map((n, i) => {
              const Icon = TYPE_ICONS[n.type] || Info;
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'w-full text-left px-5 py-4 flex gap-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0',
                    !n.read && 'bg-primary/5'
                  )}
                >
                  <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', !n.read ? TYPE_COLORS[n.type] || 'text-primary' : 'text-muted-foreground')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm leading-tight', !n.read ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                        {n.title}
                      </p>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {TYPE_LABELS[n.type] || n.type}
                      </Badge>
                    </div>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </motion.button>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

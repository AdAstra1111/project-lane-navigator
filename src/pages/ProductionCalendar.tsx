import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Film, Clock, MapPin, DollarSign, Package, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';
import { useShootDays } from '@/hooks/useProductionSchedule';
import { useProjectDeals } from '@/hooks/useDeals';
import { useProjectDeliverables } from '@/hooks/useDeliverables';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isToday, isSameMonth, isSameDay } from 'date-fns';

// ---- Festival data (reused from FestivalCalendar) ----
const FESTIVALS = [
  { name: 'Sundance', date: new Date('2026-01-16'), deadline: new Date('2025-09-12'), type: 'premiere' as const },
  { name: 'Berlin / EFM', date: new Date('2026-02-12'), deadline: new Date('2025-10-06'), type: 'hybrid' as const },
  { name: 'SXSW', date: new Date('2026-03-07'), deadline: new Date('2025-10-20'), type: 'premiere' as const },
  { name: 'Cannes / Marché', date: new Date('2026-05-12'), deadline: new Date('2026-03-15'), type: 'hybrid' as const },
  { name: 'Tribeca', date: new Date('2026-06-04'), deadline: new Date('2026-01-09'), type: 'premiere' as const },
  { name: 'Venice', date: new Date('2026-08-27'), deadline: new Date('2026-06-15'), type: 'premiere' as const },
  { name: 'TIFF', date: new Date('2026-09-10'), deadline: new Date('2026-06-01'), type: 'hybrid' as const },
  { name: 'AFM', date: new Date('2026-11-03'), deadline: new Date('2026-09-15'), type: 'market' as const },
  { name: 'MIPCOM', date: new Date('2026-10-19'), deadline: new Date('2026-08-15'), type: 'market' as const },
];

// ---- Event types ----
interface CalendarEvent {
  id: string;
  date: Date;
  label: string;
  sublabel?: string;
  type: 'shoot' | 'festival' | 'deadline' | 'deal' | 'deliverable';
  projectId?: string;
  projectTitle?: string;
}

const EVENT_STYLES: Record<string, { dot: string; badge: string; icon: React.ElementType }> = {
  shoot: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: Film },
  festival: { dot: 'bg-primary', badge: 'bg-primary/15 text-primary border-primary/30', icon: Calendar },
  deadline: { dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: AlertTriangle },
  deal: { dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-400 border-violet-500/30', icon: DollarSign },
  deliverable: { dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30', icon: Package },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---- Multi-project data aggregator hook ----
function useCalendarEvents(projectFilter: string) {
  const { projects } = useProjects();
  const filteredProjects = projectFilter === 'all' ? projects : projects.filter(p => p.id === projectFilter);

  // We fetch shoot days / deals / deliverables for all projects by fetching per-project
  // For simplicity we'll aggregate across all visible projects
  const allEvents = useMemo(() => {
    const events: CalendarEvent[] = [];

    // Festival events (global)
    for (const f of FESTIVALS) {
      events.push({ id: `fest-${f.name}`, date: f.date, label: f.name, sublabel: f.type, type: 'festival' });
      events.push({ id: `deadline-${f.name}`, date: f.deadline, label: `${f.name} deadline`, type: 'deadline' });
    }

    return events;
  }, []);

  return { events: allEvents, projects: filteredProjects, allProjects: projects };
}

// ---- Per-project events component using hooks ----
function ProjectEvents({ projectId, projectTitle, onEvents }: { projectId: string; projectTitle: string; onEvents: (events: CalendarEvent[]) => void }) {
  const { shootDays } = useShootDays(projectId);
  const { deals } = useProjectDeals(projectId);
  const { deliverables } = useProjectDeliverables(projectId);

  useMemo(() => {
    const events: CalendarEvent[] = [];

    for (const sd of shootDays) {
      events.push({
        id: `shoot-${sd.id}`,
        date: new Date(sd.shoot_date + 'T00:00:00'),
        label: `Day ${sd.day_number}`,
        sublabel: sd.unit,
        type: 'shoot',
        projectId,
        projectTitle,
      });
    }

    for (const d of deals) {
      if (d.offered_at) {
        events.push({
          id: `deal-offered-${d.id}`,
          date: new Date(d.offered_at),
          label: `${d.buyer_name || d.territory || 'Deal'} offered`,
          sublabel: d.minimum_guarantee ? `$${d.minimum_guarantee}` : undefined,
          type: 'deal',
          projectId,
          projectTitle,
        });
      }
      if (d.closed_at) {
        events.push({
          id: `deal-closed-${d.id}`,
          date: new Date(d.closed_at),
          label: `${d.buyer_name || d.territory || 'Deal'} closed`,
          sublabel: d.minimum_guarantee ? `$${d.minimum_guarantee}` : undefined,
          type: 'deal',
          projectId,
          projectTitle,
        });
      }
    }

    for (const del of deliverables) {
      if (del.due_date) {
        events.push({
          id: `del-${del.id}`,
          date: new Date(del.due_date),
          label: del.item_name || del.deliverable_type,
          sublabel: del.buyer_name || del.territory || undefined,
          type: 'deliverable',
          projectId,
          projectTitle,
        });
      }
    }

    onEvents(events);
  }, [shootDays, deals, deliverables, projectId, projectTitle, onEvents]);

  return null;
}

export default function ProductionCalendar() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [projectFilter, setProjectFilter] = useState('all');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const { events: globalEvents, allProjects } = useCalendarEvents(projectFilter);
  const [projectEventsMap, setProjectEventsMap] = useState<Record<string, CalendarEvent[]>>({});

  const handleProjectEvents = useMemo(() => {
    const handlers: Record<string, (events: CalendarEvent[]) => void> = {};
    for (const p of allProjects) {
      handlers[p.id] = (events: CalendarEvent[]) => {
        setProjectEventsMap(prev => {
          if (JSON.stringify(prev[p.id]) === JSON.stringify(events)) return prev;
          return { ...prev, [p.id]: events };
        });
      };
    }
    return handlers;
  }, [allProjects]);

  const visibleProjects = projectFilter === 'all' ? allProjects : allProjects.filter(p => p.id === projectFilter);

  const allEvents = useMemo(() => {
    let events = [...globalEvents];
    for (const p of visibleProjects) {
      events = events.concat(projectEventsMap[p.id] || []);
    }
    if (typeFilter !== 'all') {
      events = events.filter(e => e.type === typeFilter);
    }
    return events;
  }, [globalEvents, visibleProjects, projectEventsMap, typeFilter]);

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad to start on Monday
  const startDay = getDay(monthStart); // 0=Sun, 1=Mon...
  const paddingBefore = startDay === 0 ? 6 : startDay - 1;

  const eventsForDay = (day: Date) => allEvents.filter(e => isSameDay(e.date, day));

  const selectedDayEvents = selectedDate ? eventsForDay(selectedDate) : [];

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return allEvents
      .filter(e => e.date >= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);
  }, [allEvents]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {/* Render project event fetchers */}
      {visibleProjects.map(p => (
        <ProjectEvents key={p.id} projectId={p.id} projectTitle={p.title} onEvents={handleProjectEvents[p.id] || (() => {})} />
      ))}
      <main className="container max-w-5xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Production</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Production Calendar</h1>
            <p className="text-muted-foreground mt-1">Shoot days, festivals, deal milestones, and deliverable deadlines in one view.</p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-48 h-9 text-sm">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {allProjects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="shoot">Shoot Days</SelectItem>
                <SelectItem value="festival">Festivals</SelectItem>
                <SelectItem value="deadline">Deadlines</SelectItem>
                <SelectItem value="deal">Deals</SelectItem>
                <SelectItem value="deliverable">Deliverables</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
            {Object.entries(EVENT_STYLES).map(([key, style]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className={cn('h-2.5 w-2.5 rounded-full', style.dot)} />
                <span className="capitalize">{key === 'deliverable' ? 'Deliverables' : key === 'shoot' ? 'Shoot Days' : key + 's'}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
            {/* Calendar grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-display font-semibold text-foreground">
                  {format(currentMonth, 'MMMM yyyy')}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-px bg-border/30 rounded-lg overflow-hidden">
                {WEEKDAYS.map(d => (
                  <div key={d} className="bg-muted/30 text-center text-[10px] font-medium text-muted-foreground py-2">{d}</div>
                ))}
                {Array.from({ length: paddingBefore }).map((_, i) => (
                  <div key={`pad-${i}`} className="bg-background/50 min-h-[80px]" />
                ))}
                {days.map(day => {
                  const dayEvents = eventsForDay(day);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(isSelected ? null : day)}
                      className={cn(
                        'min-h-[80px] p-1.5 text-left transition-colors relative',
                        'bg-background/50 hover:bg-muted/30',
                        isToday(day) && 'ring-1 ring-primary/40',
                        isSelected && 'bg-primary/10 ring-1 ring-primary/60',
                      )}
                    >
                      <span className={cn(
                        'text-xs font-medium',
                        isToday(day) ? 'text-primary' : 'text-foreground',
                      )}>
                        {format(day, 'd')}
                      </span>
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {dayEvents.slice(0, 3).map(e => (
                          <div key={e.id} className={cn('h-1.5 w-1.5 rounded-full', EVENT_STYLES[e.type]?.dot)} title={e.label} />
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[8px] text-muted-foreground">+{dayEvents.length - 3}</span>
                        )}
                      </div>
                      {dayEvents.length > 0 && dayEvents.length <= 2 && (
                        <div className="mt-0.5 space-y-0.5">
                          {dayEvents.slice(0, 2).map(e => (
                            <p key={e.id} className="text-[9px] text-muted-foreground truncate leading-tight">{e.label}</p>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Selected day detail */}
              {selectedDate && (
                <div className="glass-card rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h3>
                  {selectedDayEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No events on this day.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedDayEvents.map(e => {
                        const style = EVENT_STYLES[e.type];
                        const Icon = style.icon;
                        return (
                          <div
                            key={e.id}
                            className={cn(
                              'flex items-start gap-2 rounded-lg px-3 py-2 border',
                              style.badge,
                              e.projectId && 'cursor-pointer hover:opacity-80',
                            )}
                            onClick={() => e.projectId && navigate(`/projects/${e.projectId}`)}
                          >
                            <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{e.label}</p>
                              {e.sublabel && <p className="text-[10px] opacity-80">{e.sublabel}</p>}
                              {e.projectTitle && <p className="text-[10px] opacity-60">{e.projectTitle}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Upcoming */}
              <div className="glass-card rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" /> Upcoming
                </h3>
                {upcomingEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No upcoming events.</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingEvents.map(e => {
                      const style = EVENT_STYLES[e.type];
                      const Icon = style.icon;
                      const daysUntil = Math.ceil((e.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      return (
                        <div
                          key={e.id}
                          className={cn(
                            'flex items-center gap-2 text-xs',
                            e.projectId && 'cursor-pointer hover:opacity-80',
                          )}
                          onClick={() => e.projectId && navigate(`/projects/${e.projectId}`)}
                        >
                          <div className={cn('h-2 w-2 rounded-full shrink-0', style.dot)} />
                          <span className="text-foreground truncate flex-1">{e.label}</span>
                          {e.projectTitle && <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{e.projectTitle}</span>}
                          <span className={cn(
                            'text-[10px] shrink-0',
                            daysUntil <= 7 ? 'text-amber-400' : 'text-muted-foreground',
                          )}>
                            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

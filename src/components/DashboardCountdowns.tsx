import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, AlertTriangle, ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { differenceInDays, format, isPast } from 'date-fns';
import { useAllDeadlines, ProjectDeadline } from '@/hooks/useDeadlines';
import { exportAllDeadlinesToICS } from '@/lib/ics-export';

interface DeadlineWithProject extends ProjectDeadline {
  project_title?: string;
}

export function DashboardCountdowns({ projectTitleMap }: { projectTitleMap: Record<string, string> }) {
  const { data: deadlines = [] } = useAllDeadlines();

  const urgent = useMemo(() => {
    return deadlines
      .filter(d => {
        const days = differenceInDays(new Date(d.due_date), new Date());
        return days <= 30; // Show deadlines within 30 days
      })
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .slice(0, 5)
      .map(d => ({
        ...d,
        project_title: projectTitleMap[d.project_id] || 'Unknown Project',
      }));
  }, [deadlines, projectTitleMap]);

  if (urgent.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-6"
    >
      <div className="glass-card rounded-xl p-5 border-l-4 border-amber-500/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <h3 className="font-display font-semibold text-foreground text-sm">Upcoming Deadlines</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => exportAllDeadlinesToICS(urgent.map(d => ({ label: d.label, due_date: d.due_date, notes: d.notes, project_title: d.project_title })))}
            title="Export all to calendar (.ics)"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export to Calendar
          </Button>
        </div>
        <div className="space-y-2">
          {urgent.map(d => {
            const days = differenceInDays(new Date(d.due_date), new Date());
            const overdue = isPast(new Date(d.due_date));
            return (
              <Link
                key={d.id}
                to={`/projects/${d.project_id}`}
                className={`flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg group transition-colors ${
                  overdue ? 'bg-destructive/5' : 'hover:bg-muted/20'
                }`}
              >
                {overdue && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {d.label}
                    <span className="text-muted-foreground ml-1.5">— {d.project_title}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(d.due_date), 'MMM d, yyyy')}
                  </p>
                </div>
                <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                  overdue ? 'text-destructive' :
                  days <= 7 ? 'text-amber-400' :
                  'text-muted-foreground'
                }`}>
                  {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

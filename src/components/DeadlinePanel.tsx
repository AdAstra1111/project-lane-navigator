import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Clock, Check, Trash2, CalendarIcon } from 'lucide-react';
import { format, differenceInDays, isPast } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useDeadlines } from '@/hooks/useDeadlines';

const DEADLINE_TYPES = [
  { value: 'market-submission', label: 'Market Submission' },
  { value: 'festival-deadline', label: 'Festival Deadline' },
  { value: 'option-expiry', label: 'Option Expiry' },
  { value: 'financing-close', label: 'Financing Close' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'legal', label: 'Legal / Contractual' },
  { value: 'custom', label: 'Custom' },
];

function urgencyLabel(dueDate: string) {
  const days = differenceInDays(new Date(dueDate), new Date());
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, className: 'text-destructive font-semibold' };
  if (days === 0) return { text: 'Today', className: 'text-destructive font-semibold' };
  if (days <= 7) return { text: `${days}d`, className: 'text-amber-400 font-semibold' };
  if (days <= 30) return { text: `${days}d`, className: 'text-foreground' };
  return { text: `${days}d`, className: 'text-muted-foreground' };
}

export function DeadlinePanel({ projectId }: { projectId: string }) {
  const { deadlines, isLoading, addDeadline, toggleComplete, deleteDeadline } = useDeadlines(projectId);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('custom');
  const [date, setDate] = useState<Date>();

  const handleAdd = () => {
    if (!label.trim() || !date) return;
    addDeadline.mutate({
      project_id: projectId,
      label: label.trim(),
      due_date: date.toISOString(),
      deadline_type: type,
    });
    setLabel('');
    setType('custom');
    setDate(undefined);
    setShowForm(false);
  };

  const active = deadlines.filter(d => !d.completed);
  const completed = deadlines.filter(d => d.completed);

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Deadlines</h3>
          {active.length > 0 && (
            <span className="text-xs text-muted-foreground">({active.length})</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 space-y-2 overflow-hidden"
          >
            <Input
              placeholder="e.g. Cannes Marché submission"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
            <div className="flex gap-2">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEADLINE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('flex-1 justify-start text-left font-normal', !date && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!label.trim() || !date || addDeadline.isPending}>
                Add Deadline
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-8 bg-muted/50 rounded animate-pulse" />
          ))}
        </div>
      ) : active.length === 0 && completed.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No deadlines set. Add key dates to track market windows and contract expiries.
        </p>
      ) : (
        <div className="space-y-1.5">
          {active.map(d => {
            const urgency = urgencyLabel(d.due_date);
            const overdue = isPast(new Date(d.due_date));
            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex items-center gap-3 py-2 px-2 rounded-lg group transition-colors ${
                  overdue ? 'bg-destructive/5' : 'hover:bg-muted/30'
                }`}
              >
                <button
                  onClick={() => toggleComplete.mutate({ id: d.id, completed: true })}
                  className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 hover:border-primary shrink-0 transition-colors"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{d.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(d.due_date), 'MMM d, yyyy')}
                    {d.deadline_type !== 'custom' && (
                      <span className="ml-1.5">· {DEADLINE_TYPES.find(t => t.value === d.deadline_type)?.label}</span>
                    )}
                  </p>
                </div>
                <span className={cn('text-xs tabular-nums shrink-0', urgency.className)}>
                  {urgency.text}
                </span>
                <button
                  onClick={() => deleteDeadline.mutate(d.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </motion.div>
            );
          })}

          {completed.length > 0 && (
            <div className="pt-2 border-t border-border/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Completed</p>
              {completed.slice(0, 3).map(d => (
                <div key={d.id} className="flex items-center gap-3 py-1.5 px-2 group">
                  <button
                    onClick={() => toggleComplete.mutate({ id: d.id, completed: false })}
                    className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0"
                  >
                    <Check className="h-2.5 w-2.5 text-primary" />
                  </button>
                  <span className="text-sm text-muted-foreground line-through truncate flex-1">{d.label}</span>
                  <button
                    onClick={() => deleteDeadline.mutate(d.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

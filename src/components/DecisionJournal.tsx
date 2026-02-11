import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, BookOpen, Trash2, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useDecisions, type ProjectDecision } from '@/hooks/useDecisions';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const DECISION_TYPES = [
  { value: 'strategic', label: 'Strategic' },
  { value: 'creative', label: 'Creative' },
  { value: 'financial', label: 'Financial' },
  { value: 'legal', label: 'Legal' },
  { value: 'packaging', label: 'Packaging' },
];

interface DecisionJournalProps {
  projectId: string;
}

export function DecisionJournal({ projectId }: DecisionJournalProps) {
  const { decisions, isLoading, addDecision, updateDecision, deleteDecision } = useDecisions(projectId);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    context: '',
    decision: '',
    reasoning: '',
    decision_type: 'strategic',
  });

  const handleSubmit = () => {
    if (!form.title.trim() || !form.decision.trim()) return;
    addDecision.mutate(form);
    setForm({ title: '', context: '', decision: '', reasoning: '', decision_type: 'strategic' });
    setShowForm(false);
  };

  const toggleOutcome = (d: ProjectDecision) => {
    updateDecision.mutate({
      id: d.id,
      status: d.status === 'active' ? 'resolved' : 'active',
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Decision Journal</h4>
          {decisions.length > 0 && (
            <Badge variant="secondary" className="text-xs">{decisions.length}</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Log Decision
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-card rounded-lg p-4 space-y-3 overflow-hidden"
          >
            <div className="flex gap-3">
              <Input
                placeholder="Decision title..."
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="flex-1"
              />
              <Select value={form.decision_type} onValueChange={v => setForm(f => ({ ...f, decision_type: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="What's the context? What triggered this decision?"
              value={form.context}
              onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
              rows={2}
            />
            <Textarea
              placeholder="What was decided?"
              value={form.decision}
              onChange={e => setForm(f => ({ ...f, decision: e.target.value }))}
              rows={2}
            />
            <Textarea
              placeholder="Why? What's the reasoning?"
              value={form.reasoning}
              onChange={e => setForm(f => ({ ...f, reasoning: e.target.value }))}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSubmit} disabled={addDecision.isPending}>
                Log Decision
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="glass-card rounded-lg p-4 animate-pulse">
          <div className="h-4 w-40 bg-muted rounded" />
        </div>
      ) : decisions.length === 0 && !showForm ? (
        <div className="glass-card rounded-lg p-6 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No decisions logged yet. Track strategic choices to build institutional memory.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <motion.div
              key={d.id}
              layout
              className={cn(
                "glass-card rounded-lg overflow-hidden transition-colors",
                d.status === 'resolved' && "opacity-60"
              )}
            >
              <button
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
                onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
              >
                <button
                  className={cn(
                    "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    d.status === 'resolved'
                      ? "border-emerald-500 bg-emerald-500/20"
                      : "border-muted-foreground/30"
                  )}
                  onClick={(e) => { e.stopPropagation(); toggleOutcome(d); }}
                >
                  {d.status === 'resolved' && <Check className="h-3 w-3 text-emerald-400" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm truncate">{d.title}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{d.decision_type}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(d.decided_at), 'MMM d, yyyy')}
                  </span>
                </div>
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform",
                  expandedId === d.id && "rotate-180"
                )} />
              </button>

              <AnimatePresence>
                {expandedId === d.id && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                      {d.context && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Context</p>
                          <p className="text-sm text-foreground">{d.context}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Decision</p>
                        <p className="text-sm text-foreground">{d.decision}</p>
                      </div>
                      {d.reasoning && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Reasoning</p>
                          <p className="text-sm text-foreground">{d.reasoning}</p>
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteDecision.mutate(d.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

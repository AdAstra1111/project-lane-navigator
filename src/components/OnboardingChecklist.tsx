import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const CHECKLIST_DISMISSED_KEY = 'iffy-checklist-dismissed';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  link?: string;
  linkLabel?: string;
}

const items: ChecklistItem[] = [
  {
    id: 'project',
    label: 'Create your first project',
    description: 'Start a living dossier with title, genre, and territory.',
    link: '/projects/new',
    linkLabel: 'New Project',
  },
  {
    id: 'script',
    label: 'Attach a script',
    description: 'Upload a script to unlock coverage analysis and scene breakdowns.',
  },
  {
    id: 'cast',
    label: 'Add cast or packaging',
    description: 'Attach cast members or use Smart Packaging for AI recommendations.',
  },
  {
    id: 'finance',
    label: 'Set up finance',
    description: 'Add a budget, log deals, or explore incentive programmes.',
  },
  {
    id: 'collaborate',
    label: 'Invite a collaborator',
    description: 'Share your project with team members using role-based access.',
  },
];

interface Props {
  projectCount: number;
  hasScript?: boolean;
  hasCast?: boolean;
  hasFinance?: boolean;
  hasCollaborator?: boolean;
}

export function OnboardingChecklist({ projectCount, hasScript, hasCast, hasFinance, hasCollaborator }: Props) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(CHECKLIST_DISMISSED_KEY) === 'true');
  const [expanded, setExpanded] = useState(true);

  const completedMap: Record<string, boolean> = {
    project: projectCount > 0,
    script: !!hasScript,
    cast: !!hasCast,
    finance: !!hasFinance,
    collaborate: !!hasCollaborator,
  };

  const completedCount = Object.values(completedMap).filter(Boolean).length;
  const allDone = completedCount === items.length;

  useEffect(() => {
    if (allDone) {
      const t = setTimeout(() => {
        setDismissed(true);
        localStorage.setItem(CHECKLIST_DISMISSED_KEY, 'true');
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [allDone]);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(CHECKLIST_DISMISSED_KEY, 'true');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="glass-card rounded-xl border border-border/50 mb-6 overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold text-foreground">
              {allDone ? 'All set!' : 'Getting started'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {completedCount} of {items.length} complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Progress ring */}
          <svg className="h-7 w-7 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15" fill="none"
              className="stroke-primary transition-all duration-500"
              strokeWidth="3"
              strokeDasharray={`${(completedCount / items.length) * 94.2} 94.2`}
              strokeLinecap="round"
            />
          </svg>
          <button onClick={(e) => { e.stopPropagation(); handleDismiss(); }} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="h-3.5 w-3.5" />
          </button>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Items */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-1">
              {items.map((item) => {
                const done = completedMap[item.id];
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${done ? 'opacity-60' : 'hover:bg-muted/40'}`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                    {!done && item.link && (
                      <Link to={item.link}>
                        <Button variant="ghost" size="sm" className="text-xs h-7 px-2 shrink-0">
                          {item.linkLabel}
                        </Button>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

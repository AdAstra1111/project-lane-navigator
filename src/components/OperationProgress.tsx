import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';

interface Stage {
  at: number;
  label: string;
}

interface OperationProgressProps {
  isActive: boolean;
  stages?: Stage[];
  className?: string;
}

const DEFAULT_STAGES: Stage[] = [
  { at: 5, label: 'Starting…' },
  { at: 20, label: 'Processing…' },
  { at: 45, label: 'Analysing data…' },
  { at: 65, label: 'Generating results…' },
  { at: 85, label: 'Finishing up…' },
  { at: 95, label: 'Almost done…' },
];

export function OperationProgress({ isActive, stages = DEFAULT_STAGES, className }: OperationProgressProps) {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (isActive) {
      setProgress(0);
      setLabel(stages[0]?.label || 'Working…');
      let current = 0;
      timer.current = setInterval(() => {
        current += Math.random() * 3 + 0.5;
        if (current > 96) current = 96;
        setProgress(current);
        const stage = [...stages].reverse().find(s => current >= s.at);
        if (stage) setLabel(stage.label);
      }, 500);
    } else {
      if (timer.current) {
        setProgress(100);
        setLabel('Done!');
        setTimeout(stop, 400);
      }
    }
    return stop;
  }, [isActive, stages, stop]);

  return (
    <AnimatePresence>
      {(isActive || progress === 100) && progress > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className={className}
        >
          <div className="space-y-1.5">
            <Progress value={progress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground text-center">{label}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Pre-built stage configs for common operations
export const EXTRACT_STAGES: Stage[] = [
  { at: 5, label: 'Reading document…' },
  { at: 20, label: 'Parsing pages…' },
  { at: 50, label: 'Extracting text…' },
  { at: 75, label: 'Processing content…' },
  { at: 92, label: 'Finalising…' },
];

export const COVERAGE_STAGES: Stage[] = [
  { at: 5, label: 'Reading script…' },
  { at: 15, label: 'Analysing structure…' },
  { at: 30, label: 'Evaluating characters…' },
  { at: 50, label: 'Finding comparables…' },
  { at: 70, label: 'Assessing market fit…' },
  { at: 85, label: 'Writing coverage…' },
  { at: 95, label: 'Almost done…' },
];

export const COMP_STAGES: Stage[] = [
  { at: 5, label: 'Searching titles…' },
  { at: 25, label: 'Analysing box office…' },
  { at: 50, label: 'Comparing performance…' },
  { at: 75, label: 'Building insights…' },
  { at: 92, label: 'Finalising…' },
];

export const PACKAGING_STAGES: Stage[] = [
  { at: 5, label: 'Analysing project…' },
  { at: 20, label: 'Searching talent databases…' },
  { at: 45, label: 'Evaluating market fit…' },
  { at: 65, label: 'Assessing availability…' },
  { at: 85, label: 'Ranking suggestions…' },
  { at: 95, label: 'Almost done…' },
];

export const TREND_REFRESH_STAGES: Stage[] = [
  { at: 5, label: 'Scanning market signals…' },
  { at: 20, label: 'Analysing trends…' },
  { at: 45, label: 'Evaluating momentum…' },
  { at: 70, label: 'Scoring engines…' },
  { at: 90, label: 'Updating results…' },
];

export const AI_SCORE_STAGES: Stage[] = [
  { at: 5, label: 'Loading project data…' },
  { at: 25, label: 'Running AI analysis…' },
  { at: 55, label: 'Scoring trend engines…' },
  { at: 80, label: 'Saving scores…' },
  { at: 95, label: 'Finalising…' },
];

export const SEASON_ARC_STAGES: Stage[] = [
  { at: 5, label: 'Reading script…' },
  { at: 25, label: 'Mapping episode arcs…' },
  { at: 50, label: 'Evaluating hooks…' },
  { at: 75, label: 'Scoring cohesion…' },
  { at: 92, label: 'Finalising…' },
];

export const GENERATE_PITCH_STAGES: Stage[] = [
  { at: 5, label: 'Reading brief…' },
  { at: 15, label: 'Researching market…' },
  { at: 35, label: 'Generating concepts…' },
  { at: 55, label: 'Scoring viability…' },
  { at: 75, label: 'Ranking ideas…' },
  { at: 90, label: 'Saving results…' },
];

export const DEV_ANALYZE_STAGES: Stage[] = [
  { at: 5, label: 'Reading document…' },
  { at: 20, label: 'Evaluating script strength…' },
  { at: 45, label: 'Assessing finance readiness…' },
  { at: 65, label: 'Scoring convergence…' },
  { at: 85, label: 'Building insights…' },
  { at: 95, label: 'Almost done…' },
];

export const DEV_NOTES_STAGES: Stage[] = [
  { at: 5, label: 'Reading analysis…' },
  { at: 25, label: 'Identifying moves…' },
  { at: 50, label: 'Prioritising notes…' },
  { at: 75, label: 'Categorising actions…' },
  { at: 92, label: 'Finalising…' },
];

export const DEV_REWRITE_STAGES: Stage[] = [
  { at: 5, label: 'Loading approved notes…' },
  { at: 20, label: 'Protecting core elements…' },
  { at: 40, label: 'Rewriting content…' },
  { at: 65, label: 'Validating changes…' },
  { at: 85, label: 'Creating new version…' },
  { at: 95, label: 'Almost done…' },
];

export const DEV_CONVERT_STAGES: Stage[] = [
  { at: 5, label: 'Reading source document…' },
  { at: 20, label: 'Mapping structure…' },
  { at: 45, label: 'Converting format…' },
  { at: 70, label: 'Preserving creative DNA…' },
  { at: 90, label: 'Saving new document…' },
];

export const PROMOTE_STAGES: Stage[] = [
  { at: 5, label: 'Preparing project…' },
  { at: 25, label: 'Creating project record…' },
  { at: 50, label: 'Attaching documents…' },
  { at: 75, label: 'Setting up development…' },
  { at: 92, label: 'Finalising…' },
];

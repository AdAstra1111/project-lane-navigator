import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface ProcessStage {
  label: string;
  /** Estimated duration in seconds for this stage */
  durationSec: number;
}

interface ProcessStageProgressProps {
  /** Whether the process is currently running */
  isActive: boolean;
  /** Ordered list of stages with labels and estimated durations */
  stages: ProcessStage[];
  /** Optional className */
  className?: string;
}

export function ProcessStageProgress({ isActive, stages, className }: ProcessStageProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef<number>(0);
  const animFrame = useRef<number>(0);

  const totalDuration = stages.reduce((s, st) => s + st.durationSec, 0);

  useEffect(() => {
    if (isActive) {
      startTime.current = Date.now();
      setElapsed(0);
      const tick = () => {
        setElapsed((Date.now() - startTime.current) / 1000);
        animFrame.current = requestAnimationFrame(tick);
      };
      animFrame.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(animFrame.current);
    }
    return () => cancelAnimationFrame(animFrame.current);
  }, [isActive]);

  if (!isActive) return null;

  // Determine current stage based on elapsed time
  let accumulated = 0;
  let currentStageIndex = 0;
  let stageElapsed = elapsed;
  for (let i = 0; i < stages.length; i++) {
    if (elapsed < accumulated + stages[i].durationSec) {
      currentStageIndex = i;
      stageElapsed = elapsed - accumulated;
      break;
    }
    accumulated += stages[i].durationSec;
    if (i === stages.length - 1) {
      currentStageIndex = stages.length - 1;
      stageElapsed = elapsed - accumulated + stages[i].durationSec;
    }
  }

  // Smooth progress: ease-out curve that decelerates naturally
  // Uses 1 - e^(-kt) so it starts fast and gradually slows, never hitting 100%
  const ratio = elapsed / totalDuration;
  const percent = ratio < 1
    ? (1 - Math.exp(-2.5 * ratio)) * 90  // ease-out to ~90% over estimated duration
    : 90 + 7 * (1 - Math.exp(-0.03 * (elapsed - totalDuration)));  // slowly creep toward 97%

  const currentStage = stages[currentStageIndex];
  const remainingSec = Math.max(0, totalDuration - elapsed);

  function formatEta(sec: number): string {
    if (sec <= 0) return 'finishing…';
    const s = Math.round(sec);
    if (s < 60) return `~${s}s remaining`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `~${m}m ${rem}s remaining` : `~${m}m remaining`;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Bar */}
      <div className="w-full h-2 rounded-full overflow-hidden bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${Math.min(97, Math.max(1, percent))}%` }}
        />
      </div>

      {/* Stage info + ETA */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="font-medium text-foreground">{currentStage.label}</span>
          <span className="text-muted-foreground">
            ({currentStageIndex + 1}/{stages.length})
          </span>
        </div>
        <span className="text-muted-foreground tabular-nums">
          {formatEta(remainingSec)}
        </span>
      </div>
    </div>
  );
}

// ── Pre-built stage configs ──

export const UPLOAD_STAGES: ProcessStage[] = [
  { label: 'Uploading file…', durationSec: 10 },
  { label: 'Creating document record…', durationSec: 5 },
  { label: 'Extracting text from PDF…', durationSec: 60 },
  { label: 'Parsing scenes…', durationSec: 45 },
  { label: 'Finalising intake…', durationSec: 15 },
];

export const COVERAGE_STAGES: ProcessStage[] = [
  { label: 'Reading script text…', durationSec: 10 },
  { label: 'Analysing structure & characters…', durationSec: 45 },
  { label: 'Evaluating market positioning…', durationSec: 35 },
  { label: 'Scoring and writing coverage…', durationSec: 50 },
  { label: 'Building evidence map…', durationSec: 25 },
  { label: 'Finalising report…', durationSec: 15 },
];

export const SAVE_COVERAGE_STAGES: ProcessStage[] = [
  { label: 'Formatting coverage…', durationSec: 3 },
  { label: 'Saving to project…', durationSec: 8 },
  { label: 'Storing evidence data…', durationSec: 5 },
];

export const BACKFILL_STAGES: ProcessStage[] = [
  { label: 'Reading script context…', durationSec: 15 },
  { label: 'Generating project documents…', durationSec: 90 },
  { label: 'Building evidence references…', durationSec: 30 },
  { label: 'Formatting output…', durationSec: 20 },
];

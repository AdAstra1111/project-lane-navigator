import { useState, useEffect, useRef, useCallback } from 'react';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Play, AlertTriangle } from 'lucide-react';
import type { AutoRunJob } from '@/hooks/useAutoRun';

const HARD_MAX_STEPS = 1000;

interface StepBudgetControlProps {
  job: AutoRunJob;
  onUpdateLimit: (newLimit: number) => Promise<void>;
  onContinue: () => Promise<void>;
  isRunning: boolean;
}

export function StepBudgetControl({ job, onUpdateLimit, onContinue, isRunning }: StepBudgetControlProps) {
  const used = job.step_count;
  const limit = job.max_total_steps;
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const isPausedAtLimit = job.status === 'paused' && job.pause_reason === 'step_limit';

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(limit));
  const [clamped, setClamped] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(String(limit));
  }, [limit]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    let val = parseInt(editValue, 10);
    if (isNaN(val) || val < 1) val = 1;
    let wasClamped = false;
    if (val > HARD_MAX_STEPS) {
      val = HARD_MAX_STEPS;
      wasClamped = true;
    }
    setClamped(wasClamped);
    setEditValue(String(val));
    if (val !== limit) {
      await onUpdateLimit(val);
    }
  }, [editValue, limit, onUpdateLimit]);

  const handleContinue = useCallback(async () => {
    setContinuing(true);
    try {
      await onContinue();
    } finally {
      setContinuing(false);
    }
  }, [onContinue]);

  // Color based on usage
  const barColor = pct >= 100
    ? 'bg-destructive'
    : pct >= 90
    ? 'bg-amber-500'
    : 'bg-primary';

  return (
    <div className="space-y-1.5">
      {/* Step counter row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-medium">Steps:</span>
        <span className="text-[11px] font-mono font-semibold">{used}</span>
        <span className="text-[10px] text-muted-foreground">/</span>
        {editing ? (
          <Input
            ref={inputRef}
            type="number"
            min={1}
            max={HARD_MAX_STEPS}
            className="h-5 w-16 text-[11px] font-mono px-1 py-0"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditing(false); setEditValue(String(limit)); } }}
          />
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="text-[11px] font-mono font-semibold text-primary hover:underline cursor-pointer bg-transparent border-none p-0"
                  onClick={() => setEditing(true)}
                  title="Click to edit step limit"
                >
                  {limit}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                Click to edit step limit
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {clamped && (
          <span className="text-[8px] text-amber-400 flex items-center gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" /> Max limit is {HARD_MAX_STEPS}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="relative">
        <Progress value={Math.min(pct, 100)} className="h-1" />
        <div
          className={`absolute inset-0 h-1 rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {/* Step-limit pause banner */}
      {isPausedAtLimit && (
        <div className="flex items-center gap-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-400 flex-1">
            Paused: Step limit reached ({used}/{limit})
          </span>
          <Button
            size="sm"
            className="h-6 text-[10px] gap-1 px-3"
            onClick={handleContinue}
            disabled={continuing || isRunning}
          >
            {continuing ? (
              <span className="animate-spin">⟳</span>
            ) : (
              <Play className="h-3 w-3" />
            )}
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

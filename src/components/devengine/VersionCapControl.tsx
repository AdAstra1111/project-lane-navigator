/**
 * VersionCapControl — Inline editable version cap per doc per job.
 * Controls max_versions_per_doc_per_job on the auto_run_jobs row.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Layers } from 'lucide-react';
import type { AutoRunJob } from '@/hooks/useAutoRun';

const MIN_CAP = 10;
const MAX_CAP = 300;
const DEFAULT_CAP = 60;

interface VersionCapControlProps {
  job: AutoRunJob;
  onUpdateCap: (newCap: number) => Promise<void>;
}

export function VersionCapControl({ job, onUpdateCap }: VersionCapControlProps) {
  const cap = (job as any).max_versions_per_doc_per_job ?? DEFAULT_CAP;
  const isPaused = job.status === 'paused' && (job as any).pause_reason === 'rewrite_cap_reached';

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(cap));
  const [clamped, setClamped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditValue(String(cap)); }, [cap]);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    let val = parseInt(editValue, 10);
    if (isNaN(val) || val < MIN_CAP) val = MIN_CAP;
    let wasClamped = false;
    if (val > MAX_CAP) { val = MAX_CAP; wasClamped = true; }
    setClamped(wasClamped);
    setEditValue(String(val));
    if (val !== cap) {
      await onUpdateCap(val);
    }
  }, [editValue, cap, onUpdateCap]);

  return (
    <div className="flex items-center gap-2">
      <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-[10px] text-muted-foreground font-medium">Version cap/doc:</span>
      {editing ? (
        <Input
          ref={inputRef}
          type="number"
          min={MIN_CAP}
          max={MAX_CAP}
          className="h-5 w-16 text-[11px] font-mono px-1 py-0"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditing(false); setEditValue(String(cap)); } }}
        />
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="text-[11px] font-mono font-semibold text-primary hover:underline cursor-pointer bg-transparent border-none p-0"
                onClick={() => setEditing(true)}
                title="Click to edit version cap per document"
              >
                {cap}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              Max versions per doc per job (job-scoped). Click to edit.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {clamped && (
        <span className="text-[8px] text-amber-400 flex items-center gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" /> Clamped to {MAX_CAP}
        </span>
      )}
      {isPaused && (
        <span className="text-[8px] text-amber-400">
          (cap reached — raise to continue)
        </span>
      )}
    </div>
  );
}

/**
 * ScriptDropZone
 *
 * Drag-and-drop (or click-to-select) zone for starting a new IFFY project
 * directly from a screenplay file. Accepts PDF, FDX, Fountain, DOCX, TXT.
 *
 * On file selection, delegates the full pipeline to useScriptDropProject:
 *   upload → ingest → create project → scene graph → NIT enrichment →
 *   role classification → spine links → blueprint bindings → navigate
 *
 * Shows real-time per-stage progress with status indicators.
 */

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Upload, CheckCircle2, AlertCircle, Loader2, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScriptDropProject, type DropStage, type DropStageStatus } from '@/hooks/useScriptDropProject';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  // Final Draft / Fountain (no official MIME — accept by extension)
];
const ACCEPTED_EXTS = ['.pdf', '.fdx', '.fountain', '.docx', '.txt'];

function isAccepted(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(ext);
}

function StageRow({ stage }: { stage: DropStage }) {
  const icons: Record<DropStageStatus, React.ReactNode> = {
    pending:  <div className="h-3 w-3 rounded-full border border-muted-foreground/40" />,
    running:  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />,
    done:     <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
    failed:   <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
    skipped:  <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />,
  };
  return (
    <div className={cn(
      'flex items-center gap-2 text-xs transition-opacity',
      stage.status === 'pending' ? 'opacity-40' : 'opacity-100',
    )}>
      <span className="shrink-0">{icons[stage.status]}</span>
      <span className={cn(
        'flex-1',
        stage.status === 'running'  && 'text-primary font-medium',
        stage.status === 'done'     && 'text-foreground',
        stage.status === 'failed'   && 'text-destructive',
        stage.status === 'skipped'  && 'text-muted-foreground',
        stage.status === 'pending'  && 'text-muted-foreground',
      )}>
        {stage.label}
      </span>
      {stage.detail && stage.status === 'failed' && (
        <span className="text-[10px] text-destructive/70 max-w-[120px] truncate">{stage.detail}</span>
      )}
    </div>
  );
}

export function ScriptDropZone() {
  const { run, stages, isRunning } = useScriptDropProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setDragError(null);
    if (!isAccepted(file)) {
      setDragError(`Unsupported format. Use PDF, FDX, Fountain, DOCX, or TXT.`);
      return;
    }
    run(file);
  }, [run]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }, [handleFile]);

  const anyRunning = isRunning;
  const allDone    = stages.every(s => s.status === 'done' || s.status === 'skipped');
  const hasError   = stages.some(s => s.status === 'failed');
  const activeStage = stages.find(s => s.status === 'running');

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <motion.div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !anyRunning && inputRef.current?.click()}
        className={cn(
          'relative rounded-xl border-2 border-dashed transition-all duration-200',
          'flex flex-col items-center justify-center gap-3 text-center',
          'min-h-[160px] px-6 py-8 cursor-pointer select-none',
          isDragging && !anyRunning
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : 'border-border/60 bg-muted/20 hover:border-primary/50 hover:bg-primary/5',
          anyRunning && 'cursor-default pointer-events-none opacity-90',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS.join(',')}
          className="hidden"
          onChange={onFileInput}
          disabled={anyRunning}
        />

        {/* Icon */}
        <div className={cn(
          'h-12 w-12 rounded-xl flex items-center justify-center transition-colors',
          isDragging ? 'bg-primary/20' : 'bg-muted/50',
        )}>
          {anyRunning
            ? <Loader2 className="h-6 w-6 text-primary animate-spin" />
            : <Film className="h-6 w-6 text-muted-foreground" />
          }
        </div>

        {/* Labels */}
        <div>
          <p className="text-sm font-semibold text-foreground">
            {anyRunning
              ? activeStage?.label ?? 'Processing…'
              : isDragging
              ? 'Drop to start'
              : 'Drop a screenplay here'}
          </p>
          {!anyRunning && (
            <p className="text-xs text-muted-foreground mt-0.5">
              PDF, FDX, Fountain, DOCX, TXT — creates a project with full scene graph
            </p>
          )}
        </div>

        {/* Upload icon hint */}
        {!anyRunning && !isDragging && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Upload className="h-3 w-3" />
            <span>or click to browse</span>
          </div>
        )}
      </motion.div>

      {/* Error */}
      {dragError && !anyRunning && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {dragError}
        </p>
      )}

      {/* Stage progress — only shows once pipeline starts */}
      <AnimatePresence>
        {(anyRunning || allDone || hasError) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="glass-card rounded-lg p-4 space-y-1.5 overflow-hidden"
          >
            {stages.map(stage => (
              <StageRow key={stage.key} stage={stage} />
            ))}
            {hasError && !anyRunning && (
              <p className="text-xs text-muted-foreground pt-1 border-t border-border/40 mt-1">
                Some enrichment stages failed — your project was still created and you can retry from the project page.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

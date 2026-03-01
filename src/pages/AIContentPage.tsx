/**
 * AIContentPage — AI Content generation tab for ProjectShell.
 * Orchestrates storyboard / animatic / teaser / trailer pipelines.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Film, Image, Play, Pause, Square, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAIContentRuns, useAIContentRunStatus, useAIContentMutations } from '@/lib/aiContent/useAIContent';
import type { ContentMode, ContentPreset } from '@/lib/aiContent/aiContentApi';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';

const MODE_OPTIONS: { value: ContentMode; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'storyboard', label: 'Storyboard', icon: Image, description: 'Generate visual panels from your script scenes' },
  { value: 'animatic', label: 'Animatic', icon: Film, description: 'Create a timed animatic from storyboard panels' },
  { value: 'teaser', label: 'Teaser', icon: Sparkles, description: 'Quick teaser with AI-generated clips' },
  { value: 'trailer', label: 'Trailer', icon: Film, description: 'Full trailer with clips, audio, and final render' },
];

const PRESET_OPTIONS: { value: ContentPreset; label: string; description: string }[] = [
  { value: 'fast', label: 'Fast', description: '~8 panels / ~4 clips, 1 retry' },
  { value: 'balanced', label: 'Balanced', description: '~16 panels / ~8 clips, 2 retries' },
  { value: 'quality', label: 'Quality', description: '~32 panels / ~12 clips, 3 retries' },
];

const MODE_STEPS: Record<ContentMode, string[]> = {
  storyboard: ['Create Panels', 'Render Frames'],
  animatic: ['Verify Storyboard', 'Create Animatic', 'Render Animatic'],
  teaser: ['Create Blueprint', 'Generate Clips', 'Assemble Cut', 'Generate Audio'],
  trailer: ['Create Blueprint', 'Generate Clips', 'Assemble Cut', 'Generate Audio', 'Render Final'],
};

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  queued: { icon: Clock, color: 'text-muted-foreground', label: 'Queued' },
  running: { icon: Loader2, color: 'text-primary', label: 'Running' },
  paused: { icon: Pause, color: 'text-amber-500', label: 'Paused' },
  completed: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Completed' },
  failed: { icon: AlertTriangle, color: 'text-destructive', label: 'Failed' },
  stopped: { icon: Square, color: 'text-muted-foreground', label: 'Stopped' },
};

export default function AIContentPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [selectedMode, setSelectedMode] = useState<ContentMode>('storyboard');
  const [selectedPreset, setSelectedPreset] = useState<ContentPreset>('balanced');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const { data: runsData } = useAIContentRuns(projectId);
  const { data: runStatus } = useAIContentRunStatus(projectId, activeRunId ?? undefined);
  const { start, tick, pause, resume, stop } = useAIContentMutations(projectId);

  // Auto-select latest active run
  useEffect(() => {
    if (!activeRunId && runsData?.runs?.length) {
      const active = runsData.runs.find((r: any) => r.status === 'running' || r.status === 'queued');
      if (active) setActiveRunId(active.runId);
    }
  }, [runsData, activeRunId]);

  // Auto-tick running runs
  useEffect(() => {
    if (!activeRunId || !runStatus) return;
    if (runStatus.status !== 'running' && runStatus.status !== 'queued') return;

    const timer = setInterval(() => {
      tick.mutate(activeRunId);
    }, 5000);

    return () => clearInterval(timer);
  }, [activeRunId, runStatus?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(() => {
    if (!projectId) return;
    start.mutate({ mode: selectedMode, preset: selectedPreset }, {
      onSuccess: (data) => setActiveRunId(data.runId),
    });
  }, [projectId, selectedMode, selectedPreset, start]);

  const handlePause = () => activeRunId && pause.mutate(activeRunId);
  const handleResume = () => activeRunId && resume.mutate(activeRunId);
  const handleStop = () => activeRunId && stop.mutate(activeRunId);

  const isRunning = runStatus?.status === 'running' || runStatus?.status === 'queued';
  const isPaused = runStatus?.status === 'paused';

  // Progress calculation
  const totalSteps = runStatus ? (runStatus.steps_completed?.length || 0) + (runStatus.steps_remaining?.length || 0) : 0;
  const completedSteps = runStatus?.steps_completed?.length || 0;
  const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  const currentStepIndex = completedSteps;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-semibold text-foreground">AI Content</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Generate visual media from your project</p>
        </div>
      </div>

      {/* Controls */}
      <div className="border border-border/50 rounded-lg bg-card/50 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Mode */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mode</label>
            <Select value={selectedMode} onValueChange={(v) => setSelectedMode(v as ContentMode)} disabled={isRunning}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    <div className="flex items-center gap-2">
                      <opt.icon className="h-3.5 w-3.5" />
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {MODE_OPTIONS.find(m => m.value === selectedMode)?.description}
            </p>
          </div>

          {/* Preset */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Preset</label>
            <Select value={selectedPreset} onValueChange={(v) => setSelectedPreset(v as ContentPreset)} disabled={isRunning}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {PRESET_OPTIONS.find(p => p.value === selectedPreset)?.description}
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actions</label>
            <div className="flex items-center gap-2">
              {!isRunning && !isPaused && (
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={start.isPending}
                  className="h-9 text-xs gap-1.5"
                >
                  {start.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Start
                </Button>
              )}
              {isRunning && (
                <>
                  <Button size="sm" variant="outline" onClick={handlePause} className="h-9 text-xs gap-1.5">
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleStop} className="h-9 text-xs gap-1.5">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                </>
              )}
              {isPaused && (
                <>
                  <Button size="sm" onClick={handleResume} className="h-9 text-xs gap-1.5">
                    <Play className="h-3.5 w-3.5" /> Resume
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleStop} className="h-9 text-xs gap-1.5">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Steps preview (when no active run) */}
        {!activeRunId && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-2 border-t border-border/30">
            <span className="font-medium">Steps:</span>
            {MODE_STEPS[selectedMode].map((step, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/30">→</span>}
                {step}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Active Run Progress */}
      {activeRunId && runStatus && (
        <div className="space-y-4">
          {/* Status badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(() => {
                const cfg = STATUS_CONFIG[runStatus.status] || STATUS_CONFIG.queued;
                const Icon = cfg.icon;
                return (
                  <>
                    <Icon className={cn('h-4 w-4', cfg.color, runStatus.status === 'running' && 'animate-spin')} />
                    <span className={cn('text-sm font-medium', cfg.color)}>{cfg.label}</span>
                  </>
                );
              })()}
              <span className="text-xs text-muted-foreground">
                {runStatus.mode} · {runStatus.preset}
              </span>
            </div>
            {runStatus.status === 'completed' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setActiveRunId(null)}
              >
                New Run
              </Button>
            )}
          </div>

          {/* Staged progress */}
          <StagedProgressBar
            title={`${runStatus.mode} Generation`}
            stages={MODE_STEPS[runStatus.mode as ContentMode] || []}
            currentStageIndex={currentStepIndex}
            progressPercent={progressPercent}
            detailMessage={runStatus.error || undefined}
          />

          {/* Error detail */}
          {runStatus.error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-destructive font-medium">Error</p>
                <p className="text-[11px] text-destructive/80">{runStatus.error}</p>
                {runStatus.stop_reason && (
                  <p className="text-[10px] text-muted-foreground">Stop reason: {runStatus.stop_reason}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Retries: {runStatus.retry_count}/{runStatus.max_retries}
                </p>
              </div>
            </div>
          )}

          {/* Downstream references */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {runStatus.storyboard_run_id && (
              <RefCard label="Storyboard Run" value={runStatus.storyboard_run_id} />
            )}
            {runStatus.render_run_id && (
              <RefCard label="Render Run" value={runStatus.render_run_id} />
            )}
            {runStatus.animatic_run_id && (
              <RefCard label="Animatic Run" value={runStatus.animatic_run_id} />
            )}
            {runStatus.blueprint_id && (
              <RefCard label="Blueprint" value={runStatus.blueprint_id} />
            )}
            {runStatus.clip_run_id && (
              <RefCard label="Clip Run" value={runStatus.clip_run_id} />
            )}
            {runStatus.cut_id && (
              <RefCard label="Cut" value={runStatus.cut_id} />
            )}
            {runStatus.audio_run_id && (
              <RefCard label="Audio Run" value={runStatus.audio_run_id} />
            )}
            {runStatus.render_job_id && (
              <RefCard label="Render Job" value={runStatus.render_job_id} />
            )}
          </div>
        </div>
      )}

      {/* Run History */}
      {runsData?.runs?.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Runs</h3>
          <div className="divide-y divide-border/30 border border-border/50 rounded-lg overflow-hidden">
            {runsData.runs.slice(0, 10).map((run: any) => {
              const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.queued;
              const Icon = cfg.icon;
              const isActive = run.runId === activeRunId;
              return (
                <button
                  key={run.runId}
                  onClick={() => setActiveRunId(run.runId)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    isActive ? 'bg-muted/30' : 'hover:bg-muted/10',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color, run.status === 'running' && 'animate-spin')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground capitalize">{run.mode}</span>
                      <span className="text-[10px] text-muted-foreground">{run.preset}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span className={cn('text-[10px] font-medium', cfg.color)}>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RefCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg border border-border/30 bg-muted/5 space-y-0.5">
      <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
      <p className="text-[10px] text-foreground font-mono truncate">{value.slice(0, 12)}…</p>
    </div>
  );
}

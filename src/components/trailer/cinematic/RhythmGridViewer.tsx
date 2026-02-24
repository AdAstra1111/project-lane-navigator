/**
 * Rhythm Grid Viewer — Shows BPM, drop timestamp, phase timings, and curves
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Music, AlertTriangle, Clock } from 'lucide-react';
import { useRhythmRuns } from '@/lib/trailerPipeline/cinematicHooks';

interface RhythmGridViewerProps {
  scriptRunId: string | undefined;
}

export function RhythmGridViewer({ scriptRunId }: RhythmGridViewerProps) {
  const { data: runs, isLoading } = useRhythmRuns(scriptRunId);
  const run = runs?.[0];

  if (isLoading) return <p className="text-xs text-muted-foreground py-4">Loading rhythm data…</p>;
  if (!run) return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground text-sm">
        <Music className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No rhythm grid generated yet. Run the full plan or create rhythm grid separately.
      </CardContent>
    </Card>
  );

  const phaseTimings = (run.phase_timings_json || {}) as Record<string, any>;
  const shotDurationCurve = (Array.isArray(run.shot_duration_curve_json) ? run.shot_duration_curve_json : []) as any[];
  const densityCurve = (Array.isArray(run.density_curve_json) ? run.density_curve_json : []) as any[];

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Music className="h-4 w-4" /> Rhythm Grid
            <Badge variant={run.status === 'complete' ? 'default' : 'secondary'} className="text-[10px]">{run.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground">BPM</p>
              <p className="text-2xl font-mono font-bold">{run.bpm}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Drop Timestamp</p>
              <p className="text-lg font-mono">
                {run.drop_timestamp_ms != null ? `${(run.drop_timestamp_ms / 1000).toFixed(1)}s` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Phases</p>
              <p className="text-lg font-mono">{Object.keys(phaseTimings).length}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Cut Points</p>
              <p className="text-lg font-mono">{(Array.isArray(run.beat_grid_json) ? run.beat_grid_json : []).length}</p>
            </div>
          </div>

          {run.warnings?.length > 0 && (
            <div className="mt-3 space-y-1">
              {run.warnings.map((w: string, i: number) => (
                <p key={i} className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phase Timings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Phase Timings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {Object.entries(phaseTimings).map(([phase, timing]: [string, any]) => (
              <div key={phase} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                <Badge variant="outline" className="text-[10px]">{phase}</Badge>
                <span className="font-mono text-muted-foreground">
                  {((timing.start_ms || 0) / 1000).toFixed(1)}s – {((timing.end_ms || 0) / 1000).toFixed(1)}s
                </span>
                <span className="font-mono">
                  {(((timing.end_ms || 0) - (timing.start_ms || 0)) / 1000).toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Shot Duration Curve */}
      {shotDurationCurve.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Target Shot Duration Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-0.5">
                {shotDurationCurve.map((point: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-mono w-16">{((point.t_ms || 0) / 1000).toFixed(1)}s</span>
                    <div className="flex-1 bg-muted/30 rounded h-3 overflow-hidden">
                      <div
                        className="h-full bg-primary/50 rounded"
                        style={{ width: `${Math.min(100, ((point.target_shot_ms || 0) / 5000) * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono w-16 text-right">{point.target_shot_ms}ms</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

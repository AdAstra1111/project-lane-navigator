/**
 * RhythmTimelineOverlay — Visual timeline strip showing beats, hit markers,
 * silence windows, and drop marker overlaid on the rhythm grid.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRhythmRuns } from '@/lib/trailerPipeline/cinematicHooks';
import { Music, Zap, VolumeX, ArrowDown } from 'lucide-react';

interface RhythmTimelineOverlayProps {
  scriptRunId: string | undefined;
}

const HIT_TYPE_COLORS: Record<string, string> = {
  sting: 'bg-amber-500',
  impact: 'bg-red-500',
  riser_end: 'bg-orange-400',
  bass_drop: 'bg-rose-600',
  button_stinger: 'bg-purple-500',
  hard_cut: 'bg-red-400',
};

export function RhythmTimelineOverlay({ scriptRunId }: RhythmTimelineOverlayProps) {
  const { data: runs } = useRhythmRuns(scriptRunId);
  const run = runs?.[0];

  const { totalMs, hitPoints, silenceWindows, dropMs, audioPlan, phaseTimings } = useMemo(() => {
    if (!run) return { totalMs: 0, hitPoints: [], silenceWindows: [], dropMs: null, audioPlan: null, phaseTimings: {} };

    const pt = (run.phase_timings_json || {}) as Record<string, any>;
    let maxMs = 0;
    for (const timing of Object.values(pt) as any[]) {
      maxMs = Math.max(maxMs, timing.end_ms || 0);
    }

    return {
      totalMs: maxMs || 90000,
      hitPoints: (run.hit_points_json || []) as any[],
      silenceWindows: (run.silence_windows_json || []) as any[],
      dropMs: run.drop_timestamp_ms as number | null,
      audioPlan: (run as any).audio_plan_json as any | null,
      phaseTimings: pt,
    };
  }, [run]);

  if (!run) return null;

  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / totalMs) * 100))}%`;

  const phases = Object.entries(phaseTimings) as [string, any][];
  const phaseColors: Record<string, string> = {
    hook: 'bg-red-500/30', setup: 'bg-blue-500/30', escalation: 'bg-orange-500/30',
    twist: 'bg-purple-500/30', crescendo: 'bg-rose-500/30', button: 'bg-amber-500/30',
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Music className="h-4 w-4" /> Rhythm Timeline
          {audioPlan && <Badge variant="outline" className="text-[9px]">Audio Plan Ready</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Phase strip */}
        <div className="relative h-6 bg-muted/30 rounded overflow-hidden">
          {phases.map(([phase, timing]) => (
            <div
              key={phase}
              className={`absolute top-0 h-full ${phaseColors[phase] || 'bg-muted/50'} border-r border-background/50`}
              style={{ left: pct(timing.start_ms || 0), width: pct((timing.end_ms || 0) - (timing.start_ms || 0)) }}
            >
              <span className="text-[8px] text-foreground/70 px-0.5 truncate block leading-6">{phase}</span>
            </div>
          ))}
        </div>

        {/* Hit markers + silence + drop overlay */}
        <TooltipProvider delayDuration={100}>
          <div className="relative h-8 bg-muted/20 rounded border border-border/50">
            {/* Silence windows as grey gaps */}
            {silenceWindows.map((sw: any, i: number) => (
              <Tooltip key={`sw-${i}`}>
                <TooltipTrigger asChild>
                  <div
                    className="absolute top-0 h-full bg-muted/60 border-x border-muted-foreground/20"
                    style={{ left: pct(sw.start_ms || 0), width: pct((sw.end_ms || 0) - (sw.start_ms || 0)) }}
                  >
                    <VolumeX className="h-3 w-3 text-muted-foreground mx-auto mt-1.5 opacity-60" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Silence: {((sw.start_ms || 0) / 1000).toFixed(1)}s – {((sw.end_ms || 0) / 1000).toFixed(1)}s</p>
                  {sw.reason && <p className="text-muted-foreground">{sw.reason}</p>}
                </TooltipContent>
              </Tooltip>
            ))}

            {/* Drop marker (highlighted) */}
            {dropMs && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="absolute top-0 h-full w-1 bg-rose-500 z-20"
                    style={{ left: pct(dropMs) }}
                  >
                    <ArrowDown className="h-3 w-3 text-rose-500 -ml-1 -mt-0.5" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">DROP at {(dropMs / 1000).toFixed(1)}s</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Hit markers as vertical lines */}
            {hitPoints.map((hp: any, i: number) => {
              const ms = hp.t_ms || hp.timestamp_ms || 0;
              const color = HIT_TYPE_COLORS[hp.type] || 'bg-red-400';
              return (
                <Tooltip key={`hp-${i}`}>
                  <TooltipTrigger asChild>
                    <div
                      className={`absolute top-0 h-full w-0.5 ${color} z-10`}
                      style={{ left: pct(ms) }}
                    >
                      <Zap className="h-2.5 w-2.5 text-foreground -ml-1 mt-0.5" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">{hp.type} ({hp.strength || '?'}/10)</p>
                    <p className="text-muted-foreground">{(ms / 1000).toFixed(1)}s · {hp.phase || ''}</p>
                    {hp.note && <p className="text-muted-foreground italic">{hp.note}</p>}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full inline-block" /> Hit Marker</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full inline-block" /> Drop</span>
          <span className="flex items-center gap-1"><span className="w-4 h-2 bg-muted/60 rounded inline-block" /> Silence</span>
          {audioPlan?.sfx_cues?.length > 0 && (
            <span>{audioPlan.sfx_cues.length} SFX cues</span>
          )}
        </div>

        {/* Audio plan summary */}
        {audioPlan && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <p className="text-[9px] text-muted-foreground">BPM</p>
              <p className="font-mono font-bold">{audioPlan.bpm}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">Hit Markers</p>
              <p className="font-mono">{hitPoints.length}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">Silence Windows</p>
              <p className="font-mono">{silenceWindows.length}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">SFX Cues</p>
              <p className="font-mono">{audioPlan.sfx_cues?.length || 0}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Shot Design Viewer — per-beat shot specs with camera details
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Camera, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useShotDesignRuns, useShotSpecs, useScriptBeats, useCinematicMutations } from '@/lib/trailerPipeline/cinematicHooks';

const MOVE_COLORS: Record<string, string> = {
  static: 'bg-muted text-muted-foreground',
  push_in: 'bg-blue-500/20 text-blue-300',
  pull_out: 'bg-cyan-500/20 text-cyan-300',
  track: 'bg-green-500/20 text-green-300',
  arc: 'bg-purple-500/20 text-purple-300',
  handheld: 'bg-amber-500/20 text-amber-300',
  whip_pan: 'bg-red-500/20 text-red-300',
  crane: 'bg-indigo-500/20 text-indigo-300',
  tilt: 'bg-teal-500/20 text-teal-300',
  dolly_zoom: 'bg-rose-500/20 text-rose-300',
};

interface ShotDesignViewerProps {
  projectId: string;
  scriptRunId: string | undefined;
}

export function ShotDesignViewer({ projectId, scriptRunId }: ShotDesignViewerProps) {
  const { data: runs, isLoading: runsLoading } = useShotDesignRuns(scriptRunId);
  const { data: beats } = useScriptBeats(scriptRunId);
  const latestRun = runs?.[0];
  const { data: specs, isLoading: specsLoading } = useShotSpecs(latestRun?.id);
  const { createShotDesign } = useCinematicMutations(projectId);

  if (runsLoading) return <p className="text-xs text-muted-foreground py-4">Loading shot design…</p>;

  if (!latestRun) return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground text-sm">
        <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No shot design generated yet.
        {scriptRunId && (
          <Button size="sm" variant="outline" className="mt-3"
            onClick={() => createShotDesign.mutate({ scriptRunId: scriptRunId! })}
            disabled={createShotDesign.isPending}>
            {createShotDesign.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
            Generate Shot Design
          </Button>
        )}
      </CardContent>
    </Card>
  );

  // Group specs by beat_id
  const specsByBeat = (specs || []).reduce((acc: Record<string, any[]>, spec: any) => {
    const key = spec.beat_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(spec);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Camera className="h-4 w-4" /> Shot Design
              <Badge variant={latestRun.status === 'complete' ? 'default' : 'secondary'} className="text-[10px]">{latestRun.status}</Badge>
            </span>
            <Button size="sm" variant="ghost"
              onClick={() => createShotDesign.mutate({ scriptRunId: scriptRunId! })}
              disabled={createShotDesign.isPending || !scriptRunId}>
              {createShotDesign.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {specs?.length || 0} shot specs across {beats?.length || 0} beats
          </p>
          {latestRun.warnings?.length > 0 && (
            <div className="mt-2 space-y-1">
              {latestRun.warnings.map((w: string, i: number) => (
                <p key={i} className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Specs by Beat */}
      <Card>
        <CardContent className="pt-4">
          <ScrollArea className="h-[calc(100vh-420px)]">
            <div className="space-y-3 pr-3">
              {(beats || []).map((beat: any) => {
                const beatSpecs = specsByBeat[beat.id] || [];
                if (beatSpecs.length === 0) return null;

                return (
                  <div key={beat.id} className="border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/20 flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">#{beat.beat_index}</span>
                      <Badge variant="outline" className="text-[9px]">{beat.phase}</Badge>
                      <span className="truncate text-muted-foreground">{beat.title || beat.emotional_intent}</span>
                      <span className="ml-auto font-mono text-muted-foreground">{beatSpecs.length} shot{beatSpecs.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {beatSpecs.map((spec: any) => (
                        <div key={spec.id} className="px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[9px]">{spec.shot_type}</Badge>
                            <Badge className={`text-[9px] ${MOVE_COLORS[spec.camera_move] || 'bg-muted text-muted-foreground'}`}>
                              {spec.camera_move?.replace(/_/g, ' ')}
                            </Badge>
                            {spec.lens_mm && (
                              <span className="text-muted-foreground font-mono">{spec.lens_mm}mm</span>
                            )}
                            <span className="text-muted-foreground font-mono">
                              intensity: {spec.movement_intensity}/10
                            </span>
                            {spec.target_duration_ms && (
                              <span className="text-muted-foreground font-mono ml-auto">
                                {spec.target_duration_ms}ms
                              </span>
                            )}
                          </div>
                          {spec.depth_strategy && (
                            <p className="text-[10px] text-muted-foreground">Depth: {spec.depth_strategy}</p>
                          )}
                          {spec.lighting_note && (
                            <p className="text-[10px] text-muted-foreground">Light: {spec.lighting_note}</p>
                          )}
                          {spec.foreground_element && (
                            <p className="text-[10px] text-muted-foreground">FG: {spec.foreground_element}</p>
                          )}
                          <div className="flex gap-2">
                            {spec.transition_in && (
                              <span className="text-[9px] text-muted-foreground">↓ {spec.transition_in}</span>
                            )}
                            {spec.transition_out && (
                              <span className="text-[9px] text-muted-foreground">↑ {spec.transition_out}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

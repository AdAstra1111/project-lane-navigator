/**
 * Crescendo Micro-Montage Panel — mini-editor for crescendo montage groups
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, Shuffle, Zap, Film } from 'lucide-react';
import { useShotSpecs, useScriptBeats, useCinematicMutations } from '@/lib/trailerPipeline/cinematicHooks';

const MOTIF_COLORS: Record<string, string> = {
  eyes: 'bg-blue-500/20 text-blue-300',
  door: 'bg-amber-500/20 text-amber-300',
  running: 'bg-green-500/20 text-green-300',
  impact: 'bg-red-500/20 text-red-300',
  hands: 'bg-purple-500/20 text-purple-300',
  fire: 'bg-orange-500/20 text-orange-300',
  water: 'bg-cyan-500/20 text-cyan-300',
  silhouette: 'bg-slate-500/20 text-slate-300',
};

interface CrescendoMontagePanelProps {
  projectId: string;
  scriptRunId: string | undefined;
  shotDesignRunId: string | undefined;
}

export function CrescendoMontagePanel({ projectId, scriptRunId, shotDesignRunId }: CrescendoMontagePanelProps) {
  const { data: specs, isLoading } = useShotSpecs(shotDesignRunId);
  const { data: beats } = useScriptBeats(scriptRunId);
  const { regenerateCrescendoMontage } = useCinematicMutations(projectId);

  const crescendoBeats = (beats || []).filter((b: any) => b.phase === 'crescendo');
  const crescendoSpecs = (specs || []).filter((s: any) => {
    const beat = crescendoBeats.find((b: any) => b.id === s.beat_id);
    return !!beat;
  });

  if (!shotDesignRunId || crescendoSpecs.length === 0) return null;

  // Group by montage_group_id
  const groups: Record<string, { beatIndex: number; specs: any[] }> = {};
  for (const spec of crescendoSpecs) {
    const hint = spec.prompt_hint_json as Record<string, any> | null;
    const groupId = hint?.montage_group_id || `mg-unknown`;
    const beat = crescendoBeats.find((b: any) => b.id === spec.beat_id);
    if (!groups[groupId]) {
      groups[groupId] = { beatIndex: beat?.beat_index ?? 0, specs: [] };
    }
    groups[groupId].specs.push(spec);
  }

  const totalDurationMs = crescendoSpecs.reduce((s: number, spec: any) => s + (spec.target_duration_ms || 900), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Crescendo Micro-Montage
            <Badge variant="secondary" className="text-[10px]">
              {crescendoSpecs.length} shots · {(totalDurationMs / 1000).toFixed(1)}s
            </Badge>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-7 gap-1"
            onClick={() => {
              if (scriptRunId && shotDesignRunId) {
                regenerateCrescendoMontage.mutate({ scriptRunId, shotDesignRunId });
              }
            }}
            disabled={regenerateCrescendoMontage.isPending || !scriptRunId || !shotDesignRunId}
          >
            {regenerateCrescendoMontage.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Regenerate Crescendo
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3 pr-3">
            {Object.entries(groups).map(([groupId, group]) => {
              const motifs = [...new Set(group.specs.map((s: any) => s.prompt_hint_json?.motif_tag).filter(Boolean))];
              const cutOnActionCount = group.specs.filter((s: any) => s.prompt_hint_json?.cut_on_action).length;
              const cutOnActionPct = group.specs.length > 0 ? Math.round((cutOnActionCount / group.specs.length) * 100) : 0;

              return (
                <div key={groupId} className="border border-border rounded-lg overflow-hidden">
                  {/* Group header */}
                  <div className="px-3 py-2 bg-rose-500/5 flex items-center gap-2 text-xs">
                    <Film className="h-3 w-3 text-rose-400" />
                    <span className="font-mono text-muted-foreground">Beat #{group.beatIndex}</span>
                    <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-300">{groupId}</Badge>
                    <span className="text-muted-foreground">{group.specs.length} shots</span>
                    <span className="text-muted-foreground ml-auto">
                      {cutOnActionPct}% cut-on-action
                    </span>
                  </div>

                  {/* Motif tags */}
                  <div className="px-3 py-1.5 flex gap-1 flex-wrap border-b border-border">
                    {motifs.map((motif: string) => (
                      <Badge
                        key={motif}
                        className={`text-[8px] ${MOTIF_COLORS[motif] || 'bg-muted text-muted-foreground'}`}
                      >
                        {motif}
                      </Badge>
                    ))}
                  </div>

                  {/* Shot list */}
                  <div className="divide-y divide-border">
                    {group.specs.map((spec: any, idx: number) => {
                      const hint = spec.prompt_hint_json || {};
                      return (
                        <div key={spec.id || idx} className="px-3 py-1.5 text-[10px] flex items-center gap-2">
                          <span className="font-mono text-muted-foreground w-4">#{idx + 1}</span>
                          <Badge variant="outline" className="text-[8px]">{spec.shot_type}</Badge>
                          <Badge variant="outline" className="text-[8px]">{spec.camera_move?.replace(/_/g, ' ')}</Badge>
                          {hint.motif_tag && (
                            <Badge className={`text-[8px] ${MOTIF_COLORS[hint.motif_tag] || 'bg-muted text-muted-foreground'}`}>
                              {hint.motif_tag}
                            </Badge>
                          )}
                          {hint.cut_on_action && (
                            <Badge variant="outline" className="text-[7px] border-amber-500/30 text-amber-400">✂ action</Badge>
                          )}
                          <span className="font-mono text-muted-foreground ml-auto">
                            {spec.target_duration_ms || 900}ms
                          </span>
                          <span className="font-mono text-muted-foreground">
                            i:{spec.movement_intensity}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

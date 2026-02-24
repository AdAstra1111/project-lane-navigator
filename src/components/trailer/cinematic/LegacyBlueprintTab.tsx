/**
 * Legacy Blueprint v1 — Read-only view of old trailer blueprint runs
 * Deprecated blueprints shown with lock badge. No creation allowed.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Archive, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { useBlueprints, useBlueprintMutations } from '@/lib/trailerPipeline/useTrailerPipeline';

interface LegacyBlueprintTabProps {
  projectId: string;
}

export function LegacyBlueprintTab({ projectId }: LegacyBlueprintTabProps) {
  const { data: bpListData, isLoading } = useBlueprints(projectId);
  const { deprecateBlueprints } = useBlueprintMutations(projectId);
  const blueprints = bpListData?.blueprints || [];

  if (isLoading) return <p className="text-xs text-muted-foreground py-4">Loading…</p>;

  if (blueprints.length === 0) return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground text-sm">
        <Archive className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No legacy blueprint runs found.
      </CardContent>
    </Card>
  );

  const hasNonDeprecated = blueprints.some((bp: any) => bp.status !== 'deprecated');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Archive className="h-4 w-4" /> Legacy Blueprints (v1) — Read Only
          <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> DEPRECATED
          </Badge>
          {hasNonDeprecated && (
            <Button size="sm" variant="ghost" className="ml-auto text-[10px] h-6"
              onClick={() => deprecateBlueprints.mutate()}
              disabled={deprecateBlueprints.isPending}>
              {deprecateBlueprints.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
              Mark All Deprecated
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2">
            {blueprints.map((bp: any) => {
              const isDeprecated = bp.status === 'deprecated';
              return (
                <div key={bp.id} className={`border border-border rounded-lg p-3 space-y-2 ${isDeprecated ? 'opacity-50' : 'opacity-75'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono">{bp.id.slice(0, 12)}</span>
                    <div className="flex items-center gap-1">
                      {isDeprecated && (
                        <Badge variant="outline" className="text-[8px] px-1 border-destructive/30 text-destructive">
                          <Lock className="h-2 w-2 mr-0.5" /> locked
                        </Badge>
                      )}
                      <Badge variant={bp.status === 'complete' ? 'default' : bp.status === 'deprecated' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {bp.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Arc: {bp.arc_type} · {(bp.edl || []).length} beats
                  </div>
                  {bp.edl && (
                    <div className="space-y-0.5">
                      {(bp.edl || []).slice(0, 6).map((beat: any, i: number) => (
                        <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-2">
                          <span className="font-mono w-4">{beat.beat_index}</span>
                          <Badge variant="outline" className="text-[8px] px-1">{beat.role}</Badge>
                          <span className="truncate">{beat.clip_spec?.action_description || '—'}</span>
                          <span className="ml-auto font-mono">{beat.duration_s}s</span>
                        </div>
                      ))}
                      {(bp.edl || []).length > 6 && (
                        <p className="text-[10px] text-muted-foreground">…and {bp.edl.length - 6} more beats</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
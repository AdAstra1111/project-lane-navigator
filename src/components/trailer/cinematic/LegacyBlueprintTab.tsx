/**
 * Legacy Blueprint v1 — Read-only view of old trailer blueprint runs
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Archive } from 'lucide-react';
import { useBlueprints } from '@/lib/trailerPipeline/useTrailerPipeline';

interface LegacyBlueprintTabProps {
  projectId: string;
}

export function LegacyBlueprintTab({ projectId }: LegacyBlueprintTabProps) {
  const { data: bpListData, isLoading } = useBlueprints(projectId);
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Archive className="h-4 w-4" /> Legacy Blueprints (v1) — Read Only
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2">
            {blueprints.map((bp: any) => (
              <div key={bp.id} className="border border-border rounded-lg p-3 space-y-2 opacity-75">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono">{bp.id.slice(0, 12)}</span>
                  <Badge variant={bp.status === 'complete' ? 'default' : 'secondary'} className="text-[10px]">{bp.status}</Badge>
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
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGenerateSeriesScripts, type SeriesScriptItem } from '@/hooks/useGenerateSeriesScripts';
import {
  Film, Play, Search, Loader2, CheckCircle2, AlertTriangle, XCircle, FileText, RotateCcw,
} from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'outline' },
  running: { label: 'Running', variant: 'secondary' },
  regenerated: { label: 'Done', variant: 'default' },
  error: { label: 'Error', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'outline' },
  preview: { label: 'Preview', variant: 'outline' },
};

function EpisodeRow({ item }: { item: SeriesScriptItem }) {
  const badge = STATUS_BADGE[item.status] || STATUS_BADGE.queued;
  return (
    <div className="flex items-center justify-between py-2 px-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">
          Ep {item.episode_index}: {item.episode_title || 'Untitled'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {item.char_after > 0 && (
          <span className="text-xs text-muted-foreground">{(item.char_after / 1000).toFixed(1)}k chars</span>
        )}
        <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
        {item.error && (
          <span className="text-xs text-destructive max-w-[150px] truncate" title={item.error}>
            {item.error}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
}

export function GenerateSeasonScriptsPanel({ projectId }: Props) {
  const { scan, generate, clear, scanResult, result, loading, error, progress } = useGenerateSeriesScripts(projectId);
  const [force, setForce] = useState(false);

  const items: SeriesScriptItem[] = result?.items || scanResult?.items || [];
  const isRunning = progress.status === 'running';
  const isComplete = progress.status === 'complete';
  const hasScan = !!scanResult && scanResult.items.length > 0;
  const hasResult = !!result;

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const errorCount = items.filter(i => i.status === 'error').length;
  const doneCount = items.filter(i => i.status === 'regenerated').length;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Film className="h-5 w-5 text-primary" />
          Generate Season Scripts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status summary */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
            <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {isComplete && hasResult && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-400">
              Generated {doneCount} episode script{doneCount !== 1 ? 's' : ''}.
              {errorCount > 0 && ` ${errorCount} failed.`}
            </p>
          </div>
        )}

        {/* Progress bar */}
        {(isRunning || (isComplete && hasResult)) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{isRunning ? 'Generating...' : 'Complete'}</span>
              <span>{progress.completed}/{progress.total} episodes</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}

        {/* Episode list */}
        {items.length > 0 && (
          <ScrollArea className="max-h-[300px] border rounded-md">
            {items.map((item, i) => (
              <EpisodeRow key={item.id || i} item={item} />
            ))}
          </ScrollArea>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isRunning && !hasResult && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => scan()}
              disabled={loading}
            >
              {loading && progress.status === 'scanning' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-1" />
              )}
              Scan Episodes
            </Button>
          )}

          {hasScan && !isRunning && !hasResult && (
            <Button
              size="sm"
              onClick={() => generate({ force })}
              disabled={loading}
            >
              <Play className="h-4 w-4 mr-1" />
              Generate {scanResult.items.length} Script{scanResult.items.length !== 1 ? 's' : ''}
            </Button>
          )}

          {isComplete && hasResult && (
            <Button variant="outline" size="sm" onClick={clear}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          )}

          {isRunning && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating episode {progress.completed + 1} of {progress.total}...
            </Badge>
          )}
        </div>

        {/* Scan info when no scan yet */}
        {!hasScan && !hasResult && !isRunning && !loading && (
          <p className="text-xs text-muted-foreground">
            Scan to identify episodes needing scripts, then generate them one by one with quality gates.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

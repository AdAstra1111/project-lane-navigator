import { useState, useEffect } from 'react';
import { Loader2, Zap, CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStoryIngestion, IngestionRun } from '@/hooks/useStoryIngestion';

interface StoryIngestionPanelProps {
  projectId: string;
}

export function StoryIngestionPanel({ projectId }: StoryIngestionPanelProps) {
  const { isRunning, latestRun, runIngestion, fetchStatus } = useStoryIngestion(projectId);
  const [runs, setRuns] = useState<IngestionRun[]>([]);

  useEffect(() => {
    fetchStatus().then(r => setRuns(r));
  }, [fetchStatus]);

  const manifest = latestRun?.manifest_json;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Story Ingestion Engine</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Parse your script into scenes, characters, locations, props, and state variants — feeding the entire visual pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {latestRun?.status === 'completed' && manifest && (
          <div className="rounded-md border border-border/40 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Last Ingestion Complete
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>Scenes: <span className="text-foreground font-medium">{manifest.scenes_parsed}</span></span>
              <span>Characters: <span className="text-foreground font-medium">{manifest.characters}</span></span>
              <span>Locations: <span className="text-foreground font-medium">{manifest.locations}</span></span>
              <span>Props: <span className="text-foreground font-medium">{manifest.props}</span></span>
              <span>Costumes: <span className="text-foreground font-medium">{manifest.costume_looks}</span></span>
              <span>State Changes: <span className="text-foreground font-medium">{manifest.state_transitions}</span></span>
              <span>Participation: <span className="text-foreground font-medium">{manifest.participation_records}</span></span>
              <span>Entities: <span className="text-foreground font-medium">{manifest.entities_total}</span></span>
            </div>
          </div>
        )}

        {latestRun?.status === 'failed' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Last ingestion failed: {latestRun.failure_reason?.slice(0, 100)}
            </div>
          </div>
        )}

        {isRunning && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-[11px] text-primary">Ingesting story… scenes → entities → states → distribution</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={isRunning}
            onClick={() => runIngestion({ force: true })}
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {latestRun?.status === 'completed' ? 'Re-Ingest Story' : 'Ingest Story Package'}
          </Button>

          {latestRun?.status === 'completed' && (
            <Badge variant="outline" className="text-[10px] h-6">
              {runs.filter(r => r.status === 'completed').length} run{runs.filter(r => r.status === 'completed').length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

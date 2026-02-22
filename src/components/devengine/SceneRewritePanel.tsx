import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Play, RotateCcw, Package, Square, AlertCircle, CheckCircle2, Clock, Layers } from 'lucide-react';
import { useSceneRewritePipeline, SceneRewriteJob } from '@/hooks/useSceneRewritePipeline';

interface SceneRewritePanelProps {
  projectId: string;
  documentId: string;
  versionId: string;
  approvedNotes: any[];
  protectItems: string[];
  onComplete?: (newVersionId: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'done': return <Badge variant="default" className="bg-green-600 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Done</Badge>;
    case 'running': return <Badge variant="default" className="bg-blue-600 text-xs animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    case 'failed': return <Badge variant="destructive" className="text-xs"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'queued': return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />Queued</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export function SceneRewritePanel({
  projectId, documentId, versionId, approvedNotes, protectItems, onComplete,
}: SceneRewritePanelProps) {
  const pipeline = useSceneRewritePipeline(projectId);
  const [initialized, setInitialized] = useState(false);

  // On mount, check for existing jobs (resume)
  useEffect(() => {
    if (!initialized && versionId) {
      pipeline.loadStatus(versionId).then(() => setInitialized(true));
    }
  }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When complete with a new version, notify parent
  useEffect(() => {
    if (pipeline.mode === 'complete' && pipeline.newVersionId && onComplete) {
      onComplete(pipeline.newVersionId);
    }
  }, [pipeline.mode, pipeline.newVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    const result = await pipeline.enqueue(documentId, versionId, approvedNotes, protectItems);
    if (result) {
      pipeline.processAll(versionId);
    }
  };

  const handleResume = () => {
    pipeline.processAll(versionId);
  };

  const handleRetry = async () => {
    await pipeline.retryFailed(versionId);
    pipeline.processAll(versionId);
  };

  const handleAssemble = () => {
    pipeline.assemble(documentId, versionId);
  };

  const progress = pipeline.total > 0 ? (pipeline.done / pipeline.total) * 100 : 0;
  const canStart = pipeline.mode === 'idle' && pipeline.total === 0;
  const canResume = (pipeline.mode === 'idle' || pipeline.mode === 'error') && pipeline.queued > 0;
  const canRetry = pipeline.failed > 0;
  const canAssemble = pipeline.done === pipeline.total && pipeline.total > 0 && !pipeline.newVersionId;
  const isWorking = pipeline.mode === 'processing' || pipeline.mode === 'enqueuing' || pipeline.mode === 'assembling';

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Scene Rewrite</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {pipeline.rewriteMode === 'scene' ? 'Scene mode' : pipeline.rewriteMode === 'chunk' ? 'Chunk mode' : 'Auto'}
          </Badge>
          {pipeline.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {pipeline.done}/{pipeline.total} scenes
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canStart && (
            <Button size="sm" variant="default" onClick={handleStart} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Start
            </Button>
          )}
          {canResume && !isWorking && (
            <Button size="sm" variant="default" onClick={handleResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {canRetry && !isWorking && (
            <Button size="sm" variant="outline" onClick={handleRetry} className="h-7 text-xs gap-1">
              <RotateCcw className="h-3 w-3" /> Retry Failed
            </Button>
          )}
          {canAssemble && !isWorking && (
            <Button size="sm" variant="default" onClick={handleAssemble} className="h-7 text-xs gap-1">
              <Package className="h-3 w-3" /> Assemble
            </Button>
          )}
          {isWorking && (
            <Button size="sm" variant="ghost" onClick={pipeline.stop} className="h-7 text-xs gap-1">
              <Square className="h-3 w-3" /> Stop
            </Button>
          )}
          {pipeline.mode !== 'idle' && (
            <Button size="sm" variant="ghost" onClick={pipeline.reset} className="h-7 text-xs">
              Reset
            </Button>
          )}
        </div>
      </div>

      {pipeline.total > 0 && (
        <Progress value={progress} className="h-1.5" />
      )}

      {pipeline.mode === 'assembling' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Assembling final script…
        </div>
      )}

      {pipeline.mode === 'enqueuing' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Splitting into scenes…
        </div>
      )}

      {pipeline.error && (
        <div className="text-xs text-destructive">{pipeline.error}</div>
      )}

      {pipeline.newVersionId && (
        <div className="text-xs text-green-600 font-medium">✓ Rewrite complete — new version created</div>
      )}

      {/* Scene list */}
      {pipeline.scenes.length > 0 && (
        <ScrollArea className="max-h-48">
          <div className="space-y-1">
            {pipeline.scenes.map((scene) => (
              <div key={scene.scene_number} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50">
                <span className="truncate flex-1 mr-2">
                  <span className="text-muted-foreground mr-1">#{scene.scene_number}</span>
                  {scene.scene_heading || 'Scene'}
                </span>
                <StatusBadge status={scene.status} />
                {scene.error && (
                  <span className="text-destructive ml-2 truncate max-w-32" title={scene.error}>
                    {scene.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Summary stats */}
      {pipeline.total > 0 && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {pipeline.queued > 0 && <span>Queued: {pipeline.queued}</span>}
          {pipeline.running > 0 && <span className="text-blue-500">Running: {pipeline.running}</span>}
          {pipeline.done > 0 && <span className="text-green-500">Done: {pipeline.done}</span>}
          {pipeline.failed > 0 && <span className="text-destructive">Failed: {pipeline.failed}</span>}
        </div>
      )}
    </div>
  );
}

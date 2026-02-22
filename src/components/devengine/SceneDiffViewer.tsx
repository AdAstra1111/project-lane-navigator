import { ScrollArea } from '@/components/ui/scroll-area';
import type { SceneDiffArtifact } from '@/lib/scene-graph/types';

interface SceneDiffViewerProps {
  artifact: SceneDiffArtifact;
}

export function SceneDiffViewer({ artifact }: SceneDiffViewerProps) {
  return (
    <div className="space-y-2">
      {/* Stats bar */}
      <div className="flex gap-3 text-[10px]">
        <span className="text-green-600">+{artifact.stats.insertions}</span>
        <span className="text-destructive">-{artifact.stats.deletions}</span>
        <span className="text-muted-foreground">={artifact.stats.unchanged}</span>
        <span className="text-muted-foreground ml-auto">{artifact.granularity} diff</span>
      </div>

      <ScrollArea className="max-h-[400px]">
        <div className="font-mono text-[11px] leading-relaxed">
          {artifact.hunks.length === 0 && (
            <p className="text-muted-foreground text-center py-4">No differences found.</p>
          )}
          {artifact.hunks.map((hunk, hi) => (
            <div key={hi} className="mb-3">
              <div className="text-[9px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded mb-1">
                @@ -{hunk.before_start},{hunk.before_len} +{hunk.after_start},{hunk.after_len} @@
              </div>
              {hunk.ops.map((op, oi) => (
                <div
                  key={oi}
                  className={`px-2 py-px whitespace-pre-wrap break-all ${
                    op.t === 'ins' ? 'bg-green-500/10 text-green-700 dark:text-green-400' :
                    op.t === 'del' ? 'bg-destructive/10 text-destructive line-through' :
                    'text-foreground/70'
                  }`}
                >
                  <span className="inline-block w-3 shrink-0 text-muted-foreground select-none">
                    {op.t === 'ins' ? '+' : op.t === 'del' ? '-' : ' '}
                  </span>
                  {op.text || '\u00A0'}
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

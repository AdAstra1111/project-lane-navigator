/**
 * SceneRewriteDiffViewer — Read-only diff viewer for regenerated scene versions.
 * Displays inline text diff, provenance metadata, and scene navigation.
 * Fail-closed: graceful fallback when previous version unavailable.
 */

import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, GitCompare, Info } from 'lucide-react';
import type { SceneVersionDiffData } from '@/hooks/useSceneVersionDiff';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: SceneVersionDiffData | null;
  loading: boolean;
  error: string | null;
  /** ordered scene keys for navigation */
  sceneKeys: string[];
  currentIndex: number;
  onNavigate: (sceneKey: string) => void;
}

/* ── Minimal inline diff ── */

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
}

function computeInlineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping prefix)
  let suffixLen = 0;
  while (
    suffixLen < (oldLines.length - prefixLen) &&
    suffixLen < (newLines.length - prefixLen) &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const result: DiffLine[] = [];

  // Common prefix
  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: 'unchanged', text: oldLines[i] });
  }

  // Removed lines
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    result.push({ type: 'removed', text: oldLines[i] });
  }

  // Added lines
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    result.push({ type: 'added', text: newLines[i] });
  }

  // Common suffix
  for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
    result.push({ type: 'unchanged', text: oldLines[i] });
  }

  return result;
}

export function SceneRewriteDiffViewer({
  open, onOpenChange, data, loading, error, sceneKeys, currentIndex, onNavigate,
}: Props) {
  const diffLines = useMemo(() => {
    if (!data?.current?.content) return [];
    const oldText = data.previous?.content ?? '';
    return computeInlineDiff(oldText, data.current.content);
  }, [data]);

  const meta = data?.current?.metadata as Record<string, any> | undefined;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < sceneKeys.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4 text-muted-foreground" />
            Scene Rewrite Diff
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Loading scene versions…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col gap-3 overflow-hidden flex-1">
            {/* Header metadata */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-b border-border/30 pb-2">
              <span className="font-medium text-foreground">{data.scene_key}</span>
              {meta?.regeneration_run_id && (
                <span>Run: <span className="font-mono">{String(meta.regeneration_run_id).slice(0, 8)}…</span></span>
              )}
              {meta?.execution_source && (
                <span>Source: <Badge variant="outline" className="text-[10px] ml-0.5">{meta.execution_source}</Badge></span>
              )}
              <span>
                Version: <span className="font-medium text-foreground">
                  v{data.previous?.version_number ?? '?'} → v{data.current.version_number}
                </span>
              </span>
            </div>

            {/* Previous version unavailable */}
            {!data.previous && (
              <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Previous version unavailable — showing current version only.
              </div>
            )}

            {/* Diff content */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="font-mono text-[11px] leading-relaxed">
                {diffLines.map((line, i) => (
                  <div
                    key={i}
                    className={`px-2 py-px whitespace-pre-wrap break-all ${
                      line.type === 'added'
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : line.type === 'removed'
                        ? 'bg-destructive/10 text-destructive line-through'
                        : 'text-foreground/70'
                    }`}
                  >
                    <span className="inline-block w-3 shrink-0 text-muted-foreground select-none">
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    {line.text || '\u00A0'}
                  </div>
                ))}
                {diffLines.length === 0 && !data.previous && data.current.content && (
                  <div className="px-2 py-px whitespace-pre-wrap break-all text-foreground/70">
                    {data.current.content}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Provenance panel */}
            {meta && Object.keys(meta).length > 0 && (
              <div className="border-t border-border/30 pt-2 space-y-1">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Provenance</h4>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  {meta.provenance_type && <span>Type: <span className="text-foreground">{meta.provenance_type}</span></span>}
                  {meta.regeneration_run_id && <span>Run: <span className="font-mono text-foreground">{meta.regeneration_run_id}</span></span>}
                  {meta.execution_source && <span>Exec Source: <span className="text-foreground">{meta.execution_source}</span></span>}
                  {meta.source_units && <span>Units: <span className="text-foreground">{Array.isArray(meta.source_units) ? meta.source_units.join(', ') : String(meta.source_units)}</span></span>}
                  {meta.source_axes && <span>Axes: <span className="text-foreground">{Array.isArray(meta.source_axes) ? meta.source_axes.join(', ') : String(meta.source_axes)}</span></span>}
                  {meta.batch_order != null && <span>Batch: <span className="text-foreground">{meta.batch_order}</span></span>}
                  {data.current.created_at && <span>Generated: <span className="text-foreground">{new Date(data.current.created_at).toLocaleString()}</span></span>}
                </div>
              </div>
            )}

            {/* Navigation */}
            {sceneKeys.length > 1 && (
              <div className="flex items-center justify-between border-t border-border/30 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => onNavigate(sceneKeys[currentIndex - 1])}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous Scene
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {currentIndex + 1} / {sceneKeys.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => onNavigate(sceneKeys[currentIndex + 1])}
                >
                  Next Scene
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

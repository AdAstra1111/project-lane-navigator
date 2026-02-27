import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { useGenerateSeriesScripts, type SeriesScriptItem } from '@/hooks/useGenerateSeriesScripts';
import { supabase } from '@/integrations/supabase/client';
import {
  Film, Play, Search, Loader2, CheckCircle2, XCircle, FileText, RotateCcw,
  BookOpen, AlertTriangle, Hash,
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
  const {
    scan, generate, buildMaster, clear,
    scanResult, result, loading, error, progress,
    masterResult, masterLoading,
  } = useGenerateSeriesScripts(projectId);
  const [force] = useState(false);
  const [canonicalCount, setCanonicalCount] = useState<number | null>(null);
  const [countInput, setCountInput] = useState('');
  const [countSaving, setCountSaving] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('season_episode_count').eq('id', projectId).single()
      .then(({ data }) => {
        const val = data?.season_episode_count;
        setCanonicalCount(typeof val === 'number' && val > 0 ? val : null);
        setCountInput(typeof val === 'number' && val > 0 ? String(val) : '');
      });
  }, [projectId]);

  const saveCanonicalCount = async () => {
    const num = parseInt(countInput);
    if (!num || num < 1) return;
    setCountSaving(true);
    await supabase.from('projects').update({ season_episode_count: num }).eq('id', projectId);
    setCanonicalCount(num);
    setCountSaving(false);
  };

  const clearCanonicalCount = async () => {
    setCountSaving(true);
    await supabase.from('projects').update({ season_episode_count: null } as any).eq('id', projectId);
    setCanonicalCount(null);
    setCountInput('');
    setCountSaving(false);
  };

  const items: SeriesScriptItem[] = result?.items || scanResult?.items || [];
  const isRunning = progress.status === 'running';
  const isComplete = progress.status === 'complete';
  const hasScan = !!scanResult && scanResult.items.length > 0;
  const hasResult = !!result;

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const errorCount = items.filter(i => i.status === 'error').length;
  const doneCount = items.filter(i => i.status === 'regenerated').length;

  return (
    <div className="space-y-4">
      {/* Canonical episode count */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hash className="h-5 w-5 text-muted-foreground" />
            Season Episode Count
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canonicalCount ? (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-sm">Canonical: {canonicalCount} episodes</Badge>
              <Button variant="ghost" size="sm" onClick={clearCanonicalCount} disabled={countSaving}>
                Clear
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No canonical count set. Episodes will be derived from episode grid, season arc, or format default.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={200}
              placeholder="e.g. 10"
              value={countInput}
              onChange={e => setCountInput(e.target.value)}
              className="w-24 h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={saveCanonicalCount} disabled={countSaving || !countInput || parseInt(countInput) < 1}>
              {countSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-episode generation */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Film className="h-5 w-5 text-primary" />
            Generate Season Scripts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {isComplete && hasResult && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-primary/10 border border-primary/30">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">
                Generated {doneCount} episode script{doneCount !== 1 ? 's' : ''}.
                {errorCount > 0 && ` ${errorCount} failed.`}
              </p>
            </div>
          )}

          {(isRunning || (isComplete && hasResult)) && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{isRunning ? 'Generating...' : 'Complete'}</span>
                <span>{progress.completed}/{progress.total} episodes</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}

          {items.length > 0 && (
            <ScrollArea className="max-h-[300px] border rounded-md">
              {items.map((item, i) => (
                <EpisodeRow key={item.id || i} item={item} />
              ))}
            </ScrollArea>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {!isRunning && !hasResult && (
              <Button variant="outline" size="sm" onClick={() => scan()} disabled={loading}>
                {loading && progress.status === 'scanning' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-1" />
                )}
                Scan Episodes
              </Button>
            )}

            {hasScan && !isRunning && !hasResult && (
              <Button size="sm" onClick={() => generate({ force })} disabled={loading}>
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

          {!hasScan && !hasResult && !isRunning && !loading && (
            <p className="text-xs text-muted-foreground">
              Scan to identify episodes needing scripts, then generate them one by one with quality gates.
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Master script build (deterministic, no LLM) */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            Build Master Season Script
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Concatenates all episode scripts into a single master document. No AI — instant, deterministic.
          </p>

          {masterResult && !masterResult.success && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="text-destructive">{masterResult.error}</p>
                {masterResult.missing_episodes && masterResult.missing_episodes.length > 0 && (
                  <p className="text-muted-foreground mt-1">
                    Missing: Episodes {masterResult.missing_episodes.join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {masterResult && masterResult.success && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-primary/10 border border-primary/30">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">
                Master script built — {masterResult.episode_count} episodes, {((masterResult.char_count || 0) / 1000).toFixed(1)}k chars (v{masterResult.version_number})
              </p>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => buildMaster()}
            disabled={masterLoading}
          >
            {masterLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <BookOpen className="h-4 w-4 mr-1" />
            )}
            Build Master Script
          </Button>
        </CardContent>
      </Card>

      {/* SQL validation snippets (dev reference) */}
      {/* 
        -- Verify no episode_script has stub markers:
        SELECT pd.id, pdv.plaintext 
        FROM project_documents pd 
        JOIN project_document_versions pdv ON pdv.document_id = pd.id AND pdv.is_current = true
        WHERE pd.project_id = :project_id AND pd.doc_type = 'episode_script'
          AND (pdv.plaintext ILIKE '%draft stub%' OR pdv.plaintext ILIKE '%generate full%'
               OR pdv.plaintext ILIKE '%remaining episodes%' OR pdv.plaintext ILIKE '%episodes 11%');
        
        -- Verify episode count matches:
        SELECT COUNT(*) as ep_count FROM project_documents 
        WHERE project_id = :project_id AND doc_type = 'episode_script';
        
        -- Verify master script length ≈ sum of episodes:
        SELECT 
          (SELECT LENGTH(pdv.plaintext) FROM project_documents pd 
           JOIN project_document_versions pdv ON pdv.document_id = pd.id AND pdv.is_current = true
           WHERE pd.project_id = :project_id AND pd.doc_type = 'season_master_script') as master_len,
          (SELECT SUM(LENGTH(pdv.plaintext)) FROM project_documents pd 
           JOIN project_document_versions pdv ON pdv.document_id = pd.id AND pdv.is_current = true
           WHERE pd.project_id = :project_id AND pd.doc_type = 'episode_script') as episodes_sum;
      */}
    </div>
  );
}

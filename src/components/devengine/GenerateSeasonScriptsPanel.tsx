import { useState, useEffect, useCallback } from 'react';
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
  BookOpen, AlertTriangle, Hash, Lock, Unlock, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

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

interface EpisodeCountReport {
  ok: boolean;
  N: number | null;
  locked: boolean;
  source: string;
  episode_scripts: { found_count: number; missing: number[]; duplicates: number[]; extras: number[] };
  master: { exists: boolean; episode_count: number | null; missing_separators: number[]; extra_separators: number[] };
}

async function callDevEngine(action: string, body: Record<string, any>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const result = await resp.json();
  if (!resp.ok) {
    // Surface specific error codes
    if (result.error === 'EPISODE_COUNT_NOT_SET' || result.error === 'EPISODE_COUNT_LOCKED') {
      throw new Error(result.error);
    }
    throw new Error(result.error || result.message || 'Request failed');
  }
  return result;
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
  const [locked, setLocked] = useState(false);
  const [countSource, setCountSource] = useState<string | null>(null);
  const [countInput, setCountInput] = useState('');
  const [countSaving, setCountSaving] = useState(false);
  const [report, setReport] = useState<EpisodeCountReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [regenningGrid, setRegenningGrid] = useState(false);

  // Load canonical count + locked state
  useEffect(() => {
    supabase.from('projects').select('season_episode_count, season_episode_count_locked, season_episode_count_source').eq('id', projectId).single()
      .then(({ data }) => {
        const val = data?.season_episode_count;
        const isLocked = data?.season_episode_count_locked === true;
        setCanonicalCount(typeof val === 'number' && val > 0 ? val : null);
        setCountInput(typeof val === 'number' && val > 0 ? String(val) : '');
        setLocked(isLocked);
        setCountSource((data as any)?.season_episode_count_source || null);
      });
  }, [projectId]);

  const saveCanonicalCount = async (andLock = false) => {
    const num = parseInt(countInput);
    if (!num || num < 1 || num > 300) return;
    setCountSaving(true);
    try {
      const res = await callDevEngine('set-season-episode-count', {
        projectId,
        episodeCount: num,
        lock: andLock,
      });
      if (res.success) {
        setCanonicalCount(num);
        if (andLock) setLocked(true);
        toast.success(andLock ? `Episode count set to ${num} and locked` : `Episode count set to ${num}`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCountSaving(false);
    }
  };

  const lockCount = async () => {
    if (!canonicalCount) return;
    setCountSaving(true);
    try {
      await callDevEngine('lock-season-episode-count', { projectId });
      setLocked(true);
      toast.success(`Episode count locked at ${canonicalCount}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCountSaving(false);
    }
  };

  const clearCanonicalCount = async () => {
    if (locked) {
      toast.error('Episode count is locked. Cannot clear.');
      return;
    }
    setCountSaving(true);
    await supabase.from('projects').update({ season_episode_count: null } as any).eq('id', projectId);
    setCanonicalCount(null);
    setCountInput('');
    setLocked(false);
    setReport(null);
    setCountSaving(false);
  };

  const runValidation = useCallback(async () => {
    setValidating(true);
    try {
      const r = await callDevEngine('validate-episode-count', { projectId });
      setReport(r);
    } catch (e: any) {
      toast.error(`Validation failed: ${e.message}`);
    } finally {
      setValidating(false);
    }
  }, [projectId]);

  // Auto-validate when canonical count is set
  useEffect(() => {
    if (canonicalCount && canonicalCount > 0) {
      runValidation();
    }
  }, [canonicalCount, runValidation]);

  const items: SeriesScriptItem[] = result?.items || scanResult?.items || [];
  const isRunning = progress.status === 'running';
  const isComplete = progress.status === 'complete';
  const hasScan = !!scanResult && scanResult.items.length > 0;
  const hasResult = !!result;
  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const errorCount = items.filter(i => i.status === 'error').length;
  const doneCount = items.filter(i => i.status === 'regenerated').length;

  // Block generation if count unset or validation failed
  const countUnset = canonicalCount === null;
  const mismatch = report && !report.ok;
  const generationBlocked = countUnset || (mismatch && !isRunning);

  return (
    <div className="space-y-4">
      {/* Canonical episode count */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hash className="h-5 w-5 text-muted-foreground" />
            Season Episode Count
            {locked && <Lock className="h-4 w-4 text-amber-500" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canonicalCount ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="default" className="text-sm gap-1">
                {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                {canonicalCount} episodes {locked ? '(Locked)' : ''}
              </Badge>
              {countSource && (
                <Badge variant="outline" className="text-xs">Source: {countSource}</Badge>
              )}
              {!locked && (
                <>
                  <Button variant="outline" size="sm" onClick={lockCount} disabled={countSaving}>
                    <Lock className="h-3 w-3 mr-1" /> Lock
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearCanonicalCount} disabled={countSaving}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">
                Episode count not set. Set it before generating scripts.
              </p>
            </div>
          )}
          {!locked && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={300}
                placeholder="e.g. 10"
                value={countInput}
                onChange={e => setCountInput(e.target.value)}
                className="w-24 h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={() => saveCanonicalCount(false)} disabled={countSaving || !countInput || parseInt(countInput) < 1}>
                {countSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set'}
              </Button>
              <Button size="sm" variant="default" onClick={() => saveCanonicalCount(true)} disabled={countSaving || !countInput || parseInt(countInput) < 1}>
                {countSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Lock className="h-3 w-3 mr-1" /> Set & Lock</>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation Report */}
      {report && (
        <Card className={report.ok ? "border-green-500/30" : "border-destructive/30"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {report.ok ? (
                <><ShieldCheck className="h-4 w-4 text-green-500" /> Episode Count Consistent</>
              ) : (
                <><ShieldAlert className="h-4 w-4 text-destructive" /> Episode Count Mismatch</>
              )}
              <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={runValidation} disabled={validating}>
                {validating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Re-check'}
              </Button>
            </CardTitle>
          </CardHeader>
          {!report.ok && (
            <CardContent className="space-y-2 pt-0">
              <p className="text-xs text-muted-foreground">
                Expected: {report.N} episodes | Found: {report.episode_scripts.found_count} scripts
              </p>
              {report.episode_scripts.missing.length > 0 && (
                <p className="text-xs text-destructive">
                  Missing scripts: Episodes {report.episode_scripts.missing.join(', ')}
                </p>
              )}
              {report.episode_scripts.extras.length > 0 && (
                <p className="text-xs text-amber-500">
                  Extra scripts: Episodes {report.episode_scripts.extras.join(', ')}
                </p>
              )}
              {report.episode_scripts.duplicates.length > 0 && (
                <p className="text-xs text-amber-500">
                  Duplicate scripts: Episodes {report.episode_scripts.duplicates.join(', ')}
                </p>
              )}
              {report.master.exists && report.master.missing_separators.length > 0 && (
                <p className="text-xs text-destructive">
                  Master missing: Episodes {report.master.missing_separators.join(', ')}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1 text-xs"
                disabled={regenningGrid}
                onClick={async () => {
                  setRegenningGrid(true);
                  try {
                    await callDevEngine('regen-episode-grid-to-canon', { projectId });
                    toast.success('Episode grid regeneration initiated');
                    runValidation();
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setRegenningGrid(false);
                  }
                }}
              >
                {regenningGrid ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Regenerate episode grid to match canon
              </Button>
            </CardContent>
          )}
        </Card>
      )}

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
              <Button variant="outline" size="sm" onClick={() => scan()} disabled={loading || generationBlocked}>
                {loading && progress.status === 'scanning' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-1" />
                )}
                Scan Episodes
              </Button>
            )}

            {hasScan && !isRunning && !hasResult && (
              <Button size="sm" onClick={() => generate({ force })} disabled={loading || generationBlocked}>
                <Play className="h-4 w-4 mr-1" />
                Generate {scanResult.items.length} Script{scanResult.items.length !== 1 ? 's' : ''}
              </Button>
            )}

            {isComplete && hasResult && (
              <Button variant="outline" size="sm" onClick={() => { clear(); runValidation(); }}>
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

          {generationBlocked && !isRunning && (
            <p className="text-xs text-destructive">
              {countUnset
                ? 'Set the episode count above before generating scripts.'
                : 'Resolve episode count mismatches before generating.'}
            </p>
          )}

          {!hasScan && !hasResult && !isRunning && !loading && !generationBlocked && (
            <p className="text-xs text-muted-foreground">
              Scan to identify episodes needing scripts, then generate them one by one with quality gates.
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Master script build */}
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
            disabled={masterLoading || generationBlocked}
          >
            {masterLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <BookOpen className="h-4 w-4 mr-1" />
            )}
            Build Master Script
          </Button>

          {generationBlocked && (
            <p className="text-xs text-destructive">
              {countUnset
                ? 'Set the episode count before building master script.'
                : 'Resolve episode count mismatches first.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

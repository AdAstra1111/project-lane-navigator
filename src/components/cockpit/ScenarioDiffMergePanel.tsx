import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GitMerge, ArrowRightLeft, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface DiffChange {
  path: string;
  a: unknown;
  b: unknown;
}

interface DiffResult {
  aScenarioId: string;
  bScenarioId: string;
  changes: DiffChange[];
  truncated: boolean;
}

interface MergePreview {
  targetScenarioId: string;
  sourceScenarioId: string;
  strategy: string;
  paths_applied: string[];
  protected_hits: string[];
  would_change_count: number;
  is_locked: boolean;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  onMerge: (params: { sourceScenarioId: string; targetScenarioId: string; paths?: string[]; strategy?: string; force?: boolean }) => void;
  isMerging: boolean;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function ScenarioDiffMergePanel({ projectId, scenarios, activeScenarioId, onMerge, isMerging }: Props) {
  const nonArchived = useMemo(() => scenarios.filter(s => !s.is_archived), [scenarios]);

  const defaultSource = useMemo(() => {
    const branch = nonArchived.find(s => s.scenario_type === 'custom');
    const rec = nonArchived.find(s => s.is_recommended);
    return branch?.id ?? rec?.id ?? nonArchived[0]?.id ?? '';
  }, [nonArchived]);

  const defaultTarget = useMemo(() => {
    if (activeScenarioId) return activeScenarioId;
    const baseline = nonArchived.find(s => s.scenario_type === 'baseline');
    return baseline?.id ?? nonArchived[0]?.id ?? '';
  }, [nonArchived, activeScenarioId]);

  const [sourceId, setSourceId] = useState(defaultSource);
  const [targetId, setTargetId] = useState(defaultTarget);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [isDiffing, setIsDiffing] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<string>('overwrite');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const computeDiff = async () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setIsDiffing(true);
    setDiffError(null);
    setDiff(null);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'diff_scenarios', projectId, aScenarioId: sourceId, bScenarioId: targetId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const result = data as DiffResult;
      setDiff(result);
      setSelected(new Set(result.changes.map(c => c.path)));
    } catch (e: any) {
      setDiffError(e.message ?? 'Diff failed');
    } finally {
      setIsDiffing(false);
    }
  };

  const runPreview = async () => {
    if (!diff || selected.size === 0) return;
    setIsPreviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'merge_scenario_overrides',
          projectId,
          sourceScenarioId: sourceId,
          targetScenarioId: targetId,
          paths: Array.from(selected),
          strategy,
          preview: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreview(data as MergePreview);
    } catch (e: any) {
      setDiffError(e.message ?? 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleMerge = () => {
    if (!diff || selected.size === 0) return;
    const needsForce = preview && (preview.is_locked || preview.protected_hits.length > 0);
    if (needsForce) {
      if (!confirm(`This merge touches ${preview.protected_hits.length} protected path(s) and/or a locked scenario. Proceed with force?`)) return;
    } else {
      if (!confirm(`Merge ${selected.size} override(s) from source into target using "${strategy}" strategy?`)) return;
    }
    onMerge({
      sourceScenarioId: sourceId,
      targetScenarioId: targetId,
      paths: Array.from(selected),
      strategy,
      force: needsForce ? true : undefined,
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!diff) return;
    setSelected(checked ? new Set(diff.changes.map(c => c.path)) : new Set());
  };

  const scenarioLabel = (id: string) => {
    const s = nonArchived.find(sc => sc.id === id);
    return s?.name ?? id.slice(0, 8);
  };

  const targetScenario = nonArchived.find(s => s.id === targetId);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitMerge className="h-4 w-4" />
          Scenario Diff &amp; Merge
          {targetScenario?.is_locked && (
            <Badge variant="destructive" className="text-[10px] ml-2">🔒 Target Locked</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selectors */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[160px]">
            <label className="text-[10px] text-muted-foreground font-medium">Source</label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nonArchived.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}{s.is_locked ? ' 🔒' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0 mb-1" />
          <div className="space-y-1 min-w-[160px]">
            <label className="text-[10px] text-muted-foreground font-medium">Target</label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nonArchived.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}{s.is_locked ? ' 🔒' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isDiffing || !sourceId || !targetId || sourceId === targetId}
            onClick={computeDiff}
          >
            {isDiffing ? 'Computing…' : 'Compute Diff'}
          </Button>
        </div>

        {diffError && <div className="text-xs text-destructive">{diffError}</div>}

        {/* Diff table */}
        {diff && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{diff.changes.length} change{diff.changes.length !== 1 ? 's' : ''}</Badge>
              {diff.truncated && <Badge variant="destructive" className="text-[10px]">Truncated</Badge>}
              <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
            </div>

            {diff.changes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No differences found.</div>
            ) : (
              <>
                <div className="rounded border border-border/30 overflow-auto max-h-64">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-muted/20 border-b border-border/20">
                        <th className="px-2 py-1.5 text-left w-8">
                          <Checkbox
                            checked={selected.size === diff.changes.length}
                            onCheckedChange={(c) => toggleAll(!!c)}
                          />
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Path</th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{scenarioLabel(sourceId)} (A)</th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{scenarioLabel(targetId)} (B)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.changes.map(c => {
                        const isProtected = targetScenario?.protected_paths?.some(
                          pp => c.path === pp || c.path.startsWith(pp + '.')
                        );
                        return (
                          <tr key={c.path} className={`border-b border-border/10 hover:bg-muted/10 ${isProtected ? 'bg-destructive/5' : ''}`}>
                            <td className="px-2 py-1">
                              <Checkbox
                                checked={selected.has(c.path)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selected);
                                  checked ? next.add(c.path) : next.delete(c.path);
                                  setSelected(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1 font-mono text-[10px]">
                              {c.path}
                              {isProtected && <ShieldAlert className="inline h-3 w-3 ml-1 text-destructive" />}
                            </td>
                            <td className="px-2 py-1 text-foreground">{formatValue(c.a)}</td>
                            <td className="px-2 py-1 text-muted-foreground">{formatValue(c.b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Preview summary */}
                {preview && (
                  <div className="text-xs flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">
                      Would apply <strong>{preview.would_change_count}</strong> path(s)
                    </span>
                    {preview.protected_hits.length > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {preview.protected_hits.length} protected
                      </Badge>
                    )}
                    {preview.is_locked && (
                      <Badge variant="destructive" className="text-[10px]">🔒 Locked</Badge>
                    )}
                  </div>
                )}

                {/* Merge controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-medium">Strategy</label>
                    <Select value={strategy} onValueChange={setStrategy}>
                      <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="overwrite" className="text-xs">Overwrite</SelectItem>
                        <SelectItem value="fill_missing" className="text-xs">Fill Missing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs mt-4"
                    disabled={isPreviewing || selected.size === 0}
                    onClick={runPreview}
                  >
                    {isPreviewing ? 'Previewing…' : 'Preview Merge'}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs mt-4"
                    disabled={isMerging || selected.size === 0}
                    onClick={handleMerge}
                  >
                    {isMerging ? 'Merging…' : `Merge ${selected.size} into Target`}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

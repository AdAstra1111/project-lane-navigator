/**
 * Storyboard Pipeline v1 — Main page
 */
import { useState, useMemo, useCallback } from 'react';
import { warningActionFor as sbWarningActionFor } from '@/lib/warningActions';
import { dedupeWarningsStable } from '@/lib/warningUtils';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Layers, Image, RefreshCw, Check, Loader2, Camera, ChevronDown, ChevronRight, Play, Square, AlertTriangle, FileDown, Archive, ExternalLink, Trash2, Film, Settings2, Copy, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useCanonicalUnits, useStoryboardRuns, useStoryboardPanels, useStoryboardPanel, useStoryboardMutations } from '@/lib/storyboard/useStoryboard';
import { useRenderRuns, useRenderRun, useRenderMutations, useRenderWorker } from '@/lib/storyboardRender/useStoryboardRender';
import { useExports, useExportMutations } from '@/lib/storyboardExport/useStoryboardExport';
import { useAnimaticRuns, useAnimaticRun, useAnimaticMutations, useAnimaticRenderer } from '@/lib/animatics/useAnimatics';
import type { CanonicalUnitSummary, StoryboardPanel } from '@/lib/types/storyboard';

export default function StoryboardPipeline() {
  const { id: projectId } = useParams<{ id: string }>();
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [selectedPanelId, setSelectedPanelId] = useState<string | undefined>();
  const [stylePreset, setStylePreset] = useState('cinematic_realism');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [activeRenderRunId, setActiveRenderRunId] = useState<string | undefined>();
  const [selectedAnimaticId, setSelectedAnimaticId] = useState<string | undefined>();
  const [animaticFps, setAnimaticFps] = useState(24);
  const [selectedSBWarning, setSelectedSBWarning] = useState<string | null>(null);
  const [animaticDuration, setAnimaticDuration] = useState(900);
  const [animaticCaption, setAnimaticCaption] = useState(true);

  const { data: unitsData, isLoading: unitsLoading } = useCanonicalUnits(projectId);
  const { data: runsData } = useStoryboardRuns(projectId);
  const { data: panelsData } = useStoryboardPanels(projectId, selectedRunId);
  const { data: panelDetail } = useStoryboardPanel(projectId, selectedPanelId);
  const { createRunAndPanels, generateFrame, regenerateFrame } = useStoryboardMutations(projectId);

  // Render queue hooks
  const { data: renderRunsData } = useRenderRuns(projectId, selectedRunId);
  const { data: renderRunDetail } = useRenderRun(projectId, activeRenderRunId);
  const { enqueue, cancel } = useRenderMutations(projectId);

  // Export hooks
  const { data: exportsData } = useExports(projectId, selectedRunId);
  const { createExport, deleteExport } = useExportMutations(projectId);
  const exports = exportsData?.exports || [];

  // Animatic hooks
  const { data: animaticRunsData } = useAnimaticRuns(projectId, selectedRunId);
  const { data: animaticRunDetail } = useAnimaticRun(projectId, selectedAnimaticId);
  const { createRun: createAnimaticRun } = useAnimaticMutations(projectId);
  const { render: renderAnimaticVideo, cancelRender, isRendering, progress: renderProgress } = useAnimaticRenderer(projectId);
  const animaticRuns = animaticRunsData?.runs || [];
  const selectedAnimatic = animaticRunDetail?.run;

  const renderRun = renderRunDetail?.renderRun;
  const renderJobs = renderRunDetail?.jobs || [];
  const isRenderRunning = renderRun?.status === 'running';

  // Normalized warnings (bounded, deterministic)
  const sbWarningsRaw = (renderRun as any)?.warnings;
  const sbWarnings: string[] = Array.isArray(sbWarningsRaw)
    ? sbWarningsRaw.filter((w: any) => typeof w === "string")
    : [];

  type SBWarningCategory = "critical" | "structure" | "pacing" | "tone" | "metadata" | "other";
  const SB_CAT_ORDER: SBWarningCategory[] = ["critical", "structure", "pacing", "tone", "metadata", "other"];

  function categorizeSBWarning(w: string): SBWarningCategory {
    const l = w.toLowerCase();
    if (l.includes("fail") || l.includes("missing") || l.includes("error")) return "critical";
    if (l.includes("structure") || l.includes("arc") || l.includes("peak") || l.includes("escalation")) return "structure";
    if (l.includes("pacing") || l.includes("tempo") || l.includes("duration") || l.includes("length")) return "pacing";
    if (l.includes("tone") || l.includes("contrast") || l.includes("energy") || l.includes("flat")) return "tone";
    if (l.includes("metadata") || l.includes("expected") || l.includes("unit") || l.includes("count")) return "metadata";
    return "other";
  }

  function sortSBWarnings(ws: string[]): string[] {
    return [...ws].sort((a, b) => {
      const ai = SB_CAT_ORDER.indexOf(categorizeSBWarning(a));
      const bi = SB_CAT_ORDER.indexOf(categorizeSBWarning(b));
      return ai !== bi ? ai - bi : a.localeCompare(b);
    });
  }

  const sbWarningsDeduped = dedupeWarningsStable(sbWarnings);
  const sbWarningsCount = sbWarningsDeduped.length;
  const sbWarningsPreview = sortSBWarnings(sbWarningsDeduped).slice(0, 6);

  function sbWarningAnchorId(w: string): string | null {
    const l = w.toLowerCase();
    if (l.includes("arc") || l.includes("structure") || l.includes("peak") || l.includes("escalation")) return "iffy-sb-structure";
    if (l.includes("pacing") || l.includes("tempo") || l.includes("duration") || l.includes("length")) return "iffy-sb-pacing";
    if (l.includes("tone") || l.includes("contrast") || l.includes("energy") || l.includes("flat")) return "iffy-sb-tone";
    if (l.includes("metadata") || l.includes("expected") || l.includes("unit") || l.includes("count")) return "iffy-sb-metadata";
    if (l.includes("fail") || l.includes("missing") || l.includes("error")) return "iffy-sb-top";
    return null;
  }

  function scrollToSBAnchor(id: string) {
    try {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { /* no-op */ }
  }

  // Auto-select latest active render run
  const renderRuns = renderRunsData?.renderRuns || [];
  if (!activeRenderRunId && renderRuns.length > 0) {
    const active = renderRuns.find((r: any) => r.status === 'running');
    if (active) setActiveRenderRunId(active.id);
  }

  // Polling worker
  useRenderWorker(projectId, activeRenderRunId, isRenderRunning);

  const units: CanonicalUnitSummary[] = unitsData?.units || [];
  const runs = runsData?.runs || [];
  const panels: StoryboardPanel[] = panelsData?.panels || [];

  const panelsByUnit = useMemo(() => {
    const map: Record<string, StoryboardPanel[]> = {};
    for (const p of panels) {
      if (!map[p.unit_key]) map[p.unit_key] = [];
      map[p.unit_key].push(p);
    }
    return map;
  }, [panels]);

  const toggleUnit = (key: string) => {
    setSelectedUnits(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectTop12 = () => {
    const sorted = [...units].sort((a, b) => (b.scores?.storyboard_value || 0) - (a.scores?.storyboard_value || 0));
    setSelectedUnits(new Set(sorted.slice(0, 12).map(u => u.unit_key)));
  };

  const handleCreateRun = () => {
    createRunAndPanels.mutate({
      unitKeys: selectedUnits.size > 0 ? Array.from(selectedUnits) : undefined,
      stylePreset,
      aspectRatio,
    });
  };

  const toggleExpand = (uk: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      if (next.has(uk)) next.delete(uk);
      else next.add(uk);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Storyboard Pipeline</h1>
          <div className="ml-auto">
            <Link to={`/projects/${projectId}/trailer-pipeline`}>
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <Film className="h-3.5 w-3.5" />
                Trailer Pipeline
              </Button>
            </Link>
          </div>
          <h1 className="text-lg font-semibold">Storyboard Pipeline</h1>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4" id="iffy-sb-top">
        {/* LEFT: Unit Selector + Runs */}
        <div className="lg:col-span-3 space-y-4">
          <Card id="iffy-sb-metadata">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                Canonical Units
                <Badge variant="secondary">{units.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectTop12} disabled={units.length === 0}>
                  Select Top 12
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelectedUnits(new Set())}>
                  Clear
                </Button>
              </div>
              <ScrollArea className="h-[300px]">
                {unitsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : units.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No canonical units. Accept visual unit candidates first.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {units.map(u => (
                      <button
                        key={u.unit_key}
                        onClick={() => toggleUnit(u.unit_key)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                          selectedUnits.has(u.unit_key)
                            ? 'bg-primary/10 border border-primary/30'
                            : 'hover:bg-muted border border-transparent'
                        }`}
                      >
                        <div className="font-medium truncate">{u.unit_key}</div>
                        <div className="text-muted-foreground truncate">{u.canonical_payload?.logline?.slice(0, 60)}</div>
                        <div className="flex gap-1 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1">SB:{u.scores?.storyboard_value || '?'}</Badge>
                          {u.locked && <Badge variant="secondary" className="text-[10px] px-1">🔒</Badge>}
                          {u.stale && <Badge variant="destructive" className="text-[10px] px-1">stale</Badge>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card id="iffy-sb-tone">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Generate Panel Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={stylePreset} onValueChange={setStylePreset}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cinematic_realism">Cinematic Realism</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                  <SelectItem value="noir">Film Noir</SelectItem>
                  <SelectItem value="watercolor">Watercolor</SelectItem>
                </SelectContent>
              </Select>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16 (Vertical)</SelectItem>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="2.39:1">2.39:1 (Scope)</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-full"
                onClick={handleCreateRun}
                disabled={createRunAndPanels.isPending}
              >
                {createRunAndPanels.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Layers className="h-3 w-3 mr-1" />}
                Generate Panels {selectedUnits.size > 0 ? `(${selectedUnits.size} units)` : '(Top 12)'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Runs</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                {runs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No runs yet</p>
                ) : (
                  <div className="space-y-1">
                    {runs.map((r: any) => (
                      <button
                        key={r.id}
                        onClick={() => setSelectedRunId(r.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                          selectedRunId === r.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{r.id.slice(0, 8)}</span>
                          <Badge variant={r.status === 'complete' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {r.status}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground">{r.unit_keys?.length || 0} units · {r.style_preset}</div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* MIDDLE + RIGHT: Panels Browser + Frame Preview */}
        <div className="lg:col-span-9 space-y-4">
          {!selectedRunId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Select or create a run to browse panels
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Render Queue Controls */}
              <Card id="iffy-sb-structure">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Batch Render</span>
                    {isRenderRunning && <Badge variant="default" className="text-[10px] animate-pulse">Rendering…</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={enqueue.isPending || isRenderRunning}
                      onClick={() => {
                        enqueue.mutate({ runId: selectedRunId! }, {
                          onSuccess: (data: any) => { if (data.renderRunId) setActiveRenderRunId(data.renderRunId); },
                        });
                      }}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Render Missing Frames
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={enqueue.isPending || isRenderRunning}
                      onClick={() => {
                        enqueue.mutate({ runId: selectedRunId!, mode: 'force' }, {
                          onSuccess: (data: any) => { if (data.renderRunId) setActiveRenderRunId(data.renderRunId); },
                        });
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Force Render All
                    </Button>
                    {isRenderRunning && activeRenderRunId && (
                      <Button size="sm" variant="destructive" onClick={() => cancel.mutate(activeRenderRunId)}>
                        <Square className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>

                  {/* Progress */}
                  {renderRun && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant={
                          renderRun.status === 'running' ? 'default' :
                          renderRun.status === 'complete' ? 'secondary' :
                          renderRun.status === 'failed' ? 'destructive' : 'outline'
                        } className="text-[10px]">{renderRun.status}</Badge>
                        {renderRun.status === 'complete' && sbWarningsCount > 0 && (
                          <span className="text-[10px] text-muted-foreground italic">
                            (with warnings)
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {renderRun.succeeded}/{renderRun.total} done
                          {renderRun.failed > 0 && <span className="text-destructive ml-1">· {renderRun.failed} failed</span>}
                          {renderRun.running > 0 && <span className="text-primary ml-1">· {renderRun.running} in progress</span>}
                        </span>
                      </div>
                      {sbWarningsCount > 0 && (
                        <div className="flex items-start gap-2 text-xs">
                          <span className="text-muted-foreground">
                            {sbWarningsCount} warning{sbWarningsCount > 1 ? 's' : ''}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {sbWarningsPreview.map((w, i) => {
                              const label = w.length > 40 ? w.slice(0, 37) + '…' : w;
                              const isActive = selectedSBWarning === w;
                              return (
                                <button
                                  key={`${i}-${w}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSBWarning(w);
                                    const id = sbWarningAnchorId(w);
                                    if (id) scrollToSBAnchor(id);
                                  }}
                                  className={
                                    "rounded-md px-2 py-0.5 text-muted-foreground bg-muted hover:bg-muted/80 transition " +
                                    (isActive ? "ring-1 ring-muted-foreground/40" : "")
                                  }
                                  title={w}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {selectedSBWarning && (
                        <div className="mt-2 rounded-md border bg-background p-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground">
                                {sbWarningActionFor(selectedSBWarning).title}
                              </div>
                              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                                {sbWarningActionFor(selectedSBWarning).steps.slice(0, 2).map((s) => (
                                  <li key={s}>{s}</li>
                                ))}
                              </ul>
                            </div>
                            {sbWarningAnchorId(selectedSBWarning) && (
                              <button
                                type="button"
                                className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80"
                                onClick={() => {
                                  const id = sbWarningAnchorId(selectedSBWarning);
                                  if (id) scrollToSBAnchor(id);
                                }}
                              >
                                Jump
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <Progress value={renderRun.total > 0 ? ((renderRun.succeeded + renderRun.failed) / renderRun.total) * 100 : 0} className="h-2" />

                      {/* Failed jobs */}
                      {renderRun.failed > 0 && (
                        <div className="space-y-1 mt-2">
                          <p className="text-xs font-medium text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Failed jobs:
                          </p>
                          {renderJobs.filter((j: any) => j.status === 'failed').slice(0, 10).map((j: any) => (
                            <div key={j.id} className="text-[10px] text-muted-foreground bg-destructive/5 border border-destructive/20 rounded px-2 py-1">
                              <span className="font-mono">{j.unit_key}</span> — {j.last_error?.slice(0, 80)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recent render runs */}
                  {renderRuns.length > 1 && (
                    <div className="pt-1">
                      <p className="text-[10px] text-muted-foreground mb-1">Recent renders:</p>
                      <div className="flex gap-1 flex-wrap">
                        {renderRuns.slice(0, 5).map((rr: any) => (
                          <button
                            key={rr.id}
                            onClick={() => setActiveRenderRunId(rr.id)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                              activeRenderRunId === rr.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                            }`}
                          >
                            {rr.succeeded}/{rr.total}
                            <Badge variant={rr.status === 'complete' ? 'secondary' : rr.status === 'failed' ? 'destructive' : 'outline'} className="text-[8px] ml-1 px-0.5">{rr.status}</Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Export Controls */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileDown className="h-4 w-4" />
                    Export
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createExport.isPending}
                      onClick={() => createExport.mutate({ runId: selectedRunId!, exportType: 'pdf_contact_sheet' })}
                    >
                      {createExport.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileDown className="h-3 w-3 mr-1" />}
                      PDF Contact Sheet
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createExport.isPending}
                      onClick={() => createExport.mutate({ runId: selectedRunId!, exportType: 'zip_frames' })}
                    >
                      {createExport.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Archive className="h-3 w-3 mr-1" />}
                      ZIP + Manifest
                    </Button>
                  </div>

                  {exports.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Recent exports:</p>
                      {exports.slice(0, 8).map((exp: any) => (
                        <div key={exp.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                          <Badge variant={
                            exp.status === 'complete' ? 'default' :
                            exp.status === 'failed' ? 'destructive' :
                            exp.status === 'running' ? 'secondary' : 'outline'
                          } className="text-[10px]">{exp.status}</Badge>
                          <span className="text-muted-foreground">{exp.export_type === 'pdf_contact_sheet' ? 'PDF' : 'ZIP'}</span>
                          {exp.meta?.frame_count != null && (
                            <span className="text-muted-foreground/50 text-[10px]">{exp.meta.frame_count}/{exp.meta.panel_count} frames</span>
                          )}
                          <span className="text-muted-foreground/40 text-[10px]">{new Date(exp.created_at).toLocaleString()}</span>
                          {exp.status === 'complete' && exp.public_url && (
                            <>
                              <a href={exp.public_url} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]">
                                  <ExternalLink className="h-3 w-3 mr-0.5" /> Open
                                </Button>
                              </a>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => {
                                  navigator.clipboard.writeText(exp.public_url);
                                  import('sonner').then(m => m.toast.success('Link copied!'));
                                }}
                              >
                                <Link2 className="h-3 w-3 mr-0.5" /> Copy Link
                              </Button>
                            </>
                          )}
                          {exp.status === 'failed' && (
                            <span className="text-destructive text-[10px] truncate max-w-[150px]">{exp.error}</span>
                          )}
                          {exp.meta?.missing_count > 0 && exp.status !== 'failed' && (
                            <span className="text-amber-500 text-[10px]">⚠ {exp.meta.missing_count} missing</span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1 ml-auto text-muted-foreground hover:text-destructive"
                            onClick={() => deleteExport.mutate(exp.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Animatic Builder */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Film className="h-4 w-4" />
                    Animatic
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Controls */}
                  <div className="flex gap-2 flex-wrap items-end">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Duration (ms)</Label>
                      <Input
                        type="number"
                        className="h-7 w-24 text-xs"
                        value={animaticDuration}
                        onChange={e => setAnimaticDuration(Number(e.target.value) || 900)}
                        min={200}
                        max={5000}
                        step={100}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">FPS</Label>
                      <Select value={String(animaticFps)} onValueChange={v => setAnimaticFps(Number(v))}>
                        <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12">12</SelectItem>
                          <SelectItem value="24">24</SelectItem>
                          <SelectItem value="30">30</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1.5 pb-0.5">
                      <Switch checked={animaticCaption} onCheckedChange={setAnimaticCaption} className="scale-75" />
                      <Label className="text-[10px]">Captions</Label>
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={createAnimaticRun.isPending || isRendering}
                      onClick={async () => {
                        const result = await createAnimaticRun.mutateAsync({
                          storyboardRunId: selectedRunId!,
                          options: { fps: animaticFps, default_duration_ms: animaticDuration, caption: animaticCaption },
                        });
                        if (result?.animaticRunId) {
                          setSelectedAnimaticId(result.animaticRunId);
                          renderAnimaticVideo(selectedRunId!, result.animaticRunId);
                        }
                      }}
                    >
                      {isRendering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Film className="h-3 w-3 mr-1" />}
                      Create Animatic
                    </Button>
                    {isRendering && (
                      <Button size="sm" variant="destructive" onClick={cancelRender}>
                        <Square className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>

                  {/* Render Progress */}
                  {isRendering && renderProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="default" className="text-[10px] animate-pulse">Rendering</Badge>
                        <span className="text-muted-foreground">{renderProgress.done}/{renderProgress.total} panels</span>
                      </div>
                      <Progress value={renderProgress.total > 0 ? (renderProgress.done / renderProgress.total) * 100 : 0} className="h-2" />
                    </div>
                  )}

                  {/* Video preview for selected animatic */}
                  {selectedAnimatic?.status === 'complete' && selectedAnimatic?.public_url && (
                    <div className="mt-2">
                      <video
                        controls
                        className="w-full rounded border border-border"
                        src={selectedAnimatic.public_url}
                      />
                    </div>
                  )}

                  {/* Animatic runs list */}
                  {animaticRuns.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Recent animatics:</p>
                      {animaticRuns.slice(0, 6).map((ar: any) => (
                        <div
                          key={ar.id}
                          onClick={() => setSelectedAnimaticId(ar.id)}
                          className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 cursor-pointer transition-colors ${
                            selectedAnimaticId === ar.id ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50 border border-transparent'
                          }`}
                        >
                          <Badge variant={
                            ar.status === 'complete' ? 'default' :
                            ar.status === 'failed' ? 'destructive' :
                            ar.status === 'rendering' || ar.status === 'uploading' ? 'secondary' : 'outline'
                          } className="text-[10px]">{ar.status}</Badge>
                          <span className="text-muted-foreground/60 text-[10px]">{new Date(ar.created_at).toLocaleString()}</span>
                          {ar.status === 'complete' && ar.public_url && (
                            <a href={ar.public_url} target="_blank" rel="noopener noreferrer" className="ml-auto" onClick={e => e.stopPropagation()}>
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]">
                                <ExternalLink className="h-3 w-3 mr-0.5" /> Open
                              </Button>
                            </a>
                          )}
                          {ar.status === 'failed' && (
                            <span className="text-destructive text-[10px] truncate max-w-[150px]">{ar.error}</span>
                          )}
                          {(ar.status === 'draft' || ar.status === 'failed') && !isRendering && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[10px] ml-auto"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAnimaticId(ar.id);
                                renderAnimaticVideo(selectedRunId!, ar.id);
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-0.5" /> Retry
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {panels.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                    Loading panels...
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {Object.entries(panelsByUnit).map(([unitKey, unitPanels]) => (
                    <Card key={unitKey}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2 cursor-pointer" onClick={() => toggleExpand(unitKey)}>
                          {expandedUnits.has(unitKey) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {unitKey}
                          <Badge variant="outline" className="text-[10px]">{unitPanels.length} panels</Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-[10px] h-6 px-2"
                            disabled={enqueue.isPending || isRenderRunning}
                            onClick={(e) => {
                              e.stopPropagation();
                              enqueue.mutate({ runId: selectedRunId!, unitKeys: [unitKey] }, {
                                onSuccess: (data: any) => { if (data.renderRunId) setActiveRenderRunId(data.renderRunId); },
                              });
                            }}
                          >
                            <Play className="h-2.5 w-2.5 mr-0.5" /> Render Unit
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      {expandedUnits.has(unitKey) && (
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {unitPanels.map(panel => (
                              <PanelCard
                                key={panel.id}
                                panel={panel}
                                projectId={projectId!}
                                onGenerate={(panelId, opts) => generateFrame.mutate({ panelId, ...opts })}
                                onRegenerate={(panelId, opts) => regenerateFrame.mutate({ panelId, ...opts })}
                                isGenerating={generateFrame.isPending || regenerateFrame.isPending}
                                selectedPanelId={selectedPanelId}
                                onSelect={setSelectedPanelId}
                                frames={selectedPanelId === panel.id ? (panelDetail?.frames || []) : []}
                              />
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelCard({
  panel,
  projectId,
  onGenerate,
  onRegenerate,
  isGenerating,
  selectedPanelId,
  onSelect,
  frames,
}: {
  panel: StoryboardPanel;
  projectId: string;
  onGenerate: (panelId: string, opts?: any) => void;
  onRegenerate: (panelId: string, opts?: any) => void;
  isGenerating: boolean;
  selectedPanelId?: string;
  onSelect: (id: string) => void;
  frames: any[];
}) {
  const [promptOverride, setPromptOverride] = useState('');
  const [negOverride, setNegOverride] = useState('');
  const payload = panel.panel_payload || {} as any;
  const isSelected = selectedPanelId === panel.id;

  return (
    <div
      className={`border rounded-lg p-3 space-y-2 cursor-pointer transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
      }`}
      onClick={() => onSelect(panel.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">#{panel.panel_index}</Badge>
          <Badge variant="secondary" className="text-[10px]">{payload.shot_type}</Badge>
          <Badge variant="secondary" className="text-[10px]">{payload.camera}</Badge>
        </div>
        <Badge variant={panel.status === 'generated' ? 'default' : panel.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
          {panel.status}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">{payload.action}</p>
      <p className="text-[10px] text-muted-foreground/70 italic line-clamp-1">{payload.mood} · {payload.lighting}</p>

      {/* Frame thumbnails */}
      {isSelected && frames.length > 0 && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          {frames.map((f: any) => (
            <img
              key={f.id}
              src={f.public_url}
              alt="frame"
              className="rounded border border-border w-full aspect-video object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {/* Actions */}
      {isSelected && (
        <div className="space-y-1.5 pt-1" onClick={e => e.stopPropagation()}>
          <Separator />
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="w-full text-xs">
                <Image className="h-3 w-3 mr-1" />
                {panel.status === 'generated' ? 'Regenerate Frame' : 'Generate Frame'}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-sm">Generate Frame — Panel #{panel.panel_index}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium">Original Prompt</label>
                  <p className="text-xs text-muted-foreground bg-muted p-2 rounded mt-1">{payload.prompt}</p>
                </div>
                <div>
                  <label className="text-xs font-medium">Prompt Override (optional)</label>
                  <Textarea
                    className="text-xs mt-1"
                    rows={3}
                    placeholder="Leave empty to use original prompt"
                    value={promptOverride}
                    onChange={e => setPromptOverride(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Negative Prompt Override (optional)</label>
                  <Textarea
                    className="text-xs mt-1"
                    rows={2}
                    placeholder="Leave empty to use original"
                    value={negOverride}
                    onChange={e => setNegOverride(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={isGenerating}
                  onClick={() => {
                    const opts: any = {};
                    if (promptOverride) opts.override_prompt = promptOverride;
                    if (negOverride) opts.override_negative = negOverride;
                    if (panel.status === 'generated') {
                      onRegenerate(panel.id, opts);
                    } else {
                      onGenerate(panel.id, opts);
                    }
                  }}
                >
                  {isGenerating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                  {panel.status === 'generated' ? 'Regenerate' : 'Generate'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

/**
 * Storyboard Pipeline v1 — Main page
 */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Layers, Image, RefreshCw, Check, Loader2, Camera, ChevronDown, ChevronRight, Play, Square, AlertTriangle, FileDown, Archive, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useCanonicalUnits, useStoryboardRuns, useStoryboardPanels, useStoryboardPanel, useStoryboardMutations } from '@/lib/storyboard/useStoryboard';
import { useRenderRuns, useRenderRun, useRenderMutations, useRenderWorker } from '@/lib/storyboardRender/useStoryboardRender';
import { useExports, useExportMutations } from '@/lib/storyboardExport/useStoryboardExport';
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

  const renderRun = renderRunDetail?.renderRun;
  const renderJobs = renderRunDetail?.jobs || [];
  const isRenderRunning = renderRun?.status === 'running';

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
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Unit Selector + Runs */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
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

          <Card>
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
              <Card>
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
                        <span className="text-muted-foreground">
                          {renderRun.succeeded}/{renderRun.total} done
                          {renderRun.failed > 0 && <span className="text-destructive ml-1">· {renderRun.failed} failed</span>}
                          {renderRun.running > 0 && <span className="text-primary ml-1">· {renderRun.running} in progress</span>}
                        </span>
                      </div>
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
                      ZIP Frames
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
                            exp.status === 'processing' ? 'secondary' : 'outline'
                          } className="text-[10px]">{exp.status}</Badge>
                          <span className="text-muted-foreground">{exp.export_type === 'pdf_contact_sheet' ? 'PDF' : 'ZIP'}</span>
                          <span className="text-muted-foreground/60 text-[10px]">{new Date(exp.created_at).toLocaleString()}</span>
                          {exp.status === 'complete' && exp.public_url && (
                            <a href={exp.public_url} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]">
                                <ExternalLink className="h-3 w-3 mr-0.5" /> Open
                              </Button>
                            </a>
                          )}
                          {exp.status === 'failed' && (
                            <span className="text-destructive text-[10px] truncate max-w-[150px]">{exp.error}</span>
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

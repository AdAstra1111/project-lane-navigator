/**
 * Visual Production Panel — Phase 5 UI for Shot Lists, Storyboards, Production Intelligence
 */
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVisualProduction } from '@/hooks/useVisualProduction';
import { useAiTrailerFactory } from '@/hooks/useAiTrailerFactory';
import { useGenerateFullShotPlan } from '@/hooks/useGenerateFullShotPlan';
import { AiShotHeatmapDashboard } from '@/components/shots/AiShotHeatmapDashboard';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  Loader2, Camera, Check, Film, Image, BarChart3,
  AlertTriangle, Clapperboard, Aperture, Move, Trash2, RotateCcw, X,
  Sparkles, Wand2,
} from 'lucide-react';
import { AiReadinessBadge } from '@/components/shots/AiReadinessBadge';
import { AiShotActionPanel } from '@/components/shots/AiShotActionPanel';
import type { SceneListItem } from '@/lib/scene-graph/types';

interface VisualProductionPanelProps {
  projectId: string;
  scenes: SceneListItem[];
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
}

export function VisualProductionPanel({ projectId, scenes, selectedSceneId, onSelectScene }: VisualProductionPanelProps) {
  const navigate = useNavigate();
  const vp = useVisualProduction(projectId, selectedSceneId);
  const ai = useAiTrailerFactory(projectId);
  const fullShotPlan = useGenerateFullShotPlan(projectId, scenes);
  const [vpTab, setVpTab] = useState<string>('shots');
  const [aiPanelShot, setAiPanelShot] = useState<any>(null);

  const selectedScene = useMemo(() => scenes.find(s => s.scene_id === selectedSceneId), [scenes, selectedSceneId]);

  // Shot status badge for scene list
  const getShotBadge = (sceneId: string) => {
    const sets = vp.shotSets.filter(s => s.scene_id === sceneId);
    if (sets.length === 0) return null;
    const approved = sets.some(s => s.status === 'approved');
    const stale = sets.some(s => s.status === 'stale');
    if (stale) return <Badge variant="outline" className="text-[7px] h-3.5 px-1 border-amber-500/30 text-amber-500">stale</Badge>;
    if (approved) return <Badge variant="outline" className="text-[7px] h-3.5 px-1 border-primary/30 text-primary">approved</Badge>;
    return <Badge variant="outline" className="text-[7px] h-3.5 px-1">draft</Badge>;
  };

  return (
    <div className="grid grid-cols-12 gap-3">
      {/* Header with AI Trailer Factory button */}
      <div className="col-span-12 flex items-center justify-end mb-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-6 text-[9px] gap-1 px-2"
          onClick={() => navigate(`/projects/${projectId}/ai-trailer`)}
        >
          <Film className="h-3 w-3" />
          AI Trailer Factory
        </Button>
      </div>

      {/* Scene List (left) */}
      <div className="col-span-3">
        <Card className="border-border/50">
          <CardHeader className="px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Scenes</span>
          </CardHeader>
          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="px-1 pb-1 space-y-0.5">
              {scenes.map((scene) => (
                <div
                  key={scene.scene_id}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                    selectedSceneId === scene.scene_id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => onSelectScene(scene.scene_id)}
                >
                  <span className="text-[10px] text-muted-foreground font-mono w-5 shrink-0">{scene.display_number}</span>
                  <span className="text-[11px] truncate flex-1">{scene.latest_version?.slugline || `Scene ${scene.display_number}`}</span>
                  {getShotBadge(scene.scene_id)}
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Center: Shot Plan + Storyboard */}
      <div className="col-span-6">
        <Tabs value={vpTab} onValueChange={setVpTab}>
          <TabsList className="w-full h-7">
            <TabsTrigger value="shots" className="text-[10px] flex-1 gap-1">
              <Clapperboard className="h-2.5 w-2.5" /> Shot Plan
            </TabsTrigger>
            <TabsTrigger value="storyboard" className="text-[10px] flex-1 gap-1">
              <Image className="h-2.5 w-2.5" /> Storyboard
            </TabsTrigger>
            <TabsTrigger value="ai-heatmap" className="text-[10px] flex-1 gap-1">
              <Sparkles className="h-2.5 w-2.5" /> AI Readiness
            </TabsTrigger>
            <TabsTrigger value="ai-trailer" className="text-[10px] flex-1 gap-1">
              <Film className="h-2.5 w-2.5" /> AI Trailer
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shots" className="mt-2">
            {/* Generate Full Shot Plan progress */}
            {fullShotPlan.isRunning && (
              <div className="mb-2">
                <StagedProgressBar
                  title="Generating Full Shot Plan"
                  stages={fullShotPlan.stages}
                  currentStageIndex={fullShotPlan.progress.stageIndex}
                  progressPercent={fullShotPlan.progress.progress}
                  etaSeconds={fullShotPlan.progress.etaSeconds}
                  detailMessage={fullShotPlan.progress.detail}
                />
              </div>
            )}
            <ShotPlanPanel
              projectId={projectId}
              scene={selectedScene || null}
              shotSets={vp.shotSets}
              shots={vp.shots}
              staleSets={vp.staleSets}
              onGenerate={(mode) => vp.generateShots.mutateAsync({ mode })}
              onApproveSet={(id) => vp.approveShotSet.mutateAsync(id)}
              isGenerating={vp.generateShots.isPending}
              isLoading={vp.isLoadingShots}
              onGenerateFullPlan={() => fullShotPlan.generateFullShotPlan.mutate()}
              isGeneratingFullPlan={fullShotPlan.isRunning}
              hasScenes={scenes.length > 0}
            />
          </TabsContent>

          <TabsContent value="storyboard" className="mt-2">
            <StoryboardPanel
              projectId={projectId}
              frames={vp.frames}
              shots={vp.shots}
              onGenerateFrames={(shotId) => vp.generateFrames.mutateAsync({ shotId, frameCount: 1 })}
              onApproveFrame={(frameId) => vp.approveFrame.mutateAsync(frameId)}
              onDeleteFrame={vp.deleteFrame ? (frameId) => vp.deleteFrame!.mutateAsync(frameId) : undefined}
              onRestoreFrame={vp.restoreFrame ? (frameId) => vp.restoreFrame!.mutateAsync(frameId) : undefined}
              isGenerating={vp.generateFrames.isPending}
              isLoading={vp.isLoadingFrames}
              hasScene={!!selectedSceneId}
            />
          </TabsContent>

          <TabsContent value="ai-heatmap" className="mt-2">
            <AiShotHeatmapDashboard projectId={projectId} />
          </TabsContent>

          <TabsContent value="ai-trailer" className="mt-2">
            <Card className="border-border/50">
              <CardContent className="p-6 text-center space-y-3">
                <Film className="h-8 w-8 mx-auto text-primary/60" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">AI Trailer Factory</p>
                  <p className="text-xs text-muted-foreground">
                    Build a pitch-ready taster trailer from your script using AI-generated storyboard frames and motion stills.
                  </p>
                </div>
                <Button size="sm" className="text-xs gap-1" onClick={() => navigate(`/projects/${projectId}/ai-trailer`)}>
                  <Film className="h-3 w-3" /> Open AI Trailer Factory
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right: Production Dashboard */}
      <div className="col-span-3">
        <ProductionDashboard
          breakdown={vp.breakdown}
          onCompute={() => vp.computeBreakdown.mutateAsync({})}
          isComputing={vp.computeBreakdown.isPending}
          isLoading={vp.isLoadingBreakdown}
        />
      </div>

      {/* AI Shot Action Panel */}
      <AiShotActionPanel
        open={!!aiPanelShot}
        onClose={() => setAiPanelShot(null)}
        shot={aiPanelShot}
        media={ai.media}
        onLabelReadiness={() => {
          if (aiPanelShot) ai.labelReadiness.mutate(aiPanelShot.id);
        }}
        onGenerateFrame={() => {
          if (aiPanelShot) ai.generateFrames.mutate({
            shotId: aiPanelShot.id,
            options: { variations: 1 },
          });
        }}
        onMotionStill={() => {
          if (aiPanelShot) ai.generateMotionStill.mutate({
            shotId: aiPanelShot.id,
          });
        }}
        isLabeling={ai.labelReadiness.isPending}
        isGenerating={ai.generateFrames.isPending || ai.generateMotionStill.isPending}
      />
    </div>
  );
}

// ── Shot Plan Panel ──

function ShotPlanPanel({ projectId, scene, shotSets, shots, staleSets, onGenerate, onApproveSet, isGenerating, isLoading, onGenerateFullPlan, isGeneratingFullPlan, hasScenes }: {
  projectId: string;
  scene: SceneListItem | null;
  shotSets: any[];
  shots: any[];
  staleSets: any[];
  onGenerate: (mode: 'coverage' | 'cinematic' | 'efficiency') => void;
  onApproveSet: (id: string) => void;
  isGenerating: boolean;
  isLoading: boolean;
  onGenerateFullPlan?: () => void;
  isGeneratingFullPlan?: boolean;
  hasScenes?: boolean;
}) {
  if (!scene) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-xs text-muted-foreground">Select a scene to manage shot plans</p>
          {onGenerateFullPlan && hasScenes && (
            <div className="pt-2 border-t border-border/30">
              <Button
                size="sm"
                variant="default"
                className="text-[9px] gap-1 h-7"
                onClick={onGenerateFullPlan}
                disabled={isGeneratingFullPlan}
              >
                {isGeneratingFullPlan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Generate Full Shot Plan
              </Button>
              <p className="text-[9px] text-muted-foreground mt-1">Create structured shots for entire script</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1">
            <Clapperboard className="h-3.5 w-3.5" />
            Scene {scene.display_number} — Shot Plan
          </CardTitle>
          <div className="flex items-center gap-1">
            {['coverage', 'cinematic', 'efficiency'].map(mode => (
              <Button key={mode} size="sm" variant="outline" className="h-6 text-[9px] px-1.5"
                onClick={() => onGenerate(mode as any)} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Camera className="h-2.5 w-2.5" />}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {shotSets.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {shotSets.map(ss => (
              <div key={ss.id} className="flex items-center gap-1">
                <Badge variant={ss.status === 'approved' ? 'default' : ss.status === 'stale' ? 'outline' : 'secondary'} className="text-[8px]">
                  {ss.mode} / {ss.status}
                </Badge>
                {ss.status === 'draft' && (
                  <Button size="sm" variant="ghost" className="h-5 text-[8px] px-1" onClick={() => onApproveSet(ss.id)}>
                    <Check className="h-2.5 w-2.5" /> Approve
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {staleSets.length > 0 && (
          <div className="p-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-[9px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {staleSets.length} stale shot set(s) from prior scene versions
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : shots.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No shots yet. Generate a shot plan above.</p>
        ) : (
          <ScrollArea className="max-h-[350px]">
            <div className="space-y-1">
              {shots.map((shot, i) => (
                <div key={shot.id} className={`p-1.5 rounded border text-[10px] ${
                  shot.status === 'stale' ? 'border-amber-500/30 bg-amber-500/5 opacity-60' :
                  shot.status === 'approved' ? 'border-primary/30 bg-primary/5' :
                  'border-border/50 bg-muted/10'
                }`}>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-mono text-muted-foreground">{shot.shot_number || i + 1}</span>
                    <Badge variant="outline" className="text-[7px] h-3.5 px-1">{shot.coverage_role || shot.shot_type}</Badge>
                    <Badge variant="outline" className="text-[7px] h-3.5 px-1">{shot.framing || '—'}</Badge>
                    {shot.lens_mm && <Badge variant="outline" className="text-[7px] h-3.5 px-1">{shot.lens_mm}mm</Badge>}
                    {shot.camera_movement && shot.camera_movement !== 'static' && (
                      <Badge variant="outline" className="text-[7px] h-3.5 px-1 gap-0.5"><Move className="h-2 w-2" />{shot.camera_movement}</Badge>
                    )}
                    <AiReadinessBadge
                      tier={shot.ai_readiness_tier}
                      confidence={shot.ai_confidence}
                      maxQuality={shot.ai_max_quality}
                      blockingConstraints={shot.ai_blocking_constraints}
                      requiredAssets={shot.ai_required_assets}
                      legalRiskFlags={shot.ai_legal_risk_flags}
                      costBand={shot.ai_estimated_cost_band}
                      compact
                    />
                    <Badge variant={shot.status === 'approved' ? 'default' : 'secondary'} className="text-[7px] h-3.5 px-1 ml-auto">
                      {shot.status}
                    </Badge>
                  </div>
                  {shot.composition_notes && <p className="text-muted-foreground mt-0.5">{shot.composition_notes}</p>}
                  {shot.emotional_intent && <p className="text-muted-foreground italic">Intent: {shot.emotional_intent}</p>}
                  {(shot.characters_in_frame || []).length > 0 && (
                    <p className="text-muted-foreground">Chars: {shot.characters_in_frame.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ── Storyboard Panel ──

function StoryboardPanel({ projectId, frames, shots, onGenerateFrames, onApproveFrame, onDeleteFrame, onRestoreFrame, isGenerating, isLoading, hasScene }: {
  projectId: string;
  frames: any[];
  shots: any[];
  onGenerateFrames: (shotId: string) => Promise<any>;
  onApproveFrame: (frameId: string) => void;
  onDeleteFrame?: (frameId: string) => Promise<any>;
  onRestoreFrame?: (frameId: string) => Promise<any>;
  isGenerating: boolean;
  isLoading: boolean;
  hasScene: boolean;
}) {
  const [previewFrame, setPreviewFrame] = useState<any | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [genAllProgress, setGenAllProgress] = useState({ done: 0, total: 0 });
  const [deletedFrameIds, setDeletedFrameIds] = useState<Set<string>>(new Set());

  const handleGenerateAll = useCallback(async () => {
    if (!shots.length || isGeneratingAll || isGenerating) return;
    const shotsNeedingFrames = shots.filter(shot => {
      const existing = frames.filter(f => f.shot_id === shot.id && !deletedFrameIds.has(f.id));
      return existing.length === 0;
    });
    const toGenerate = shotsNeedingFrames.length > 0 ? shotsNeedingFrames : shots;
    setIsGeneratingAll(true);
    setGenAllProgress({ done: 0, total: toGenerate.length });
    for (let i = 0; i < toGenerate.length; i++) {
      try {
        await onGenerateFrames(toGenerate[i].id);
      } catch (e) {
        console.error(`Gen frame failed for shot ${toGenerate[i].id}:`, e);
      }
      setGenAllProgress({ done: i + 1, total: toGenerate.length });
    }
    setIsGeneratingAll(false);
    toast.success(`Generated frames for ${toGenerate.length} shots`);
  }, [shots, frames, deletedFrameIds, isGeneratingAll, isGenerating, onGenerateFrames]);

  const groupedFrames = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const f of frames) {
      if (deletedFrameIds.has(f.id)) continue;
      if (!map.has(f.shot_id)) map.set(f.shot_id, []);
      map.get(f.shot_id)!.push(f);
    }
    return map;
  }, [frames, deletedFrameIds]);

  const handleDelete = useCallback(async (frame: any) => {
    if (!onDeleteFrame) return;
    // Optimistic removal
    setDeletedFrameIds(prev => new Set(prev).add(frame.id));
    
    try {
      await onDeleteFrame(frame.id);
      toast('Frame deleted', {
        action: onRestoreFrame ? {
          label: 'Undo',
          onClick: async () => {
            try {
              await onRestoreFrame(frame.id);
              setDeletedFrameIds(prev => {
                const next = new Set(prev);
                next.delete(frame.id);
                return next;
              });
              toast.success('Frame restored');
            } catch {
              toast.error('Restore failed');
            }
          },
        } : undefined,
        duration: 8000,
      });
    } catch {
      // Revert optimistic removal
      setDeletedFrameIds(prev => {
        const next = new Set(prev);
        next.delete(frame.id);
        return next;
      });
      toast.error('Delete failed');
    }
  }, [onDeleteFrame, onRestoreFrame]);

  if (!hasScene) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 text-center">
          <p className="text-xs text-muted-foreground">Select a scene to view storyboards</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card className="border-border/50">
        <CardHeader className="px-3 py-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1">
              <Image className="h-3.5 w-3.5" /> Storyboard Frames
            </CardTitle>
            {shots.length > 0 && (
              <Button size="sm" variant="outline" className="h-5 text-[8px] px-2 gap-1"
                onClick={handleGenerateAll} disabled={isGenerating || isGeneratingAll}>
                {isGeneratingAll ? (
                  <>
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {genAllProgress.done}/{genAllProgress.total}
                  </>
                ) : (
                  <>
                    <Camera className="h-2.5 w-2.5" />
                    Generate All
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : shots.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Generate a shot plan first to create storyboard frames.</p>
          ) : (
            <ScrollArea className="h-[calc(100vh-400px)] min-h-[200px]">
              <div className="space-y-2 pr-2">
                {shots.slice(0, 50).map((shot, i) => {
                  const shotFrames = groupedFrames.get(shot.id) || [];
                  return (
                    <div key={shot.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-muted-foreground font-mono">
                          Shot {shot.shot_number || i + 1} — {shot.coverage_role || shot.shot_type} {shot.framing || ''}
                        </span>
                        <Button size="sm" variant="ghost" className="h-5 text-[8px] px-1.5 gap-0.5"
                          onClick={() => onGenerateFrames(shot.id)} disabled={isGenerating}>
                          {isGenerating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Aperture className="h-2.5 w-2.5" />}
                          Gen Frame
                        </Button>
                      </div>
                      {shotFrames.length > 0 ? (
                        <div className="grid grid-cols-3 gap-1">
                          {shotFrames.map(f => (
                            <div key={f.id} className={`group relative rounded border p-1 text-[8px] ${
                              f.is_stale ? 'border-amber-500/30 bg-amber-500/5' :
                              f.status === 'approved' ? 'border-primary/30 bg-primary/5' :
                              f.status === 'failed' ? 'border-destructive/30 bg-destructive/5' :
                              'border-border/50 bg-muted/10'
                            }`}>
                              {f.status === 'generating' ? (
                                <div className="w-full aspect-[2.39/1] bg-muted/30 rounded flex items-center justify-center">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              ) : f.status === 'failed' ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="w-full aspect-[2.39/1] bg-destructive/10 rounded flex flex-col items-center justify-center gap-1 cursor-help">
                                      <AlertTriangle className="h-3 w-3 text-destructive" />
                                      <span className="text-[7px] text-destructive">Failed</span>
                                      <Button size="sm" variant="ghost" className="h-4 text-[7px] px-1"
                                        onClick={() => onGenerateFrames(shot.id)}>
                                        <RotateCcw className="h-2 w-2 mr-0.5" /> Retry
                                      </Button>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent><p className="text-xs max-w-[200px]">{f.error || 'Generation failed'}</p></TooltipContent>
                                </Tooltip>
                              ) : f.image_url ? (
                                <img 
                                  src={`${f.image_url}${f.image_url.includes('?') ? '&' : '?'}v=${f.created_at}`} 
                                  alt="" 
                                  className="w-full aspect-[2.39/1] object-cover rounded cursor-pointer hover:opacity-90 transition-opacity" 
                                  onClick={() => setPreviewFrame(f)}
                                  onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).classList.add('hidden'); }}
                                />
                              ) : (
                                <div className="w-full aspect-[2.39/1] bg-muted/30 rounded flex items-center justify-center">
                                  <Film className="h-4 w-4 text-muted-foreground/30" />
                                </div>
                              )}
                              {/* Delete button */}
                              {onDeleteFrame && f.status !== 'generating' && (
                                <button 
                                  className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 rounded p-0.5"
                                  onClick={(e) => { e.stopPropagation(); handleDelete(f); }}
                                >
                                  <Trash2 className="h-2.5 w-2.5 text-destructive" />
                                </button>
                              )}
                              <div className="flex items-center justify-between mt-0.5">
                                <Badge variant={f.is_stale ? 'outline' : f.status === 'approved' ? 'default' : 'secondary'} className="text-[6px] h-3 px-0.5">
                                  {f.is_stale ? 'stale' : f.status}
                                </Badge>
                                {f.status !== 'approved' && !f.is_stale && f.status !== 'failed' && (
                                  <button className="text-[7px] text-primary underline" onClick={() => onApproveFrame(f.id)}>Approve</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[8px] text-muted-foreground pl-2">No frames yet</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Dialog open={!!previewFrame} onOpenChange={(open) => !open && setPreviewFrame(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          {previewFrame && (
            <div className="space-y-2 p-4">
              {previewFrame.image_url && (
                <img 
                  src={previewFrame.image_url} 
                  alt="" 
                  className="w-full rounded-lg object-contain max-h-[60vh]" 
                />
              )}
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Prompt</p>
                <p className="text-[10px] leading-relaxed">{previewFrame.prompt}</p>
                <p className="text-[9px]">Created: {new Date(previewFrame.created_at).toLocaleString()}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

// ── Production Dashboard ──

function ProductionDashboard({ breakdown, onCompute, isComputing, isLoading }: {
  breakdown: any | null;
  onCompute: () => void;
  isComputing: boolean;
  isLoading: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="px-2 py-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Production</span>
          </div>
          <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={onCompute} disabled={isComputing}>
            {isComputing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <BarChart3 className="h-2.5 w-2.5" />}
            Compute
          </Button>
        </div>
      </CardHeader>
      <ScrollArea className="max-h-[450px]">
        <CardContent className="px-2 pb-2 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : !breakdown ? (
            <p className="text-[10px] text-muted-foreground text-center py-4">Click "Compute" to generate production breakdown.</p>
          ) : (
            <>
              {breakdown.created_at && (
                <p className="text-[9px] text-muted-foreground">Last: {new Date(breakdown.created_at).toLocaleString()}</p>
              )}
              <div className="grid grid-cols-2 gap-1">
                <StatCard label="Scenes" value={breakdown.totals?.total_scenes || 0} />
                <StatCard label="Setups" value={breakdown.totals?.total_setups || 0} />
                <StatCard label="Est. Time" value={`${breakdown.totals?.total_time_mins || 0}m`} />
                <StatCard label="Cast" value={breakdown.totals?.total_cast || 0} />
                <StatCard label="Locations" value={breakdown.totals?.total_locations || 0} />
                <StatCard label="VFX Scenes" value={breakdown.totals?.vfx_scenes || 0} />
              </div>

              {breakdown.suggestions && breakdown.suggestions.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Optimization Suggestions</p>
                  {breakdown.suggestions.map((s: any, i: number) => (
                    <div key={i} className="p-1.5 rounded border border-border/50 bg-muted/10 text-[10px] space-y-1">
                      <Badge variant="outline" className="text-[7px] h-3.5 px-1">{s.type?.replace(/_/g, ' ') || 'suggestion'}</Badge>
                      <p className="text-muted-foreground">{s.rationale}</p>
                    </div>
                  ))}
                </>
              )}

              {breakdown.per_scene && breakdown.per_scene.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Per-Scene Breakdown</p>
                  <div className="space-y-0.5">
                    {breakdown.per_scene.slice(0, 30).map((ps: any, i: number) => (
                      <div key={i} className="flex items-center gap-1 text-[9px] px-1 py-0.5 rounded hover:bg-muted/30">
                        <span className="font-mono text-muted-foreground w-4">{i + 1}</span>
                        <span className="flex-1 truncate">{ps.locations?.[0] || '—'}</span>
                        <Badge variant="outline" className="text-[7px] h-3 px-0.5">{ps.day_night}</Badge>
                        <span className="text-muted-foreground">{ps.est_setup_count}s</span>
                        <span className="text-muted-foreground">{ps.est_time}m</span>
                        {ps.flags?.vfx && <Badge variant="outline" className="text-[6px] h-3 px-0.5 border-purple-500/30 text-purple-400">VFX</Badge>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-1.5 rounded border border-border/50 bg-muted/10">
      <span className="text-[9px] text-muted-foreground block">{label}</span>
      <span className="text-[13px] font-bold font-mono">{value}</span>
    </div>
  );
}

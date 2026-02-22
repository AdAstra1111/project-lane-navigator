import { useState, useMemo } from 'react';
import { useSceneGraph } from '@/hooks/useSceneGraph';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Loader2, Plus, Trash2, ArrowUp, ArrowDown, Scissors, Merge,
  Check, FileText, AlertTriangle, ChevronRight, GripVertical,
  Camera, Download, RotateCw, Undo2, Archive, RefreshCw,
  CheckCircle, XCircle, Play, History,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SceneListItem, ImpactWarning, PatchQueueItem, InactiveSceneItem, SceneGraphAction } from '@/lib/scene-graph/types';

interface SceneGraphPanelProps {
  projectId: string;
  documents?: any[];
}

export function SceneGraphPanel({ projectId, documents }: SceneGraphPanelProps) {
  const sg = useSceneGraph(projectId);
  const [editingContent, setEditingContent] = useState('');
  const [editingSlugline, setEditingSlugline] = useState('');
  const [editingSummary, setEditingSummary] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [insertPosition, setInsertPosition] = useState<{ afterSceneId?: string; beforeSceneId?: string }>({});
  const [newSlugline, setNewSlugline] = useState('');
  const [newContent, setNewContent] = useState('');
  const [showSnapshotView, setShowSnapshotView] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showInactiveDrawer, setShowInactiveDrawer] = useState(false);
  const [showActionHistory, setShowActionHistory] = useState(false);
  const [rightTab, setRightTab] = useState<string>('impact');

  const selectedScene = useMemo(() => {
    return sg.scenes.find(s => s.scene_id === sg.selectedSceneId) || null;
  }, [sg.scenes, sg.selectedSceneId]);

  const selectScene = (sceneId: string) => {
    if (isDirty) {
      if (!confirm('You have unsaved changes. Discard?')) return;
    }
    sg.setSelectedSceneId(sceneId);
    const scene = sg.scenes.find(s => s.scene_id === sceneId);
    const v = scene?.latest_version;
    setEditingContent(v?.content || '');
    setEditingSlugline(v?.slugline || '');
    setEditingSummary(v?.summary || '');
    setIsDirty(false);
  };

  const handleSave = async () => {
    if (!sg.selectedSceneId) return;
    await sg.update.mutateAsync({
      sceneId: sg.selectedSceneId,
      patch: { content: editingContent, slugline: editingSlugline, summary: editingSummary },
    });
    setIsDirty(false);
  };

  const handleExtract = async (docId?: string) => {
    await sg.extract.mutateAsync({ sourceDocumentId: docId, text: pasteText || undefined });
    setPasteText('');
  };

  const handleInsert = async () => {
    await sg.insert.mutateAsync({
      position: insertPosition,
      sceneDraft: { slugline: newSlugline, content: newContent },
    });
    setShowInsertDialog(false);
    setNewSlugline('');
    setNewContent('');
  };

  const handleRemove = async (sceneId: string) => {
    if (!confirm('Remove this scene from active ordering? (Can be restored)')) return;
    await sg.remove.mutateAsync(sceneId);
    if (sg.selectedSceneId === sceneId) sg.setSelectedSceneId(null);
  };

  const handleMove = async (sceneId: string, direction: 'up' | 'down') => {
    const idx = sg.scenes.findIndex(s => s.scene_id === sceneId);
    if (idx < 0) return;
    if (direction === 'up' && idx > 0) {
      const beforeScene = idx > 1 ? sg.scenes[idx - 2] : null;
      await sg.move.mutateAsync({
        sceneId,
        position: { afterSceneId: beforeScene?.scene_id, beforeSceneId: sg.scenes[idx - 1].scene_id },
      });
    } else if (direction === 'down' && idx < sg.scenes.length - 1) {
      const afterScene = sg.scenes[idx + 1];
      const nextAfter = idx + 2 < sg.scenes.length ? sg.scenes[idx + 2] : null;
      await sg.move.mutateAsync({
        sceneId,
        position: { afterSceneId: afterScene.scene_id, beforeSceneId: nextAfter?.scene_id },
      });
    }
  };

  const handleRebuild = async () => {
    await sg.rebuild.mutateAsync({ mode: 'latest', label: `Rebuild ${new Date().toLocaleTimeString()}` });
    setShowSnapshotView(true);
  };

  const handleUndo = async () => {
    if (!sg.lastActionId) return;
    await sg.undo.mutateAsync(sg.lastActionId);
  };

  // ── Empty state ──
  if (!sg.projectState?.has_scenes && !sg.isLoading) {
    const scriptDoc = (documents || []).find((d: any) =>
      d.doc_type === 'script' || d.doc_type === 'feature_script' || d.doc_type === 'episode_script' || d.doc_type === 'script_pdf' || d.doc_type === 'treatment'
    );
    return (
      <div className="space-y-4">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scissors className="h-4 w-4" /> Scene Graph
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Break your script into individual scenes for granular editing, reordering, and impact analysis.
            </p>
            {scriptDoc && (
              <Button size="sm" className="w-full gap-2" onClick={() => handleExtract(scriptDoc.id)} disabled={sg.extract.isPending}>
                {sg.extract.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                Extract Scenes from "{scriptDoc.file_name || 'Script'}"
              </Button>
            )}
            <Separator />
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Or paste script text</p>
              <Textarea placeholder="Paste script text here..." className="text-xs min-h-[80px]" value={pasteText} onChange={e => setPasteText(e.target.value)} />
              <Button size="sm" variant="outline" className="w-full gap-2" onClick={() => handleExtract()} disabled={sg.extract.isPending || !pasteText.trim()}>
                {sg.extract.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                Extract from Pasted Text
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sg.isLoading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // ── Main Scene Graph UI ──
  return (
    <div className="space-y-3">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px]">{sg.scenes.length} scenes</Badge>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleRebuild} disabled={sg.rebuild.isPending}>
          {sg.rebuild.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          Rebuild Snapshot
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowSnapshotView(!showSnapshotView)}>
          <Download className="h-3 w-3" />
          {showSnapshotView ? 'Scene View' : 'Full Script'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowInactiveDrawer(true)}>
          <Archive className="h-3 w-3" />
          Inactive ({sg.inactiveScenes.length})
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowActionHistory(true)}>
          <History className="h-3 w-3" />
          History
        </Button>
        {sg.lastActionId && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleUndo} disabled={sg.undo.isPending}>
            {sg.undo.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
            Undo
          </Button>
        )}
      </div>

      {showSnapshotView ? (
        <SnapshotView projectId={projectId} />
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {/* Scene List (left) */}
          <div className="col-span-4">
            <Card className="border-border/50">
              <CardHeader className="px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Scenes</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setInsertPosition({}); setShowInsertDialog(true); }}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <ScrollArea className="max-h-[500px]">
                <div className="px-1 pb-1 space-y-0.5">
                  {sg.scenes.map((scene, idx) => (
                    <SceneListRow
                      key={scene.scene_id}
                      scene={scene}
                      index={idx}
                      isSelected={sg.selectedSceneId === scene.scene_id}
                      onSelect={() => selectScene(scene.scene_id)}
                      onMoveUp={() => handleMove(scene.scene_id, 'up')}
                      onMoveDown={() => handleMove(scene.scene_id, 'down')}
                      onRemove={() => handleRemove(scene.scene_id)}
                      onInsertAfter={() => { setInsertPosition({ afterSceneId: scene.scene_id }); setShowInsertDialog(true); }}
                      isFirst={idx === 0}
                      isLast={idx === sg.scenes.length - 1}
                    />
                  ))}
                </div>
              </ScrollArea>
            </Card>
          </div>

          {/* Scene Editor (middle) */}
          <div className="col-span-5">
            {selectedScene ? (
              <Card className="border-border/50">
                <CardHeader className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs">Scene {selectedScene.display_number}</CardTitle>
                    <div className="flex items-center gap-1">
                      <Badge variant={selectedScene.approval_status === 'approved' ? 'default' : 'secondary'} className="text-[9px]">
                        {selectedScene.approval_status}
                      </Badge>
                      {selectedScene.latest_version && selectedScene.approval_status !== 'approved' && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                          onClick={() => sg.approve.mutateAsync(selectedScene.latest_version!.id)} disabled={sg.approve.isPending}>
                          <Check className="h-3 w-3" /> Approve
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {sg.scenes[selectedScene.display_number - 2] && (
                    <div className="text-[9px] text-muted-foreground p-1.5 rounded bg-muted/30 border">
                      ← Prev: {sg.scenes[selectedScene.display_number - 2]?.latest_version?.slugline || 'Scene ' + (selectedScene.display_number - 1)}
                    </div>
                  )}
                  <Input placeholder="Slugline (e.g. INT. OFFICE - DAY)" className="h-7 text-xs font-mono" value={editingSlugline}
                    onChange={e => { setEditingSlugline(e.target.value); setIsDirty(true); }} />
                  <Textarea placeholder="Scene content..." className="text-xs min-h-[250px] font-mono leading-relaxed" value={editingContent}
                    onChange={e => { setEditingContent(e.target.value); setIsDirty(true); }} />
                  <Input placeholder="Summary (optional)" className="h-7 text-xs" value={editingSummary}
                    onChange={e => { setEditingSummary(e.target.value); setIsDirty(true); }} />
                  {sg.scenes[selectedScene.display_number] && (
                    <div className="text-[9px] text-muted-foreground p-1.5 rounded bg-muted/30 border">
                      → Next: {sg.scenes[selectedScene.display_number]?.latest_version?.slugline || 'Scene ' + (selectedScene.display_number + 1)}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={!isDirty || sg.update.isPending}>
                      {sg.update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Draft'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                      if (!confirm('Discard changes?')) return;
                      const v = selectedScene.latest_version;
                      setEditingContent(v?.content || '');
                      setEditingSlugline(v?.slugline || '');
                      setEditingSummary(v?.summary || '');
                      setIsDirty(false);
                    }}>Discard</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/50">
                <CardContent className="p-6 text-center">
                  <p className="text-xs text-muted-foreground">Select a scene to edit</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel: Impact + Patches */}
          <div className="col-span-3">
            <Tabs value={rightTab} onValueChange={setRightTab}>
              <TabsList className="w-full h-7">
                <TabsTrigger value="impact" className="text-[10px] flex-1">Impact</TabsTrigger>
                <TabsTrigger value="patches" className="text-[10px] flex-1">
                  Patches {sg.patchQueue.filter(p => p.status === 'open').length > 0 && (
                    <Badge variant="destructive" className="ml-1 text-[8px] h-4 px-1">{sg.patchQueue.filter(p => p.status === 'open').length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="impact" className="mt-2">
                <ImpactPanel impact={sg.lastImpact} />
              </TabsContent>
              <TabsContent value="patches" className="mt-2">
                <PatchQueuePanel
                  patches={sg.patchQueue}
                  onAccept={(id) => sg.acceptPatch.mutateAsync(id)}
                  onReject={(id) => sg.rejectPatch.mutateAsync(id)}
                  onApply={(id, mode) => sg.applyPatch.mutateAsync({ patchQueueId: id, mode })}
                  isLoading={sg.acceptPatch.isPending || sg.rejectPatch.isPending || sg.applyPatch.isPending}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}

      {/* Insert Scene Dialog */}
      <Dialog open={showInsertDialog} onOpenChange={setShowInsertDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Insert Scene</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Slugline (e.g. EXT. PARK - NIGHT)" className="text-xs" value={newSlugline} onChange={e => setNewSlugline(e.target.value)} />
            <Textarea placeholder="Scene content..." className="text-xs min-h-[120px] font-mono" value={newContent} onChange={e => setNewContent(e.target.value)} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowInsertDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleInsert} disabled={sg.insert.isPending}>
              {sg.insert.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Insert'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inactive Scenes Drawer */}
      <Dialog open={showInactiveDrawer} onOpenChange={setShowInactiveDrawer}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><Archive className="h-4 w-4" /> Inactive Scenes</DialogTitle></DialogHeader>
          <InactiveScenesPanel
            scenes={sg.inactiveScenes}
            onRestore={(sceneId, position) => sg.restore.mutateAsync({ sceneId, position })}
            isLoading={sg.restore.isPending}
            activeScenes={sg.scenes}
          />
        </DialogContent>
      </Dialog>

      {/* Action History Dialog */}
      <Dialog open={showActionHistory} onOpenChange={setShowActionHistory}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" /> Action History</DialogTitle></DialogHeader>
          <ActionHistoryPanel
            actions={sg.recentActions}
            onUndo={(actionId) => sg.undo.mutateAsync(actionId)}
            isLoading={sg.undo.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──

function SceneListRow({
  scene, index, isSelected, onSelect, onMoveUp, onMoveDown, onRemove, onInsertAfter, isFirst, isLast,
}: {
  scene: SceneListItem; index: number; isSelected: boolean;
  onSelect: () => void; onMoveUp: () => void; onMoveDown: () => void;
  onRemove: () => void; onInsertAfter: () => void;
  isFirst: boolean; isLast: boolean;
}) {
  const slug = scene.latest_version?.slugline || `Scene ${scene.display_number}`;
  const truncSlug = slug.length > 40 ? slug.slice(0, 37) + '...' : slug;

  return (
    <div
      className={`group flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground font-mono w-5 shrink-0">{scene.display_number}</span>
          <span className="text-[11px] truncate">{truncSlug}</span>
        </div>
      </div>
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        {!isFirst && (
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} className="p-0.5 hover:bg-background rounded">
            <ArrowUp className="h-2.5 w-2.5" />
          </button>
        )}
        {!isLast && (
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} className="p-0.5 hover:bg-background rounded">
            <ArrowDown className="h-2.5 w-2.5" />
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onInsertAfter(); }} className="p-0.5 hover:bg-background rounded">
          <Plus className="h-2.5 w-2.5" />
        </button>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="p-0.5 hover:bg-background rounded text-destructive">
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
      {scene.approval_status === 'approved' && (
        <Check className="h-3 w-3 text-primary shrink-0" />
      )}
    </div>
  );
}

function ImpactPanel({ impact }: { impact: { warnings: ImpactWarning[]; suggested_patches: any[] } | null }) {
  if (!impact) {
    return (
      <Card className="border-border/50">
        <CardHeader className="px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Impact Analysis</span>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <p className="text-[10px] text-muted-foreground">Modify scenes to see impact warnings here.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-border/50">
      <CardHeader className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Impact ({impact.warnings.length} warning{impact.warnings.length !== 1 ? 's' : ''})
          </span>
        </div>
      </CardHeader>
      <ScrollArea className="max-h-[400px]">
        <CardContent className="px-2 pb-2 space-y-1.5">
          {impact.warnings.map((w, i) => (
            <div key={i} className={`p-1.5 rounded text-[10px] border ${
              w.severity === 'high' ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : w.severity === 'med' ? 'border-accent/50 bg-accent/10 text-accent-foreground'
              : 'border-muted bg-muted/30 text-muted-foreground'
            }`}>
              <div className="flex items-center gap-1 mb-0.5">
                <Badge variant="outline" className="text-[8px] h-4 px-1">{w.type}</Badge>
                <Badge variant="outline" className="text-[8px] h-4 px-1">{w.severity}</Badge>
              </div>
              <p className="leading-relaxed">{w.message}</p>
            </div>
          ))}
          {impact.suggested_patches.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Suggested Patches</p>
              {impact.suggested_patches.map((p: any, i: number) => (
                <div key={i} className="p-1.5 rounded border border-border/50 bg-muted/20 text-[10px]">
                  <p className="font-medium">{p.suggestion}</p>
                  <p className="text-muted-foreground mt-0.5">{p.rationale}</p>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

function PatchQueuePanel({ patches, onAccept, onReject, onApply, isLoading }: {
  patches: PatchQueueItem[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onApply: (id: string, mode: 'draft' | 'propose') => void;
  isLoading: boolean;
}) {
  if (patches.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 text-center">
          <p className="text-[10px] text-muted-foreground">No patch suggestions yet. They appear when high-severity impact warnings are detected.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-border/50">
      <ScrollArea className="max-h-[400px]">
        <CardContent className="px-2 py-2 space-y-2">
          {patches.map(p => (
            <div key={p.id} className="p-2 rounded border border-border/50 bg-muted/10 text-[10px] space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Badge variant={
                  p.status === 'open' ? 'secondary' :
                  p.status === 'accepted' ? 'default' :
                  p.status === 'applied' ? 'default' : 'outline'
                } className="text-[8px] h-4 px-1">
                  {p.status}
                </Badge>
              </div>
              <p className="font-medium">{p.suggestion}</p>
              {p.rationale && <p className="text-muted-foreground">{p.rationale}</p>}
              {p.status === 'open' && (
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onAccept(p.id)} disabled={isLoading}>
                    <CheckCircle className="h-2.5 w-2.5" /> Accept
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onReject(p.id)} disabled={isLoading}>
                    <XCircle className="h-2.5 w-2.5" /> Reject
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onApply(p.id, 'draft')} disabled={isLoading}>
                    <Play className="h-2.5 w-2.5" /> Apply
                  </Button>
                </div>
              )}
              {p.status === 'accepted' && (
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onApply(p.id, 'draft')} disabled={isLoading}>
                    <Play className="h-2.5 w-2.5" /> Apply as Draft
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onApply(p.id, 'propose')} disabled={isLoading}>
                    <Play className="h-2.5 w-2.5" /> Propose
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

function InactiveScenesPanel({ scenes, onRestore, isLoading, activeScenes }: {
  scenes: InactiveSceneItem[];
  onRestore: (sceneId: string, position?: { beforeSceneId?: string; afterSceneId?: string }) => void;
  isLoading: boolean;
  activeScenes: SceneListItem[];
}) {
  if (scenes.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No inactive scenes.</p>;
  }
  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2">
        {scenes.map(s => (
          <div key={s.scene_id} className="p-2 rounded border border-border/50 bg-muted/10 text-[10px] space-y-1">
            <p className="font-medium font-mono">{s.latest_version?.slugline || 'Untitled Scene'}</p>
            {s.latest_version?.summary && <p className="text-muted-foreground">{s.latest_version.summary}</p>}
            <div className="flex gap-1 pt-1">
              <Button size="sm" variant="outline" className="h-5 text-[9px] gap-0.5 px-1.5" onClick={() => onRestore(s.scene_id)} disabled={isLoading}>
                <RotateCw className="h-2.5 w-2.5" /> Restore to End
              </Button>
              {activeScenes.length > 0 && (
                <Button size="sm" variant="outline" className="h-5 text-[9px] gap-0.5 px-1.5"
                  onClick={() => onRestore(s.scene_id, { beforeSceneId: activeScenes[0].scene_id })} disabled={isLoading}>
                  <RotateCw className="h-2.5 w-2.5" /> Restore to Start
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function ActionHistoryPanel({ actions, onUndo, isLoading }: {
  actions: SceneGraphAction[];
  onUndo: (actionId: string) => void;
  isLoading: boolean;
}) {
  if (actions.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No actions yet.</p>;
  }
  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-1">
        {actions.slice(0, 20).map(a => (
          <div key={a.id} className="flex items-center gap-2 p-1.5 rounded border border-border/30 text-[10px]">
            <div className="flex-1 min-w-0">
              <span className="font-medium">{a.action_type.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground ml-2">{new Date(a.created_at).toLocaleTimeString()}</span>
            </div>
            <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1.5 shrink-0" onClick={() => onUndo(a.id)} disabled={isLoading}>
              <Undo2 className="h-2.5 w-2.5" /> Undo
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function SnapshotView({ projectId }: { projectId: string }) {
  const { data: snapshot, isLoading } = useSnapshotQuery(projectId);
  if (isLoading) return <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (!snapshot) return <p className="text-xs text-muted-foreground p-4">No snapshot available. Rebuild to generate one.</p>;
  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs">{snapshot.label || 'Latest Snapshot'}</CardTitle>
          <Badge variant="secondary" className="text-[9px]">{snapshot.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <ScrollArea className="max-h-[500px]">
          <pre className="text-[11px] whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">{snapshot.content || 'Empty snapshot'}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Helper hook for snapshot
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function useSnapshotQuery(projectId: string) {
  return useQuery({
    queryKey: ['scene-graph-snapshot', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('scene_graph_snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!projectId,
  });
}

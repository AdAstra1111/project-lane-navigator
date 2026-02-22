import { useState } from 'react';
import { useChangeSets } from '@/hooks/useChangeSets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Plus, Trash2, Eye, Play, RotateCw,
  CheckCircle, AlertTriangle, ArrowRight, FileText,
  GitBranch, Send, Diff, ThumbsUp, ThumbsDown, Clock,
  MessageSquare, ShieldCheck,
} from 'lucide-react';
import { SceneDiffViewer } from './SceneDiffViewer';
import { DiffCommentsThread } from './DiffCommentsThread';
import type { SceneChangeSet, SceneChangeSetOp, SceneListItem } from '@/lib/scene-graph/types';

interface ChangeSetsPanelProps {
  projectId: string;
  scenes: SceneListItem[];
  onSelectScene?: (sceneId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  proposed: 'bg-primary/10 text-primary',
  applied: 'bg-green-500/10 text-green-700',
  rolled_back: 'bg-amber-500/10 text-amber-700',
  abandoned: 'bg-destructive/10 text-destructive',
};

const OP_LABELS: Record<string, string> = {
  insert: 'Insert Scene', remove: 'Remove Scene', move: 'Move Scene',
  restore: 'Restore Scene', update_scene: 'Edit Scene', split: 'Split Scene',
  merge: 'Merge Scenes', rebalance: 'Rebalance', apply_patch: 'Apply Patch',
};

export function ChangeSetsPanel({ projectId, scenes, onSelectScene }: ChangeSetsPanelProps) {
  const cs = useChangeSets(projectId);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newGoal, setNewGoal] = useState('');

  const handleCreate = async () => {
    await cs.create.mutateAsync({ title: newTitle, description: newDesc || undefined, goal_type: newGoal || undefined });
    setShowCreate(false); setNewTitle(''); setNewDesc(''); setNewGoal('');
  };

  const detail = cs.selectedDetail;
  const changeSet = detail?.change_set;
  const ops = detail?.ops || [];

  return (
    <div className="grid grid-cols-12 gap-3">
      {/* Left: Change Set List */}
      <div className="col-span-3">
        <Card className="border-border/50">
          <CardHeader className="px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> Change Sets
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowCreate(true)}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <ScrollArea className="max-h-[500px]">
            <div className="px-1 pb-1 space-y-0.5">
              {cs.isLoading && <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
              {!cs.isLoading && cs.changeSets.length === 0 && (
                <p className="text-[10px] text-muted-foreground px-2 py-4 text-center">No change sets yet.</p>
              )}
              {cs.changeSets.map((set) => (
                <div key={set.id}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${cs.selectedChangeSetId === set.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
                  onClick={() => cs.setSelectedChangeSetId(set.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate font-medium">{set.title}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="outline" className={`text-[8px] h-4 px-1 ${STATUS_COLORS[set.status] || ''}`}>{set.status}</Badge>
                      {set.ops_count !== undefined && <span className="text-[9px] text-muted-foreground">{set.ops_count} ops</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Center: Change Set Detail + Ops + Diff Blocks */}
      <div className="col-span-5">
        {cs.isDetailLoading && <Card className="border-border/50"><CardContent className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>}
        {!cs.isDetailLoading && !changeSet && <Card className="border-border/50"><CardContent className="p-6 text-center"><p className="text-xs text-muted-foreground">Select a change set to view details</p></CardContent></Card>}
        {changeSet && (
          <Card className="border-border/50">
            <CardHeader className="px-3 py-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs">{changeSet.title}</CardTitle>
                <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[changeSet.status] || ''}`}>{changeSet.status}</Badge>
              </div>
              {changeSet.description && <p className="text-[10px] text-muted-foreground mt-1">{changeSet.description}</p>}
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              {/* Action buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {changeSet.status === 'draft' && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => cs.propose.mutateAsync(changeSet.id)} disabled={cs.propose.isPending || ops.length === 0}>
                      {cs.propose.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Propose
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => cs.previewCs.mutateAsync(changeSet.id)} disabled={cs.previewCs.isPending || ops.length === 0}>
                      {cs.previewCs.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Preview
                    </Button>
                  </>
                )}
                {/* Compute Diffs button */}
                {ops.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => cs.computeDiffs.mutateAsync({ changeSetId: changeSet.id })} disabled={cs.computeDiffs.isPending}>
                    {cs.computeDiffs.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Diff className="h-3 w-3" />} Compute Diffs
                  </Button>
                )}
                {['draft', 'proposed'].includes(changeSet.status) && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => cs.applyReviewDecisions.mutateAsync()} disabled={cs.applyReviewDecisions.isPending}>
                      {cs.applyReviewDecisions.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Apply Decisions
                    </Button>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => cs.apply.mutateAsync({ changeSetId: changeSet.id })} disabled={cs.apply.isPending || ops.length === 0}>
                      {cs.apply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Apply
                    </Button>
                  </>
                )}
                {changeSet.status === 'proposed' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => cs.previewCs.mutateAsync(changeSet.id)} disabled={cs.previewCs.isPending}>
                    {cs.previewCs.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Preview
                  </Button>
                )}
                {changeSet.status === 'applied' && (
                  <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => cs.rollback.mutateAsync(changeSet.id)} disabled={cs.rollback.isPending}>
                    {cs.rollback.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />} Rollback
                  </Button>
                )}
              </div>

              <Separator />

              {/* Ops list */}
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Operations ({ops.length})</span>
                <ScrollArea className="max-h-[180px] mt-1">
                  <div className="space-y-1">
                    {ops.map((op, i) => (
                      <div key={op.id} className={`flex items-center gap-1.5 p-1.5 rounded border border-border/50 ${op.payload?.meta?.skip ? 'opacity-40 bg-muted/10' : 'bg-muted/20'}`}>
                        <span className="text-[9px] text-muted-foreground font-mono w-4 shrink-0">{i + 1}</span>
                        <Badge variant="outline" className="text-[8px] h-4 px-1 shrink-0">{OP_LABELS[op.op_type] || op.op_type}</Badge>
                        <span className="text-[10px] truncate flex-1">
                          {op.payload?.sceneId ? `Scene: ${op.payload.sceneId.slice(0, 8)}...` : ''}
                          {op.payload?.meta?.skip ? ' (skipped)' : ''}
                        </span>
                        <OpStatusBadge status={op.status} />
                        {changeSet.status === 'draft' && (
                          <button className="p-0.5 hover:bg-background rounded text-destructive" onClick={() => cs.removeOp.mutateAsync({ changeSetId: changeSet.id, opId: op.id })}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {ops.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-3">No operations yet.</p>}
                  </div>
                </ScrollArea>
              </div>

              {/* Snapshot diff blocks with review controls */}
              {cs.diffs?.snapshot_diff && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Snapshot Diff</span>
                      <div className="flex gap-2 text-[9px]">
                        {cs.diffs.snapshot_diff.stats.added > 0 && <span className="text-green-600">+{cs.diffs.snapshot_diff.stats.added}</span>}
                        {cs.diffs.snapshot_diff.stats.removed > 0 && <span className="text-destructive">-{cs.diffs.snapshot_diff.stats.removed}</span>}
                        {cs.diffs.snapshot_diff.stats.edited > 0 && <span className="text-amber-600">~{cs.diffs.snapshot_diff.stats.edited}</span>}
                        {cs.diffs.snapshot_diff.stats.moved > 0 && <span className="text-blue-600">↔{cs.diffs.snapshot_diff.stats.moved}</span>}
                      </div>
                    </div>
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-1">
                        {cs.diffs.snapshot_diff.scene_blocks
                          .filter((b: any) => b.change_type !== 'unchanged')
                          .map((block: any, i: number) => (
                          <div key={i} className={`p-1.5 rounded border text-[10px] ${
                            block.change_type === 'added' ? 'border-green-500/30 bg-green-500/5' :
                            block.change_type === 'removed' ? 'border-destructive/30 bg-destructive/5' :
                            block.change_type === 'edited' ? 'border-amber-500/30 bg-amber-500/5' :
                            'border-blue-500/30 bg-blue-500/5'
                          }`}>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[8px] h-4 px-1">{block.change_type}</Badge>
                              {block.change_type === 'edited' && (
                                <button className="text-[9px] text-primary hover:underline" onClick={() => cs.getSceneDiff.mutateAsync({ sceneId: block.scene_id, beforeVersionId: block.before_version_id, afterVersionId: block.after_version_id })}>
                                  View Diff
                                </button>
                              )}
                              {!block.scene_id.startsWith('__') && onSelectScene && (
                                <button className="text-[9px] text-primary hover:underline" onClick={() => onSelectScene(block.scene_id)}>Open</button>
                              )}
                              {/* Review decision buttons */}
                              {!block.scene_id.startsWith('__') && ['draft', 'proposed'].includes(changeSet.status) && (
                                <div className="flex gap-0.5 ml-auto">
                                  <button className="p-0.5 hover:bg-green-500/20 rounded" title="Accept" onClick={() => cs.setReviewDecision.mutateAsync({ sceneId: block.scene_id, beforeVersionId: block.before_version_id, afterVersionId: block.after_version_id, decision: 'accepted' })}>
                                    <ThumbsUp className="h-2.5 w-2.5 text-green-600" />
                                  </button>
                                  <button className="p-0.5 hover:bg-destructive/20 rounded" title="Reject" onClick={() => cs.setReviewDecision.mutateAsync({ sceneId: block.scene_id, beforeVersionId: block.before_version_id, afterVersionId: block.after_version_id, decision: 'rejected' })}>
                                    <ThumbsDown className="h-2.5 w-2.5 text-destructive" />
                                  </button>
                                  <button className="p-0.5 hover:bg-muted rounded" title="Reset to pending" onClick={() => cs.setReviewDecision.mutateAsync({ sceneId: block.scene_id, beforeVersionId: block.before_version_id, afterVersionId: block.after_version_id, decision: 'pending' })}>
                                    <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {block.before_excerpt && <div className="text-muted-foreground line-through truncate mt-0.5">{block.before_excerpt.slice(0, 60)}</div>}
                            {block.after_excerpt && <div className="truncate">{block.after_excerpt.slice(0, 60)}</div>}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Scene Diff Viewer + Comments */}
      <div className="col-span-4 space-y-3">
        {/* Scene diff */}
        <Card className="border-border/50">
          <CardHeader className="px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Diff className="h-3 w-3" /> Scene Diff
            </span>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {cs.getSceneDiff.isPending && <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
            {!cs.selectedSceneDiff && !cs.getSceneDiff.isPending && (
              <p className="text-[10px] text-muted-foreground text-center py-4">Click "View Diff" on an edited scene to see line-by-line changes.</p>
            )}
            {cs.selectedSceneDiff && <SceneDiffViewer artifact={cs.selectedSceneDiff.artifact} />}
          </CardContent>
        </Card>

        {/* Comments */}
        {changeSet && (
          <Card className="border-border/50">
            <CardHeader className="px-2 py-1.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Review Comments
              </span>
            </CardHeader>
            <CardContent className="px-2 pb-2">
              <DiffCommentsThread
                comments={cs.comments}
                sceneId={cs.selectedSceneDiff?.sceneId}
                isLoading={cs.isCommentsLoading}
                onAddComment={(p) => cs.addComment.mutateAsync(p)}
                onResolve={(p) => cs.resolveComment.mutateAsync(p)}
                isAddingComment={cs.addComment.isPending}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Create Change Set</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title (e.g. 'Pacing fix Act 2')" className="text-xs" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            <Textarea placeholder="Description (optional)" className="text-xs min-h-[60px]" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
            <Input placeholder="Goal type (e.g. fix_pacing, repair_continuity)" className="text-xs" value={newGoal} onChange={e => setNewGoal(e.target.value)} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={cs.create.isPending || !newTitle.trim()}>
              {cs.create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OpStatusBadge({ status }: { status: string }) {
  if (status === 'executed') return <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />;
  if (status === 'failed') return <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />;
  if (status === 'reverted') return <RotateCw className="h-3 w-3 text-amber-500 shrink-0" />;
  return null;
}

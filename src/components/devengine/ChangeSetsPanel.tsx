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
  GitBranch, Send,
} from 'lucide-react';
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
  insert: 'Insert Scene',
  remove: 'Remove Scene',
  move: 'Move Scene',
  restore: 'Restore Scene',
  update_scene: 'Edit Scene',
  split: 'Split Scene',
  merge: 'Merge Scenes',
  rebalance: 'Rebalance',
  apply_patch: 'Apply Patch',
};

export function ChangeSetsPanel({ projectId, scenes, onSelectScene }: ChangeSetsPanelProps) {
  const cs = useChangeSets(projectId);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newGoal, setNewGoal] = useState('');

  const handleCreate = async () => {
    await cs.create.mutateAsync({
      title: newTitle,
      description: newDesc || undefined,
      goal_type: newGoal || undefined,
    });
    setShowCreate(false);
    setNewTitle('');
    setNewDesc('');
    setNewGoal('');
  };

  const detail = cs.selectedDetail;
  const changeSet = detail?.change_set;
  const ops = detail?.ops || [];

  return (
    <div className="grid grid-cols-12 gap-3">
      {/* Left: Change Set List */}
      <div className="col-span-4">
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
              {cs.isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!cs.isLoading && cs.changeSets.length === 0 && (
                <p className="text-[10px] text-muted-foreground px-2 py-4 text-center">
                  No change sets yet. Create one to batch scene edits.
                </p>
              )}
              {cs.changeSets.map((set) => (
                <div
                  key={set.id}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    cs.selectedChangeSetId === set.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => cs.setSelectedChangeSetId(set.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate font-medium">{set.title}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="outline" className={`text-[8px] h-4 px-1 ${STATUS_COLORS[set.status] || ''}`}>
                        {set.status}
                      </Badge>
                      {set.ops_count !== undefined && (
                        <span className="text-[9px] text-muted-foreground">{set.ops_count} ops</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Center: Change Set Detail */}
      <div className="col-span-5">
        {cs.isDetailLoading && (
          <Card className="border-border/50">
            <CardContent className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}
        {!cs.isDetailLoading && !changeSet && (
          <Card className="border-border/50">
            <CardContent className="p-6 text-center">
              <p className="text-xs text-muted-foreground">Select a change set to view details</p>
            </CardContent>
          </Card>
        )}
        {changeSet && (
          <Card className="border-border/50">
            <CardHeader className="px-3 py-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs">{changeSet.title}</CardTitle>
                <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[changeSet.status] || ''}`}>
                  {changeSet.status}
                </Badge>
              </div>
              {changeSet.description && (
                <p className="text-[10px] text-muted-foreground mt-1">{changeSet.description}</p>
              )}
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              {/* Action buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {changeSet.status === 'draft' && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => cs.propose.mutateAsync(changeSet.id)}
                      disabled={cs.propose.isPending || ops.length === 0}>
                      {cs.propose.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Propose
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => cs.previewCs.mutateAsync(changeSet.id)}
                      disabled={cs.previewCs.isPending || ops.length === 0}>
                      {cs.previewCs.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                      Preview
                    </Button>
                  </>
                )}
                {['draft', 'proposed'].includes(changeSet.status) && (
                  <Button size="sm" className="h-7 text-xs gap-1"
                    onClick={() => cs.apply.mutateAsync({ changeSetId: changeSet.id })}
                    disabled={cs.apply.isPending || ops.length === 0}>
                    {cs.apply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Apply
                  </Button>
                )}
                {changeSet.status === 'proposed' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => cs.previewCs.mutateAsync(changeSet.id)}
                    disabled={cs.previewCs.isPending}>
                    {cs.previewCs.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                    Preview
                  </Button>
                )}
                {changeSet.status === 'applied' && (
                  <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                    onClick={() => cs.rollback.mutateAsync(changeSet.id)}
                    disabled={cs.rollback.isPending}>
                    {cs.rollback.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                    Rollback
                  </Button>
                )}
              </div>

              <Separator />

              {/* Ops list */}
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Operations ({ops.length})
                </span>
                <ScrollArea className="max-h-[300px] mt-1">
                  <div className="space-y-1">
                    {ops.map((op, i) => (
                      <div key={op.id} className="flex items-center gap-1.5 p-1.5 rounded border border-border/50 bg-muted/20">
                        <span className="text-[9px] text-muted-foreground font-mono w-4 shrink-0">{i + 1}</span>
                        <Badge variant="outline" className="text-[8px] h-4 px-1 shrink-0">
                          {OP_LABELS[op.op_type] || op.op_type}
                        </Badge>
                        <span className="text-[10px] truncate flex-1">
                          {op.payload?.sceneId ? `Scene: ${op.payload.sceneId.slice(0, 8)}...` : ''}
                          {op.payload?.sceneDraft?.slugline ? ` — ${op.payload.sceneDraft.slugline}` : ''}
                        </span>
                        <OpStatusBadge status={op.status} />
                        {changeSet.status === 'draft' && (
                          <button
                            className="p-0.5 hover:bg-background rounded text-destructive"
                            onClick={() => cs.removeOp.mutateAsync({ changeSetId: changeSet.id, opId: op.id })}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {ops.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-3">
                        No operations yet. Add ops using the scene editor.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Preview */}
      <div className="col-span-3">
        <Card className="border-border/50">
          <CardHeader className="px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Eye className="h-3 w-3" /> Preview
            </span>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {!cs.preview && (
              <p className="text-[10px] text-muted-foreground text-center py-4">
                Click "Preview" on a change set to see diff summary.
              </p>
            )}
            {cs.preview && (
              <div className="space-y-2">
                {/* Summary counts */}
                <div className="grid grid-cols-2 gap-1">
                  {cs.preview.snapshot_diff.added > 0 && (
                    <div className="text-[10px] text-green-600 flex items-center gap-1">
                      <Plus className="h-2.5 w-2.5" /> {cs.preview.snapshot_diff.added} added
                    </div>
                  )}
                  {cs.preview.snapshot_diff.removed > 0 && (
                    <div className="text-[10px] text-destructive flex items-center gap-1">
                      <Trash2 className="h-2.5 w-2.5" /> {cs.preview.snapshot_diff.removed} removed
                    </div>
                  )}
                  {cs.preview.snapshot_diff.edited > 0 && (
                    <div className="text-[10px] text-amber-600 flex items-center gap-1">
                      <FileText className="h-2.5 w-2.5" /> {cs.preview.snapshot_diff.edited} edited
                    </div>
                  )}
                  {cs.preview.snapshot_diff.moved > 0 && (
                    <div className="text-[10px] text-blue-600 flex items-center gap-1">
                      <ArrowRight className="h-2.5 w-2.5" /> {cs.preview.snapshot_diff.moved} moved
                    </div>
                  )}
                </div>

                <Separator />

                {/* Diff rows */}
                <ScrollArea className="max-h-[350px]">
                  <div className="space-y-1">
                    {cs.preview.scene_diff.map((diff, i) => (
                      <div key={i} className={`p-1.5 rounded border text-[10px] ${
                        diff.change_type === 'added' ? 'border-green-500/30 bg-green-500/5' :
                        diff.change_type === 'removed' ? 'border-destructive/30 bg-destructive/5' :
                        diff.change_type === 'edited' ? 'border-amber-500/30 bg-amber-500/5' :
                        'border-blue-500/30 bg-blue-500/5'
                      }`}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <Badge variant="outline" className="text-[8px] h-4 px-1">{diff.change_type}</Badge>
                          {!diff.scene_id.startsWith('__') && onSelectScene && (
                            <button
                              className="text-[9px] text-primary hover:underline"
                              onClick={() => onSelectScene(diff.scene_id)}
                            >
                              Open
                            </button>
                          )}
                        </div>
                        {diff.before_excerpt && (
                          <div className="text-muted-foreground line-through truncate">{diff.before_excerpt.slice(0, 80)}</div>
                        )}
                        {diff.after_excerpt && (
                          <div className="truncate">{diff.after_excerpt.slice(0, 80)}</div>
                        )}
                      </div>
                    ))}
                    {cs.preview.scene_diff.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2">No changes detected.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
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

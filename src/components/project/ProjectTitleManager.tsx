/**
 * ProjectTitleManager — Full title governance UI.
 * Rename, history, aliases, working titles, downstream propagation controls.
 */
import { useState, useEffect } from 'react';
import { Pencil, Loader2, History, Tag, BookOpen, Globe2, Plus, ChevronDown, ChevronUp, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { useProjectTitleHistory, type TitleType, type TitleHistoryEntry } from '@/hooks/useProjectTitleHistory';
import { format } from 'date-fns';

interface Props {
  projectId: string;
  currentTitle: string;
  trigger?: React.ReactNode;
}

const TITLE_TYPE_LABELS: Record<TitleType, { label: string; color: string; icon: typeof Tag }> = {
  canonical: { label: 'Canonical', color: 'bg-primary/10 text-primary border-primary/20', icon: CheckCircle2 },
  former_canonical: { label: 'Former', color: 'bg-muted text-muted-foreground border-border/30', icon: History },
  working: { label: 'Working', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: BookOpen },
  alias: { label: 'Alias', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20', icon: Tag },
  market_title: { label: 'Market', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: Globe2 },
};

export function ProjectTitleManager({ projectId, currentTitle, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(currentTitle);
  const [reason, setReason] = useState('');
  const [propagatePoster, setPropagatePoster] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [addingType, setAddingType] = useState<TitleType | null>(null);
  const [addTitle, setAddTitle] = useState('');

  const {
    history, isLoading, currentCanonical, formerTitles, workingTitles, aliases, marketTitles,
    rename, addTitle: addTitleMutation, bootstrap,
  } = useProjectTitleHistory(projectId);

  // Bootstrap on open if no history
  useEffect(() => {
    if (open && !isLoading && history.length === 0 && currentTitle) {
      bootstrap.mutate(currentTitle);
    }
  }, [open, isLoading, history.length, currentTitle, bootstrap]);

  // Sync new title when dialog opens
  useEffect(() => {
    if (!open) {
      setNewTitle(currentTitle);
      setReason('');
      setAddingType(null);
      setAddTitle('');
    }
  }, [open, currentTitle]);

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === currentTitle) { setOpen(false); return; }
    await rename.mutateAsync({
      newTitle: trimmed,
      options: {
        reason: reason.trim() || undefined,
        propagate: { posterOverride: propagatePoster },
      },
    });
    setOpen(false);
  };

  const handleAddTitle = async () => {
    if (!addingType || !addTitle.trim()) return;
    await addTitleMutation.mutateAsync({ title: addTitle.trim(), titleType: addingType });
    setAddTitle('');
    setAddingType(null);
  };

  const hasHistory = formerTitles.length > 0 || workingTitles.length > 0 || aliases.length > 0 || marketTitles.length > 0;

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="cursor-pointer">{trigger}</span>
      ) : (
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
          title="Manage project title"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Project Title
            </DialogTitle>
          </DialogHeader>

          {/* Rename form */}
          <form onSubmit={handleRename} className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="rename-title" className="text-xs">Canonical Title</Label>
              <Input
                id="rename-title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                autoFocus
                placeholder="Enter new title…"
                disabled={rename.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rename-reason" className="text-xs text-muted-foreground">Reason for change (optional)</Label>
              <Input
                id="rename-reason"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Market feedback, clearer positioning…"
                disabled={rename.isPending}
                className="text-xs h-8"
              />
            </div>

            {/* Propagation controls */}
            <div className="space-y-2 py-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Downstream Propagation</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={propagatePoster}
                  onCheckedChange={v => setPropagatePoster(v === true)}
                />
                <span className="text-xs text-foreground">Update poster title override</span>
              </label>
              <p className="text-[10px] text-muted-foreground pl-6">
                Documents and deck surfaces read from canonical title automatically.
                Historical exports and locked assets are preserved.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={rename.isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={rename.isPending || !newTitle.trim() || newTitle.trim() === currentTitle}>
                {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Rename
              </Button>
            </div>
          </form>

          <Separator className="my-1" />

          {/* Title History & Aliases */}
          <Collapsible open={showHistory} onOpenChange={setShowHistory}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1 hover:text-foreground transition-colors">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Title History & Aliases</span>
              {hasHistory && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-1">
                  {formerTitles.length + workingTitles.length + aliases.length + marketTitles.length}
                </Badge>
              )}
              {showHistory ? <ChevronUp className="h-3 w-3 ml-auto text-muted-foreground" /> : <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" />}
            </CollapsibleTrigger>

            <CollapsibleContent className="pt-2 space-y-3">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs">Loading history...</span>
                </div>
              ) : (
                <>
                  {/* Current canonical */}
                  {currentCanonical && (
                    <TitleEntryRow entry={currentCanonical} />
                  )}

                  {/* Former titles */}
                  {formerTitles.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Former Titles</p>
                      {formerTitles.map(t => <TitleEntryRow key={t.id} entry={t} />)}
                    </div>
                  )}

                  {/* Working titles */}
                  {workingTitles.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Working Titles</p>
                      {workingTitles.map(t => <TitleEntryRow key={t.id} entry={t} />)}
                    </div>
                  )}

                  {/* Aliases */}
                  {aliases.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Aliases</p>
                      {aliases.map(t => <TitleEntryRow key={t.id} entry={t} />)}
                    </div>
                  )}

                  {/* Market titles */}
                  {marketTitles.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Market Titles</p>
                      {marketTitles.map(t => <TitleEntryRow key={t.id} entry={t} />)}
                    </div>
                  )}

                  {!hasHistory && !currentCanonical && (
                    <p className="text-[10px] text-muted-foreground py-1">No title history yet.</p>
                  )}
                </>
              )}

              {/* Add title form */}
              <div className="pt-1">
                {addingType ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={addTitle}
                      onChange={e => setAddTitle(e.target.value)}
                      placeholder={`Add ${addingType.replace('_', ' ')}…`}
                      className="text-xs h-7 flex-1"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTitle(); } }}
                    />
                    <Button size="sm" className="h-7 text-xs" onClick={handleAddTitle} disabled={addTitleMutation.isPending || !addTitle.trim()}>
                      {addTitleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddingType(null); setAddTitle(''); }}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground mr-1">Add:</span>
                    {(['working', 'alias', 'market_title'] as TitleType[]).map(type => {
                      const cfg = TITLE_TYPE_LABELS[type];
                      return (
                        <button
                          key={type}
                          onClick={() => setAddingType(type)}
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                            'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30'
                          )}
                        >
                          <Plus className="h-2 w-2 inline mr-0.5" />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Entry Row ──

function TitleEntryRow({ entry }: { entry: TitleHistoryEntry }) {
  const cfg = TITLE_TYPE_LABELS[entry.title_type as TitleType] || TITLE_TYPE_LABELS.canonical;
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md bg-muted/20">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-xs text-foreground font-medium flex-1 min-w-0 truncate">{entry.title}</span>
      <Badge variant="outline" className={cn('text-[7px] px-1 py-0 shrink-0', cfg.color)}>
        {cfg.label}
      </Badge>
      {entry.effective_from && (
        <span className="text-[8px] text-muted-foreground/60 shrink-0">
          {format(new Date(entry.effective_from), 'MMM d, yyyy')}
        </span>
      )}
      {entry.change_reason && (
        <span className="text-[8px] text-muted-foreground/50 italic truncate max-w-[100px]" title={entry.change_reason}>
          {entry.change_reason}
        </span>
      )}
    </div>
  );
}

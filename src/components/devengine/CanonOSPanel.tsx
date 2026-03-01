/**
 * CanonOSPanel — Structured editor for Canon OS data.
 * Initialize, edit, approve, rename, backfill display names.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  BookOpen, ChevronDown, Loader2, ShieldCheck, Plus, Trash2,
  Save, RefreshCw, PenLine, FileText, Lock, Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCanonOS } from '@/hooks/useCanonOS';
import { docsBackfillDisplayNames } from '@/lib/scene-graph/client';
import type { CanonOSData } from '@/lib/scene-graph/types';

interface Props {
  projectId: string;
}

function Section({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-muted/30 rounded px-2 transition-colors">
        <span className="text-xs font-semibold flex-1 text-left">{title}</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-3 space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CanonOSPanel({ projectId }: Props) {
  const {
    currentCanon, isLoading, initialize, isInitializing,
    updateAsync, isUpdating, approve, isApproving,
    rename, isRenaming,
  } = useCanonOS(projectId);

  const [draft, setDraft] = useState<CanonOSData>({});
  const [renameTitle, setRenameTitle] = useState('');
  const [showRename, setShowRename] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    if (currentCanon?.canon_json) {
      setDraft(currentCanon.canon_json as CanonOSData);
    }
  }, [currentCanon]);

  const updateField = (key: string, value: unknown) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateAsync({ patch: draft });
      setDirty(false);
      toast.success('Canon saved');
    } catch {}
  };

  const handleApprove = async () => {
    if (!currentCanon?.id) return;
    await approve(currentCanon.id);
  };

  const handleRename = async () => {
    if (!renameTitle.trim()) return;
    await rename(renameTitle.trim());
    setShowRename(false);
    setRenameTitle('');
  };

  const handleInit = async () => {
    await initialize();
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const result = await docsBackfillDisplayNames({ projectId });
      toast.success(`Updated ${result.updated} document display names`);
    } catch (e: any) {
      toast.error(e.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  // No canon yet
  if (!currentCanon) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 text-center space-y-3">
          <BookOpen className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No Canon initialized yet.</p>
          <Button size="sm" onClick={handleInit} disabled={isInitializing}>
            {isInitializing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Initialize Canon
          </Button>
        </CardContent>
      </Card>
    );
  }

  const worldRules = (draft.world_rules as string[]) || [];
  const forbiddenChanges = (draft.forbidden_changes as string[]) || [];
  const timelineNotes = (draft.timeline_notes as string[]) || [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Canon OS</h3>
          {dirty && <Badge variant="secondary" className="text-[9px]">Unsaved</Badge>}
          {isUpdating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {currentCanon.is_approved && (
            <Badge variant="outline" className="text-[9px] border-primary/40 text-primary bg-primary/10">
              <ShieldCheck className="h-2 w-2 mr-0.5" /> Approved
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => setShowRename(!showRename)}>
            <PenLine className="h-3 w-3" /> Rename
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={handleSave} disabled={!dirty || isUpdating}>
            <Save className="h-3 w-3" /> Save
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={handleApprove} disabled={isApproving}>
            <ShieldCheck className="h-3 w-3" /> Approve
          </Button>
        </div>
      </div>

      {/* Rename */}
      {showRename && (
        <div className="flex items-center gap-2 p-2 bg-muted/30 rounded border border-border/40">
          <Input
            value={renameTitle}
            onChange={e => setRenameTitle(e.target.value)}
            placeholder="New project title..."
            className="h-7 text-xs flex-1"
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleRename} disabled={isRenaming || !renameTitle.trim()}>
            {isRenaming ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
          </Button>
        </div>
      )}

      {/* Canon fields */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-1 pr-2">
          <Section title="Title & Format" defaultOpen={true}>
            <div className="space-y-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Title</Label>
                <Input value={(draft.title as string) || ''} onChange={e => updateField('title', e.target.value)} className="h-7 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Format</Label>
                  <Input value={(draft.format as string) || ''} onChange={e => updateField('format', e.target.value)} className="h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Genre</Label>
                  <Input value={(draft.genre as string) || ''} onChange={e => updateField('genre', e.target.value)} className="h-7 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Episode Count</Label>
                  <Input type="number" value={draft.episode_count ?? ''} onChange={e => updateField('episode_count', e.target.value ? Number(e.target.value) : null)} className="h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Min Duration (s)</Label>
                  <Input type="number" value={draft.episode_length_seconds_min ?? ''} onChange={e => updateField('episode_length_seconds_min', e.target.value ? Number(e.target.value) : null)} className="h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Max Duration (s)</Label>
                  <Input type="number" value={draft.episode_length_seconds_max ?? ''} onChange={e => updateField('episode_length_seconds_max', e.target.value ? Number(e.target.value) : null)} className="h-7 text-xs" />
                </div>
              </div>
              {/* Duration source & lock info */}
              {(() => {
                const fmtBlock = (draft as any).format;
                const source = fmtBlock?.episode_duration_source;
                const locked = fmtBlock?.episode_duration_locked;
                if (!source && !locked) return null;
                return (
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[9px] gap-1">
                      {locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                      {source || 'unknown'}
                      {locked ? ' (locked)' : ' (editable)'}
                    </Badge>
                    <button
                      className="text-[9px] text-muted-foreground hover:text-foreground underline"
                      onClick={() => {
                        const cur = (draft as any).format || {};
                        updateField('format' as any, { ...cur, episode_duration_locked: !locked });
                      }}
                    >
                      {locked ? 'Unlock' : 'Lock'}
                    </button>
                  </div>
                );
              })()}
              <div>
                <Label className="text-[10px] text-muted-foreground">Tone</Label>
                <Input value={(draft.tone as string) || ''} onChange={e => updateField('tone', e.target.value)} className="h-7 text-xs" />
              </div>
            </div>
          </Section>

          <Separator />

          <Section title="World Rules" defaultOpen={false}>
            <div className="space-y-1">
              {worldRules.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <Input value={rule} onChange={e => {
                    const next = [...worldRules]; next[idx] = e.target.value;
                    updateField('world_rules', next);
                  }} className="h-7 text-xs flex-1" />
                  <button onClick={() => updateField('world_rules', worldRules.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => updateField('world_rules', [...worldRules, ''])}>
                <Plus className="h-3 w-3" /> Add Rule
              </Button>
            </div>
          </Section>

          <Separator />

          <Section title="Timeline Notes" defaultOpen={false}>
            <div className="space-y-1">
              {timelineNotes.map((note, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <Input value={note} onChange={e => {
                    const next = [...timelineNotes]; next[idx] = e.target.value;
                    updateField('timeline_notes', next);
                  }} className="h-7 text-xs flex-1" />
                  <button onClick={() => updateField('timeline_notes', timelineNotes.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => updateField('timeline_notes', [...timelineNotes, ''])}>
                <Plus className="h-3 w-3" /> Add Note
              </Button>
            </div>
          </Section>

          <Separator />

          <Section title="Forbidden Changes" defaultOpen={false}>
            <div className="space-y-1">
              {forbiddenChanges.map((fc, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <Input value={fc} onChange={e => {
                    const next = [...forbiddenChanges]; next[idx] = e.target.value;
                    updateField('forbidden_changes', next);
                  }} className="h-7 text-xs flex-1" />
                  <button onClick={() => updateField('forbidden_changes', forbiddenChanges.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => updateField('forbidden_changes', [...forbiddenChanges, ''])}>
                <Plus className="h-3 w-3" /> Add Rule
              </Button>
            </div>
          </Section>

          <Separator />

          {/* Backfill Display Names */}
          <Section title="Document Naming" defaultOpen={false}>
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Backfill missing display names for all documents using Canon title + doc type.
              </p>
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleBackfill} disabled={backfilling}>
                {backfilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                Backfill Display Names
              </Button>
            </div>
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}

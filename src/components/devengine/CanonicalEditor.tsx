/**
 * CanonicalEditor — Single source of truth for all project canon.
 *
 * Sections: Logline/Premise, Characters, Timeline, World Rules, Locations,
 *           Ongoing Threads, Tone & Style, Format Constraints, Locked Facts
 *
 * Features: autosave (debounced), version history, approve canon snapshot.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { CanonFactsManager } from '@/components/canon/CanonFactsManager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck, ChevronDown, Save, Plus, Trash2, Loader2, History,
  Copy, Download, BookOpen, AlertTriangle, Info, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProjectCanon, type CanonJson, type CanonCharacter, type CanonVersion } from '@/hooks/useProjectCanon';
import { useCanonicalState } from '@/hooks/useCanonicalState';

interface Props {
  projectId: string;
}

// ── Autosave debounce ──
function useAutosave(
  value: CanonJson,
  save: (v: Partial<CanonJson>) => void,
  delay = 2000,
) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const prev = useRef<string>('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const json = JSON.stringify(value);
    if (prev.current && json !== prev.current) {
      setDirty(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        save(value);
        setDirty(false);
      }, delay);
    }
    prev.current = json;
    return () => clearTimeout(timer.current);
  }, [value, save, delay]);

  return dirty;
}

// ── Section wrapper ──
function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-muted/30 rounded px-2 transition-colors">
        {icon}
        <span className="text-xs font-semibold flex-1 text-left">{title}</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-3 space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Character row ──
function CharacterRow({ char, onChange, onRemove }: {
  char: CanonCharacter;
  onChange: (c: CanonCharacter) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border/40 rounded-lg p-2.5 space-y-2 bg-muted/10">
      <div className="flex items-center gap-2">
        <Input
          value={char.name}
          onChange={e => onChange({ ...char, name: e.target.value })}
          placeholder="Character name"
          className="h-7 text-xs flex-1"
        />
        <Input
          value={char.role || ''}
          onChange={e => onChange({ ...char, role: e.target.value })}
          placeholder="Role (protagonist, antagonist…)"
          className="h-7 text-xs w-36"
        />
        <button onClick={onRemove} className="p-1 rounded text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Goals</Label>
          <Textarea value={char.goals || ''} onChange={e => onChange({ ...char, goals: e.target.value })}
            className="min-h-[40px] text-xs" placeholder="What do they want?" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Traits</Label>
          <Textarea value={char.traits || ''} onChange={e => onChange({ ...char, traits: e.target.value })}
            className="min-h-[40px] text-xs" placeholder="Key personality traits" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Secrets</Label>
          <Textarea value={char.secrets || ''} onChange={e => onChange({ ...char, secrets: e.target.value })}
            className="min-h-[40px] text-xs" placeholder="Hidden info / backstory" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Relationships</Label>
          <Textarea value={char.relationships || ''} onChange={e => onChange({ ...char, relationships: e.target.value })}
            className="min-h-[40px] text-xs" placeholder="Connections to other characters" />
        </div>
      </div>
    </div>
  );
}

// ── Version history sidebar ──
function VersionHistory({ versions, activeApproved, onApprove, isApproving }: {
  versions: CanonVersion[];
  activeApproved: CanonVersion | null;
  onApprove: (id: string) => void;
  isApproving: boolean;
}) {
  if (versions.length === 0) return (
    <p className="text-[10px] text-muted-foreground p-2">No versions yet. Edit canon to create the first version.</p>
  );
  return (
    <ScrollArea className="max-h-[300px]">
      <div className="space-y-1 p-1">
        {versions.map(v => (
          <div key={v.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30 text-[10px]">
            <div className="flex-1 min-w-0">
              <span className="text-foreground">{new Date(v.created_at).toLocaleString()}</span>
              {v.is_approved && (
                <Badge variant="outline" className="text-[8px] ml-1 px-1 py-0 border-yellow-500/40 text-yellow-500 bg-yellow-500/10">
                  <ShieldCheck className="h-2 w-2 mr-0.5" /> Active
                </Badge>
              )}
            </div>
            {!v.is_approved && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9px] px-1.5"
                onClick={() => onApprove(v.id)}
                disabled={isApproving}
              >
                Approve
              </Button>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Main ──
export function CanonicalEditor({ projectId }: Props) {
  const {
    canon, versions, activeApproved, isLoading, isSaving,
    save, approveVersion, isApproving,
  } = useProjectCanon(projectId);
  const { source, sourceLabel, evidence, refetch: refetchCanonState } = useCanonicalState(projectId);

  // Local draft state for controlled inputs
  const [draft, setDraft] = useState<CanonJson>({});
  const [showVersions, setShowVersions] = useState(false);
  const [showFactsManager, setShowFactsManager] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Sync from server on load
  useEffect(() => {
    if (canon && Object.keys(canon).length >= 0) {
      setDraft(prev => {
        if (Object.keys(prev).length === 0) return { ...canon };
        return prev;
      });
    }
  }, [canon]);

  const stableSave = useCallback((v: Partial<CanonJson>) => save(v), [save]);
  const isDirty = useAutosave(draft, stableSave);

  const updateField = useCallback((key: keyof CanonJson, value: unknown) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  // Characters helpers
  const characters: CanonCharacter[] = (draft.characters as CanonCharacter[]) || [];
  const addCharacter = () => {
    updateField('characters', [...characters, { name: '', role: '', goals: '', traits: '', secrets: '', relationships: '' }]);
  };
  const updateCharacter = (idx: number, c: CanonCharacter) => {
    const next = [...characters];
    next[idx] = c;
    updateField('characters', next);
  };
  const removeCharacter = (idx: number) => {
    updateField('characters', characters.filter((_, i) => i !== idx));
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-canon.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
    toast.success('Canon JSON copied');
  };

  const handleResetCanonCache = async () => {
    if (!confirm('Reset all canon snapshots? This clears cached canon versions but preserves your documents and locked decisions.')) return;
    setIsResetting(true);
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      // Clear canon_version_id pointer
      await supabase.from('projects').update({ canon_version_id: null }).eq('id', projectId);
      // Clear non-approved versions (keep approved ones as audit trail)
      await (supabase as any).from('project_canon_versions')
        .delete()
        .eq('project_id', projectId)
        .eq('is_approved', false);
      refetchCanonState();
      toast.success('Canon cache reset. Re-analyze to rebuild.');
    } catch (e: any) {
      toast.error('Reset failed: ' + (e.message || 'Unknown error'));
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading canon…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Canonical Editor</h3>
          {isDirty && <Badge variant="secondary" className="text-[9px]">Unsaved</Badge>}
          {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {!isDirty && !isSaving && Object.keys(draft).length > 0 && (
            <Badge variant="outline" className="text-[9px] border-[hsl(var(--chart-2)/0.4)] text-[hsl(var(--chart-2))]">Saved</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={handleCopyJson}>
            <Copy className="h-3 w-3" /> Copy
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={handleExportJson}>
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShowFactsManager(!showFactsManager)}
          >
            <ShieldCheck className="h-3 w-3" /> Facts
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShowVersions(!showVersions)}
          >
            <History className="h-3 w-3" /> Versions ({versions.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => save(draft)}
            disabled={isSaving}
          >
            <Save className="h-3 w-3" /> Save Now
          </Button>
        </div>
      </div>

      {/* Canon Source Indicator */}
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[10px] border ${
        source === 'unknown'
          ? 'bg-destructive/5 border-destructive/20'
          : source === 'canon_editor'
            ? 'bg-primary/5 border-primary/20'
            : 'bg-amber-500/5 border-amber-500/20'
      }`}>
        <Info className={`h-3.5 w-3.5 shrink-0 ${
          source === 'unknown' ? 'text-destructive' : source === 'canon_editor' ? 'text-primary' : 'text-amber-500'
        }`} />
        <span className="text-foreground">
          Canon sourced from: <strong>{sourceLabel}</strong>
        </span>
        {evidence && evidence.locked_decision_count > 0 && source !== 'locked_facts' && (
          <span className="text-muted-foreground">
            ({evidence.locked_decision_count} locked decision{evidence.locked_decision_count !== 1 ? 's' : ''} also active)
          </span>
        )}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[9px] gap-1 px-1.5 text-muted-foreground hover:text-destructive"
            onClick={handleResetCanonCache}
            disabled={isResetting}
          >
            {isResetting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
            Reset Cache
          </Button>
        </div>
      </div>

      {/* Warning: Canon is empty but engines may be using document text */}
      {source === 'unknown' && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-destructive/5 border border-destructive/20 text-[10px]">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-foreground font-medium">No canonical state established</p>
            <p className="text-muted-foreground mt-0.5">
              Engines will analyze document text without canonical guardrails. Fill in at least a logline and characters below to establish canon, or run Analysis first.
            </p>
          </div>
        </div>
      )}

      {/* Active Approved indicator */}
      {activeApproved && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 text-[10px]">
          <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-600">Active Approved Canon:</span>
          <span className="text-muted-foreground">{new Date(activeApproved.approved_at || activeApproved.created_at).toLocaleString()}</span>
        </div>
      )}

      {/* Canon Facts Manager */}
      {showFactsManager && (
        <CanonFactsManager projectId={projectId} />
      )}

      {/* Version history (collapsible) */}
      {showVersions && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">Version History</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <VersionHistory
              versions={versions}
              activeApproved={activeApproved}
              onApprove={approveVersion}
              isApproving={isApproving}
            />
          </CardContent>
        </Card>
      )}

      {/* Canon sections */}
      <div className="space-y-1">
        <Section title="Logline & Premise" defaultOpen={true}>
          <div className="space-y-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Logline</Label>
              <Textarea
                value={(draft.logline as string) || ''}
                onChange={e => updateField('logline', e.target.value)}
                className="min-h-[50px] text-xs"
                placeholder="One-sentence summary of the project…"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Premise</Label>
              <Textarea
                value={(draft.premise as string) || ''}
                onChange={e => updateField('premise', e.target.value)}
                className="min-h-[60px] text-xs"
                placeholder="Expanded premise / concept…"
              />
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Characters" defaultOpen={true}>
          <div className="space-y-2">
            {characters.map((char, idx) => (
              <CharacterRow
                key={idx}
                char={char}
                onChange={c => updateCharacter(idx, c)}
                onRemove={() => removeCharacter(idx)}
              />
            ))}
            <Button variant="outline" size="sm" className="text-xs gap-1 h-7" onClick={addCharacter}>
              <Plus className="h-3 w-3" /> Add Character
            </Button>
          </div>
        </Section>

        <Separator />

        <Section title="Timeline" defaultOpen={false}>
          <Textarea
            value={(draft.timeline as string) || ''}
            onChange={e => updateField('timeline', e.target.value)}
            className="min-h-[80px] text-xs"
            placeholder="Era, order of events, time jumps, chronological rules…"
          />
        </Section>

        <Separator />

        <Section title="World Rules" defaultOpen={false}>
          <Textarea
            value={(draft.world_rules as string) || ''}
            onChange={e => updateField('world_rules', e.target.value)}
            className="min-h-[80px] text-xs"
            placeholder="Physics, magic systems, technology rules, constraints…"
          />
        </Section>

        <Separator />

        <Section title="Locations" defaultOpen={false}>
          <Textarea
            value={(draft.locations as string) || ''}
            onChange={e => updateField('locations', e.target.value)}
            className="min-h-[80px] text-xs"
            placeholder="Key places, their rules, continuity notes…"
          />
        </Section>

        <Separator />

        <Section title="Ongoing Threads" defaultOpen={false}>
          <Textarea
            value={(draft.ongoing_threads as string) || ''}
            onChange={e => updateField('ongoing_threads', e.target.value)}
            className="min-h-[80px] text-xs"
            placeholder="Mysteries, unresolved arcs, planted seeds…"
          />
        </Section>

        <Separator />

        <Section title="Tone & Style" defaultOpen={false}>
          <Textarea
            value={(draft.tone_style as string) || ''}
            onChange={e => updateField('tone_style', e.target.value)}
            className="min-h-[80px] text-xs"
            placeholder="Voice, profanity level, rating target, camera language…"
          />
        </Section>

        <Separator />

        <Section title="Format Constraints" defaultOpen={false}>
          <Textarea
            value={(draft.format_constraints as string) || ''}
            onChange={e => updateField('format_constraints', e.target.value)}
            className="min-h-[60px] text-xs"
            placeholder="Episode length variance, runtime limits, vertical drama rules…"
          />
        </Section>

        <Separator />

        <Section title="Locked Facts (Forbidden Changes)" defaultOpen={false}>
          <Textarea
            value={(draft.forbidden_changes as string) || ''}
            onChange={e => updateField('forbidden_changes', e.target.value)}
            className="min-h-[60px] text-xs"
            placeholder="Facts that must NEVER be changed by AI generation…"
          />
        </Section>
      </div>
    </div>
  );
}

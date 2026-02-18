/**
 * NotesPanel — Tiered notes with inline decision cards + global directions.
 * Carried-forward notes support: Resolve Now, Apply Fix (AI patch), Dismiss.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Zap, ChevronDown, Sparkles, Loader2, CheckCircle2, ArrowRight, Lightbulb, Pencil, Check, X, Wand2 } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

const OTHER_OPTION_ID = '__other__';

export interface NoteDecisionOption {
  option_id: string;
  title: string;
  what_changes: string[];
  creative_tradeoff: string;
  commercial_lift: number;
}

export interface GlobalDirection {
  id: string;
  direction: string;
  why: string;
}

interface NotesPanelProps {
  allNotes: any[];
  tieredNotes: { blockers: any[]; high: any[]; polish: any[] };
  selectedNotes: Set<number>;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<number>>>;
  onApplyRewrite: (decisions?: Record<string, string>, globalDirections?: GlobalDirection[]) => void;
  isRewriting: boolean;
  isLoading: boolean;
  resolutionSummary?: { resolved: number; regressed: number } | null;
  stabilityStatus?: string | null;
  globalDirections?: GlobalDirection[];
  hideApplyButton?: boolean;
  onDecisionsChange?: (decisions: Record<string, string>) => void;
  onCustomDirectionsChange?: (customDirections: Record<string, string>) => void;
  externalDecisions?: Array<{ note_id: string; options: NoteDecisionOption[]; recommended_option_id?: string; recommended?: string }>;
  deferredNotes?: any[];
  carriedNotes?: any[];
  currentDocType?: string;
  currentVersionId?: string;
  onResolveCarriedNote?: (noteId: string, action: 'mark_resolved' | 'dismiss' | 'ai_patch' | 'apply_patch', extra?: any) => Promise<any>;
}

// ── Sub-components ──

function InlineDecisionCard({ decisions, recommended, selectedOptionId, onSelect, customDirection, onCustomDirection }: {
  decisions: NoteDecisionOption[];
  recommended?: string;
  selectedOptionId?: string;
  onSelect: (optionId: string) => void;
  customDirection?: string;
  onCustomDirection?: (text: string) => void;
}) {
  if (!decisions || decisions.length === 0) return null;
  const isOtherSelected = selectedOptionId === OTHER_OPTION_ID;
  return (
    <div className="mt-1.5 space-y-1">
      {decisions.map((opt) => {
        const isSelected = selectedOptionId === opt.option_id;
        const isRecommended = recommended === opt.option_id;
        return (
          <button key={opt.option_id} onClick={(e) => { e.stopPropagation(); onSelect(opt.option_id); }}
            className={`w-full text-left rounded px-2 py-1.5 border transition-all ${isSelected ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-muted/20 hover:border-border/60'}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}>
                {isSelected && <CheckCircle2 className="h-2 w-2 text-primary-foreground" />}
              </div>
              <span className="text-[10px] font-medium text-foreground">{opt.title}</span>
              {isRecommended && <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary bg-primary/10">Recommended</Badge>}
              {opt.commercial_lift > 0 && <Badge variant="outline" className="text-[7px] px-1 py-0 border-emerald-500/30 text-emerald-500">+{opt.commercial_lift} GP</Badge>}
            </div>
            <div className="pl-[18px] space-y-0.5">
              <div className="flex flex-wrap gap-0.5">
                {opt.what_changes.map((c, i) => <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 text-muted-foreground border-border/40">{c}</Badge>)}
              </div>
              <p className="text-[9px] text-muted-foreground italic">{opt.creative_tradeoff}</p>
            </div>
          </button>
        );
      })}
      <button onClick={(e) => { e.stopPropagation(); onSelect(OTHER_OPTION_ID); }}
        className={`w-full text-left rounded px-2 py-1.5 border transition-all ${isOtherSelected ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-muted/20 hover:border-border/60'}`}>
        <div className="flex items-center gap-1.5">
          <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${isOtherSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}>
            {isOtherSelected && <CheckCircle2 className="h-2 w-2 text-primary-foreground" />}
          </div>
          <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
          <span className="text-[10px] font-medium text-foreground">Other — suggest your own</span>
        </div>
      </button>
      {isOtherSelected && onCustomDirection && (
        <Textarea placeholder="Describe your proposed solution…" value={customDirection || ''}
          onChange={(e) => onCustomDirection(e.target.value)} onClick={(e) => e.stopPropagation()}
          className="text-[9px] min-h-[50px] h-12 mt-0.5" />
      )}
    </div>
  );
}

function NoteItem({ note, index, checked, onToggle, selectedOptionId, onSelectOption, customDirection, onCustomDirection }: {
  note: any; index: number; checked: boolean; onToggle: () => void;
  selectedOptionId?: string; onSelectOption?: (optionId: string) => void;
  customDirection?: string; onCustomDirection?: (text: string) => void;
}) {
  const severityColor = note.severity === 'blocker' ? 'border-destructive/40 bg-destructive/5' : note.severity === 'high' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/40';
  const severityBadge = note.severity === 'blocker' ? 'bg-destructive/20 text-destructive border-destructive/30' : note.severity === 'high' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-muted/40 text-muted-foreground border-border/50';
  const label = note.severity === 'blocker' ? '🔴 Blocker' : note.severity === 'high' ? '🟠 High' : '⚪ Polish';
  const hasDecisions = note.decisions && note.decisions.length > 0;
  return (
    <div className={`rounded border transition-colors ${checked ? severityColor : 'border-border/40 opacity-50'}`}>
      <div className="flex items-start gap-2 p-2 cursor-pointer" onClick={onToggle}>
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5 h-3.5 w-3.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${severityBadge}`}>{label}</Badge>
            {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
            {hasDecisions && <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/30 text-primary bg-primary/5">{note.decisions.length + 1} options</Badge>}
          </div>
          <p className="text-[10px] text-foreground leading-relaxed">{note.note || note.description}</p>
          {note.why_it_matters && <p className="text-[9px] text-muted-foreground mt-0.5 italic">{note.why_it_matters}</p>}
        </div>
      </div>
      {hasDecisions && checked && onSelectOption && (
        <div className="px-2 pb-2">
          <InlineDecisionCard decisions={note.decisions} recommended={note.recommended}
            selectedOptionId={selectedOptionId} onSelect={onSelectOption}
            customDirection={customDirection} onCustomDirection={onCustomDirection} />
        </div>
      )}
    </div>
  );
}

function GlobalDirectionsBar({ directions }: { directions: GlobalDirection[] }) {
  if (!directions || directions.length === 0) return null;
  return (
    <div className="space-y-1 p-2 rounded border border-primary/20 bg-primary/5">
      <div className="flex items-center gap-1 text-[10px] font-medium text-primary">
        <Lightbulb className="h-3 w-3" />Global Directions
      </div>
      {directions.map((d) => (
        <div key={d.id} className="flex items-start gap-1.5">
          <ArrowRight className="h-2.5 w-2.5 mt-0.5 text-primary/60 shrink-0" />
          <div>
            <p className="text-[10px] text-foreground font-medium">{d.direction}</p>
            <p className="text-[9px] text-muted-foreground">{d.why}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export function NotesPanel({
  allNotes, tieredNotes, selectedNotes, setSelectedNotes,
  onApplyRewrite, isRewriting, isLoading,
  resolutionSummary, stabilityStatus, globalDirections,
  hideApplyButton, onDecisionsChange, onCustomDirectionsChange, externalDecisions,
  deferredNotes, carriedNotes, currentDocType, currentVersionId, onResolveCarriedNote,
}: NotesPanelProps) {
  const [polishOpen, setPolishOpen] = useState(false);
  const [deferredOpen, setDeferredOpen] = useState(false);
  const [carriedOpen, setCarriedOpen] = useState(true);
  const [selectedDecisions, setSelectedDecisions] = useState<Record<string, string>>({});
  const [customDirections, setCustomDirections] = useState<Record<string, string>>({});

  // Carried-note resolution state
  const [resolvedNoteIds, setResolvedNoteIds] = useState<Set<string>>(new Set());
  const [resolvingNoteId, setResolvingNoteId] = useState<string | null>(null);
  const [patchDialog, setPatchDialog] = useState<{
    noteId: string; noteText: string;
    proposedEdits: Array<{ find: string; replace: string; rationale: string }>;
    summary: string;
    // Fix Generation Mode fields
    diagnosis?: string;
    affectedScenes?: string[];
    rootCause?: string;
    fixOptions?: Array<{ patch_name: string; where: string; what: string; structural_impact: string; risk: string }>;
    recommendedOption?: { patch_name: string; rationale: string; estimated_impact: string };
  } | null>(null);
  const [patchApplying, setPatchApplying] = useState(false);

  const externalDecisionMap = useMemo(() => {
    const map: Record<string, { options: NoteDecisionOption[]; recommended?: string }> = {};
    if (externalDecisions) {
      for (const d of externalDecisions) map[d.note_id] = { options: d.options, recommended: d.recommended_option_id || d.recommended };
    }
    return map;
  }, [externalDecisions]);

  const toggle = (i: number) => {
    setSelectedNotes(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; });
  };

  const handleSelectOption = useCallback((noteId: string, optionId: string) => {
    setSelectedDecisions(prev => {
      const next = { ...prev, [noteId]: prev[noteId] === optionId ? '' : optionId };
      onDecisionsChange?.(next);
      return next;
    });
  }, [onDecisionsChange]);

  const handleCustomDirection = useCallback((noteId: string, text: string) => {
    setCustomDirections(prev => { const next = { ...prev, [noteId]: text }; onCustomDirectionsChange?.(next); return next; });
  }, [onCustomDirectionsChange]);

  const handleApplyRewrite = useCallback(() => {
    const activeDecisions: Record<string, string> = {};
    for (const [noteId, optionId] of Object.entries(selectedDecisions)) { if (optionId) activeDecisions[noteId] = optionId; }
    onApplyRewrite(Object.keys(activeDecisions).length > 0 ? activeDecisions : undefined, globalDirections);
  }, [selectedDecisions, onApplyRewrite, globalDirections]);

  // Carried-note action handlers
  const handleMarkResolved = useCallback(async (noteId: string) => {
    if (!onResolveCarriedNote) return;
    setResolvingNoteId(noteId);
    try { await onResolveCarriedNote(noteId, 'mark_resolved'); setResolvedNoteIds(prev => new Set([...prev, noteId])); }
    finally { setResolvingNoteId(null); }
  }, [onResolveCarriedNote]);

  const handleDismiss = useCallback(async (noteId: string) => {
    if (!onResolveCarriedNote) return;
    setResolvingNoteId(noteId);
    try { await onResolveCarriedNote(noteId, 'dismiss'); setResolvedNoteIds(prev => new Set([...prev, noteId])); }
    finally { setResolvingNoteId(null); }
  }, [onResolveCarriedNote]);

  const handleAIPatch = useCallback(async (noteId: string, noteText: string) => {
    if (!onResolveCarriedNote) return;
    if (!currentVersionId) {
      // Show error if no version selected
      alert('Please select a document version before applying an AI fix.');
      return;
    }
    setResolvingNoteId(noteId);
    try {
      const result = await onResolveCarriedNote(noteId, 'ai_patch');
      if (result?.proposed_edits !== undefined || result?.fix_options !== undefined) {
        setPatchDialog({
          noteId,
          noteText,
          proposedEdits: result.proposed_edits || [],
          summary: result.summary || '',
          diagnosis: result.diagnosis,
          affectedScenes: result.affected_scenes,
          rootCause: result.root_cause,
          fixOptions: result.fix_options,
          recommendedOption: result.recommended_option,
        });
      }
    } finally { setResolvingNoteId(null); }
  }, [onResolveCarriedNote, currentVersionId]);

  const handleApplyPatch = useCallback(async () => {
    if (!patchDialog || !onResolveCarriedNote) return;
    setPatchApplying(true);
    try {
      await onResolveCarriedNote(patchDialog.noteId, 'apply_patch', patchDialog.proposedEdits);
      setResolvedNoteIds(prev => new Set([...prev, patchDialog.noteId]));
      setPatchDialog(null);
    } finally { setPatchApplying(false); }
  }, [patchDialog, onResolveCarriedNote]);

  const visibleCarriedNotes = (carriedNotes || []).filter((n: any) => {
    const id = n.id || n.note_key;
    return !resolvedNoteIds.has(id) && n.status !== 'resolved' && n.status !== 'dismissed';
  });

  if (allNotes.length === 0 && visibleCarriedNotes.length === 0) return null;

  const blockerCount = tieredNotes.blockers.length;
  const highCount = tieredNotes.high.length;
  const decisionsCount = Object.values(selectedDecisions).filter(Boolean).length;

  return (
    <>
      <Card className="border-primary/20">
        <CardHeader className="py-2 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-primary" />Notes
            </CardTitle>
            <div className="flex gap-1 items-center">
              {tieredNotes.blockers.length > 0 && <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px] px-1.5 py-0">{tieredNotes.blockers.length} Blockers</Badge>}
              {tieredNotes.high.length > 0 && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] px-1.5 py-0">{tieredNotes.high.length} High</Badge>}
              {tieredNotes.polish.length > 0 && <Badge className="bg-muted/40 text-muted-foreground border-border/50 text-[9px] px-1.5 py-0">{tieredNotes.polish.length} Polish</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2 space-y-2">
          {resolutionSummary && (resolutionSummary.resolved > 0 || resolutionSummary.regressed > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {resolutionSummary.resolved > 0 && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">{resolutionSummary.resolved} Resolved</Badge>}
              {resolutionSummary.regressed > 0 && <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px]">{resolutionSummary.regressed} Regressed</Badge>}
            </div>
          )}
          {stabilityStatus === 'structurally_stable' && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              <span>✓ Structurally Stable — Refinement Phase</span>
            </div>
          )}
          <GlobalDirectionsBar directions={globalDirections || []} />
          {allNotes.length > 0 && (
            <div className="flex gap-1 justify-end">
              <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5" onClick={() => setSelectedNotes(new Set(allNotes.map((_, i) => i)))}>All</Button>
              <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5" onClick={() => setSelectedNotes(new Set())}>None</Button>
            </div>
          )}

          <div className="space-y-2">
            {/* Blockers */}
            {tieredNotes.blockers.length > 0 && (
              <div className="space-y-1">
                {tieredNotes.blockers.map((note: any, i: number) => {
                  const noteId = note.id || note.note_key;
                  const ext = externalDecisionMap[noteId];
                  const enrichedNote = ext && !note.decisions?.length ? { ...note, severity: 'blocker', decisions: ext.options, recommended: ext.recommended } : { ...note, severity: 'blocker' };
                  return <NoteItem key={`b-${i}`} note={enrichedNote} index={i} checked={selectedNotes.has(i)} onToggle={() => toggle(i)} selectedOptionId={selectedDecisions[noteId]} onSelectOption={(optionId) => handleSelectOption(noteId, optionId)} customDirection={customDirections[noteId]} onCustomDirection={(text) => handleCustomDirection(noteId, text)} />;
                })}
              </div>
            )}

            {/* High impact */}
            {tieredNotes.high.length > 0 && (
              <div className="space-y-1">
                {tieredNotes.high.map((note: any, i: number) => {
                  const idx = blockerCount + i;
                  const noteId = note.id || note.note_key;
                  const ext = externalDecisionMap[noteId];
                  const enrichedNote = ext && !note.decisions?.length ? { ...note, severity: 'high', decisions: ext.options, recommended: ext.recommended } : { ...note, severity: 'high' };
                  return <NoteItem key={`h-${i}`} note={enrichedNote} index={idx} checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)} selectedOptionId={selectedDecisions[noteId]} onSelectOption={(optionId) => handleSelectOption(noteId, optionId)} customDirection={customDirections[noteId]} onCustomDirection={(text) => handleCustomDirection(noteId, text)} />;
                })}
              </div>
            )}

            {/* Polish */}
            {tieredNotes.polish.length > 0 && (
              <Collapsible open={polishOpen} onOpenChange={setPolishOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${polishOpen ? 'rotate-0' : '-rotate-90'}`} />
                  {tieredNotes.polish.length} Polish Notes
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {tieredNotes.polish.map((note: any, i: number) => {
                    const idx = blockerCount + highCount + i;
                    return <NoteItem key={`p-${i}`} note={{ ...note, severity: 'polish' }} index={idx} checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)} />;
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Carried-forward notes with resolution actions */}
            {visibleCarriedNotes.length > 0 && (
              <Collapsible open={carriedOpen} onOpenChange={setCarriedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors w-full py-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${carriedOpen ? 'rotate-0' : '-rotate-90'}`} />
                  <ArrowRight className="h-3 w-3" />
                  {visibleCarriedNotes.length} Carried Forward
                  <span className="text-[8px] text-muted-foreground ml-1">(from earlier docs)</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1.5 mt-1">
                  {visibleCarriedNotes.map((note: any, i: number) => {
                    const noteId = note.id || note.note_key;
                    const noteText = note.description || note.note || '';
                    const isResolving = resolvingNoteId === noteId;
                    const canResolve = !!onResolveCarriedNote;
                    return (
                      <div key={`carried-${i}`} className="rounded border border-primary/20 bg-primary/5 p-2 space-y-1.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-primary">From: {note.source_doc_type || 'earlier'}</Badge>
                          {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
                          {note.severity && (
                            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}>
                              {note.severity}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-foreground leading-relaxed">{noteText}</p>
                        {note.why_it_matters && <p className="text-[9px] text-muted-foreground italic">{note.why_it_matters}</p>}
                        {canResolve && (
                          <div className="flex items-center gap-1 pt-0.5 flex-wrap">
                            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleMarkResolved(noteId)} disabled={isResolving}>
                              {isResolving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                              Resolve now
                            </Button>
                            {currentVersionId && (
                              <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-sky-500/30 text-sky-400 hover:bg-sky-500/10" onClick={() => handleAIPatch(noteId, noteText)} disabled={isResolving}>
                                {isResolving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
                                Apply fix now
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 text-muted-foreground hover:text-destructive" onClick={() => handleDismiss(noteId)} disabled={isResolving}>
                              <X className="h-2.5 w-2.5" />Dismiss
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Deferred notes */}
            {deferredNotes && deferredNotes.length > 0 && (
              <Collapsible open={deferredOpen} onOpenChange={setDeferredOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${deferredOpen ? 'rotate-0' : '-rotate-90'}`} />
                  {deferredNotes.length} Deferred
                  <span className="text-[8px] text-muted-foreground ml-1">(for later docs)</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {deferredNotes.map((note: any, i: number) => (
                    <div key={`def-${i}`} className="rounded border border-border/30 bg-muted/10 p-2 opacity-70">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Badge variant="outline" className="text-[8px] px-1 py-0">→ {note.target_deliverable_type || 'later'}</Badge>
                        <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">{note.apply_timing === 'next_doc' ? 'Next Doc' : 'Later'}</Badge>
                        {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
                      </div>
                      <p className="text-[10px] text-foreground">{note.description || note.note}</p>
                      {note.defer_reason && <p className="text-[9px] text-muted-foreground mt-0.5 italic">↳ {note.defer_reason}</p>}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>

          {!hideApplyButton && allNotes.length > 0 && (
            <Button size="sm" className="h-7 text-xs gap-1.5 w-full" onClick={handleApplyRewrite} disabled={isLoading || isRewriting || selectedNotes.size === 0}>
              {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Apply Rewrite ({selectedNotes.size} notes{decisionsCount > 0 ? `, ${decisionsCount} decisions` : ''})
            </Button>
          )}
        </CardContent>
      </Card>

      {/* AI Fix Generation Mode Dialog */}
      <Dialog open={!!patchDialog} onOpenChange={(open) => { if (!open) setPatchDialog(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-sky-400" />Fix Generation — Review Before Applying
            </DialogTitle>
          </DialogHeader>
          {patchDialog && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-3 pr-2">
                {/* Note being resolved */}
                <div className="p-2 rounded border border-primary/20 bg-primary/5">
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Note:</p>
                  <p className="text-[10px] text-foreground">{patchDialog.noteText}</p>
                </div>

                {/* Section 1 — Diagnosis */}
                {patchDialog.diagnosis && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§1 Diagnosis</p>
                    <p className="text-[10px] text-foreground">{patchDialog.diagnosis}</p>
                    {patchDialog.affectedScenes && patchDialog.affectedScenes.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        {patchDialog.affectedScenes.map((s, i) => (
                          <p key={i} className="text-[9px] text-muted-foreground pl-2 border-l border-primary/30">• {s}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Section 2 — Root Cause */}
                {patchDialog.rootCause && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§2 Root Cause</p>
                    <p className="text-[10px] text-foreground">{patchDialog.rootCause}</p>
                  </div>
                )}

                {/* Section 3 — Fix Options */}
                {patchDialog.fixOptions && patchDialog.fixOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§3 Fix Options ({patchDialog.fixOptions.length})</p>
                    {patchDialog.fixOptions.map((opt, i) => (
                      <div key={i} className={`rounded border p-2 space-y-1 ${patchDialog.recommendedOption?.patch_name === opt.patch_name ? 'border-sky-500/40 bg-sky-500/5' : 'border-border/40 bg-muted/10'}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-foreground">{opt.patch_name}</span>
                          {patchDialog.recommendedOption?.patch_name === opt.patch_name && (
                            <Badge variant="outline" className="text-[7px] px-1 py-0 border-sky-500/40 text-sky-400">Recommended</Badge>
                          )}
                        </div>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">Where:</span> {opt.where}</p>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">What:</span> {opt.what}</p>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">Impact:</span> {opt.structural_impact}</p>
                        <p className="text-[9px] text-muted-foreground italic"><span className="text-foreground/70 font-medium">Risk:</span> {opt.risk}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Section 4 — Recommended Option */}
                {patchDialog.recommendedOption && (
                  <div className="space-y-1 p-2 rounded border border-emerald-500/30 bg-emerald-500/5">
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">§4 Recommended Fix</p>
                    <p className="text-[10px] font-medium text-foreground">{patchDialog.recommendedOption.patch_name}</p>
                    <p className="text-[10px] text-muted-foreground">{patchDialog.recommendedOption.rationale}</p>
                    {patchDialog.recommendedOption.estimated_impact && (
                      <p className="text-[9px] text-emerald-400 font-medium">Est. impact: {patchDialog.recommendedOption.estimated_impact}</p>
                    )}
                  </div>
                )}

                {/* Proposed Edits */}
                {patchDialog.proposedEdits.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Proposed Edits ({patchDialog.proposedEdits.length})</p>
                    <div className="space-y-2">
                      {patchDialog.proposedEdits.map((edit, i) => (
                        <div key={i} className="rounded border border-border/40 bg-muted/20 p-2 space-y-1">
                          <p className="text-[9px] text-muted-foreground font-medium">Replace:</p>
                          <p className="text-[9px] font-mono bg-destructive/10 px-1.5 py-1 rounded line-clamp-3">{edit.find}</p>
                          <p className="text-[9px] text-muted-foreground font-medium">With:</p>
                          <p className="text-[9px] font-mono bg-emerald-500/10 px-1.5 py-1 rounded line-clamp-3">{edit.replace}</p>
                          {edit.rationale && <p className="text-[8px] text-muted-foreground italic">{edit.rationale}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5 text-[10px] text-emerald-400">
                    ✓ Note appears already addressed. No edits needed.
                  </div>
                )}

                {/* Summary */}
                {patchDialog.summary && (
                  <p className="text-[9px] text-muted-foreground italic">{patchDialog.summary}</p>
                )}
              </div>
            </ScrollArea>
          )}
          <DialogFooter className="gap-2 pt-2 border-t border-border/30">
            <Button variant="ghost" size="sm" onClick={() => setPatchDialog(null)}>Cancel</Button>
            {patchDialog && patchDialog.proposedEdits.length > 0 && (
              <Button size="sm" className="gap-1.5" onClick={handleApplyPatch} disabled={patchApplying}>
                {patchApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Apply Recommended Fix
              </Button>
            )}
            {patchDialog && patchDialog.proposedEdits.length === 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-500"
                onClick={async () => {
                  if (!onResolveCarriedNote || !patchDialog) return;
                  await onResolveCarriedNote(patchDialog.noteId, 'mark_resolved');
                  setResolvedNoteIds(prev => new Set([...prev, patchDialog.noteId]));
                  setPatchDialog(null);
                }}>
                <Check className="h-3.5 w-3.5" />Mark Resolved
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


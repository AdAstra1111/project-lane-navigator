/**
 * NoteDrawer — THE canonical single drawer for all note interactions.
 * ID-DRIVEN: can open with just noteId (fetches from DB).
 * Sections: Header → Summary → Anchor → Triage → Fix Options → Change Plan → Apply → Verify
 */
import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  Loader2, Check, X, Wand2, AlertTriangle, Clock, ChevronDown, ExternalLink,
  Sparkles, Shield, FileText, RotateCcw, ArrowRight,
} from 'lucide-react';
import type { ProjectNote, NoteSuggestedFix, NoteTiming, NoteStatus, PatchSection, NoteEvent } from '@/lib/types/notes';
import { useNote, useNotesMutations } from '@/lib/notes/useProjectNotes';
import { BASE_DOC_TYPES, getDocTypeLabel, normalizeDocType } from '@/config/documentLadders';

const DOC_TYPES = Object.keys(BASE_DOC_TYPES);

const SEVERITY_STYLES: Record<string, string> = {
  blocker: 'bg-destructive/20 text-destructive border-destructive/30',
  high: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  med: 'bg-muted/40 text-muted-foreground border-border/50',
  low: 'bg-muted/20 text-muted-foreground/70 border-border/30',
};

const TIMING_STYLES: Record<string, string> = {
  now: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  later: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  dependent: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
};

interface NoteDrawerProps {
  projectId: string;
  noteId: string | null;
  note?: ProjectNote | null; // optional — if not provided, fetches by noteId
  context?: { docType?: string; documentId?: string; versionId?: string };
  onApplied?: (newVersionId: string) => void;
  onClose: () => void;
  open: boolean;
}

export function NoteDrawer({ projectId, noteId, note: noteProp, context, onApplied, onClose, open }: NoteDrawerProps) {
  // Fetch note from DB if not provided as prop
  const { data: fetchedData, isLoading: noteLoading } = useNote(
    open ? projectId : undefined,
    open && !noteProp && noteId ? noteId : null
  );

  const note = noteProp || fetchedData?.note || null;
  const events: NoteEvent[] = fetchedData?.events || [];

  const { triageMutation, proposeMutation, applyMutation, verifyMutation } = useNotesMutations(projectId);

  // Local state
  const [selectedFixId, setSelectedFixId] = useState<string | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');
  const [scope, setScope] = useState<'selection' | 'scene' | 'doc'>('doc');
  const [deferDocType, setDeferDocType] = useState('');
  const [changePlan, setChangePlan] = useState<{
    changeEventId: string; diffSummary: string; patches: PatchSection[]; impact?: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [verifyComment, setVerifyComment] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [applyError, setApplyError] = useState<any>(null);
  const [quickFixRunning, setQuickFixRunning] = useState<string | null>(null);
  const [quickFixError, setQuickFixError] = useState<Record<string, string>>({});
  const [quickFixDone, setQuickFixDone] = useState<string | null>(null);
  const [lastApplySummary, setLastApplySummary] = useState<{
    diffSummary?: string; patchCount?: number; patchTitles?: string[]; changeEventId?: string;
  } | null>(null);

  // Reset state when note changes
  useEffect(() => {
    setSelectedFixId(null);
    setCustomInstruction('');
    setChangePlan(null);
    setConfirmed(false);
    setVerifyComment('');
    setDetailOpen(false);
    setDeferDocType('');
    setApplyError(null);
    setQuickFixRunning(null);
    setQuickFixError({});
    setQuickFixDone(null);
    setLastApplySummary(null);
  }, [noteId]);

  const rawFixes = (note?.suggested_fixes || []) as NoteSuggestedFix[];

  // Smart deterministic fallback fixes
  type FixKind = 'doc_ladder' | 'naming' | 'formatting' | 'general';

  function classifyNote(n: ProjectNote): FixKind {
    const t = `${n.title || ''} ${n.summary || ''} ${n.detail || ''}`.toLowerCase();
    if (
      t.includes('document ladder') || t.includes('doc ladder') ||
      t.includes('document type') || t.includes('doc type') ||
      t.includes('section header') ||
      (t.includes('header') && (t.includes('rename') || t.includes('official') || t.includes('map')))
    ) return 'doc_ladder';
    if (t.includes('label') || t.includes('naming') || t.includes('rename')) return 'naming';
    if (t.includes('format') || t.includes('markdown') || t.includes('bullet') || t.includes('whitespace')) return 'formatting';
    return 'general';
  }

  function buildFallbackFixes(n: ProjectNote, ladder: string): NoteSuggestedFix[] {
    const kind = classifyNote(n);
    const base = (n.summary || n.title || '').trim();
    if (kind === 'doc_ladder') {
      const lt = (ladder || '').trim();
      const ladderLine = lt ? `Use the "${lt}" document ladder.` : 'A document ladder selection is required.';
      return [
        { id: 'auto-doc-rename', title: 'Map headers to official doc types', description: 'Rename non-official section headers to the selected ladder\'s official document types.', instructions: `${ladderLine} Replace non-official section headers by mapping them to the closest valid official document type header. Do not invent new types outside the ladder. Preserve content; change headings only.` },
        { id: 'auto-doc-preserve', title: 'Map headers + preserve original label', description: 'Use official document types, but keep the original header as a short subtitle line.', instructions: `${ladderLine} Convert each non-official section header into the closest valid official document type header. Under the new header, add a one-line subtitle preserving the original label. Preserve content; change headings only.` },
        { id: 'auto-doc-defer', title: 'Defer (needs ladder decision)', description: 'If unsure, do not change headers until the correct ladder is selected.', instructions: `${base}. Do not apply any header renames unless the correct document ladder is selected.` },
      ];
    }
    if (kind === 'formatting') {
      return [
        { id: 'auto-format-min', title: 'Minimal formatting fix', description: 'Fix formatting issues with minimal edits.', instructions: `${base}. Make only formatting changes (spacing, bullets, headings) without changing meaning or structure.` },
        { id: 'auto-format-consistent', title: 'Normalize formatting', description: 'Normalize formatting to match the project\'s standard style.', instructions: `${base}. Normalize formatting consistently (headings, bullets, spacing) to match existing project conventions. Do not rewrite content.` },
      ];
    }
    if (kind === 'naming') {
      return [
        { id: 'auto-name-min', title: 'Standardize naming', description: 'Fix naming inconsistencies with minimal changes.', instructions: `${base}. Standardize names/labels to match the project's conventions. Prefer renaming labels over rewriting content.` },
        { id: 'auto-name-preserve', title: 'Standardize + preserve original', description: 'Standardize names but preserve original term where useful.', instructions: `${base}. Standardize names/labels to match project conventions, preserving original terms in parentheses if needed for clarity.` },
      ];
    }
    return [
      { id: 'auto-direct', title: 'Direct fix', description: `Apply the suggested change: ${(base || '').slice(0, 80)}`, instructions: base },
      { id: 'auto-conservative', title: 'Conservative fix', description: 'Apply the change conservatively, preserving original structure as much as possible.', instructions: `${base}. Preserve the original structure and wording where possible, making only the minimal changes needed.` },
    ];
  }

  const fixes: NoteSuggestedFix[] =
    rawFixes.length > 0
      ? rawFixes.slice(0, 3)
      : note
        ? buildFallbackFixes(note, deferDocType).slice(0, 3)
        : [];

  const isApplied = note?.status === 'applied';
  const isDismissed = note?.status === 'dismissed';

  // Doc-ladder guard: detect notes that need a doc type selection
  function noteRequiresDocType(n: ProjectNote): boolean {
    return classifyNote(n) === 'doc_ladder';
  }

  // Quick-fix: propose → apply → verify in one click
  const handleQuickFix = useCallback(async (fix: NoteSuggestedFix) => {
    const id = noteId || note?.id;
    if (!id) return;

    // Defer fix: skip propose/apply, only triage as deferred
    if (fix.id === 'auto-doc-defer') {
      setQuickFixRunning(fix.id);
      setQuickFixError(prev => { const n = { ...prev }; delete n[fix.id]; return n; });
      try {
        await new Promise<void>((resolve, reject) => {
          triageMutation.mutate(
            { noteId: id, triage: { status: 'deferred' as NoteStatus, timing: 'later' as NoteTiming, destinationDocType: deferDocType || undefined } },
            { onSuccess: () => resolve(), onError: reject }
          );
        });
        setQuickFixDone(fix.id);
        setLastApplySummary({ diffSummary: 'Deferred: requires document ladder selection before applying.' });
        setTimeout(() => onClose(), 700);
      } catch (err: any) {
        setQuickFixError(prev => ({ ...prev, [fix.id]: err?.message || 'Defer failed' }));
      } finally {
        setQuickFixRunning(null);
      }
      return;
    }

    // Doc-ladder guard
    if (note && noteRequiresDocType(note) && !deferDocType) {
      setQuickFixError(prev => ({
        ...prev,
        [fix.id]: 'Select a document type (Defer dropdown) before applying this fix.',
      }));
      return;
    }

    setQuickFixRunning(fix.id);
    setQuickFixError(prev => { const n = { ...prev }; delete n[fix.id]; return n; });
    try {
      // Step 1: Propose change plan
      const data = await new Promise<any>((resolve, reject) => {
        proposeMutation.mutate(
          { noteId: id, fixId: fix.id, customInstruction: fix.instructions || fix.description, scope, baseVersionId: context?.versionId },
          { onSuccess: resolve, onError: reject }
        );
      });
      // Step 2: Apply change plan
      const applyData = await new Promise<any>((resolve, reject) => {
        applyMutation.mutate(data.changeEventId, { onSuccess: resolve, onError: reject });
      });
      // Step 3: Verify resolved
      await new Promise<void>((resolve, reject) => {
        verifyMutation.mutate(
          { noteId: id, result: 'resolved', comment: `Auto-resolved via fix: ${fix.title}` },
          { onSuccess: () => resolve(), onError: reject }
        );
      });
      setQuickFixDone(fix.id);
      // Build deterministic post-apply summary
      const patches = Array.isArray((data as any)?.patchPreview) ? (data as any).patchPreview : [];
      setLastApplySummary({
        diffSummary: (data as any)?.diffSummary || 'Applied changes.',
        patchCount: patches.length || undefined,
        patchTitles: patches.map((p: any) => p?.location || p?.title).filter((t: any) => typeof t === 'string').slice(0, 5),
        changeEventId: (data as any)?.changeEventId,
      });
      const newVersionId = (applyData as any)?.newVersionId ?? (applyData as any)?.versionId ?? null;
      if (newVersionId) onApplied?.(newVersionId);
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setQuickFixError(prev => ({ ...prev, [fix.id]: err?.message || 'Fix failed' }));
    } finally {
      setQuickFixRunning(null);
    }
  }, [noteId, note, scope, context, deferDocType, triageMutation, proposeMutation, applyMutation, verifyMutation, onApplied, onClose]);

  // Triage actions
  const handleTriage = useCallback((status: NoteStatus, timing?: NoteTiming) => {
    if (!noteId && !note?.id) return;
    const id = noteId || note!.id;
    triageMutation.mutate({ noteId: id, triage: { status, timing, destinationDocType: timing === 'later' ? deferDocType : undefined } });
  }, [noteId, note, deferDocType, triageMutation]);

  const handleDefer = useCallback(() => {
    if ((!noteId && !note?.id) || !deferDocType) { toast.error('Select a destination doc type'); return; }
    const id = noteId || note!.id;
    triageMutation.mutate({ noteId: id, triage: { status: 'deferred', timing: 'later', destinationDocType: deferDocType } });
  }, [noteId, note, deferDocType, triageMutation]);

  // Propose change plan (enabled even without fix selection)
  const handlePropose = useCallback(() => {
    if (!noteId && !note?.id) return;
    const id = noteId || note!.id;
    setApplyError(null);
    proposeMutation.mutate(
      { noteId: id, fixId: selectedFixId || undefined, customInstruction: customInstruction || undefined, scope, baseVersionId: context?.versionId },
      {
        onSuccess: (data) => {
          setChangePlan({
            changeEventId: data.changeEventId,
            diffSummary: data.diffSummary,
            patches: data.patchPreview || [],
            impact: data.estimatedImpact,
          });
        },
      }
    );
  }, [noteId, note, selectedFixId, customInstruction, scope, context, proposeMutation]);

  // Apply
  const handleApply = useCallback(() => {
    if (!changePlan?.changeEventId) return;
    setApplyError(null);
    applyMutation.mutate(changePlan.changeEventId, {
      onSuccess: (data) => {
        const vid = (data as any)?.newVersionId ?? (data as any)?.versionId ?? null;
        if (vid) onApplied?.(vid);
        setLastApplySummary({
          diffSummary: changePlan?.diffSummary || 'Applied changes.',
          patchCount: changePlan?.patches?.length,
          patchTitles: Array.isArray(changePlan?.patches)
            ? changePlan!.patches.map((p: any) => p?.location || p?.title).filter((t: any) => typeof t === 'string').slice(0, 5)
            : undefined,
          changeEventId: changePlan?.changeEventId,
        });
        onClose();
      },
      onError: (err: any) => {
        if (err.needs_user_disambiguation) {
          setApplyError(err);
        }
      },
    });
  }, [changePlan, applyMutation, onApplied, onClose]);

  // Verify
  const handleVerify = useCallback((result: 'resolved' | 'reopen') => {
    if (!noteId && !note?.id) return;
    const id = noteId || note!.id;
    verifyMutation.mutate({ noteId: id, result, comment: verifyComment || undefined }, {
      onSuccess: () => onClose(),
    });
  }, [noteId, note, verifyComment, verifyMutation, onClose]);

  if (!open) return null;

  // Loading state
  if (noteLoading && !note) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading note…</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!note) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* 1. Header */}
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border/30">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Note Resolution
          </DialogTitle>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            <Badge variant="outline" className={`text-[9px] ${SEVERITY_STYLES[note.severity] || ''}`}>
              {note.severity === 'blocker' ? '🔴' : note.severity === 'high' ? '🟠' : '⚪'} {note.severity}
            </Badge>
            <Badge variant="outline" className="text-[9px]">{note.category}</Badge>
            <Badge variant="outline" className={`text-[9px] ${TIMING_STYLES[note.timing] || ''}`}>
              {note.timing === 'now' ? '⚡ NOW' : note.timing === 'later' ? '⏳ LATER' : '🔗 DEPENDENT'}
            </Badge>
            <Badge variant="outline" className={`text-[9px] ${
              note.status === 'applied' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
              note.status === 'dismissed' ? 'bg-muted/30 text-muted-foreground line-through' :
              note.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              ''
            }`}>
              {note.status}
            </Badge>
            {note.doc_type && (
              <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
                <FileText className="h-2 w-2 mr-0.5 inline" />{note.doc_type.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 p-4">
            {/* 2. Summary + Detail */}
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">{note.title}</h3>
              <p className="text-xs text-foreground/90">{note.summary}</p>
              {note.detail && (
                <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                    <ChevronDown className={`h-2.5 w-2.5 transition-transform ${detailOpen ? '' : '-rotate-90'}`} />
                    Detail
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="text-[11px] text-muted-foreground mt-1 p-2 rounded bg-muted/20 border border-border/30">
                      {note.detail}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>

            {/* 3. Anchor */}
            {note.anchor && (
              <div className="p-2 rounded border border-border/30 bg-muted/10">
                <p className="text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">Where:</span>{' '}
                  {note.anchor.kind === 'scene' ? `Scene ${note.anchor.sceneNumber}` :
                   note.anchor.kind === 'line_range' ? `Lines ${note.anchor.start}–${note.anchor.end}` :
                   note.anchor.kind === 'beat' ? `Beat: ${note.anchor.beatId}` : 'Document-level'}
                  {note.anchor.quote && <span className="italic ml-1">"{note.anchor.quote.slice(0, 80)}"</span>}
                </p>
              </div>
            )}

            {/* 4. Timing Gate / Triage Controls */}
            {!isApplied && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Triage</p>
                <div className="flex gap-1.5 flex-wrap">
                  <Button variant={note.timing === 'now' ? 'default' : 'outline'} size="sm"
                    className="h-6 text-[10px] gap-1" disabled={triageMutation.isPending}
                    onClick={() => handleTriage('open', 'now')}>
                    ⚡ Fix Now
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1"
                    disabled={triageMutation.isPending}
                    onClick={() => handleTriage('needs_decision')}>
                    Needs Decision
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground"
                    disabled={triageMutation.isPending}
                    onClick={() => handleTriage('dismissed')}>
                    <X className="h-2.5 w-2.5" />Dismiss
                  </Button>
                </div>
                {/* Defer controls */}
                <div className="flex items-center gap-1.5">
                  <Select value={deferDocType} onValueChange={setDeferDocType}>
                    <SelectTrigger className="h-6 text-[10px] w-40 px-2 border-border/30">
                      <SelectValue placeholder="Defer to doc type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.filter(d => d !== note.doc_type).map(d => (
                        <SelectItem key={d} value={d} className="text-[10px]">{d.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1"
                    disabled={!deferDocType || triageMutation.isPending}
                    onClick={handleDefer}>
                    <Clock className="h-2.5 w-2.5" />Defer
                  </Button>
                </div>
              </div>
            )}

            {/* 5. Fix Options */}
             {!isApplied && !isDismissed && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Fix Options</p>
                {fixes.length > 0 ? (
                  <div className="space-y-1.5">
                    {fixes.map((fix) => {
                      const isRunning = quickFixRunning === fix.id;
                      const isDone = quickFixDone === fix.id;
                      const error = quickFixError[fix.id];
                      return (
                        <div key={fix.id}
                          className={`w-full text-left rounded-lg border p-2.5 space-y-1 transition-colors ${
                            isDone ? 'border-emerald-500/50 bg-emerald-500/5' :
                            selectedFixId === fix.id ? 'border-primary bg-primary/5' : 'border-border/50 bg-background hover:border-border'
                          }`}>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => {
                                if (quickFixRunning) return;
                                setSelectedFixId(prev => prev === fix.id ? null : fix.id);
                              }}
                              className="flex items-center gap-1.5 flex-1 min-w-0 text-left" disabled={!!quickFixRunning}>
                              <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                selectedFixId === fix.id ? 'border-primary' : 'border-muted-foreground/30'
                              }`}>
                                {selectedFixId === fix.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                              </div>
                              <span className="text-xs font-medium text-foreground truncate">{fix.title}</span>
                            </button>
                            {fix.risk_level && (
                              <Badge variant="outline" className={`text-[7px] px-1 py-0 shrink-0 ${
                                fix.risk_level === 'high' ? 'text-destructive border-destructive/30' :
                                fix.risk_level === 'med' ? 'text-amber-500 border-amber-500/30' :
                                'text-emerald-500 border-emerald-500/30'
                              }`}>{fix.risk_level} risk</Badge>
                            )}
                            <Button variant="outline" size="sm"
                              className={`h-5 text-[9px] px-2 gap-1 shrink-0 ${isDone ? 'border-emerald-500/30 text-emerald-500' : ''}`}
                              disabled={isRunning || !!quickFixRunning || isDone}
                              onClick={(e) => { e.stopPropagation(); handleQuickFix(fix); }}>
                              {isRunning ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Applying…</> :
                               isDone ? <><Check className="h-2.5 w-2.5" /> Applied</> :
                               <><ArrowRight className="h-2.5 w-2.5" /> Apply fix</>}
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground pl-[18px]">{fix.description}</p>
                          {fix.expected_effect && selectedFixId === fix.id && (
                            <p className="text-[10px] text-primary/80 pl-[18px] italic">Expected: {fix.expected_effect}</p>
                          )}
                          {error && (
                            <p className="text-[10px] text-destructive pl-[18px]">Error: {error}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">No suggested fixes yet. Use "Custom" or generate a change plan directly.</p>
                )}
                {/* Custom instruction */}
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground font-medium">Custom instruction (optional):</p>
                  <Textarea value={customInstruction} onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Describe your own fix approach…"
                    className="text-[11px] min-h-[50px] h-14" />
                </div>
                {/* Scope */}
                <div className="flex items-center gap-2">
                  <p className="text-[9px] text-muted-foreground font-medium">Scope:</p>
                  {(['doc', 'scene', 'selection'] as const).map(s => (
                    <Button key={s} variant={scope === s ? 'default' : 'outline'} size="sm"
                      className="h-5 text-[9px] px-2" onClick={() => setScope(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Change Plan */}
            {!isApplied && !isDismissed && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Change Plan</p>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1"
                    disabled={proposeMutation.isPending}
                    onClick={handlePropose}>
                    {proposeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Generate Change Plan
                  </Button>
                </div>
                {changePlan && (
                  <div className="space-y-2 p-2.5 rounded border border-primary/20 bg-primary/5">
                    {changePlan.diffSummary && (
                      <p className="text-[11px] text-foreground">{changePlan.diffSummary}</p>
                    )}
                    {changePlan.patches.length > 0 && (
                      <div className="space-y-1.5">
                        {changePlan.patches.map((p, i) => (
                          <div key={i} className="rounded border border-border/40 bg-background p-2 space-y-1">
                            <p className="text-[10px] text-foreground font-medium">{p.location} — {p.action}</p>
                            {p.original_snippet && (
                              <p className="text-[9px] font-mono bg-destructive/10 px-1.5 py-1 rounded line-clamp-2">{p.original_snippet}</p>
                            )}
                            {p.new_snippet && (
                              <p className="text-[9px] font-mono bg-emerald-500/10 px-1.5 py-1 rounded line-clamp-2">{p.new_snippet}</p>
                            )}
                            {p.rationale && <p className="text-[9px] text-muted-foreground italic">{p.rationale}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {changePlan.impact && (
                      <p className="text-[10px] text-muted-foreground italic">Impact: {changePlan.impact}</p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox id="confirm-apply" checked={confirmed} onCheckedChange={(c) => setConfirmed(!!c)} />
                      <label htmlFor="confirm-apply" className="text-[10px] text-muted-foreground cursor-pointer">
                        I understand this will create a new version
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Disambiguation error */}
            {applyError?.needs_user_disambiguation && (
              <div className="p-2.5 rounded border border-amber-500/30 bg-amber-500/10 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Patch ambiguous — multiple occurrences found
                </div>
                <p className="text-[9px] text-muted-foreground">{applyError.hint}</p>
                {applyError.patch_errors?.map((pe: any, i: number) => (
                  pe.matches && (
                    <div key={i} className="space-y-1">
                      <p className="text-[9px] text-foreground font-medium">Patch {pe.patch_index + 1}: {pe.matches.length} matches</p>
                      {pe.matches.map((m: any, j: number) => (
                        <p key={j} className="text-[8px] font-mono bg-muted/20 px-1.5 py-1 rounded truncate">
                          #{m.idx}: …{m.preview}…
                        </p>
                      ))}
                    </div>
                  )
                ))}
                <p className="text-[9px] text-muted-foreground italic">Please re-generate the change plan with a more specific custom instruction.</p>
              </div>
            )}

            {/* 7. Apply */}
            {changePlan && !isApplied && (
              <Button size="sm" className="h-8 text-xs gap-1.5 w-full"
                disabled={!confirmed || applyMutation.isPending}
                onClick={handleApply}>
                {applyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Apply Change Plan
              </Button>
            )}

            {/* 8. Verify */}
            {(isApplied || note.status === 'in_progress') && (
              <div className="space-y-2 p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5">
                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Verify</p>
                <Textarea value={verifyComment} onChange={(e) => setVerifyComment(e.target.value)}
                  placeholder="Optional comment…"
                  className="text-[11px] min-h-[40px] h-10" />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs gap-1 flex-1 bg-emerald-600 hover:bg-emerald-700"
                    disabled={verifyMutation.isPending}
                    onClick={() => handleVerify('resolved')}>
                    <Check className="h-3 w-3" />Resolved
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-1"
                    disabled={verifyMutation.isPending}
                    onClick={() => handleVerify('reopen')}>
                    <RotateCcw className="h-3 w-3" />Reopen
                  </Button>
                </div>
              </div>
            )}

            {/* Post-apply summary */}
            {lastApplySummary && (
              <div className="rounded-md border border-border/40 bg-muted/10 p-2.5 text-xs space-y-1">
                <div className="font-medium text-foreground flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-500" /> Applied
                </div>
                <p className="text-muted-foreground">{lastApplySummary.diffSummary}</p>
                {typeof lastApplySummary.patchCount === 'number' && (
                  <p className="text-muted-foreground">
                    {lastApplySummary.patchCount} patch{lastApplySummary.patchCount === 1 ? '' : 'es'}
                  </p>
                )}
                {Array.isArray(lastApplySummary.patchTitles) && lastApplySummary.patchTitles.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground text-[10px]">Details</summary>
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground text-[10px]">
                      {lastApplySummary.patchTitles.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* Activity log */}
            {events.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-2.5 w-2.5" />
                  Activity ({events.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                    {events.map(ev => (
                      <div key={ev.id} className="text-[9px] text-muted-foreground flex items-center gap-1">
                        <span className="font-mono">{new Date(ev.created_at).toLocaleString()}</span>
                        <Badge variant="outline" className="text-[7px] px-1 py-0">{ev.event_type}</Badge>
                        {(ev.payload as any)?.comment && <span className="italic">"{(ev.payload as any).comment}"</span>}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

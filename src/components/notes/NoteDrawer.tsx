/**
 * NoteDrawer — THE canonical single drawer for all note interactions.
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
import type { ProjectNote, NoteSuggestedFix, NoteTiming, NoteStatus, PatchSection } from '@/lib/types/notes';
import { useNotesMutations } from '@/lib/notes/useProjectNotes';

const DOC_TYPES = [
  'concept_brief', 'market_sheet', 'blueprint', 'character_bible', 'beat_sheet',
  'script', 'screenplay_draft', 'episode_grid', 'season_arc', 'series_overview',
  'episode_script', 'production_draft', 'pitch_deck', 'treatment',
];

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
  note: ProjectNote | null;
  context?: { docType?: string; documentId?: string; versionId?: string };
  onApplied?: (newVersionId: string) => void;
  onClose: () => void;
  open: boolean;
}

export function NoteDrawer({ projectId, noteId, note, context, onApplied, onClose, open }: NoteDrawerProps) {
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

  // Reset state when note changes
  useEffect(() => {
    setSelectedFixId(null);
    setCustomInstruction('');
    setChangePlan(null);
    setConfirmed(false);
    setVerifyComment('');
    setDetailOpen(false);
    setDeferDocType('');
  }, [noteId]);

  const fixes = (note?.suggested_fixes || []) as NoteSuggestedFix[];
  const isApplied = note?.status === 'applied';
  const isDismissed = note?.status === 'dismissed';

  // Triage actions
  const handleTriage = useCallback((status: NoteStatus, timing?: NoteTiming) => {
    if (!noteId) return;
    triageMutation.mutate({ noteId, triage: { status, timing, destinationDocType: timing === 'later' ? deferDocType : undefined } });
  }, [noteId, deferDocType, triageMutation]);

  const handleDefer = useCallback(() => {
    if (!noteId || !deferDocType) { toast.error('Select a destination doc type'); return; }
    triageMutation.mutate({ noteId, triage: { status: 'deferred', timing: 'later', destinationDocType: deferDocType } });
  }, [noteId, deferDocType, triageMutation]);

  // Propose change plan
  const handlePropose = useCallback(() => {
    if (!noteId) return;
    proposeMutation.mutate(
      { noteId, fixId: selectedFixId || undefined, customInstruction: customInstruction || undefined, scope, baseVersionId: context?.versionId },
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
  }, [noteId, selectedFixId, customInstruction, scope, context, proposeMutation]);

  // Apply
  const handleApply = useCallback(() => {
    if (!changePlan?.changeEventId) return;
    applyMutation.mutate(changePlan.changeEventId, {
      onSuccess: (data) => {
        onApplied?.(data.newVersionId);
        onClose();
      },
    });
  }, [changePlan, applyMutation, onApplied, onClose]);

  // Verify
  const handleVerify = useCallback((result: 'resolved' | 'reopen') => {
    if (!noteId) return;
    verifyMutation.mutate({ noteId, result, comment: verifyComment || undefined }, {
      onSuccess: () => onClose(),
    });
  }, [noteId, verifyComment, verifyMutation, onClose]);

  if (!note) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
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
                    {fixes.map((fix) => (
                      <button key={fix.id} onClick={() => setSelectedFixId(fix.id === selectedFixId ? null : fix.id)}
                        className={`w-full text-left rounded-lg border p-2.5 space-y-1 transition-colors ${
                          selectedFixId === fix.id ? 'border-primary bg-primary/5' : 'border-border/50 bg-background hover:border-border'
                        }`}>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selectedFixId === fix.id ? 'border-primary' : 'border-muted-foreground/30'
                          }`}>
                            {selectedFixId === fix.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                          </div>
                          <span className="text-xs font-medium text-foreground">{fix.title}</span>
                          {fix.risk_level && (
                            <Badge variant="outline" className={`text-[7px] px-1 py-0 ${
                              fix.risk_level === 'high' ? 'text-destructive border-destructive/30' :
                              fix.risk_level === 'med' ? 'text-amber-500 border-amber-500/30' :
                              'text-emerald-500 border-emerald-500/30'
                            }`}>{fix.risk_level} risk</Badge>
                          )}
                          {fix.patch_strategy && (
                            <Badge variant="outline" className="text-[7px] px-1 py-0 text-muted-foreground">{fix.patch_strategy.replace(/_/g, ' ')}</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground pl-[18px]">{fix.description}</p>
                        {fix.expected_effect && selectedFixId === fix.id && (
                          <p className="text-[10px] text-primary/80 pl-[18px] italic">Expected: {fix.expected_effect}</p>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">No suggested fixes yet. Use "Custom" or generate a change plan.</p>
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
                    disabled={proposeMutation.isPending || (!selectedFixId && !customInstruction)}
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

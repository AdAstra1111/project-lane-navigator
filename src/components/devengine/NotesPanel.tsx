/**
 * NotesPanel — Tiered notes with fingerprint metadata, tier pills, seen count,
 * witness collapsibles, waive/defer/lock actions, bundle clusters, and filter bar.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Zap, ChevronDown, Sparkles, Loader2, CheckCircle2, ArrowRight, Lightbulb,
  Pencil, Check, X, Wand2, Shield, Eye, Lock, AlertTriangle, Layers, Pin, Clock, Trash2, RotateCcw,
} from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NoteResolutionDrawer, type NoteForResolution } from './NoteResolutionDrawer';
import { NoteWritersRoomDrawer } from '@/components/notes/NoteWritersRoomDrawer';
import { noteFingerprint } from '@/lib/decisions/fingerprint';
import { toast } from 'sonner';

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

export interface NoteBundle {
  bundle_id: string;
  title: string;
  note_fingerprints: string[];
  note_count: number;
  anchor?: string;
  recommended_patch_plan: string;
}

// ── Constraint Solver types ──
export interface DecisionSetOption {
  option_id: string;
  title: string;
  plan_text: string;
  resolves: string[];
  waives: string[];
  defers: string[];
  impact: { canon?: string; runtime?: string; escalation?: string };
}

export interface DecisionSet {
  decision_id: string;
  goal: string;
  anchor?: string;
  note_fingerprints: string[];
  note_count: number;
  conflict_reasons?: string[];
  options: DecisionSetOption[];
  status: 'open' | 'chosen' | 'superseded';
}

type NoteFilter = 'all' | 'open' | 'hard' | 'recurring' | 'decisions';

interface NotesPanelProps {
  allNotes: any[];
  tieredNotes: { blockers: any[]; high: any[]; polish: any[] };
  selectedNotes: Set<number>;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<number>>>;
  onApplyRewrite: (decisions?: Record<string, string>, globalDirections?: GlobalDirection[]) => void;
  isRewriting: boolean;
  isLoading: boolean;
  resolutionSummary?: { resolved: number; regressed: number; suppressed?: number } | null;
  stabilityStatus?: string | null;
  globalDirections?: GlobalDirection[];
  hideApplyButton?: boolean;
  onDecisionsChange?: (decisions: Record<string, string>) => void;
  onCustomDirectionsChange?: (customDirections: Record<string, string>) => void;
  externalDecisions?: Array<{ note_id: string; options: NoteDecisionOption[]; recommended_option_id?: string; recommended?: string }>;
  deferredNotes?: any[];
  persistedDeferredNotes?: any[];
  dismissedDeferredNotes?: any[];
  onPinDeferred?: (noteId: string) => void;
  onUnpinDeferred?: (noteId: string) => void;
  onDismissDeferred?: (noteId: string) => void;
  onRepinDeferred?: (noteId: string) => void;
  carriedNotes?: any[];
  currentDocType?: string;
  currentVersionId?: string;
  onResolveCarriedNote?: (noteId: string, action: 'mark_resolved' | 'dismiss' | 'ai_patch' | 'apply_patch', extra?: any, noteSnapshot?: any) => Promise<any>;
  bundles?: NoteBundle[];
  decisionSets?: DecisionSet[];
  mutedByDecision?: string[];
  projectId?: string;
  documentId?: string;
  onClearOldNotes?: () => void;
  /** Called after a decision is successfully applied — parent should invalidate + refresh */
  onDecisionApplied?: () => void;
}

// ── Tier pill ──
function TierPill({ tier }: { tier?: string }) {
  if (!tier) return null;
  const isHard = tier === 'hard';
  return (
    <Badge variant="outline" className={`text-[7px] px-1 py-0 font-bold ${isHard ? 'border-red-500/50 text-red-400 bg-red-500/10' : 'border-muted-foreground/30 text-muted-foreground'}`}>
      {isHard ? <><Shield className="h-2 w-2 mr-0.5 inline" />HARD</> : 'SOFT'}
    </Badge>
  );
}

// ── Seen count badge ──
function SeenBadge({ timesSeen }: { timesSeen?: number }) {
  if (!timesSeen || timesSeen <= 1) return null;
  return (
    <Badge variant="outline" className="text-[7px] px-1 py-0 border-orange-500/40 text-orange-400 bg-orange-500/10">
      <Eye className="h-2 w-2 mr-0.5 inline" />Seen {timesSeen}×
    </Badge>
  );
}

// ── Witness collapsible ──
function WitnessSection({ witness }: { witness: any }) {
  const [open, setOpen] = useState(false);
  if (!witness) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[9px] text-amber-400 hover:text-amber-300 mt-0.5">
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        Recurrence evidence
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 p-1.5 rounded bg-amber-500/5 border border-amber-500/20 space-y-0.5">
        {witness.excerpt && <p className="text-[8px] text-foreground italic">"{witness.excerpt}"</p>}
        {witness.location && <p className="text-[8px] text-muted-foreground">Location: {witness.location}</p>}
        {witness.canon_ref && <p className="text-[8px] text-muted-foreground">Ref: {witness.canon_ref}</p>}
        {witness.explanation && <p className="text-[8px] text-muted-foreground">{witness.explanation}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Note status action bar ──
function NoteStateActions({ note, projectId, currentDocType, onStatusChange }: {
  note: any; projectId?: string; currentDocType?: string; onStatusChange?: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [deferTarget, setDeferTarget] = useState('');
  const fingerprint = note.note_fingerprint;
  if (!fingerprint || !projectId) return null;

  const DOC_TYPES = ['concept_brief', 'market_sheet', 'blueprint', 'character_bible', 'beat_sheet', 'script', 'episode_grid', 'season_arc'];

  async function callStatusUpdate(status: string, reason?: string, deferTo?: string) {
    setActing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;
      await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'note_status_update',
          projectId,
          note_fingerprint: fingerprint,
          doc_type: currentDocType || 'unknown',
          episode_number: note.episode_number ?? null,
          status,
          reason,
          defer_to_doc_type: deferTo,
        }),
      });
      toast.success(`Note ${status}`);
      onStatusChange?.();
    } catch {
      toast.error('Failed to update note status');
    } finally { setActing(false); }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1 pt-1 border-t border-border/20">
      <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-muted-foreground hover:text-amber-400" disabled={acting}
        onClick={() => callStatusUpdate('waived', 'User waived')}>
        {acting ? <Loader2 className="h-2 w-2 animate-spin" /> : <X className="h-2 w-2" />}Waive
      </Button>
      <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-muted-foreground hover:text-blue-400" disabled={acting}
        onClick={() => callStatusUpdate('locked', 'User locked')}>
        <Lock className="h-2 w-2" />Lock
      </Button>
      <div className="flex items-center gap-0.5">
        <Select value={deferTarget} onValueChange={setDeferTarget}>
          <SelectTrigger className="h-4 text-[8px] w-24 px-1 border-border/30">
            <SelectValue placeholder="Defer to…" />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPES.filter(d => d !== currentDocType).map(d => (
              <SelectItem key={d} value={d} className="text-[9px]">{d.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {deferTarget && (
          <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 text-blue-400" disabled={acting}
            onClick={() => { callStatusUpdate('deferred', undefined, deferTarget); setDeferTarget(''); }}>
            <ArrowRight className="h-2 w-2" />Go
          </Button>
        )}
      </div>
    </div>
  );
}

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

function NoteItem({ note, index, checked, onToggle, selectedOptionId, onSelectOption, customDirection, onCustomDirection, projectId, currentDocType, onStatusChange, onOpenResolution, onOpenWritersRoom, onFindOtherSolutions, isFindingSolutions }: {
  note: any; index: number; checked: boolean; onToggle: () => void;
  selectedOptionId?: string; onSelectOption?: (optionId: string) => void;
  customDirection?: string; onCustomDirection?: (text: string) => void;
  projectId?: string; currentDocType?: string; onStatusChange?: () => void;
  onOpenResolution?: (note: NoteForResolution) => void;
  onOpenWritersRoom?: (note: any) => void;
  onFindOtherSolutions?: (note: any) => void;
  isFindingSolutions?: boolean;
}) {
  const [stateActionsOpen, setStateActionsOpen] = useState(false);
  const severityColor = note.severity === 'blocker' ? 'border-destructive/40 bg-destructive/5' : note.severity === 'high' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/40';
  const severityBadge = note.severity === 'blocker' ? 'bg-destructive/20 text-destructive border-destructive/30' : note.severity === 'high' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-muted/40 text-muted-foreground border-border/50';
  const label = note.severity === 'blocker' ? '🔴 Blocker' : note.severity === 'high' ? '🟠 High' : '⚪ Polish';
  const hasDecisions = note.decisions && note.decisions.length > 0;
  const isRecurring = (note.times_seen || 1) >= 2;

  return (
    <div className={`rounded border transition-colors ${checked ? severityColor : 'border-border/40 opacity-50'}`}>
      <div className="flex items-start gap-2 p-2 cursor-pointer" onClick={onToggle}>
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5 h-3.5 w-3.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${severityBadge}`}>{label}</Badge>
            {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
            <TierPill tier={note.tier} />
            <SeenBadge timesSeen={note.times_seen} />
            {isRecurring && <AlertTriangle className="h-2.5 w-2.5 text-orange-400" />}
            {hasDecisions && <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/30 text-primary bg-primary/5">{note.decisions.length + 1} options</Badge>}
          </div>
          <p className="text-[10px] text-foreground leading-relaxed">{note.note || note.description}</p>
          {note.why_it_matters && <p className="text-[9px] text-muted-foreground mt-0.5 italic">{note.why_it_matters}</p>}
          <WitnessSection witness={note.witness_json} />
        </div>
      </div>
      {hasDecisions && checked && onSelectOption && (
        <div className="px-2 pb-2">
          <InlineDecisionCard decisions={note.decisions} recommended={note.recommended}
            selectedOptionId={selectedOptionId} onSelect={onSelectOption}
            customDirection={customDirection} onCustomDirection={onCustomDirection} />
        </div>
      )}
      {/* State actions — waive / defer / lock + Fix button */}
      {checked && (
        <div className="px-2 pb-1.5 flex items-center gap-1 flex-wrap">
          {onOpenResolution && (
            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-primary/30 text-primary hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onOpenResolution({
                  id: note.note_fingerprint || `note-${index}`,
                  source: 'regular',
                  summary: note.note || note.description || '',
                  detail: note.why_it_matters || note.detail || '',
                  category: note.category,
                  severity: note.severity,
                  target_doc_type: currentDocType,
                  note_data: note,
                });
              }}>
              <Wand2 className="h-2.5 w-2.5" />Fix
            </Button>
          )}
          {onOpenWritersRoom && (
            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-accent/30 text-accent-foreground hover:bg-accent/10"
              onClick={(e) => { e.stopPropagation(); onOpenWritersRoom(note); }}>
              <Sparkles className="h-2.5 w-2.5" />Discuss
            </Button>
          )}
          {onFindOtherSolutions && (
            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-muted-foreground/30 text-muted-foreground hover:bg-muted/20"
              disabled={isFindingSolutions}
              onClick={(e) => { e.stopPropagation(); onFindOtherSolutions(note); }}>
              {isFindingSolutions ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Lightbulb className="h-2.5 w-2.5" />}
              Find other solutions
            </Button>
          )}
          {note.note_fingerprint && (
            <>
              <button className="text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                onClick={(e) => { e.stopPropagation(); setStateActionsOpen(p => !p); }}>
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${stateActionsOpen ? '' : '-rotate-90'}`} />
                More actions
              </button>
              {stateActionsOpen && (
                <NoteStateActions note={note} projectId={projectId} currentDocType={currentDocType} onStatusChange={onStatusChange} />
              )}
            </>
          )}
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

function BundlesSection({ bundles, projectId, documentId, versionId, currentDocType, onBundleApplied, allNotes }: {
  bundles: NoteBundle[]; projectId?: string; documentId?: string; versionId?: string;
  currentDocType?: string; onBundleApplied?: () => void; allNotes?: any[];
}) {
  const [applying, setApplying] = useState<string | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());

  const toggleExpand = (bundleId: string) => {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundleId)) next.delete(bundleId); else next.add(bundleId);
      return next;
    });
  };

  async function applyBundle(bundle: NoteBundle) {
    if (!projectId || !documentId || !versionId) { toast.error('No document selected'); return; }
    setApplying(bundle.bundle_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'apply_bundle_fix',
          projectId, documentId, versionId,
          bundle_id: bundle.bundle_id,
          note_fingerprints: bundle.note_fingerprints,
          plan_text: bundle.recommended_patch_plan,
        }),
      });
      if (res.ok) { toast.success(`Bundle fix applied — new version created`); onBundleApplied?.(); }
      else toast.error('Bundle fix failed');
    } catch { toast.error('Bundle fix failed'); }
    finally { setApplying(null); }
  }

  // Build a lookup from fingerprint → note
  const notesByFingerprint = useMemo(() => {
    const map = new Map<string, any>();
    (allNotes || []).forEach(n => { if (n.note_fingerprint) map.set(n.note_fingerprint, n); });
    return map;
  }, [allNotes]);

  if (!bundles || bundles.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-orange-400">
        <Layers className="h-3 w-3" />Loop Clusters ({bundles.length})
      </div>
      {bundles.map(b => {
        const isExpanded = expandedBundles.has(b.bundle_id);
        const matchedNotes = b.note_fingerprints.map(fp => notesByFingerprint.get(fp)).filter(Boolean);
        return (
          <div key={b.bundle_id} className="rounded border border-orange-500/30 bg-orange-500/5 p-2 space-y-1">
            <p className="text-[10px] font-medium text-foreground">{b.title}</p>
            <p className="text-[9px] text-muted-foreground">{b.recommended_patch_plan.slice(0, 120)}…</p>
            <div className="flex items-center gap-1">
              <button onClick={() => toggleExpand(b.bundle_id)}
                className="flex items-center gap-0.5 text-[7px] px-1 py-0 text-orange-400 border border-orange-500/30 rounded hover:bg-orange-500/10 transition-colors">
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                {b.note_count} notes
              </button>
              <Button size="sm" variant="outline" className="h-5 text-[8px] px-1.5 gap-0.5 border-orange-500/30 text-orange-400 hover:bg-orange-500/10 ml-auto"
                disabled={applying === b.bundle_id} onClick={() => applyBundle(b)}>
                {applying === b.bundle_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
                Apply Bundle Fix
              </Button>
            </div>
            {isExpanded && (
              <div className="mt-1 space-y-1 border-t border-orange-500/20 pt-1">
                {matchedNotes.length > 0 ? matchedNotes.map((n: any, i: number) => (
                  <div key={n.note_fingerprint || i} className="rounded bg-orange-500/5 px-1.5 py-1 text-[9px] text-muted-foreground">
                    <span className="font-medium text-foreground">{n.note || n.description || n.title || 'Note'}</span>
                    {n.suggestion && <p className="text-[8px] mt-0.5 italic">{n.suggestion}</p>}
                  </div>
                )) : (
                  <p className="text-[8px] text-muted-foreground italic">
                    {b.note_fingerprints.length} note fingerprints in cluster
                    {b.note_fingerprints.slice(0, 3).map((fp, i) => (
                      <span key={i} className="block truncate text-[7px] font-mono opacity-60">{fp}</span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Decision Sets Section ──
function DecisionSetsSection({ decisionSets, projectId, documentId, versionId, onDecisionApplied }: {
  decisionSets: DecisionSet[]; projectId?: string; documentId?: string; versionId?: string;
  onDecisionApplied?: () => void;
}) {
  const [applying, setApplying] = useState<string | null>(null);
  const [chosenOptions, setChosenOptions] = useState<Record<string, string>>({});

  async function applyDecision(ds: DecisionSet, optionId: string) {
    if (!projectId || !documentId || !versionId) { toast.error('No document selected'); return; }
    setApplying(ds.decision_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'apply_decision',
          projectId, documentId, base_version_id: versionId,
          decision_id: ds.decision_id,
          option_id: optionId,
        }),
      });
      if (res.ok) { toast.success('Decision applied — new version created'); onDecisionApplied?.(); }
      else toast.error('Decision apply failed');
    } catch { toast.error('Decision apply failed'); }
    finally { setApplying(null); }
  }

  const openSets = (decisionSets || []).filter(ds => ds.status === 'open');
  if (openSets.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-violet-400">
        <Zap className="h-3 w-3" />Conflict Decisions ({openSets.length})
        <span className="text-[8px] text-muted-foreground font-normal ml-1">resolve before applying notes</span>
      </div>
      {openSets.map(ds => {
        const chosen = chosenOptions[ds.decision_id];
        return (
          <div key={ds.decision_id} className="rounded border border-violet-500/30 bg-violet-500/5 p-2 space-y-1.5">
            <p className="text-[10px] font-medium text-foreground">{ds.goal}</p>
            {ds.conflict_reasons && ds.conflict_reasons.length > 0 && (
              <p className="text-[8px] text-muted-foreground italic">{ds.conflict_reasons[0]}</p>
            )}
            <div className="space-y-1">
              {(ds.options || []).map(opt => (
                <button key={opt.option_id}
                  onClick={() => setChosenOptions(p => ({ ...p, [ds.decision_id]: opt.option_id }))}
                  className={`w-full text-left rounded px-2 py-1.5 border transition-all text-[9px] ${chosen === opt.option_id ? 'border-violet-500/60 bg-violet-500/10' : 'border-border/30 bg-muted/20 hover:border-border/60'}`}>
                  <span className="font-medium text-foreground">{opt.title}</span>
                  {opt.resolves?.length > 0 && <span className="text-emerald-400 ml-1">✓ resolves {opt.resolves.length}</span>}
                  {opt.waives?.length > 0 && <span className="text-muted-foreground ml-1">· waives {opt.waives.length}</span>}
                </button>
              ))}
            </div>
            {chosen && (
              <Button size="sm" className="h-5 text-[8px] px-2 gap-0.5 bg-violet-600 hover:bg-violet-700 w-full"
                disabled={applying === ds.decision_id}
                onClick={() => applyDecision(ds, chosen)}>
                {applying === ds.decision_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                Apply Decision
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pinned Deferred Notes as Decision Cards ──
function PinnedNoteDecisions({ pinnedNotes, projectId, documentId, versionId, onResolved, onDismiss }: {
  pinnedNotes: any[];
  projectId?: string;
  documentId?: string;
  versionId?: string;
  onResolved?: (noteId: string) => void;
  onDismiss?: (noteId: string) => void;
}) {
  const [loadingFixes, setLoadingFixes] = useState<string | null>(null);
  const [fixOptions, setFixOptions] = useState<Record<string, any[]>>({});
  const [chosenFix, setChosenFix] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState<string | null>(null);

  const fetchFixes = useCallback(async (note: any) => {
    const noteId = note.id;
    if (fixOptions[noteId]) return; // already fetched
    if (!projectId || !versionId) { toast.error('No document version selected'); return; }
    setLoadingFixes(noteId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const nj = note.note_json || {};
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-carried-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          note_id: noteId,
          project_id: projectId,
          action: 'ai_patch',
          current_version_id: versionId,
          note_snapshot: nj,
        }),
      });
      const result = await resp.json();
      if (result.fix_options && result.fix_options.length > 0) {
        setFixOptions(prev => ({ ...prev, [noteId]: result.fix_options }));
      } else if (result.proposed_edits) {
        // Wrap single proposed edit as a single option
        setFixOptions(prev => ({
          ...prev,
          [noteId]: [{ patch_name: result.recommended_option?.patch_name || 'Recommended fix', where: result.recommended_option?.rationale || '', what: result.summary || '', structural_impact: result.recommended_option?.estimated_impact || '', risk: '', _proposed_edits: result.proposed_edits }],
        }));
      } else {
        toast.info('No fix options generated for this note');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate fixes');
    } finally {
      setLoadingFixes(null);
    }
  }, [fixOptions, projectId, versionId]);

  const applyFix = useCallback(async (note: any, fixIndex: number) => {
    const noteId = note.id;
    const fixes = fixOptions[noteId];
    if (!fixes || !fixes[fixIndex]) return;
    const fix = fixes[fixIndex];
    if (!fix._proposed_edits || fix._proposed_edits.length === 0) {
      // Just mark resolved if no edits
      onResolved?.(noteId);
      return;
    }
    if (!projectId || !versionId) return;
    setApplying(noteId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-carried-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          note_id: noteId,
          project_id: projectId,
          action: 'apply_patch',
          current_version_id: versionId,
          patch_content: fix._proposed_edits,
          note_snapshot: note.note_json || {},
        }),
      });
      if (resp.ok) {
        toast.success('Fix applied — new version created');
        onResolved?.(noteId);
      } else {
        const err = await resp.json();
        toast.error(err.error || 'Apply failed');
      }
    } catch { toast.error('Apply failed'); }
    finally { setApplying(null); }
  }, [fixOptions, projectId, versionId, onResolved]);

  if (!pinnedNotes || pinnedNotes.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-primary">
        <Pin className="h-3 w-3" />Pinned Notes — Decisions ({pinnedNotes.length})
        <span className="text-[8px] text-muted-foreground font-normal ml-1">choose a resolution</span>
      </div>
      {pinnedNotes.map((note: any) => {
        const nj = note.note_json || {};
        const noteId = note.id;
        const desc = nj.description || nj.note || note.note_key || 'Note';
        const fixes = fixOptions[noteId] || [];
        const chosen = chosenFix[noteId];
        const isLoading = loadingFixes === noteId;
        const isApplying = applying === noteId;

        return (
          <div key={noteId} className="rounded border border-primary/30 bg-primary/5 p-2 space-y-1.5">
            <div className="flex items-center gap-1 flex-wrap">
              <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
                <Pin className="h-2 w-2 mr-0.5 inline" />Pinned
              </Badge>
              {note.source_doc_type && (
                <Badge variant="outline" className="text-[8px] px-1 py-0">From: {note.source_doc_type.replace(/_/g, ' ')}</Badge>
              )}
              {note.severity && (
                <Badge variant="outline" className={`text-[8px] px-1 py-0 ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}>
                  {note.severity}
                </Badge>
              )}
            </div>
            <p className="text-[10px] font-medium text-foreground">{desc}</p>
            {nj.why_it_matters && <p className="text-[9px] text-muted-foreground italic">{nj.why_it_matters}</p>}

            {/* Fix options (loaded on demand) */}
            {fixes.length === 0 && (
              <Button variant="outline" size="sm" className="h-5 text-[9px] px-2 gap-1 border-primary/30 text-primary"
                onClick={() => fetchFixes(note)} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
                Generate Solutions
              </Button>
            )}

            {fixes.length > 0 && (
              <div className="space-y-1">
                {fixes.map((fix: any, idx: number) => (
                  <button key={idx}
                    onClick={() => setChosenFix(p => ({ ...p, [noteId]: idx }))}
                    className={`w-full text-left rounded px-2 py-1.5 border transition-all text-[9px] ${chosen === idx ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-muted/20 hover:border-border/60'}`}>
                    <span className="font-medium text-foreground">{fix.patch_name}</span>
                    {fix.where && <span className="text-muted-foreground ml-1">· {fix.where}</span>}
                    {fix.what && <p className="text-[8px] text-muted-foreground mt-0.5">{fix.what}</p>}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1 flex-wrap">
              {chosen !== undefined && fixes[chosen] && (
                <Button size="sm" className="h-5 text-[8px] px-2 gap-0.5 w-full"
                  disabled={isApplying}
                  onClick={() => applyFix(note, chosen)}>
                  {isApplying ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                  Apply Fix
                </Button>
              )}
              {fixes.length === 0 && !isLoading && (
                <>
                  <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5 gap-0.5 border-emerald-500/30 text-emerald-500"
                    onClick={() => onResolved?.(noteId)}>
                    <Check className="h-2.5 w-2.5" />Mark Resolved
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 text-[8px] px-1.5 gap-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => onDismiss?.(noteId)}>
                    <X className="h-2.5 w-2.5" />Dismiss
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ──
export function NotesPanel({
  allNotes, tieredNotes, selectedNotes, setSelectedNotes,
  onApplyRewrite, isRewriting, isLoading,
  resolutionSummary, stabilityStatus, globalDirections,
  hideApplyButton, onDecisionsChange, onCustomDirectionsChange, externalDecisions,
  deferredNotes, persistedDeferredNotes, dismissedDeferredNotes, onPinDeferred, onUnpinDeferred, onDismissDeferred, onRepinDeferred,
  carriedNotes, currentDocType, currentVersionId, onResolveCarriedNote,
  bundles, decisionSets, mutedByDecision, projectId, documentId, onDecisionApplied,
  onClearOldNotes,
}: NotesPanelProps) {
  const [polishOpen, setPolishOpen] = useState(false);
  const [deferredOpen, setDeferredOpen] = useState(false);
  const [carriedOpen, setCarriedOpen] = useState(true);
  const [selectedDecisions, setSelectedDecisions] = useState<Record<string, string>>({});
  const [customDirections, setCustomDirections] = useState<Record<string, string>>({});
  const [resolutionNote, setResolutionNote] = useState<NoteForResolution | null>(null);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('all');
  const [statusVersion, setStatusVersion] = useState(0);
  const [writersRoomNote, setWritersRoomNote] = useState<any>(null);
  const [writersRoomOpen, setWritersRoomOpen] = useState(false);
  const [findingSolutionsNote, setFindingSolutionsNote] = useState<string | null>(null);

  const [resolvedNoteIds, setResolvedNoteIds] = useState<Set<string>>(new Set());
  const [resolvingNoteId, setResolvingNoteId] = useState<string | null>(null);
  const [patchDialog, setPatchDialog] = useState<{
    noteId: string; noteText: string;
    proposedEdits: Array<{ find: string; replace: string; rationale: string }>;
    summary: string;
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
    setSelectedDecisions(prev => { const next = { ...prev, [noteId]: prev[noteId] === optionId ? '' : optionId }; onDecisionsChange?.(next); return next; });
  }, [onDecisionsChange]);

  const handleCustomDirection = useCallback((noteId: string, text: string) => {
    setCustomDirections(prev => { const next = { ...prev, [noteId]: text }; onCustomDirectionsChange?.(next); return next; });
  }, [onCustomDirectionsChange]);

  const handleApplyRewrite = useCallback(() => {
    const activeDecisions: Record<string, string> = {};
    for (const [noteId, optionId] of Object.entries(selectedDecisions)) { if (optionId) activeDecisions[noteId] = optionId; }
    onApplyRewrite(Object.keys(activeDecisions).length > 0 ? activeDecisions : undefined, globalDirections);
  }, [selectedDecisions, onApplyRewrite, globalDirections]);

  const findCarriedNote = useCallback((noteId: string) => {
    return (carriedNotes || []).find((n: any) => (n.id || n.note_key) === noteId);
  }, [carriedNotes]);

  const handleMarkResolved = useCallback(async (noteId: string) => {
    if (!onResolveCarriedNote) return;
    setResolvingNoteId(noteId);
    try { await onResolveCarriedNote(noteId, 'mark_resolved', undefined, findCarriedNote(noteId)); setResolvedNoteIds(prev => new Set([...prev, noteId])); }
    finally { setResolvingNoteId(null); }
  }, [onResolveCarriedNote, findCarriedNote]);

  const handleDismiss = useCallback(async (noteId: string) => {
    if (!onResolveCarriedNote) return;
    setResolvingNoteId(noteId);
    try { await onResolveCarriedNote(noteId, 'dismiss', undefined, findCarriedNote(noteId)); setResolvedNoteIds(prev => new Set([...prev, noteId])); }
    finally { setResolvingNoteId(null); }
  }, [onResolveCarriedNote, findCarriedNote]);

  const handleAIPatch = useCallback(async (noteId: string, noteText: string) => {
    if (!onResolveCarriedNote) return;
    if (!currentVersionId) { alert('Please select a document version before applying an AI fix.'); return; }
    setResolvingNoteId(noteId);
    try {
      const result = await onResolveCarriedNote(noteId, 'ai_patch', undefined, findCarriedNote(noteId));
      if (result?.proposed_edits !== undefined || result?.fix_options !== undefined) {
        setPatchDialog({
          noteId, noteText,
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

  const handleOpenWritersRoom = useCallback((note: any) => {
    setWritersRoomNote(note);
    setWritersRoomOpen(true);
  }, []);

  const handleFindOtherSolutions = useCallback(async (note: any) => {
    const hash = noteFingerprint(note);
    setFindingSolutionsNote(hash);
    try {
      const { data, error } = await supabase.functions.invoke('notes-writers-room', {
        body: {
          action: 'generate_options',
          projectId, documentId,
          noteHash: hash,
          versionId: currentVersionId,
          noteSnapshot: { summary: note.note || note.description || '', category: note.category, severity: note.severity },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Generated ${data.options?.length || 0} new options — open Discuss to view`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate options');
    } finally {
      setFindingSolutionsNote(null);
    }
  }, [projectId, documentId, currentVersionId]);

  const visibleCarriedNotes = (carriedNotes || []).filter((n: any) => {
    const id = n.id || n.note_key;
    return !resolvedNoteIds.has(id) && n.status !== 'resolved' && n.status !== 'dismissed';
  });

  // Apply muting: hide notes whose fingerprint is in mutedByDecision (open decision exists)
  const mutedSet = useMemo(() => new Set(mutedByDecision || []), [mutedByDecision]);

  const applyMutingAndFilter = (notes: any[]) => {
    // First remove muted notes
    const unmuted = notes.filter(n => !n.note_fingerprint || !mutedSet.has(n.note_fingerprint));
    // Then apply filter
    if (noteFilter === 'all') return unmuted;
    if (noteFilter === 'open') return unmuted.filter(n => !n.state_status || n.state_status === 'open');
    if (noteFilter === 'hard') return unmuted.filter(n => n.tier === 'hard');
    if (noteFilter === 'recurring') return unmuted.filter(n => (n.times_seen || 1) >= 2);
    return unmuted;
  };

  const filteredBlockers = applyMutingAndFilter(tieredNotes.blockers);
  const filteredHigh = applyMutingAndFilter(tieredNotes.high);
  const filteredPolish = applyMutingAndFilter(tieredNotes.polish);

  if (allNotes.length === 0 && visibleCarriedNotes.length === 0) return null;

  const blockerCount = filteredBlockers.length;
  const highCount = filteredHigh.length;
  const decisionsCount = Object.values(selectedDecisions).filter(Boolean).length;
  const hasAnyBundles = bundles && bundles.length > 0;

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
            {onClearOldNotes && (
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px] text-muted-foreground hover:text-destructive gap-0.5" onClick={onClearOldNotes}>
                <Trash2 className="h-3 w-3" /> Clear Old
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2 space-y-2">
          {resolutionSummary && (resolutionSummary.resolved > 0 || resolutionSummary.regressed > 0 || (resolutionSummary.suppressed ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {resolutionSummary.resolved > 0 && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">{resolutionSummary.resolved} Resolved</Badge>}
              {resolutionSummary.regressed > 0 && <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px]">{resolutionSummary.regressed} Regressed</Badge>}
              {(resolutionSummary.suppressed ?? 0) > 0 && <Badge className="bg-muted/30 text-muted-foreground border-border/40 text-[9px]">{resolutionSummary.suppressed} Suppressed</Badge>}
            </div>
          )}
          {stabilityStatus === 'structurally_stable' && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              <span>✓ Structurally Stable — Refinement Phase</span>
            </div>
          )}

          {/* Decision Sets section — above bundles, mutes conflicting notes below */}
          {decisionSets && decisionSets.length > 0 && (
            <DecisionSetsSection
              decisionSets={decisionSets}
              projectId={projectId}
              documentId={documentId}
              versionId={currentVersionId}
              onDecisionApplied={() => {
                setStatusVersion(v => v + 1);
                onDecisionApplied?.();
              }}
            />
          )}

          {/* Pinned deferred notes as decision cards */}
          {persistedDeferredNotes && persistedDeferredNotes.filter((n: any) => n.pinned).length > 0 && (
            <PinnedNoteDecisions
              pinnedNotes={persistedDeferredNotes.filter((n: any) => n.pinned)}
              projectId={projectId}
              documentId={documentId}
              versionId={currentVersionId}
              onResolved={(noteId) => {
                onResolveCarriedNote?.(noteId, 'mark_resolved', undefined, persistedDeferredNotes.find((n: any) => n.id === noteId)?.note_json);
                setStatusVersion(v => v + 1);
              }}
              onDismiss={(noteId) => {
                onDismissDeferred?.(noteId);
                setStatusVersion(v => v + 1);
              }}
            />
          )}

          {/* Bundles section */}
          {hasAnyBundles && (
            <BundlesSection bundles={bundles!} projectId={projectId} documentId={documentId} versionId={currentVersionId}
              currentDocType={currentDocType} onBundleApplied={() => setStatusVersion(v => v + 1)} allNotes={allNotes} />
          )}

          <GlobalDirectionsBar directions={globalDirections || []} />

          {/* Filter bar */}
          {allNotes.length > 0 && (
            <div className="flex gap-1 items-center justify-between">
              <div className="flex gap-0.5">
                {(['all', 'open', 'hard', 'recurring'] as NoteFilter[]).map(f => (
                  <button key={f} onClick={() => setNoteFilter(f)}
                    className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${noteFilter === f ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                    {f === 'all' ? 'All' : f === 'open' ? 'Open' : f === 'hard' ? '🔒 Hard' : '🔁 Recurring'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5" onClick={() => setSelectedNotes(new Set(allNotes.map((_, i) => i)))}>All</Button>
                <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5" onClick={() => setSelectedNotes(new Set())}>None</Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {/* Blockers */}
            {filteredBlockers.length > 0 && (
              <div className="space-y-1">
                {filteredBlockers.map((note: any, i: number) => {
                  const noteId = note.id || note.note_key;
                  const ext = externalDecisionMap[noteId];
                  const enrichedNote = ext && !note.decisions?.length ? { ...note, severity: 'blocker', decisions: ext.options, recommended: ext.recommended } : { ...note, severity: 'blocker' };
                  return <NoteItem key={`b-${i}`} note={enrichedNote} index={i} checked={selectedNotes.has(i)} onToggle={() => toggle(i)}
                    selectedOptionId={selectedDecisions[noteId]} onSelectOption={(optionId) => handleSelectOption(noteId, optionId)}
                    customDirection={customDirections[noteId]} onCustomDirection={(text) => handleCustomDirection(noteId, text)}
                    projectId={projectId} currentDocType={currentDocType} onStatusChange={() => setStatusVersion(v => v + 1)}
                    onOpenResolution={(n) => { setResolutionNote(n); setResolutionOpen(true); }}
                    onOpenWritersRoom={handleOpenWritersRoom}
                    onFindOtherSolutions={handleFindOtherSolutions}
                    isFindingSolutions={findingSolutionsNote === noteFingerprint(enrichedNote)} />;
                })}
              </div>
            )}

            {/* High impact */}
            {filteredHigh.length > 0 && (
              <div className="space-y-1">
                {filteredHigh.map((note: any, i: number) => {
                  const idx = blockerCount + i;
                  const noteId = note.id || note.note_key;
                  const ext = externalDecisionMap[noteId];
                  const enrichedNote = ext && !note.decisions?.length ? { ...note, severity: 'high', decisions: ext.options, recommended: ext.recommended } : { ...note, severity: 'high' };
                  return <NoteItem key={`h-${i}`} note={enrichedNote} index={idx} checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)}
                    selectedOptionId={selectedDecisions[noteId]} onSelectOption={(optionId) => handleSelectOption(noteId, optionId)}
                    customDirection={customDirections[noteId]} onCustomDirection={(text) => handleCustomDirection(noteId, text)}
                    projectId={projectId} currentDocType={currentDocType} onStatusChange={() => setStatusVersion(v => v + 1)}
                    onOpenResolution={(n) => { setResolutionNote(n); setResolutionOpen(true); }}
                    onOpenWritersRoom={handleOpenWritersRoom}
                    onFindOtherSolutions={handleFindOtherSolutions}
                    isFindingSolutions={findingSolutionsNote === noteFingerprint(enrichedNote)} />;
                })}
              </div>
            )}

            {/* Polish */}
            {filteredPolish.length > 0 && (
              <Collapsible open={polishOpen} onOpenChange={setPolishOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${polishOpen ? 'rotate-0' : '-rotate-90'}`} />
                  {filteredPolish.length} Polish Notes
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {filteredPolish.map((note: any, i: number) => {
                    const idx = blockerCount + highCount + i;
                    return <NoteItem key={`p-${i}`} note={{ ...note, severity: 'polish' }} index={idx} checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)}
                      projectId={projectId} currentDocType={currentDocType} onStatusChange={() => setStatusVersion(v => v + 1)}
                      onOpenResolution={(n) => { setResolutionNote(n); setResolutionOpen(true); }} />;
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Carried-forward notes */}
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
                          <TierPill tier={note.tier} />
                          <SeenBadge timesSeen={note.times_seen} />
                          {note.severity && (
                            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}>
                              {note.severity}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-foreground leading-relaxed">{noteText}</p>
                        {note.why_it_matters && <p className="text-[9px] text-muted-foreground italic">{note.why_it_matters}</p>}
                        <WitnessSection witness={note.witness_json} />
                        {canResolve && (
                          <div className="flex items-center gap-1 pt-0.5 flex-wrap">
                            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-primary/30 text-primary hover:bg-primary/10"
                              onClick={() => {
                                setResolutionNote({
                                  id: noteId,
                                  source: 'carried',
                                  summary: noteText,
                                  detail: note.why_it_matters || note.detail || '',
                                  category: note.category,
                                  severity: note.severity,
                                  target_doc_type: note.target_deliverable_type || currentDocType,
                                  source_doc_type: note.source_doc_type,
                                  note_data: note,
                                });
                                setResolutionOpen(true);
                              }} disabled={isResolving}>
                              <Wand2 className="h-2.5 w-2.5" />Fix options
                            </Button>
                            <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleMarkResolved(noteId)} disabled={isResolving}>
                              {isResolving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}Resolve
                            </Button>
                            {currentVersionId && (
                              <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 border-sky-500/30 text-sky-400 hover:bg-sky-500/10" onClick={() => handleAIPatch(noteId, noteText)} disabled={isResolving}>
                                {isResolving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}Quick patch
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

            {/* Deferred notes — from current run */}
            {deferredNotes && deferredNotes.length > 0 && (
              <Collapsible open={deferredOpen} onOpenChange={setDeferredOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${deferredOpen ? 'rotate-0' : '-rotate-90'}`} />
                  <Clock className="h-3 w-3" />
                  {deferredNotes.length} Deferred
                  <span className="text-[8px] text-muted-foreground ml-1">(for later docs)</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {deferredNotes.map((note: any, i: number) => (
                    <div key={`def-${i}`} className="rounded border border-border/30 bg-muted/10 p-2 opacity-70">
                      <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[8px] px-1 py-0">→ {(note.target_deliverable_type || 'later').replace(/_/g, ' ')}</Badge>
                        <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">{note.apply_timing === 'next_doc' ? 'Next Doc' : 'Later'}</Badge>
                        {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
                        {note.severity && <Badge variant="outline" className={`text-[8px] px-1 py-0 ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}>{note.severity}</Badge>}
                      </div>
                      <p className="text-[10px] text-foreground">{note.description || note.note}</p>
                      {note.defer_reason && <p className="text-[9px] text-muted-foreground mt-0.5 italic">↳ {note.defer_reason}</p>}
                      <p className="text-[8px] text-muted-foreground/70 mt-0.5">
                        <Clock className="h-2 w-2 inline mr-0.5" />
                        Will reappear when working on {(note.target_deliverable_type || 'later stage').replace(/_/g, ' ')}
                      </p>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Persisted deferred notes — from DB with pin/dismiss actions */}
            {persistedDeferredNotes && persistedDeferredNotes.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className="h-3 w-3" />
                  <Pin className="h-3 w-3" />
                  {persistedDeferredNotes.length} Saved Deferred Notes
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {persistedDeferredNotes.map((note: any) => {
                    const nj = note.note_json || {};
                    return (
                      <div key={note.id} className={`rounded border p-2 ${note.pinned ? 'border-primary/30 bg-primary/5' : 'border-border/30 bg-muted/10 opacity-70'}`}>
                        <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                          <Badge variant="outline" className="text-[8px] px-1 py-0">→ {(note.target_deliverable_type || 'later').replace(/_/g, ' ')}</Badge>
                          {note.pinned && <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary bg-primary/10"><Pin className="h-2 w-2 mr-0.5 inline" />Pinned</Badge>}
                          {note.severity && <Badge variant="outline" className={`text-[8px] px-1 py-0 ${note.severity === 'blocker' ? 'text-destructive border-destructive/30' : note.severity === 'high' ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}>{note.severity}</Badge>}
                          {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
                        </div>
                        <p className="text-[10px] text-foreground">{nj.description || nj.note || note.note_key}</p>
                        {nj.why_it_matters && <p className="text-[9px] text-muted-foreground mt-0.5 italic">{nj.why_it_matters}</p>}
                        <p className="text-[8px] text-muted-foreground/70 mt-0.5">
                          <Clock className="h-2 w-2 inline mr-0.5" />
                          Will reappear when working on {(note.target_deliverable_type || 'later stage').replace(/_/g, ' ')}
                        </p>
                        <div className="flex items-center gap-1 mt-1 pt-1 border-t border-border/20">
                          {!note.pinned && onPinDeferred && (
                            <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-primary hover:text-primary/80" onClick={() => onPinDeferred(note.id)}>
                              <Pin className="h-2 w-2" />Pin / Show now
                            </Button>
                          )}
                          {note.pinned && onUnpinDeferred && (
                            <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-muted-foreground" onClick={() => onUnpinDeferred(note.id)}>
                              <X className="h-2 w-2" />Unpin
                            </Button>
                          )}
                          {onDismissDeferred && (
                            <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-muted-foreground hover:text-destructive" onClick={() => onDismissDeferred(note.id)}>
                              <X className="h-2 w-2" />Dismiss
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Dismissed / Resolved notes — re-pin option */}
            {dismissedDeferredNotes && dismissedDeferredNotes.length > 0 && onRepinDeferred && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className="h-3 w-3" />
                  <RotateCcw className="h-3 w-3" />
                  {dismissedDeferredNotes.length} Dismissed Notes
                  <span className="text-[8px] text-muted-foreground ml-1">(re-pin if needed)</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {dismissedDeferredNotes.map((note: any) => {
                    const nj = note.note_json || {};
                    return (
                      <div key={note.id} className="rounded border border-border/20 bg-muted/5 p-2 opacity-60 hover:opacity-80 transition-opacity">
                        <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                          <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">{note.status === 'resolved' ? 'Resolved' : 'Dismissed'}</Badge>
                          {note.source_doc_type && <Badge variant="outline" className="text-[8px] px-1 py-0">From: {note.source_doc_type.replace(/_/g, ' ')}</Badge>}
                          {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
                        </div>
                        <p className="text-[10px] text-foreground">{nj.description || nj.note || note.note_key || 'Note'}</p>
                        {note.resolution_summary && <p className="text-[9px] text-muted-foreground mt-0.5 italic">↳ {note.resolution_summary}</p>}
                        <div className="flex items-center gap-1 mt-1 pt-1 border-t border-border/20">
                          <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1 gap-0.5 text-primary hover:text-primary/80" onClick={() => onRepinDeferred(note.id)}>
                            <Pin className="h-2 w-2" />Re-pin
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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

      {/* AI Fix Dialog */}
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
                <div className="p-2 rounded border border-primary/20 bg-primary/5">
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Note:</p>
                  <p className="text-[10px] text-foreground">{patchDialog.noteText}</p>
                </div>
                {patchDialog.diagnosis && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§1 Diagnosis</p>
                    <p className="text-[10px] text-foreground">{patchDialog.diagnosis}</p>
                    {patchDialog.affectedScenes?.map((s, i) => <p key={i} className="text-[9px] text-muted-foreground pl-2 border-l border-primary/30">• {s}</p>)}
                  </div>
                )}
                {patchDialog.rootCause && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§2 Root Cause</p>
                    <p className="text-[10px] text-foreground">{patchDialog.rootCause}</p>
                  </div>
                )}
                {patchDialog.fixOptions && patchDialog.fixOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">§3 Fix Options ({patchDialog.fixOptions.length})</p>
                    {patchDialog.fixOptions.map((opt, i) => (
                      <div key={i} className={`rounded border p-2 space-y-1 ${patchDialog.recommendedOption?.patch_name === opt.patch_name ? 'border-sky-500/40 bg-sky-500/5' : 'border-border/40 bg-muted/10'}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-foreground">{opt.patch_name}</span>
                          {patchDialog.recommendedOption?.patch_name === opt.patch_name && <Badge variant="outline" className="text-[7px] px-1 py-0 border-sky-500/40 text-sky-400">Recommended</Badge>}
                        </div>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">Where:</span> {opt.where}</p>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">What:</span> {opt.what}</p>
                        <p className="text-[9px] text-muted-foreground"><span className="text-foreground/70 font-medium">Impact:</span> {opt.structural_impact}</p>
                        <p className="text-[9px] text-muted-foreground italic"><span className="text-foreground/70 font-medium">Risk:</span> {opt.risk}</p>
                      </div>
                    ))}
                  </div>
                )}
                {patchDialog.recommendedOption && (
                  <div className="space-y-1 p-2 rounded border border-emerald-500/30 bg-emerald-500/5">
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">§4 Recommended Fix</p>
                    <p className="text-[10px] font-medium text-foreground">{patchDialog.recommendedOption.patch_name}</p>
                    <p className="text-[10px] text-muted-foreground">{patchDialog.recommendedOption.rationale}</p>
                    {patchDialog.recommendedOption.estimated_impact && <p className="text-[9px] text-emerald-400 font-medium">Est. impact: {patchDialog.recommendedOption.estimated_impact}</p>}
                  </div>
                )}
                {patchDialog.proposedEdits.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Proposed Edits ({patchDialog.proposedEdits.length})</p>
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
                ) : (
                  <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5 text-[10px] text-emerald-400">
                    ✓ Note appears already addressed. No edits needed.
                  </div>
                )}
                {patchDialog.summary && <p className="text-[9px] text-muted-foreground italic">{patchDialog.summary}</p>}
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

      {/* Unified Note Resolution Drawer */}
      <NoteResolutionDrawer
        open={resolutionOpen}
        onOpenChange={setResolutionOpen}
        note={resolutionNote}
        projectId={projectId || ''}
        currentVersionId={currentVersionId}
        onApplied={(result) => {
          toast.success(`Fix applied → v${result.new_version_number}${result.approved ? ' (approved)' : ''}`);
          if (resolutionNote?.id) setResolvedNoteIds(prev => new Set([...prev, resolutionNote.id!]));
          onDecisionApplied?.();
        }}
        onResolved={(noteId) => {
          handleMarkResolved(noteId);
        }}
        onDeferred={onDismissDeferred ? (noteId) => {
          onDismissDeferred(noteId);
        } : undefined}
        onOpenWritersRoom={(note) => {
          setWritersRoomNote(note.note_data || note);
          setWritersRoomOpen(true);
        }}
      />

      {/* Writers' Room Drawer */}
      {writersRoomNote && projectId && documentId && (
        <NoteWritersRoomDrawer
          open={writersRoomOpen}
          onOpenChange={setWritersRoomOpen}
          projectId={projectId}
          documentId={documentId}
          versionId={currentVersionId}
          note={writersRoomNote}
        />
      )}
    </>
  );
}

/**
 * NotesPanel — Tiered notes with inline decision cards + global directions.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Zap, ChevronDown, Sparkles, Loader2, CheckCircle2, ArrowRight, Lightbulb } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

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
  /** Expose selected decisions to parent */
  onDecisionsChange?: (decisions: Record<string, string>) => void;
  /** External decisions (from OPTIONS run) to merge onto notes by note_id */
  externalDecisions?: Array<{ note_id: string; options: NoteDecisionOption[]; recommended_option_id?: string; recommended?: string }>;
}

function DecisionCard({
  decisions,
  recommended,
  selectedOptionId,
  onSelect,
}: {
  decisions: NoteDecisionOption[];
  recommended?: string;
  selectedOptionId?: string;
  onSelect: (optionId: string) => void;
}) {
  if (!decisions || decisions.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {decisions.map((opt) => {
        const isSelected = selectedOptionId === opt.option_id;
        const isRecommended = recommended === opt.option_id;
        return (
          <button
            key={opt.option_id}
            onClick={(e) => { e.stopPropagation(); onSelect(opt.option_id); }}
            className={`w-full text-left rounded px-2 py-1.5 border transition-all ${
              isSelected
                ? 'border-primary/60 bg-primary/10'
                : 'border-border/30 bg-muted/20 hover:border-border/60'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
              }`}>
                {isSelected && <CheckCircle2 className="h-2 w-2 text-primary-foreground" />}
              </div>
              <span className="text-[10px] font-medium text-foreground">{opt.title}</span>
              {isRecommended && (
                <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
                  Recommended
                </Badge>
              )}
              {opt.commercial_lift > 0 && (
                <Badge variant="outline" className="text-[7px] px-1 py-0 border-emerald-500/30 text-emerald-500">
                  +{opt.commercial_lift} GP
                </Badge>
              )}
            </div>
            <div className="pl-[18px] space-y-0.5">
              <div className="flex flex-wrap gap-0.5">
                {opt.what_changes.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 text-muted-foreground border-border/40">
                    {c}
                  </Badge>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground italic">{opt.creative_tradeoff}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NoteItem({
  note,
  index,
  checked,
  onToggle,
  selectedOptionId,
  onSelectOption,
}: {
  note: any;
  index: number;
  checked: boolean;
  onToggle: () => void;
  selectedOptionId?: string;
  onSelectOption?: (optionId: string) => void;
}) {
  const severityColor = note.severity === 'blocker'
    ? 'border-destructive/40 bg-destructive/5'
    : note.severity === 'high'
    ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-border/40';
  const severityBadge = note.severity === 'blocker'
    ? 'bg-destructive/20 text-destructive border-destructive/30'
    : note.severity === 'high'
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-muted/40 text-muted-foreground border-border/50';
  const label = note.severity === 'blocker' ? '🔴 Blocker' : note.severity === 'high' ? '🟠 High' : '⚪ Polish';
  const hasDecisions = note.decisions && note.decisions.length > 0;

  return (
    <div className={`rounded border transition-colors ${checked ? severityColor : 'border-border/40 opacity-50'}`}>
      <div
        className="flex items-start gap-2 p-2 cursor-pointer"
        onClick={onToggle}
      >
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5 h-3.5 w-3.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${severityBadge}`}>{label}</Badge>
            {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
            {hasDecisions && (
              <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/30 text-primary bg-primary/5">
                {note.decisions.length} options
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-foreground leading-relaxed">{note.note || note.description}</p>
          {note.why_it_matters && (
            <p className="text-[9px] text-muted-foreground mt-0.5 italic">{note.why_it_matters}</p>
          )}
        </div>
      </div>
      {/* Inline decision cards */}
      {hasDecisions && checked && onSelectOption && (
        <div className="px-2 pb-2">
          <DecisionCard
            decisions={note.decisions}
            recommended={note.recommended}
            selectedOptionId={selectedOptionId}
            onSelect={onSelectOption}
          />
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
        <Lightbulb className="h-3 w-3" />
        Global Directions
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

export function NotesPanel({
  allNotes, tieredNotes, selectedNotes, setSelectedNotes,
  onApplyRewrite, isRewriting, isLoading,
  resolutionSummary, stabilityStatus, globalDirections,
  hideApplyButton, onDecisionsChange, externalDecisions,
}: NotesPanelProps) {
  const [polishOpen, setPolishOpen] = useState(false);
  // Track selected decision option per note (keyed by note id)
  const [selectedDecisions, setSelectedDecisions] = useState<Record<string, string>>({});

  // Build a lookup map from external decisions (OPTIONS run) keyed by note_id
  const externalDecisionMap = useMemo(() => {
    const map: Record<string, { options: NoteDecisionOption[]; recommended?: string }> = {};
    if (externalDecisions) {
      for (const d of externalDecisions) {
        map[d.note_id] = {
          options: d.options,
          recommended: d.recommended_option_id || d.recommended,
        };
      }
    }
    return map;
  }, [externalDecisions]);

  const toggle = (i: number) => {
    setSelectedNotes(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const handleSelectOption = useCallback((noteId: string, optionId: string) => {
    setSelectedDecisions(prev => {
      const next = {
        ...prev,
        [noteId]: prev[noteId] === optionId ? '' : optionId,
      };
      onDecisionsChange?.(next);
      return next;
    });
  }, [onDecisionsChange]);

  const handleApplyRewrite = useCallback(() => {
    // Filter to only selected decisions that have a value
    const activeDecisions: Record<string, string> = {};
    for (const [noteId, optionId] of Object.entries(selectedDecisions)) {
      if (optionId) activeDecisions[noteId] = optionId;
    }
    onApplyRewrite(
      Object.keys(activeDecisions).length > 0 ? activeDecisions : undefined,
      globalDirections,
    );
  }, [selectedDecisions, onApplyRewrite, globalDirections]);

  if (allNotes.length === 0) return null;

  const blockerCount = tieredNotes.blockers.length;
  const highCount = tieredNotes.high.length;
  const decisionsCount = Object.values(selectedDecisions).filter(Boolean).length;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-primary" />
            Notes
          </CardTitle>
          <div className="flex gap-1 items-center">
            {tieredNotes.blockers.length > 0 && (
              <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px] px-1.5 py-0">
                {tieredNotes.blockers.length} Blockers
              </Badge>
            )}
            {tieredNotes.high.length > 0 && (
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] px-1.5 py-0">
                {tieredNotes.high.length} High
              </Badge>
            )}
            {tieredNotes.polish.length > 0 && (
              <Badge className="bg-muted/40 text-muted-foreground border-border/50 text-[9px] px-1.5 py-0">
                {tieredNotes.polish.length} Polish
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-2 space-y-2">
        {/* Resolution summary badges */}
        {resolutionSummary && (resolutionSummary.resolved > 0 || resolutionSummary.regressed > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {resolutionSummary.resolved > 0 && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">
                {resolutionSummary.resolved} Resolved
              </Badge>
            )}
            {resolutionSummary.regressed > 0 && (
              <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[9px]">
                {resolutionSummary.regressed} Regressed
              </Badge>
            )}
          </div>
        )}

        {/* Stability banner */}
        {stabilityStatus === 'structurally_stable' && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
            <span>✓ Structurally Stable — Refinement Phase</span>
          </div>
        )}

        {/* Global Directions */}
        <GlobalDirectionsBar directions={globalDirections || []} />

        {/* Select All / None */}
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5"
            onClick={() => setSelectedNotes(new Set(allNotes.map((_, i) => i)))}>All</Button>
          <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5"
            onClick={() => setSelectedNotes(new Set())}>None</Button>
        </div>

        {/* Blockers — always expanded */}
        {tieredNotes.blockers.length > 0 && (
          <div className="space-y-1">
            {tieredNotes.blockers.map((note: any, i: number) => {
              const noteId = note.id || note.note_key;
              const ext = externalDecisionMap[noteId];
              const enrichedNote = ext && !note.decisions?.length
                ? { ...note, severity: 'blocker', decisions: ext.options, recommended: ext.recommended }
                : { ...note, severity: 'blocker' };
              return (
                <NoteItem
                  key={`b-${i}`}
                  note={enrichedNote}
                  index={i}
                  checked={selectedNotes.has(i)}
                  onToggle={() => toggle(i)}
                  selectedOptionId={selectedDecisions[noteId]}
                  onSelectOption={(optionId) => handleSelectOption(noteId, optionId)}
                />
              );
            })}
          </div>
        )}

        {/* High impact — always expanded */}
        {tieredNotes.high.length > 0 && (
          <div className="space-y-1">
            {tieredNotes.high.map((note: any, i: number) => {
              const idx = blockerCount + i;
              const noteId = note.id || note.note_key;
              const ext = externalDecisionMap[noteId];
              const enrichedNote = ext && !note.decisions?.length
                ? { ...note, severity: 'high', decisions: ext.options, recommended: ext.recommended }
                : { ...note, severity: 'high' };
              return (
                <NoteItem
                  key={`h-${i}`}
                  note={enrichedNote}
                  index={idx}
                  checked={selectedNotes.has(idx)}
                  onToggle={() => toggle(idx)}
                  selectedOptionId={selectedDecisions[noteId]}
                  onSelectOption={(optionId) => handleSelectOption(noteId, optionId)}
                />
              );
            })}
          </div>
        )}

        {/* Polish — collapsed by default */}
        {tieredNotes.polish.length > 0 && (
          <Collapsible open={polishOpen} onOpenChange={setPolishOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
              <ChevronDown className={`h-3 w-3 transition-transform ${polishOpen ? 'rotate-0' : '-rotate-90'}`} />
              {tieredNotes.polish.length} Polish Notes
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-1">
              {tieredNotes.polish.map((note: any, i: number) => {
                const idx = blockerCount + highCount + i;
                return (
                  <NoteItem
                    key={`p-${i}`}
                    note={{ ...note, severity: 'polish' }}
                    index={idx}
                    checked={selectedNotes.has(idx)}
                    onToggle={() => toggle(idx)}
                  />
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Apply Rewrite button — hidden when parent provides unified button */}
        {!hideApplyButton && (
          <Button size="sm" className="h-7 text-xs gap-1.5 w-full"
            onClick={handleApplyRewrite}
            disabled={isLoading || isRewriting || selectedNotes.size === 0}>
            {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Apply Rewrite ({selectedNotes.size} notes{decisionsCount > 0 ? `, ${decisionsCount} decisions` : ''})
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

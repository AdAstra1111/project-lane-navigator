/**
 * NotesPanel — Single source of truth for tiered note display + approval.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Zap, ChevronDown, Sparkles, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface NotesPanelProps {
  allNotes: any[];
  tieredNotes: { blockers: any[]; high: any[]; polish: any[] };
  selectedNotes: Set<number>;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<number>>>;
  onApplyRewrite: () => void;
  isRewriting: boolean;
  isLoading: boolean;
  resolutionSummary?: { resolved: number; regressed: number } | null;
  stabilityStatus?: string | null;
}

function NoteItem({ note, index, checked, onToggle }: { note: any; index: number; checked: boolean; onToggle: () => void }) {
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

  return (
    <div
      className={`flex items-start gap-2 p-2 rounded border transition-colors cursor-pointer ${
        checked ? severityColor : 'border-border/40 opacity-50'
      }`}
      onClick={onToggle}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5 h-3.5 w-3.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <Badge variant="outline" className={`text-[8px] px-1 py-0 ${severityBadge}`}>{label}</Badge>
          {note.category && <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>}
        </div>
        <p className="text-[10px] text-foreground leading-relaxed">{note.note || note.description}</p>
        {note.why_it_matters && (
          <p className="text-[9px] text-muted-foreground mt-0.5 italic">{note.why_it_matters}</p>
        )}
      </div>
    </div>
  );
}

export function NotesPanel({
  allNotes, tieredNotes, selectedNotes, setSelectedNotes,
  onApplyRewrite, isRewriting, isLoading,
  resolutionSummary, stabilityStatus,
}: NotesPanelProps) {
  const [polishOpen, setPolishOpen] = useState(false);

  const toggle = (i: number) => {
    setSelectedNotes(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  if (allNotes.length === 0) return null;

  // Compute index offsets for the flattened array
  const blockerCount = tieredNotes.blockers.length;
  const highCount = tieredNotes.high.length;

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
            {tieredNotes.blockers.map((note: any, i: number) => (
              <NoteItem key={`b-${i}`} note={{ ...note, severity: 'blocker' }} index={i}
                checked={selectedNotes.has(i)} onToggle={() => toggle(i)} />
            ))}
          </div>
        )}

        {/* High impact — always expanded */}
        {tieredNotes.high.length > 0 && (
          <div className="space-y-1">
            {tieredNotes.high.map((note: any, i: number) => {
              const idx = blockerCount + i;
              return <NoteItem key={`h-${i}`} note={{ ...note, severity: 'high' }} index={idx}
                checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)} />;
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
                return <NoteItem key={`p-${i}`} note={{ ...note, severity: 'polish' }} index={idx}
                  checked={selectedNotes.has(idx)} onToggle={() => toggle(idx)} />;
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Apply Rewrite button */}
        <Button size="sm" className="h-7 text-xs gap-1.5 w-full"
          onClick={onApplyRewrite}
          disabled={isLoading || isRewriting || selectedNotes.size === 0}>
          {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Apply Rewrite ({selectedNotes.size} notes)
        </Button>
      </CardContent>
    </Card>
  );
}

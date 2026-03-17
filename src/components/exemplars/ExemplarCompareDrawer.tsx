import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentIdea: PitchIdea | null;
  exemplar: PitchIdea | null;
}

function CompareRow({ label, left, right }: { label: string; left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-3 py-2 border-b border-border/20 items-start">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-sm text-foreground">{left || '—'}</span>
      <span className="text-sm text-foreground">{right || '—'}</span>
    </div>
  );
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-primary' : 'bg-amber-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium w-8 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

export function ExemplarCompareDrawer({ open, onOpenChange, currentIdea, exemplar }: Props) {
  if (!currentIdea || !exemplar) return null;

  const leftLane = LANE_LABELS[currentIdea.recommended_lane as MonetisationLane] || currentIdea.recommended_lane;
  const rightLane = LANE_LABELS[exemplar.recommended_lane as MonetisationLane] || exemplar.recommended_lane;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-lg">Compare Ideas</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-1 pb-8">
            {/* Column headers */}
            <div className="grid grid-cols-[120px_1fr_1fr] gap-3 py-3 border-b border-border/40 sticky top-0 bg-background z-10">
              <span className="text-xs text-muted-foreground">Field</span>
              <div>
                <p className="text-sm font-semibold truncate">{currentIdea.title}</p>
                <Badge variant="outline" className="text-[10px] mt-0.5">Your Idea</Badge>
              </div>
              <div>
                <p className="text-sm font-semibold truncate">{exemplar.title}</p>
                <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] mt-0.5">Exemplar</Badge>
              </div>
            </div>

            {/* Score comparison */}
            <CompareRow
              label="CI Score"
              left={<ScoreBar value={Number(currentIdea.score_total) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_total) || 0} />}
            />
            <CompareRow
              label="Market Heat"
              left={<ScoreBar value={Number(currentIdea.score_market_heat) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_market_heat) || 0} />}
            />
            <CompareRow
              label="Feasibility"
              left={<ScoreBar value={Number(currentIdea.score_feasibility) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_feasibility) || 0} />}
            />
            <CompareRow
              label="Lane Fit"
              left={<ScoreBar value={Number(currentIdea.score_lane_fit) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_lane_fit) || 0} />}
            />
            <CompareRow
              label="Saturation"
              left={<ScoreBar value={Number(currentIdea.score_saturation_risk) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_saturation_risk) || 0} />}
            />
            <CompareRow
              label="Company Fit"
              left={<ScoreBar value={Number(currentIdea.score_company_fit) || 0} />}
              right={<ScoreBar value={Number(exemplar.score_company_fit) || 0} />}
            />

            {/* Metadata comparison */}
            <CompareRow label="Format" left={currentIdea.production_type} right={exemplar.production_type} />
            <CompareRow label="Genre" left={currentIdea.genre} right={exemplar.genre} />
            <CompareRow label="Lane" left={leftLane} right={rightLane} />
            <CompareRow label="Budget" left={currentIdea.budget_band} right={exemplar.budget_band} />
            <CompareRow label="Platform" left={currentIdea.platform_target} right={exemplar.platform_target} />
            <CompareRow label="Region" left={currentIdea.region} right={exemplar.region} />
            <CompareRow label="Risk" left={currentIdea.risk_level} right={exemplar.risk_level} />
            <CompareRow
              label="Engine"
              left={currentIdea.source_engine_key || '—'}
              right={exemplar.source_engine_key || '—'}
            />
            <CompareRow
              label="Confidence"
              left={`${currentIdea.lane_confidence}%`}
              right={`${exemplar.lane_confidence}%`}
            />

            {/* Logline comparison */}
            <CompareRow
              label="Logline"
              left={<p className="text-xs leading-relaxed">{currentIdea.logline}</p>}
              right={<p className="text-xs leading-relaxed">{exemplar.logline}</p>}
            />

            {/* Comps */}
            <CompareRow
              label="Comps"
              left={<div className="flex flex-wrap gap-1">{currentIdea.comps?.map(c => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}</div>}
              right={<div className="flex flex-wrap gap-1">{exemplar.comps?.map(c => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}</div>}
            />

            {/* Why Us */}
            <CompareRow
              label="Why Strong"
              left={<p className="text-xs italic">{currentIdea.why_us || '—'}</p>}
              right={<p className="text-xs italic">{exemplar.why_us || '—'}</p>}
            />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

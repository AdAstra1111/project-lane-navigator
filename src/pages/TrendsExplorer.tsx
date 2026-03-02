import { useState, useMemo } from 'react';
import { TrendingUp, Users, Filter, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useActiveSignals, useActiveCastTrends, useSignalCount, useCastTrendsCount, PRODUCTION_TYPE_TREND_CATEGORIES, type TrendSignal } from '@/hooks/useTrends';
import { PRODUCTION_MODALITIES, MODALITY_LABELS, type ProductionModality } from '@/config/productionModality';
import { Link } from 'react-router-dom';
import { TrendsPageShell } from '@/components/trends/TrendsPageShell';
import { TrendsFilterBar } from '@/components/trends/TrendsFilterBar';
import { TrendSignalModal } from '@/components/trends/TrendSignalModal';

const PRODUCTION_TYPES = Object.entries(PRODUCTION_TYPE_TREND_CATEGORIES).map(([value, config]) => ({
  value,
  label: config.label,
}));

const LANES = [
  { value: '__any__', label: 'Any Lane' },
  { value: 'studio-streamer', label: 'Studio / Streamer' },
  { value: 'independent-film', label: 'Independent Film' },
  { value: 'low-budget', label: 'Low Budget' },
  { value: 'international-copro', label: "Int'l Co-Pro" },
  { value: 'genre-market', label: 'Genre / Market' },
  { value: 'prestige-awards', label: 'Prestige / Awards' },
  { value: 'fast-turnaround', label: 'Fast Turnaround' },
];

function modalityToFilter(modality: string, typeLabel: string): string {
  if (modality === 'animation') return 'animation';
  return typeLabel;
}

export default function TrendsExplorer() {
  const [selectedType, setSelectedType] = useState('film');
  const [modality, setModality] = useState<ProductionModality>('live_action');
  const [lane, setLane] = useState('__any__');
  const [selectedSignal, setSelectedSignal] = useState<TrendSignal | null>(null);

  const effectiveFilter = modalityToFilter(modality, selectedType);
  const activeLane = lane !== '__any__' ? lane : '';

  const { data: allSignals = [], isLoading: signalsLoading } = useActiveSignals({ productionType: effectiveFilter });
  const { data: castTrends = [], isLoading: castLoading } = useActiveCastTrends({ productionType: effectiveFilter });
  const { data: signalDbCount = 0 } = useSignalCount(effectiveFilter);
  const { data: castDbCount = 0 } = useCastTrendsCount(effectiveFilter);

  const laneSignals = useMemo(() => {
    if (!activeLane) return [];
    return allSignals.filter(s => s.lane_relevance?.includes(activeLane)).sort((a, b) => b.strength - a.strength).slice(0, 10);
  }, [allSignals, activeLane]);

  const globalSignals = useMemo(() => {
    return [...allSignals].sort((a, b) => b.strength - a.strength).slice(0, 10);
  }, [allSignals]);

  const typeConfig = PRODUCTION_TYPE_TREND_CATEGORIES[effectiveFilter] || PRODUCTION_TYPE_TREND_CATEGORIES[selectedType];

  return (
    <TrendsPageShell
      badge="Trends Explorer"
      title="Live Trend Data"
      subtitle="Modality-aware signals and cast trends — same filter logic as Pitch Engine."
      controls={
        <TrendsFilterBar
          breadcrumb={
            <>
              <Filter className="h-3 w-3 shrink-0" />
              <span>
                production_type=<strong className="text-foreground">{effectiveFilter}</strong> · modality=<strong className="text-foreground">{modality}</strong>
                {activeLane && <> · lane=<strong className="text-foreground">{activeLane}</strong></>}
              </span>
              <span className="ml-auto shrink-0">{allSignals.length} signals · {castTrends.length} cast</span>
            </>
          }
        >
          <FilterSelect label="Production Type" value={selectedType} onChange={setSelectedType} options={PRODUCTION_TYPES} />
          <FilterSelect
            label="Modality"
            value={modality}
            onChange={v => setModality(v as ProductionModality)}
            options={PRODUCTION_MODALITIES.map(m => ({ value: m, label: MODALITY_LABELS[m] }))}
          />
          <FilterSelect label="Lane" value={lane} onChange={setLane} options={LANES} />
        </TrendsFilterBar>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lane-scoped signals */}
        {activeLane && (
          <ResultCard
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
            title={`Lane: ${activeLane}`}
            count={laneSignals.length}
          >
            {laneSignals.length === 0 ? (
              <EmptyState text="No lane-scoped signals found." />
            ) : (
              laneSignals.map((s, i) => <SignalRow key={s.name + i} signal={s} rank={i + 1} onClick={() => setSelectedSignal(s)} />)
            )}
          </ResultCard>
        )}

        {/* Global signals */}
        <ResultCard
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          title={`${typeConfig?.label || selectedType} Signals`}
          count={globalSignals.length}
        >
          {signalsLoading ? (
            <p className="text-sm text-muted-foreground py-3 text-center animate-pulse">Loading…</p>
          ) : globalSignals.length === 0 ? (
            <div className="py-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {signalDbCount} active signals for "{effectiveFilter}"
              </div>
              <Link to="/trends/coverage" className="text-xs text-primary hover:underline">Open Coverage →</Link>
            </div>
          ) : (
            globalSignals.map((s, i) => <SignalRow key={s.name + i} signal={s} rank={i + 1} onClick={() => setSelectedSignal(s)} />)
          )}
        </ResultCard>

        {/* Cast trends */}
        <ResultCard
          icon={<Users className="h-4 w-4 text-primary" />}
          title={typeConfig?.castLabel || 'Cast Trends'}
          count={castTrends.slice(0, 10).length}
        >
          {castLoading ? (
            <p className="text-sm text-muted-foreground py-3 text-center animate-pulse">Loading…</p>
          ) : castTrends.length === 0 ? (
            <div className="py-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {castDbCount} active cast trends for "{effectiveFilter}"
              </div>
              <Link to="/trends/coverage" className="text-xs text-primary hover:underline">Open Coverage →</Link>
            </div>
          ) : (
            castTrends.slice(0, 10).map((ct, i) => (
              <div key={ct.actor_name + i} className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0">
                <span className="text-[10px] text-muted-foreground w-4 text-right font-mono">{i + 1}</span>
                <span className="text-sm font-medium text-foreground flex-1 truncate">{ct.actor_name}</span>
                <span className="text-[10px] text-muted-foreground">{ct.trend_type}</span>
                <Badge variant="outline" className="text-[10px] h-5">{ct.strength}/10</Badge>
                <Badge variant={ct.velocity === 'Rising' ? 'default' : 'secondary'} className="text-[10px] h-5">{ct.velocity}</Badge>
              </div>
            ))
          )}
        </ResultCard>
      </div>
      <TrendSignalModal open={!!selectedSignal} onOpenChange={open => !open && setSelectedSignal(null)} signal={selectedSignal} />
    </TrendsPageShell>
  );
}

/* ── Sub-components ── */

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 bg-muted/50 border-border/50 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ResultCard({ icon, title, count, children }: {
  icon: React.ReactNode; title: string; count: number; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/20">
        {icon}
        <h3 className="text-sm font-semibold text-foreground flex-1">{title}</h3>
        <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
      </div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-3 text-center">{text}</p>;
}

function SignalRow({ signal, rank, onClick }: { signal: any; rank: number; onClick?: () => void }) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0 cursor-pointer hover:bg-muted/30 rounded-sm transition-colors -mx-1 px-1"
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick?.()}
      role="button"
      tabIndex={0}
    >
      <span className="text-[10px] text-muted-foreground w-4 text-right font-mono">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate">{signal.name}</span>
          <Badge variant="outline" className="text-[10px] h-5 shrink-0">{signal.category}</Badge>
        </div>
        {signal.explanation && (
          <p className="text-[11px] text-muted-foreground line-clamp-1">{signal.explanation}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[10px] h-5 font-mono">{signal.strength}/10</Badge>
        <Badge variant={signal.velocity === 'Rising' ? 'default' : 'secondary'} className="text-[10px] h-5">{signal.velocity}</Badge>
        {signal.saturation_risk && signal.saturation_risk !== 'Low' && (
          <Badge variant="destructive" className="text-[10px] h-5">Sat: {signal.saturation_risk}</Badge>
        )}
      </div>
    </div>
  );
}

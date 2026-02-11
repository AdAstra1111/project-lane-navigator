import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, DollarSign, Star, Search, ChevronDown, ChevronUp,
  MapPin, Zap, Shield, ArrowUpDown, Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTerritoryCosts, type TerritoryCostEntry } from '@/hooks/useTerritoryCosts';
import { Skeleton } from '@/components/ui/skeleton';

type SortKey = 'cost_index' | 'crew_day_rate_high' | 'stage_day_rate' | 'territory';

const REGION_OPTIONS = ['All', 'North America', 'Europe', 'Asia', 'Oceania', 'Latin America', 'Africa'];

const QUALITY_COLORS: Record<string, string> = {
  excellent: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'very good': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  good: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  developing: 'bg-muted text-muted-foreground border-border',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-muted-foreground',
};

function formatUSD(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

function CostBar({ value, max, color = 'bg-primary' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}

export function TerritoryCostBrowser() {
  const { data: territories = [], isLoading } = useTerritoryCosts();
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [sortBy, setSortBy] = useState<SortKey>('cost_index');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = territories;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.territory.toLowerCase().includes(q) ||
        t.region.toLowerCase().includes(q) ||
        t.incentive_headline.toLowerCase().includes(q)
      );
    }
    if (regionFilter !== 'All') {
      list = list.filter(t => t.region === regionFilter);
    }
    list = [...list].sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      if (typeof av === 'string') return sortAsc ? (av as string).localeCompare(bv as string) : (bv as string).localeCompare(av as string);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [territories, search, regionFilter, sortBy, sortAsc]);

  const maxCrew = useMemo(() => Math.max(...territories.map(t => t.crew_day_rate_high), 1), [territories]);
  const maxStage = useMemo(() => Math.max(...territories.map(t => t.stage_day_rate), 1), [territories]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(key === 'territory'); }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search territory, region, incentive..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-40 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGION_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wider px-2">
        <SortButton label="Territory" sortKey="territory" current={sortBy} asc={sortAsc} onClick={toggleSort} className="w-40" />
        <SortButton label="Cost Index" sortKey="cost_index" current={sortBy} asc={sortAsc} onClick={toggleSort} className="w-24" />
        <SortButton label="Crew Rate" sortKey="crew_day_rate_high" current={sortBy} asc={sortAsc} onClick={toggleSort} className="flex-1" />
        <SortButton label="Stage Rate" sortKey="stage_day_rate" current={sortBy} asc={sortAsc} onClick={toggleSort} className="flex-1" />
        <span className="w-20 text-right">Incentive</span>
      </div>

      {/* Territory list */}
      <div className="space-y-1.5">
        <AnimatePresence>
          {filtered.map((t, i) => {
            const expanded = expandedId === t.id;
            const indexColor = t.cost_index <= 0.4 ? 'text-emerald-400' : t.cost_index <= 0.7 ? 'text-sky-400' : t.cost_index <= 0.85 ? 'text-amber-400' : 'text-foreground';
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <button
                  className="w-full flex items-center gap-4 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                >
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.territory}</p>
                    <p className="text-[10px] text-muted-foreground">{t.region}</p>
                  </div>
                  <div className="w-24 shrink-0 text-center">
                    <span className={`text-sm font-bold ${indexColor}`}>{t.cost_index.toFixed(2)}×</span>
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14">{formatUSD(t.crew_day_rate_low)}–{formatUSD(t.crew_day_rate_high)}</span>
                      <CostBar value={t.crew_day_rate_high} max={maxCrew} color="bg-violet-500" />
                    </div>
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-12">{formatUSD(t.stage_day_rate)}</span>
                      <CostBar value={t.stage_day_rate} max={maxStage} color="bg-sky-500" />
                    </div>
                  </div>
                  <div className="w-20 text-right">
                    {t.incentive_headline ? (
                      <Badge variant="outline" className="text-[9px] px-1.5 border-emerald-500/30 text-emerald-400">
                        {t.incentive_headline.split(':')[0].split('.')[0].slice(0, 12)}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                  {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                </button>

                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
                        {/* Cost breakdown */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <CostStat label="Crew Day Rate" value={`${formatUSD(t.crew_day_rate_low)} – ${formatUSD(t.crew_day_rate_high)}`} />
                          <CostStat label="Stage Day Rate" value={formatUSD(t.stage_day_rate)} />
                          <CostStat label="Location Permit" value={formatUSD(t.location_permit_avg)} />
                          <CostStat label="Accommodation/day" value={formatUSD(t.accommodation_day)} />
                          <CostStat label="Per Diem" value={formatUSD(t.per_diem)} />
                          <CostStat label="Timezone" value={t.timezone || '—'} />
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Labor Quality</span>
                            <div className="mt-0.5">
                              <Badge className={`text-[10px] border ${QUALITY_COLORS[t.labor_quality] || QUALITY_COLORS.developing}`}>
                                {t.labor_quality}
                              </Badge>
                            </div>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Infrastructure</span>
                            <div className="mt-0.5">
                              <Badge className={`text-[10px] border ${QUALITY_COLORS[t.infrastructure_rating] || QUALITY_COLORS.developing}`}>
                                {t.infrastructure_rating}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        {/* Incentive */}
                        {t.incentive_headline && (
                          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Zap className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-xs font-medium text-emerald-400">Incentive</span>
                            </div>
                            <p className="text-xs text-foreground">{t.incentive_headline}</p>
                          </div>
                        )}

                        {/* Notes */}
                        {t.notes && (
                          <p className="text-xs text-muted-foreground">{t.notes}</p>
                        )}

                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] ${CONFIDENCE_COLORS[t.confidence]}`}>
                            Confidence: {t.confidence}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No territories match your search.</p>
        )}
      </div>
    </div>
  );
}

function CostStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function SortButton({
  label, sortKey, current, asc, onClick, className,
}: {
  label: string; sortKey: SortKey; current: SortKey; asc: boolean; onClick: (k: SortKey) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <button
      className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${active ? 'text-foreground' : ''} ${className || ''}`}
      onClick={() => onClick(sortKey)}
    >
      {label}
      {active && <ArrowUpDown className="h-2.5 w-2.5" />}
    </button>
  );
}

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radio, TrendingUp, Users, Filter, AlertTriangle } from 'lucide-react';
import { Header } from '@/components/Header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiveSignals, useActiveCastTrends, useSignalCount, useCastTrendsCount, PRODUCTION_TYPE_TREND_CATEGORIES } from '@/hooks/useTrends';
import { PRODUCTION_MODALITIES, MODALITY_LABELS, type ProductionModality } from '@/config/productionModality';
import { Link } from 'react-router-dom';

const PRODUCTION_TYPES = Object.entries(PRODUCTION_TYPE_TREND_CATEGORIES).map(([value, config]) => ({
  value,
  label: config.label,
}));

const LANES = [
  { value: '', label: 'Any Lane' },
  { value: 'studio-streamer', label: 'Studio / Streamer' },
  { value: 'independent-film', label: 'Independent Film' },
  { value: 'low-budget', label: 'Low Budget' },
  { value: 'international-copro', label: "Int'l Co-Pro" },
  { value: 'genre-market', label: 'Genre / Market' },
  { value: 'prestige-awards', label: 'Prestige / Awards' },
  { value: 'fast-turnaround', label: 'Fast Turnaround' },
];

/** Mirror backend filter logic exactly */
function modalityToFilter(modality: string, typeLabel: string): string {
  if (modality === 'animation') return 'animation';
  return typeLabel;
}

export default function TrendsExplorer() {
  const [selectedType, setSelectedType] = useState('film');
  const [modality, setModality] = useState<ProductionModality>('live_action');
  const [lane, setLane] = useState('');

  const effectiveFilter = modalityToFilter(modality, selectedType);

  // Fetch signals with the same filter logic as backend
  const { data: allSignals = [], isLoading: signalsLoading } = useActiveSignals({
    productionType: effectiveFilter,
  });

  // Fetch cast trends
  const { data: castTrends = [], isLoading: castLoading } = useActiveCastTrends({
    productionType: effectiveFilter,
  });

  // Count hooks for diagnostic messages
  const { data: signalDbCount = 0 } = useSignalCount(effectiveFilter);
  const { data: castDbCount = 0 } = useCastTrendsCount(effectiveFilter);

  // Client-side lane filter for "Lane Trends"
  const laneSignals = useMemo(() => {
    if (!lane) return [];
    return allSignals
      .filter(s => s.lane_relevance?.includes(lane))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);
  }, [allSignals, lane]);

  // Global signals (all, no lane filter)
  const globalSignals = useMemo(() => {
    return [...allSignals]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);
  }, [allSignals]);

  const typeConfig = PRODUCTION_TYPE_TREND_CATEGORIES[selectedType];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-5xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Trends Explorer</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Live Trend Data</h1>
            <p className="text-muted-foreground mt-1">Modality-aware trend signals and cast trends — same filter logic as Pitch Engine.</p>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Production Type</label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="bg-muted/50 border-border/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_TYPES.map(pt => (
                    <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Modality</label>
              <Select value={modality} onValueChange={v => setModality(v as ProductionModality)}>
                <SelectTrigger className="bg-muted/50 border-border/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_MODALITIES.map(m => (
                    <SelectItem key={m} value={m}>{MODALITY_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lane</label>
              <Select value={lane} onValueChange={setLane}>
                <SelectTrigger className="bg-muted/50 border-border/50"><SelectValue placeholder="Any Lane" /></SelectTrigger>
                <SelectContent>
                  {LANES.map(l => (
                    <SelectItem key={l.value || '__any__'} value={l.value || '__any__'}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Filter breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border/30 rounded-md px-3 py-2 bg-muted/20">
            <Filter className="h-3 w-3" />
            <span>filter: production_type=<strong className="text-foreground">{effectiveFilter}</strong>, modality=<strong className="text-foreground">{modality}</strong>{lane && lane !== '__any__' ? <>, lane=<strong className="text-foreground">{lane}</strong></> : ''}</span>
            <span className="ml-auto">{allSignals.length} signal{allSignals.length !== 1 ? 's' : ''} · {castTrends.length} cast trend{castTrends.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Lane Trends */}
            {lane && lane !== '__any__' && (
              <Card className="border-border/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Lane Trends ({lane})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {laneSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No lane-scoped signals found.</p>
                  ) : (
                    <div className="space-y-2">
                      {laneSignals.map((s, i) => (
                        <SignalRow key={s.name + i} signal={s} rank={i + 1} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Global Trends */}
            <Card className="border-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  {typeConfig?.label || selectedType} Signals (Top 10)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {signalsLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">Loading signals…</p>
                ) : globalSignals.length === 0 ? (
                  <div className="py-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      DB has {signalDbCount} active trend_signals for production_type="{effectiveFilter}"
                    </div>
                    <Link to="/trends/coverage" className="text-xs text-primary hover:underline">
                      Open Trends Coverage →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {globalSignals.map((s, i) => (
                      <SignalRow key={s.name + i} signal={s} rank={i + 1} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cast Trends */}
            <Card className="border-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  {typeConfig?.castLabel || 'Cast Trends'} (Top 10)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {castLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">Loading cast trends…</p>
                ) : castTrends.length === 0 ? (
                  <div className="py-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      DB has {castDbCount} active cast_trends for production_type="{effectiveFilter}"
                    </div>
                    <Link to="/trends/coverage" className="text-xs text-primary hover:underline">
                      Open Trends Coverage →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {castTrends.slice(0, 10).map((ct, i) => (
                      <div key={ct.actor_name + i} className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0">
                        <span className="text-xs text-muted-foreground w-5 text-right font-mono">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground">{ct.actor_name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{ct.trend_type}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{ct.strength}/10</Badge>
                        <Badge variant={ct.velocity === 'Rising' ? 'default' : 'secondary'} className="text-[10px]">{ct.velocity}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

function SignalRow({ signal, rank }: { signal: any; rank: number }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground w-5 text-right font-mono mt-0.5">{rank}</span>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{signal.name}</span>
          <Badge variant="outline" className="text-[10px]">{signal.category}</Badge>
        </div>
        {signal.explanation && (
          <p className="text-xs text-muted-foreground line-clamp-1">{signal.explanation}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant="outline" className="text-[10px] font-mono">{signal.strength}/10</Badge>
        <Badge variant={signal.velocity === 'Rising' ? 'default' : 'secondary'} className="text-[10px]">{signal.velocity}</Badge>
        {signal.saturation_risk && signal.saturation_risk !== 'Low' && (
          <Badge variant="destructive" className="text-[10px]">Sat: {signal.saturation_risk}</Badge>
        )}
      </div>
    </div>
  );
}

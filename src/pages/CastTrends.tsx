import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Archive, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/Header';
import { CastTrendCard } from '@/components/CastTrendCard';
import { TrendsFilters } from '@/components/TrendsFilters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useActiveCastTrends,
  useArchivedCastTrends,
  useTrendCountsByType,
  CastFilters,
  PRODUCTION_TYPE_TREND_CATEGORIES,
  TARGET_BUYER_OPTIONS,
  BUDGET_TIER_OPTIONS,
} from '@/hooks/useTrends';

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="glass-card rounded-xl p-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
      <h4 className="font-display font-semibold text-foreground mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
  );
}

function SkeletonCards({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-card rounded-lg p-5 animate-pulse space-y-3">
          <div className="h-4 w-48 bg-muted rounded" />
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-2/3 bg-muted rounded" />
        </div>
      ))}
    </>
  );
}

const PRODUCTION_TYPES = Object.entries(PRODUCTION_TYPE_TREND_CATEGORIES).map(([value, config]) => ({
  value,
  label: config.label,
  castLabel: config.castLabel,
}));

export default function CastTrends() {
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('type') || 'film';
  const [selectedType, setSelectedType] = useState(initialType);
  const typeConfig = PRODUCTION_TYPE_TREND_CATEGORIES[selectedType];

  const [filters, setFilters] = useState<CastFilters>({ productionType: initialType });
  const handleFilter = useCallback((key: string, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters({ productionType: selectedType }), [selectedType]);

  const handleTypeChange = useCallback((type: string) => {
    setSelectedType(type);
    setFilters({ productionType: type });
  }, []);

  const isNonFilm = ['commercial', 'branded-content', 'music-video', 'digital-series'].includes(selectedType);

  const filterConfigs = useMemo(() => {
    const configs = [
      { key: 'region', label: 'Region', options: [
        { value: 'UK', label: 'UK' }, { value: 'US', label: 'US' },
        { value: 'Europe', label: 'Europe' }, { value: 'Australia', label: 'Australia' },
      ]},
      { key: 'cyclePhase', label: 'Phase', options: [
        { value: 'Early', label: 'Early' }, { value: 'Building', label: 'Building' },
        { value: 'Peaking', label: 'Peaking' },
      ]},
      { key: 'velocity', label: 'Velocity', options: [
        { value: 'Rising', label: 'Rising' }, { value: 'Stable', label: 'Stable' },
        { value: 'Declining', label: 'Declining' },
      ]},
      { key: 'saturationRisk', label: 'Saturation', options: [
        { value: 'Low', label: 'Low' }, { value: 'Medium', label: 'Medium' },
        { value: 'High', label: 'High' },
      ]},
      { key: 'budgetTier', label: 'Budget Tier', options: BUDGET_TIER_OPTIONS },
    ];

    const buyerOpts = TARGET_BUYER_OPTIONS[selectedType] || TARGET_BUYER_OPTIONS.film;
    configs.push({ key: 'targetBuyer', label: isNonFilm ? 'Target Client' : 'Target Buyer', options: buyerOpts });

    // Only add film-specific filters for narrative types
    if (!isNonFilm) {
      configs.splice(1, 0,
        { key: 'ageBand', label: 'Age Band', options: [
          { value: 'Under 18', label: 'Under 18' }, { value: '18-25', label: '18–25' },
          { value: '26-35', label: '26–35' }, { value: '36-45', label: '36–45' },
        ]},
        { key: 'trendType', label: 'Trend Type', options: [
          { value: 'Emerging', label: 'Emerging' }, { value: 'Accelerating', label: 'Accelerating' },
          { value: 'Resurgent', label: 'Resurgent' },
        ]},
        { key: 'genreRelevance', label: 'Genre', options: [
          { value: 'YA', label: 'YA' }, { value: 'Comedy', label: 'Comedy' },
          { value: 'Drama', label: 'Drama' }, { value: 'Genre Film', label: 'Genre Film' },
          { value: 'Action', label: 'Action' },
        ]},
        { key: 'marketAlignment', label: 'Market', options: [
          { value: 'Indie', label: 'Indie' }, { value: 'Studio', label: 'Studio' },
          { value: 'Streamer', label: 'Streamer' },
        ]},
      );
    }

    return configs;
  }, [selectedType, isNonFilm]);

  const { data: activeCast = [], isLoading: loadingCast } = useActiveCastTrends(filters);
  const { data: archivedCast = [], isLoading: loadingArchived } = useArchivedCastTrends(selectedType);
  const { data: trendCounts = {} } = useTrendCountsByType();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          {/* Page Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
              {typeConfig?.castLabel || 'Cast Trends'}
            </h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              {isNonFilm
                ? `Key personnel and creative leads driving ${typeConfig?.label || selectedType} momentum.`
                : 'Emerging and rising talent identified through casting momentum, breakout performances, and audience traction.'
              }
            </p>
          </div>

          {/* Production Type Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Production Type</label>
            <Select value={selectedType} onValueChange={handleTypeChange}>
              <SelectTrigger className="w-full h-9 bg-muted/50 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(pt => {
                  const c = trendCounts[pt.value];
                  const total = c ? c.signals + c.cast : 0;
                  return (
                    <SelectItem key={pt.value} value={pt.value}>
                      <span className="flex items-center justify-between w-full gap-2">
                        {pt.label}
                        {total > 0 && (
                          <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-mono ml-2">
                            {total}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Filters */}
          <TrendsFilters
            filters={filters as Record<string, string>}
            filterConfigs={filterConfigs}
            onFilterChange={handleFilter}
            onReset={resetFilters}
          />

          {/* Cast Tabs */}
          <Tabs defaultValue="active" className="space-y-4">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="active" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                Active
                {activeCast.length > 0 && (
                  <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono">
                    {activeCast.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="archive" className="gap-1.5">
                <Archive className="h-3.5 w-3.5" />
                Archive
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="space-y-3">
              {loadingCast ? <SkeletonCards count={3} /> : activeCast.length > 0 ? (
                activeCast.map((trend, i) => <CastTrendCard key={trend.id} trend={trend} index={i} />)
              ) : (
                <EmptyState
                  icon={Users}
                  title={`No active ${typeConfig?.castLabel?.toLowerCase() || 'signals'}`}
                  description={`${typeConfig?.castLabel || 'Talent'} signals for ${typeConfig?.label || 'this type'} will appear here once detected.`}
                />
              )}
            </TabsContent>

            <TabsContent value="archive" className="space-y-3">
              {loadingArchived ? <SkeletonCards count={2} /> : archivedCast.length > 0 ? (
                archivedCast.map((trend, i) => <CastTrendCard key={trend.id} trend={trend} index={i} isArchived />)
              ) : (
                <EmptyState
                  icon={Archive}
                  title="No archived signals"
                  description="Past signals will be recorded here with their trajectory."
                />
              )}
            </TabsContent>
          </Tabs>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Scored on Strength (1–10), Velocity, and Saturation Risk. Focus on trajectory, not fame. Segmented by production type.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

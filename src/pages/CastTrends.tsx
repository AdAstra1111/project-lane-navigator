import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, Archive, Users } from 'lucide-react';
import { Header } from '@/components/Header';
import { CastTrendCard } from '@/components/CastTrendCard';
import { TrendsFilters } from '@/components/TrendsFilters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useActiveCastTrends,
  useArchivedCastTrends,
  CastFilters,
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

const CAST_FILTER_CONFIGS = [
  { key: 'region', label: 'Region', options: [
    { value: 'UK', label: 'UK' }, { value: 'US', label: 'US' },
    { value: 'Europe', label: 'Europe' }, { value: 'Australia', label: 'Australia' },
  ]},
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
  { key: 'cyclePhase', label: 'Phase', options: [
    { value: 'Early', label: 'Early' }, { value: 'Building', label: 'Building' },
    { value: 'Peaking', label: 'Peaking' },
  ]},
  { key: 'marketAlignment', label: 'Market', options: [
    { value: 'Indie', label: 'Indie' }, { value: 'Studio', label: 'Studio' },
    { value: 'Streamer', label: 'Streamer' },
  ]},
];

export default function CastTrends() {
  const [filters, setFilters] = useState<CastFilters>({});
  const handleFilter = useCallback((key: string, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters({}), []);

  const { data: activeCast = [], isLoading: loadingCast } = useActiveCastTrends(filters);
  const { data: archivedCast = [], isLoading: loadingArchived } = useArchivedCastTrends();

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
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Cast Trends</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Emerging and rising talent identified through casting momentum, breakout performances, and audience traction.
            </p>
          </div>

          {/* Filters */}
          <TrendsFilters
            filters={filters as Record<string, string>}
            filterConfigs={CAST_FILTER_CONFIGS}
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
                  title="No active cast signals"
                  description="Talent signals will appear here once sustained momentum is detected across independent sources."
                />
              )}
            </TabsContent>

            <TabsContent value="archive" className="space-y-3">
              {loadingArchived ? <SkeletonCards count={2} /> : archivedCast.length > 0 ? (
                archivedCast.map((trend, i) => <CastTrendCard key={trend.id} trend={trend} index={i} isArchived />)
              ) : (
                <EmptyState
                  icon={Archive}
                  title="No archived cast signals"
                  description="Past talent signals will be recorded here with their career trajectory."
                />
              )}
            </TabsContent>
          </Tabs>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Cast signals require sustained momentum across independent data points. Focus on trajectory, not fame.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

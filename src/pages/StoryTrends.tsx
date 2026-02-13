import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, FileText, Archive, BookOpen, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/Header';
import { SignalCard } from '@/components/market/SignalCard';
import { TrendsFilters } from '@/components/market/TrendsFilters';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useActiveSignals,
  useArchivedSignals,
  useLatestWeeklyBrief,
  useTrendCountsByType,
  StoryFilters,
  PRODUCTION_TYPE_TREND_CATEGORIES,
  TARGET_BUYER_OPTIONS,
  BUDGET_TIER_OPTIONS,
} from '@/hooks/useTrends';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

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
}));

export default function StoryTrends() {
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('type') || 'film';
  const [selectedType, setSelectedType] = useState(initialType);
  const typeConfig = PRODUCTION_TYPE_TREND_CATEGORIES[selectedType];
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [filters, setFilters] = useState<StoryFilters>({ productionType: initialType });
  const handleFilter = useCallback((key: string, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters({ productionType: selectedType }), [selectedType]);

  const handleTypeChange = useCallback((type: string) => {
    setSelectedType(type);
    setFilters({ productionType: type });
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: 'Not authenticated', description: 'Please sign in first.', variant: 'destructive' });
        return;
      }
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-trends`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ production_type: selectedType }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Refresh failed');
      }
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ['trend-signals'] });
      queryClient.invalidateQueries({ queryKey: ['cast-trends'] });
      queryClient.invalidateQueries({ queryKey: ['trend-counts-by-type'] });
      toast({
        title: 'Trends refreshed',
        description: `${result.signals_updated} signals and ${result.cast_updated} ${typeConfig?.castLabel?.toLowerCase() || 'cast trends'} updated for ${typeConfig?.label || selectedType}.`,
      });
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedType, typeConfig, queryClient, toast]);

  // Determine if this is a commercial/branded mode (no film terminology)
  const isNonFilm = ['commercial', 'branded-content', 'music-video', 'digital-series'].includes(selectedType);

  const filterConfigs = useMemo(() => {
    const configs = [
      { key: 'genre', label: 'Genre', options: [
        { value: 'YA', label: 'YA' }, { value: 'Horror', label: 'Horror' },
        { value: 'Thriller', label: 'Thriller' }, { value: 'Comedy', label: 'Comedy' },
        { value: 'Drama', label: 'Drama' }, { value: 'Sci-Fi', label: 'Sci-Fi' },
        { value: 'Romance', label: 'Romance' }, { value: 'Action', label: 'Action' },
      ]},
      { key: 'cyclePhase', label: 'Phase', options: [
        { value: 'Early', label: 'Early' }, { value: 'Building', label: 'Building' },
        { value: 'Peaking', label: 'Peaking' }, { value: 'Declining', label: 'Declining' },
      ]},
      { key: 'region', label: 'Region', options: [
        { value: 'UK', label: 'UK' }, { value: 'US', label: 'US' },
        { value: 'Europe', label: 'Europe' }, { value: 'International', label: 'International' },
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

    // Add target buyer based on production type
    const buyerOpts = TARGET_BUYER_OPTIONS[selectedType] || TARGET_BUYER_OPTIONS.film;
    configs.push({ key: 'targetBuyer', label: isNonFilm ? 'Target Client' : 'Target Buyer', options: buyerOpts });

    // Add format/tone only for narrative types
    if (!isNonFilm) {
      configs.splice(1, 0,
        { key: 'tone', label: 'Tone', options: [
          { value: 'Dark', label: 'Dark' }, { value: 'Hopeful', label: 'Hopeful' },
          { value: 'Satirical', label: 'Satirical' }, { value: 'Gritty', label: 'Gritty' },
        ]},
        { key: 'format', label: 'Format', options: [
          { value: 'Feature', label: 'Feature' }, { value: 'Series', label: 'Series' },
        ]},
      );
    }

    return configs;
  }, [selectedType, isNonFilm]);

  const { data: activeSignals = [], isLoading: loadingActive } = useActiveSignals(filters);
  const { data: archivedSignals = [], isLoading: loadingArchived } = useArchivedSignals(selectedType);
  const { data: trendCounts = {} } = useTrendCountsByType();
  const { data: latestBrief, isLoading: loadingBrief } = useLatestWeeklyBrief(selectedType);

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
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                {typeConfig?.label || 'Story'} Signals
              </h1>
              <p className="text-muted-foreground mt-1 leading-relaxed">
                {isNonFilm 
                  ? `Market signals, creative direction, and ${selectedType === 'commercial' ? 'client behaviour' : 'platform behaviour'} trends.`
                  : 'Emerging narrative, genre, tone, and market signals segmented by production type.'
                }
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="shrink-0 mt-1 border-border/50 hover:border-primary/50 hover:bg-primary/5"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing…' : `Refresh ${typeConfig?.label || ''}`}
            </Button>
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

          {/* Weekly Brief */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FileText className="h-4 w-4 text-primary" />
              <h2 className="font-display font-semibold text-foreground text-lg">Weekly Signal Brief</h2>
            </div>
            {loadingBrief ? (
              <div className="glass-card rounded-xl p-6 animate-pulse">
                <div className="h-4 w-32 bg-muted rounded mb-3" />
                <div className="h-3 w-full bg-muted rounded mb-2" />
                <div className="h-3 w-3/4 bg-muted rounded" />
              </div>
            ) : latestBrief ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="glass-card rounded-xl p-6 border-l-4 border-primary"
              >
                <p className="text-xs text-muted-foreground mb-2">
                  Week of {format(new Date(latestBrief.week_start), 'MMM d, yyyy')}
                </p>
                <p className="text-foreground leading-relaxed whitespace-pre-line">{latestBrief.summary}</p>
              </motion.div>
            ) : (
              <EmptyState
                icon={FileText}
                title="No brief yet"
                description="The weekly signal brief will appear here once the first automated analysis cycle completes."
              />
            )}
          </section>

          {/* Filters */}
          <TrendsFilters
            filters={filters as Record<string, string>}
            filterConfigs={filterConfigs}
            onFilterChange={handleFilter}
            onReset={resetFilters}
          />

          {/* Signals Tabs */}
          <Tabs defaultValue="active" className="space-y-4">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="active" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                Active Signals
                {activeSignals.length > 0 && (
                  <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono">
                    {activeSignals.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="archive" className="gap-1.5">
                <Archive className="h-3.5 w-3.5" />
                Archive
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="space-y-3">
              {loadingActive ? <SkeletonCards count={3} /> : activeSignals.length > 0 ? (
                activeSignals.map((signal, i) => <SignalCard key={signal.id} signal={signal} index={i} />)
              ) : (
                <EmptyState
                  icon={Activity}
                  title={`No active ${typeConfig?.label || 'story'} signals`}
                  description={`Signals for ${typeConfig?.label || 'this production type'} will appear here once detected. Use the Refresh button on the Trends hub to trigger analysis.`}
                />
              )}
            </TabsContent>

            <TabsContent value="archive" className="space-y-3">
              {loadingArchived ? <SkeletonCards count={2} /> : archivedSignals.length > 0 ? (
                archivedSignals.map((signal, i) => <SignalCard key={signal.id} signal={signal} index={i} isArchived />)
              ) : (
                <EmptyState
                  icon={Archive}
                  title="No archived signals"
                  description="Past signals will be recorded here with their lifecycle."
                />
              )}
            </TabsContent>
          </Tabs>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Signals are scored on Strength (1–10), Velocity (Rising/Stable/Declining), and Saturation Risk (Low/Medium/High) with a 12-month forecast. Segmented by production type.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

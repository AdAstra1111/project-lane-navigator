import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, FileText, Archive, Radio, Users, BookOpen } from 'lucide-react';
import { Header } from '@/components/Header';
import { SignalCard } from '@/components/SignalCard';
import { CastTrendCard } from '@/components/CastTrendCard';
import { TrendsFilters } from '@/components/TrendsFilters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useActiveSignals,
  useArchivedSignals,
  useLatestWeeklyBrief,
  useActiveCastTrends,
  useArchivedCastTrends,
  StoryFilters,
  CastFilters,
} from '@/hooks/useTrends';
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

const STORY_FILTER_CONFIGS = [
  { key: 'genre', label: 'Genre', options: [
    { value: 'YA', label: 'YA' }, { value: 'Horror', label: 'Horror' },
    { value: 'Thriller', label: 'Thriller' }, { value: 'Comedy', label: 'Comedy' },
    { value: 'Drama', label: 'Drama' }, { value: 'Sci-Fi', label: 'Sci-Fi' },
    { value: 'Romance', label: 'Romance' }, { value: 'Action', label: 'Action' },
  ]},
  { key: 'tone', label: 'Tone', options: [
    { value: 'Dark', label: 'Dark' }, { value: 'Hopeful', label: 'Hopeful' },
    { value: 'Satirical', label: 'Satirical' }, { value: 'Romantic', label: 'Romantic' },
    { value: 'Gritty', label: 'Gritty' }, { value: 'Whimsical', label: 'Whimsical' },
  ]},
  { key: 'format', label: 'Format', options: [
    { value: 'Feature', label: 'Feature' }, { value: 'Series', label: 'Series' },
    { value: 'Limited Series', label: 'Limited Series' },
  ]},
  { key: 'cyclePhase', label: 'Phase', options: [
    { value: 'Early', label: 'Early' }, { value: 'Building', label: 'Building' },
    { value: 'Peaking', label: 'Peaking' }, { value: 'Declining', label: 'Declining' },
  ]},
  { key: 'region', label: 'Region', options: [
    { value: 'UK', label: 'UK' }, { value: 'US', label: 'US' },
    { value: 'Europe', label: 'Europe' }, { value: 'International', label: 'International' },
  ]},
];

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

export default function Trends() {
  // Story filters
  const [storyFilters, setStoryFilters] = useState<StoryFilters>({});
  const handleStoryFilter = useCallback((key: string, value: string | undefined) => {
    setStoryFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const resetStoryFilters = useCallback(() => setStoryFilters({}), []);

  // Cast filters
  const [castFilters, setCastFilters] = useState<CastFilters>({});
  const handleCastFilter = useCallback((key: string, value: string | undefined) => {
    setCastFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const resetCastFilters = useCallback(() => setCastFilters({}), []);

  // Data
  const { data: activeSignals = [], isLoading: loadingActive } = useActiveSignals(storyFilters);
  const { data: archivedSignals = [], isLoading: loadingArchived } = useArchivedSignals();
  const { data: latestBrief, isLoading: loadingBrief } = useLatestWeeklyBrief();
  const { data: activeCast = [], isLoading: loadingCast } = useActiveCastTrends(castFilters);
  const { data: archivedCast = [], isLoading: loadingArchivedCast } = useArchivedCastTrends();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-10"
        >
          {/* Page Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Trends</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Emerging narrative, IP, market behaviour, and talent signals across the entertainment industry.
            </p>
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

          {/* ═══════════ STORY TRENDS ═══════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="h-4 w-4 text-primary" />
              <h2 className="font-display font-semibold text-foreground text-lg">Story Trends</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Narrative, genre, tone, and market signals detected across independent industry sources.
            </p>

            <TrendsFilters
              filters={storyFilters as Record<string, string>}
              filterConfigs={STORY_FILTER_CONFIGS}
              onFilterChange={handleStoryFilter}
              onReset={resetStoryFilters}
            />

            <Tabs defaultValue="active" className="space-y-4 mt-4">
              <TabsList className="bg-muted/50">
                <TabsTrigger value="active" className="gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Active
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
                    title="No active story signals"
                    description="Signals will appear here once three or more independent sources confirm a pattern."
                  />
                )}
              </TabsContent>

              <TabsContent value="archive" className="space-y-3">
                {loadingArchived ? <SkeletonCards count={2} /> : archivedSignals.length > 0 ? (
                  archivedSignals.map((signal, i) => <SignalCard key={signal.id} signal={signal} index={i} isArchived />)
                ) : (
                  <EmptyState
                    icon={Archive}
                    title="No archived story signals"
                    description="Past signals will be recorded here with their lifecycle."
                  />
                )}
              </TabsContent>
            </Tabs>
          </section>

          {/* ═══════════ CAST TRENDS ═══════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-display font-semibold text-foreground text-lg">Cast Trends</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Emerging and rising talent identified through casting momentum, breakout performances, and audience traction.
            </p>

            <TrendsFilters
              filters={castFilters as Record<string, string>}
              filterConfigs={CAST_FILTER_CONFIGS}
              onFilterChange={handleCastFilter}
              onReset={resetCastFilters}
            />

            <Tabs defaultValue="active" className="space-y-4 mt-4">
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
                {loadingArchivedCast ? <SkeletonCards count={2} /> : archivedCast.length > 0 ? (
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
          </section>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6 space-y-1">
            <p>Story signals require confirmation across ≥3 independent sources. Cast signals require sustained momentum across independent data points. Week-over-week comparison is applied automatically.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

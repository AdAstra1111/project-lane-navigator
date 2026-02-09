import { motion } from 'framer-motion';
import { Activity, FileText, Archive, Radio } from 'lucide-react';
import { Header } from '@/components/Header';
import { SignalCard } from '@/components/SignalCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveSignals, useArchivedSignals, useLatestWeeklyBrief } from '@/hooks/useTrends';
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

export default function Trends() {
  const { data: activeSignals = [], isLoading: loadingActive } = useActiveSignals();
  const { data: archivedSignals = [], isLoading: loadingArchived } = useArchivedSignals();
  const { data: latestBrief, isLoading: loadingBrief } = useLatestWeeklyBrief();

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
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Trends</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Emerging narrative, IP, and market behaviour signals across the entertainment industry.
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
              {loadingActive ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="glass-card rounded-lg p-5 animate-pulse space-y-3">
                    <div className="h-4 w-48 bg-muted rounded" />
                    <div className="h-3 w-full bg-muted rounded" />
                    <div className="h-3 w-2/3 bg-muted rounded" />
                  </div>
                ))
              ) : activeSignals.length > 0 ? (
                activeSignals.map((signal, i) => (
                  <SignalCard key={signal.id} signal={signal} index={i} />
                ))
              ) : (
                <EmptyState
                  icon={Activity}
                  title="No active signals"
                  description="Signals will appear here once three or more independent sources confirm a pattern. Single mentions are treated as noise."
                />
              )}
            </TabsContent>

            <TabsContent value="archive" className="space-y-3">
              {loadingArchived ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="glass-card rounded-lg p-5 animate-pulse space-y-3">
                    <div className="h-4 w-48 bg-muted rounded" />
                    <div className="h-3 w-full bg-muted rounded" />
                  </div>
                ))
              ) : archivedSignals.length > 0 ? (
                archivedSignals.map((signal, i) => (
                  <SignalCard key={signal.id} signal={signal} index={i} isArchived />
                ))
              ) : (
                <EmptyState
                  icon={Archive}
                  title="No archived signals"
                  description="Past signals will be recorded here with their lifecycle — when they emerged, built, peaked, and declined."
                />
              )}
            </TabsContent>
          </Tabs>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6 space-y-1">
            <p>Signals require confirmation across ≥3 independent sources before surfacing. Week-over-week comparison is applied automatically.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

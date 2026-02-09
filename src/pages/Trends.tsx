import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Radio, BookOpen, Users, RefreshCw } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { useSignalCount } from '@/hooks/useTrends';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function Trends() {
  const { data: signalCount = 0 } = useSignalCount();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRefresh = async () => {
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
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Refresh failed');
      }

      const result = await response.json();

      // Invalidate all trend queries
      queryClient.invalidateQueries({ queryKey: ['trend-signals'] });
      queryClient.invalidateQueries({ queryKey: ['signal-count'] });
      queryClient.invalidateQueries({ queryKey: ['cast-trends'] });

      toast({
        title: 'Trends refreshed',
        description: `${result.signals_updated} signals and ${result.cast_updated} cast trends updated.`,
      });
    } catch (e: any) {
      console.error('Refresh failed:', e);
      toast({
        title: 'Refresh failed',
        description: e.message || 'Something went wrong. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

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
                <Radio className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Trends</h1>
              <p className="text-muted-foreground mt-1 leading-relaxed">
                Emerging narrative, IP, market behaviour, and talent signals across the entertainment industry.
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
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {/* Navigation Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Link to="/trends/story">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.25 }}
                className="glass-card rounded-xl p-6 hover:border-primary/40 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
                    Story Trends
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Narrative, genre, tone, and market signals detected across independent industry sources.
                </p>
                {signalCount > 0 && (
                  <p className="text-xs text-primary mt-3 font-medium">
                    {signalCount} active signal{signalCount !== 1 ? 's' : ''}
                  </p>
                )}
              </motion.div>
            </Link>

            <Link to="/trends/cast">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.25 }}
                className="glass-card rounded-xl p-6 hover:border-primary/40 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
                    Cast Trends
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Emerging and rising talent identified through casting momentum, breakout performances, and audience traction.
                </p>
              </motion.div>
            </Link>
          </div>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Signals require confirmation across ≥3 independent sources. Project analysis references trends data without embedding it directly.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

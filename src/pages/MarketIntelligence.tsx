import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Globe, TrendingUp, TrendingDown, Minus, Users, Calendar,
  MapPin, ExternalLink, Filter, BarChart3, Zap,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveSignals, useActiveCastTrends } from '@/hooks/useTrends';
import { useBuyerMatches } from '@/hooks/useBuyerMatches';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

/* ── Festivals (same canonical list) ── */
const UPCOMING_FESTIVALS = [
  { name: 'Sundance', location: 'Park City, USA', date: new Date('2026-01-16'), type: 'premiere' },
  { name: 'Berlin / EFM', location: 'Berlin, Germany', date: new Date('2026-02-12'), type: 'hybrid' },
  { name: 'SXSW', location: 'Austin, USA', date: new Date('2026-03-07'), type: 'premiere' },
  { name: 'Cannes / Marché', location: 'Cannes, France', date: new Date('2026-05-12'), type: 'hybrid' },
  { name: 'Toronto (TIFF)', location: 'Toronto, Canada', date: new Date('2026-09-04'), type: 'hybrid' },
  { name: 'AFM', location: 'Las Vegas, USA', date: new Date('2026-11-03'), type: 'market' },
];

const PHASE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  rising: { icon: TrendingUp, color: 'text-emerald-400', label: 'Rising' },
  peaking: { icon: TrendingUp, color: 'text-amber-400', label: 'Peaking' },
  declining: { icon: TrendingDown, color: 'text-red-400', label: 'Declining' },
  stable: { icon: Minus, color: 'text-muted-foreground', label: 'Stable' },
  emerging: { icon: TrendingUp, color: 'text-sky-400', label: 'Emerging' },
};

export default function MarketIntelligence() {
  const navigate = useNavigate();
  const { data: signals = [] } = useActiveSignals();
  const { data: castTrends = [] } = useActiveCastTrends();
  const [genreFilter, setGenreFilter] = useState<string>('all');

  const { data: buyers = [] } = useQuery({
    queryKey: ['market-buyers-intel'],
    queryFn: async () => {
      const { data } = await supabase.from('market_buyers').select('*').eq('status', 'active').limit(50);
      return data || [];
    },
  });

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    signals.forEach((s: any) => (s.genre_tags || []).forEach((g: string) => set.add(g)));
    return Array.from(set).sort();
  }, [signals]);

  const filteredSignals = useMemo(() => {
    if (genreFilter === 'all') return signals.slice(0, 12);
    return signals.filter((s: any) => (s.genre_tags || []).some((g: string) => g.toLowerCase() === genreFilter.toLowerCase())).slice(0, 12);
  }, [signals, genreFilter]);

  const upcomingFestivals = useMemo(() => {
    const now = Date.now();
    return UPCOMING_FESTIVALS
      .filter(f => f.date.getTime() > now)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);
  }, []);

  // Buyer appetite summary
  const buyerAppetite = useMemo(() => {
    const genres: Record<string, number> = {};
    buyers.forEach((b: any) => {
      (b.genres_acquired || []).forEach((g: string) => {
        genres[g] = (genres[g] || 0) + 1;
      });
    });
    return Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [buyers]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              Market Intelligence
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Buyer appetite, trend signals & festival calendar in one view
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/trends')}>
              <TrendingUp className="h-4 w-4 mr-1" /> All Trends
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/buyer-crm')}>
              <Users className="h-4 w-4 mr-1" /> Buyer CRM
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1-2: Trend Signals */}
          <div className="lg:col-span-2 space-y-6">
            {/* Story Trend Signals */}
            <div className="glass-card rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-400" />
                  Trend Signals
                </h2>
                <Select value={genreFilter} onValueChange={setGenreFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="All genres" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All genres</SelectItem>
                    {allGenres.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                {filteredSignals.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No trend signals yet. Run a trend refresh to populate.</p>
                ) : (
                  filteredSignals.map((signal: any, i: number) => {
                    const phase = PHASE_CONFIG[signal.cycle_phase] || PHASE_CONFIG.stable;
                    const Icon = phase.icon;
                    return (
                      <motion.div
                        key={signal.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
                      >
                        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', phase.color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-foreground">{signal.name}</span>
                            <Badge variant="outline" className={cn('text-[10px]', phase.color)}>{phase.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{signal.explanation}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {(signal.genre_tags || []).slice(0, 3).map((g: string) => (
                              <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Cast Trends */}
            <div className="glass-card rounded-xl p-6">
              <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                <Users className="h-5 w-5 text-violet-400" />
                Hot Cast Signals
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {castTrends.slice(0, 6).map((ct: any, i: number) => (
                  <motion.div
                    key={ct.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate('/trends/cast')}
                  >
                    <p className="text-sm font-medium text-foreground">{ct.actor_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">{ct.trend_type}</Badge>
                      <span className="text-[10px] text-muted-foreground">{ct.region}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{ct.explanation}</p>
                  </motion.div>
                ))}
                {castTrends.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-2 py-4 text-center">No cast trends available.</p>
                )}
              </div>
            </div>
          </div>

          {/* Col 3: Sidebar */}
          <div className="space-y-6">
            {/* Upcoming Festivals */}
            <div className="glass-card rounded-xl p-6">
              <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-sky-400" />
                Upcoming Markets
              </h2>
              <div className="space-y-3">
                {upcomingFestivals.map((f, i) => {
                  const daysAway = Math.ceil((f.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <motion.div
                      key={f.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-start gap-3"
                    >
                      <div className={cn(
                        'h-8 w-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0',
                        f.type === 'market' ? 'bg-emerald-500/15 text-emerald-400' :
                        f.type === 'hybrid' ? 'bg-violet-500/15 text-violet-400' :
                        'bg-sky-500/15 text-sky-400'
                      )}>
                        {daysAway}d
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{f.name}</p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {f.location}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="w-full mt-3 text-xs" onClick={() => navigate('/festivals')}>
                View full calendar →
              </Button>
            </div>

            {/* Buyer Appetite Heatmap */}
            <div className="glass-card rounded-xl p-6">
              <h2 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-400" />
                Buyer Appetite
              </h2>
              {buyerAppetite.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No buyer data yet.</p>
              ) : (
                <div className="space-y-2">
                  {buyerAppetite.map(([genre, count]) => {
                    const maxCount = buyerAppetite[0][1] as number;
                    const pct = Math.round(((count as number) / (maxCount as number)) * 100);
                    return (
                      <div key={genre}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-foreground">{genre}</span>
                          <span className="text-muted-foreground">{count} buyers</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-emerald-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ delay: 0.2, duration: 0.5 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="ghost" size="sm" className="w-full mt-3 text-xs" onClick={() => navigate('/buyer-crm')}>
                Browse all buyers →
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

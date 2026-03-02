import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users, Radio, RefreshCw, Settings2, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSignalCount, useTrendCountsByType, PRODUCTION_TYPE_TREND_CATEGORIES } from '@/hooks/useTrends';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { TrendsPageShell } from '@/components/trends/TrendsPageShell';
import { TrendsFilterBar } from '@/components/trends/TrendsFilterBar';

const PRODUCTION_TYPES = Object.entries(PRODUCTION_TYPE_TREND_CATEGORIES).map(([value, config]) => ({
  value,
  label: config.label,
}));

export default function Trends() {
  const [selectedType, setSelectedType] = useState<string>('film');
  const { data: signalCount = 0 } = useSignalCount(selectedType);
  const { data: trendCounts = {} } = useTrendCountsByType();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const typeConfig = PRODUCTION_TYPE_TREND_CATEGORIES[selectedType];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: 'Not authenticated', description: 'Please sign in first.', variant: 'destructive' });
        return;
      }
      // Use batch refresh (scheduled-refresh-trends) for global cooldown
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scheduled-refresh-trends`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ trigger: 'manual' }),
        }
      );
      const result = await response.json();
      if (response.status === 429) {
        toast({
          title: 'Cooldown active',
          description: `All trends are on cooldown until ${new Date(result.next_allowed_at).toLocaleString()}.`,
          variant: 'destructive',
        });
        return;
      }
      if (!response.ok) {
        throw new Error(result.error || 'Refresh failed');
      }
      queryClient.invalidateQueries({ queryKey: ['trend-signals'] });
      queryClient.invalidateQueries({ queryKey: ['cast-trends'] });
      toast({
        title: 'All trends refreshed',
        description: `${result.refreshed_types_count || 0} types refreshed successfully.`,
      });
    } catch (e: any) {
      console.error('Refresh failed:', e);
      toast({ title: 'Refresh failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <TrendsPageShell
      badge="Intelligence Layer"
      title="Trends"
      subtitle="Production-type segmented intelligence. No cross-type contamination."
      rightSlot={
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="border-border/50 hover:border-primary/50 hover:bg-primary/5">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
      controls={
        <TrendsFilterBar>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Production Type</label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="h-9 bg-muted/50 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(pt => {
                  const c = trendCounts[pt.value];
                  const total = c ? c.signals + c.cast : 0;
                  return (
                    <SelectItem key={pt.value} value={pt.value}>
                      <span className="flex items-center gap-2">
                        {pt.label}
                        {total > 0 && (
                          <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-mono">{total}</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </TrendsFilterBar>
      }
    >
      {/* Navigation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link to={`/trends/story?type=${selectedType}`}>
          <NavCard
            icon={<BookOpen className="h-4 w-4 text-primary" />}
            title={`${typeConfig?.label || 'Story'} Signals`}
            desc={`${typeConfig?.storyCategories.slice(0, 3).join(', ')} and more`}
            meta={signalCount > 0 ? `${signalCount} active` : undefined}
          />
        </Link>
        <Link to={`/trends/cast?type=${selectedType}`}>
          <NavCard
            icon={<Users className="h-4 w-4 text-primary" />}
            title={typeConfig?.castLabel || 'Cast Trends'}
            desc={`Talent momentum for ${typeConfig?.label || selectedType} projects`}
          />
        </Link>
        <Link to="/trends/explorer">
          <NavCard
            icon={<Radio className="h-4 w-4 text-primary" />}
            title="Trends Explorer"
            desc="Live modality-aware trend data"
          />
        </Link>
        <Link to="/trends/governance">
          <NavCard
            icon={<Settings2 className="h-4 w-4 text-primary" />}
            title="Engine Governance"
            desc="Toggle engines, adjust weights"
          />
        </Link>
        <Link to="/trends/coverage">
          <NavCard
            icon={<BarChart3 className="h-4 w-4 text-primary" />}
            title="Trends Coverage"
            desc="Audit DB coverage, backfill missing types"
          />
        </Link>
      </div>

      <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-4">
        Signals scored on Strength (1–10), Velocity, and Saturation Risk. Each includes a 12-month forecast.
      </div>
    </TrendsPageShell>
  );
}

function NavCard({ icon, title, desc, meta }: { icon: React.ReactNode; title: string; desc: string; meta?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-4 hover:border-primary/40 transition-colors cursor-pointer group flex items-start gap-3">
      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <h3 className="font-display font-semibold text-foreground text-sm group-hover:text-primary transition-colors">{title}</h3>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{desc}</p>
        {meta && <p className="text-[11px] text-primary mt-1 font-medium">{meta}</p>}
      </div>
    </div>
  );
}

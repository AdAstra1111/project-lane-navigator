import { useState } from 'react';
import { Search, Loader2, Film, Trophy, TrendingUp, Lightbulb, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { OperationProgress, COMP_STAGES } from '@/components/OperationProgress';

interface Comparable {
  title: string;
  year: number;
  budget_estimate: string;
  worldwide_gross: string;
  distribution: string;
  awards: string;
  relevance: string;
  lesson: string;
}

interface CompData {
  comparables: Comparable[];
  market_positioning: string;
  packaging_insight: string;
  timing_note: string;
}

interface CompAnalysisProps {
  projectTitle: string;
  format: string;
  genres: string[];
  budgetRange: string;
  tone: string;
  comparableTitles: string;
}

export function CompAnalysis({ projectTitle, format, genres, budgetRange, tone, comparableTitles }: CompAnalysisProps) {
  const [data, setData] = useState<CompData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('comp-analysis', {
        body: {
          title: projectTitle,
          format,
          genres,
          budget_range: budgetRange,
          tone,
          comparable_titles: comparableTitles,
        },
      });
      if (error) throw error;
      if (result?.error) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
        return;
      }
      setData(result);
    } catch (err: any) {
      toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Comparable Analysis</h3>
        </div>
        <Button size="sm" onClick={handleAnalyze} disabled={isLoading}>
          {isLoading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Researching…</>
          ) : data ? (
            <><Search className="h-3.5 w-3.5 mr-1.5" />Refresh</>
          ) : (
            <><Search className="h-3.5 w-3.5 mr-1.5" />Find Comps</>
          )}
        </Button>
      </div>

      <OperationProgress isActive={isLoading} stages={COMP_STAGES} />

      {!data && !isLoading && (
        <p className="text-sm text-muted-foreground">
          AI-powered analysis of comparable titles with box office, streaming, and awards performance data.
        </p>
      )}

      {data && (
        <div className="space-y-4">
          {/* Market Positioning */}
          <div className="bg-primary/5 rounded-lg px-4 py-3 border-l-4 border-primary">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs text-primary font-medium uppercase tracking-wider">Market Position</p>
            </div>
            <p className="text-sm text-foreground leading-relaxed">{data.market_positioning}</p>
          </div>

          {/* Comparables */}
          <div className="space-y-3">
            {data.comparables.map((comp, i) => (
              <div key={i} className="rounded-lg border border-border/50 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-display font-semibold text-foreground">{comp.title}</h4>
                    <span className="text-xs text-muted-foreground">({comp.year})</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Budget</p>
                    <p className="text-foreground font-medium">{comp.budget_estimate}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Performance</p>
                    <p className="text-foreground font-medium">{comp.worldwide_gross}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Distribution</p>
                    <p className="text-foreground font-medium">{comp.distribution}</p>
                  </div>
                </div>
                {comp.awards && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                    <Trophy className="h-3 w-3" />
                    <span>{comp.awards}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{comp.relevance}</p>
                <div className="flex items-start gap-1.5 text-xs bg-muted/50 rounded px-2.5 py-1.5">
                  <Lightbulb className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <span className="text-foreground">{comp.lesson}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Packaging Insight */}
          <div className="rounded-lg border border-border/50 p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs text-primary font-medium uppercase tracking-wider">Packaging Insight</p>
            </div>
            <p className="text-sm text-foreground leading-relaxed">{data.packaging_insight}</p>
          </div>

          {/* Timing */}
          <div className="rounded-lg border border-border/50 p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Timing</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{data.timing_note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

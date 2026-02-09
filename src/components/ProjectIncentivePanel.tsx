import { useState } from 'react';
import { motion } from 'framer-motion';
import { Landmark, BadgeDollarSign, Handshake, Loader2, ArrowRight, AlertTriangle, Clock } from 'lucide-react';
import { InfoTooltip } from '@/components/InfoTooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

const CONFIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low: { label: 'Low', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface IncentiveInsights {
  top_jurisdictions: {
    jurisdiction: string;
    incentive_name: string;
    estimated_benefit: string;
    payment_timing?: string;
    confidence: string;
    why_it_fits: string;
  }[];
  copro_opportunity: {
    recommended: boolean;
    structure_summary: string;
  };
  financing_stack: { step: number; action: string }[];
  summary: string;
}

interface Props {
  format: string;
  budget_range: string;
  genres: string[];
}

export function ProjectIncentivePanel({ format, budget_range, genres }: Props) {
  const [insights, setInsights] = useState<IncentiveInsights | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Pick sensible default territories based on budget
  const defaultTerritories = ['United Kingdom', 'Ireland', 'Canada', 'France', 'Germany', 'Australia'];

  const handleGenerate = async () => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const { data, error } = await supabase.functions.invoke('project-incentive-insights', {
        body: { format, budget_range, genres, territories: defaultTerritories },
      });
      if (error) throw error;
      if (data?.error) { toast({ title: 'Error', description: data.error, variant: 'destructive' }); return; }
      setInsights(data);
    } catch (err: any) {
      toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <Landmark className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-xl">Incentives & Co-Production</h3>
        <InfoTooltip text="These opportunities update as project conditions change. Always verify with local counsel before relying on them." />
      </div>

      {!insights && !isLoading && (
        <div className="glass-card rounded-xl p-5 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate AI-researched incentive and co-production insights tailored to this project.
          </p>
          <Button onClick={handleGenerate} size="sm">
            <Landmark className="h-4 w-4 mr-1.5" />
            Analyse Incentives
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="glass-card rounded-xl p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Researching incentives across key territories…</p>
        </div>
      )}

      {insights && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="glass-card rounded-xl p-4 border-l-4 border-primary">
            <p className="text-sm text-foreground leading-relaxed">{insights.summary}</p>
          </div>

          {/* Top 3 jurisdictions */}
          <div className="glass-card rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="h-4 w-4 text-primary" />
              <h4 className="font-display font-semibold text-foreground">Top Jurisdictions</h4>
            </div>
            {insights.top_jurisdictions.slice(0, 3).map((j, i) => {
              const conf = CONFIDENCE_STYLES[j.confidence] || CONFIDENCE_STYLES.medium;
              return (
                <div key={i} className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{j.jurisdiction} — {j.incentive_name}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 border ${conf.className}`}>{conf.label}</Badge>
                  </div>
                  <p className="text-xs text-primary font-medium">{j.estimated_benefit}</p>
                  <p className="text-xs text-muted-foreground">{j.why_it_fits}</p>
                  {j.payment_timing && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" /> {j.payment_timing}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Co-Pro */}
          {insights.copro_opportunity.recommended && (
            <div className="glass-card rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-primary" />
                <h4 className="font-display font-semibold text-foreground text-sm">Co-Production Opportunity</h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{insights.copro_opportunity.structure_summary}</p>
            </div>
          )}

          {/* CTA */}
          <Button variant="outline" size="sm" onClick={() => navigate('/incentives')} className="w-full">
            <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
            Build Full Incentive & Co-Pro Plan
          </Button>
        </div>
      )}
    </motion.div>
  );
}

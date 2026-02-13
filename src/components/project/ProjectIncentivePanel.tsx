import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Landmark, BadgeDollarSign, Handshake, Loader2, Clock, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, ListOrdered } from 'lucide-react';
import { InfoTooltip } from '@/components/InfoTooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
    eligibility_summary?: string;
    confidence: string;
    why_it_fits: string;
  }[];
  copro_opportunity: {
    recommended: boolean;
    structure_summary: string;
    additional_value?: string;
    risks?: string;
  };
  financing_stack: { step: number; action: string; timing?: string; notes?: string }[];
  risks?: string[];
  summary: string;
}

interface Props {
  projectId: string;
  format: string;
  budget_range: string;
  genres: string[];
  onAnalysed?: (done: boolean) => void;
}

export function ProjectIncentivePanel({ projectId, format, budget_range, genres, onAnalysed }: Props) {
  const [insights, setInsights] = useState<IncentiveInsights | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showFullPlan, setShowFullPlan] = useState(false);
  const { toast } = useToast();

  const defaultTerritories = ['United Kingdom', 'Ireland', 'Canada', 'France', 'Germany', 'Australia'];

  // Load saved insights on mount
  useEffect(() => {
    const loadSaved = async () => {
      try {
        const { data } = await supabase
          .from('projects')
          .select('incentive_insights')
          .eq('id', projectId)
          .single();
        if (data?.incentive_insights) {
          setInsights(data.incentive_insights as unknown as IncentiveInsights);
          onAnalysed?.(true);
        }
      } catch {
        // ignore
      } finally {
        setInitialLoading(false);
      }
    };
    loadSaved();
  }, [projectId]);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('project-incentive-insights', {
        body: { format, budget_range, genres, territories: defaultTerritories },
      });
      if (error) throw error;
      if (data?.error) { toast({ title: 'Error', description: data.error, variant: 'destructive' }); return; }
      
      setInsights(data);
      onAnalysed?.(true);

      // Persist to project
      await supabase
        .from('projects')
        .update({ incentive_insights: data } as any)
        .eq('id', projectId);
    } catch (err: any) {
      toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (initialLoading) return null;

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
            {insights.top_jurisdictions.slice(0, showFullPlan ? undefined : 3).map((j, i) => {
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
                  {/* Show eligibility in full plan mode */}
                  {showFullPlan && j.eligibility_summary && (
                    <p className="text-[11px] text-muted-foreground border-t border-border/30 pt-1.5 mt-1">
                      <span className="font-medium text-foreground">Eligibility:</span> {j.eligibility_summary}
                    </p>
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
              {showFullPlan && insights.copro_opportunity.additional_value && (
                <p className="text-xs text-foreground leading-relaxed">
                  <span className="font-medium">Additional Value:</span> {insights.copro_opportunity.additional_value}
                </p>
              )}
              {showFullPlan && insights.copro_opportunity.risks && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Risks:</span> {insights.copro_opportunity.risks}
                </p>
              )}
            </div>
          )}

          {/* Full Plan: Financing Stack */}
          <AnimatePresence>
            {showFullPlan && insights.financing_stack?.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-card rounded-xl p-5 space-y-3 overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-primary" />
                  <h4 className="font-display font-semibold text-foreground text-sm">Financing Stack</h4>
                </div>
                <ol className="space-y-2">
                  {insights.financing_stack.map((s) => (
                    <li key={s.step} className="flex gap-3 text-sm">
                      <span className="text-primary font-bold shrink-0 w-5 text-right">{s.step}.</span>
                      <div className="space-y-0.5">
                        <span className="text-foreground">{s.action}</span>
                        {s.timing && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" /> {s.timing}
                          </p>
                        )}
                        {s.notes && (
                          <p className="text-[10px] text-muted-foreground">{s.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Full Plan: Risks */}
          <AnimatePresence>
            {showFullPlan && insights.risks && insights.risks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-card rounded-xl p-4 space-y-2 overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <h4 className="font-display font-semibold text-foreground text-sm">Key Risks & Blockers</h4>
                </div>
                <ul className="space-y-1.5">
                  {insights.risks.map((r, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2">
                      <span className="text-amber-400 shrink-0">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isLoading} className="flex-1">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Re-analyse
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFullPlan(!showFullPlan)}
              className="flex-1"
            >
              {showFullPlan ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 mr-1.5" />
                  Collapse Plan
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                  Full Incentive Plan
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

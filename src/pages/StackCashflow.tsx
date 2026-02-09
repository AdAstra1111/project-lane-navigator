import { useState } from 'react';
import { motion } from 'framer-motion';
import { Layers, Search, Loader2, BadgeDollarSign, Handshake, ListOrdered, AlertTriangle, Clock, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { IncentiveNav } from '@/components/IncentiveNav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const TERRITORIES = [
  'United Kingdom', 'Ireland', 'France', 'Germany', 'Italy', 'Spain', 'Belgium',
  'Netherlands', 'Canada', 'Australia', 'New Zealand', 'South Africa',
  'Denmark', 'Sweden', 'Norway', 'Czech Republic', 'Hungary', 'Poland',
  'Romania', 'Serbia', 'Croatia', 'Greece', 'Portugal',
  'South Korea', 'Japan', 'Colombia', 'Morocco',
];

const BUDGET_OPTIONS = [
  { value: 'micro', label: 'Micro (Under $500K)' },
  { value: 'low', label: 'Low ($500K–$2M)' },
  { value: 'mid', label: 'Mid ($2M–$10M)' },
  { value: 'high', label: 'High ($10M–$25M)' },
  { value: 'studio', label: 'Studio ($25M+)' },
];

const CONFIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low: { label: 'Low', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface StackInsights {
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
  financing_stack: {
    step: number;
    action: string;
    timing?: string;
    notes?: string;
  }[];
  risks?: string[];
  summary: string;
}

export default function StackCashflow() {
  const [territories, setTerritories] = useState<string[]>([]);
  const [adding, setAdding] = useState('');
  const [budget, setBudget] = useState('');
  const [format, setFormat] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState<StackInsights | null>(null);
  const { toast } = useToast();

  const addTerritory = (t: string) => {
    if (t && !territories.includes(t)) setTerritories(prev => [...prev, t]);
    setAdding('');
  };

  const handleResearch = async () => {
    if (!budget || territories.length === 0) return;
    setIsLoading(true);
    setInsights(null);
    try {
      const { data, error } = await supabase.functions.invoke('project-incentive-insights', {
        body: { budget_range: budget, territories, format: format || undefined },
      });
      if (error) throw error;
      if (data?.error) { toast({ title: 'Error', description: data.error, variant: 'destructive' }); return; }
      setInsights(data);
    } catch (err: any) {
      toast({ title: 'Research Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          <IncentiveNav />

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Incentives & Co-Productions</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Stack & Cashflow</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Turn incentives and co-production frameworks into a financeable structure with clear next steps.
            </p>
          </div>

          {/* Inputs */}
          <div className="glass-card rounded-xl p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Budget Range</label>
                <Select value={budget} onValueChange={setBudget}>
                  <SelectTrigger><SelectValue placeholder="Select budget" /></SelectTrigger>
                  <SelectContent>
                    {BUDGET_OPTIONS.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Format</label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger><SelectValue placeholder="Any format" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feature-film">Feature Film</SelectItem>
                    <SelectItem value="tv-series">TV Series</SelectItem>
                    <SelectItem value="documentary">Documentary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Target Territories</label>
              {territories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {territories.map(t => (
                    <Badge key={t} variant="secondary" className="gap-1 pr-1">
                      {t}
                      <button onClick={() => setTerritories(prev => prev.filter(x => x !== t))} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Select value={adding} onValueChange={addTerritory}>
                <SelectTrigger><SelectValue placeholder="Add territory…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {TERRITORIES.filter(t => !territories.includes(t)).map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleResearch} disabled={!budget || territories.length === 0 || isLoading} className="w-full sm:w-auto">
              {isLoading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Analysing…</> : <><Search className="h-4 w-4 mr-1.5" />Build Finance Stack</>}
            </Button>
          </div>

          {/* Results */}
          {insights && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {/* Summary */}
              <div className="glass-card rounded-xl p-5 border-l-4 border-primary">
                <p className="text-sm text-foreground leading-relaxed">{insights.summary}</p>
              </div>

              {/* Top Jurisdictions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="h-4 w-4 text-primary" />
                  <h3 className="font-display font-semibold text-foreground">Top Incentive Jurisdictions</h3>
                </div>
                {insights.top_jurisdictions.map((j, i) => {
                  const conf = CONFIDENCE_STYLES[j.confidence] || CONFIDENCE_STYLES.medium;
                  return (
                    <div key={i} className="glass-card rounded-xl p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-display font-semibold text-foreground">{j.jurisdiction}</h4>
                          <p className="text-xs text-muted-foreground">{j.incentive_name}</p>
                        </div>
                        <Badge className={`text-[10px] px-2 py-0.5 border shrink-0 ${conf.className}`}>{conf.label}</Badge>
                      </div>
                      <div className="bg-primary/5 rounded-lg px-3 py-2 text-sm font-medium text-foreground">{j.estimated_benefit}</div>
                      <p className="text-sm text-muted-foreground">{j.why_it_fits}</p>
                      {j.payment_timing && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> {j.payment_timing}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Co-Pro Opportunity */}
              <div className="glass-card rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Handshake className="h-4 w-4 text-primary" />
                  <h3 className="font-display font-semibold text-foreground">Co-Production Opportunity</h3>
                  <Badge variant={insights.copro_opportunity.recommended ? 'default' : 'secondary'} className="text-[10px]">
                    {insights.copro_opportunity.recommended ? 'Recommended' : 'Not Required'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{insights.copro_opportunity.structure_summary}</p>
                {insights.copro_opportunity.additional_value && (
                  <p className="text-sm text-foreground">{insights.copro_opportunity.additional_value}</p>
                )}
                {insights.copro_opportunity.risks && (
                  <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{insights.copro_opportunity.risks}</span>
                  </div>
                )}
              </div>

              {/* Financing Stack */}
              <div className="glass-card rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-primary" />
                  <h3 className="font-display font-semibold text-foreground">Financing Stack Order</h3>
                </div>
                <ol className="space-y-3">
                  {insights.financing_stack.sort((a, b) => a.step - b.step).map(s => (
                    <li key={s.step} className="flex gap-3 text-sm">
                      <span className="text-primary font-bold shrink-0">{s.step}.</span>
                      <div>
                        <p className="text-foreground font-medium">{s.action}</p>
                        {s.timing && <p className="text-xs text-muted-foreground mt-0.5">{s.timing}</p>}
                        {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Risks */}
              {insights.risks && insights.risks.length > 0 && (
                <div className="glass-card rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <h3 className="font-display font-semibold text-foreground">Key Risks</h3>
                  </div>
                  <ul className="space-y-2">
                    {insights.risks.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="text-destructive shrink-0">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Finance stack analysis is AI-generated. Always verify incentive details and legal structures with qualified counsel.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

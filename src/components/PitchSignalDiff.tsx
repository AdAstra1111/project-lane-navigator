import { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, ZapOff, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { DevelopmentBrief } from '@/hooks/useDevelopmentBriefs';

interface DiffResult {
  baseline: { comps: string[]; logline: string; risk_level: string; recommended_lane: string };
  withSignals: { comps: string[]; logline: string; risk_level: string; recommended_lane: string };
}

interface Props {
  brief: DevelopmentBrief;
  projectId?: string;
}

export function PitchSignalDiff({ brief, projectId }: Props) {
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  const runDiff = async () => {
    setLoading(true);
    try {
      const basePayload = {
        productionType: brief.production_type,
        genre: brief.genre,
        subgenre: brief.subgenre,
        budgetBand: brief.budget_band,
        region: brief.region,
        platformTarget: brief.platform_target,
        audienceDemo: brief.audience_demo,
        riskLevel: brief.risk_appetite,
        briefNotes: brief.notes,
        count: 1,
      };

      const [baseRes, sigRes] = await Promise.all([
        supabase.functions.invoke('generate-pitch', {
          body: { ...basePayload, skipSignals: true },
        }),
        supabase.functions.invoke('generate-pitch', {
          body: { ...basePayload, projectId },
        }),
      ]);

      if (baseRes.error || sigRes.error) throw new Error('Generation failed');

      const baseIdea = (baseRes.data?.ideas || [])[0];
      const sigIdea = (sigRes.data?.ideas || [])[0];

      if (!baseIdea || !sigIdea) throw new Error('No ideas returned');

      setDiff({
        baseline: {
          comps: baseIdea.comps || [],
          logline: baseIdea.logline || '',
          risk_level: baseIdea.risk_level || '',
          recommended_lane: baseIdea.recommended_lane || '',
        },
        withSignals: {
          comps: sigIdea.comps || [],
          logline: sigIdea.logline || '',
          risk_level: sigIdea.risk_level || '',
          recommended_lane: sigIdea.recommended_lane || '',
        },
      });
      toast.success('Diff generated');
    } catch (e: any) {
      toast.error(e.message || 'Diff failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        onClick={runDiff}
        disabled={loading}
        className="gap-1.5"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {loading ? 'Generating diff...' : 'Compare: Baseline vs Signals'}
      </Button>

      {diff && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          <Card className="border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <ZapOff className="h-3.5 w-3.5 text-muted-foreground" />
                Baseline (No Signals)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              <p className="text-xs text-muted-foreground">{diff.baseline.logline}</p>
              <div className="flex flex-wrap gap-1">
                {diff.baseline.comps.map(c => (
                  <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                ))}
              </div>
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <span>Lane: {diff.baseline.recommended_lane}</span>
                <span>Risk: {diff.baseline.risk_level}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" />
                With Signals
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              <p className="text-xs text-foreground">{diff.withSignals.logline}</p>
              <div className="flex flex-wrap gap-1">
                {diff.withSignals.comps.map(c => {
                  const isNew = !diff.baseline.comps.includes(c);
                  return (
                    <Badge key={c} variant={isNew ? 'default' : 'outline'} className="text-[10px]">
                      {isNew && <ArrowRight className="h-2.5 w-2.5 mr-0.5" />}
                      {c}
                    </Badge>
                  );
                })}
              </div>
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <span>Lane: {diff.withSignals.recommended_lane}</span>
                <span>Risk: {diff.withSignals.risk_level}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

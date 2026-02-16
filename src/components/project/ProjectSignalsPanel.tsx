import { useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, RefreshCw, ChevronDown, ExternalLink, Zap, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { TrendScoreBadges } from '@/components/market/TrendScoreBadges';
import { useProjectSignalMatches, useRefreshProjectSignals, useProjectSignalsSettings } from '@/hooks/useSignalsEngine';
import type { Project } from '@/lib/types';
import type { SignalsApplyConfig } from '@/lib/signals-types';

interface Props {
  project: Project;
}

const PHASE_STYLES: Record<string, string> = {
  Early: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Building: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Peaking: 'bg-red-500/15 text-red-400 border-red-500/30',
  Declining: 'bg-muted text-muted-foreground border-border',
};

export function ProjectSignalsPanel({ project }: Props) {
  const [expanded, setExpanded] = useState(true);
  const { data: matches = [], isLoading: matchesLoading } = useProjectSignalMatches(project.id);
  const refreshMutation = useRefreshProjectSignals(project.id);
  const { influence, apply, isLoading: settingsLoading, updateSettings } = useProjectSignalsSettings(project.id);

  const handleRefresh = () => {
    refreshMutation.mutate({
      genres: project.genres,
      tone: project.tone,
      format: project.format,
      budget_range: project.budget_range,
      target_audience: project.target_audience,
      comparable_titles: project.comparable_titles,
      assigned_lane: project.assigned_lane,
      title: project.title,
    });
  };

  const handleInfluenceChange = (val: number[]) => {
    updateSettings.mutate({ influence: val[0] / 100 });
  };

  const handleToggle = (key: keyof SignalsApplyConfig) => {
    const newApply = { ...apply, [key]: !apply[key] };
    updateSettings.mutate({ apply: newApply });
  };

  const influencePercent = Math.round(influence * 100);
  const influenceLabel = influence >= 0.65 ? 'High' : influence >= 0.35 ? 'Moderate' : 'Low';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.3 }}
      className="glass-card rounded-xl overflow-hidden"
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-lg">Signals Engine</h3>
          <Badge variant="secondary" className="text-xs ml-1">{matches.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{influenceLabel} ({influencePercent}%)</Badge>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* Controls */}
          <div className="space-y-3 p-3 rounded-lg bg-muted/20 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Signal Influence</span>
              <span className="text-xs font-mono text-foreground">{influencePercent}%</span>
            </div>
            <Slider
              value={[influencePercent]}
              onValueChange={handleInfluenceChange}
              max={100}
              step={5}
              className="w-full"
            />
            <div className="flex flex-wrap gap-3">
              {(['pitch', 'dev', 'grid', 'doc'] as const).map(key => (
                <label key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Switch
                    checked={apply[key]}
                    onCheckedChange={() => handleToggle(key)}
                    className="scale-75"
                  />
                  {key === 'pitch' ? 'Pitch' : key === 'dev' ? 'Dev Engine' : key === 'grid' ? 'Episode Grid' : 'Documentary'}
                </label>
              ))}
            </div>
          </div>

          {/* Refresh button */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            className="w-full"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            {refreshMutation.isPending ? 'Matching signals...' : 'Refresh Signals'}
          </Button>

          {/* Matches */}
          {matchesLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-lg" />)}
            </div>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No signals matched yet. Click "Refresh Signals" to scan.
            </p>
          ) : (
            <Accordion type="multiple" className="space-y-1.5">
              {matches.slice(0, 5).map(match => {
                const cluster = match.cluster;
                if (!cluster) return null;
                return (
                  <AccordionItem key={match.id} value={match.id} className="glass-card rounded-lg border-none">
                    <AccordionTrigger className="px-3 py-2.5 hover:no-underline gap-2">
                      <div className="flex items-center gap-2 text-left min-w-0 flex-1">
                        <span className="font-display font-semibold text-foreground text-sm truncate">
                          {cluster.name}
                        </span>
                        <Badge className="text-[10px] px-1.5 py-0 border shrink-0 bg-primary/15 text-primary border-primary/30">
                          {(match.impact_score * 100).toFixed(0)}
                        </Badge>
                        {cluster.saturation_risk === 'High' && (
                          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                        )}
                      </div>
                      <TrendScoreBadges
                        strength={cluster.strength}
                        velocity={cluster.velocity as any}
                        saturationRisk={cluster.saturation_risk as any}
                        compact
                      />
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 pt-0">
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{cluster.explanation}</p>
                        <div className="flex flex-wrap gap-1">
                          {(match.rationale?.matched_tags || []).map((tag: string) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                        {cluster.sources_used && (cluster.sources_used as any[]).length > 0 && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            {(cluster.sources_used as any[]).length} sources
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      )}
    </motion.div>
  );
}

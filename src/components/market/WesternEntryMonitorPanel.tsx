import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radar, TrendingUp, TrendingDown, ArrowLeftRight, Zap, AlertTriangle, Globe2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { TrendViabilityResult } from '@/lib/trend-viability';

interface Props {
  engineBreakdown: TrendViabilityResult['engineBreakdown'];
  appliedModifiers: TrendViabilityResult['appliedModifiers'];
}

// China-dominant ecosystem engines
const CHINA_ENGINES = [
  'Platform Revenue Velocity',
  'Retention Proxy Model',
  'Cadence Optimization Model',
  'App Store Ranking Momentum',
];

// Western emerging ecosystem engines
const WESTERN_ENGINES = [
  'Influencer Conversion Index',
  'Micro-Genre Heat Index',
  'Localization Scaling Potential',
  'Episodic Hook Pattern Analyzer',
];

// Shared engines that apply to both ecosystems
const SHARED_ENGINES = [
  'Genre Cycle Engine',
  'Social Engagement Velocity',
];

interface RegionSignal {
  engineName: string;
  score: number;
  confidence: string;
  contribution: number;
  staleDays: number | null;
}

interface DivergencePoint {
  dimension: string;
  chinaScore: number;
  westernScore: number;
  gap: number;
  direction: 'china-leads' | 'western-leads' | 'parity';
  insight: string;
}

function getInsight(dimension: string, gap: number, direction: string): string {
  if (direction === 'parity') return 'Both ecosystems are aligned — competitive parity.';

  const insights: Record<string, Record<string, string>> = {
    'Monetization': {
      'china-leads': 'China\'s proven IAP/ad-hybrid model outpaces Western subscription experiments. Opportunity: adapt revenue cadence for Western platforms.',
      'western-leads': 'Western platforms showing stronger monetization signals — unusual. Investigate direct-to-consumer models gaining traction.',
    },
    'Retention': {
      'china-leads': 'Chinese binge-model retention patterns dominate. Gap represents Western opportunity to pioneer episodic release hooks.',
      'western-leads': 'Western retention signals outperforming — likely driven by social-native viewing habits. Capitalize on shorter session formats.',
    },
    'Distribution': {
      'china-leads': 'App store dominance gives China ecosystem edge in discovery. Western gap = opportunity via social distribution and influencer funnels.',
      'western-leads': 'Western distribution via social platforms outpacing app-store model. Leverage creator-led discovery for market entry.',
    },
    'Content Fit': {
      'china-leads': 'Chinese content cadence and hook patterns more optimized. Western creators should study episode pacing and cliffhanger structures.',
      'western-leads': 'Western genre innovation and localization capability creating content advantage. Position culturally-flexible narratives for cross-market.',
    },
  };

  return insights[dimension]?.[direction] || `${gap > 30 ? 'Significant' : 'Moderate'} divergence detected — strategic arbitrage opportunity.`;
}

function computeRegionScore(signals: RegionSignal[]): number {
  if (signals.length === 0) return 50;
  return Math.round(signals.reduce((s, sig) => s + sig.score * 10, 0) / signals.length);
}

export function WesternEntryMonitorPanel({ engineBreakdown, appliedModifiers }: Props) {
  const analysis = useMemo(() => {
    const chinaSignals: RegionSignal[] = [];
    const westernSignals: RegionSignal[] = [];
    const sharedSignals: RegionSignal[] = [];

    for (const engine of engineBreakdown) {
      const signal: RegionSignal = {
        engineName: engine.engineName,
        score: engine.score,
        confidence: engine.confidence,
        contribution: engine.contribution,
        staleDays: engine.staleDays,
      };

      if (CHINA_ENGINES.includes(engine.engineName)) chinaSignals.push(signal);
      else if (WESTERN_ENGINES.includes(engine.engineName)) westernSignals.push(signal);
      else if (SHARED_ENGINES.includes(engine.engineName)) sharedSignals.push(signal);
    }

    const chinaScore = computeRegionScore(chinaSignals);
    const westernScore = computeRegionScore(westernSignals);

    // Compute divergence points across strategic dimensions
    const monetizationChina = chinaSignals.find(s => s.engineName === 'Platform Revenue Velocity')?.score ?? 5;
    const monetizationWestern = westernSignals.find(s => s.engineName === 'Influencer Conversion Index')?.score ?? 5;

    const retentionChina = chinaSignals.find(s => s.engineName === 'Retention Proxy Model')?.score ?? 5;
    const retentionWestern = westernSignals.find(s => s.engineName === 'Episodic Hook Pattern Analyzer')?.score ?? 5;

    const distributionChina = chinaSignals.find(s => s.engineName === 'App Store Ranking Momentum')?.score ?? 5;
    const distributionWestern = westernSignals.find(s => s.engineName === 'Micro-Genre Heat Index')?.score ?? 5;

    const contentChina = chinaSignals.find(s => s.engineName === 'Cadence Optimization Model')?.score ?? 5;
    const contentWestern = westernSignals.find(s => s.engineName === 'Localization Scaling Potential')?.score ?? 5;

    const buildDivergence = (dimension: string, china: number, western: number): DivergencePoint => {
      const gap = Math.abs(china - western) * 10;
      const direction: DivergencePoint['direction'] = gap <= 10 ? 'parity' : china > western ? 'china-leads' : 'western-leads';
      return { dimension, chinaScore: china * 10, westernScore: western * 10, gap, direction, insight: getInsight(dimension, gap, direction) };
    };

    const divergences: DivergencePoint[] = [
      buildDivergence('Monetization', monetizationChina, monetizationWestern),
      buildDivergence('Retention', retentionChina, retentionWestern),
      buildDivergence('Distribution', distributionChina, distributionWestern),
      buildDivergence('Content Fit', contentChina, contentWestern),
    ];

    // Find highest-gap opportunity
    const topOpportunity = [...divergences].sort((a, b) => b.gap - a.gap)[0];

    // Active modifier count for each region
    const chinaModifiers = appliedModifiers.filter(m => m.label.toLowerCase().includes('china'));
    const westernModifiers = appliedModifiers.filter(m => m.label.toLowerCase().includes('western'));

    return {
      chinaSignals,
      westernSignals,
      sharedSignals,
      chinaScore,
      westernScore,
      divergences,
      topOpportunity,
      chinaModifiers,
      westernModifiers,
      ecosystemGap: Math.abs(chinaScore - westernScore),
      dominantRegion: chinaScore > westernScore ? 'China' : chinaScore < westernScore ? 'Western' : 'Balanced',
    };
  }, [engineBreakdown, appliedModifiers]);

  const gapColor = analysis.ecosystemGap > 25 ? 'text-amber-400' : analysis.ecosystemGap > 10 ? 'text-primary' : 'text-emerald-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Radar className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground text-sm">
            Western Entry Monitor
          </h4>
          <p className="text-xs text-muted-foreground">
            Region-differentiated ecosystem intelligence
          </p>
        </div>
        <Badge variant="outline" className={cn('text-xs border-primary/30', gapColor)}>
          <ArrowLeftRight className="h-3 w-3 mr-1" />
          {analysis.ecosystemGap}pt gap
        </Badge>
      </div>

      {/* Region Score Comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card/50 rounded-xl p-4 border border-border/30 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">🇨🇳 China Ecosystem</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn('text-2xl font-bold font-display', analysis.chinaScore >= 60 ? 'text-emerald-400' : analysis.chinaScore >= 40 ? 'text-amber-400' : 'text-red-400')}>
              {analysis.chinaScore}
            </span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="space-y-1">
            {analysis.chinaSignals.map(s => (
              <div key={s.engineName} className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground truncate flex-1">{s.engineName.replace(/\s*(Model|Index|Tracker|Momentum|Velocity)\s*$/i, '')}</span>
                <span className={cn('text-[10px] font-mono font-semibold', s.score >= 7 ? 'text-emerald-400' : s.score >= 4 ? 'text-amber-400' : 'text-red-400')}>
                  {s.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          {analysis.chinaModifiers.length > 0 && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
              {analysis.chinaModifiers.length} active boost{analysis.chinaModifiers.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        <div className="bg-card/50 rounded-xl p-4 border border-border/30 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">🌍 Western Ecosystem</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn('text-2xl font-bold font-display', analysis.westernScore >= 60 ? 'text-emerald-400' : analysis.westernScore >= 40 ? 'text-amber-400' : 'text-red-400')}>
              {analysis.westernScore}
            </span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="space-y-1">
            {analysis.westernSignals.map(s => (
              <div key={s.engineName} className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground truncate flex-1">{s.engineName.replace(/\s*(Model|Index|Potential|Analyzer)\s*$/i, '')}</span>
                <span className={cn('text-[10px] font-mono font-semibold', s.score >= 7 ? 'text-emerald-400' : s.score >= 4 ? 'text-amber-400' : 'text-red-400')}>
                  {s.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          {analysis.westernModifiers.length > 0 && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
              {analysis.westernModifiers.length} active boost{analysis.westernModifiers.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      {/* Divergence Analysis */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground uppercase tracking-wider">Divergence Analysis</span>
        </div>

        {analysis.divergences.map(div => (
          <div key={div.dimension} className="bg-card/30 rounded-lg p-3 space-y-2 border border-border/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{div.dimension}</span>
              <div className="flex items-center gap-2">
                {div.direction === 'china-leads' && (
                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                    <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
                    CN +{div.gap}
                  </Badge>
                )}
                {div.direction === 'western-leads' && (
                  <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                    <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
                    W +{div.gap}
                  </Badge>
                )}
                {div.direction === 'parity' && (
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">
                    ≈ Parity
                  </Badge>
                )}
              </div>
            </div>

            {/* Visual bar comparison */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground w-6 text-right">CN</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', div.chinaScore >= 60 ? 'bg-emerald-500' : div.chinaScore >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ width: `${div.chinaScore}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-7">{div.chinaScore}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground w-6 text-right">W</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', div.westernScore >= 60 ? 'bg-emerald-500' : div.westernScore >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ width: `${div.westernScore}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-7">{div.westernScore}</span>
            </div>

            <p className="text-[10px] text-muted-foreground leading-relaxed">{div.insight}</p>
          </div>
        ))}
      </div>

      {/* Top Opportunity */}
      {analysis.topOpportunity && analysis.topOpportunity.direction !== 'parity' && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Strategic Opportunity</span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Highest divergence in <strong className="text-foreground">{analysis.topOpportunity.dimension}</strong> ({analysis.topOpportunity.gap}pt gap, {analysis.topOpportunity.direction === 'china-leads' ? 'China' : 'Western'} leading).{' '}
            {analysis.topOpportunity.direction === 'china-leads'
              ? 'Western market gap represents first-mover advantage for adapted content.'
              : 'Western momentum creates opportunity to lead in emerging ecosystem.'}
          </p>
        </div>
      )}

      {/* Shared Signals */}
      {analysis.sharedSignals.length > 0 && (
        <div className="border-t border-border/30 pt-3 space-y-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Cross-Ecosystem Signals</span>
          {analysis.sharedSignals.map(s => (
            <div key={s.engineName} className="flex items-center justify-between py-0.5">
              <span className="text-[10px] text-muted-foreground">{s.engineName}</span>
              <span className={cn('text-[10px] font-mono font-semibold', s.score >= 7 ? 'text-emerald-400' : s.score >= 4 ? 'text-amber-400' : 'text-red-400')}>
                {s.score.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground border-t border-border/30 pt-3">
        Compares China-dominant (monetization, retention, app distribution) vs Western emerging (social virality, localization, creator-led) ecosystem signals. Divergence highlights strategic arbitrage and market entry timing.
      </p>
    </motion.div>
  );
}

import { useMemo } from 'react';
import { Monitor, Tv, Radio, Globe, Zap, Layers } from 'lucide-react';
import { TVMonetisationLane, TV_LANE_LABELS, TV_LANE_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PlatformScore {
  lane: TVMonetisationLane;
  score: number;
  reasoning: string;
}

const PLATFORM_ICONS: Record<TVMonetisationLane, React.ElementType> = {
  'streamer-original': Monitor,
  'broadcaster-commission': Tv,
  'international-copro-series': Globe,
  'premium-cable': Radio,
  'fast-channel': Zap,
  'hybrid-platform': Layers,
};

export function PlatformFitPanel({
  format,
  genres,
  budgetRange,
  tone,
  targetAudience,
  assignedLane,
}: {
  format: string;
  genres: string[];
  budgetRange: string;
  tone: string;
  targetAudience: string;
  assignedLane: string | null;
}) {
  const scores = useMemo((): PlatformScore[] => {
    const results: Record<TVMonetisationLane, { s: number; r: string[] }> = {
      'streamer-original': { s: 0, r: [] },
      'broadcaster-commission': { s: 0, r: [] },
      'international-copro-series': { s: 0, r: [] },
      'premium-cable': { s: 0, r: [] },
      'fast-channel': { s: 0, r: [] },
      'hybrid-platform': { s: 0, r: [] },
    };

    // Budget scoring
    if (budgetRange === '10m-plus-ep' || budgetRange === '5m-10m-ep') {
      results['streamer-original'].s += 30;
      results['streamer-original'].r.push('High per-ep budget suits streamers');
      results['premium-cable'].s += 25;
      results['premium-cable'].r.push('Premium budget aligns with cable originals');
    } else if (budgetRange === '2m-5m-ep') {
      results['broadcaster-commission'].s += 25;
      results['international-copro-series'].s += 25;
      results['streamer-original'].s += 15;
    } else {
      results['fast-channel'].s += 20;
      results['fast-channel'].r.push('Lean budget fits FAST channel model');
      results['broadcaster-commission'].s += 15;
    }

    // Genre scoring
    const g = genres.map(x => x.toLowerCase());
    if (g.includes('drama')) {
      results['streamer-original'].s += 15;
      results['premium-cable'].s += 20;
    }
    if (g.includes('crime') || g.includes('thriller')) {
      results['broadcaster-commission'].s += 20;
      results['broadcaster-commission'].r.push('Crime/thriller genres commission well');
      results['international-copro-series'].s += 15;
    }
    if (g.includes('sci-fi') || g.includes('fantasy')) {
      results['streamer-original'].s += 20;
      results['streamer-original'].r.push('Genre IP attracts streamer investment');
    }
    if (g.includes('comedy')) {
      results['streamer-original'].s += 10;
      results['fast-channel'].s += 15;
    }
    if (g.includes('documentary')) {
      results['broadcaster-commission'].s += 15;
      results['hybrid-platform'].s += 15;
    }

    // Tone scoring
    if (tone === 'elevated' || tone === 'arthouse') {
      results['premium-cable'].s += 15;
      results['streamer-original'].s += 10;
    }
    if (tone === 'commercial' || tone === 'crowd-pleaser') {
      results['broadcaster-commission'].s += 15;
      results['fast-channel'].s += 10;
    }

    // Audience scoring
    if (targetAudience === 'international') {
      results['international-copro-series'].s += 25;
      results['international-copro-series'].r.push('Multi-territory audience is co-pro native');
    }
    if (targetAudience === 'mass-market') {
      results['broadcaster-commission'].s += 15;
      results['streamer-original'].s += 10;
    }

    // Hybrid bonus for multi-signal projects
    const sorted = Object.entries(results).sort(([, a], [, b]) => b.s - a.s);
    const [, top] = sorted[0];
    const [, second] = sorted[1];
    if (top.s > 0 && second.s > 0 && (top.s - second.s) < 10) {
      results['hybrid-platform'].s += 20;
      results['hybrid-platform'].r.push('Multi-platform signals suggest hybrid strategy');
    }

    return Object.entries(results)
      .map(([lane, { s, r }]) => ({
        lane: lane as TVMonetisationLane,
        score: Math.min(100, s),
        reasoning: r.join('. ') || 'Low signal for this platform type',
      }))
      .sort((a, b) => b.score - a.score);
  }, [genres, budgetRange, tone, targetAudience]);

  const topLane = scores[0];

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <h4 className="font-display font-semibold text-foreground">Platform Fit Classification</h4>
      </div>

      {/* Top match */}
      {topLane && (
        <div className={cn(
          'rounded-lg p-4 border flex items-center gap-3',
          TV_LANE_COLORS[topLane.lane]
        )}>
          {(() => { const Icon = PLATFORM_ICONS[topLane.lane]; return <Icon className="h-5 w-5 shrink-0" />; })()}
          <div className="flex-1">
            <p className="font-display font-semibold">{TV_LANE_LABELS[topLane.lane]}</p>
            <p className="text-xs opacity-80 mt-0.5">{topLane.reasoning}</p>
          </div>
          <span className="text-lg font-display font-bold">{topLane.score}%</span>
        </div>
      )}

      {/* Other lanes */}
      <div className="grid grid-cols-2 gap-2">
        {scores.slice(1).map(s => {
          const Icon = PLATFORM_ICONS[s.lane];
          return (
            <div key={s.lane} className="glass-card rounded-lg p-3 flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{TV_LANE_LABELS[s.lane]}</p>
              </div>
              <span className={cn(
                'text-sm font-bold',
                s.score >= 30 ? 'text-foreground' : 'text-muted-foreground'
              )}>{s.score}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

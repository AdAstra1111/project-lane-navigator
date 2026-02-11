import { useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';

export function RenewalProbabilityPanel({
  subformat,
  genres,
  budgetRange,
  cast,
  hods,
  storyEngineScore,
}: {
  subformat?: string;
  genres: string[];
  budgetRange: string;
  cast: ProjectCastMember[];
  hods: ProjectHOD[];
  storyEngineScore?: number;
}) {
  const result = useMemo(() => {
    let score = 0;
    const factors: { label: string; impact: 'positive' | 'neutral' | 'negative'; note: string }[] = [];

    // Subformat
    if (subformat === 'returning') {
      score += 15;
      factors.push({ label: 'Returning format', impact: 'positive', note: 'Built for multi-season' });
    } else if (subformat === 'anthology') {
      score += 10;
      factors.push({ label: 'Anthology format', impact: 'neutral', note: 'Season reset possible' });
    } else {
      score += 5;
      factors.push({ label: 'Limited series', impact: 'negative', note: 'Single season by design' });
    }

    // Story engine
    if (storyEngineScore != null) {
      if (storyEngineScore >= 70) {
        score += 25;
        factors.push({ label: 'Strong story engine', impact: 'positive', note: `Engine score: ${storyEngineScore}` });
      } else if (storyEngineScore >= 40) {
        score += 15;
        factors.push({ label: 'Moderate story engine', impact: 'neutral', note: `Engine score: ${storyEngineScore}` });
      } else {
        score += 5;
        factors.push({ label: 'Weak story engine', impact: 'negative', note: 'Risk of premise exhaustion' });
      }
    }

    // Genre renewal rates
    const g = genres.map(x => x.toLowerCase());
    if (g.includes('crime') || g.includes('thriller')) {
      score += 15;
      factors.push({ label: 'Crime/Thriller genre', impact: 'positive', note: 'High renewal rate historically' });
    }
    if (g.includes('drama')) {
      score += 10;
      factors.push({ label: 'Drama genre', impact: 'neutral', note: 'Moderate renewal correlation' });
    }
    if (g.includes('comedy')) {
      score += 12;
      factors.push({ label: 'Comedy genre', impact: 'positive', note: 'Strong catalogue value' });
    }

    // Budget efficiency
    if (budgetRange === 'under-500k-ep' || budgetRange === '500k-2m-ep') {
      score += 10;
      factors.push({ label: 'Cost efficient', impact: 'positive', note: 'Low risk for platform renewal' });
    } else if (budgetRange === '10m-plus-ep') {
      score += 3;
      factors.push({ label: 'High per-episode cost', impact: 'negative', note: 'Requires exceptional performance' });
    } else {
      score += 7;
    }

    // Talent lock
    const attachedCast = cast.filter(c => c.status === 'attached' || c.status === 'confirmed');
    if (attachedCast.length >= 2) {
      score += 10;
      factors.push({ label: 'Cast attached', impact: 'positive', note: `${attachedCast.length} confirmed` });
    }

    // Showrunner
    const showrunner = hods.find(h =>
      ['Showrunner', 'Creator'].includes(h.department) &&
      (h.status === 'attached' || h.status === 'confirmed')
    );
    if (showrunner) {
      score += 10;
      factors.push({ label: 'Showrunner attached', impact: 'positive', note: showrunner.person_name });
    }

    score = Math.min(100, score);
    const tier = score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low';

    return { score, tier, factors };
  }, [subformat, genres, budgetRange, cast, hods, storyEngineScore]);

  const tierColor = result.tier === 'High' ? 'text-emerald-400' : result.tier === 'Moderate' ? 'text-amber-400' : 'text-red-400';
  const impactIcon = { positive: TrendingUp, neutral: Minus, negative: TrendingDown };
  const impactColor = { positive: 'text-emerald-400', neutral: 'text-muted-foreground', negative: 'text-red-400' };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-primary" />
        <h4 className="font-display font-semibold text-foreground">Renewal Probability</h4>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className={`text-4xl font-display font-bold ${tierColor}`}>{result.score}%</p>
          <p className="text-xs text-muted-foreground">{result.tier} Probability</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {result.factors.map((f, i) => {
            const Icon = impactIcon[f.impact];
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Icon className={`h-3 w-3 shrink-0 ${impactColor[f.impact]}`} />
                <span className="text-foreground font-medium">{f.label}</span>
                <span className="text-muted-foreground">— {f.note}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
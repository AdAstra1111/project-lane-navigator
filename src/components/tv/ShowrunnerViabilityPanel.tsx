import { useMemo } from 'react';
import { Crown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ProjectHOD } from '@/hooks/useProjectAttachments';

export function ShowrunnerViabilityPanel({ hods }: { hods: ProjectHOD[] }) {
  const assessment = useMemo(() => {
    const showrunnerDepts = ['Showrunner', 'Creator', 'Writer', 'Executive Producer'];
    const showrunnerCandidates = hods.filter(h =>
      showrunnerDepts.includes(h.department) &&
      (h.status === 'attached' || h.status === 'confirmed')
    );
    const allCandidates = hods.filter(h => showrunnerDepts.includes(h.department));

    const REPUTATION_WEIGHT: Record<string, number> = { marquee: 25, acclaimed: 20, established: 15, emerging: 8 };

    let score = 0;
    const strengths: string[] = [];
    const risks: string[] = [];

    if (showrunnerCandidates.length > 0) {
      const best = showrunnerCandidates.reduce((a, b) =>
        (REPUTATION_WEIGHT[a.reputation_tier] || 0) >= (REPUTATION_WEIGHT[b.reputation_tier] || 0) ? a : b
      );
      const repScore = REPUTATION_WEIGHT[best.reputation_tier] || 5;
      score += repScore;
      strengths.push(`${best.person_name} attached as ${best.department} (${best.reputation_tier})`);

      // Multi-role bonus
      if (showrunnerCandidates.length > 1) {
        score += 10;
        strengths.push(`${showrunnerCandidates.length} key creatives attached`);
      }

      // Known-for bonus
      if (best.known_for) {
        score += 15;
        strengths.push(`Track record: ${best.known_for}`);
      }

      // Status bonus
      if (best.status === 'confirmed') score += 10;
      
      // Agent/agency bonus
      if (best.agency) score += 5;

      score += 15; // base for having someone attached
    } else if (allCandidates.length > 0) {
      score += 10;
      risks.push('Showrunner identified but not yet attached');
    } else {
      risks.push('No showrunner or creator identified');
    }

    // Writer's room consideration
    const writers = hods.filter(h => h.department === 'Writer');
    if (writers.length >= 2) {
      score += 10;
      strengths.push(`Writer room forming (${writers.length} writers)`);
    }

    score = Math.min(100, score);

    const tier = score >= 70 ? 'Strong' : score >= 40 ? 'Developing' : 'Weak';

    return { score, tier, strengths, risks, showrunnerCandidates, allCandidates };
  }, [hods]);

  const tierColor = {
    Strong: 'text-emerald-400 border-emerald-500/30',
    Developing: 'text-amber-400 border-amber-500/30',
    Weak: 'text-red-400 border-red-500/30',
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Crown className="h-4 w-4 text-primary" />
        <h4 className="font-display font-semibold text-foreground">Showrunner Viability Index</h4>
      </div>

      <div className="flex items-center gap-4">
        <div className={`text-center glass-card rounded-lg p-4 border ${tierColor[assessment.tier as keyof typeof tierColor]}`}>
          <p className={`text-3xl font-display font-bold ${tierColor[assessment.tier as keyof typeof tierColor].split(' ')[0]}`}>
            {assessment.score}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{assessment.tier}</p>
        </div>
        <div className="flex-1 space-y-2">
          {assessment.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-foreground">{s}</span>
            </div>
          ))}
          {assessment.risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-foreground">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {assessment.score < 40 && (
        <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
          💡 Attach a showrunner or creator in the <strong>Packaging → Crew</strong> tab to strengthen platform interest.
        </p>
      )}
    </div>
  );
}
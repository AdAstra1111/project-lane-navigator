/**
 * DnaOutcomeAnalytics — Analytics readout for a DNA profile's Blueprint/Pitch outcomes.
 * Shows summary stats, mode comparison, blueprint performance table, and top outcomes.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TrendingUp, FlaskConical, Target, BarChart3, ExternalLink } from 'lucide-react';
import type { DnaProfile } from '@/hooks/useNarrativeDna';

interface Props {
  profile: DnaProfile;
}

interface RunSummary {
  id: string;
  created_at: string;
  optimizer_mode: string | null;
  candidate_count: number;
  blueprint_count: number;
  source_idea_ids: string[] | null;
}

interface CandidateSummary {
  run_id: string;
  promotion_status: string;
  score_total: number;
  score_market_heat: number;
  score_feasibility: number;
  score_lane_fit: number;
  score_saturation_risk: number;
  score_company_fit: number;
  genre: string;
  lane: string;
  format: string;
}

interface PitchOutcome {
  id: string;
  title: string;
  score_total: number | null;
  score_market_heat: number | null;
  score_feasibility: number | null;
  score_lane_fit: number | null;
  lane: string;
  genre: string;
  generation_mode: string | null;
  source_blueprint_id: string | null;
  source_blueprint_run_id: string | null;
  created_at: string;
}

function useOutcomeData(profileId: string) {
  // Fetch runs linked to this DNA
  const runsQuery = useQuery({
    queryKey: ['dna-outcome-runs', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('idea_blueprint_runs')
        .select('id, created_at, optimizer_mode, candidate_count, blueprint_count, source_idea_ids')
        .eq('source_dna_profile_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as RunSummary[];
    },
  });

  const runIds = runsQuery.data?.map(r => r.id) || [];

  // Fetch candidates for those runs
  const candidatesQuery = useQuery({
    queryKey: ['dna-outcome-candidates', profileId, runIds],
    queryFn: async () => {
      if (runIds.length === 0) return [];
      const { data, error } = await supabase
        .from('idea_blueprint_candidates')
        .select('run_id, promotion_status, score_total, score_market_heat, score_feasibility, score_lane_fit, score_saturation_risk, score_company_fit, genre, lane, format')
        .in('run_id', runIds);
      if (error) throw error;
      return (data || []) as CandidateSummary[];
    },
    enabled: runIds.length > 0,
  });

  // Fetch pitch ideas linked to this DNA
  const pitchQuery = useQuery({
    queryKey: ['dna-outcome-pitches', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pitch_ideas')
        .select('id, title, score_total, score_market_heat, score_feasibility, score_lane_fit, lane, genre, generation_mode, source_blueprint_id, source_blueprint_run_id, created_at')
        .eq('source_dna_profile_id', profileId)
        .order('score_total', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as PitchOutcome[];
    },
  });

  return {
    runs: runsQuery.data || [],
    candidates: candidatesQuery.data || [],
    pitches: pitchQuery.data || [],
    isLoading: runsQuery.isLoading || candidatesQuery.isLoading || pitchQuery.isLoading,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/80 p-3 text-center">
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

function ScorePill({ value, label }: { value: number; label: string }) {
  const color = value >= 90 ? 'text-emerald-400' : value >= 80 ? 'text-primary' : value >= 70 ? 'text-amber-400' : 'text-muted-foreground';
  return (
    <span className={`text-xs font-mono ${color}`} title={label}>
      {value.toFixed(1)}
    </span>
  );
}

export function DnaOutcomeAnalytics({ profile }: Props) {
  const { runs, candidates, pitches, isLoading } = useOutcomeData(profile.id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading outcome data…
      </div>
    );
  }

  const totalRuns = runs.length;
  const totalCandidates = candidates.length;
  const promotedCandidates = candidates.filter(c => c.promotion_status === 'promoted');
  const totalPromoted = pitches.length;

  // No data state
  if (totalRuns === 0 && totalPromoted === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No blueprint outcomes yet for this DNA.</p>
        <p className="text-[11px] text-muted-foreground/60">
          Run the CI Blueprint Engine with this DNA profile selected to generate outcome data.
        </p>
      </div>
    );
  }

  // Score aggregates
  const candidateScores = candidates.map(c => c.score_total);
  const avgTotal = avg(candidateScores);
  const avgMarket = avg(candidates.map(c => c.score_market_heat));
  const avgFeasibility = avg(candidates.map(c => c.score_feasibility));
  const avgLaneFit = avg(candidates.map(c => c.score_lane_fit));

  // Mode comparison
  const modes = new Map<string, CandidateSummary[]>();
  for (const c of candidates) {
    const run = runs.find(r => r.id === c.run_id);
    const mode = run?.optimizer_mode || 'ci_pattern';
    if (!modes.has(mode)) modes.set(mode, []);
    modes.get(mode)!.push(c);
  }

  // Per-run breakdown
  const runBreakdowns = runs.map(run => {
    const runCandidates = candidates.filter(c => c.run_id === run.id);
    const promoted = runCandidates.filter(c => c.promotion_status === 'promoted');
    const scores = runCandidates.map(c => c.score_total);
    return {
      ...run,
      candidateCount: runCandidates.length,
      promotedCount: promoted.length,
      avgTotal: avg(scores),
      avgMarket: avg(runCandidates.map(c => c.score_market_heat)),
      avgFeasibility: avg(runCandidates.map(c => c.score_feasibility)),
      avgLaneFit: avg(runCandidates.map(c => c.score_lane_fit)),
      sourceIdeaCount: run.source_idea_ids?.length || 0,
    };
  });

  // Lane/genre distributions
  const laneDistrib = new Map<string, number>();
  const genreDistrib = new Map<string, number>();
  for (const c of candidates) {
    laneDistrib.set(c.lane, (laneDistrib.get(c.lane) || 0) + 1);
    genreDistrib.set(c.genre, (genreDistrib.get(c.genre) || 0) + 1);
  }

  // Grounded summary sentence
  const summaryParts: string[] = [];
  summaryParts.push(`This DNA has ${totalRuns} blueprint run${totalRuns !== 1 ? 's' : ''}, ${totalCandidates} candidate${totalCandidates !== 1 ? 's' : ''}, and ${totalPromoted} promoted pitch idea${totalPromoted !== 1 ? 's' : ''}.`);
  if (modes.size > 1) {
    const dnaInformed = modes.get('dna_informed');
    const ciPattern = modes.get('ci_pattern');
    if (dnaInformed && ciPattern) {
      const dnaAvg = avg(dnaInformed.map(c => c.score_total));
      const ciAvg = avg(ciPattern.map(c => c.score_total));
      summaryParts.push(`DNA-informed runs average ${dnaAvg.toFixed(1)} CI vs ${ciAvg.toFixed(1)} for generic CI-pattern runs.`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Grounded Summary */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <TrendingUp className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-foreground space-y-0.5">
            {summaryParts.map((s, i) => <p key={i}>{s}</p>)}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Outcome Summary
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard label="Blueprint Runs" value={totalRuns} />
          <StatCard label="Candidates" value={totalCandidates} />
          <StatCard label="Promoted Ideas" value={totalPromoted} />
          <StatCard label="Avg CI" value={totalCandidates > 0 ? avgTotal.toFixed(1) : '—'} />
        </div>
        {totalCandidates > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            <StatCard label="Avg Market Heat" value={avgMarket.toFixed(1)} />
            <StatCard label="Avg Feasibility" value={avgFeasibility.toFixed(1)} />
            <StatCard label="Avg Lane Fit" value={avgLaneFit.toFixed(1)} />
          </div>
        )}
      </div>

      {/* Mode Comparison */}
      {modes.size > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Mode Comparison
          </h4>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] h-8">Mode</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Runs</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Candidates</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Promoted</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Avg CI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(modes.entries()).map(([mode, modeCandidates]) => {
                  const modeRuns = runs.filter(r => (r.optimizer_mode || 'ci_pattern') === mode);
                  const modePromoted = modeCandidates.filter(c => c.promotion_status === 'promoted');
                  const modeAvg = avg(modeCandidates.map(c => c.score_total));
                  return (
                    <TableRow key={mode}>
                      <TableCell className="text-xs py-2">
                        <Badge variant={mode === 'dna_informed' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                          {mode === 'dna_informed' ? '🧬 DNA-Informed' : mode === 'ci_pattern' ? '📊 CI Pattern' : mode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right py-2">{modeRuns.length}</TableCell>
                      <TableCell className="text-xs text-right py-2">{modeCandidates.length}</TableCell>
                      <TableCell className="text-xs text-right py-2">{modePromoted.length}</TableCell>
                      <TableCell className="text-xs text-right py-2 font-mono">
                        <ScorePill value={modeAvg} label="Avg CI" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Blueprint Run Performance */}
      {runBreakdowns.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Blueprint Run Performance
          </h4>
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] h-8">Date</TableHead>
                  <TableHead className="text-[11px] h-8">Mode</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Sources</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Cands</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Promoted</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">CI</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">MH</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">Feas</TableHead>
                  <TableHead className="text-[11px] h-8 text-right">LF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runBreakdowns.map(run => (
                  <TableRow key={run.id}>
                    <TableCell className="text-[11px] py-2 text-muted-foreground">
                      {new Date(run.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-[11px] py-2">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {run.optimizer_mode || 'ci_pattern'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[11px] text-right py-2">{run.sourceIdeaCount}</TableCell>
                    <TableCell className="text-[11px] text-right py-2">{run.candidateCount}</TableCell>
                    <TableCell className="text-[11px] text-right py-2">{run.promotedCount}</TableCell>
                    <TableCell className="text-[11px] text-right py-2">
                      {run.candidateCount > 0 ? <ScorePill value={run.avgTotal} label="CI" /> : '—'}
                    </TableCell>
                    <TableCell className="text-[11px] text-right py-2">
                      {run.candidateCount > 0 ? <ScorePill value={run.avgMarket} label="MH" /> : '—'}
                    </TableCell>
                    <TableCell className="text-[11px] text-right py-2">
                      {run.candidateCount > 0 ? <ScorePill value={run.avgFeasibility} label="Feas" /> : '—'}
                    </TableCell>
                    <TableCell className="text-[11px] text-right py-2">
                      {run.candidateCount > 0 ? <ScorePill value={run.avgLaneFit} label="LF" /> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Top Pitch Idea Outcomes */}
      {pitches.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Top Pitch Idea Outcomes
          </h4>
          <div className="space-y-1.5">
            {pitches.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border/30 bg-card/60 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{p.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{p.lane}</Badge>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{p.genre}</Badge>
                    {p.generation_mode && (
                      <Badge variant={p.generation_mode === 'dna_informed' ? 'default' : 'secondary'} className="text-[9px] px-1 py-0">
                        {p.generation_mode === 'dna_informed' ? '🧬' : '📊'} {p.generation_mode}
                      </Badge>
                    )}
                    {p.source_blueprint_id && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/30 text-emerald-400">
                        <FlaskConical className="h-2.5 w-2.5 mr-0.5" />
                        Blueprint
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-mono text-foreground">
                    {p.score_total != null ? p.score_total.toFixed(0) : '—'}
                  </div>
                  <div className="text-[9px] text-muted-foreground">CI</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Distribution Breakouts */}
      {totalCandidates > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Lane Distribution
            </h4>
            <div className="space-y-1">
              {Array.from(laneDistrib.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([lane, count]) => (
                  <div key={lane} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{lane}</span>
                    <span className="font-mono text-foreground">{count}</span>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Genre Distribution
            </h4>
            <div className="space-y-1">
              {Array.from(genreDistrib.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([genre, count]) => (
                  <div key={genre} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{genre}</span>
                    <span className="font-mono text-foreground">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

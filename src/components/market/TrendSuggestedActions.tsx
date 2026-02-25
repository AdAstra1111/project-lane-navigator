/**
 * Suggested Actions panel — heuristic-driven actionable trend recommendations
 * based on creative drift metrics and signal saturation.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, ChevronDown, Check, X, Zap, ShieldAlert, Gauge, Shuffle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { saveProjectLaneRulesetPrefs } from '@/lib/rulesets/uiState';
import {
  STYLE_BENCHMARK_LABELS,
  PACING_FEEL_LABELS,
  type StyleBenchmark,
  type PacingFeel,
} from '@/lib/rulesets/styleBenchmarks';
import type { CreativeDriftData, DriftMetrics } from '@/hooks/useProjectCreativeDrift';
import type { TrendSignal } from '@/hooks/useTrends';

export interface SuggestedAction {
  id: string;
  title: string;
  rationale: string;
  severity: 'info' | 'warn' | 'critical';
  icon: typeof Lightbulb;
  apply: () => Promise<void>;
}

const SEVERITY_STYLES: Record<string, string> = {
  info:     'border-primary/30 bg-primary/5',
  warn:     'border-amber-500/30 bg-amber-500/5',
  critical: 'border-red-500/30 bg-red-500/5',
};

const FEEL_ORDER: PacingFeel[] = ['calm', 'standard', 'punchy', 'frenetic'];

// Benchmarks grouped by "cluster" for differentiation suggestions
const BENCHMARK_ALTERNATIVES: Record<string, StyleBenchmark[]> = {
  soap_melodrama:        ['workplace_power_games', 'prestige_intimate', 'kdrama_romance'],
  glossy_comedy:         ['romantic_banter', 'youth_aspirational', 'satire_systems'],
  action_pulse:          ['thriller_mystery', 'workplace_power_games'],
  romantic_banter:       ['kdrama_romance', 'prestige_intimate'],
  kdrama_romance:        ['romantic_banter', 'prestige_intimate', 'workplace_power_games'],
  workplace_power_games: ['satire_systems', 'thriller_mystery', 'prestige_intimate'],
  thriller_mystery:      ['workplace_power_games', 'prestige_intimate'],
  prestige_intimate:     ['kdrama_romance', 'satire_systems'],
  youth_aspirational:    ['glossy_comedy', 'romantic_banter'],
  satire_systems:        ['workplace_power_games', 'prestige_intimate'],
};

interface Props {
  projectId: string;
  lane: string;
  driftData: CreativeDriftData;
  signals: TrendSignal[];
  projectGenres: string[];
}

export function TrendSuggestedActions({ projectId, lane, driftData, signals, projectGenres }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const actions = useMemo(() => {
    const result: SuggestedAction[] = [];
    const { drift, benchmark, feel, prefs } = driftData;

    const applyPrefsUpdate = async (updates: Record<string, any>) => {
      if (!user) { toast.error('Not authenticated'); return; }
      const newPrefs = { ...prefs, ...updates };
      await saveProjectLaneRulesetPrefs(projectId, lane, newPrefs, user.id);
      queryClient.invalidateQueries({ queryKey: ['creative-drift', projectId, lane] });
      toast.success('Preference updated');
    };

    // 1) Melodrama too high → suggest lower feel
    if (drift && drift.melodrama_score > 0.62) {
      const currentIdx = FEEL_ORDER.indexOf(feel);
      if (currentIdx > 0) {
        const suggestedFeel = FEEL_ORDER[currentIdx - 1];
        result.push({
          id: 'lower-feel',
          title: `Switch to ${PACING_FEEL_LABELS[suggestedFeel]} pacing`,
          rationale: `Melodrama score is ${(drift.melodrama_score * 100).toFixed(0)}% (threshold: 62%). A calmer pacing feel reduces emotional overload.`,
          severity: drift.melodrama_score > 0.75 ? 'critical' : 'warn',
          icon: Gauge,
          apply: () => applyPrefsUpdate({ pacing_feel: suggestedFeel }),
        });
      }
    }

    // 2) Similarity risk high → suggest switch benchmark + auto_diversify
    if (drift && drift.similarity_risk > 0.55) {
      const alts = BENCHMARK_ALTERNATIVES[benchmark] || ['prestige_intimate', 'workplace_power_games'];
      const suggestedBenchmark = alts[0];
      const suggestedName = STYLE_BENCHMARK_LABELS[suggestedBenchmark]?.name || suggestedBenchmark;

      result.push({
        id: 'switch-benchmark',
        title: `Switch to ${suggestedName} benchmark`,
        rationale: `Similarity risk is ${(drift.similarity_risk * 100).toFixed(0)}% (threshold: 55%). A different creative archetype will help differentiate your output.`,
        severity: drift.similarity_risk > 0.7 ? 'critical' : 'warn',
        icon: Shuffle,
        apply: () => applyPrefsUpdate({ style_benchmark: suggestedBenchmark }),
      });

      if (!prefs.auto_diversify) {
        result.push({
          id: 'enable-diversify',
          title: 'Enable auto-diversify',
          rationale: 'Automatically varies conflict modes and story engines across runs to reduce similarity risk.',
          severity: 'info',
          icon: Zap,
          apply: () => applyPrefsUpdate({ auto_diversify: true }),
        });
      }
    }

    // 3) Saturated signals matching project → suggest differentiation
    const genresLower = projectGenres.map(g => g.toLowerCase());
    const saturatedMatches = signals.filter(s =>
      s.saturation_risk === 'High' &&
      (s.cycle_phase === 'Peaking' || s.cycle_phase === 'Declining') &&
      s.genre_tags?.some(gt => genresLower.some(pg => gt.toLowerCase().includes(pg)))
    );

    if (saturatedMatches.length > 0) {
      const topSaturated = saturatedMatches[0];
      result.push({
        id: 'differentiate-saturated',
        title: `Differentiate from "${topSaturated.name}"`,
        rationale: `This ${topSaturated.cycle_phase} signal has high saturation risk. Consider adjusting your genre positioning or adding unique narrative devices.`,
        severity: 'warn',
        icon: ShieldAlert,
        apply: async () => {
          toast.info('Review your forbidden moves and comps to differentiate from saturated trends.');
        },
      });
    }

    // 4) Vertical drama with too-slow pacing
    if (lane === 'vertical_drama' && driftData.benchmarkDefaults.beats_per_minute.target < 2.5) {
      result.push({
        id: 'fix-slow-vertical',
        title: 'Apply Punchy preset for vertical drama',
        rationale: `Target BPM ${driftData.benchmarkDefaults.beats_per_minute.target} is below the minimum for vertical drama. Punchy ensures scroll-stopping cadence.`,
        severity: 'critical',
        icon: Zap,
        apply: () => applyPrefsUpdate({ pacing_feel: 'punchy' }),
      });
    }

    // 5) Hard failures present
    if (drift && drift.hard_failures.length > 0) {
      result.push({
        id: 'address-failures',
        title: `Address ${drift.hard_failures.length} hard failure(s)`,
        rationale: `Last quality run flagged: ${drift.hard_failures.join(', ')}. Review your engine profile and forbidden moves.`,
        severity: 'critical',
        icon: ShieldAlert,
        apply: async () => {
          toast.info('Navigate to World Rules to review hard failures and adjust your engine profile.');
        },
      });
    }

    return result;
  }, [driftData, signals, projectGenres, projectId, lane, user, queryClient]);

  if (actions.length === 0) return null;

  const handleApply = async (action: SuggestedAction) => {
    try {
      await action.apply();
      setAppliedIds(prev => new Set(prev).add(action.id));
    } catch {
      toast.error('Failed to apply action');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl overflow-hidden"
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-400" />
          <h3 className="font-display font-semibold text-foreground text-sm">Suggested Actions</h3>
          <Badge variant="secondary" className="text-xs ml-1">{actions.length}</Badge>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-2">
              {actions.map(action => {
                const applied = appliedIds.has(action.id);
                const Icon = action.icon;
                return (
                  <div
                    key={action.id}
                    className={cn(
                      'rounded-lg border p-3 transition-all',
                      applied ? 'border-emerald-500/30 bg-emerald-500/5 opacity-60' : SEVERITY_STYLES[action.severity]
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', {
                        'text-primary': action.severity === 'info',
                        'text-amber-400': action.severity === 'warn',
                        'text-red-400': action.severity === 'critical',
                      })} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{action.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{action.rationale}</p>
                      </div>
                      {applied ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] shrink-0">
                          <Check className="h-3 w-3 mr-1" /> Applied
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs shrink-0"
                          onClick={() => handleApply(action)}
                        >
                          Apply
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

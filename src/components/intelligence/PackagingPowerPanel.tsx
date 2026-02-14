/**
 * Packaging Power panel — displays role gravity scores with sub-scores,
 * weights, mode+stage badges, rewrite levers, stage recommendations,
 * and finance guidance.
 */
import { useMemo } from 'react';
import { Target, ChevronDown, Flame, Settings2, Info, ArrowUpRight, Milestone, FileText, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PackagingModeSelector } from '@/components/PackagingModeSelector';
import {
  type PackagingMode,
  type PackagingStage,
  type SubScores,
  type RoleGravityResult,
  PACKAGING_MODE_LABELS,
  PACKAGING_STAGE_LABELS,
  computeRoleGravity,
  getRewriteLevers,
  getFinanceMultipliers,
  getStageRecommendations,
  getStageFinanceGuidance,
} from '@/lib/role-gravity-engine';

interface RoleInput {
  character: string;
  role_type: string;
  sub_scores: SubScores;
}

interface Props {
  projectId: string;
  packagingMode: PackagingMode;
  packagingStage: PackagingStage;
  roles: RoleInput[];
}

const SUB_SCORE_LABELS: Record<keyof SubScores, string> = {
  presence: 'Presence',
  emotional_range: 'Emotional Range',
  transformation: 'Transformation',
  moral_conflict: 'Moral Conflict',
  agency: 'Agency',
  actor_moments: 'Actor Moments',
};

const scoreColor = (s: number) =>
  s >= 7 ? 'text-emerald-400' : s >= 5 ? 'text-amber-400' : 'text-red-400';

const multiplierColor = (m: 'low' | 'medium' | 'high') =>
  m === 'high' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
  : m === 'medium' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
  : 'text-muted-foreground border-muted bg-muted/20';

const STAGE_ICONS: Record<PackagingStage, typeof FileText> = {
  early_dev: FileText,
  packaging_now: ClipboardCheck,
  pre_market: ClipboardCheck,
  financing_live: AlertTriangle,
  post_greenlight: AlertTriangle,
};

export function PackagingPowerPanel({ projectId, packagingMode, packagingStage, roles }: Props) {
  const results: RoleGravityResult[] = useMemo(() =>
    roles.map(r => computeRoleGravity(r.character, r.role_type, r.sub_scores, packagingMode, packagingStage)),
    [roles, packagingMode, packagingStage],
  );

  const levers = useMemo(() => getRewriteLevers(packagingMode, packagingStage), [packagingMode, packagingStage]);
  const financeMultipliers = useMemo(() => getFinanceMultipliers(packagingMode), [packagingMode]);
  const stageRecs = useMemo(() => getStageRecommendations(packagingStage), [packagingStage]);
  const financeGuidance = useMemo(() => getStageFinanceGuidance(packagingStage), [packagingStage]);

  const avgScore = results.length
    ? Math.round((results.reduce((s, r) => s + r.weighted_score, 0) / results.length) * 10) / 10
    : 0;

  const StageIcon = STAGE_ICONS[packagingStage];

  return (
    <div className="space-y-4">
      {/* Mode + Stage badges + selectors */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">Packaging Power</h4>
          <Badge variant="outline" className="text-[10px]">
            {PACKAGING_MODE_LABELS[packagingMode]}
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1">
            <Milestone className="h-2.5 w-2.5" />
            {PACKAGING_STAGE_LABELS[packagingStage]}
          </Badge>
        </div>
        <PackagingModeSelector
          projectId={projectId}
          currentMode={packagingMode}
          currentStage={packagingStage}
        />
      </div>

      {/* Role Gravity Table */}
      {results.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Role Gravity Scores</span>
            <span className={`text-sm font-display font-bold ${scoreColor(avgScore)}`}>
              Avg: {avgScore}<span className="text-xs text-muted-foreground">/10</span>
            </span>
          </div>

          {results.map((role, i) => (
            <Collapsible key={i}>
              <div className="bg-muted/20 rounded-lg p-3">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{role.character}</span>
                      <Badge variant="secondary" className="text-[10px]">{role.role_type}</Badge>
                      {role.weighted_score >= 7 && packagingStage === 'packaging_now' && (
                        <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10">Star Driver</Badge>
                      )}
                      {role.weighted_score >= 5 && role.weighted_score < 7 && packagingStage === 'packaging_now' && (
                        <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 bg-amber-500/10">Supporting Heat</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-display font-bold ${scoreColor(role.weighted_score)}`}>
                        {role.weighted_score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                    </div>
                  </div>
                </CollapsibleTrigger>
                <Progress value={role.weighted_score * 10} className="h-1 mt-2" />

                <CollapsibleContent>
                  <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Info className="h-2.5 w-2.5" /> Sub-scores × Final Weights ({PACKAGING_MODE_LABELS[packagingMode]} + {PACKAGING_STAGE_LABELS[packagingStage]})
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {(Object.keys(role.sub_scores) as (keyof SubScores)[]).map(key => (
                        <div key={key} className="text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{SUB_SCORE_LABELS[key]}</span>
                            <span className="font-mono">
                              {role.sub_scores[key]} × {role.weights_used[key].toFixed(3)}
                            </span>
                          </div>
                          <Progress value={role.sub_scores[key] * 10} className="h-0.5 mt-0.5" />
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Mode: <span className="text-foreground">{role.mode_used}</span> · Stage: <span className="text-foreground">{role.stage_used}</span>
                    </p>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No role data available. Run Packaging Intelligence or add character data to see Role Gravity scores.
        </p>
      )}

      {/* Stage-Specific Recommendations */}
      <div className="glass-card rounded-lg p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <StageIcon className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {PACKAGING_STAGE_LABELS[packagingStage]} — Recommendations
          </span>
        </div>
        <div className="space-y-4">
          {stageRecs.map((rec, i) => (
            <div key={i}>
              <p className="text-xs font-medium text-foreground mb-1.5">{rec.heading}</p>
              <div className="space-y-1">
                {rec.items.map((item, j) => (
                  <div key={j} className="flex items-start gap-2 text-xs">
                    <span className="text-primary mt-0.5 shrink-0">•</span>
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rewrite Levers */}
      <div className="glass-card rounded-lg p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Flame className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Rewrite Levers — {PACKAGING_MODE_LABELS[packagingMode]}
          </span>
          <Badge variant="outline" className="text-[9px] ml-auto">
            Prioritized for {PACKAGING_STAGE_LABELS[packagingStage]}
          </Badge>
        </div>
        <div className="space-y-2">
          {levers.map((lever, i) => (
            <div key={i} className="flex items-start gap-2">
              <ArrowUpRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-medium text-foreground">{lever.area}</span>
                <p className="text-xs text-muted-foreground">{lever.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Finance Guidance */}
      <div className="glass-card rounded-lg p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Finance Signals</span>
        </div>

        {/* Stage-specific guidance */}
        <div className="bg-muted/20 rounded-lg p-3 mb-3">
          <p className="text-xs font-medium text-foreground mb-1">{financeGuidance.label}</p>
          <p className="text-xs text-muted-foreground">{financeGuidance.guidance}</p>
        </div>

        {/* Mode multipliers */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(financeMultipliers).map(([key, level]) => (
            <div key={key}>
              <span className="text-[10px] text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
              <Badge variant="outline" className={`mt-0.5 text-[10px] block w-fit ${multiplierColor(level)}`}>
                {level}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

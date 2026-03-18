/**
 * ConvergencePanel — Convergence scores, sparkline, tiered notes, and
 * unified manual-decision-state guidance with actionable CTAs.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart3, AlertTriangle, Info, CircleCheck, ShieldAlert, Lightbulb, Sparkles, Shield, Target } from 'lucide-react';
import { computeManualDecisionState, type ManualDecisionInput, type ManualActionKey, recommendationToActionKey } from '@/lib/manualDecisionState';

interface ConvergencePanelProps {
  latestAnalysis: any;
  convergenceHistory: any[];
  convergenceStatus: string;
  tieredNotes: { blockers: any[]; high: any[]; polish: any[] };
  versionMetaJson?: { ci?: number; gp?: number; [key: string]: any } | null;
  versionLabel?: string | null;
  /** Current version number for discipline mode resolution */
  versionNumber?: number;
  /** Callback when operator clicks a recommended CTA */
  onAction?: (action: ManualActionKey) => void;
  isLoading?: boolean;
}

function Sparkline({ history }: { history: any[] }) {
  if (history.length < 2) return null;
  const w = 200, h = 40, pad = 4;
  const ciPts = history.map(h => Number(h.creative_score));
  const gpPts = history.map(h => Number(h.greenlight_score));
  const all = [...ciPts, ...gpPts];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 100);
  const range = max - min || 1;

  const toPath = (pts: number[]) => pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={toPath(ciPts)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
      <path d={toPath(gpPts)} fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
    </svg>
  );
}

const SEVERITY_STYLES = {
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  muted: 'bg-muted/20 text-muted-foreground border-border/30',
} as const;

const SEVERITY_ICONS = {
  success: <CircleCheck className="h-3 w-3" />,
  warning: <AlertTriangle className="h-3 w-3" />,
  destructive: <AlertTriangle className="h-3 w-3" />,
  muted: <Info className="h-3 w-3" />,
};

const CTA_VARIANT: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  success: 'default',
  warning: 'default',
  destructive: 'destructive',
  muted: 'secondary',
};

export function ConvergencePanel({ latestAnalysis, convergenceHistory, convergenceStatus, tieredNotes, versionMetaJson, versionLabel, versionNumber, onAction, isLoading }: ConvergencePanelProps) {
  const metaCi = typeof versionMetaJson?.ci === 'number' ? versionMetaJson.ci : null;
  const metaGp = typeof versionMetaJson?.gp === 'number' ? versionMetaJson.gp : null;
  const analysisCi = latestAnalysis?.ci_score || latestAnalysis?.scores?.ci_score || 0;
  const analysisGp = latestAnalysis?.gp_score || latestAnalysis?.scores?.gp_score || 0;
  const ci = metaCi ?? analysisCi;
  const gp = metaGp ?? analysisGp;

  const isSelectiveRewrite = !!(versionLabel && /selective scene rewrite/i.test(versionLabel));
  const gap = Math.abs(ci - gp);

  // Compute unified manual decision state
  const decisionInput: ManualDecisionInput = {
    ci, gp,
    convergenceStatus,
    blockerCount: tieredNotes.blockers.length,
    majorNoteCount: tieredNotes.high.length,
    minorNoteCount: tieredNotes.polish.length,
  };
  const decision = computeManualDecisionState(decisionInput);
  const badgeStyle = SEVERITY_STYLES[decision.severity];

  return (
    <Card>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" /> Convergence
          </CardTitle>
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${badgeStyle}`}>
            {SEVERITY_ICONS[decision.severity]}
            <span className="ml-0.5">{decision.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Scores row */}
        {latestAnalysis && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Creative Integrity</p>
                <p className="text-lg font-display font-bold text-foreground">{ci}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Greenlight Prob.</p>
                <p className="text-lg font-display font-bold text-foreground">{gp}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Gap</p>
                <p className={`text-lg font-display font-bold ${
                  decision.severity === 'success' ? 'text-emerald-400' :
                  decision.severity === 'warning' ? 'text-amber-400' : 'text-muted-foreground'
                }`}>{gap}</p>
              </div>
            </div>
            {isSelectiveRewrite && (
              <p className="text-[8px] text-muted-foreground/60 text-center italic -mt-1">
                Scores reflect full merged document (selective rewrite)
              </p>
            )}
          </>
        )}

        {/* Sparkline */}
        <Sparkline history={convergenceHistory} />

        {/* ═══ Discipline Mode Indicator ═══ */}
        {decision.disciplineMode && decision.disciplineMode !== 'full_rewrite' && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-semibold uppercase tracking-wider ${
            decision.disciplineMode === 'late_stage_patch'
              ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
              : 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
          }`}>
            {decision.disciplineMode === 'late_stage_patch' ? (
              <>
                <Shield className="h-3 w-3" />
                Patch Mode — Protecting Stable Material
              </>
            ) : (
              <>
                <Target className="h-3 w-3" />
                Selective Rewrite — Targeted Scope
              </>
            )}
          </div>
        )}

        {/* ═══ Recommended Next Action ═══ */}
        <div className={`p-2.5 rounded border ${badgeStyle} space-y-2`}>
          <p className="text-[10px] font-semibold">{decision.explanation}</p>
          {onAction && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={CTA_VARIANT[decision.severity]}
                className="flex-1 text-xs h-7"
                onClick={() => onAction(recommendationToActionKey(decision.recommendation))}
                disabled={isLoading}
              >
                {decision.ctaText}
              </Button>
              {decision.secondaryCtaText && decision.secondaryAction && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => onAction(recommendationToActionKey(decision.secondaryAction!))}
                  disabled={isLoading}
                >
                  {decision.secondaryCtaText}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ═══ Tiered Issue Sections ═══ */}

        {/* A. Must Fix — Blockers */}
        {tieredNotes.blockers.length > 0 && (
          <div className="p-2 rounded bg-destructive/10 border border-destructive/20 space-y-1">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3 text-destructive" />
              <p className="text-[9px] font-bold text-destructive uppercase tracking-wider">
                Must Fix · {tieredNotes.blockers.length} Blocker{tieredNotes.blockers.length !== 1 ? 's' : ''}
              </p>
            </div>
            {tieredNotes.blockers.map((b: any, i: number) => (
              <p key={i} className="text-[9px] text-destructive/80 pl-4">• {b.description || b}</p>
            ))}
          </div>
        )}

        {/* B. Strategic / High Impact */}
        {tieredNotes.high.length > 0 && (
          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 space-y-1">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="h-3 w-3 text-amber-400" />
              <p className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
                Strategic · {tieredNotes.high.length} Note{tieredNotes.high.length !== 1 ? 's' : ''}
              </p>
            </div>
            {tieredNotes.high.map((n: any, i: number) => (
              <p key={i} className="text-[9px] text-amber-400/80 pl-4">• {n.description || n}</p>
            ))}
          </div>
        )}

        {/* C. Optional Polish */}
        {tieredNotes.polish.length > 0 && (
          <div className="p-2 rounded bg-muted/30 border border-border/30 space-y-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-muted-foreground" />
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                Optional Polish · {tieredNotes.polish.length} Note{tieredNotes.polish.length !== 1 ? 's' : ''}
              </p>
            </div>
            {tieredNotes.polish.map((n: any, i: number) => (
              <p key={i} className="text-[9px] text-muted-foreground/80 pl-4">• {n.description || n}</p>
            ))}
          </div>
        )}

        {/* All clear indicator */}
        {tieredNotes.blockers.length === 0 && tieredNotes.high.length === 0 && tieredNotes.polish.length === 0 && (
          <div className="flex items-center gap-1.5 text-[9px] text-emerald-400">
            <CircleCheck className="h-3 w-3" />
            <span>No outstanding issues</span>
          </div>
        )}

        {/* Executive snapshot */}
        {latestAnalysis?.executive_snapshot && (
          <p className="text-[9px] text-muted-foreground italic">{latestAnalysis.executive_snapshot}</p>
        )}

        {/* Summary bullets */}
        {latestAnalysis?.summary && (
          <div className="space-y-0.5">
            {(latestAnalysis.summary as string[]).slice(0, 3).map((s: string, i: number) => (
              <p key={i} className="text-[9px] text-muted-foreground">• {s}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

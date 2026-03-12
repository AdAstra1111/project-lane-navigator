/**
 * NarrativeEssenceDriftPanel — Displays soul drift between authored and derived seeds.
 * Read-only. Fail-closed on missing data.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  XCircle,
  Fingerprint,
} from 'lucide-react';
import { useDevSeedDrift, type DevSeedDriftResult, type DimensionDetail } from '@/hooks/useDevSeedDrift';

interface Props {
  projectId: string | undefined;
  authoredSeedId: string | undefined;
  derivedSeedId: string | undefined;
}

const BAND_CONFIG: Record<string, { label: string; className: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  LOW:      { label: 'Low',      className: 'text-emerald-600 dark:text-emerald-400', variant: 'secondary' },
  MODERATE: { label: 'Moderate', className: 'text-amber-600 dark:text-amber-400',     variant: 'outline' },
  HIGH:     { label: 'High',     className: 'text-orange-600 dark:text-orange-400',    variant: 'default' },
  CRITICAL: { label: 'Critical', className: 'text-destructive',                        variant: 'destructive' },
};

const DIMENSIONS: { key: string; label: string; scoreKey: keyof DevSeedDriftResult }[] = [
  { key: 'premise',      label: 'Premise Kernel',        scoreKey: 'premise_drift_score' },
  { key: 'emotional',    label: 'Emotional Promise',     scoreKey: 'emotional_drift_score' },
  { key: 'theme',        label: 'Theme Vector',          scoreKey: 'theme_drift_score' },
  { key: 'beats',        label: 'Structural Beats',      scoreKey: 'beat_drift_score' },
  { key: 'axis_unit',    label: 'Axis / Unit Structure', scoreKey: 'axis_unit_drift_score' },
  { key: 'relationship', label: 'Relationship Core',     scoreKey: 'relationship_drift_score' },
];

function severityLabel(score: number): { text: string; dotClass: string } {
  if (score <= 0.25) return { text: 'aligned', dotClass: 'bg-emerald-500' };
  if (score <= 0.6)  return { text: 'partial drift', dotClass: 'bg-amber-500' };
  return { text: 'major drift', dotClass: 'bg-destructive' };
}

export function NarrativeEssenceDriftPanel({ projectId, authoredSeedId, derivedSeedId }: Props) {
  const { data, isLoading, error, load } = useDevSeedDrift(projectId);
  const [detailOpen, setDetailOpen] = useState(false);

  // Auto-load via effect — safe for StrictMode
  const [hasTriggered, setHasTriggered] = useState(false);

  // Reset trigger when seed IDs change
  useEffect(() => {
    setHasTriggered(false);
  }, [authoredSeedId, derivedSeedId]);

  useEffect(() => {
    if (!hasTriggered && projectId && authoredSeedId && derivedSeedId && !data && !isLoading && !error) {
      setHasTriggered(true);
      load(authoredSeedId, derivedSeedId);
    }
  }, [hasTriggered, projectId, authoredSeedId, derivedSeedId, data, isLoading, error, load]);

  // Empty state — missing seeds
  if (!authoredSeedId || !derivedSeedId) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Narrative Drift
        </h3>
        <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Narrative comparison unavailable — both authored and derived seeds are required.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Narrative Drift
        </h3>
        <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-3 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      </div>
    );
  }

  // Error — fail closed
  if (error) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Narrative Drift
        </h3>
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <div>
              <p className="text-xs font-medium text-destructive">Narrative Drift Unavailable</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Unable to compute seed comparison.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No data yet (shouldn't happen after trigger, but fail-closed)
  if (!data) return null;

  const bandCfg = BAND_CONFIG[data.drift_band] ?? BAND_CONFIG.MODERATE;
  const showBanner = data.drift_band === 'HIGH' || data.drift_band === 'CRITICAL';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Narrative Drift
      </h3>

      <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-3 space-y-3">
        {/* Top-level score + band */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Narrative Essence Drift</span>
          </div>
          <Badge variant={bandCfg.variant} className="text-[10px]">
            {bandCfg.label}
          </Badge>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold tabular-nums ${bandCfg.className}`}>
            {data.overall_soul_drift_score.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">Soul Drift Score</span>
        </div>

        {/* High/Critical banner */}
        {showBanner && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">
              Story essence has significantly diverged from the original narrative seed.
            </p>
          </div>
        )}

        {/* Dimension breakdown */}
        <div className="space-y-1">
          <h4 className="text-[11px] font-semibold text-muted-foreground">Dimension Breakdown</h4>
          <div className="border border-border/30 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 bg-muted/30">
                  <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Dimension</th>
                  <th className="text-right px-2 py-1.5 font-medium text-muted-foreground w-20">Score</th>
                  <th className="text-center px-2 py-1.5 font-medium text-muted-foreground w-28">Severity</th>
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map((dim) => {
                  const score = data[dim.scoreKey] as number;
                  const sev = severityLabel(score);
                  return (
                    <tr key={dim.key} className="border-b border-border/20 last:border-0">
                      <td className="px-2 py-1.5 text-foreground">{dim.label}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-foreground">
                        {score.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${sev.dotClass}`} />
                          <span className="text-muted-foreground">{sev.text}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Primary drift causes */}
        {data.primary_drift_causes.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold text-muted-foreground">Primary Drift Causes</h4>
            <ul className="space-y-0.5 pl-3">
              {data.primary_drift_causes.map((cause, i) => (
                <li key={i} className="text-xs text-foreground list-disc">{cause}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Restoration targets */}
        {data.restoration_targets.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold text-muted-foreground">Suggested Restoration Targets</h4>
            <ul className="space-y-0.5 pl-3">
              {data.restoration_targets.map((target, i) => (
                <li key={i} className="text-xs text-muted-foreground list-disc italic">{target}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Dimension detail panel */}
        {data.dimension_details && Object.keys(data.dimension_details).length > 0 && (
          <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer">
              {detailOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              View Detailed Comparison
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-2">
                {Object.entries(data.dimension_details).map(([dimKey, detail]) => (
                  <DimensionDetailCard key={dimKey} dimension={dimKey} detail={detail} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

/* ── Dimension Detail Card ── */

function DimensionDetailCard({ dimension, detail }: { dimension: string; detail: DimensionDetail }) {
  const sev = severityLabel(detail.drift_score);
  return (
    <div className="rounded-md border border-border/20 bg-card p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground capitalize">
          {dimension.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${sev.dotClass}`} />
          <span className="text-[10px] text-muted-foreground font-mono">{detail.drift_score.toFixed(2)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted text-foreground border border-border rounded-md p-2">
          <span className="text-[9px] font-semibold text-muted-foreground block mb-1">Authored</span>
          <span className="text-[11px] leading-relaxed whitespace-pre-wrap">
            {detail.authored != null ? (typeof detail.authored === 'string' ? detail.authored : JSON.stringify(detail.authored, null, 2)) : '(empty)'}
          </span>
        </div>
        <div className="bg-muted text-foreground border border-border rounded-md p-2">
          <span className="text-[9px] font-semibold text-muted-foreground block mb-1">Derived</span>
          <span className="text-[11px] leading-relaxed whitespace-pre-wrap">
            {detail.derived != null ? (typeof detail.derived === 'string' ? detail.derived : JSON.stringify(detail.derived, null, 2)) : '(empty)'}
          </span>
        </div>
      </div>
      {detail.notes && (
        <p className="text-[10px] text-muted-foreground italic">{detail.notes}</p>
      )}
    </div>
  );
}

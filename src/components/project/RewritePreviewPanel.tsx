/**
 * RewritePreviewPanel — Read-only selective regeneration plan viewer.
 * Shows what would change before any rewrite is executed.
 * Fail-closed: renders nothing if plan data unavailable.
 */

import { useState } from 'react';
import { useSelectiveRegenerationPlan, type RecommendedScope, type SourceUnit, type ImpactedScene } from '@/hooks/useSelectiveRegenerationPlan';
import { useSceneSluglines, type SluglineMap } from '@/hooks/useSceneSluglines';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, Zap, ArrowRight } from 'lucide-react';

interface Props {
  projectId: string | undefined;
}

const SCOPE_CONFIG: Record<RecommendedScope, { label: string; variant: 'secondary' | 'default' | 'destructive' | 'outline'; icon: typeof ShieldCheck }> = {
  no_risk:          { label: 'No Risk',          variant: 'secondary',    icon: ShieldCheck },
  propagated_only:  { label: 'Propagated Only',  variant: 'outline',      icon: ArrowRight },
  targeted_scenes:  { label: 'Targeted Scenes',  variant: 'default',      icon: Zap },
  broad_impact:     { label: 'Broad Impact',     variant: 'destructive',  icon: AlertTriangle },
};

const DEP_ORDER: Record<string, number> = { root: 0, upstream: 1, propagated: 2, terminal: 3 };

const INITIAL_SHOW = 8;

function sceneLabel(scene: ImpactedScene, sluglines: SluglineMap): string {
  const slug = sluglines.get(scene.scene_key);
  return slug ? `${scene.scene_key} — ${slug}` : scene.scene_key;
}

export function RewritePreviewPanel({ projectId }: Props) {
  const { data, isLoading } = useSelectiveRegenerationPlan(projectId);
  const { data: sluglines } = useSceneSluglines(projectId);
  const slugMap = sluglines ?? new Map<string, string>();

  const [showAllUnits, setShowAllUnits] = useState(false);
  const [showAllScenes, setShowAllScenes] = useState(false);

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // Fail-closed
  if (!data) return null;

  const scope = data.recommended_scope ?? 'no_risk';
  const scopeCfg = SCOPE_CONFIG[scope] ?? SCOPE_CONFIG.no_risk;
  const ScopeIcon = scopeCfg.icon;

  // ── No-risk calm state ──
  if (scope === 'no_risk') {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Rewrite Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              Story structure currently aligned — no regeneration required.
            </span>
          </div>
          {data.diagnostics && (
            <p className="mt-2 text-xs text-muted-foreground">{data.diagnostics}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Sort source units by dependency position
  const sortedUnits = [...(data.source_units || [])].sort(
    (a, b) => (DEP_ORDER[a.dependency_position] ?? 9) - (DEP_ORDER[b.dependency_position] ?? 9)
  );
  const visibleUnits = showAllUnits ? sortedUnits : sortedUnits.slice(0, INITIAL_SHOW);

  // Sort impacted scenes: direct first
  const sortedScenes = [...(data.impacted_scenes || [])].sort(
    (a, b) => (a.risk_source === 'direct' ? 0 : 1) - (b.risk_source === 'direct' ? 0 : 1)
  );
  const visibleScenes = showAllScenes ? sortedScenes : sortedScenes.slice(0, INITIAL_SHOW);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Rewrite Preview
          </CardTitle>
          <Badge variant={scopeCfg.variant} className="gap-1 text-xs">
            <ScopeIcon className="h-3 w-3" />
            {scopeCfg.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Plan Summary */}
        <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{data.impacted_scene_count}</span>
            <span className="text-muted-foreground">scene{data.impacted_scene_count !== 1 ? 's' : ''} impacted</span>
          </div>
          {data.rationale && (
            <p className="text-xs text-muted-foreground">{data.rationale}</p>
          )}
        </div>

        {/* Source Units */}
        {sortedUnits.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Units</h4>
            <div className="space-y-1">
              {visibleUnits.map((u, i) => (
                <SourceUnitRow key={u.unit_key + i} unit={u} />
              ))}
            </div>
            {sortedUnits.length > INITIAL_SHOW && (
              <button
                onClick={() => setShowAllUnits((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline pt-0.5"
              >
                {showAllUnits ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAllUnits ? 'Show less' : `Show all ${sortedUnits.length}`}
              </button>
            )}
          </div>
        )}

        {/* Axis Impact */}
        {(data.direct_axes?.length > 0 || data.propagated_axes?.length > 0) && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Axis Impact</h4>
            {data.direct_axes?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-destructive">Direct:</span>
                {data.direct_axes.map((a) => (
                  <Badge key={a} variant="outline" className="text-[11px] border-destructive/40 text-destructive">{a}</Badge>
                ))}
              </div>
            )}
            {data.propagated_axes?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Propagated:</span>
                {data.propagated_axes.map((a) => (
                  <Badge key={a} variant="outline" className="text-[11px] border-amber-500/40 text-amber-600 dark:text-amber-400">{a}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Impacted Scenes */}
        {sortedScenes.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impacted Scenes</h4>
            <div className="space-y-1">
              {visibleScenes.map((s, i) => (
                <div key={s.scene_key + i} className="flex items-center justify-between rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-xs">
                  <span className="text-foreground truncate mr-2">{sceneLabel(s, slugMap)}</span>
                  <Badge
                    variant={s.risk_source === 'direct' ? 'destructive' : 'outline'}
                    className={`text-[10px] shrink-0 ${s.risk_source !== 'direct' ? 'border-amber-500/40 text-amber-600 dark:text-amber-400' : ''}`}
                  >
                    {s.risk_source}
                  </Badge>
                </div>
              ))}
            </div>
            {sortedScenes.length > INITIAL_SHOW && (
              <button
                onClick={() => setShowAllScenes((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline pt-0.5"
              >
                {showAllScenes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAllScenes ? 'Show less' : `Show all ${sortedScenes.length}`}
              </button>
            )}
          </div>
        )}

        {/* Diagnostics */}
        {data.diagnostics && (
          <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{data.diagnostics}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Source Unit Row ── */

const DEP_COLORS: Record<string, string> = {
  root:       'border-destructive/40 text-destructive',
  upstream:   'border-amber-500/40 text-amber-600 dark:text-amber-400',
  propagated: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  terminal:   'border-border text-muted-foreground',
};

function SourceUnitRow({ unit }: { unit: SourceUnit }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-foreground truncate flex-1">{unit.unit_key}</span>
      {unit.axis && (
        <Badge variant="outline" className="text-[10px] shrink-0">{unit.axis}</Badge>
      )}
      <Badge variant="outline" className={`text-[10px] shrink-0 ${DEP_COLORS[unit.dependency_position] ?? ''}`}>
        {unit.dependency_position}
      </Badge>
      {unit.sequence_order != null && (
        <span className="text-[10px] text-muted-foreground shrink-0">#{unit.sequence_order}</span>
      )}
    </div>
  );
}

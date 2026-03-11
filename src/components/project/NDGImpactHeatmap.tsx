/**
 * NDGImpactHeatmap — Visual heatmap of narrative risk across scenes.
 * Renders scene cells colored by risk_source with tooltips, click interaction,
 * run overlay borders, and confidence badges.
 * All data from existing planner responses — no client-side NDG reconstruction.
 */

import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { ImpactedScene } from '@/hooks/useSelectiveRegenerationPlan';
import type { SluglineMap } from '@/hooks/useSceneSluglines';
import type { RegenerationRun } from '@/hooks/useRegenerationRunHistory';

interface Props {
  allScenes: ImpactedScene[];
  entityScenes: ImpactedScene[];
  slugMap: SluglineMap;
  latestRun: RegenerationRun | null;
  onSceneClick: (sceneKey: string, hasBeenRegenerated: boolean) => void;
}

type RiskSource = 'direct' | 'propagated' | 'entity_link' | 'entity_propagation';

const RISK_BG: Record<RiskSource, string> = {
  direct: 'bg-destructive',
  propagated: 'bg-amber-500',
  entity_link: 'bg-sky-500',
  entity_propagation: 'bg-violet-500',
};

const RISK_LABEL: Record<RiskSource, string> = {
  direct: 'Direct',
  propagated: 'Propagated',
  entity_link: 'Entity Link',
  entity_propagation: 'Entity Propagation',
};

function extractSceneNumber(key: string): number {
  const m = key.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function NDGImpactHeatmap({ allScenes, entityScenes, slugMap, latestRun, onSceneClick }: Props) {
  // Build a unified, deterministically ordered scene list
  const { orderedKeys, riskMap, axisMap } = useMemo(() => {
    const risk = new Map<string, RiskSource>();
    const axes = new Map<string, string[]>();

    for (const s of allScenes) {
      risk.set(s.scene_key, s.risk_source as RiskSource);
      if (s.axes?.length) axes.set(s.scene_key, s.axes);
    }
    for (const s of entityScenes) {
      if (!risk.has(s.scene_key)) {
        risk.set(s.scene_key, s.risk_source as RiskSource);
        if (s.axes?.length) axes.set(s.scene_key, s.axes);
      }
    }

    const keys = [...risk.keys()].sort((a, b) => extractSceneNumber(a) - extractSceneNumber(b));
    return { orderedKeys: keys, riskMap: risk, axisMap: axes };
  }, [allScenes, entityScenes]);

  // Latest run metadata
  const { completedSet, failedSet, confidenceMap } = useMemo(() => {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const confidence = new Map<string, string>();

    if (latestRun?.meta_json) {
      const meta = latestRun.meta_json as Record<string, any>;
      for (const k of (meta.completed_scene_keys as string[]) ?? []) completed.add(k);
      for (const k of (meta.failed_scene_keys as string[]) ?? []) failed.add(k);
      const bands = (meta.scene_confidence_bands as Record<string, string>) ?? {};
      for (const [k, v] of Object.entries(bands)) confidence.set(k, v);
    }
    return { completedSet: completed, failedSet: failed, confidenceMap: confidence };
  }, [latestRun]);

  if (orderedKeys.length === 0) {
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] text-muted-foreground uppercase font-medium">NDG Impact Heatmap</span>
        <p className="text-xs text-muted-foreground">No narrative risk detected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase font-medium">NDG Impact Heatmap</span>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-destructive" />Direct</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-500" />Propagated</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-sky-500" />Entity</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-violet-500" />Entity Prop</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <TooltipProvider>
          {orderedKeys.map(key => {
            const risk = riskMap.get(key) ?? 'direct';
            const bgClass = RISK_BG[risk] ?? 'bg-muted/30';
            const isCompleted = completedSet.has(key);
            const isFailed = failedSet.has(key);
            const hasRun = isCompleted || isFailed;
            const confidence = confidenceMap.get(key);
            const confidenceLabel = confidence === 'high' ? 'H' : confidence === 'medium' ? 'M' : confidence === 'low' ? 'L' : null;
            const slug = slugMap.get(key);
            const axes = axisMap.get(key);
            const num = key.replace(/\D/g, '');

            let borderClass = '';
            if (isCompleted) borderClass = 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background';
            else if (isFailed) borderClass = 'ring-2 ring-destructive ring-offset-1 ring-offset-background';

            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSceneClick(key, hasRun)}
                    className={`relative w-7 h-7 rounded text-[9px] font-mono font-medium transition-all text-white hover:ring-1 hover:ring-border ${bgClass} ${borderClass}`}
                  >
                    {num}
                    {confidenceLabel && (
                      <span className="absolute top-0 right-0 text-[7px] leading-none bg-background/80 text-foreground rounded-bl px-0.5">
                        {confidenceLabel}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs space-y-0.5 max-w-[220px]">
                  <div className="font-medium">{key}</div>
                  {slug && <div className="text-muted-foreground">{slug}</div>}
                  <div>Risk: <span className="font-medium">{RISK_LABEL[risk] ?? risk}</span></div>
                  {axes && axes.length > 0 && <div>Axis: {axes.join(', ')}</div>}
                  {hasRun && <div className={isCompleted ? 'text-emerald-500' : 'text-destructive'}>{isCompleted ? '✓ Completed' : '✗ Failed'}</div>}
                  {confidenceLabel && <div>Confidence: {confidence}</div>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
}

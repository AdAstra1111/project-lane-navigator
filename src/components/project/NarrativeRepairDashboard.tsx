/**
 * NarrativeRepairDashboard — Unified command surface for narrative repairs.
 * Consolidates planner diagnostics, scene impact map, execution controls,
 * run history, and diff access into a single dashboard.
 * Fail-closed: calm state when no risk; graceful degradation on errors.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { RepairStrategyPanel, type RepairLandingContext } from '@/components/project/RepairStrategyPanel';
import { useNarrativeRepairs, type NarrativeRepair } from '@/hooks/useNarrativeRepairs';
import { useSelectiveRegenerationPlan, type RepairStrategy, type RecommendedScope, type SourceUnit, type ImpactedScene } from '@/hooks/useSelectiveRegenerationPlan';
import { useExecuteSelectiveRegeneration, type RegenExecutionResult } from '@/hooks/useExecuteSelectiveRegeneration';
import { useSceneSluglines, type SluglineMap } from '@/hooks/useSceneSluglines';
import { useSceneVersionDiff } from '@/hooks/useSceneVersionDiff';
import { useRegenerationRunHistory, type RegenerationRun } from '@/hooks/useRegenerationRunHistory';
import { useNarrativeMonitor } from '@/hooks/useNarrativeMonitor';
import { SceneRewriteDiffViewer } from '@/components/project/SceneRewriteDiffViewer';
import { NDGImpactHeatmap } from '@/components/project/NDGImpactHeatmap';
import { AutopilotRepairPanel } from '@/components/project/AutopilotRepairPanel';
import { NarrativeSimulationPanel } from '@/components/project/NarrativeSimulationPanel';
import { NarrativeEssenceDriftPanel } from '@/components/project/NarrativeEssenceDriftPanel';
import { NarrativeDiagnosticsPanel } from '@/components/narrative/NarrativeDiagnosticsPanel';
import { NarrativeRepairQueuePanel } from '@/components/project/NarrativeRepairQueuePanel';
import { StoryIntelligencePanel } from '@/components/project/StoryIntelligencePanel';
import { ProjectHealthBriefingStrip } from '@/components/project/ProjectHealthBriefingStrip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Play,
  FlaskConical,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  GitCompare,
  RefreshCw,
  Zap,
  ArrowRight,
  Users,
  History,
  LayoutDashboard,
} from 'lucide-react';

interface Props {
  projectId: string | undefined;
  authoredSeedId?: string;
  derivedSeedId?: string;
}

/* ── Config ── */

const SCOPE_CONFIG: Record<RecommendedScope, { label: string; variant: 'secondary' | 'default' | 'destructive' | 'outline'; icon: typeof ShieldCheck }> = {
  no_risk:          { label: 'No Risk',          variant: 'secondary',    icon: ShieldCheck },
  propagated_only:  { label: 'Propagated Only',  variant: 'outline',      icon: ArrowRight },
  targeted_scenes:  { label: 'Targeted Scenes',  variant: 'default',      icon: Zap },
  broad_impact:     { label: 'Broad Impact',     variant: 'destructive',  icon: AlertTriangle },
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }> = {
  completed:       { label: 'Completed',       variant: 'default',     icon: CheckCircle2 },
  dry_run:         { label: 'Dry Run',         variant: 'secondary',   icon: FlaskConical },
  partial_failure: { label: 'Partial Failure', variant: 'outline',     icon: AlertTriangle },
  failed:          { label: 'Failed',          variant: 'destructive', icon: XCircle },
  abort:           { label: 'Aborted',         variant: 'destructive', icon: XCircle },
};

const DEP_ORDER: Record<string, number> = { root: 0, upstream: 1, propagated: 2, terminal: 3 };
const INITIAL_SHOW = 6;

function sceneLabel(key: string, slugMap: SluglineMap): string {
  const slug = slugMap.get(key);
  return slug ? `${key} — ${slug}` : key;
}

function sceneLabelFromImpacted(scene: ImpactedScene, slugMap: SluglineMap): string {
  const slug = slugMap.get(scene.scene_key);
  return slug ? `${scene.scene_key} — ${slug}` : scene.scene_key;
}

/* ── Main Dashboard ── */

export function NarrativeRepairDashboard({ projectId, authoredSeedId, derivedSeedId }: Props) {
  const [dashTab, setDashTab] = useState<'repairs' | 'strategy'>('repairs');
  const [repairStrategy, setRepairStrategy] = useState<RepairStrategy>('balanced');
  const { data: plan, isLoading: planLoading, refetch: refetchPlan } = useSelectiveRegenerationPlan(projectId, repairStrategy);
  const { execute, isExecuting, result, error, reset } = useExecuteSelectiveRegeneration(projectId);
  const { data: sluglines } = useSceneSluglines(projectId);
  const { data: runHistory, isLoading: historyLoading, refetch: refetchHistory } = useRegenerationRunHistory(projectId);
  const { data: monitorData, isLoading: monitorLoading, refresh: refreshMonitor } = useNarrativeMonitor(projectId);
  const diffHook = useSceneVersionDiff(projectId);
  const slugMap = sluglines ?? new Map<string, string>();
  const { data: allRepairs } = useNarrativeRepairs(projectId);

  // Compute completed repair signatures for advisory resolution indicators
  const completedRepairSignatures = useMemo(() => {
    if (!allRepairs) return new Set<string>();
    const sigs = new Set<string>();
    for (const r of allRepairs) {
      if (r.status !== 'completed') continue;
      if (r.repair_type) sigs.add(`repair_type::${r.repair_type}`);
      if (r.diagnostic_type) sigs.add(`diagnostic_type::${r.diagnostic_type}`);
      if (r.scope_key) sigs.add(`scope_key::${r.scope_key}`);
    }
    return sigs;
  }, [allRepairs]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffSceneIndex, setDiffSceneIndex] = useState(0);
  const [diffSceneKeys, setDiffSceneKeys] = useState<string[]>([]);
  const [repairLandingContext, setRepairLandingContext] = useState<RepairLandingContext | null>(null);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scene groups from plan
  const allScenes = plan?.impacted_scenes || [];
  const directScenes = allScenes.filter(s => s.risk_source === 'direct');
  const propagatedScenes = allScenes.filter(s => s.risk_source === 'propagated');
  const entityScenes = useMemo(() => {
    if ((plan?.entity_impacted_scenes?.length ?? 0) > 0) return plan!.entity_impacted_scenes!;
    return allScenes.filter(s => s.risk_source === 'entity_link');
  }, [plan, allScenes]);
  const entityCount = plan?.entity_impacted_scene_count ?? entityScenes.length;

  const completedKeysForDiff = result?.completed_scene_keys ?? [];

  const handleViewChanges = (sceneKey: string, keys: string[]) => {
    const idx = keys.indexOf(sceneKey);
    setDiffSceneKeys(keys);
    setDiffSceneIndex(idx >= 0 ? idx : 0);
    setDiffOpen(true);
    diffHook.loadDiff(sceneKey);
  };

  const handleDiffNavigate = (sceneKey: string) => {
    const idx = diffSceneKeys.indexOf(sceneKey);
    setDiffSceneIndex(idx >= 0 ? idx : 0);
    diffHook.loadDiff(sceneKey);
  };

  const handleRouteToRepairs = useCallback((ctx: RepairLandingContext) => {
    setRepairLandingContext(ctx);
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = setTimeout(() => setRepairLandingContext(null), 15000);
    setDashTab('repairs');
    setTimeout(() => {
      const el = document.getElementById('repair-queue-panel');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const refreshAfterExecution = useCallback(() => {
    refreshMonitor();
    refetchPlan();
    refetchHistory();
  }, [refreshMonitor, refetchPlan, refetchHistory]);

  const handleDryRun = useCallback(async () => {
    reset();
    await execute(true, repairStrategy);
    refreshAfterExecution();
  }, [reset, execute, refreshAfterExecution, repairStrategy]);

  const handleExecute = useCallback(async () => {
    setConfirmOpen(false);
    reset();
    await execute(false, repairStrategy);
    refreshAfterExecution();
  }, [reset, execute, refreshAfterExecution, repairStrategy]);

  if (planLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-64" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full rounded-md" />
          <Skeleton className="h-32 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  if (!plan) return null;

  const scope = plan.recommended_scope ?? 'no_risk';
  const scopeCfg = SCOPE_CONFIG[scope] ?? SCOPE_CONFIG.no_risk;
  const ScopeIcon = scopeCfg.icon;
  const canExecute = scope !== 'no_risk' && !!projectId && !isExecuting;

  // Calm state
  if (scope === 'no_risk') {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              Narrative Repair
            </CardTitle>
            <DashTabSwitcher active={dashTab} onChange={setDashTab} />
          </div>
        </CardHeader>
        <ProjectHealthBriefingStrip repairs={allRepairs ?? null} />
        <CardContent className="space-y-4">
          {dashTab === 'strategy' ? (
            <RepairStrategyPanel projectId={projectId} onRouteToRepairs={handleRouteToRepairs} completedRepairSignatures={completedRepairSignatures} />
          ) : (
          <>
          {/* Autopilot Status */}
          <AutopilotRepairPanel
            data={monitorData}
            isLoading={monitorLoading}
            onRefresh={refreshMonitor}
            onPreviewPlan={() => refetchPlan()}
            onDryRun={handleDryRun}
            onExecuteRepair={() => setConfirmOpen(true)}
            isExecuting={isExecuting}
            repairStrategy={repairStrategy}
            onStrategyChange={setRepairStrategy}
          />

          {/* Story Intelligence */}
          {projectId && <StoryIntelligencePanel projectId={projectId} />}

          {/* Narrative Diagnostics */}
          {projectId && <NarrativeDiagnosticsPanel projectId={projectId} />}

          {/* Repair Queue */}
          {projectId && <NarrativeRepairQueuePanel projectId={projectId} landingContext={repairLandingContext} onDismissLandingContext={() => { setRepairLandingContext(null); if (landingTimerRef.current) clearTimeout(landingTimerRef.current); }} />}

          {/* Simulation Preview */}
          <NarrativeSimulationPanel projectId={projectId} />

          {/* Narrative Drift */}
          <NarrativeEssenceDriftPanel projectId={projectId} authoredSeedId={authoredSeedId} derivedSeedId={derivedSeedId} />

          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">
              Story structure currently aligned — no regeneration required.
            </span>
          </div>
          {plan.diagnostics && (
            <p className="text-xs text-muted-foreground">{plan.diagnostics}</p>
          )}
          {/* Run History even in calm state */}
          <RunHistorySection runs={runHistory ?? []} loading={historyLoading} slugMap={slugMap} onViewDiff={handleViewChanges} />
          </>
          )}
        </CardContent>
      </Card>
    );
  }

  const sortedUnits = [...(plan.source_units || [])].sort(
    (a, b) => (DEP_ORDER[a.dependency_position] ?? 9) - (DEP_ORDER[b.dependency_position] ?? 9)
  );

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            Narrative Repair
          </CardTitle>
          <div className="flex items-center gap-2">
            <DashTabSwitcher active={dashTab} onChange={setDashTab} />
            <Badge variant={scopeCfg.variant} className="gap-1 text-xs">
              <ScopeIcon className="h-3 w-3" />
              {scopeCfg.label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <ProjectHealthBriefingStrip repairs={allRepairs ?? null} />

      <CardContent className="space-y-6">
        {dashTab === 'strategy' ? (
          <RepairStrategyPanel projectId={projectId} onRouteToRepairs={handleRouteToRepairs} completedRepairSignatures={completedRepairSignatures} />
        ) : (
        <>
        {/* ═══ AUTOPILOT STATUS ═══ */}
        <AutopilotRepairPanel
          data={monitorData}
          isLoading={monitorLoading}
          onRefresh={refreshMonitor}
          onPreviewPlan={() => refetchPlan()}
          onDryRun={handleDryRun}
          onExecuteRepair={() => setConfirmOpen(true)}
          isExecuting={isExecuting}
          repairStrategy={repairStrategy}
          onStrategyChange={setRepairStrategy}
        />
        {/* ═══ STORY INTELLIGENCE ═══ */}
        {projectId && <StoryIntelligencePanel projectId={projectId} />}
        {/* ═══ NARRATIVE DIAGNOSTICS ═══ */}
        {projectId && <NarrativeDiagnosticsPanel projectId={projectId} />}
        {/* ═══ REPAIR QUEUE ═══ */}
        {projectId && <NarrativeRepairQueuePanel projectId={projectId} landingContext={repairLandingContext} onDismissLandingContext={() => { setRepairLandingContext(null); if (landingTimerRef.current) clearTimeout(landingTimerRef.current); }} />}
        {/* ═══ SIMULATION PREVIEW ═══ */}
        <NarrativeSimulationPanel projectId={projectId} />
        {/* ═══ NARRATIVE DRIFT ═══ */}
        <NarrativeEssenceDriftPanel projectId={projectId} authoredSeedId={authoredSeedId} derivedSeedId={derivedSeedId} />
        {/* ═══ SECTION 1: REPAIR STATUS ═══ */}
        <RepairStatusSection
          plan={plan}
          directCount={directScenes.length}
          propagatedCount={propagatedScenes.length}
          entityCount={entityCount}
          sortedUnits={sortedUnits}
        />

        {/* ═══ SECTION 2: IMPACT MAP ═══ */}
        <ImpactMapSection
          directScenes={directScenes}
          propagatedScenes={propagatedScenes}
          entityScenes={entityScenes}
          entityCount={entityCount}
          slugMap={slugMap}
          onViewChanges={(key) => handleViewChanges(key, completedKeysForDiff)}
          completedKeys={completedKeysForDiff}
        />

        {/* ═══ SECTION 2.5: NDG IMPACT HEATMAP ═══ */}
        <NDGImpactHeatmap
          allScenes={allScenes}
          entityScenes={entityScenes}
          slugMap={slugMap}
          latestRun={(runHistory && runHistory.length > 0) ? runHistory[0] : null}
          onSceneClick={(key, hasRun) => {
            if (hasRun && completedKeysForDiff.includes(key)) {
              handleViewChanges(key, completedKeysForDiff);
            }
          }}
        />

        {/* ═══ SECTION 3: EXECUTION CONTROLS ═══ */}
        <ExecutionSection
          canExecute={canExecute}
          isExecuting={isExecuting}
          scope={scope}
          onDryRun={handleDryRun}
          onExecuteClick={() => setConfirmOpen(true)}
          error={error}
          result={result}
          slugMap={slugMap}
          onViewChanges={(key) => handleViewChanges(key, completedKeysForDiff)}
        />

        {/* ═══ SECTION 4: RUN HISTORY ═══ */}
        <RunHistorySection runs={runHistory ?? []} loading={historyLoading} slugMap={slugMap} onViewDiff={handleViewChanges} />

        {/* Diagnostics */}
        {plan.diagnostics && (
          <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{plan.diagnostics}</p>
        )}
        </>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <ConfirmExecutionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleExecute}
        plan={plan}
        repairStrategy={repairStrategy}
      />

      {/* Diff Viewer */}
      <SceneRewriteDiffViewer
        open={diffOpen}
        onOpenChange={(v) => { setDiffOpen(v); if (!v) diffHook.clear(); }}
        data={diffHook.data}
        loading={diffHook.loading}
        error={diffHook.error}
        sceneKeys={diffSceneKeys}
        currentIndex={diffSceneIndex}
        onNavigate={handleDiffNavigate}
      />
    </Card>
  );
}

/* ── Tab Switcher ── */
function DashTabSwitcher({ active, onChange }: { active: 'repairs' | 'strategy'; onChange: (v: 'repairs' | 'strategy') => void }) {
  return (
    <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-xs">
      <button
        onClick={() => onChange('repairs')}
        className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${active === 'repairs' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        Repairs
      </button>
      <button
        onClick={() => onChange('strategy')}
        className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${active === 'strategy' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        Strategy
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1: REPAIR STATUS
   ═══════════════════════════════════════════════════════════════════════════ */

function RepairStatusSection({ plan, directCount, propagatedCount, entityCount, sortedUnits }: {
  plan: NonNullable<ReturnType<typeof useSelectiveRegenerationPlan>['data']>;
  directCount: number;
  propagatedCount: number;
  entityCount: number;
  sortedUnits: SourceUnit[];
}) {
  const [showAllUnits, setShowAllUnits] = useState(false);
  const visibleUnits = showAllUnits ? sortedUnits : sortedUnits.slice(0, INITIAL_SHOW);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Repair Status</h3>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatusTile label="Direct" value={directCount} className="text-destructive" />
        <StatusTile label="Propagated" value={propagatedCount} className="text-amber-600 dark:text-amber-400" />
        <StatusTile label="Entity" value={entityCount} className="text-sky-600 dark:text-sky-400" />
        <StatusTile label="Total" value={plan.impacted_scene_count} className="text-foreground" />
      </div>

      {plan.rationale && (
        <p className="text-xs text-muted-foreground">{plan.rationale}</p>
      )}

      {/* Axis Impact */}
      {(plan.direct_axes?.length > 0 || plan.propagated_axes?.length > 0) && (
        <div className="space-y-1">
          {plan.direct_axes?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-destructive">Direct axes:</span>
              {plan.direct_axes.map(a => (
                <Badge key={a} variant="outline" className="text-[10px] border-destructive/40 text-destructive">{a}</Badge>
              ))}
            </div>
          )}
          {plan.propagated_axes?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Propagated axes:</span>
              {plan.propagated_axes.map(a => (
                <Badge key={a} variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">{a}</Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source Units */}
      {sortedUnits.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-semibold text-muted-foreground">Source Units</h4>
          <div className="space-y-1">
            {visibleUnits.map((u, i) => (
              <SourceUnitRow key={u.unit_key + i} unit={u} />
            ))}
          </div>
          {sortedUnits.length > INITIAL_SHOW && (
            <ToggleButton expanded={showAllUnits} total={sortedUnits.length} onToggle={() => setShowAllUnits(v => !v)} />
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2: IMPACT MAP
   ═══════════════════════════════════════════════════════════════════════════ */

function ImpactMapSection({ directScenes, propagatedScenes, entityScenes, entityCount, slugMap, onViewChanges, completedKeys }: {
  directScenes: ImpactedScene[];
  propagatedScenes: ImpactedScene[];
  entityScenes: ImpactedScene[];
  entityCount: number;
  slugMap: SluglineMap;
  onViewChanges: (key: string) => void;
  completedKeys: string[];
}) {
  const [showDirect, setShowDirect] = useState(false);
  const [showPropagated, setShowPropagated] = useState(false);
  const [showEntity, setShowEntity] = useState(false);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impact Map</h3>

      {directScenes.length > 0 && (
        <SceneImpactGroup
          title="Direct Rewrite Targets"
          scenes={directScenes}
          slugMap={slugMap}
          badgeVariant="destructive"
          showAll={showDirect}
          onToggle={() => setShowDirect(v => !v)}
          onViewChanges={onViewChanges}
          completedKeys={completedKeys}
        />
      )}

      {propagatedScenes.length > 0 && (
        <SceneImpactGroup
          title="Propagated Impact"
          scenes={propagatedScenes}
          slugMap={slugMap}
          badgeVariant="outline"
          badgeClassName="border-amber-500/40 text-amber-600 dark:text-amber-400"
          showAll={showPropagated}
          onToggle={() => setShowPropagated(v => !v)}
          onViewChanges={onViewChanges}
          completedKeys={completedKeys}
        />
      )}

      {entityCount > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-[11px] font-semibold text-muted-foreground">Entity Impact</h4>
            <Badge variant="secondary" className="text-[10px]">Advisory</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Scenes affected through entity presence. Not regenerated in the current repair pass.
          </p>
          <div className="space-y-1">
            {(showEntity ? entityScenes : entityScenes.slice(0, INITIAL_SHOW)).map((s, i) => (
              <div key={s.scene_key + i} className="flex items-center justify-between rounded-md border border-border/20 bg-muted/10 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground truncate mr-2">{sceneLabelFromImpacted(s, slugMap)}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">entity</Badge>
              </div>
            ))}
          </div>
          {entityScenes.length > INITIAL_SHOW && (
            <ToggleButton expanded={showEntity} total={entityScenes.length} onToggle={() => setShowEntity(v => !v)} />
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3: EXECUTION CONTROLS
   ═══════════════════════════════════════════════════════════════════════════ */

function ExecutionSection({ canExecute, isExecuting, scope, onDryRun, onExecuteClick, error, result, slugMap, onViewChanges }: {
  canExecute: boolean;
  isExecuting: boolean;
  scope: string;
  onDryRun: () => void;
  onExecuteClick: () => void;
  error: string | null;
  result: RegenExecutionResult | null;
  slugMap: SluglineMap;
  onViewChanges: (key: string) => void;
}) {
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [showAllFailed, setShowAllFailed] = useState(false);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Execution</h3>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" disabled={!canExecute} onClick={onDryRun}>
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          Dry Run
        </Button>
        <Button size="sm" disabled={!canExecute} onClick={onExecuteClick}>
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Execute Repair
        </Button>
        {scope === 'no_risk' && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            No regeneration needed
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && (
        <ExecutionResultView
          result={result}
          slugMap={slugMap}
          showAllCompleted={showAllCompleted}
          setShowAllCompleted={setShowAllCompleted}
          showAllFailed={showAllFailed}
          setShowAllFailed={setShowAllFailed}
          onViewChanges={onViewChanges}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4: RUN HISTORY
   ═══════════════════════════════════════════════════════════════════════════ */

function RunHistorySection({ runs, loading, slugMap, onViewDiff }: {
  runs: RegenerationRun[];
  loading: boolean;
  slugMap: SluglineMap;
  onViewDiff: (sceneKey: string, keys: string[]) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Run History</h3>
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  if (runs.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3 w-3" />
        Run History
      </h3>
      <div className="space-y-1">
        {runs.map((run) => {
          const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.failed;
          const StatusIcon = cfg.icon;
          const meta = run.meta_json ?? {};
          const completedKeys: string[] = (meta.completed_scene_keys as string[]) ?? [];

          return (
            <div key={run.id} className="flex items-center justify-between rounded-md border border-border/30 bg-muted/20 px-2.5 py-2 text-xs gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${run.status === 'completed' ? 'text-emerald-500' : run.status === 'partial_failure' ? 'text-amber-500' : 'text-destructive'}`} />
                <Badge variant={cfg.variant} className="text-[10px] shrink-0">{cfg.label}</Badge>
                <span className="text-muted-foreground font-mono truncate">{run.id.slice(0, 8)}…</span>
                {run.target_scene_count != null && (
                  <span className="text-muted-foreground shrink-0">{run.target_scene_count} scenes</span>
                )}
                {run.started_at && (
                  <span className="text-muted-foreground shrink-0 hidden sm:inline">
                    {new Date(run.started_at).toLocaleDateString()}
                  </span>
                )}
                {(meta.ndg_validation_status as string) && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    NDG: {meta.ndg_validation_status as string}
                  </Badge>
                )}
              </div>
              {completedKeys.length > 0 && (
                <button
                  onClick={() => onViewDiff(completedKeys[0], completedKeys)}
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline shrink-0"
                >
                  <GitCompare className="h-3 w-3" />
                  View Diff
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function StatusTile({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2 text-center">
      <div className={`text-lg font-semibold ${className}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}

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
      {unit.axis && <Badge variant="outline" className="text-[10px] shrink-0">{unit.axis}</Badge>}
      <Badge variant="outline" className={`text-[10px] shrink-0 ${DEP_COLORS[unit.dependency_position] ?? ''}`}>
        {unit.dependency_position}
      </Badge>
      {unit.sequence_order != null && (
        <span className="text-[10px] text-muted-foreground shrink-0">#{unit.sequence_order}</span>
      )}
    </div>
  );
}

function ToggleButton({ expanded, total, onToggle }: { expanded: boolean; total: number; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 text-xs text-primary hover:underline pt-0.5">
      {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {expanded ? 'Show less' : `Show all ${total}`}
    </button>
  );
}

function SceneImpactGroup({ title, scenes, slugMap, badgeVariant, badgeClassName, showAll, onToggle, onViewChanges, completedKeys }: {
  title: string;
  scenes: ImpactedScene[];
  slugMap: SluglineMap;
  badgeVariant: 'destructive' | 'outline';
  badgeClassName?: string;
  showAll: boolean;
  onToggle: () => void;
  onViewChanges: (key: string) => void;
  completedKeys: string[];
}) {
  const visible = showAll ? scenes : scenes.slice(0, INITIAL_SHOW);
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold text-muted-foreground">{title}</h4>
      <div className="space-y-1">
        {visible.map((s, i) => {
          const isCompleted = completedKeys.includes(s.scene_key);
          return (
            <div key={s.scene_key + i} className="flex items-center justify-between rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-xs">
              <span className="text-foreground truncate mr-2">{sceneLabelFromImpacted(s, slugMap)}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={badgeVariant} className={`text-[10px] ${badgeClassName ?? ''}`}>
                  {s.risk_source}
                </Badge>
                {isCompleted && (
                  <button
                    onClick={() => onViewChanges(s.scene_key)}
                    className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                  >
                    <GitCompare className="h-3 w-3" />
                    Diff
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {scenes.length > INITIAL_SHOW && (
        <ToggleButton expanded={showAll} total={scenes.length} onToggle={onToggle} />
      )}
    </div>
  );
}

/* ── Execution Result ── */

function ExecutionResultView({ result, slugMap, showAllCompleted, setShowAllCompleted, showAllFailed, setShowAllFailed, onViewChanges }: {
  result: RegenExecutionResult;
  slugMap: SluglineMap;
  showAllCompleted: boolean;
  setShowAllCompleted: (v: boolean) => void;
  showAllFailed: boolean;
  setShowAllFailed: (v: boolean) => void;
  onViewChanges?: (key: string) => void;
}) {
  const status = result.status ?? (result.ok ? 'completed' : 'failed');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.failed;
  const StatusIcon = cfg.icon;

  const pre = result.ndg_pre_at_risk_count;
  const post = result.ndg_post_at_risk_count;
  let ndgDelta: 'improved' | 'unchanged' | 'degraded' | null = null;
  if (pre != null && post != null) {
    ndgDelta = post < pre ? 'improved' : post === pre ? 'unchanged' : 'degraded';
  }

  if (status === 'abort' && result.abort_reason) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <XCircle className="h-4 w-4" />
          Execution Aborted
        </div>
        <p className="text-xs text-destructive/80">{formatAbortReason(result.abort_reason)}</p>
      </div>
    );
  }

  const completedKeys = result.completed_scene_keys ?? [];
  const failedKeys = result.failed_scene_keys ?? [];
  const visibleCompleted = showAllCompleted ? completedKeys : completedKeys.slice(0, INITIAL_SHOW);
  const visibleFailed = showAllFailed ? failedKeys : failedKeys.slice(0, INITIAL_SHOW);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${status === 'completed' ? 'text-emerald-500' : status === 'partial_failure' ? 'text-amber-500' : 'text-destructive'}`} />
          <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
        </div>
        {result.run_id && (
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{result.run_id}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatusTile label="Completed" value={result.completed_scene_count ?? 0} className="text-emerald-600 dark:text-emerald-400" />
        <StatusTile label="Failed" value={result.failed_scene_count ?? 0} className={result.failed_scene_count ? 'text-destructive' : 'text-muted-foreground'} />
      </div>

      {/* NDG / NUE Outcome */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Outcome</h4>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {ndgDelta && (
            <span className="flex items-center gap-1">
              <ArrowDownUp className="h-3 w-3" />
              NDG Risk:
              <span className={ndgDelta === 'improved' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ndgDelta === 'degraded' ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                {ndgDelta} ({pre} → {post})
              </span>
            </span>
          )}
          {result.ndg_validation_status && (
            <span>Validation: <span className={result.ndg_validation_status === 'passed' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>{result.ndg_validation_status}</span></span>
          )}
          <span>NUE Revalidated: <span className="font-medium">{result.nue_revalidated ? 'Yes' : 'No'}</span></span>
          {result.aligned_unit_count != null && (
            <span>Aligned Units: <span className="font-medium">{result.aligned_unit_count}</span></span>
          )}
        </div>
      </div>

      {completedKeys.length > 0 && (
        <SceneKeyList title="Completed Scenes" keys={visibleCompleted} total={completedKeys.length} slugMap={slugMap} showAll={showAllCompleted} onToggle={() => setShowAllCompleted(!showAllCompleted)} variant="success" onViewChanges={onViewChanges} />
      )}

      {failedKeys.length > 0 && (
        <SceneKeyList title="Failed Scenes" keys={visibleFailed} total={failedKeys.length} slugMap={slugMap} showAll={showAllFailed} onToggle={() => setShowAllFailed(!showAllFailed)} variant="destructive" />
      )}

      {result.diagnostics && (
        <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{result.diagnostics}</p>
      )}
    </div>
  );
}

function SceneKeyList({ title, keys, total, slugMap, showAll, onToggle, variant, onViewChanges }: {
  title: string;
  keys: string[];
  total: number;
  slugMap: SluglineMap;
  showAll: boolean;
  onToggle: () => void;
  variant: 'success' | 'destructive';
  onViewChanges?: (key: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold text-muted-foreground">{title}</h4>
      <div className="space-y-1">
        {keys.map((k) => (
          <div key={k} className="flex items-center rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 mr-2 ${variant === 'success' ? 'bg-emerald-500' : 'bg-destructive'}`} />
            <span className="text-foreground truncate flex-1">{sceneLabel(k, slugMap)}</span>
            {onViewChanges && variant === 'success' && (
              <button onClick={() => onViewChanges(k)} className="flex items-center gap-1 text-[10px] text-primary hover:underline shrink-0 ml-2">
                <GitCompare className="h-3 w-3" />
                View Changes
              </button>
            )}
          </div>
        ))}
      </div>
      {total > INITIAL_SHOW && (
        <ToggleButton expanded={showAll} total={total} onToggle={onToggle} />
      )}
    </div>
  );
}

/* ── Confirmation Dialog ── */

function ConfirmExecutionDialog({ open, onOpenChange, onConfirm, plan, repairStrategy }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  plan: NonNullable<ReturnType<typeof useSelectiveRegenerationPlan>['data']>;
  repairStrategy: RepairStrategy;
}) {
  const strategyLabel = repairStrategy === 'precision' ? 'Precision' : repairStrategy === 'stabilization' ? 'Stabilization' : 'Balanced';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Execute {strategyLabel} Repair?</DialogTitle>
          <DialogDescription>
            This will regenerate impacted scenes using the {strategyLabel.toLowerCase()} strategy. Review the scope below before proceeding.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Strategy</span>
            <Badge variant="outline" className="text-xs">{strategyLabel}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Scope</span>
            <Badge variant="outline" className="text-xs">{plan.recommended_scope}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Impacted scenes</span>
            <span className="font-medium">{plan.impacted_scene_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Source units</span>
            <span className="font-medium">{plan.source_units?.length ?? 0}</span>
          </div>
          {(plan.direct_axes?.length > 0 || plan.propagated_axes?.length > 0) && (
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Axes</span>
              <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                {plan.direct_axes?.map(a => <Badge key={a} variant="destructive" className="text-[10px]">{a}</Badge>)}
                {plan.propagated_axes?.map(a => <Badge key={a} variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">{a}</Badge>)}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm}>
            <Play className="h-3.5 w-3.5" />
            Execute {strategyLabel} Repair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatAbortReason(reason: string): string {
  const map: Record<string, string> = {
    no_risk: 'Story structure currently aligned — no regeneration required.',
    no_scenes: 'No scenes identified for regeneration.',
    propagated_only: 'Only propagated impact detected — no direct regeneration targets.',
    already_running: 'A regeneration run is already in progress for this project.',
    execution_locked: 'Execution is currently locked. Please try again later.',
  };
  return map[reason] ?? reason;
}

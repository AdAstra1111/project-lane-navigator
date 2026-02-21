import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStateGraph } from '@/hooks/useStateGraph';

import { StateGraphOverview } from '@/components/cockpit/StateGraphOverview';
import { ScenarioPanel } from '@/components/cockpit/ScenarioPanel';
import { DriftAlertsPanel } from '@/components/cockpit/DriftAlertsPanel';
import { CascadeSimulator } from '@/components/cockpit/CascadeSimulator';
import { AccessDiagnosticPanel } from '@/components/cockpit/AccessDiagnosticPanel';
import { ActiveScenarioBanner } from '@/components/cockpit/ActiveScenarioBanner';
import { OptimizationPanel } from '@/components/cockpit/OptimizationPanel';
import { ProjectionPanel } from '@/components/cockpit/ProjectionPanel';
import { EngineSelfTestPanel } from '@/components/cockpit/EngineSelfTestPanel';
import { StrategicRecommendationPanel } from '@/components/cockpit/StrategicRecommendationPanel';
import { ScenarioStressTestPanel } from '@/components/cockpit/ScenarioStressTestPanel';
import { InvestorModePanel } from '@/components/cockpit/InvestorModePanel';
import { ScenarioComparisonPanel } from '@/components/cockpit/ScenarioComparisonPanel';
import { DecisionLogPanel } from '@/components/cockpit/DecisionLogPanel';
import { ScenarioDiffMergePanel } from '@/components/cockpit/ScenarioDiffMergePanel';
import { ScenarioLockControls } from '@/components/cockpit/ScenarioLockControls';

import { ArrowLeft, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProducerCockpit() {
  const { id: projectId } = useParams<{ id: string }>();

  const {
    stateGraph,
    scenarios,
    alerts,
    recommendation,
    isLoading,
    initialize,
    cascade,
    createScenario,
    generateSystemScenarios,
    togglePin,
    archiveScenario,
    setActiveScenario,
    rankScenarios,
    optimizeScenario,
    applyOptimizedOverrides,
    projectForward,
    recomputeRecommendation,
    runStressTest,
    branchFromDecisionEvent,
    mergeScenarioOverrides,
    setScenarioLock,
    latestStressTest,
    baseline,
    activeScenario,
    recommendedScenario,
  } = useStateGraph(projectId);

  const [optimizeResult, setOptimizeResult] = useState<any>(null);

  if (!projectId) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/projects">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            <div>
              <div className="text-sm font-semibold">Producer Cockpit</div>
              <div className="text-xs text-muted-foreground">Project: {projectId}</div>
            </div>
          </div>
        </div>
      </div>

      {!isLoading && !stateGraph && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-sm font-semibold">Initialize Project State Graph</div>
          <div className="text-xs text-muted-foreground">
            Build the 5-layer lifecycle model for this project. This creates the canonical state graph
            that drives all simulation, scenario, and drift intelligence.
          </div>
          <Button onClick={() => initialize.mutate({})} disabled={initialize.isPending}>
            {initialize.isPending ? 'Initializing…' : 'Initialize State Graph'}
          </Button>
        </div>
      )}

      {stateGraph && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StrategicRecommendationPanel
              projectId={projectId}
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id ?? null}
              recommendation={recommendation}
              onRecompute={() =>
                recomputeRecommendation.mutate({
                  baselineScenarioId: baseline?.id,
                  activeScenarioId: activeScenario?.id,
                })
              }
              isRecomputing={recomputeRecommendation.isPending}
              onSetActive={(id) => setActiveScenario.mutate(id)}
              isSettingActive={setActiveScenario.isPending}
              onTogglePin={(id) => togglePin.mutate(id)}
              isTogglingPin={togglePin.isPending}
            />

            <InvestorModePanel
              activeScenario={activeScenario}
              baseline={baseline}
              recommendation={recommendation}
              latestStressTest={latestStressTest}
            />
          </div>

          <ScenarioComparisonPanel
            projectId={projectId}
            scenarios={scenarios}
            baselineScenarioId={baseline?.id ?? null}
            activeScenarioId={activeScenario?.id ?? null}
            recommendedScenarioId={recommendedScenario?.id ?? null}
            onSetActive={(id) => setActiveScenario.mutate(id)}
            isSettingActive={setActiveScenario.isPending}
            onTogglePin={(id) => togglePin.mutate(id)}
            isTogglingPin={togglePin.isPending}
            onRunProjection={(params) => projectForward.mutate(params)}
            isProjecting={projectForward.isPending}
            onRunStressTest={(params) => runStressTest.mutate(params)}
            isRunningStress={runStressTest.isPending}
          />

          <ScenarioDiffMergePanel
            projectId={projectId}
            scenarios={scenarios}
            activeScenarioId={activeScenario?.id ?? null}
            onMerge={(params) => mergeScenarioOverrides.mutate(params)}
            isMerging={mergeScenarioOverrides.isPending}
            onUpdateProtectedPaths={(params) => {
              const scenario = scenarios.find(s => s.id === params.scenarioId);
              setScenarioLock.mutate({
                scenarioId: params.scenarioId,
                isLocked: scenario?.is_locked ?? false,
                protectedPaths: params.protectedPaths,
              });
            }}
            isUpdatingProtected={setScenarioLock.isPending}
            onSetLock={(params) => setScenarioLock.mutate(params)}
            isSavingLock={setScenarioLock.isPending}
          />

          <ScenarioLockControls
            projectId={projectId}
            scenarios={scenarios}
            activeScenarioId={activeScenario?.id ?? null}
            onSetLock={(params) => setScenarioLock.mutate(params)}
            isSaving={setScenarioLock.isPending}
          />

          <ActiveScenarioBanner
            activeScenario={activeScenario}
            baseline={baseline}
            stateGraph={stateGraph}
            onSetBaselineActive={() => baseline && setActiveScenario.mutate(baseline.id)}
            isPending={setActiveScenario.isPending}
          />

          <StateGraphOverview stateGraph={stateGraph} />

          <CascadeSimulator
            stateGraph={stateGraph}
            onCascade={(overrides, scenarioId) => cascade.mutate({ overrides, scenarioId })}
            isPending={cascade.isPending}
          />

          <ScenarioPanel
            scenarios={scenarios}
            baseline={baseline}
            recommendedScenario={recommendedScenario}
            onGenerateSystem={() => generateSystemScenarios.mutate()}
            onCreateCustom={(name, desc, overrides) =>
              createScenario.mutate({ name, description: desc, overrides })
            }
            onTogglePin={(id) => togglePin.mutate(id)}
            onArchive={(id) => archiveScenario.mutate(id)}
            onSetActive={(id) => setActiveScenario.mutate(id)}
            onRankScenarios={() => rankScenarios.mutate()}
            isGenerating={generateSystemScenarios.isPending}
            isCreating={createScenario.isPending}
            isSettingActive={setActiveScenario.isPending}
            isRanking={rankScenarios.isPending}
          />

          <OptimizationPanel
            scenarios={scenarios}
            activeScenarioId={activeScenario?.id ?? null}
            onOptimize={async (params) => {
              const result = await optimizeScenario.mutateAsync(params);
              setOptimizeResult(result);
            }}
            onApply={(scenarioId, overrides) =>
              applyOptimizedOverrides.mutate({ scenarioId, overrides })
            }
            optimizeResult={optimizeResult}
            isOptimizing={optimizeScenario.isPending}
            isApplying={applyOptimizedOverrides.isPending}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ProjectionPanel
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id ?? null}
              projectId={projectId}
              onRunProjection={(params) => projectForward.mutate(params)}
              isProjecting={projectForward.isPending}
            />

            <ScenarioStressTestPanel
              projectId={projectId}
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id ?? null}
              onRunStressTest={(params) => runStressTest.mutate(params)}
              isRunning={runStressTest.isPending}
              latestStressTest={latestStressTest}
            />
          </div>

          <DriftAlertsPanel
            projectId={projectId}
            scenarios={scenarios}
            activeScenarioId={activeScenario?.id ?? null}
          />

          <DecisionLogPanel
            projectId={projectId}
            scenarios={scenarios}
            onSetActive={(id) => setActiveScenario.mutate(id)}
            isSettingActive={setActiveScenario.isPending}
            onRunProjection={(params) => projectForward.mutate(params)}
            isProjecting={projectForward.isPending}
            onRunStressTest={(params) => runStressTest.mutate(params)}
            isRunningStress={runStressTest.isPending}
            onBranchFromEvent={(eventId) => branchFromDecisionEvent.mutate({ eventId })}
            isBranching={branchFromDecisionEvent.isPending}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EngineSelfTestPanel projectId={projectId} />
            <AccessDiagnosticPanel />
          </div>
        </>
      )}
    </div>
  );
}

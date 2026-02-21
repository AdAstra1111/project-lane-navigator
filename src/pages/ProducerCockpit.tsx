import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStateGraph } from '@/hooks/useStateGraph';
import { StateGraphOverview } from '@/components/cockpit/StateGraphOverview';
import { ScenarioPanel } from '@/components/cockpit/ScenarioPanel';
import { DriftAlertPanel } from '@/components/cockpit/DriftAlertPanel';
import { CascadeSimulator } from '@/components/cockpit/CascadeSimulator';
import { AccessDiagnosticPanel } from '@/components/cockpit/AccessDiagnosticPanel';
import { ActiveScenarioBanner } from '@/components/cockpit/ActiveScenarioBanner';
import { OptimizationPanel } from '@/components/cockpit/OptimizationPanel';
import { ProjectionPanel } from '@/components/cockpit/ProjectionPanel';
import { ArrowLeft, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProducerCockpit() {
  const { id: projectId } = useParams<{ id: string }>();
  const {
    stateGraph, scenarios, alerts, latestProjection, isLoading,
    initialize, cascade, createScenario, generateSystemScenarios,
    acknowledgeAlert, togglePin, archiveScenario, setActiveScenario,
    rankScenarios, optimizeScenario, applyOptimizedOverrides, projectForward,
    baseline, activeScenario, recommendedScenario,
  } = useStateGraph(projectId);

  const [optimizeResult, setOptimizeResult] = useState<any>(null);

  if (!projectId) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40 px-6 py-4 flex items-center gap-4">
        <Link to={`/projects/${projectId}`}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Project</Button>
        </Link>
        <Gauge className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Producer Cockpit</h1>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {!isLoading && !stateGraph && (
          <div className="border border-dashed border-border rounded-lg p-8 text-center space-y-4">
            <h2 className="text-xl font-medium">Initialize Project State Graph</h2>
            <p className="text-muted-foreground text-sm max-w-lg mx-auto">
              Build the 5-layer lifecycle model for this project. This creates the canonical state graph
              that drives all simulation, scenario, and drift intelligence.
            </p>
            <Button onClick={() => initialize.mutate({})} disabled={initialize.isPending}>
              {initialize.isPending ? 'Initializing…' : 'Initialize State Graph'}
            </Button>
          </div>
        )}

        {stateGraph && (
          <>
            <ActiveScenarioBanner
              activeScenario={activeScenario}
              baseline={baseline}
              stateGraph={stateGraph}
              onSetBaselineActive={() => baseline && setActiveScenario.mutate(baseline.id)}
              isPending={setActiveScenario.isPending}
            />

            {alerts.length > 0 && (
              <DriftAlertPanel alerts={alerts} onAcknowledge={(id) => acknowledgeAlert.mutate(id)} />
            )}

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
              onCreateCustom={(name, desc, overrides) => createScenario.mutate({ name, description: desc, overrides })}
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
              activeScenarioId={stateGraph.active_scenario_id}
              onOptimize={async (params) => {
                const result = await optimizeScenario.mutateAsync(params);
                setOptimizeResult(result);
              }}
              onApply={(scenarioId, overrides) => applyOptimizedOverrides.mutate({ scenarioId, overrides })}
              optimizeResult={optimizeResult}
              isOptimizing={optimizeScenario.isPending}
              isApplying={applyOptimizedOverrides.isPending}
            />

            <ProjectionPanel
              scenarios={scenarios}
              activeScenarioId={stateGraph.active_scenario_id}
              latestProjection={latestProjection}
              onRunProjection={(params) => projectForward.mutate(params)}
              isProjecting={projectForward.isPending}
            />
          </>
        )}

        <AccessDiagnosticPanel />
      </main>
    </div>
  );
}

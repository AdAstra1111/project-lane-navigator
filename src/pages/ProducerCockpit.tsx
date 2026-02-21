import { useParams, Link } from 'react-router-dom';
import { useStateGraph } from '@/hooks/useStateGraph';
import { StateGraphOverview } from '@/components/cockpit/StateGraphOverview';
import { ScenarioPanel } from '@/components/cockpit/ScenarioPanel';
import { DriftAlertPanel } from '@/components/cockpit/DriftAlertPanel';
import { CascadeSimulator } from '@/components/cockpit/CascadeSimulator';
import { AccessDiagnosticPanel } from '@/components/cockpit/AccessDiagnosticPanel';
import { ArrowLeft, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Producer Cockpit — the primary role-filtered intelligence dashboard.
 * Drift alerts are producer-only and must remain role-filtered in later phases.
 * No other role should see drift alerts until role-based access is implemented.
 */
export default function ProducerCockpit() {
  const { id: projectId } = useParams<{ id: string }>();
  const {
    stateGraph, scenarios, alerts, isLoading,
    initialize, cascade, createScenario, generateSystemScenarios,
    acknowledgeAlert, togglePin, archiveScenario, baseline,
  } = useStateGraph(projectId);

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
            {/* Drift Alerts — producer-only, must be role-filtered in later phases */}
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
              onGenerateSystem={() => generateSystemScenarios.mutate()}
              onCreateCustom={(name, desc, overrides) => createScenario.mutate({ name, description: desc, overrides })}
              onTogglePin={(id) => togglePin.mutate(id)}
              onArchive={(id) => archiveScenario.mutate(id)}
              isGenerating={generateSystemScenarios.isPending}
              isCreating={createScenario.isPending}
            />
          </>
        )}

        <AccessDiagnosticPanel />
      </main>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GitCompareArrows, Pin, CheckCircle2, Play, FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  ProjectScenario,
  ScenarioProjection,
  ScenarioStressTest,
  ProjectionAssumptions,
} from '@/hooks/useStateGraph';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  baselineScenarioId: string | null;
  activeScenarioId: string | null;
  recommendedScenarioId: string | null;
  onSetActive: (scenarioId: string) => void;
  isSettingActive: boolean;
  onTogglePin: (scenarioId: string) => void;
  isTogglingPin: boolean;
  onRunProjection: (params: { scenarioId?: string; months?: number; assumptions?: ProjectionAssumptions }) => void;
  isProjecting: boolean;
  onRunStressTest: (params: { scenarioId: string; months?: number }) => void;
  isRunningStress: boolean;
}

// ---- helpers ----

function useLatestProjection(projectId: string, scenarioId: string | null) {
  return useQuery({
    queryKey: ['comparison-projection', projectId, scenarioId],
    queryFn: async () => {
      if (!scenarioId) return null;
      const { data, error } = await supabase
        .from('scenario_projections')
        .select('*')
        .eq('project_id', projectId)
        .eq('scenario_id', scenarioId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioProjection | null;
    },
    enabled: !!scenarioId,
  });
}

function useLatestStress(projectId: string, scenarioId: string | null) {
  return useQuery({
    queryKey: ['comparison-stress', projectId, scenarioId],
    queryFn: async () => {
      if (!scenarioId) return null;
      const { data, error } = await supabase
        .from('scenario_stress_tests')
        .select('*')
        .eq('project_id', projectId)
        .eq('scenario_id', scenarioId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioStressTest | null;
    },
    enabled: !!scenarioId,
  });
}

interface DriftCounts {
  critical: number;
  warning: number;
  info: number;
}

function useDriftCounts(projectId: string, scenarioId: string | null) {
  return useQuery({
    queryKey: ['comparison-drift', projectId, scenarioId],
    queryFn: async (): Promise<DriftCounts> => {
      if (!scenarioId) return { critical: 0, warning: 0, info: 0 };
      const { data, error } = await supabase
        .from('drift_alerts')
        .select('severity')
        .eq('project_id', projectId)
        .eq('scenario_id', scenarioId)
        .eq('acknowledged', false);
      if (error) throw error;
      const rows = data || [];
      return {
        critical: rows.filter(r => r.severity === 'critical').length,
        warning: rows.filter(r => r.severity === 'warning').length,
        info: rows.filter(r => r.severity === 'info').length,
      };
    },
    enabled: !!scenarioId,
  });
}

// ---- metric extraction ----

interface ProjectionMetrics {
  irr: number | null;
  npv: number | null;
  payback_months: number | null;
  schedule_months: number | null;
  budget: number | null;
  risk_score: number | null;
}

function extractMetrics(proj: ScenarioProjection | null | undefined): ProjectionMetrics {
  if (!proj) return { irr: null, npv: null, payback_months: null, schedule_months: null, budget: null, risk_score: null };

  const summary = proj.summary as any;
  const series = (proj.series || []) as any[];
  const last = series.length > 0 ? series[series.length - 1] : null;

  // Try to extract from summary bullets or series
  let irr: number | null = null;
  let npv: number | null = null;
  let payback_months: number | null = null;
  let schedule_months: number | null = proj.months ?? null;
  let budget: number | null = last?.budget ?? null;

  // Parse summary strings for IRR / NPV / payback if present
  if (Array.isArray(summary)) {
    for (const s of summary) {
      if (typeof s !== 'string') continue;
      const irrMatch = s.match(/IRR[:\s]+([0-9.]+)%/i);
      if (irrMatch) irr = parseFloat(irrMatch[1]);
      const npvMatch = s.match(/NPV[:\s]+\$?([0-9,.]+)/i);
      if (npvMatch) npv = parseFloat(npvMatch[1].replace(/,/g, ''));
      const payMatch = s.match(/payback[:\s]+(\d+)/i);
      if (payMatch) payback_months = parseInt(payMatch[1]);
    }
  }

  return { irr, npv, payback_months, schedule_months, budget, risk_score: proj.projection_risk_score ?? null };
}

// ---- display helpers ----

function fmtNum(n: number | null | undefined, prefix = '', suffix = ''): string {
  if (n == null) return '—';
  return `${prefix}${n.toLocaleString()}${suffix}`;
}

function fmtDelta(a: number | null | undefined, b: number | null | undefined, suffix = ''): string {
  if (a == null || b == null) return '—';
  const d = a - b;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toLocaleString()}${suffix}`;
}

// ---- ScenarioCard ----

interface CardData {
  scenario: ProjectScenario;
  tags: string[];
  projection: ScenarioProjection | null | undefined;
  stress: ScenarioStressTest | null | undefined;
  drift: DriftCounts;
}

function ScenarioCard({
  data,
  activeScenarioId,
  onSetActive,
  isSettingActive,
  onTogglePin,
  isTogglingPin,
  onRunProjection,
  isProjecting,
  onRunStressTest,
  isRunningStress,
}: {
  data: CardData;
  activeScenarioId: string | null;
  onSetActive: (id: string) => void;
  isSettingActive: boolean;
  onTogglePin: (id: string) => void;
  isTogglingPin: boolean;
  onRunProjection: (params: { scenarioId?: string; months?: number }) => void;
  isProjecting: boolean;
  onRunStressTest: (params: { scenarioId: string; months?: number }) => void;
  isRunningStress: boolean;
}) {
  const { scenario, tags, projection, stress, drift } = data;
  const m = extractMetrics(projection ?? null);
  const isActive = scenario.id === activeScenarioId;

  return (
    <Card className="border-border/40">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="space-y-1">
          <div className="text-sm font-semibold truncate">{scenario.name}</div>
          <div className="flex flex-wrap gap-1">
            {tags.map(t => (
              <Badge key={t} variant={t === 'Active' ? 'default' : 'secondary'} className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        </div>

        {/* Projection metrics */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="text-muted-foreground">IRR</div>
          <div className="font-mono text-right">{fmtNum(m.irr, '', '%')}</div>
          <div className="text-muted-foreground">NPV</div>
          <div className="font-mono text-right">{fmtNum(m.npv, '$')}</div>
          <div className="text-muted-foreground">Payback</div>
          <div className="font-mono text-right">{fmtNum(m.payback_months, '', ' mo')}</div>
          <div className="text-muted-foreground">Schedule</div>
          <div className="font-mono text-right">{fmtNum(m.schedule_months, '', ' mo')}</div>
          <div className="text-muted-foreground">Budget</div>
          <div className="font-mono text-right">{fmtNum(m.budget ? Math.round(m.budget) : null, '$')}</div>
          <div className="text-muted-foreground">Risk Score</div>
          <div className="font-mono text-right">{fmtNum(m.risk_score, '', '/100')}</div>
        </div>

        {/* Stress */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="text-muted-foreground">Fragility</div>
          <div className="font-mono text-right">{stress ? `${stress.fragility_score}/100` : '—'}</div>
          <div className="text-muted-foreground">Volatility</div>
          <div className="font-mono text-right">{stress ? `${stress.volatility_index}/100` : '—'}</div>
        </div>

        {/* Drift */}
        <div className="flex gap-2 text-xs">
          {drift.critical > 0 && <Badge variant="destructive" className="text-[10px]">{drift.critical} critical</Badge>}
          {drift.warning > 0 && <Badge variant="secondary" className="text-[10px]">{drift.warning} warn</Badge>}
          {drift.critical === 0 && drift.warning === 0 && (
            <span className="text-muted-foreground">No drift alerts</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            size="sm"
            variant={isActive ? 'secondary' : 'default'}
            className="h-7 text-xs"
            onClick={() => onSetActive(scenario.id)}
            disabled={isSettingActive || isActive}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {isActive ? 'Active' : 'Set Active'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onTogglePin(scenario.id)}
            disabled={isTogglingPin}
          >
            <Pin className="h-3 w-3 mr-1" />
            {scenario.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onRunProjection({ scenarioId: scenario.id, months: 12 })}
            disabled={isProjecting}
          >
            <Play className="h-3 w-3 mr-1" />
            Project
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onRunStressTest({ scenarioId: scenario.id, months: 12 })}
            disabled={isRunningStress}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Stress
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- DeltaRow ----

function DeltaRow({
  baselineProj,
  recommendedProj,
  baselineStress,
  recommendedStress,
  baselineDrift,
  recommendedDrift,
}: {
  baselineProj: ScenarioProjection | null | undefined;
  recommendedProj: ScenarioProjection | null | undefined;
  baselineStress: ScenarioStressTest | null | undefined;
  recommendedStress: ScenarioStressTest | null | undefined;
  baselineDrift: DriftCounts;
  recommendedDrift: DriftCounts;
}) {
  const bm = extractMetrics(baselineProj ?? null);
  const rm = extractMetrics(recommendedProj ?? null);

  const items: { label: string; value: string }[] = [
    { label: 'IRR Δ', value: fmtDelta(rm.irr, bm.irr, '%') },
    { label: 'Payback Δ', value: fmtDelta(rm.payback_months, bm.payback_months, ' mo') },
    { label: 'Schedule Δ', value: fmtDelta(rm.schedule_months, bm.schedule_months, ' mo') },
    { label: 'Risk Δ', value: fmtDelta(rm.risk_score, bm.risk_score) },
    {
      label: 'Drift Δ (crit)',
      value: fmtDelta(recommendedDrift.critical, baselineDrift.critical),
    },
    {
      label: 'Fragility Δ',
      value: fmtDelta(
        recommendedStress?.fragility_score ?? null,
        baselineStress?.fragility_score ?? null,
      ),
    },
    {
      label: 'Volatility Δ',
      value: fmtDelta(
        recommendedStress?.volatility_index ?? null,
        baselineStress?.volatility_index ?? null,
      ),
    },
  ];

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="text-xs font-semibold mb-2">Delta: Recommended vs Baseline</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2">
        {items.map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className="text-xs font-mono font-semibold">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Main Panel ----

export function ScenarioComparisonPanel({
  projectId,
  scenarios,
  baselineScenarioId,
  activeScenarioId,
  recommendedScenarioId,
  onSetActive,
  isSettingActive,
  onTogglePin,
  isTogglingPin,
  onRunProjection,
  isProjecting,
  onRunStressTest,
  isRunningStress,
}: Props) {
  const baselineScenario = baselineScenarioId ? scenarios.find(s => s.id === baselineScenarioId) : undefined;
  const activeScenario = activeScenarioId ? scenarios.find(s => s.id === activeScenarioId) : undefined;

  let recommendedScenario = recommendedScenarioId ? scenarios.find(s => s.id === recommendedScenarioId) : undefined;
  if (!recommendedScenario) {
    recommendedScenario = scenarios.find(s => s.is_recommended);
  }
  if (!recommendedScenario) {
    recommendedScenario = scenarios
      .filter(s => s.scenario_type !== 'baseline' && !s.is_archived && s.rank_score != null)
      .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))[0];
  }

  // Deduplicate: build unique list of up to 3 scenarios
  const seen = new Set<string>();
  const slots: { scenario: ProjectScenario; tags: string[] }[] = [];

  const addSlot = (s: ProjectScenario | undefined, tag: string) => {
    if (!s) return;
    if (seen.has(s.id)) {
      const existing = slots.find(sl => sl.scenario.id === s.id);
      if (existing && !existing.tags.includes(tag)) existing.tags.push(tag);
      return;
    }
    seen.add(s.id);
    slots.push({ scenario: s, tags: [tag] });
  };

  addSlot(baselineScenario, 'Baseline');
  addSlot(activeScenario, 'Active');
  addSlot(recommendedScenario, 'Recommended');

  // Fetch per-scenario data
  const { data: proj0 } = useLatestProjection(projectId, slots[0]?.scenario.id ?? null);
  const { data: proj1 } = useLatestProjection(projectId, slots[1]?.scenario.id ?? null);
  const { data: proj2 } = useLatestProjection(projectId, slots[2]?.scenario.id ?? null);

  const { data: stress0 } = useLatestStress(projectId, slots[0]?.scenario.id ?? null);
  const { data: stress1 } = useLatestStress(projectId, slots[1]?.scenario.id ?? null);
  const { data: stress2 } = useLatestStress(projectId, slots[2]?.scenario.id ?? null);

  const { data: drift0 = { critical: 0, warning: 0, info: 0 } } = useDriftCounts(projectId, slots[0]?.scenario.id ?? null);
  const { data: drift1 = { critical: 0, warning: 0, info: 0 } } = useDriftCounts(projectId, slots[1]?.scenario.id ?? null);
  const { data: drift2 = { critical: 0, warning: 0, info: 0 } } = useDriftCounts(projectId, slots[2]?.scenario.id ?? null);

  const projections = [proj0, proj1, proj2];
  const stresses = [stress0, stress1, stress2];
  const drifts = [drift0, drift1, drift2];

  if (slots.length === 0) {
    return null;
  }

  // Find baseline & recommended indices for delta row
  const baseIdx = slots.findIndex(s => s.tags.includes('Baseline'));
  const recIdx = slots.findIndex(s => s.tags.includes('Recommended'));

  return (
    <div className="space-y-3">
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4" />
            Scenario Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {slots.map((slot, i) => (
              <ScenarioCard
                key={slot.scenario.id}
                data={{
                  scenario: slot.scenario,
                  tags: slot.tags,
                  projection: projections[i],
                  stress: stresses[i],
                  drift: drifts[i],
                }}
                activeScenarioId={activeScenarioId}
                onSetActive={onSetActive}
                isSettingActive={isSettingActive}
                onTogglePin={onTogglePin}
                isTogglingPin={isTogglingPin}
                onRunProjection={onRunProjection}
                isProjecting={isProjecting}
                onRunStressTest={onRunStressTest}
                isRunningStress={isRunningStress}
              />
            ))}
          </div>

          {baseIdx >= 0 && recIdx >= 0 && baseIdx !== recIdx && (
            <DeltaRow
              baselineProj={projections[baseIdx]}
              recommendedProj={projections[recIdx]}
              baselineStress={stresses[baseIdx]}
              recommendedStress={stresses[recIdx]}
              baselineDrift={drifts[baseIdx]}
              recommendedDrift={drifts[recIdx]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

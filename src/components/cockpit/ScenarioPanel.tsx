import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ProjectScenario } from '@/hooks/useStateGraph';
import { GitBranch, Sparkles, Plus, ChevronDown, ChevronUp, Pin, PinOff, Archive, Zap, Trophy, BarChart3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  scenarios: ProjectScenario[];
  baseline: ProjectScenario | undefined;
  recommendedScenario: ProjectScenario | undefined;
  onGenerateSystem: () => void;
  onCreateCustom: (name: string, desc: string, overrides: any) => void;
  onTogglePin: (scenarioId: string) => void;
  onArchive: (scenarioId: string) => void;
  onSetActive: (scenarioId: string) => void;
  onRankScenarios: () => void;
  isGenerating: boolean;
  isCreating: boolean;
  isSettingActive: boolean;
  isRanking: boolean;
}

function DeltaChip({ label, delta }: { label: string; delta: { from: number; to: number; delta: number } }) {
  const positive = delta.delta > 0;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${positive ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
      {label}: {positive ? '+' : ''}{delta.delta}
    </span>
  );
}

function RankBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground font-mono pt-1">
      {Object.entries(breakdown).map(([key, val]) => (
        <div key={key} className="flex justify-between">
          <span>{key.replace(/_/g, ' ')}</span>
          <span className={val < 0 ? 'text-destructive' : ''}>{val > 0 ? '+' : ''}{val}</span>
        </div>
      ))}
    </div>
  );
}

export function ScenarioPanel({
  scenarios, baseline, recommendedScenario,
  onGenerateSystem, onCreateCustom, onTogglePin, onArchive, onSetActive, onRankScenarios,
  isGenerating, isCreating, isSettingActive, isRanking,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const systemScenarios = scenarios.filter(s => s.scenario_type === 'system');
  const nonBaseline = scenarios.filter(s => s.scenario_type !== 'baseline');

  const showSetRecommendedActive = recommendedScenario && !recommendedScenario.is_active;

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4" /> Scenarios
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onRankScenarios} disabled={isRanking || scenarios.length < 2}>
            <BarChart3 className="h-3 w-3 mr-1" />
            {isRanking ? 'Ranking…' : 'Rank Scenarios'}
          </Button>
          {systemScenarios.length === 0 && (
            <Button size="sm" variant="outline" onClick={onGenerateSystem} disabled={isGenerating}>
              <Sparkles className="h-3 w-3 mr-1" />
              {isGenerating ? 'Generating…' : 'Generate Strategic Lanes'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-3 w-3 mr-1" /> Custom
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Set Recommended Active prompt */}
        {showSetRecommendedActive && (
          <div className="flex items-center justify-between border border-primary/30 bg-primary/5 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Recommended:</span>
              <span className="text-muted-foreground">{recommendedScenario.name}</span>
              <span className="font-mono text-primary">{recommendedScenario.rank_score?.toFixed(1)}</span>
            </div>
            <Button size="sm" variant="default" className="h-6 px-2 text-[10px]"
              onClick={() => onSetActive(recommendedScenario.id)}
              disabled={isSettingActive}>
              <Zap className="h-3 w-3 mr-0.5" /> Set Recommended Active
            </Button>
          </div>
        )}

        {showCreate && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <Input placeholder="Scenario name" value={newName} onChange={e => setNewName(e.target.value)} />
            <Textarea placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} />
            <Button size="sm" disabled={!newName.trim() || isCreating}
              onClick={() => { onCreateCustom(newName, newDesc, {}); setNewName(''); setNewDesc(''); setShowCreate(false); }}>
              {isCreating ? 'Creating…' : 'Create Scenario'}
            </Button>
          </div>
        )}

        {nonBaseline.map(sc => {
          const expanded = expandedId === sc.id;
          const delta = sc.delta_vs_baseline || {};
          const allDeltas: { layer: string; key: string; d: any }[] = [];
          for (const [layer, fields] of Object.entries(delta)) {
            for (const [key, d] of Object.entries(fields as any)) {
              if ((d as any).delta !== undefined) allDeltas.push({ layer, key, d });
            }
          }

          return (
            <div key={sc.id} className={`border rounded-lg p-3 space-y-2 ${sc.is_active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : sc.pinned ? 'border-primary/40 bg-primary/5' : 'border-border/40'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 cursor-pointer flex-1" onClick={() => setExpandedId(expanded ? null : sc.id)}>
                  <Badge variant="outline" className="text-[10px]">{sc.scenario_type}</Badge>
                  {sc.is_active && <Badge className="text-[10px] bg-primary text-primary-foreground">ACTIVE</Badge>}
                  {sc.is_recommended && <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30" variant="outline"><Trophy className="h-2.5 w-2.5 mr-0.5" />REC</Badge>}
                  {sc.pinned && <Pin className="h-3 w-3 text-primary" />}
                  <span className="text-sm font-medium">{sc.name}</span>
                  {sc.rank_score != null && (
                    <span className="text-[10px] font-mono text-muted-foreground ml-1">{sc.rank_score.toFixed(1)}</span>
                  )}
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </div>
                <div className="flex items-center gap-1">
                  {!sc.is_active && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onSetActive(sc.id)} disabled={isSettingActive} title="Set as active plan">
                      <Zap className="h-3 w-3 mr-0.5" /> Set Active
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onTogglePin(sc.id)} title={sc.pinned ? 'Unpin' : 'Pin'}>
                    {sc.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onArchive(sc.id)} title="Archive">
                    <Archive className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {sc.description && <p className="text-xs text-muted-foreground">{sc.description}</p>}
              {(sc.coherence_flags as string[])?.length > 0 && (
                <div className="space-y-1">
                  {(sc.coherence_flags as string[]).map((f, i) => (
                    <p key={i} className="text-[10px] text-destructive">⚠ {f}</p>
                  ))}
                </div>
              )}
              {expanded && allDeltas.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {allDeltas.slice(0, 12).map(({ key, d }) => (
                    <DeltaChip key={key} label={key} delta={d} />
                  ))}
                </div>
              )}
              {expanded && sc.rank_breakdown && (
                <RankBreakdown breakdown={sc.rank_breakdown} />
              )}
            </div>
          );
        })}

        {nonBaseline.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No scenarios yet. Generate strategic lanes or create a custom scenario.</p>
        )}
      </CardContent>
    </Card>
  );
}

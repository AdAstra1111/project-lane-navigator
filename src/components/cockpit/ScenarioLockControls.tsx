import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, Unlock } from 'lucide-react';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  onSetLock: (params: { scenarioId: string; isLocked: boolean; protectedPaths?: string[] }) => void;
  isSaving: boolean;
}

export function ScenarioLockControls({ projectId, scenarios, activeScenarioId, onSetLock, isSaving }: Props) {
  const nonArchived = useMemo(() => scenarios.filter(s => !s.is_archived), [scenarios]);

  const defaultId = useMemo(() => {
    if (activeScenarioId) return activeScenarioId;
    const baseline = nonArchived.find(s => s.scenario_type === 'baseline');
    return baseline?.id ?? nonArchived[0]?.id ?? '';
  }, [nonArchived, activeScenarioId]);

  const [selectedId, setSelectedId] = useState(defaultId);

  const selected = useMemo(() => nonArchived.find(s => s.id === selectedId), [nonArchived, selectedId]);

  const [locked, setLocked] = useState(selected?.is_locked ?? false);
  const [pathsText, setPathsText] = useState((selected?.protected_paths ?? []).join('\n'));

  // Sync when scenario selection changes
  const handleSelect = (id: string) => {
    setSelectedId(id);
    const s = nonArchived.find(sc => sc.id === id);
    setLocked(s?.is_locked ?? false);
    setPathsText((s?.protected_paths ?? []).join('\n'));
  };

  const handleSave = () => {
    if (!selectedId) return;
    const paths = pathsText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    onSetLock({ scenarioId: selectedId, isLocked: locked, protectedPaths: paths });
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          Scenario Lock &amp; Protected Paths
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[180px]">
            <label className="text-[10px] text-muted-foreground font-medium">Scenario</label>
            <Select value={selectedId} onValueChange={handleSelect}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nonArchived.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                    {s.is_locked && ' 🔒'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 mb-0.5">
            <Switch checked={locked} onCheckedChange={setLocked} />
            <span className="text-xs text-muted-foreground">{locked ? 'Locked' : 'Unlocked'}</span>
          </div>

          {selected?.locked_at && (
            <Badge variant="outline" className="text-[10px] mb-0.5">
              Locked {new Date(selected.locked_at).toLocaleDateString()}
            </Badge>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium">Protected Paths (one per line)</label>
          <Textarea
            className="text-xs font-mono min-h-[60px]"
            placeholder="finance_state.budget_estimate&#10;production_state.estimated_shoot_days"
            value={pathsText}
            onChange={e => setPathsText(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Merges targeting these paths will require force confirmation.
          </p>
        </div>

        <Button size="sm" className="h-8 text-xs" disabled={isSaving || !selectedId} onClick={handleSave}>
          {isSaving ? 'Saving…' : 'Save Lock Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProjectStateGraph } from '@/hooks/useStateGraph';
import { RefreshCw } from 'lucide-react';

interface Props {
  stateGraph: ProjectStateGraph;
  onCascade: (overrides: any, scenarioId?: string) => void;
  isPending: boolean;
}

export function CascadeSimulator({ stateGraph, onCascade, isPending }: Props) {
  const c = stateGraph.creative_state;
  const [hookIntensity, setHookIntensity] = useState(c.hook_intensity);
  const [structuralDensity, setStructuralDensity] = useState(c.structural_density);
  const [characterDensity, setCharacterDensity] = useState(c.character_density);
  const [behaviourMode, setBehaviourMode] = useState(c.behaviour_mode);
  const [nightRatio, setNightRatio] = useState(stateGraph.execution_state.night_exterior_ratio);
  const [vfxDensity, setVfxDensity] = useState(stateGraph.execution_state.vfx_stunt_density);

  const hasChanges = hookIntensity !== c.hook_intensity ||
    structuralDensity !== c.structural_density ||
    characterDensity !== c.character_density ||
    behaviourMode !== c.behaviour_mode ||
    nightRatio !== stateGraph.execution_state.night_exterior_ratio ||
    vfxDensity !== stateGraph.execution_state.vfx_stunt_density;

  const handleCascade = () => {
    onCascade({
      creative_state: { hook_intensity: hookIntensity, structural_density: structuralDensity, character_density: characterDensity, behaviour_mode: behaviourMode },
      execution_state: { night_exterior_ratio: nightRatio, vfx_stunt_density: vfxDensity },
    });
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Cascade Simulator
        </CardTitle>
        <Button size="sm" disabled={!hasChanges || isPending} onClick={handleCascade}>
          {isPending ? 'Cascading…' : 'Recalculate'}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SliderField label="Hook Intensity" value={hookIntensity} onChange={setHookIntensity} />
          <SliderField label="Structural Density" value={structuralDensity} onChange={setStructuralDensity} />
          <SliderField label="Character Density" value={characterDensity} onChange={setCharacterDensity} />
          <SliderField label="Night Ext Ratio" value={nightRatio} onChange={setNightRatio} max={1} step={0.05} />
          <SliderField label="VFX/Stunt Density" value={vfxDensity} onChange={setVfxDensity} />
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Behaviour Mode</label>
            <Select value={behaviourMode} onValueChange={setBehaviourMode}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="efficiency">Efficiency</SelectItem>
                <SelectItem value="market">Market</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="prestige">Prestige</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SliderField({ label, value, onChange, max = 10, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; max?: number; step?: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value.toFixed(1)}</span>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={0} max={max} step={step} className="w-full" />
    </div>
  );
}

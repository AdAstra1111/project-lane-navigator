/**
 * WorldPopulationControl — Segmented density selector for background character richness.
 * Non-canonical: controls prompt injection only, never enters canon or CCE.
 */
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, HelpCircle } from 'lucide-react';
import type { WorldPopulationDensity } from '@/lib/rulesets/uiState';

interface Props {
  value: WorldPopulationDensity;
  onChange: (v: WorldPopulationDensity) => void;
  disabled?: boolean;
}

const OPTIONS: { value: WorldPopulationDensity; label: string; description: string }[] = [
  { value: 'minimal', label: 'Minimal', description: 'Core characters only — lean, focused scenes' },
  { value: 'moderate', label: 'Moderate', description: 'Light secondary presence — guards, attendants, etc.' },
  { value: 'rich', label: 'Rich', description: 'Dense social texture — multiple layers of world activity' },
];

export function WorldPopulationControl({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          World Population Density
        </span>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              Controls the presence of secondary/background characters (guards, attendants,
              townspeople, etc.) to create a more lived-in world. Does not affect core story or canon.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as WorldPopulationDensity)}
        disabled={disabled}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              <div>
                <span className="font-medium">{opt.label}</span>
                <span className="text-muted-foreground ml-1.5">— {opt.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

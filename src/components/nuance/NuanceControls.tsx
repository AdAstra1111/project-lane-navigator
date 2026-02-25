/**
 * NuanceControls — Accordion UI for story nuance configuration.
 */
import React from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Brain } from 'lucide-react';
import {
  STORY_ENGINES, ANTI_TROPE_OPTIONS, CONFLICT_MODES,
  type NuanceProfile, type StoryEngine, type AntiTrope, type ConflictMode,
} from '@/lib/nuance/types';

interface NuanceControlsProps {
  profile: NuanceProfile;
  onChange: (profile: NuanceProfile) => void;
  conflictMode?: ConflictMode;
  onConflictModeChange?: (mode: ConflictMode) => void;
}

const ENGINE_LABELS: Record<StoryEngine, string> = {
  pressure_cooker: 'Pressure Cooker',
  two_hander: 'Two-Hander',
  slow_burn_investigation: 'Slow Burn Investigation',
  social_realism: 'Social Realism',
  moral_trap: 'Moral Trap',
  character_spiral: 'Character Spiral',
  rashomon: 'Rashomon',
  anti_plot: 'Anti-Plot',
};

const TROPE_LABELS: Record<AntiTrope, string> = {
  secret_organization: 'Secret Organization',
  hidden_bloodline: 'Hidden Bloodline',
  chosen_one_destiny: 'Chosen One / Destiny',
  kidnapping_as_fuel: 'Kidnapping as Fuel',
  sudden_murder_for_stakes: 'Sudden Murder for Stakes',
  everything_is_connected: 'Everything is Connected',
  villain_monologue: 'Villain Monologue',
  last_minute_double_betrayal: 'Last-Minute Double Betrayal',
};

const CONFLICT_MODE_LABELS: Record<ConflictMode, string> = {
  romance_misalignment: 'Romance / Misalignment',
  status_reputation: 'Status / Reputation',
  money_time_pressure: 'Money / Time Pressure',
  family_obligation: 'Family Obligation',
  workplace_power: 'Workplace Power',
  moral_trap: 'Moral Trap',
  identity_shame: 'Identity / Shame',
  legal_procedural: 'Legal / Procedural',
};

export function NuanceControls({ profile, onChange, conflictMode, onConflictModeChange }: NuanceControlsProps) {
  const toggleTrope = (trope: AntiTrope) => {
    const current = profile.antiTropes;
    const next = current.includes(trope)
      ? current.filter(t => t !== trope)
      : [...current, trope];
    onChange({ ...profile, antiTropes: next });
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="nuance" className="border-border/50">
        <AccordionTrigger className="py-2 text-xs hover:no-underline">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Brain className="h-3.5 w-3.5" />
            Nuance Controls
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-1 pb-3">
          {/* Restraint Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">Restraint</label>
              <span className="text-[11px] tabular-nums text-foreground">{profile.restraint}</span>
            </div>
            <Slider
              value={[profile.restraint]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => onChange({ ...profile, restraint: v })}
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>Bold</span>
              <span>Restrained</span>
            </div>
          </div>

          {/* Story Engine */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Story Engine</label>
            <Select
              value={profile.storyEngine}
              onValueChange={(v) => onChange({ ...profile, storyEngine: v as StoryEngine })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORY_ENGINES.map(e => (
                  <SelectItem key={e} value={e} className="text-xs">
                    {ENGINE_LABELS[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conflict Mode */}
          {onConflictModeChange && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Conflict Mode</label>
              <Select
                value={conflictMode || 'moral_trap'}
                onValueChange={(v) => onConflictModeChange(v as ConflictMode)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONFLICT_MODES.map(m => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {CONFLICT_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Avoid Tropes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Avoid Tropes</label>
            <div className="flex flex-wrap gap-1">
              {ANTI_TROPE_OPTIONS.map(trope => (
                <Badge
                  key={trope}
                  variant={profile.antiTropes.includes(trope) ? 'default' : 'outline'}
                  className="text-[9px] cursor-pointer select-none"
                  onClick={() => toggleTrope(trope)}
                >
                  {TROPE_LABELS[trope]}
                </Badge>
              ))}
            </div>
          </div>

          {/* Auto-diversify toggle */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-muted-foreground">Auto-diversify vs last runs</label>
            <Switch
              checked={profile.diversify}
              onCheckedChange={(checked) => onChange({ ...profile, diversify: checked })}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}


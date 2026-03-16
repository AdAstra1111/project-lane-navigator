/**
 * DnaEngineSelector — Narrative DNA / Engine constraint selector for Pitch Ideas.
 * Modes: none | dna_profile | engine_only
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dna, Cpu, X } from 'lucide-react';
import { useDnaProfiles, type DnaProfile } from '@/hooks/useNarrativeDna';
import { useNarrativeEngines, type NarrativeEngine } from '@/hooks/useNarrativeEngines';

export type DnaConstraintMode = 'none' | 'dna_profile' | 'engine_only';

export interface DnaEngineSelection {
  mode: DnaConstraintMode;
  dnaProfileId: string | null;
  engineKey: string | null;
}

interface Props {
  value: DnaEngineSelection;
  onChange: (v: DnaEngineSelection) => void;
}

export function DnaEngineSelector({ value, onChange }: Props) {
  const { data: profiles = [] } = useDnaProfiles();
  const { data: engines = [] } = useNarrativeEngines();

  // Only locked profiles are eligible for pitch generation
  const lockedProfiles = profiles.filter(p => p.status === 'locked');

  const selectedProfile = lockedProfiles.find(p => p.id === value.dnaProfileId);
  const selectedEngine = engines.find(e => e.engine_key === value.engineKey);

  // Derive engine display from profile if in dna_profile mode
  const profileEngine = selectedProfile
    ? engines.find(e => e.engine_key === (selectedProfile as any).primary_engine_key)
    : null;

  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-4 space-y-4">
        <div className="flex items-center gap-2">
          <Dna className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Narrative DNA Constraints</span>
          <Badge variant="outline" className="text-[10px] ml-auto">Optional</Badge>
        </div>

        <RadioGroup
          value={value.mode}
          onValueChange={(m) => {
            const mode = m as DnaConstraintMode;
            onChange({
              mode,
              dnaProfileId: mode === 'dna_profile' ? value.dnaProfileId : null,
              engineKey: mode === 'engine_only' ? value.engineKey : null,
            });
          }}
          className="flex flex-wrap gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="none" id="dna-none" />
            <Label htmlFor="dna-none" className="text-sm cursor-pointer">None</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="dna_profile" id="dna-profile" />
            <Label htmlFor="dna-profile" className="text-sm cursor-pointer">DNA Profile</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="engine_only" id="dna-engine" />
            <Label htmlFor="dna-engine" className="text-sm cursor-pointer">Engine Only</Label>
          </div>
        </RadioGroup>

        {value.mode === 'dna_profile' && (
          <div className="space-y-2">
            <Select
              value={value.dnaProfileId || ''}
              onValueChange={(id) => onChange({ ...value, dnaProfileId: id || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder={lockedProfiles.length === 0 ? 'No locked profiles' : 'Select locked DNA profile…'} />
              </SelectTrigger>
              <SelectContent>
                {lockedProfiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.source_title} — {p.source_type}
                    {(p as any).primary_engine_key ? ` [${(p as any).primary_engine_key}]` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedProfile && (
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
                <div className="font-medium text-foreground">{selectedProfile.source_title}</div>
                {selectedProfile.thematic_spine && (
                  <div><span className="text-muted-foreground">Thematic Spine:</span> {selectedProfile.thematic_spine}</div>
                )}
                {profileEngine && (
                  <div><span className="text-muted-foreground">Engine:</span> {profileEngine.engine_name}</div>
                )}
                {selectedProfile.extraction_confidence != null && (
                  <div><span className="text-muted-foreground">Confidence:</span> {Math.round(selectedProfile.extraction_confidence * 100)}%</div>
                )}
                <Badge variant="secondary" className="text-[10px] mt-1">Full spine + constraints active</Badge>
              </div>
            )}

            {lockedProfiles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Lock a DNA profile at /narrative-dna to use it here.
              </p>
            )}
          </div>
        )}

        {value.mode === 'engine_only' && (
          <div className="space-y-2">
            <Select
              value={value.engineKey || ''}
              onValueChange={(key) => onChange({ ...value, engineKey: key || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select engine pattern…" />
              </SelectTrigger>
              <SelectContent>
                {engines.map(e => (
                  <SelectItem key={e.engine_key} value={e.engine_key}>
                    {e.engine_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedEngine && (
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
                <div className="font-medium text-foreground">{selectedEngine.engine_name}</div>
                <div className="text-muted-foreground">{selectedEngine.description}</div>
                <Badge variant="outline" className="text-[10px] mt-1">Structural pattern only</Badge>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

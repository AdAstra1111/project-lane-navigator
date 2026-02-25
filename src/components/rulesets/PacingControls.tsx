/**
 * PacingControls — Pacing Feel + Genre Preset selectors with advanced BPM overrides.
 * Shows provenance badges (Derived / Preset / Overridden / Clamped).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Gauge, Save, Loader2, Info, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { OverridePatch } from '@/lib/rulesets/types';
import { validateAndClamp, getLaneClamps } from '@/lib/rulesets/validateAndClamp';
import {
  getPacingPreset,
  getDefaultFeel,
  PACING_FEEL_LABELS,
  GENRE_PRESET_LABELS,
  type PacingFeel,
  type GenrePreset,
  type PacingPresetResult,
} from '@/lib/rulesets/pacingPresets';

type Provenance = 'derived' | 'preset' | 'overridden' | 'clamped';

const PROVENANCE_COLORS: Record<Provenance, string> = {
  derived: 'bg-muted text-muted-foreground',
  preset: 'bg-primary/10 text-primary',
  overridden: 'bg-accent text-accent-foreground',
  clamped: 'bg-destructive/10 text-destructive',
};

function ProvenanceBadge({ type }: { type: Provenance }) {
  return (
    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 ${PROVENANCE_COLORS[type]}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

interface PacingControlsProps {
  projectId: string;
  lane: string;
  userId: string;
  engineProfile: { id: string; rules: any } | null;
  savedFeel?: string;
  savedGenrePreset?: string | null;
  onPacingApplied?: () => void;
  onPrefsChanged?: (prefs: { pacing_feel: string; genre_preset: string | null }) => void;
}

export function PacingControls({
  projectId,
  lane,
  userId,
  engineProfile,
  savedFeel,
  savedGenrePreset,
  onPacingApplied,
  onPrefsChanged,
}: PacingControlsProps) {
  const clamps = getLaneClamps(lane);
  const currentBpm = engineProfile?.rules?.pacing_profile?.beats_per_minute;

  // Feel + Genre state
  const [feel, setFeel] = useState<PacingFeel>((savedFeel as PacingFeel) || getDefaultFeel(lane));
  const [genrePreset, setGenrePreset] = useState<GenrePreset | null>(
    (savedGenrePreset as GenrePreset) || null
  );

  // BPM state
  const [pacingMin, setPacingMin] = useState<number>(currentBpm?.min ?? 3);
  const [pacingTarget, setPacingTarget] = useState<number>(currentBpm?.target ?? 3.6);
  const [pacingMax, setPacingMax] = useState<number>(currentBpm?.max ?? 5);
  const [quietBeats, setQuietBeats] = useState<number>(engineProfile?.rules?.pacing_profile?.quiet_beats_min ?? 1);
  const [subtextScenes, setSubtextScenes] = useState<number>(engineProfile?.rules?.pacing_profile?.subtext_scenes_min ?? 2);
  const [meaningShifts, setMeaningShifts] = useState<number>(engineProfile?.rules?.pacing_profile?.meaning_shifts_min_per_act ?? 1);

  const [bypassClamps, setBypassClamps] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clampWarnings, setClampWarnings] = useState<string[]>([]);
  const [provenance, setProvenance] = useState<Provenance>('derived');
  const [manuallyEdited, setManuallyEdited] = useState(false);

  // Sync from engine profile on load
  useEffect(() => {
    if (currentBpm) {
      setPacingMin(currentBpm.min);
      setPacingTarget(currentBpm.target);
      setPacingMax(currentBpm.max);
    }
    if (engineProfile?.rules?.pacing_profile) {
      setQuietBeats(engineProfile.rules.pacing_profile.quiet_beats_min ?? 1);
      setSubtextScenes(engineProfile.rules.pacing_profile.subtext_scenes_min ?? 2);
      setMeaningShifts(engineProfile.rules.pacing_profile.meaning_shifts_min_per_act ?? 1);
    }
  }, [currentBpm?.min, currentBpm?.target, currentBpm?.max, engineProfile?.rules?.pacing_profile]);

  // Sync saved prefs
  useEffect(() => {
    if (savedFeel) setFeel(savedFeel as PacingFeel);
    if (savedGenrePreset !== undefined) setGenrePreset(savedGenrePreset as GenrePreset | null);
  }, [savedFeel, savedGenrePreset]);

  // Apply preset when feel/genre changes (only if not manually edited)
  const applyPreset = useCallback(() => {
    const preset = getPacingPreset(lane, feel, genrePreset);
    setPacingMin(preset.beats_per_minute.min);
    setPacingTarget(preset.beats_per_minute.target);
    setPacingMax(preset.beats_per_minute.max);
    setQuietBeats(preset.quiet_beats_min);
    setSubtextScenes(preset.subtext_scenes_min);
    setMeaningShifts(preset.meaning_shifts_min_per_act);
    setProvenance('preset');
    setManuallyEdited(false);
    onPrefsChanged?.({ pacing_feel: feel, genre_preset: genrePreset });
  }, [lane, feel, genrePreset, onPrefsChanged]);

  // Validation
  useEffect(() => {
    if (!engineProfile?.rules) return;
    const testRules = JSON.parse(JSON.stringify(engineProfile.rules));
    testRules.pacing_profile = testRules.pacing_profile || {};
    testRules.pacing_profile.beats_per_minute = { min: pacingMin, target: pacingTarget, max: pacingMax };
    const { rules: clamped, warnings } = validateAndClamp(testRules, lane, bypassClamps);
    setClampWarnings(warnings);
    const cb = clamped.pacing_profile.beats_per_minute;
    if (cb.min !== pacingMin || cb.target !== pacingTarget || cb.max !== pacingMax) {
      if (provenance !== 'clamped') setProvenance('clamped');
    }
  }, [pacingMin, pacingTarget, pacingMax, lane, bypassClamps, engineProfile?.rules]);

  const handleManualChange = (setter: (v: number) => void) => (value: number) => {
    setter(value);
    setManuallyEdited(true);
    setProvenance('overridden');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const draftRules = engineProfile?.rules ? JSON.parse(JSON.stringify(engineProfile.rules)) : {};
      draftRules.pacing_profile = draftRules.pacing_profile || {};
      draftRules.pacing_profile.beats_per_minute = { min: pacingMin, target: pacingTarget, max: pacingMax };
      const { rules: clamped } = validateAndClamp(draftRules, lane, bypassClamps);
      const cb = clamped.pacing_profile.beats_per_minute;

      setPacingMin(cb.min);
      setPacingTarget(cb.target);
      setPacingMax(cb.max);

      const patch: OverridePatch[] = [
        { op: 'replace', path: '/pacing_profile/beats_per_minute/min', value: cb.min },
        { op: 'replace', path: '/pacing_profile/beats_per_minute/target', value: cb.target },
        { op: 'replace', path: '/pacing_profile/beats_per_minute/max', value: cb.max },
        { op: 'replace', path: '/pacing_profile/quiet_beats_min', value: quietBeats },
        { op: 'replace', path: '/pacing_profile/subtext_scenes_min', value: subtextScenes },
        { op: 'replace', path: '/pacing_profile/meaning_shifts_min_per_act', value: meaningShifts },
      ];

      await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'apply_override',
          project_id: projectId,
          lane,
          user_id: userId,
          scope: saveAsDefault ? 'project_default' : 'run',
          patch,
        },
      });

      onPacingApplied?.();
    } catch (err) {
      console.error('Save pacing error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── Pacing Feel + Genre ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] font-medium">Pacing Feel</Label>
          <Select value={feel} onValueChange={(v) => setFeel(v as PacingFeel)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PACING_FEEL_LABELS) as PacingFeel[]).map((f) => (
                <SelectItem key={f} value={f} className="text-xs">
                  {PACING_FEEL_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-medium">Genre Preset</Label>
          <Select value={genrePreset || '_none'} onValueChange={(v) => setGenrePreset(v === '_none' ? null : v as GenrePreset)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none" className="text-xs">None</SelectItem>
              {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                <SelectItem key={g} value={g} className="text-xs">
                  {GENRE_PRESET_LABELS[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button size="sm" variant="outline" onClick={applyPreset} className="h-7 text-xs w-full">
        Apply Preset
      </Button>

      {/* ── Target BPM display ── */}
      <div className="bg-muted/30 p-3 rounded-md">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Gauge className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium">Target BPM</span>
          </div>
          <ProvenanceBadge type={provenance} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold font-mono text-foreground">{pacingTarget}</span>
          <span className="text-[10px] text-muted-foreground">BPM</span>
        </div>
        <p className="text-[9px] text-muted-foreground mt-0.5">
          Range: {pacingMin}–{pacingMax} BPM
        </p>
      </div>

      {/* ── Pacing details (quiet/subtext/meaning) ── */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="bg-muted/30 p-2 rounded">
          <span className="text-muted-foreground">Quiet Beats</span>
          <p className="font-medium font-mono">{quietBeats}</p>
        </div>
        <div className="bg-muted/30 p-2 rounded">
          <span className="text-muted-foreground">Subtext Scenes</span>
          <p className="font-medium font-mono">{subtextScenes}</p>
        </div>
        <div className="bg-muted/30 p-2 rounded">
          <span className="text-muted-foreground">Meaning Shifts</span>
          <p className="font-medium font-mono">{meaningShifts}/act</p>
        </div>
      </div>

      {/* ── Clamp warnings ── */}
      {clampWarnings.length > 0 && (
        <div className="space-y-1 p-2 rounded-md bg-destructive/5 border border-destructive/20">
          {clampWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[9px]">
              <Info className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Advanced BPM Override ── */}
      <Accordion type="single" collapsible>
        <AccordionItem value="advanced-bpm" className="border-border/50">
          <AccordionTrigger className="py-1.5 text-[10px] hover:no-underline text-muted-foreground">
            Advanced BPM Override
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-1">
            {/* Target slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-medium">Target BPM</Label>
                {manuallyEdited && <ProvenanceBadge type="overridden" />}
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  value={[pacingTarget]}
                  onValueChange={([v]) => handleManualChange(setPacingTarget)(v)}
                  min={bypassClamps ? 0.5 : clamps.target.floor}
                  max={bypassClamps ? 10 : clamps.target.ceiling}
                  step={0.1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={pacingTarget}
                  onChange={(e) => handleManualChange(setPacingTarget)(Number(e.target.value))}
                  step={0.1}
                  className="w-16 h-7 text-xs text-center font-mono"
                />
              </div>
            </div>

            {/* Min / Max */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min BPM</Label>
                <Input
                  type="number"
                  value={pacingMin}
                  onChange={(e) => handleManualChange(setPacingMin)(Number(e.target.value))}
                  step={0.1}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max BPM</Label>
                <Input
                  type="number"
                  value={pacingMax}
                  onChange={(e) => handleManualChange(setPacingMax)(Number(e.target.value))}
                  step={0.1}
                  className="h-7 text-xs font-mono"
                />
              </div>
            </div>

            {/* Quiet / Subtext / Meaning overrides */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Quiet Beats Min</Label>
                <Input
                  type="number"
                  value={quietBeats}
                  onChange={(e) => { setQuietBeats(Number(e.target.value)); setManuallyEdited(true); setProvenance('overridden'); }}
                  min={0}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Subtext Min</Label>
                <Input
                  type="number"
                  value={subtextScenes}
                  onChange={(e) => { setSubtextScenes(Number(e.target.value)); setManuallyEdited(true); setProvenance('overridden'); }}
                  min={0}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Meaning Shifts</Label>
                <Input
                  type="number"
                  value={meaningShifts}
                  onChange={(e) => { setMeaningShifts(Number(e.target.value)); setManuallyEdited(true); setProvenance('overridden'); }}
                  min={0}
                  className="h-7 text-xs font-mono"
                />
              </div>
            </div>

            {/* Bypass clamps */}
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={bypassClamps} onCheckedChange={setBypassClamps} />
              <Label className="text-[10px] text-muted-foreground">
                Allow out-of-lane pacing <span className="text-destructive">(not recommended)</span>
              </Label>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ── Scope + Save ── */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Switch checked={saveAsDefault} onCheckedChange={setSaveAsDefault} />
          <Label className="text-[10px] text-muted-foreground">
            {saveAsDefault ? 'Project default' : 'This run only'}
          </Label>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Apply Pacing
        </Button>
      </div>
    </div>
  );
}

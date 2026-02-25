import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, Shield, Code, Save, Loader2, Gauge, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { RuleConflict, OverridePatch } from '@/lib/rulesets/types';
import { validateAndClamp, getLaneClamps, getLaneDefaults } from '@/lib/rulesets/validateAndClamp';

interface WorldRulesPanelProps {
  projectId: string;
  lane: string;
  userId: string;
  engineProfile?: {
    id: string;
    rules: any;
    rules_summary: string;
    conflicts: RuleConflict[];
  } | null;
  onRulesChanged?: () => void;
}

export function WorldRulesPanel({
  projectId,
  lane,
  userId,
  engineProfile,
  onRulesChanged,
}: WorldRulesPanelProps) {
  const [showJson, setShowJson] = useState(false);
  const [jsonEdit, setJsonEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // Pacing override state
  const laneDefaults = getLaneDefaults(lane);
  const clamps = getLaneClamps(lane);
  const currentBpm = engineProfile?.rules?.pacing_profile?.beats_per_minute;

  const [pacingMin, setPacingMin] = useState<number>(currentBpm?.min ?? laneDefaults.min);
  const [pacingTarget, setPacingTarget] = useState<number>(currentBpm?.target ?? laneDefaults.target);
  const [pacingMax, setPacingMax] = useState<number>(currentBpm?.max ?? laneDefaults.max);
  const [bypassClamps, setBypassClamps] = useState(false);
  const [pacingSaving, setPacingSaving] = useState(false);
  const [clampWarnings, setClampWarnings] = useState<string[]>([]);

  // Sync from engine profile
  useEffect(() => {
    if (currentBpm) {
      setPacingMin(currentBpm.min);
      setPacingTarget(currentBpm.target);
      setPacingMax(currentBpm.max);
    }
  }, [currentBpm?.min, currentBpm?.target, currentBpm?.max]);

  // Run validation whenever values change
  useEffect(() => {
    if (!engineProfile?.rules) return;
    const testRules = JSON.parse(JSON.stringify(engineProfile.rules));
    testRules.pacing_profile = testRules.pacing_profile || {};
    testRules.pacing_profile.beats_per_minute = { min: pacingMin, target: pacingTarget, max: pacingMax };
    const { warnings } = validateAndClamp(testRules, lane, bypassClamps);
    setClampWarnings(warnings);
  }, [pacingMin, pacingTarget, pacingMax, lane, bypassClamps, engineProfile?.rules]);

  useEffect(() => {
    if (engineProfile?.rules) {
      setJsonEdit(JSON.stringify(engineProfile.rules, null, 2));
    }
  }, [engineProfile]);

  const handleSavePacingOverride = async () => {
    setPacingSaving(true);
    try {
      // Apply clamping before saving
      const draftRules = engineProfile?.rules ? JSON.parse(JSON.stringify(engineProfile.rules)) : {};
      draftRules.pacing_profile = draftRules.pacing_profile || {};
      draftRules.pacing_profile.beats_per_minute = { min: pacingMin, target: pacingTarget, max: pacingMax };
      const { rules: clamped } = validateAndClamp(draftRules, lane, bypassClamps);
      const clampedBpm = clamped.pacing_profile.beats_per_minute;

      // Update local state with clamped values
      setPacingMin(clampedBpm.min);
      setPacingTarget(clampedBpm.target);
      setPacingMax(clampedBpm.max);

      const patch: OverridePatch[] = [
        { op: 'replace', path: '/pacing_profile/beats_per_minute/min', value: clampedBpm.min },
        { op: 'replace', path: '/pacing_profile/beats_per_minute/target', value: clampedBpm.target },
        { op: 'replace', path: '/pacing_profile/beats_per_minute/max', value: clampedBpm.max },
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

      onRulesChanged?.();
    } catch (err) {
      console.error('Save pacing override error:', err);
    } finally {
      setPacingSaving(false);
    }
  };

  const handleSaveOverride = async () => {
    setSaving(true);
    try {
      let patch: OverridePatch[];
      try {
        const edited = JSON.parse(jsonEdit);
        patch = [{ op: 'replace', path: '/', value: edited }];
      } catch {
        console.error('Invalid JSON');
        setSaving(false);
        return;
      }

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

      onRulesChanged?.();
    } catch (err) {
      console.error('Save override error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!engineProfile) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          No engine profile built yet. Find comparables first.
        </CardContent>
      </Card>
    );
  }

  const conflicts = engineProfile.conflicts || [];
  const hardConflicts = conflicts.filter(c => c.severity === 'hard');

  // Resolved display values (post-clamp)
  const displayBpm = currentBpm || laneDefaults;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          World Rules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-muted/50 p-2 rounded-md">
          {engineProfile.rules_summary}
        </pre>

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <Accordion type="single" collapsible>
            <AccordionItem value="conflicts" className="border-border/50">
              <AccordionTrigger className="py-2 text-xs hover:no-underline">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''} Detected
                  {hardConflicts.length > 0 && (
                    <Badge variant="destructive" className="text-[8px] ml-1">{hardConflicts.length} hard</Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2">
                {conflicts.map((c, i) => (
                  <div
                    key={c.id || i}
                    className={`p-2 rounded-md border text-[10px] ${
                      c.severity === 'hard'
                        ? 'border-destructive/50 bg-destructive/5'
                        : 'border-border/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant={c.severity === 'hard' ? 'destructive' : 'outline'} className="text-[8px]">
                        {c.severity}
                      </Badge>
                      <Badge variant="secondary" className="text-[8px]">{c.dimension}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{c.message}</p>
                    <div className="mt-1 flex gap-1">
                      {c.suggested_actions?.map(a => (
                        <Badge key={a} variant="outline" className="text-[8px]">{a.replace(/_/g, ' ')}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* Key Rules Quick View — FIXED: show target BPM prominently */}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-muted/30 p-2 rounded col-span-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Gauge className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground font-medium">Pacing</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-foreground">{displayBpm.target}</span>
              <span className="text-muted-foreground">target BPM</span>
            </div>
            <p className="text-muted-foreground mt-0.5">
              Range: {displayBpm.min}–{displayBpm.max} BPM
            </p>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <span className="text-muted-foreground">Drama Budget</span>
            <p className="font-medium">{engineProfile.rules?.budgets?.drama_budget}</p>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <span className="text-muted-foreground">Twist Cap</span>
            <p className="font-medium">{engineProfile.rules?.budgets?.twist_cap}</p>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <span className="text-muted-foreground">Melodrama Max</span>
            <p className="font-medium">{engineProfile.rules?.gate_thresholds?.melodrama_max}</p>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <span className="text-muted-foreground">Quiet Beats Min</span>
            <p className="font-medium">{engineProfile.rules?.pacing_profile?.quiet_beats_min}</p>
          </div>
        </div>

        {/* ── Pacing Override Controls ── */}
        <Accordion type="single" collapsible>
          <AccordionItem value="pacing" className="border-border/50">
            <AccordionTrigger className="py-2 text-xs hover:no-underline">
              <span className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-primary" />
                Pacing Controls
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              {/* Target BPM — prominent slider */}
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium">Target BPM</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    value={[pacingTarget]}
                    onValueChange={([v]) => setPacingTarget(v)}
                    min={bypassClamps ? 0.5 : clamps.target.floor}
                    max={bypassClamps ? 10 : clamps.target.ceiling}
                    step={0.5}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={pacingTarget}
                    onChange={e => setPacingTarget(Number(e.target.value))}
                    step={0.5}
                    className="w-16 h-7 text-xs text-center font-mono"
                  />
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {lane.replace(/_/g, ' ')} lane range: {clamps.target.floor}–{clamps.target.ceiling} BPM
                </p>
              </div>

              {/* Min / Max row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Min BPM</Label>
                  <Input
                    type="number"
                    value={pacingMin}
                    onChange={e => setPacingMin(Number(e.target.value))}
                    step={0.5}
                    className="h-7 text-xs font-mono"
                  />
                  <p className="text-[8px] text-muted-foreground">Floor: {clamps.min.floor}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Max BPM</Label>
                  <Input
                    type="number"
                    value={pacingMax}
                    onChange={e => setPacingMax(Number(e.target.value))}
                    step={0.5}
                    className="h-7 text-xs font-mono"
                  />
                  <p className="text-[8px] text-muted-foreground">Ceiling: {clamps.max.ceiling}</p>
                </div>
              </div>

              {/* Clamp warnings */}
              {clampWarnings.length > 0 && (
                <div className="space-y-1 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                  {clampWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[9px]">
                      <Info className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Bypass toggle */}
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={bypassClamps} onCheckedChange={setBypassClamps} />
                <Label className="text-[10px] text-muted-foreground">
                  Allow out-of-lane pacing <span className="text-destructive">(not recommended)</span>
                </Label>
              </div>

              {/* Scope + Save */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Switch checked={saveAsDefault} onCheckedChange={setSaveAsDefault} />
                  <Label className="text-[10px] text-muted-foreground">
                    {saveAsDefault ? 'Project default' : 'This run only'}
                  </Label>
                </div>
                <Button size="sm" onClick={handleSavePacingOverride} disabled={pacingSaving} className="h-7 text-xs gap-1">
                  {pacingSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Apply Pacing
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Forbidden Moves */}
        {engineProfile.rules?.forbidden_moves?.length > 0 && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium">Forbidden Moves</label>
            <div className="flex flex-wrap gap-1">
              {engineProfile.rules.forbidden_moves.map((m: string) => (
                <Badge key={m} variant="destructive" className="text-[8px]">
                  {m.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Advanced JSON Editor */}
        <Accordion type="single" collapsible>
          <AccordionItem value="json" className="border-border/50">
            <AccordionTrigger className="py-2 text-xs hover:no-underline">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Code className="h-3.5 w-3.5" />
                Advanced Editor
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <Textarea
                value={jsonEdit}
                onChange={e => setJsonEdit(e.target.value)}
                className="font-mono text-[10px] min-h-[200px]"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch checked={saveAsDefault} onCheckedChange={setSaveAsDefault} />
                  <label className="text-[10px] text-muted-foreground">
                    {saveAsDefault ? 'Save as project default' : 'Run-only override'}
                  </label>
                </div>
                <Button size="sm" onClick={handleSaveOverride} disabled={saving} className="h-7 text-xs">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                  Save Override
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, Shield, Code, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { RuleConflict, OverridePatch } from '@/lib/rulesets/types';

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

  useEffect(() => {
    if (engineProfile?.rules) {
      setJsonEdit(JSON.stringify(engineProfile.rules, null, 2));
    }
  }, [engineProfile]);

  const handleSaveOverride = async () => {
    setSaving(true);
    try {
      let patch: OverridePatch[];
      try {
        const edited = JSON.parse(jsonEdit);
        // Create a replace patch for the whole rules object
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
  const warnConflicts = conflicts.filter(c => c.severity === 'warn');

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

        {/* Key Rules Quick View */}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
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

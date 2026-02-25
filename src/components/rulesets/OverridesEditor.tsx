import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { OverridePatch } from '@/lib/rulesets/types';

interface Props {
  projectId: string;
  lane: string;
  userId: string;
  currentRules?: Record<string, any> | null;
  onSaved?: () => void;
}

export function OverridesEditor({ projectId, lane, userId, currentRules, onSaved }: Props) {
  const [twistCap, setTwistCap] = useState(currentRules?.budgets?.twist_cap ?? 2);
  const [dramaBudget, setDramaBudget] = useState(currentRules?.budgets?.drama_budget ?? 3);
  const [noGlobalBefore, setNoGlobalBefore] = useState(currentRules?.stakes_ladder?.no_global_before_pct ?? 0.25);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const [jsonEdit, setJsonEdit] = useState('');
  const [saving, setSaving] = useState(false);

  const saveOverrides = async () => {
    setSaving(true);
    try {
      let patches: OverridePatch[];

      if (showJson && jsonEdit.trim()) {
        try {
          const edited = JSON.parse(jsonEdit);
          patches = [{ op: 'replace', path: '/', value: edited }];
        } catch {
          toast.error('Invalid JSON');
          setSaving(false);
          return;
        }
      } else {
        patches = [
          { op: 'replace', path: '/budgets/twist_cap', value: twistCap },
          { op: 'replace', path: '/budgets/drama_budget', value: dramaBudget },
          { op: 'replace', path: '/stakes_ladder/no_global_before_pct', value: noGlobalBefore },
        ];
      }

      await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'apply_override',
          project_id: projectId,
          lane,
          user_id: userId,
          scope: saveAsDefault ? 'project_default' : 'run',
          patch: patches,
        },
      });

      toast.success('Overrides saved');
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {!showJson && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Twist Cap</span>
              <span className="font-medium">{twistCap}</span>
            </div>
            <Slider value={[twistCap]} min={0} max={4} step={1} onValueChange={([v]) => setTwistCap(v)} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Drama Budget</span>
              <span className="font-medium">{dramaBudget}</span>
            </div>
            <Slider value={[dramaBudget]} min={1} max={5} step={1} onValueChange={([v]) => setDramaBudget(v)} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">No Global Stakes Before</span>
              <span className="font-medium">{Math.round(noGlobalBefore * 100)}%</span>
            </div>
            <Slider value={[noGlobalBefore]} min={0.1} max={0.5} step={0.05} onValueChange={([v]) => setNoGlobalBefore(v)} />
          </div>
        </div>
      )}

      {showJson && (
        <Textarea
          value={jsonEdit || JSON.stringify(currentRules || {}, null, 2)}
          onChange={e => setJsonEdit(e.target.value)}
          className="font-mono text-[10px] min-h-[160px]"
          placeholder="Paste rules JSON..."
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={showJson} onCheckedChange={setShowJson} />
          <span className="text-[10px] text-muted-foreground">{showJson ? 'JSON' : 'Simple'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={saveAsDefault} onCheckedChange={setSaveAsDefault} />
          <span className="text-[10px] text-muted-foreground">
            {saveAsDefault ? 'Project default' : 'Run-only'}
          </span>
        </div>
      </div>

      <Button size="sm" onClick={saveOverrides} disabled={saving} className="w-full h-7 text-xs">
        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
        Save Overrides
      </Button>
    </div>
  );
}

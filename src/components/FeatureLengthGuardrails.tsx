import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Shield, Clock, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  projectId: string;
  versionText: string;
  selectedDocId: string | null;
  selectedVersionId: string | null;
}

function estimateRuntime(text: string, mode: string) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const divisor = mode === 'dialogue_heavy' ? 200 : mode === 'lean' ? 240 : mode === 'action_heavy' ? 240 : 220;
  return { words, minutes: words / divisor };
}

export function FeatureLengthGuardrails({ projectId, versionText, selectedDocId, selectedVersionId }: Props) {
  const qc = useQueryClient();
  const [guardrailsOn, setGuardrailsOn] = useState(true);

  const { data: project } = useQuery({
    queryKey: ['project-runtime-settings', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('min_runtime_minutes, min_runtime_hard_floor, runtime_estimation_mode')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const mode = project?.runtime_estimation_mode ?? 'feature';
  const softMin = project?.min_runtime_minutes ?? 80;
  const hardFloor = project?.min_runtime_hard_floor ?? 70;

  const { words, minutes } = useMemo(() => estimateRuntime(versionText, mode), [versionText, mode]);

  const updateSettings = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('projects').update(updates).eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-runtime-settings', projectId] });
      toast.success('Runtime settings updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expandMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'expand-to-feature-floor',
          projectId,
          documentId: selectedDocId,
          versionId: selectedVersionId,
          currentText: versionText,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Expand error');
      return result;
    },
    onSuccess: (data) => {
      toast.success(`Expanded to ~${data.estimatedMinutes} mins (${data.wordCount?.toLocaleString()} words)`);
      qc.invalidateQueries({ queryKey: ['dev-v2-versions'] });
      qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isBelowSoft = minutes < softMin;
  const isBelowHard = minutes < hardFloor;

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Shield className="h-3 w-3" /> Feature Length Guardrails
          </CardTitle>
          <Switch checked={guardrailsOn} onCheckedChange={setGuardrailsOn} />
        </div>
      </CardHeader>
      {guardrailsOn && (
        <CardContent className="px-3 pb-3 space-y-3">
          {/* Current Runtime Estimate */}
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/30 border">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Est. Runtime</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-display">~{Math.round(minutes)} mins</span>
              <Badge variant={isBelowHard ? 'destructive' : isBelowSoft ? 'secondary' : 'default'} className="text-[9px]">
                {isBelowHard ? 'Below Floor' : isBelowSoft ? 'Below Pref' : 'OK'}
              </Badge>
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground">{words.toLocaleString()} words · ~{Math.round(words / 250)} pages · {mode} mode ({mode === 'dialogue_heavy' ? '200' : mode === 'lean' || mode === 'action_heavy' ? '240' : '220'} wpm)</p>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-muted-foreground">Min Preferred (mins)</label>
              <Input
                type="number" min={60} max={150}
                value={softMin}
                onChange={e => updateSettings.mutate({ min_runtime_minutes: Number(e.target.value) })}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Hard Floor (mins)</label>
              <Input
                type="number" min={40} max={120}
                value={hardFloor}
                onChange={e => updateSettings.mutate({ min_runtime_hard_floor: Number(e.target.value) })}
                className="h-7 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] text-muted-foreground">Estimation Mode</label>
            <Select
              value={mode}
              onValueChange={v => updateSettings.mutate({ runtime_estimation_mode: v })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feature">Feature (220 wpm)</SelectItem>
                <SelectItem value="dialogue_heavy">Dialogue Heavy (200 wpm)</SelectItem>
                <SelectItem value="action_heavy">Action Heavy (240 wpm)</SelectItem>
                <SelectItem value="lean">Lean (240 wpm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expand Button */}
          {isBelowSoft && selectedDocId && selectedVersionId && (
            <Button
              size="sm" className="w-full h-8 text-xs gap-1.5"
              onClick={() => expandMutation.mutate()}
              disabled={expandMutation.isPending}
            >
              {expandMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
              Expand to Feature Length (~{softMin} mins)
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

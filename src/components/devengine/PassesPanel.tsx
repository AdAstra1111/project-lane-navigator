import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Loader2, Play, Wand2, MessageSquare, Zap, Palette, GitBranch, History, ChevronRight, ExternalLink,
} from 'lucide-react';
import { usePassRunner } from '@/hooks/usePassRunner';
import type { PassType, PassSettings } from '@/lib/scene-graph/types';

interface PassesPanelProps {
  projectId: string;
  onNavigateToChangeSet?: (changeSetId: string) => void;
}

const PASS_INFO: Record<PassType, { label: string; desc: string; icon: React.ReactNode }> = {
  dialogue_sharpen: { label: 'Dialogue Sharpen', desc: 'Tighten lines, improve subtext, keep character voice', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  exposition_compress: { label: 'Exposition Compress', desc: 'Reduce exposition, embed info in action/conflict', icon: <Wand2 className="h-3.5 w-3.5" /> },
  escalation_lift: { label: 'Escalation Lift', desc: 'Increase stakes, add reversals, sharper obstacles', icon: <Zap className="h-3.5 w-3.5" /> },
  tone_consistency: { label: 'Tone Consistency', desc: 'Align tone with spine rules, fix tonal whiplash', icon: <Palette className="h-3.5 w-3.5" /> },
};

export function PassesPanel({ projectId, onNavigateToChangeSet }: PassesPanelProps) {
  const pr = usePassRunner(projectId);
  const [passType, setPassType] = useState<PassType>('dialogue_sharpen');
  const [preserveApproved, setPreserveApproved] = useState(true);
  const [maxScenes, setMaxScenes] = useState(8);
  const [intensity, setIntensity] = useState<'light' | 'medium' | 'strong'>('medium');
  const [mode, setMode] = useState<'approved_prefer' | 'latest'>('approved_prefer');

  const handleRun = () => {
    const settings: PassSettings = {
      preserveApproved,
      maxScenesTouched: maxScenes,
      intensity,
    };
    pr.runPass.mutate({ passType, mode, settings });
  };

  const info = PASS_INFO[passType];

  return (
    <div className="space-y-3">
      {/* Pass selector + settings */}
      <Card className="border-border/50">
        <CardHeader className="px-3 py-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Writers' Room Passes
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-3">
          {/* Pass type selector */}
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.entries(PASS_INFO) as [PassType, typeof PASS_INFO[PassType]][]).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setPassType(key)}
                className={`flex items-center gap-1.5 p-2 rounded-md border text-left transition-colors text-[10px] ${
                  passType === key ? 'border-primary bg-primary/5' : 'border-border/50 hover:bg-muted/30'
                }`}
              >
                {val.icon}
                <div>
                  <div className="font-medium text-[11px]">{val.label}</div>
                  <div className="text-muted-foreground leading-tight">{val.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <Separator />

          {/* Settings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px]">Preserve Approved</Label>
              <Switch checked={preserveApproved} onCheckedChange={setPreserveApproved} className="scale-75" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Max Scenes</Label>
                <span className="text-[10px] text-muted-foreground">{maxScenes}</span>
              </div>
              <Slider value={[maxScenes]} onValueChange={([v]) => setMaxScenes(v)} min={1} max={20} step={1} />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-[10px] min-w-14">Intensity</Label>
              <Select value={intensity} onValueChange={(v) => setIntensity(v as any)}>
                <SelectTrigger className="h-7 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light" className="text-xs">Light</SelectItem>
                  <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                  <SelectItem value="strong" className="text-xs">Strong</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-[10px] min-w-14">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger className="h-7 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved_prefer" className="text-xs">Approved Prefer</SelectItem>
                  <SelectItem value="latest" className="text-xs">Latest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={handleRun} disabled={pr.runPass.isPending}>
            {pr.runPass.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run {info.label}
          </Button>
        </CardContent>
      </Card>

      {/* Latest run result */}
      {pr.runDetail?.run && (
        <Card className="border-border/50">
          <CardHeader className="px-3 py-2">
            <CardTitle className="text-xs flex items-center gap-1.5">
              Latest Result
              <Badge variant="outline" className="text-[8px] ml-auto">{pr.runDetail.run.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <p className="text-[10px] text-muted-foreground">{pr.runDetail.run.summary}</p>

            {pr.runDetail.selected_scenes?.length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Scenes Rewritten</span>
                {pr.runDetail.selected_scenes.map((sc: any) => (
                  <div key={sc.scene_id} className="text-[10px] bg-muted/30 rounded p-1.5 border border-border/30 flex items-center gap-1">
                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="font-medium">{sc.slugline || `Scene ${sc.scene_id.slice(0, 8)}`}</span>
                  </div>
                ))}
              </div>
            )}

            {pr.runDetail.run.created_change_set_id && (
              <Button
                size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                onClick={() => onNavigateToChangeSet?.(pr.runDetail!.run.created_change_set_id!)}
              >
                <GitBranch className="h-3 w-3" /> Open Change Set Review
                <ExternalLink className="h-2.5 w-2.5 ml-auto" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* History */}
      {pr.runs.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="px-3 py-2">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" /> Pass History
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-1">
                {pr.runs.map(run => (
                  <button
                    key={run.id}
                    className={`w-full text-left p-1.5 rounded border text-[10px] transition-colors ${
                      pr.selectedRunId === run.id ? 'border-primary bg-primary/5' : 'border-border/30 hover:bg-muted/30'
                    }`}
                    onClick={() => pr.setSelectedRunId(run.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[8px] px-1 py-0">
                        {PASS_INFO[run.pass_type as PassType]?.label || run.pass_type}
                      </Badge>
                      <span className="text-muted-foreground ml-auto">{new Date(run.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1">{run.summary || 'No summary'}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

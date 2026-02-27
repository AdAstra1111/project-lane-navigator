/**
 * AutoRunSetupPanel — lane picker, Start Auto-Run CTA, and autorun-on-upload toggle.
 * Renders at the top of ProjectDetail when prerequisites are missing.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, AlertCircle, Lock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Project, MonetisationLane, LANE_LABELS } from '@/lib/types';

const LANE_OPTIONS: { value: string; label: string }[] = [
  { value: 'studio-streamer', label: 'Studio / Streamer' },
  { value: 'independent-film', label: 'Independent Film' },
  { value: 'low-budget', label: 'Low-Budget / Microbudget' },
  { value: 'international-copro', label: 'International Co-Production' },
  { value: 'genre-market', label: 'Genre / Market-Driven' },
  { value: 'prestige-awards', label: 'Prestige / Awards' },
  { value: 'fast-turnaround', label: 'Fast-Turnaround / Trend-Based' },
];

const SERIES_FORMATS = ['tv-series', 'vertical-drama', 'vertical_drama', 'B2-A', 'b2a', 'series'];

interface Props {
  project: Project;
}

export function AutoRunSetupPanel({ project }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedLane, setSelectedLane] = useState(project.assigned_lane || '');
  const [saving, setSaving] = useState(false);
  const autorunEnabled = (project as any).autorun_enabled === true;

  const hasLane = !!project.assigned_lane;
  const isSeries = SERIES_FORMATS.includes(project.format);
  const hasEpisodeCount = !!(project as any).season_episode_count && (project as any).season_episode_count > 0;
  const episodeLocked = (project as any).season_episode_count_locked === true;

  const canStartAutoRun = hasLane && (!isSeries || (hasEpisodeCount && episodeLocked));

  const handleSaveLane = async () => {
    if (!selectedLane) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ assigned_lane: selectedLane })
        .eq('id', project.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Lane saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save lane');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAutorun = async (enabled: boolean) => {
    const { error } = await supabase
      .from('projects')
      .update({
        autorun_enabled: enabled,
        autorun_trigger: enabled ? 'upload' : 'manual',
      } as any)
      .eq('id', project.id);
    if (error) {
      toast.error('Failed to update setting');
      return;
    }
    qc.invalidateQueries({ queryKey: ['project', project.id] });
    toast.success(enabled ? 'Auto-Run on future uploads enabled' : 'Auto-Run on future uploads disabled');
  };

  const handleStartAutoRun = () => {
    // Navigate to the Development Engine which owns the full Auto-Run UI
    navigate(`/projects/${project.id}/development`);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 p-5 space-y-4 mb-6">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm text-foreground">Auto-Run Setup</h3>
      </div>

      {/* Lane Picker */}
      {!hasLane && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-2 flex-1">
            <p className="text-xs text-amber-300">Choose a lane before starting Auto-Run</p>
            <div className="flex items-center gap-2">
              <Select value={selectedLane} onValueChange={setSelectedLane}>
                <SelectTrigger className="h-8 text-xs max-w-[260px]">
                  <SelectValue placeholder="Select lane…" />
                </SelectTrigger>
                <SelectContent>
                  {LANE_OPTIONS.map(l => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleSaveLane} disabled={!selectedLane || saving} className="h-8 text-xs">
                {saving ? 'Saving…' : 'Save Lane'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Series episode count gate */}
      {hasLane && isSeries && (!hasEpisodeCount || !episodeLocked) && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <Lock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs text-amber-300">Set & lock episode count before starting Auto-Run</p>
            <p className="text-[10px] text-muted-foreground">
              Go to the Development Engine to set and lock your canonical episode count.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={() => navigate(`/projects/${project.id}/development`)}>
              Open Development Engine
            </Button>
          </div>
        </div>
      )}

      {/* Status + CTA */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {hasLane && (
            <Badge variant="outline" className="text-[10px]">
              Lane: {LANE_OPTIONS.find(l => l.value === project.assigned_lane)?.label || project.assigned_lane}
            </Badge>
          )}
          {isSeries && hasEpisodeCount && episodeLocked && (
            <Badge variant="outline" className="text-[10px]">
              {(project as any).season_episode_count} episodes (locked)
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          onClick={handleStartAutoRun}
          disabled={!canStartAutoRun}
          className="gap-1.5"
        >
          <Zap className="h-3.5 w-3.5" />
          Start Auto-Run
        </Button>
      </div>

      {/* Toggle: auto-run on future uploads */}
      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        <Label htmlFor="autorun-toggle" className="text-xs text-muted-foreground cursor-pointer">
          Enable Auto-Run on future uploads
        </Label>
        <Switch
          id="autorun-toggle"
          checked={autorunEnabled}
          onCheckedChange={handleToggleAutorun}
        />
      </div>
    </div>
  );
}

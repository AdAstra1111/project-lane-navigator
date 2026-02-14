/**
 * Packaging Target + Stage dropdowns — persists to projects table.
 */
import { useState } from 'react';
import { Target, Milestone } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  type PackagingMode, type PackagingStage,
  PACKAGING_MODE_LABELS, PACKAGING_STAGE_LABELS,
} from '@/lib/role-gravity-engine';

interface Props {
  projectId: string;
  currentMode: PackagingMode;
  currentStage?: PackagingStage;
  compact?: boolean;
  showStage?: boolean;
}

export function PackagingModeSelector({ projectId, currentMode, currentStage = 'early_dev', compact, showStage = true }: Props) {
  const [mode, setMode] = useState<PackagingMode>(currentMode);
  const [stage, setStage] = useState<PackagingStage>(currentStage);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleModeChange = async (value: string) => {
    const newMode = value as PackagingMode;
    setMode(newMode);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ packaging_mode: newMode } as any)
        .eq('id', projectId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Packaging target: ${PACKAGING_MODE_LABELS[newMode]}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
      setMode(currentMode);
    } finally {
      setSaving(false);
    }
  };

  const handleStageChange = async (value: string) => {
    const newStage = value as PackagingStage;
    setStage(newStage);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ packaging_stage: newStage } as any)
        .eq('id', projectId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Packaging stage: ${PACKAGING_STAGE_LABELS[newStage]}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
      setStage(currentStage);
    } finally {
      setSaving(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Select value={mode} onValueChange={handleModeChange} disabled={saving}>
          <SelectTrigger className="h-6 w-auto min-w-0 border-border/50 bg-transparent px-2 text-[10px] gap-1">
            <Target className="h-2.5 w-2.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(PACKAGING_MODE_LABELS) as [PackagingMode, string][]).map(([val, label]) => (
              <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showStage && (
          <Select value={stage} onValueChange={handleStageChange} disabled={saving}>
            <SelectTrigger className="h-6 w-auto min-w-0 border-border/50 bg-transparent px-2 text-[10px] gap-1">
              <Milestone className="h-2.5 w-2.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PACKAGING_STAGE_LABELS) as [PackagingStage, string][]).map(([val, label]) => (
                <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground shrink-0">Target</span>
        <Select value={mode} onValueChange={handleModeChange} disabled={saving}>
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(PACKAGING_MODE_LABELS) as [PackagingMode, string][]).map(([val, label]) => (
              <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showStage && (
        <div className="flex items-center gap-2">
          <Milestone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0">Stage</span>
          <Select value={stage} onValueChange={handleStageChange} disabled={saving}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PACKAGING_STAGE_LABELS) as [PackagingStage, string][]).map(([val, label]) => (
                <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

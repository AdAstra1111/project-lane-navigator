/**
 * Packaging Target dropdown — persists packaging_mode to projects table.
 */
import { useState } from 'react';
import { Target } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { type PackagingMode, PACKAGING_MODE_LABELS } from '@/lib/role-gravity-engine';

interface Props {
  projectId: string;
  currentMode: PackagingMode;
  compact?: boolean;
}

export function PackagingModeSelector({ projectId, currentMode, compact }: Props) {
  const [mode, setMode] = useState<PackagingMode>(currentMode);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleChange = async (value: string) => {
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
      toast.success(`Packaging target set to ${PACKAGING_MODE_LABELS[newMode]}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update packaging mode');
      setMode(currentMode);
    } finally {
      setSaving(false);
    }
  };

  if (compact) {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 cursor-default">
        <Target className="h-2.5 w-2.5" />
        {PACKAGING_MODE_LABELS[mode]}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground shrink-0">Packaging Target</span>
      <Select value={mode} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="h-7 w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(PACKAGING_MODE_LABELS) as [PackagingMode, string][]).map(([val, label]) => (
            <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

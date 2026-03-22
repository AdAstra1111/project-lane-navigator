/**
 * StyleLockPanel — Lightweight UI for controlling project cinematic style lock.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clapperboard, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  type StyleLock,
  type StyleColorProfile,
  type StyleContrastCurve,
  type StyleGrainLevel,
  type StyleLensProfile,
  type StyleLightingStyle,
  type StyleTimeOfDayBias,
  getDefaultStyleLock,
  resolveProjectStyleLock,
  saveProjectStyleLock,
} from '@/lib/lookbook/styleLock';

interface Props {
  projectId: string;
}

const COLOR_OPTIONS: { value: StyleColorProfile; label: string }[] = [
  { value: 'warm_filmic', label: 'Warm Filmic' },
  { value: 'cool_noir', label: 'Cool Noir' },
  { value: 'neutral_cinematic', label: 'Neutral Cinematic' },
];
const CONTRAST_OPTIONS: { value: StyleContrastCurve; label: string }[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const GRAIN_OPTIONS: { value: StyleGrainLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'film_35mm', label: '35mm Film' },
];
const LENS_OPTIONS: { value: StyleLensProfile; label: string }[] = [
  { value: 'anamorphic', label: 'Anamorphic' },
  { value: 'spherical', label: 'Spherical' },
  { value: 'portrait_85mm', label: 'Portrait 85mm' },
];
const LIGHTING_OPTIONS: { value: StyleLightingStyle; label: string }[] = [
  { value: 'naturalistic', label: 'Naturalistic' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'high_key', label: 'High Key' },
  { value: 'low_key', label: 'Low Key' },
];
const TOD_OPTIONS: { value: StyleTimeOfDayBias; label: string }[] = [
  { value: 'golden_hour', label: 'Golden Hour' },
  { value: 'daylight', label: 'Daylight' },
  { value: 'night', label: 'Night' },
  { value: 'mixed', label: 'Mixed' },
];

export function StyleLockPanel({ projectId }: Props) {
  const [style, setStyle] = useState<StyleLock>(getDefaultStyleLock());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    resolveProjectStyleLock(projectId).then(s => {
      setStyle(s);
      setLoading(false);
    });
  }, [projectId]);

  const update = <K extends keyof StyleLock>(key: K, value: StyleLock[K]) => {
    setStyle(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProjectStyleLock(projectId, style);
      toast.success('Cinematic style lock saved');
      setDirty(false);
    } catch {
      toast.error('Failed to save style lock');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clapperboard className="h-4 w-4" />
          Cinematic Style Lock
          {dirty && <Badge variant="outline" className="text-xs">Unsaved</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Color Profile" value={style.color_profile} options={COLOR_OPTIONS} onChange={v => update('color_profile', v as StyleColorProfile)} />
          <Field label="Contrast" value={style.contrast_curve} options={CONTRAST_OPTIONS} onChange={v => update('contrast_curve', v as StyleContrastCurve)} />
          <Field label="Grain" value={style.grain_level} options={GRAIN_OPTIONS} onChange={v => update('grain_level', v as StyleGrainLevel)} />
          <Field label="Lens" value={style.lens_profile} options={LENS_OPTIONS} onChange={v => update('lens_profile', v as StyleLensProfile)} />
          <Field label="Lighting" value={style.lighting_style} options={LIGHTING_OPTIONS} onChange={v => update('lighting_style', v as StyleLightingStyle)} />
          <Field label="Time of Day" value={style.time_of_day_bias} options={TOD_OPTIONS} onChange={v => update('time_of_day_bias', v as StyleTimeOfDayBias)} />
        </div>
        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
            <Save className="h-3 w-3 mr-1" />
            {saving ? 'Saving...' : 'Save Style Lock'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

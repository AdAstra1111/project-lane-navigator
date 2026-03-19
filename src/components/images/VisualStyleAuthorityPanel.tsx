/**
 * Visual Style Authority Panel — Edit and display the project's visual style profile.
 * Auto-hydrates from canon/project data; supports user overrides.
 */
import { useState, useEffect } from 'react';
import { useVisualStyleProfile, type VisualStyleProfile } from '@/hooks/useVisualStyleProfile';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Plus, X, Loader2, Sparkles } from 'lucide-react';

interface Props {
  projectId: string;
}

const FIELDS: { key: keyof VisualStyleProfile; label: string; placeholder: string }[] = [
  { key: 'period', label: 'Period / Era', placeholder: 'e.g. feudal Japan, 1940s wartime, contemporary urban' },
  { key: 'cultural_context', label: 'Cultural Context', placeholder: 'e.g. Japanese, West African, post-industrial British' },
  { key: 'lighting_philosophy', label: 'Lighting Philosophy', placeholder: 'e.g. natural light, firelight, no artificial cinematic fill' },
  { key: 'camera_philosophy', label: 'Camera Philosophy', placeholder: 'e.g. observational, imperfect, non-modern framing' },
  { key: 'composition_philosophy', label: 'Composition Philosophy', placeholder: 'e.g. asymmetrical, lived-in, non-staged' },
  { key: 'texture_materiality', label: 'Texture / Materiality', placeholder: 'e.g. grainy, tactile, worn materials, hand-crafted surfaces' },
  { key: 'color_response', label: 'Color Response', placeholder: 'e.g. muted earth tones, non-digital response, warm amber' },
  { key: 'environment_realism', label: 'Environment Realism', placeholder: 'e.g. historically grounded, no modern objects or finishes' },
];

export function VisualStyleAuthorityPanel({ projectId }: Props) {
  const { profile, isAutoFilled, loading, saving, save } = useVisualStyleProfile(projectId);
  const [draft, setDraft] = useState<Partial<VisualStyleProfile>>({});
  const [newForbid, setNewForbid] = useState('');

  useEffect(() => {
    if (profile) {
      setDraft(profile);
    }
  }, [profile]);

  const updateField = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const addForbidden = () => {
    const trimmed = newForbid.trim();
    if (!trimmed) return;
    const current = draft.forbidden_traits || [];
    if (!current.includes(trimmed)) {
      setDraft(prev => ({ ...prev, forbidden_traits: [...(prev.forbidden_traits || []), trimmed] }));
    }
    setNewForbid('');
  };

  const removeForbidden = (item: string) => {
    setDraft(prev => ({
      ...prev,
      forbidden_traits: (prev.forbidden_traits || []).filter(f => f !== item),
    }));
  };

  const handleSave = () => {
    save(draft);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
        <Loader2 className="h-3 w-3 animate-spin" /> Resolving visual style…
      </div>
    );
  }

  const isComplete = FIELDS.every(f => {
    const v = draft[f.key];
    return typeof v === 'string' && v.trim().length > 0;
  });

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {isAutoFilled ? (
          <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary/80">
            <Sparkles className="h-3 w-3" /> Auto-derived from project canon — refine for more control
          </Badge>
        ) : isComplete ? (
          <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/30 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Style Profile Complete
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/30 text-amber-400">
            <AlertCircle className="h-3 w-3" /> Using inferred style profile — refine for more control
          </Badge>
        )}
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-[11px] font-medium text-muted-foreground">{f.label}</Label>
            <Textarea
              value={(draft[f.key] as string) || ''}
              onChange={e => updateField(f.key as string, e.target.value)}
              placeholder={f.placeholder}
              rows={2}
              className="text-xs resize-none"
            />
          </div>
        ))}
      </div>

      {/* Forbidden traits */}
      <div className="space-y-2">
        <Label className="text-[11px] font-medium text-muted-foreground">Forbidden Modern Traits</Label>
        <div className="flex flex-wrap gap-1.5">
          {(draft.forbidden_traits || []).map(item => (
            <Badge key={item} variant="destructive" className="text-[10px] gap-1 pr-1">
              {item}
              <button onClick={() => removeForbidden(item)} className="hover:text-foreground">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newForbid}
            onChange={e => setNewForbid(e.target.value)}
            placeholder="e.g. studio lighting, digital sharpness"
            className="text-xs h-8"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addForbidden())}
          />
          <Button variant="outline" size="sm" onClick={addForbidden} className="h-8 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-2">
        {isAutoFilled && (
          <Button onClick={handleSave} variant="secondary" size="sm" className="text-xs gap-1.5">
            <Sparkles className="h-3 w-3" />
            Accept & Save Inferred Profile
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving} size="sm" className="text-xs gap-1.5">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {isAutoFilled ? 'Save with Edits' : 'Save Style Profile'}
        </Button>
      </div>
    </div>
  );
}

/** Compact style chip for display in headers */
export function VisualStyleChip({ projectId }: { projectId: string }) {
  const { profile, loading, isAutoFilled } = useVisualStyleProfile(projectId);

  if (loading || !profile) return null;

  const parts = [
    profile.period,
    profile.cultural_context,
    profile.lighting_philosophy,
  ].filter(Boolean).map(p => p.split(',')[0].trim()).filter(Boolean);

  if (parts.length === 0) return null;

  return (
    <Badge variant="outline" className="text-[9px] gap-1 font-normal border-primary/20 text-primary/70">
      {isAutoFilled ? (
        <Sparkles className="h-2.5 w-2.5 text-primary/60" />
      ) : profile.is_complete ? (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <AlertCircle className="h-2.5 w-2.5 text-amber-500" />
      )}
      Style: {parts.slice(0, 3).join(' / ')}
    </Badge>
  );
}

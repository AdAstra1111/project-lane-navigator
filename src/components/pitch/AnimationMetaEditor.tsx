import { useState } from 'react';
import { Save, Loader2, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  type AnimationMeta,
  type AnimationPrimary,
  type AnimationStyle,
  ANIMATION_PRIMARY_LIST,
  ANIMATION_PRIMARY_LABELS,
  ANIMATION_STYLE_LIST,
  ANIMATION_STYLE_LABELS,
  ANIMATION_TAG_CATEGORIES,
} from '@/config/animationMeta';

interface Props {
  projectId: string;
  meta: AnimationMeta;
}

/**
 * Inline editor for animation genre/style/tags.
 * Patches project_features via apply-project-change (whitelisted keys only).
 */
export function AnimationMetaEditor({ projectId, meta }: Props) {
  const qc = useQueryClient();
  const [primary, setPrimary] = useState<AnimationPrimary | null>(meta.primary);
  const [style, setStyle] = useState<AnimationStyle | null>(meta.style);
  const [tags, setTags] = useState<string[]>(meta.tags);
  const [saving, setSaving] = useState(false);

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const isDirty =
    primary !== meta.primary ||
    style !== meta.style ||
    JSON.stringify([...tags].sort()) !== JSON.stringify([...meta.tags].sort());

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('apply-project-change', {
        body: {
          projectId,
          changes: {
            project_features: {
              animation_genre_primary: primary,
              animation_style: style,
              animation_genre_tags: tags,
            },
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Animation metadata updated');
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-border/20">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Palette className="h-3 w-3" /> Animation Details
      </p>

      {/* Primary */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Primary Genre</Label>
        <div className="flex flex-wrap gap-1">
          {ANIMATION_PRIMARY_LIST.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPrimary(prev => prev === p ? null : p)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                primary === p
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-muted/50 text-muted-foreground border-border/50 hover:text-foreground'
              )}
            >
              {ANIMATION_PRIMARY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Style */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Style</Label>
        <div className="flex flex-wrap gap-1">
          {ANIMATION_STYLE_LIST.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(prev => prev === s ? null : s)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                style === s
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-muted/50 text-muted-foreground border-border/50 hover:text-foreground'
              )}
            >
              {ANIMATION_STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tags</Label>
        {Object.entries(ANIMATION_TAG_CATEGORIES).map(([cat, catTags]) => (
          <div key={cat} className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground font-medium">{cat}</span>
            <div className="flex flex-wrap gap-1">
              {catTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'px-1.5 py-0.5 rounded-full text-[9px] font-medium border transition-colors',
                    tags.includes(tag)
                      ? 'bg-accent/20 text-accent-foreground border-accent/40'
                      : 'bg-muted/30 text-muted-foreground border-border/30 hover:text-foreground'
                  )}
                >
                  {tag.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {isDirty && (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Animation Meta
        </Button>
      )}
    </div>
  );
}

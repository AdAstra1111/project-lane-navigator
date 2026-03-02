import { Badge } from '@/components/ui/badge';
import { Palette } from 'lucide-react';
import {
  type AnimationMeta,
  ANIMATION_PRIMARY_LABELS,
  ANIMATION_STYLE_LABELS,
  type AnimationPrimary,
  type AnimationStyle,
} from '@/config/animationMeta';

interface Props {
  meta: AnimationMeta;
}

/** Compact chips for animation meta — only renders when at least one field is set. */
export function AnimationMetaChips({ meta }: Props) {
  if (!meta.primary && !meta.style && meta.tags.length === 0) return null;

  return (
    <>
      {meta.primary && (
        <Badge variant="outline" className="text-[10px] border-accent/40 gap-1">
          <Palette className="h-2.5 w-2.5" />
          {ANIMATION_PRIMARY_LABELS[meta.primary as AnimationPrimary] || meta.primary}
        </Badge>
      )}
      {meta.style && (
        <Badge variant="outline" className="text-[10px] border-accent/40">
          {ANIMATION_STYLE_LABELS[meta.style as AnimationStyle] || meta.style}
        </Badge>
      )}
      {meta.tags.length > 0 && (
        <Badge variant="secondary" className="text-[10px]">
          {meta.tags.length} tag{meta.tags.length !== 1 ? 's' : ''}
        </Badge>
      )}
    </>
  );
}

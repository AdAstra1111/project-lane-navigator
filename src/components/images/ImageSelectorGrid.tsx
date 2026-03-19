/**
 * ImageSelectorGrid — Reusable image option grid with selection.
 * Used by Look Book sections and Poster Engine for choosing active images.
 */
import { useState } from 'react';
import { Check, Loader2, Star, Expand, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage } from '@/lib/images/types';

interface ImageSelectorGridProps {
  projectId: string;
  images: ProjectImage[];
  isLoading?: boolean;
  onGenerate?: () => void;
  isGenerating?: boolean;
  generateLabel?: string;
  emptyLabel?: string;
  /** Called after selection changes */
  onSelectionChange?: () => void;
  className?: string;
}

export function ImageSelectorGrid({
  projectId,
  images,
  isLoading,
  onGenerate,
  isGenerating,
  generateLabel = 'Generate Options',
  emptyLabel = 'No images generated yet',
  onSelectionChange,
  className,
}: ImageSelectorGridProps) {
  const qc = useQueryClient();
  const [lightbox, setLightbox] = useState<ProjectImage | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelect = async (image: ProjectImage) => {
    if (selecting) return;
    setSelecting(image.id);
    try {
      // Deactivate existing primaries for same role + strategy in this project
      await (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('role', image.role)
        .eq('strategy_key', image.strategy_key);

      await (supabase as any)
        .from('project_images')
        .update({ is_primary: true, is_active: true })
        .eq('id', image.id);

      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      onSelectionChange?.();
      toast.success('Image selected');
    } catch (e: any) {
      toast.error(e.message || 'Selection failed');
    } finally {
      setSelecting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Action row */}
      {onGenerate && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {images.length > 0 ? `${images.length} options` : emptyLabel}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
            ) : (
              <><ImageIcon className="h-3 w-3" /> {generateLabel}</>
            )}
          </Button>
        </div>
      )}

      {/* Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map(img => (
            <div
              key={img.id}
              className={cn(
                'group relative rounded-md overflow-hidden border-2 cursor-pointer transition-all aspect-video bg-muted',
                img.is_primary
                  ? 'border-primary ring-1 ring-primary/30'
                  : 'border-border/50 hover:border-primary/40',
              )}
              onClick={() => handleSelect(img)}
            >
              {img.signedUrl ? (
                <img
                  src={img.signedUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                </div>
              )}

              {/* Primary badge */}
              {img.is_primary && (
                <div className="absolute top-1 left-1">
                  <Badge className="text-[9px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
                    <Check className="h-2 w-2" /> Active
                  </Badge>
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                {selecting === img.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white opacity-0 group-hover:opacity-100" />
                ) : !img.is_primary ? (
                  <Star className="h-4 w-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                ) : null}
              </div>

              {/* Expand button */}
              <button
                className="absolute bottom-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setLightbox(img); }}
              >
                <Expand className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black/95 border-border">
          <DialogTitle className="sr-only">Image detail</DialogTitle>
          {lightbox?.signedUrl && (
            <img src={lightbox.signedUrl} alt="" className="w-full h-auto max-h-[80vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ImageComparisonView — Side-by-side comparison of 2–4 images.
 * Used for identity consistency evaluation and canon selection.
 */
import { useState, useCallback } from 'react';
import { X, Crown, XCircle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import type { ProjectImage, ShotType } from '@/lib/images/types';

interface ImageComparisonViewProps {
  images: ProjectImage[];
  open: boolean;
  onClose: () => void;
  onSetPrimary?: (image: ProjectImage) => void;
  onReject?: (imageId: string) => void;
  /** Optional scores per image id */
  scores?: Record<string, number>;
}

export function ImageComparisonView({
  images, open, onClose, onSetPrimary, onReject, scores,
}: ImageComparisonViewProps) {
  const [syncZoom, setSyncZoom] = useState(true);
  const [zoom, setZoom] = useState(1);

  const resetZoom = useCallback(() => setZoom(1), []);

  const gridCols = images.length <= 2 ? 'grid-cols-2' : images.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';

  return (
    <Dialog open={open && images.length >= 2} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-[90vh] p-0 bg-black border-none rounded-lg overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Image comparison</DialogTitle>

        {/* Toolbar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/60">{images.length} images</span>
            {syncZoom && (
              <>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => setZoom(z => Math.min(4, z + 0.5))}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => setZoom(z => Math.max(1, z - 0.5))}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={resetZoom}>
                  <RotateCcw className="h-3 w-3" />
                </Button>
                <span className="text-[10px] text-white/40 tabular-nums">{Math.round(zoom * 100)}%</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost"
              className={cn('h-7 text-[10px] px-2 text-white/70 hover:text-white hover:bg-white/10', syncZoom && 'bg-white/10 text-white')}
              onClick={() => setSyncZoom(v => !v)}>
              {syncZoom ? 'Sync Zoom' : 'Independent'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Comparison grid */}
        <div className={cn('w-full h-full pt-12 pb-2 px-2 grid gap-2', gridCols)}>
          {images.map(img => (
            <ComparisonCell
              key={img.id}
              image={img}
              zoom={syncZoom ? zoom : undefined}
              score={scores?.[img.id]}
              onSetPrimary={onSetPrimary}
              onReject={onReject}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComparisonCell({
  image, zoom: syncedZoom, score, onSetPrimary, onReject,
}: {
  image: ProjectImage;
  zoom?: number;
  score?: number;
  onSetPrimary?: (img: ProjectImage) => void;
  onReject?: (id: string) => void;
}) {
  const [localZoom, setLocalZoom] = useState(1);
  const effectiveZoom = syncedZoom ?? localZoom;

  return (
    <div className="relative flex flex-col bg-black/50 rounded-md overflow-hidden border border-white/10">
      {/* Image area */}
      <div className="flex-1 overflow-hidden flex items-center justify-center"
        onDoubleClick={() => !syncedZoom && setLocalZoom(z => z === 1 ? 2.5 : 1)}>
        {image.signedUrl ? (
          <img
            src={image.signedUrl}
            alt=""
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `scale(${effectiveZoom})`,
              transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">No image</div>
        )}
      </div>

      {/* Bottom info + actions */}
      <div className="px-2 py-1.5 bg-black/60 space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          {image.shot_type && (
            <Badge variant="secondary" className="text-[8px] bg-white/10 text-white/80 border-0 px-1 py-0">
              {SHOT_TYPE_LABELS[image.shot_type as ShotType] || image.shot_type}
            </Badge>
          )}
          {image.subject && (
            <Badge variant="outline" className="text-[8px] border-white/20 text-white/60 px-1 py-0">
              {image.subject}
            </Badge>
          )}
          {score != null && (
            <Badge variant="outline" className="text-[8px] border-white/20 text-white/50 px-1 py-0 tabular-nums">
              {score.toFixed(2)}
            </Badge>
          )}
          {image.width && image.height && (
            <span className="text-[8px] text-white/30 tabular-nums ml-auto">{image.width}×{image.height}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {onSetPrimary && (
            <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5 text-white/70 hover:text-white hover:bg-white/10 px-1.5"
              onClick={() => onSetPrimary(image)}>
              <Crown className="h-3 w-3" /> Primary
            </Button>
          )}
          {onReject && (
            <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10 px-1.5"
              onClick={() => onReject(image.id)}>
              <XCircle className="h-3 w-3" /> Reject
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

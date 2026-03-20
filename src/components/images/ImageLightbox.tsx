/**
 * ImageLightbox — Fullscreen image viewer with zoom, pan, and metadata overlay.
 * Used by approval queue and browsing surfaces for detailed image inspection.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import type { ProjectImage, ShotType } from '@/lib/images/types';

interface ImageLightboxProps {
  image: ProjectImage | null;
  open: boolean;
  onClose: () => void;
  /** Optional DNA traits to display */
  dnaTraits?: Array<{ label: string; value: string; region?: string }>;
  /** Optional score to display */
  score?: number | null;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.5;

export function ImageLightbox({ image, open, onClose, dnaTraits, score }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showOverlay, setShowOverlay] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom/pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [image?.id]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(prev => {
      const next = prev + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoom, pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (!image) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-black border-none rounded-lg overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Image inspection</DialogTitle>

        {/* Top toolbar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={resetView} title="Reset zoom">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] text-white/50 ml-1 tabular-nums">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => setShowOverlay(v => !v)} title="Toggle metadata">
              {showOverlay ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Image viewport */}
        <div
          ref={containerRef}
          className={cn('w-full h-full flex items-center justify-center overflow-hidden', zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in', isDragging && 'cursor-grabbing')}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={() => zoom === 1 ? setZoom(2.5) : resetView()}
        >
          {image.signedUrl && (
            <img
              src={image.signedUrl}
              alt=""
              className="max-w-full max-h-full object-contain select-none pointer-events-none"
              style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              draggable={false}
            />
          )}
        </div>

        {/* Bottom metadata overlay */}
        {showOverlay && (
          <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              {image.shot_type && (
                <Badge variant="secondary" className="text-[9px] bg-white/10 text-white/90 border-white/20">
                  {SHOT_TYPE_LABELS[image.shot_type as ShotType] || image.shot_type}
                </Badge>
              )}
              {image.subject && (
                <Badge variant="outline" className="text-[9px] border-white/30 text-white/80">
                  {image.subject}
                </Badge>
              )}
              {image.asset_group && (
                <Badge variant="outline" className="text-[9px] border-white/20 text-white/60">
                  {image.asset_group}
                </Badge>
              )}
              {score != null && (
                <Badge variant="outline" className="text-[9px] border-white/20 text-white/60 tabular-nums">
                  Score: {score.toFixed(2)}
                </Badge>
              )}
              {image.width && image.height && (
                <span className="text-[9px] text-white/40 tabular-nums">{image.width}×{image.height}</span>
              )}
              <span className="text-[8px] text-white/30 ml-auto font-mono">{image.id.slice(0, 8)}</span>
            </div>

            {/* DNA traits */}
            {dnaTraits && dnaTraits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dnaTraits.map((trait, i) => (
                  <Badge key={i} variant="outline" className="text-[8px] border-white/15 text-white/60 bg-white/5">
                    <span className="text-white/40 mr-0.5">{trait.label}:</span> {trait.value}
                    {trait.region && <span className="text-white/30 ml-0.5">({trait.region})</span>}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

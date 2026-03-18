/**
 * LookBookViewer — Frame-based, presentation-ready Look Book viewer.
 * Scales 1920×1080 slides to fit any viewport. Keyboard navigation.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SlideRenderer } from './SlideRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '@/lib/lookbook/types';
import type { LookBookData } from '@/lib/lookbook/types';

interface LookBookViewerProps {
  data: LookBookData;
  onExportPDF?: () => void;
  isExporting?: boolean;
  className?: string;
}

export function LookBookViewer({ data, onExportPDF, isExporting, className }: LookBookViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  const totalSlides = data.slides.length;

  // Calculate scale to fit container
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padding = isFullscreen ? 0 : 48;
      const availW = rect.width - padding;
      const availH = rect.height - padding - (isFullscreen ? 0 : 64);
      const sx = availW / SLIDE_WIDTH;
      const sy = availH / SLIDE_HEIGHT;
      setScale(Math.min(sx, sy, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [isFullscreen]);

  // Keyboard navigation
  const goNext = useCallback(() => setCurrentSlide(s => Math.min(s + 1, totalSlides - 1)), [totalSlides]);
  const goPrev = useCallback(() => setCurrentSlide(s => Math.max(s - 1, 0)), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
      if (e.key === 'f' || e.key === 'F') setIsFullscreen(f => !f);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, isFullscreen]);

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(f => !f);
  };

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const slide = data.slides[currentSlide];

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col h-full',
        isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'relative',
        className,
      )}
    >
      {/* Toolbar */}
      <div className={cn(
        'flex items-center justify-between px-4 h-12 shrink-0',
        isFullscreen ? 'bg-black/80 text-white' : 'bg-card border-b border-border',
      )}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{data.projectTitle}</span>
          <span className="text-xs text-muted-foreground">Look Book</span>
        </div>
        <div className="flex items-center gap-1">
          {onExportPDF && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={onExportPDF}
              disabled={isExporting}
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export PDF
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Slide viewport */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        <div
          className="relative shadow-2xl rounded-sm"
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <SlideRenderer
            slide={slide}
            identity={data.identity}
            slideIndex={currentSlide}
            totalSlides={totalSlides}
          />
        </div>

        {/* Navigation arrows */}
        {currentSlide > 0 && (
          <button
            onClick={goPrev}
            className={cn(
              'absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-opacity',
              isFullscreen ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-card hover:bg-muted text-foreground border border-border',
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {currentSlide < totalSlides - 1 && (
          <button
            onClick={goNext}
            className={cn(
              'absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-opacity',
              isFullscreen ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-card hover:bg-muted text-foreground border border-border',
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 overflow-x-auto shrink-0',
        isFullscreen ? 'bg-black/80' : 'bg-card border-t border-border',
      )}>
        {data.slides.map((s, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={cn(
              'shrink-0 rounded overflow-hidden border-2 transition-all',
              i === currentSlide
                ? 'border-primary shadow-md'
                : isFullscreen
                  ? 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
                  : 'border-border/50 hover:border-border opacity-60 hover:opacity-100',
            )}
            style={{ width: 96, height: 54 }}
          >
            <div
              className="origin-top-left"
              style={{
                width: SLIDE_WIDTH,
                height: SLIDE_HEIGHT,
                transform: `scale(${96 / SLIDE_WIDTH})`,
                transformOrigin: 'top left',
                pointerEvents: 'none',
              }}
            >
              <SlideRenderer
                slide={s}
                identity={data.identity}
                slideIndex={i}
                totalSlides={totalSlides}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

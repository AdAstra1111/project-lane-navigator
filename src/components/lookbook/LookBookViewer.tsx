/**
 * LookBookViewer — Frame-based, presentation-ready Look Book viewer.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 * Scales slides to fit any viewport. Keyboard navigation.
 * Includes layout-family inspector and override controls.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Download, Loader2, Layout, RotateCcw, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SlideRenderer } from './SlideRenderer';
import { getSlideDimensions } from '@/lib/lookbook/types';
import type { LookBookData, SlideContent } from '@/lib/lookbook/types';
import {
  getEffectiveLayoutFamily,
  isLayoutFamilyOverrideActive,
  getLayoutFamilyOptions,
  validateLayoutFamilyOverride,
  type OverrideFitStatus,
} from '@/lib/lookbook/lookbookLayoutResolutionState';
import { LAYOUT_FAMILIES, type LayoutFamilyKey } from '@/lib/lookbook/lookbookLayoutFamilies';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface LookBookViewerProps {
  data: LookBookData;
  onExportPDF?: () => void;
  isExporting?: boolean;
  className?: string;
  /** Callback to persist a layout-family override into canonical slide data */
  onSlideLayoutOverride?: (slideIndex: number, familyKey: LayoutFamilyKey | null) => void;
}

// ── Layout Family Mini Glyphs ───────────────────────────────────────────────

function FamilyGlyph({ familyKey }: { familyKey: LayoutFamilyKey }) {
  const w = 28;
  const h = 16;
  const s = 'hsl(var(--muted-foreground))';
  const fill = 'hsl(var(--muted-foreground) / 0.15)';

  switch (familyKey) {
    case 'landscape_standard':
      return (
        <svg width={w} height={h} viewBox="0 0 28 16">
          <rect x="1" y="1" width="18" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
          <rect x="21" y="1" width="6" height="6" rx="1" fill={fill} stroke={s} strokeWidth="0.6" />
          <rect x="21" y="9" width="6" height="6" rx="1" fill={fill} stroke={s} strokeWidth="0.6" />
        </svg>
      );
    case 'landscape_portrait_hero':
      return (
        <svg width={w} height={h} viewBox="0 0 28 16">
          <rect x="8" y="1" width="12" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
        </svg>
      );
    case 'landscape_two_up_portrait':
      return (
        <svg width={w} height={h} viewBox="0 0 28 16">
          <rect x="2" y="1" width="11" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
          <rect x="15" y="1" width="11" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
        </svg>
      );
    case 'landscape_mixed_editorial':
      return (
        <svg width={w} height={h} viewBox="0 0 28 16">
          <rect x="1" y="1" width="14" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
          <rect x="17" y="1" width="10" height="6" rx="1" fill={fill} stroke={s} strokeWidth="0.6" />
          <rect x="17" y="9" width="10" height="6" rx="1" fill={fill} stroke={s} strokeWidth="0.6" />
        </svg>
      );
    case 'landscape_character_portraits':
      return (
        <svg width={w} height={h} viewBox="0 0 28 16">
          <rect x="1" y="1" width="8" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
          <rect x="10.5" y="1" width="8" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.8" />
          <rect x="20" y="1" width="7" height="14" rx="1" fill={fill} stroke={s} strokeWidth="0.6" />
        </svg>
      );
    default:
      return null;
  }
}

function FitStatusIcon({ status }: { status: OverrideFitStatus }) {
  if (status === 'valid') return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
  if (status === 'weak-fit') return <AlertTriangle className="h-3 w-3 text-amber-500" />;
  return <XCircle className="h-3 w-3 text-destructive" />;
}

// ── Layout Inspector Panel ──────────────────────────────────────────────────

function SlideLayoutPanel({
  slide,
  onOverride,
}: {
  slide: SlideContent;
  onOverride: (familyKey: LayoutFamilyKey | null) => void;
}) {
  const effectiveFamily = getEffectiveLayoutFamily(slide);
  const isOverridden = isLayoutFamilyOverrideActive(slide);
  const options = getLayoutFamilyOptions(slide);
  const familyDef = LAYOUT_FAMILIES[effectiveFamily];
  const summary = slide.imageOrientationSummary;
  const slotAssignments = slide.slotAssignments;

  return (
    <div className="space-y-3">
      {/* Current effective family */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FamilyGlyph familyKey={effectiveFamily} />
          <span className="text-xs font-medium text-foreground">{familyDef?.label || effectiveFamily}</span>
        </div>
        <Badge
          variant={isOverridden ? 'default' : 'secondary'}
          className="text-[10px] h-4 px-1.5"
        >
          {isOverridden ? 'Override' : 'Auto'}
        </Badge>
      </div>

      {/* Reason */}
      {slide.layoutFamilyReason && !isOverridden && (
        <p className="text-[10px] text-muted-foreground leading-tight">
          {slide.layoutFamilyReason}
        </p>
      )}

      {/* Override selector */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Layout Family
        </label>
        <Select
          value={isOverridden ? effectiveFamily : '__auto__'}
          onValueChange={(val) => {
            if (val === '__auto__') {
              onOverride(null);
            } else {
              onOverride(val as LayoutFamilyKey);
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">
              <div className="flex items-center gap-1.5">
                <RotateCcw className="h-3 w-3 text-muted-foreground" />
                <span>Auto</span>
                {slide.layoutFamily && (
                  <span className="text-muted-foreground ml-1">
                    ({LAYOUT_FAMILIES[slide.layoutFamily as LayoutFamilyKey]?.label || slide.layoutFamily})
                  </span>
                )}
              </div>
            </SelectItem>
            {options.map(opt => (
              <SelectItem
                key={opt.key}
                value={opt.key}
                disabled={opt.validation.status === 'invalid'}
              >
                <div className="flex items-center gap-1.5">
                  <FamilyGlyph familyKey={opt.key} />
                  <span>{opt.label}</span>
                  <FitStatusIcon status={opt.validation.status} />
                  {opt.validation.status === 'weak-fit' && (
                    <span className="text-[10px] text-amber-500 ml-0.5">⚠</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Orientation diagnostics */}
      {summary && summary.total > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Image Orientations
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {summary.portrait > 0 && (
              <span className="text-[10px] text-muted-foreground">{summary.portrait}P</span>
            )}
            {summary.landscape > 0 && (
              <span className="text-[10px] text-muted-foreground">{summary.landscape}L</span>
            )}
            {summary.square > 0 && (
              <span className="text-[10px] text-muted-foreground">{summary.square}S</span>
            )}
            {summary.unknown > 0 && (
              <span className="text-[10px] text-muted-foreground">{summary.unknown}?</span>
            )}
          </div>
        </div>
      )}

      {/* Slot assignments diagnostics */}
      {slotAssignments && slotAssignments.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Slots
          </span>
          <div className="space-y-0.5">
            {slotAssignments.map(slot => (
              <div key={slot.slotKey} className="flex items-center gap-1.5 text-[10px]">
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  slot.assignedUrl
                    ? slot.orientationMatch ? 'bg-emerald-500' : 'bg-amber-500'
                    : 'bg-destructive',
                )} />
                <span className="text-muted-foreground">{slot.slotKey}</span>
                <span className="text-muted-foreground/60">
                  {slot.expectedOrientation}
                  {slot.assignedUrl ? ` → ${slot.assignedOrientation}` : ' → ∅'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Viewer ─────────────────────────────────────────────────────────────

export function LookBookViewer({ data, onExportPDF, isExporting, className }: LookBookViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // Local override state — keyed by slide index
  const [overrides, setOverrides] = useState<Record<number, LayoutFamilyKey | null>>({});

  const totalSlides = data.slides.length;
  const deckFormat = data.deckFormat || 'landscape';
  const { width: slideW, height: slideH } = getSlideDimensions(deckFormat);
  const isPortrait = deckFormat === 'portrait';

  // Thumbnail dimensions — adapt to deck format
  const thumbW = isPortrait ? 54 : 96;
  const thumbH = isPortrait ? 96 : 54;

  // Calculate scale to fit container (account for layout panel width)
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padding = isFullscreen ? 0 : 48;
      const panelWidth = showLayout && !isFullscreen ? 220 : 0;
      const availW = rect.width - padding - panelWidth;
      const availH = rect.height - padding - (isFullscreen ? 0 : 64);
      const sx = availW / slideW;
      const sy = availH / slideH;
      setScale(Math.min(sx, sy, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [isFullscreen, slideW, slideH, showLayout]);

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

  // Apply overrides to current slide for rendering
  const getSlideWithOverride = (slide: SlideContent, index: number): SlideContent => {
    const override = overrides[index];
    if (override === undefined) return slide; // no change
    if (override === null) {
      // Reset to auto
      return {
        ...slide,
        layoutFamilyOverride: null,
        layoutFamilyOverrideSource: null,
        layoutFamilyEffective: slide.layoutFamily || 'landscape_standard',
      };
    }
    return {
      ...slide,
      layoutFamilyOverride: override,
      layoutFamilyOverrideSource: 'user',
      layoutFamilyEffective: override,
    };
  };

  const handleOverride = (familyKey: LayoutFamilyKey | null) => {
    setOverrides(prev => ({ ...prev, [currentSlide]: familyKey }));
  };

  const currentSlideData = getSlideWithOverride(data.slides[currentSlide], currentSlide);

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
          {isPortrait && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium uppercase tracking-wider">Portrait</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isFullscreen && (
            <Button
              variant={showLayout ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => setShowLayout(v => !v)}
            >
              <Layout className="h-3.5 w-3.5" />
              Layout
            </Button>
          )}
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

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide viewport */}
        <div className="flex-1 flex items-center justify-center overflow-hidden relative">
          <div
            className="relative shadow-2xl rounded-sm"
            style={{
              width: slideW,
              height: slideH,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            <SlideRenderer
              slide={currentSlideData}
              identity={data.identity}
              slideIndex={currentSlide}
              totalSlides={totalSlides}
              deckFormat={deckFormat}
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

        {/* Layout inspector panel */}
        {showLayout && !isFullscreen && (
          <div className="w-[220px] shrink-0 border-l border-border bg-card overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Slide Layout</h3>
              <span className="text-[10px] text-muted-foreground">
                {currentSlide + 1}/{totalSlides}
              </span>
            </div>
            <div className="mb-2">
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                {currentSlideData.type}
              </Badge>
            </div>
            <SlideLayoutPanel
              slide={currentSlideData}
              onOverride={handleOverride}
            />
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 overflow-x-auto shrink-0',
        isFullscreen ? 'bg-black/80' : 'bg-card border-t border-border',
      )}>
        {data.slides.map((s, i) => {
          const slideWithOverride = getSlideWithOverride(s, i);
          const hasOverride = overrides[i] !== undefined && overrides[i] !== null;
          return (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={cn(
                'shrink-0 rounded overflow-hidden border-2 transition-all relative',
                i === currentSlide
                  ? 'border-primary shadow-md'
                  : isFullscreen
                    ? 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
                    : 'border-border/50 hover:border-border opacity-60 hover:opacity-100',
              )}
              style={{ width: thumbW, height: thumbH }}
            >
              <div
                className="origin-top-left"
                style={{
                  width: slideW,
                  height: slideH,
                  transform: `scale(${thumbW / slideW})`,
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
              >
                <SlideRenderer
                  slide={slideWithOverride}
                  identity={data.identity}
                  slideIndex={i}
                  totalSlides={totalSlides}
                  deckFormat={deckFormat}
                />
              </div>
              {hasOverride && (
                <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

{/**
 * SlideRenderer — Pure cinematic slide compositions.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 *
 * CINEMATIC MODE: Every eligible slide uses a full-bleed background image
 * with controlled overlays for readability. Text is overlaid on imagery,
 * not placed beside it on empty dark backgrounds.
 *
 * QUALITY SYSTEM: Slides are designed for premium visual density:
 * - Text panels are tightly composed with intentional whitespace
 * - Image zones fill available space aggressively
 * - Gradient-only fallbacks use decorative treatments, not blank voids
 * - Every slide archetype has specific composition rules
 */}
import type { SlideContent, LookBookVisualIdentity, DeckFormat } from '@/lib/lookbook/types';
import { getSlideDimensions } from '@/lib/lookbook/types';

interface SlideRendererProps {
  slide: SlideContent;
  identity: LookBookVisualIdentity;
  slideIndex: number;
  totalSlides: number;
  deckFormat?: DeckFormat;
}

const seenRenderDiagnostics = new Set<string>();

function safeOptionalString(value: unknown, field: string, warnings: string[]): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') return value;
  warnings.push(field);
  return undefined;
}

function safeStringArray(value: unknown, field: string, warnings: string[]): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) { warnings.push(field); return undefined; }
  const normalized = value.map((item, index) => {
    if (typeof item === 'string') return item;
    warnings.push(`${field}[${index}]`);
    return '';
  }).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSlideForRender(slide: SlideContent, slideIndex: number): SlideContent {
  const warnings: string[] = [];
  const normalizedSlide: SlideContent = {
    ...slide,
    title: safeOptionalString(slide.title, 'title', warnings),
    subtitle: safeOptionalString(slide.subtitle, 'subtitle', warnings),
    body: safeOptionalString(slide.body, 'body', warnings),
    bodySecondary: safeOptionalString(slide.bodySecondary, 'bodySecondary', warnings),
    quote: safeOptionalString(slide.quote, 'quote', warnings),
    imageUrl: safeOptionalString(slide.imageUrl, 'imageUrl', warnings),
    imageUrls: safeStringArray(slide.imageUrls, 'imageUrls', warnings),
    imageCaption: safeOptionalString(slide.imageCaption, 'imageCaption', warnings),
    bullets: safeStringArray(slide.bullets, 'bullets', warnings),
    credit: safeOptionalString(slide.credit, 'credit', warnings),
    companyName: safeOptionalString(slide.companyName, 'companyName', warnings),
    companyLogoUrl: safeOptionalString(slide.companyLogoUrl, 'companyLogoUrl', warnings),
    _debug_image_ids: safeStringArray(slide._debug_image_ids, '_debug_image_ids', warnings),
    characters: Array.isArray(slide.characters)
      ? slide.characters.map((character, index) => ({
          name: safeOptionalString(character?.name, `characters[${index}].name`, warnings) || 'Unnamed',
          role: safeOptionalString(character?.role, `characters[${index}].role`, warnings) || '',
          description: safeOptionalString(character?.description, `characters[${index}].description`, warnings) || 'Role to be defined.',
          imageUrl: safeOptionalString(character?.imageUrl, `characters[${index}].imageUrl`, warnings),
        }))
      : slide.characters,
    comparables: Array.isArray(slide.comparables)
      ? slide.comparables.map((comparable, index) => ({
          title: safeOptionalString(comparable?.title, `comparables[${index}].title`, warnings) || 'Untitled Comparable',
          reason: safeOptionalString(comparable?.reason, `comparables[${index}].reason`, warnings) || '',
        }))
      : slide.comparables,
  };

  const slideKey = `${slideIndex}:${slide.type}:${normalizedSlide.title || 'untitled'}`;
  if (!seenRenderDiagnostics.has(slideKey)) {
    if (warnings.length > 0) {
      console.warn('[LookBook] WARNING: non-string reached renderer', { slideIndex, slideType: slide.type, fields: warnings });
    }
    seenRenderDiagnostics.add(slideKey);
  }
  return normalizedSlide;
}

export function SlideRenderer({ slide, identity, slideIndex, totalSlides, deckFormat = 'landscape' }: SlideRendererProps) {
  const normalizedSlide = normalizeSlideForRender(slide, slideIndex);
  const { colors, typography } = identity;
  const fontTitle = typography.titleFont;
  const fontBody = typography.bodyFont;
  const isPortrait = deckFormat === 'portrait';
  const { width: slideW, height: slideH } = getSlideDimensions(deckFormat);

  const baseStyle: React.CSSProperties = {
    width: slideW,
    height: slideH,
    background: `linear-gradient(160deg, ${colors.bg}, ${colors.gradientTo})`,
    color: colors.text,
    fontFamily: `"${fontBody}", sans-serif`,
    position: 'relative',
    overflow: 'hidden',
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: `"${fontTitle}", serif`,
    textTransform: typography.titleUppercase ? 'uppercase' : 'none',
    letterSpacing: typography.titleUppercase ? '0.12em' : '0.02em',
  };

  const shared: SlideProps = { slide: normalizedSlide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait };

  switch (normalizedSlide.type) {
    case 'cover': return <CoverSlide {...shared} />;
    case 'overview': return <OverviewSlide {...shared} />;
    case 'world': return <WorldSlide {...shared} />;
    case 'characters': return <CharacterSlide {...shared} />;
    case 'themes': return <ThemesSlide {...shared} />;
    case 'visual_language': return <VisualLanguageSlide {...shared} />;
    case 'story_engine': return <StoryEngineSlide {...shared} />;
    case 'key_moments': return <KeyMomentsSlide {...shared} />;
    case 'comparables': return <ComparablesSlide {...shared} />;
    case 'creative_statement': return <StatementSlide {...shared} />;
    case 'closing': return <ClosingSlide {...shared} />;
    default: return <ContentSlide {...shared} />;
  }
}

/* ─── Shared primitives ─── */

interface SlideProps {
  slide: SlideContent;
  colors: LookBookVisualIdentity['colors'];
  titleStyle: React.CSSProperties;
  baseStyle: React.CSSProperties;
  fontBody: string;
  slideIndex: number;
  totalSlides: number;
  isPortrait: boolean;
}

/* ─── Layout-family-aware image zone ─── */

function LayoutAwareImageZone({ slide, colors, maxImages = 4 }: {
  slide: SlideContent;
  colors: LookBookVisualIdentity['colors'];
  maxImages?: number;
}) {
  const slotUrls = slide.slotAssignments
    ?.filter(s => s.assignedUrl)
    .map(s => s.assignedUrl!) || [];
  const rawImgs = (slide.imageUrls?.length ? slide.imageUrls : slide.imageUrl ? [slide.imageUrl] : []);
  const imgs = (slotUrls.length > 0 ? slotUrls : rawImgs).slice(0, maxImages);
  if (imgs.length === 0) return null;

  const family = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const border = `1px solid ${colors.accentMuted}`;

  if (family === 'landscape_portrait_hero') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '100%', height: '100%', maxWidth: 420,
          borderRadius: 8, overflow: 'hidden', border,
          background: colors.bgSecondary,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={imgs[0]} alt="" style={{
            width: '100%', height: '100%',
            objectFit: 'contain',
            filter: 'saturate(0.85) contrast(1.05)',
          }} />
        </div>
      </div>
    );
  }

  if (family === 'landscape_two_up_portrait') {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 12, alignItems: 'stretch',
      }}>
        {imgs.slice(0, 2).map((url, i) => (
          <div key={i} style={{
            borderRadius: 8, overflow: 'hidden', border,
            background: colors.bgSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src={url} alt="" style={{
              width: '100%', height: '100%',
              objectFit: 'contain',
              filter: 'saturate(0.85) contrast(1.05)',
            }} />
          </div>
        ))}
      </div>
    );
  }

  if (family === 'landscape_mixed_editorial' && imgs.length >= 2) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: '3fr 2fr',
        gridTemplateRows: imgs.length > 2 ? '1fr 1fr' : '1fr',
        gap: 8,
      }}>
        {imgs.slice(0, 4).map((url, i) => (
          <div key={i} style={{
            borderRadius: 6, overflow: 'hidden', border,
            background: colors.bgSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            ...(i === 0 && imgs.length > 2 ? { gridRow: '1 / 3' } : {}),
          }}>
            <img src={url} alt="" style={{
              width: '100%', height: '100%',
              objectFit: i === 0 ? 'contain' : 'cover',
              filter: 'saturate(0.85) contrast(1.05)',
            }} />
          </div>
        ))}
      </div>
    );
  }

  if (family === 'landscape_character_portraits') {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : 'repeat(3, 1fr)',
        gap: 12, alignItems: 'stretch',
      }}>
        {imgs.slice(0, 3).map((url, i) => (
          <div key={i} style={{
            borderRadius: 8, overflow: 'hidden', border,
            background: colors.bgSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src={url} alt="" style={{
              width: '100%', height: '100%',
              objectFit: 'contain',
              filter: 'saturate(0.85) contrast(1.05)',
            }} />
          </div>
        ))}
      </div>
    );
  }

  // ── Landscape Standard — fill available space
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'grid',
      gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
      gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
      gap: 8,
    }}>
      {imgs.slice(0, 4).map((url, i) => {
        const slotInfo = slide.slotAssignments?.find(s => s.assignedUrl === url);
        const isPortraitImg = slotInfo?.assignedOrientation === 'portrait' || slotInfo?.assignedOrientation === 'square';
        return (
          <div key={i} style={{
            borderRadius: 6, overflow: 'hidden', border,
            background: isPortraitImg ? colors.bgSecondary : undefined,
            display: isPortraitImg ? 'flex' : undefined,
            alignItems: isPortraitImg ? 'center' : undefined,
            justifyContent: isPortraitImg ? 'center' : undefined,
            ...(imgs.length === 1 ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}),
            ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
          }}>
            <img src={url} alt="" style={{
              width: '100%', height: '100%',
              objectFit: isPortraitImg ? 'contain' : 'cover',
              filter: 'saturate(0.85) contrast(1.05)',
            }} />
          </div>
        );
      })}
    </div>
  );
}

function SlideNumber({ index, total, color }: { index: number; total: number; color: string }) {
  return (
    <div
      className="absolute bottom-8 right-14"
      style={{ color, opacity: 0.35, fontVariantNumeric: 'tabular-nums', fontSize: 13, letterSpacing: '0.15em' }}
    >
      {String(index + 1).padStart(2, '0')} — {String(total).padStart(2, '0')}
    </div>
  );
}

function AccentRule({ color, width = 48, centered = false }: { color: string; width?: number; centered?: boolean }) {
  return <div style={{ width, height: 2, background: color, opacity: 0.5, marginBottom: 20, ...(centered ? { margin: '0 auto 20px' } : {}) }} />;
}

function SectionTag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      color, opacity: 0.6, fontSize: 11, letterSpacing: '0.35em',
      textTransform: 'uppercase', display: 'block', marginBottom: 10,
    }}>
      {label}
    </span>
  );
}

function EdgeAccent({ color }: { color: string }) {
  return (
    <div
      className="absolute left-0 top-0 bottom-0"
      style={{ width: 4, background: `linear-gradient(to bottom, transparent, ${color}, transparent)`, opacity: 0.3 }}
    />
  );
}

/**
 * Cinematic Credit Block — film poster-style credit lockup.
 *
 * Variants:
 * - full: complete credits (cover, closing)
 * - reduced: company + writer/director (character slides)
 * - minimal: company name only (key moments, etc.)
 */
function CinematicCreditBlock({
  title,
  companyName,
  credit,
  companyLogoUrl,
  colors,
  variant = 'full',
  centered = false,
  scale = 1,
}: {
  title?: string;
  companyName?: string;
  credit?: string;
  companyLogoUrl?: string;
  colors: { text: string; textMuted: string; accent: string; accentMuted: string; bg: string };
  variant?: 'full' | 'reduced' | 'minimal';
  centered?: boolean;
  scale?: number;
}) {
  const company = companyName || 'Paradox House';
  const baseFontSize = 11 * scale;
  const smallFontSize = 9.5 * scale;
  const titleFontSize = 12 * scale;

  const lineStyle: React.CSSProperties = {
    fontSize: smallFontSize,
    letterSpacing: '0.28em',
    textTransform: 'uppercase',
    color: colors.textMuted,
    opacity: 0.8,
    lineHeight: 2.2,
    fontFamily: '"DM Sans", sans-serif',
    textAlign: centered ? 'center' : undefined,
  };

  const titleLineStyle: React.CSSProperties = {
    fontSize: titleFontSize,
    letterSpacing: '0.35em',
    textTransform: 'uppercase',
    color: colors.text,
    opacity: 0.85,
    lineHeight: 2.4,
    fontWeight: 600,
    fontFamily: '"DM Sans", sans-serif',
    textAlign: centered ? 'center' : undefined,
  };

  const accentLineStyle: React.CSSProperties = {
    ...lineStyle,
    color: colors.accent,
    opacity: 0.75,
  };

  const wrapperStyle: React.CSSProperties = {
    maxWidth: 520 * scale,
    display: 'flex',
    flexDirection: 'column',
    alignItems: centered ? 'center' : 'flex-start',
    gap: 0,
  };

  if (variant === 'minimal') {
    return (
      <div style={wrapperStyle}>
        <span style={{ ...lineStyle, opacity: 0.5 }}>{company}</span>
      </div>
    );
  }

  if (variant === 'reduced') {
    return (
      <div style={wrapperStyle}>
        <span style={lineStyle}>{company} presents</span>
        {credit && <span style={accentLineStyle}>{credit}</span>}
      </div>
    );
  }

  // ── Full variant — film poster credit block ──
  return (
    <div style={wrapperStyle}>
      <span style={lineStyle}>{company} presents</span>
      <span style={lineStyle}>A film by Sebastian Street</span>
      {title && <span style={titleLineStyle}>{title}</span>}
      <span style={lineStyle}>Written and Directed by Sebastian Street</span>
      <span style={lineStyle}>Produced by Merlin Merton, Alex Chang and Greer Ellison</span>
      {companyLogoUrl && (
        <img src={companyLogoUrl} alt="" style={{
          height: 18 * scale, objectFit: 'contain',
          opacity: 0.35, filter: 'brightness(2)',
          marginTop: 8 * scale,
        }} />
      )}
    </div>
  );
}

/**
 * Cinematic background image layer — full-bleed with controllable overlay.
 */
function CinematicBackground({ 
  src, 
  colors, 
  overlayStrength = 'medium',
  overlayDirection = 'left-heavy',
}: { 
  src: string; 
  colors: { bg: string; gradientTo: string };
  overlayStrength?: 'light' | 'medium' | 'heavy' | 'vignette';
  overlayDirection?: 'left-heavy' | 'bottom-heavy' | 'center-vignette' | 'even';
}) {
  const overlays: Record<string, Record<string, string>> = {
    'left-heavy': {
      light: `linear-gradient(to right, ${colors.bg}dd 0%, ${colors.bg}99 30%, ${colors.bg}44 60%, transparent 85%), linear-gradient(to top, ${colors.bg}cc 0%, transparent 40%)`,
      medium: `linear-gradient(to right, ${colors.bg}ee 0%, ${colors.bg}cc 35%, ${colors.bg}66 60%, ${colors.bg}33 85%), linear-gradient(to top, ${colors.bg}dd 0%, ${colors.bg}88 30%, transparent 55%)`,
      heavy: `linear-gradient(to right, ${colors.bg}f5 0%, ${colors.bg}dd 40%, ${colors.bg}99 65%, ${colors.bg}66 90%), linear-gradient(to top, ${colors.bg}ee 0%, ${colors.bg}aa 35%, transparent 60%)`,
      vignette: `radial-gradient(ellipse at 30% 50%, ${colors.bg}cc 0%, ${colors.bg}66 40%, ${colors.bg}33 70%, transparent 100%), linear-gradient(to top, ${colors.bg}dd 0%, transparent 40%)`,
    },
    'bottom-heavy': {
      light: `linear-gradient(to top, ${colors.bg}ee 0%, ${colors.bg}99 35%, ${colors.bg}44 60%, transparent 80%)`,
      medium: `linear-gradient(to top, ${colors.bg}f5 0%, ${colors.bg}cc 30%, ${colors.bg}66 55%, ${colors.bg}33 80%)`,
      heavy: `linear-gradient(to top, ${colors.bg}f8 0%, ${colors.bg}dd 35%, ${colors.bg}99 60%, ${colors.bg}66 85%)`,
      vignette: `radial-gradient(ellipse at center bottom, ${colors.bg}ee 0%, ${colors.bg}88 40%, ${colors.bg}44 70%, transparent 100%)`,
    },
    'center-vignette': {
      light: `radial-gradient(ellipse at center, transparent 20%, ${colors.bg}66 60%, ${colors.bg}cc 100%)`,
      medium: `radial-gradient(ellipse at center, ${colors.bg}44 10%, ${colors.bg}88 50%, ${colors.bg}dd 90%)`,
      heavy: `radial-gradient(ellipse at center, ${colors.bg}88 10%, ${colors.bg}bb 50%, ${colors.bg}ee 90%)`,
      vignette: `radial-gradient(ellipse at center, transparent 15%, ${colors.bg}88 50%, ${colors.bg}ee 100%)`,
    },
    'even': {
      light: `linear-gradient(160deg, ${colors.bg}88 0%, ${colors.bg}66 50%, ${colors.bg}88 100%)`,
      medium: `linear-gradient(160deg, ${colors.bg}aa 0%, ${colors.bg}88 50%, ${colors.bg}aa 100%)`,
      heavy: `linear-gradient(160deg, ${colors.bg}cc 0%, ${colors.bg}aa 50%, ${colors.bg}cc 100%)`,
      vignette: `linear-gradient(160deg, ${colors.bg}99 0%, ${colors.bg}77 50%, ${colors.bg}99 100%)`,
    },
  };

  return (
    <div className="absolute inset-0">
      <img 
        src={src} 
        alt="" 
        className="w-full h-full" 
        style={{ 
          objectFit: 'cover', 
          objectPosition: 'center',
          filter: 'saturate(0.75) contrast(1.1)',
        }} 
      />
      <div className="absolute inset-0" style={{
        background: overlays[overlayDirection]?.[overlayStrength] || overlays['left-heavy']['medium'],
      }} />
    </div>
  );
}

/** Portrait text density cap */
function capText(text: string | undefined, maxChars: number, isPortrait: boolean): string | undefined {
  if (!text || !isPortrait) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

/**
 * Native-fit image renderer for portrait slides.
 */
function PortraitImage({ src, alt = '', style, isBackground = false }: {
  src: string; alt?: string; style?: React.CSSProperties; isBackground?: boolean;
}) {
  const fit = isBackground ? 'cover' : 'contain';
  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
        ...style,
      }}
    />
  );
}

function UnresolvedPlaceholder({ label = 'Awaiting compliant vertical image', colors }: {
  label?: string; colors: { bg: string; textMuted: string; accent: string; accentMuted: string };
}) {
  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(160deg, ${colors.bg} 0%, ${colors.accentMuted} 100%)`,
        border: `1px dashed ${colors.accent}44`,
        borderRadius: 8,
      }}
    >
      <div style={{
        width: 40, height: 56, borderRadius: 6,
        border: `2px dashed ${colors.accent}66`,
        marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 18, opacity: 0.4, color: colors.textMuted }}>9:16</span>
      </div>
      <span style={{ fontSize: 11, color: colors.textMuted, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.6 }}>
        {label}
      </span>
    </div>
  );
}

function PortraitImageOrPlaceholder({ src, colors, alt = '', style, isBackground = false, hasUnresolved = false }: {
  src?: string; colors: { bg: string; textMuted: string; accent: string; accentMuted: string };
  alt?: string; style?: React.CSSProperties; isBackground?: boolean; hasUnresolved?: boolean;
}) {
  if (src) return <PortraitImage src={src} alt={alt} style={style} isBackground={isBackground} />;
  if (hasUnresolved) return <UnresolvedPlaceholder colors={colors} />;
  return null;
}

/**
 * Decorative gradient pattern for slides without background images.
 * Prevents bland flat voids while maintaining elegance.
 */
function DecorativeGradientBg({ colors, variant = 'diagonal' }: {
  colors: { bg: string; bgSecondary: string; accent: string; accentMuted: string; gradientTo: string };
  variant?: 'diagonal' | 'radial' | 'geometric';
}) {
  const patterns: Record<string, React.CSSProperties> = {
    diagonal: {
      background: `
        linear-gradient(160deg, ${colors.bg} 0%, ${colors.gradientTo} 40%, ${colors.bgSecondary} 100%),
        repeating-linear-gradient(45deg, transparent, transparent 80px, ${colors.accent}06 80px, ${colors.accent}06 82px)
      `,
    },
    radial: {
      background: `
        radial-gradient(ellipse at 20% 80%, ${colors.accentMuted} 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, ${colors.bgSecondary} 0%, transparent 60%),
        linear-gradient(160deg, ${colors.bg}, ${colors.gradientTo})
      `,
    },
    geometric: {
      background: `
        linear-gradient(160deg, ${colors.bg} 0%, ${colors.gradientTo} 100%)
      `,
    },
  };
  return (
    <div className="absolute inset-0" style={patterns[variant] || patterns.diagonal}>
      {/* Subtle accent line */}
      <div className="absolute" style={{
        bottom: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(to right, transparent, ${colors.accent}22, transparent)`,
      }} />
    </div>
  );
}

/**
 * Glass text panel — frosted backdrop for text blocks over imagery.
 * More opaque and legible than raw text-over-image.
 */
function GlassPanel({ colors, children, style }: {
  colors: { bg: string; bgSecondary: string; accentMuted: string };
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: `${colors.bgSecondary}dd`,
      backdropFilter: 'blur(12px)',
      border: `1px solid ${colors.accentMuted}`,
      borderRadius: 10,
      ...style,
    }}>
      {children}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   COVER — full-bleed poster with bottom title lockup
   ═══════════════════════════════════════════════════════════════════════ */
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody, isPortrait }: SlideProps) {
  const hasHero = !!slide.imageUrl;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {hasHero && (
          <div className="absolute inset-0" style={{ background: colors.bg }}>
            <img src={slide.imageUrl!} alt="" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top',
              filter: 'saturate(0.3) blur(16px) contrast(1.1)',
              opacity: 0.18, transform: 'scale(1.08)',
            }} />
            <img src={slide.imageUrl!} alt="" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center 15%',
              filter: 'saturate(0.75) contrast(1.15)',
            }} />
            <div className="absolute inset-0" style={{
              background: `linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}f0 18%, ${colors.bg}99 40%, transparent 65%)`,
            }} />
          </div>
        )}
        <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0 64px 96px' }}>
          <div style={{ maxWidth: 960 }}>
            <div style={{ width: 56, height: 3, background: colors.accent, opacity: 0.7, marginBottom: 24 }} />
            <h1 style={{ ...titleStyle, fontSize: 88, fontWeight: 700, lineHeight: 0.92, color: colors.text, marginBottom: 20 }}>
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p style={{ fontSize: 22, lineHeight: 1.45, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 640, marginBottom: 32 }}>
                {capText(slide.subtitle, 160, true)}
              </p>
            )}
            <CinematicCreditBlock
              title={slide.title}
              companyName={slide.companyName}
              credit={slide.credit}
              companyLogoUrl={slide.companyLogoUrl}
              colors={colors}
              variant="full"
              scale={0.9}
            />
          </div>
        </div>
        {slide.companyLogoUrl && (
          <div className="absolute top-14 right-14">
            <img src={slide.companyLogoUrl} alt="" className="h-8 object-contain" style={{ opacity: 0.4, filter: 'brightness(2)' }} />
          </div>
        )}
      </div>
    );
  }

  // ── Landscape cover ──
  const effectiveFamily = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const isPortraitHero = effectiveFamily === 'landscape_portrait_hero';
  return (
    <div style={baseStyle} className="slide-content">
      {hasHero && (
        <div className="absolute inset-0">
          {isPortraitHero ? (
            <>
              <img src={slide.imageUrl} alt="" className="w-full h-full" style={{
                objectFit: 'cover', filter: 'saturate(0.3) blur(16px) contrast(1.1)',
                opacity: 0.15, transform: 'scale(1.08)',
              }} />
              <div style={{
                position: 'absolute', top: 40, bottom: 40, right: 80, width: 440,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, overflow: 'hidden',
              }}>
                <img src={slide.imageUrl} alt="" style={{
                  width: '100%', height: '100%', objectFit: 'contain',
                  filter: 'saturate(0.75) contrast(1.15)',
                }} />
              </div>
            </>
          ) : (
            <>
              <img src={slide.imageUrl} alt="" className="w-full h-full object-cover object-top" style={{ filter: 'saturate(0.7) contrast(1.15)' }} />
              <div className="absolute inset-0" style={{
                background: `
                  linear-gradient(to right, ${colors.bg} 0%, ${colors.bg}ee 35%, transparent 65%),
                  linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}cc 25%, transparent 50%),
                  linear-gradient(135deg, ${colors.bg}aa 0%, transparent 60%)
                `,
              }} />
            </>
          )}
          {isPortraitHero && (
            <div className="absolute inset-0" style={{
              background: `linear-gradient(to right, ${colors.bg} 0%, ${colors.bg}ee 45%, transparent 70%)`,
            }} />
          )}
        </div>
      )}
      {!hasHero && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0' }}>
        <div style={{ padding: '80px 96px 0', maxWidth: isPortraitHero ? 780 : hasHero ? 960 : 1200 }}>
          <div style={{ width: 48, height: 2, background: colors.accent, opacity: 0.6, marginBottom: 28 }} />
          <h1 style={{ ...titleStyle, fontSize: hasHero ? 96 : 112, fontWeight: 700, lineHeight: 0.95, color: colors.text, marginBottom: 16 }}>
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p style={{ fontSize: 24, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 720 }}>
              {slide.subtitle}
            </p>
          )}
        </div>
        <div style={{
          marginTop: 'auto',
          padding: '24px 96px 20px',
          background: `linear-gradient(to top, ${colors.bg}f5 0%, ${colors.bg}cc 60%, transparent 100%)`,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          borderTop: `1px solid ${colors.accentMuted}`,
        }}>
          <CinematicCreditBlock
            title={slide.title}
            companyName={slide.companyName}
            credit={slide.credit}
            companyLogoUrl={slide.companyLogoUrl}
            colors={colors}
            variant="full"
            scale={0.85}
          />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW — tight metadata + logline, cinematic background
   ═══════════════════════════════════════════════════════════════════════ */
function OverviewSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ padding: '72px 64px 64px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <SectionTag label="Project Overview" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{ fontSize: 28, lineHeight: 1.4, fontWeight: 500, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 32, maxWidth: 900 }}>
              {capText(slide.body, 280, true)}
            </p>
          )}
          {slide.bodySecondary && (
            <p style={{ fontSize: 18, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 48, maxWidth: 860 }}>
              {capText(slide.bodySecondary, 400, true)}
            </p>
          )}
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{
              marginTop: 'auto',
              background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
              borderRadius: 10, padding: '36px 40px',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(slide.bullets.length, 3)}, 1fr)`,
              gap: 28,
            }}>
              {slide.bullets.map((b, i) => {
                const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
                return (
                  <div key={i}>
                    {label && <span style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: colors.accent, display: 'block', marginBottom: 8 }}>{label}</span>}
                    <span style={{ fontSize: 20, color: colors.text, fontWeight: 500 }}>{value}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape overview — cinematic background with tighter composition ──
  const hasBg = !!slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {hasBg && <CinematicBackground src={slide.backgroundImageUrl!} colors={colors} overlayStrength="heavy" overlayDirection="left-heavy" />}
      {!hasBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '72px 96px 60px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Project Overview" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 600, marginBottom: 32, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 48, flex: 1, alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: hasBg ? 680 : 800 }}>
            {slide.body && <p style={{ fontSize: 26, lineHeight: 1.45, fontWeight: 500, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 16, lineHeight: 1.7, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {slide.bullets && slide.bullets.length > 0 && (
            <GlassPanel colors={colors} style={{ width: 380, flexShrink: 0, padding: '36px 32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {slide.bullets.map((b, i) => {
                  const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
                  return (
                    <div key={i}>
                      {label && <span style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.accent, display: 'block', marginBottom: 6 }}>{label}</span>}
                      <span style={{ fontSize: 20, color: colors.text, fontWeight: 500 }}>{value}</span>
                    </div>
                  );
                })}
              </div>
            </GlassPanel>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   WORLD — immersive atmosphere with aggressive image use
   ═══════════════════════════════════════════════════════════════════════ */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {(slide.imageUrl || imgs[0]) && (
          <div className="absolute inset-0">
            <img src={slide.imageUrl || imgs[0]} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.08, filter: 'saturate(0.3) blur(6px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f0 0%, ${colors.bg}cc 40%, ${colors.bg}e0 100%)` }} />
          </div>
        )}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {hasImages && (
            <div style={{
              height: '50%', flexShrink: 0, padding: '8px 8px 0',
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : '2fr 1fr',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
              gap: 6,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  overflow: 'hidden', borderRadius: 6, background: colors.bgSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1' } : {}),
                }}>
                  <PortraitImage src={url} style={{ filter: 'saturate(0.85) contrast(1.05)', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '28px 64px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="The World" color={colors.accent} />
            <AccentRule color={colors.accent} width={40} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 18, lineHeight: 1.55, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>{capText(slide.body, 320, true)}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>{capText(slide.bodySecondary, 250, true)}</p>}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape world — background + text/image split ──
  const worldBg = slide.backgroundImageUrl || slide.imageUrl || imgs[0];
  return (
    <div style={baseStyle} className="slide-content">
      {worldBg && <CinematicBackground src={worldBg} colors={colors} overlayStrength={hasImages ? 'medium' : 'heavy'} overlayDirection="left-heavy" />}
      {!worldBg && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        {/* Text panel — 45% */}
        <div style={{ width: '45%', padding: '72px 40px 72px 100px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="The World" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 19, lineHeight: 1.6, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          {slide.quote && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}` }}>
              <p style={{ fontSize: 15, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6 }}>"{slide.quote}"</p>
            </div>
          )}
        </div>
        {/* Image zone — 55%, fills aggressively */}
        {hasImages && (
          <div style={{ width: '55%', padding: '40px 48px 40px 0', display: 'flex', alignItems: 'stretch' }}>
            <LayoutAwareImageZone slide={slide} colors={colors} />
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CHARACTERS — hero+supporting with tight portrait cards
   ═══════════════════════════════════════════════════════════════════════ */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const chars = slide.characters || [];
  if (chars.length === 0) return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} isPortrait={isPortrait} />;

  const lead = chars[0];
  const supporting = chars.slice(1);
  const isSmallCast = chars.length <= 3;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '48px 56px 8px', flexShrink: 0 }}>
            <SectionTag label="Characters" color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>
          {/* Lead character — hero card */}
          {lead && (
            <div style={{
              margin: '12px 24px', flexShrink: 0,
              height: supporting.length > 0 ? '40%' : '55%',
              background: colors.bgSecondary, border: `1px solid ${colors.accent}44`,
              borderRadius: 10, overflow: 'hidden', position: 'relative',
            }}>
              {lead.imageUrl ? (
                <>
                  <PortraitImage src={lead.imageUrl} style={{ filter: 'saturate(0.8) contrast(1.1)' }} />
                  <div className="absolute inset-x-0 bottom-0" style={{
                    background: `linear-gradient(to top, ${colors.bg}ee 0%, ${colors.bg}cc 50%, transparent 100%)`,
                    padding: '48px 32px 24px',
                  }}>
                    <h3 style={{ fontSize: 28, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4, lineHeight: 1.15 }}>{lead.name}</h3>
                    {lead.role && <span style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 8 }}>{lead.role}</span>}
                    <p style={{ fontSize: 14, lineHeight: 1.5, color: colors.text, opacity: 0.85, fontFamily: `"${fontBody}", sans-serif` }}>
                      {capText(lead.description, 160, true)}
                    </p>
                  </div>
                </>
              ) : (
                <div style={{ padding: '32px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <span style={{ fontSize: 80, fontWeight: 700, color: colors.accent, opacity: 0.12, fontFamily: '"Fraunces", serif' }}>{lead.name.charAt(0)}</span>
                  <h3 style={{ fontSize: 28, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginTop: 12, marginBottom: 4 }}>{lead.name}</h3>
                  {lead.role && <span style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 12 }}>{lead.role}</span>}
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.text, opacity: 0.85, textAlign: 'center', maxWidth: 600 }}>{capText(lead.description, 200, true)}</p>
                </div>
              )}
            </div>
          )}
          {/* Supporting cast */}
          {supporting.length > 0 && (
            <div style={{
              flex: 1, margin: '8px 24px 20px',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(supporting.length, 2)}, 1fr)`,
              gap: 10, alignContent: 'stretch', minHeight: 0,
            }}>
              {supporting.slice(0, 4).map((c, i) => (
                <div key={i} style={{
                  background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                  borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}>
                  {c.imageUrl ? (
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg }}>
                      <PortraitImage src={c.imageUrl} style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
                    </div>
                  ) : (
                    <div style={{ height: 60, flexShrink: 0, background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${colors.accentMuted}` }}>
                      <span style={{ fontSize: 24, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: '"Fraunces", serif' }}>{c.name.charAt(0)}</span>
                    </div>
                  )}
                  <div style={{ padding: '12px 14px', flexShrink: 0 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 2, lineHeight: 1.2 }}>{c.name}</h3>
                    {c.role && <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 4 }}>{c.role}</span>}
                    <p style={{ fontSize: 12, lineHeight: 1.4, color: colors.text, opacity: 0.8, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {c.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape characters — dense layout, no dead space ──
  const charEffective = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const isPortraitFamily = charEffective === 'landscape_character_portraits'
    || charEffective === 'landscape_two_up_portrait'
    || charEffective === 'landscape_portrait_hero';
  
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '56px 80px 56px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginBottom: 24, flexShrink: 0 }}>
          <div>
            <SectionTag label="Characters" color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>
        </div>
        {isSmallCast ? (
          <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
            {chars.map((c, i) => (
              <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={i === 0} tall useContain={isPortraitFamily} isPortrait={false} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
            {lead && (
              <div style={{ width: 380, flexShrink: 0, display: 'flex' }}>
                <CharCard char={lead} colors={colors} fontBody={fontBody} isLead tall useContain={isPortraitFamily} isPortrait={false} />
              </div>
            )}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, alignContent: 'stretch' }}>
              {supporting.map((c, i) => (
                <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={false} tall={false} useContain={isPortraitFamily} isPortrait={false} />
              ))}
            </div>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/** Character card — portrait-optimized, fills vertical space */
function CharCard({ char, colors, fontBody, isLead, tall, isPortrait, useContain = false }: {
  char: { name: string; role: string; description: string; imageUrl?: string };
  colors: LookBookVisualIdentity['colors']; fontBody: string;
  isLead: boolean; tall: boolean; isPortrait: boolean; useContain?: boolean;
}) {
  return (
    <div style={{
      flex: 1, background: colors.bgSecondary,
      border: `1px solid ${isLead ? colors.accent + '66' : colors.accentMuted}`,
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {char.imageUrl ? (
        <div style={{
          flex: 1, minHeight: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: colors.bg,
        }}>
          <PortraitImage src={char.imageUrl} alt={char.name} style={{ objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
        </div>
      ) : (
        <div style={{
          flex: 1, minHeight: tall ? 120 : 60, flexShrink: 0,
          background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: `1px solid ${colors.accentMuted}`,
        }}>
          <span style={{ fontSize: tall ? 48 : 28, fontWeight: 700, color: colors.accent, opacity: 0.15, fontFamily: '"Fraunces", serif' }}>{char.name.charAt(0)}</span>
        </div>
      )}
      <div style={{ padding: tall ? '16px 20px' : '12px 16px', flexShrink: 0 }}>
        <h3 style={{ fontSize: isLead ? 22 : 17, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 3, lineHeight: 1.2 }}>{char.name}</h3>
        {char.role && <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 6, display: 'block' }}>{char.role}</span>}
        <p style={{ fontSize: tall ? 14 : 12, lineHeight: 1.5, color: colors.text, opacity: 0.82, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: tall ? 4 : 3, WebkitBoxOrient: 'vertical' }}>{char.description}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   THEMES — cinematic background with tight text + image split
   ═══════════════════════════════════════════════════════════════════════ */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const heroImg = slide.imageUrl || imgs[0];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {heroImg && (
          <div className="absolute inset-0">
            <img src={heroImg} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.1, filter: 'saturate(0.3) blur(6px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${colors.bg}e8 0%, ${colors.bg}cc 35%, ${colors.bg}f5 100%)` }} />
          </div>
        )}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {hasImages && (
            <div style={{
              height: '45%', flexShrink: 0, padding: '8px 8px 0',
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : '2fr 1fr',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
              gap: 6,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  overflow: 'hidden', borderRadius: 6, background: colors.bgSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1' } : {}),
                }}>
                  <PortraitImage src={url} style={{ filter: 'saturate(0.85) contrast(1.05)', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '28px 64px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Themes & Tone" color={colors.accent} />
            <AccentRule color={colors.accent} width={40} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 19, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>{capText(slide.body, 320, true)}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>{capText(slide.bodySecondary, 250, true)}</p>}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape themes ──
  const themesBg = slide.backgroundImageUrl || heroImg;
  return (
    <div style={baseStyle} className="slide-content">
      {themesBg && <CinematicBackground src={themesBg} colors={colors} overlayStrength="medium" overlayDirection="left-heavy" />}
      {!themesBg && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        <div style={{ width: hasImages ? '42%' : '55%', padding: '72px 40px 72px 100px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Themes & Tone" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 50, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 20, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
        </div>
        {hasImages && (
          <div style={{ flex: 1, padding: '48px 48px 48px 0', display: 'flex', alignItems: 'stretch' }}>
            <LayoutAwareImageZone slide={slide} colors={colors} />
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VISUAL LANGUAGE — aesthetic thesis with evidence panel
   ═══════════════════════════════════════════════════════════════════════ */
function VisualLanguageSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {hasImages && (
            <div style={{
              height: '40%', flexShrink: 0, padding: '8px 8px 0',
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : '2fr 1fr',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
              gap: 6,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  overflow: 'hidden', borderRadius: 6, background: colors.bgSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1' } : {}),
                }}>
                  <PortraitImage src={url} style={{ filter: 'saturate(0.85) contrast(1.05)', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '28px 64px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Visual Language" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 16, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 17, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>{capText(slide.body, 300, true)}</p>}
            {(slide.bullets || []).length > 0 && (
              <div style={{ marginTop: 4 }}>
                {slide.bullets!.slice(0, 4).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 6, opacity: 0.7 }} />
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{capText(b, 110, true)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape visual language ──
  const vlBg = slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {vlBg && <CinematicBackground src={vlBg} colors={colors} overlayStrength="heavy" overlayDirection="left-heavy" />}
      {!vlBg && <DecorativeGradientBg colors={colors} variant="geometric" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        <div style={{ width: hasImages ? '40%' : '55%', padding: '72px 40px 72px 100px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Visual Language" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 24, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 17, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
          {(slide.bullets || []).length > 0 && (
            <div style={{ marginTop: 4 }}>
              {slide.bullets!.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: 15, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {hasImages && (
          <div style={{ flex: 1, padding: '40px 48px 40px 0', display: 'flex', alignItems: 'stretch' }}>
            <LayoutAwareImageZone slide={slide} colors={colors} />
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STORY ENGINE — narrative architecture with numbered beats
   ═══════════════════════════════════════════════════════════════════════ */
function StoryEngineSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const bullets = slide.bullets || [];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {slide.imageUrl && (
          <div className="absolute inset-0">
            <img src={slide.imageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.05, filter: 'saturate(0.3) blur(6px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f5 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
          </div>
        )}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {hasImages && (
            <div style={{
              height: '35%', flexShrink: 0, padding: '8px 8px 0',
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : '2fr 1fr',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
              gap: 6,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  overflow: 'hidden', borderRadius: 6, background: colors.bgSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1' } : {}),
                }}>
                  <PortraitImage src={url} style={{ filter: 'saturate(0.8) contrast(1.05)', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '24px 64px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Story Engine" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 16, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 17, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12, maxWidth: 900 }}>{capText(slide.body, 280, true)}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12, maxWidth: 860 }}>{capText(slide.bodySecondary, 180, true)}</p>}
            {bullets.length > 0 && (
              <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: '16px 20px', marginTop: 4 }}>
                {bullets.slice(0, 4).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: i < bullets.length - 1 ? 10 : 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent, opacity: 0.5, fontFamily: `"${fontBody}", sans-serif`, minWidth: 20, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{capText(b, 110, true)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape story engine ──
  const seBg = slide.backgroundImageUrl || slide.imageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {seBg && <CinematicBackground src={seBg} colors={colors} overlayStrength="heavy" overlayDirection="left-heavy" />}
      {!seBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '64px 80px 64px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Story Engine" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 32, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: hasImages ? 600 : 780 }}>
            {slide.body && <p style={{ fontSize: 18, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12 }}>{slide.bodySecondary}</p>}
            {bullets.length > 0 && (
              <GlassPanel colors={colors} style={{ padding: '20px 24px', marginTop: 8 }}>
                {bullets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: i < bullets.length - 1 ? 10 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.accent, opacity: 0.5, fontFamily: `"${fontBody}", sans-serif`, minWidth: 22, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: 15, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{b}</span>
                  </div>
                ))}
              </GlassPanel>
            )}
          </div>
          {hasImages && (
            <div style={{ width: '45%', flexShrink: 0, display: 'flex', alignItems: 'stretch' }}>
              <LayoutAwareImageZone slide={slide} colors={colors} />
            </div>
          )}
        </div>
        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${colors.accentMuted}`, maxWidth: 700 }}>
            <p style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   KEY MOMENTS — cinematic image mosaic
   ═══════════════════════════════════════════════════════════════════════ */
function KeyMomentsSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const imgCount = imgs.length;
  const kmEffective = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const isPortraitFamily = !isPortrait && (
    kmEffective === 'landscape_portrait_hero'
    || kmEffective === 'landscape_two_up_portrait'
    || kmEffective === 'landscape_character_portraits'
  );
  const sectionLabel = slide.title?.toLowerCase().includes('poster') ? 'Poster Directions' : 'Key Moments';

  const getGridStyle = (): React.CSSProperties => {
    if (isPortrait) {
      if (imgCount === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
      if (imgCount === 2) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
      if (imgCount === 3) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '2fr 1fr' };
      if (imgCount === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '2fr 1fr 1fr' };
    }
    if (imgCount === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    if (imgCount === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    if (imgCount === 3) return { gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr' };
    if (imgCount === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
  };

  const getSpanStyle = (i: number): React.CSSProperties => {
    if (isPortrait) {
      if (imgCount === 3 && i === 0) return { gridColumn: '1 / -1' };
      if (imgCount >= 5 && i === 0) return { gridColumn: '1 / -1' };
      return {};
    }
    if (imgCount === 3 && i === 0) return { gridRow: '1 / 3' };
    if (imgCount >= 5 && i === 0) return { gridRow: '1 / 3' };
    return {};
  };

  // ── Empty state — intentional "awaiting visual content" treatment ──
  if (imgCount === 0) {
    return (
      <div style={baseStyle} className="slide-content">
        <DecorativeGradientBg colors={colors} variant="geometric" />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: isPortrait ? '60px 64px' : '80px 100px' }}>
          <SectionTag label={sectionLabel} color={colors.accent} />
          <AccentRule color={colors.accent} centered />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 48 : 56, fontWeight: 600, marginBottom: 24, color: colors.text, textAlign: 'center' }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: isPortrait ? 17 : 18, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 600, textAlign: 'center' }}>{slide.body}</p>}
          {/* Visual placeholder grid — signals this slide will be image-led */}
          <div style={{ marginTop: 48, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, width: '100%', maxWidth: 640 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                aspectRatio: '16/9', borderRadius: 8,
                border: `1px dashed ${colors.accent}33`,
                background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 20, color: colors.accent, opacity: 0.12 }}>●</span>
              </div>
            ))}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: isPortrait ? '32px 56px 8px' : '40px 80px 16px', flexShrink: 0 }}>
          <SectionTag label={sectionLabel} color={colors.accent} />
          <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', alignItems: isPortrait ? 'flex-start' : 'baseline', gap: isPortrait ? 6 : 24 }}>
            <h2 style={{ ...titleStyle, fontSize: isPortrait ? 38 : 40, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: isPortrait ? 13 : 14, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 500 }}>{slide.body}</p>}
          </div>
        </div>
        <div style={{
          flex: 1, padding: isPortrait ? '0 16px 24px' : '0 40px 40px',
          display: 'grid', ...getGridStyle(), gap: isPortrait ? 6 : 10, minHeight: 0,
        }}>
          {imgs.slice(0, 6).map((url, i) => (
            <div key={i} style={{
              borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
              background: (isPortrait || isPortraitFamily) ? colors.bgSecondary : undefined,
              display: (isPortrait || isPortraitFamily) ? 'flex' : undefined,
              alignItems: (isPortrait || isPortraitFamily) ? 'center' : undefined,
              justifyContent: (isPortrait || isPortraitFamily) ? 'center' : undefined,
              ...getSpanStyle(i),
            }}>
              {(isPortrait || isPortraitFamily) ? (
                <PortraitImage src={url} style={{ filter: 'saturate(0.85) contrast(1.08)', borderRadius: 4 }} />
              ) : (
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
              )}
            </div>
          ))}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPARABLES — market positioning with cinematic background
   ═══════════════════════════════════════════════════════════════════════ */
function ComparablesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const comps = slide.comparables || [];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ padding: '56px 64px 52px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <SectionTag label="Market Positioning" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 32, color: colors.text }}>{slide.title}</h2>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center' }}>
            {comps.slice(0, 4).map((c, i) => (
              <div key={i} style={{
                background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                borderRadius: 10, padding: '24px 28px',
                display: 'flex', alignItems: 'flex-start', gap: 20,
              }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: `"${fontBody}", sans-serif`, lineHeight: 1, minWidth: 40 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 style={{ fontSize: 20, fontWeight: 600, color: colors.text, marginBottom: 6, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                  {c.reason && <p style={{ fontSize: 14, lineHeight: 1.5, color: colors.textMuted }}>{capText(c.reason, 180, true)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape comparables ──
  const compBg = slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {compBg && <CinematicBackground src={compBg} colors={colors} overlayStrength="heavy" overlayDirection="even" />}
      {!compBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '64px 80px 64px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Market Positioning" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24, flex: 1, alignContent: 'center' }}>
          {comps.map((c, i) => (
            <GlassPanel key={i} colors={colors} style={{ padding: '24px 28px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: colors.accent, opacity: 0.25, fontFamily: `"${fontBody}", sans-serif`, lineHeight: 1, minWidth: 44 }}>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: colors.text, marginBottom: 6, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                {c.reason && <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.textMuted }}>{c.reason}</p>}
              </div>
            </GlassPanel>
          ))}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CREATIVE STATEMENT — text-over-atmosphere with glass panel
   ═══════════════════════════════════════════════════════════════════════ */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {slide.backgroundImageUrl && <CinematicBackground src={slide.backgroundImageUrl} colors={colors} overlayStrength="heavy" overlayDirection="center-vignette" />}
        {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, padding: '80px 64px 80px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Creative Vision" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 20, lineHeight: 1.65, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 900 }}>{capText(slide.body, 400, true)}</p>}
          {slide.credit && (
            <div style={{ marginTop: 48, paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
              <span style={{ fontSize: 12, letterSpacing: '0.2em', color: colors.accent, textTransform: 'uppercase', opacity: 0.7 }}>{slide.credit}</span>
            </div>
          )}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape statement ──
  return (
    <div style={baseStyle} className="slide-content">
      {slide.backgroundImageUrl && <CinematicBackground src={slide.backgroundImageUrl} colors={colors} overlayStrength="heavy" overlayDirection="center-vignette" />}
      {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '80px 120px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <SectionTag label="Creative Vision" color={colors.accent} />
        <AccentRule color={colors.accent} width={56} centered />
        <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 600, marginBottom: 36, color: colors.text, textAlign: 'center' }}>{slide.title}</h2>
        <GlassPanel colors={colors} style={{ padding: '40px 48px', maxWidth: 800 }}>
          {slide.body && <p style={{ fontSize: 19, lineHeight: 1.7, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, textAlign: 'center' }}>{slide.body}</p>}
        </GlassPanel>
        {slide.credit && (
          <div style={{ marginTop: 48, paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
            <span style={{ fontSize: 12, letterSpacing: '0.2em', color: colors.accent, textTransform: 'uppercase', opacity: 0.7 }}>{slide.credit}</span>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CLOSING — atmospheric bookend
   ═══════════════════════════════════════════════════════════════════════ */
function ClosingSlide({ slide, colors, titleStyle, baseStyle, fontBody, isPortrait }: SlideProps) {
  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {slide.backgroundImageUrl && (
          <div className="absolute inset-0">
            <img src={slide.backgroundImageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', filter: 'saturate(0.2) blur(20px) contrast(0.8)', opacity: 0.3, transform: 'scale(1.1)' }} />
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${colors.bg}cc 0%, ${colors.bg}ee 60%, ${colors.bg} 100%)` }} />
          </div>
        )}
        {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 64px' }}>
          <AccentRule color={colors.accent} width={64} centered />
          <h2 style={{ ...titleStyle, fontSize: 64, fontWeight: 700, color: colors.text, textAlign: 'center', marginBottom: 24, lineHeight: 0.95 }}>{slide.title}</h2>
          {slide.subtitle && <p style={{ fontSize: 20, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, textAlign: 'center', maxWidth: 640, marginBottom: 48 }}>{capText(slide.subtitle, 140, true)}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {slide.credit && <span style={{ fontSize: 12, letterSpacing: '0.15em', color: colors.accent, opacity: 0.7 }}>{slide.credit}</span>}
            {slide.companyName && <span style={{ fontSize: 11, letterSpacing: '0.3em', color: colors.textMuted, opacity: 0.4, textTransform: 'uppercase' }}>{slide.companyName}</span>}
          </div>
        </div>
        {slide.companyLogoUrl && (
          <div className="absolute bottom-14" style={{ left: '50%', transform: 'translateX(-50%)' }}>
            <img src={slide.companyLogoUrl} alt="" style={{ height: 24, objectFit: 'contain', opacity: 0.3, filter: 'brightness(2)' }} />
          </div>
        )}
      </div>
    );
  }

  // ── Landscape closing ──
  return (
    <div style={baseStyle} className="slide-content">
      {slide.backgroundImageUrl && (
        <div className="absolute inset-0">
          <img src={slide.backgroundImageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', filter: 'saturate(0.2) blur(20px) contrast(0.8)', opacity: 0.3, transform: 'scale(1.1)' }} />
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${colors.bg}cc 0%, ${colors.bg}ee 60%, ${colors.bg} 100%)` }} />
        </div>
      )}
      {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 120px' }}>
        <AccentRule color={colors.accent} width={64} centered />
        <h2 style={{ ...titleStyle, fontSize: 72, fontWeight: 700, color: colors.text, textAlign: 'center', marginBottom: 20, lineHeight: 0.95 }}>{slide.title}</h2>
        {slide.subtitle && <p style={{ fontSize: 22, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, textAlign: 'center', maxWidth: 700, marginBottom: 48 }}>{slide.subtitle}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {slide.credit && <span style={{ fontSize: 13, letterSpacing: '0.15em', color: colors.accent, opacity: 0.7 }}>{slide.credit}</span>}
          {slide.companyName && <span style={{ fontSize: 11, letterSpacing: '0.3em', color: colors.textMuted, opacity: 0.4, textTransform: 'uppercase' }}>{slide.companyName}</span>}
        </div>
      </div>
      {slide.companyLogoUrl && (
        <div className="absolute bottom-10 right-14">
          <img src={slide.companyLogoUrl} alt="" style={{ height: 20, objectFit: 'contain', opacity: 0.3, filter: 'brightness(2)' }} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   GENERIC FALLBACK
   ═══════════════════════════════════════════════════════════════════════ */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <DecorativeGradientBg colors={colors} variant="diagonal" />
      <EdgeAccent color={colors.accent} />
      <div style={{ position: 'relative', zIndex: 1, padding: isPortrait ? '64px 56px' : '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <SectionTag label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 44 : 52, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
        {slide.body && <p style={{ fontSize: isPortrait ? 17 : 19, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 800 }}>{isPortrait ? capText(slide.body, 350, true) : slide.body}</p>}
        {slide.bodySecondary && <p style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginTop: 20, maxWidth: 720 }}>{isPortrait ? capText(slide.bodySecondary, 250, true) : slide.bodySecondary}</p>}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

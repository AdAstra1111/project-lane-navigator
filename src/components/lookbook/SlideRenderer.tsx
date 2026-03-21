{/**
 * SlideRenderer — Premium cinematic slide compositions for vertical drama LookBooks.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 *
 * VERTICAL DRAMA SPEC: Each slide type has a distinct compositional identity:
 * - Cover: full-bleed poster hero with title lockup + credits
 * - Creative Vision: portrait hero left, concise vision text right
 * - World: landscape-hero-dominant atmosphere
 * - Key Moments: cinematic triptych/montage
 * - Characters: left-portrait hero + right text per character
 * - Visual Language: editorial image grid with compact bullets
 * - Themes: text-led with subtle atmospheric support
 * - Closing: atmospheric bookend
 */}
import type { SlideContent, LookBookVisualIdentity, DeckFormat, LayoutHint } from '@/lib/lookbook/types';
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

function SlideNumber({ index, total, color }: { index: number; total: number; color: string }) {
  return (
    <div
      className="absolute bottom-6 right-12"
      style={{ color, opacity: 0.3, fontVariantNumeric: 'tabular-nums', fontSize: 12, letterSpacing: '0.15em' }}
    >
      {String(index + 1).padStart(2, '0')} — {String(total).padStart(2, '0')}
    </div>
  );
}

function AccentRule({ color, width = 48, centered = false }: { color: string; width?: number; centered?: boolean }) {
  return <div style={{ width, height: 2, background: color, opacity: 0.5, marginBottom: 16, ...(centered ? { margin: '0 auto 16px' } : {}) }} />;
}

function SectionTag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      color, opacity: 0.6, fontSize: 10, letterSpacing: '0.35em',
      textTransform: 'uppercase', display: 'block', marginBottom: 8,
    }}>
      {label}
    </span>
  );
}

function EdgeAccent({ color }: { color: string }) {
  return (
    <div
      className="absolute left-0 top-0 bottom-0"
      style={{ width: 3, background: `linear-gradient(to bottom, transparent, ${color}, transparent)`, opacity: 0.25 }}
    />
  );
}

/**
 * Cinematic Credit Block — film poster-style credit lockup.
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
  const smallFontSize = 9 * scale;
  const titleFontSize = 11 * scale;

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
    maxWidth: 480 * scale,
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

  return (
    <div style={wrapperStyle}>
      <span style={lineStyle}>{company} presents</span>
      <span style={lineStyle}>A film by Sebastian Street</span>
      {title && <span style={titleLineStyle}>{title}</span>}
      <span style={lineStyle}>Written and Directed by Sebastian Street</span>
      <span style={lineStyle}>Produced by Merlin Merton, Alex Chang and Greer Ellison</span>
      {companyLogoUrl && (
        <img src={companyLogoUrl} alt="" style={{
          height: 16 * scale, objectFit: 'contain',
          opacity: 0.35, filter: 'brightness(2)',
          marginTop: 6 * scale,
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
 * Native-fit image renderer.
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

/**
 * Decorative gradient pattern for slides without background images.
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
      background: `linear-gradient(160deg, ${colors.bg} 0%, ${colors.gradientTo} 100%)`,
    },
  };
  return (
    <div className="absolute inset-0" style={patterns[variant] || patterns.diagonal}>
      <div className="absolute" style={{
        bottom: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(to right, transparent, ${colors.accent}18, transparent)`,
      }} />
    </div>
  );
}

/**
 * Glass text panel — frosted backdrop for text over imagery.
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
      borderRadius: 8,
      ...style,
    }}>
      {children}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   COVER — full-bleed poster hero with bottom title lockup + credits
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
        <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0 56px 80px' }}>
          <div style={{ maxWidth: 960 }}>
            <div style={{ width: 48, height: 2, background: colors.accent, opacity: 0.7, marginBottom: 20 }} />
            <h1 style={{ ...titleStyle, fontSize: 80, fontWeight: 700, lineHeight: 0.92, color: colors.text, marginBottom: 16 }}>
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p style={{ fontSize: 20, lineHeight: 1.45, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 600, marginBottom: 28 }}>
                {capText(slide.subtitle, 160, true)}
              </p>
            )}
            <CinematicCreditBlock title={slide.title} companyName={slide.companyName} credit={slide.credit} companyLogoUrl={slide.companyLogoUrl} colors={colors} variant="full" scale={0.85} />
          </div>
        </div>
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
                objectFit: 'cover', filter: 'saturate(0.3) blur(20px) contrast(1.1)',
                opacity: 0.12, transform: 'scale(1.1)',
              }} />
              <div style={{
                position: 'absolute', top: 32, bottom: 32, right: 64, width: 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6, overflow: 'hidden',
              }}>
                <img src={slide.imageUrl} alt="" style={{
                  width: '100%', height: '100%', objectFit: 'contain',
                  filter: 'saturate(0.75) contrast(1.15)',
                }} />
              </div>
              <div className="absolute inset-0" style={{
                background: `linear-gradient(to right, ${colors.bg} 0%, ${colors.bg}ee 42%, transparent 68%)`,
              }} />
            </>
          ) : (
            <>
              <img src={slide.imageUrl} alt="" className="w-full h-full object-cover object-top" style={{ filter: 'saturate(0.75) contrast(1.12)' }} />
              <div className="absolute inset-0" style={{
                background: `
                  linear-gradient(to right, ${colors.bg}f0 0%, ${colors.bg}bb 28%, ${colors.bg}55 50%, transparent 72%),
                  linear-gradient(to top, ${colors.bg}f5 0%, ${colors.bg}aa 18%, transparent 42%)
                `,
              }} />
            </>
          )}
        </div>
      )}
      {!hasHero && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0' }}>
        <div style={{ padding: '64px 80px 0', maxWidth: isPortraitHero ? 740 : hasHero ? 900 : 1100 }}>
          <div style={{ width: 44, height: 2, background: colors.accent, opacity: 0.6, marginBottom: 24 }} />
          <h1 style={{ ...titleStyle, fontSize: hasHero ? 88 : 104, fontWeight: 700, lineHeight: 0.93, color: colors.text, marginBottom: 12 }}>
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p style={{ fontSize: 22, lineHeight: 1.45, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 680 }}>
              {slide.subtitle}
            </p>
          )}
        </div>
        <div style={{
          marginTop: 'auto',
          padding: '20px 80px 16px',
          background: `linear-gradient(to top, ${colors.bg}f5 0%, ${colors.bg}cc 60%, transparent 100%)`,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          borderTop: `1px solid ${colors.accentMuted}`,
        }}>
          <CinematicCreditBlock title={slide.title} companyName={slide.companyName} credit={slide.credit} companyLogoUrl={slide.companyLogoUrl} colors={colors} variant="full" scale={0.8} />
        </div>
      </div>
      {slide.companyLogoUrl && (
        <div className="absolute top-12 right-12">
          <img src={slide.companyLogoUrl} alt="" className="h-7 object-contain" style={{ opacity: 0.35, filter: 'brightness(2)' }} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CREATIVE VISION — portrait hero left, concise vision text right
   ═══════════════════════════════════════════════════════════════════════ */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const heroImg = slide.backgroundImageUrl || slide.imageUrl;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {heroImg && <CinematicBackground src={heroImg} colors={colors} overlayStrength="heavy" overlayDirection="center-vignette" />}
        {!heroImg && <DecorativeGradientBg colors={colors} variant="radial" />}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, padding: '72px 56px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Creative Vision" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 24, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 900 }}>{capText(slide.body, 400, true)}</p>}
          {slide.credit && (
            <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}` }}>
              <CinematicCreditBlock companyName={slide.companyName} credit={slide.credit} colors={colors} variant="reduced" scale={0.85} />
            </div>
          )}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape: left portrait image + right text ──
  return (
    <div style={baseStyle} className="slide-content">
      {heroImg && (
        <div className="absolute inset-0">
          <img src={heroImg} alt="" className="w-full h-full" style={{
            objectFit: 'cover', filter: 'saturate(0.2) blur(24px) contrast(0.9)',
            opacity: 0.1, transform: 'scale(1.1)',
          }} />
        </div>
      )}
      {!heroImg && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        {/* Left: portrait image */}
        {heroImg && (
          <div style={{ width: '38%', height: '100%', padding: '32px 0 32px 48px', display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden',
              border: `1px solid ${colors.accentMuted}`,
            }}>
              <img src={heroImg} alt="" style={{
                width: '100%', height: '100%', objectFit: 'contain',
                filter: 'saturate(0.8) contrast(1.1)',
              }} />
            </div>
          </div>
        )}
        {/* Right: text */}
        <div style={{
          flex: 1, padding: heroImg ? '72px 80px 72px 48px' : '72px 120px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <SectionTag label="Creative Vision" color={colors.accent} />
          <AccentRule color={colors.accent} width={48} />
          <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{ fontSize: 18, lineHeight: 1.7, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 640 }}>
              {slide.body}
            </p>
          )}
          {slide.credit && (
            <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}` }}>
              <CinematicCreditBlock companyName={slide.companyName} credit={slide.credit} colors={colors} variant="reduced" />
            </div>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW — tight metadata + logline
   ═══════════════════════════════════════════════════════════════════════ */
function OverviewSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ padding: '64px 56px 56px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <SectionTag label="Project Overview" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 32, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{ fontSize: 26, lineHeight: 1.4, fontWeight: 500, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 28, maxWidth: 900 }}>
              {capText(slide.body, 280, true)}
            </p>
          )}
          {slide.bodySecondary && (
            <p style={{ fontSize: 17, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 40, maxWidth: 860 }}>
              {capText(slide.bodySecondary, 400, true)}
            </p>
          )}
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{
              marginTop: 'auto',
              background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8, padding: '28px 32px',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(slide.bullets.length, 3)}, 1fr)`,
              gap: 20,
            }}>
              {slide.bullets.map((b, i) => {
                const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
                return (
                  <div key={i}>
                    {label && <span style={{ fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: colors.accent, display: 'block', marginBottom: 6 }}>{label}</span>}
                    <span style={{ fontSize: 18, color: colors.text, fontWeight: 500 }}>{value}</span>
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

  // ── Landscape overview ──
  const hasBg = !!slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {hasBg && <CinematicBackground src={slide.backgroundImageUrl!} colors={colors} overlayStrength="heavy" overlayDirection="left-heavy" />}
      {!hasBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '64px 80px 52px 88px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Project Overview" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 40, flex: 1, alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: hasBg ? 640 : 760 }}>
            {slide.body && <p style={{ fontSize: 24, lineHeight: 1.45, fontWeight: 500, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {slide.bullets && slide.bullets.length > 0 && (
            <GlassPanel colors={colors} style={{ width: 340, flexShrink: 0, padding: '28px 28px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {slide.bullets.map((b, i) => {
                  const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
                  return (
                    <div key={i}>
                      {label && <span style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.accent, display: 'block', marginBottom: 4 }}>{label}</span>}
                      <span style={{ fontSize: 18, color: colors.text, fontWeight: 500 }}>{value}</span>
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
   WORLD — landscape-hero-dominant atmosphere
   ═══════════════════════════════════════════════════════════════════════ */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const worldBg = slide.backgroundImageUrl || slide.imageUrl || imgs[0];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {worldBg && (
          <div className="absolute inset-0">
            <img src={worldBg} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.08, filter: 'saturate(0.3) blur(6px)' }} />
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
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1' } : {}),
                }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.05)' }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '24px 56px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="The World" color={colors.accent} />
            <AccentRule color={colors.accent} width={40} />
            <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 16, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 17, lineHeight: 1.55, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12, maxWidth: 900 }}>{capText(slide.body, 300, true)}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>{capText(slide.bodySecondary, 240, true)}</p>}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape world — full-bleed hero background with glass text panel ──
  return (
    <div style={baseStyle} className="slide-content">
      {worldBg && <CinematicBackground src={worldBg} colors={colors} overlayStrength="medium" overlayDirection="bottom-heavy" />}
      {!worldBg && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {/* Supporting images strip at top-right if more than 1 image */}
        {imgs.length > 1 && (
          <div style={{
            position: 'absolute', top: 32, right: 48,
            display: 'flex', gap: 8, height: 180,
          }}>
            {imgs.slice(1, 4).map((url, i) => (
              <div key={i} style={{
                width: 240, borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${colors.accentMuted}`,
              }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.8) contrast(1.05)' }} />
              </div>
            ))}
          </div>
        )}
        {/* Bottom text panel */}
        <GlassPanel colors={colors} style={{
          margin: '0 64px 48px 64px', padding: '32px 40px',
          maxWidth: 720,
        }}>
          <SectionTag label="The World" color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 16, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 8 }}>{slide.body}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
        </GlassPanel>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CHARACTERS — left portrait hero + right text (premium character feature)
   ═══════════════════════════════════════════════════════════════════════ */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const chars = slide.characters || [];
  if (chars.length === 0) return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} isPortrait={isPortrait} />;

  const lead = chars[0];
  const supporting = chars.slice(1);

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '40px 48px 8px', flexShrink: 0 }}>
            <SectionTag label="Characters" color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 40, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>
          {lead && (
            <div style={{
              margin: '8px 20px', flexShrink: 0,
              height: supporting.length > 0 ? '38%' : '52%',
              background: colors.bgSecondary, border: `1px solid ${colors.accent}44`,
              borderRadius: 8, overflow: 'hidden', position: 'relative',
            }}>
              {lead.imageUrl ? (
                <>
                  <PortraitImage src={lead.imageUrl} style={{ filter: 'saturate(0.8) contrast(1.1)' }} />
                  <div className="absolute inset-x-0 bottom-0" style={{
                    background: `linear-gradient(to top, ${colors.bg}ee 0%, ${colors.bg}cc 50%, transparent 100%)`,
                    padding: '40px 28px 20px',
                  }}>
                    <h3 style={{ fontSize: 24, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 3, lineHeight: 1.15 }}>{lead.name}</h3>
                    {lead.role && <span style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 6 }}>{lead.role}</span>}
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: colors.text, opacity: 0.85, fontFamily: `"${fontBody}", sans-serif` }}>{capText(lead.description, 140, true)}</p>
                  </div>
                </>
              ) : (
                <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <span style={{ fontSize: 72, fontWeight: 700, color: colors.accent, opacity: 0.1, fontFamily: '"Fraunces", serif' }}>{lead.name.charAt(0)}</span>
                  <h3 style={{ fontSize: 24, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginTop: 8, marginBottom: 3 }}>{lead.name}</h3>
                  {lead.role && <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 10 }}>{lead.role}</span>}
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.text, opacity: 0.85, textAlign: 'center', maxWidth: 560 }}>{capText(lead.description, 180, true)}</p>
                </div>
              )}
            </div>
          )}
          {supporting.length > 0 && (
            <div style={{
              flex: 1, margin: '6px 20px 16px',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(supporting.length, 2)}, 1fr)`,
              gap: 8, alignContent: 'stretch', minHeight: 0,
            }}>
              {supporting.slice(0, 4).map((c, i) => (
                <div key={i} style={{
                  background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                  borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}>
                  {c.imageUrl ? (
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: colors.bg }}>
                      <PortraitImage src={c.imageUrl} style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
                    </div>
                  ) : (
                    <div style={{ height: 48, flexShrink: 0, background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: colors.accent, opacity: 0.15 }}>{c.name.charAt(0)}</span>
                    </div>
                  )}
                  <div style={{ padding: '10px 12px', flexShrink: 0 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 2, lineHeight: 1.2 }}>{c.name}</h3>
                    {c.role && <span style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 3 }}>{c.role}</span>}
                    <p style={{ fontSize: 11, lineHeight: 1.4, color: colors.text, opacity: 0.8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{c.description}</p>
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

  // ── Landscape characters — left portrait hero + right character list ──
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ height: '100%', display: 'flex' }}>
        {/* Left: lead character portrait hero */}
        <div style={{ width: '42%', height: '100%', padding: '24px 0 24px 24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            flex: 1, borderRadius: 6, overflow: 'hidden', position: 'relative',
            background: colors.bgSecondary, border: `1px solid ${colors.accent}55`,
          }}>
            {lead.imageUrl ? (
              <>
                <img src={lead.imageUrl} alt={lead.name} style={{
                  width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%',
                  filter: 'saturate(0.8) contrast(1.1)',
                }} />
                <div className="absolute inset-x-0 bottom-0" style={{
                  background: `linear-gradient(to top, ${colors.bg}f0 0%, ${colors.bg}cc 40%, transparent 80%)`,
                  padding: '48px 28px 24px',
                }}>
                  <h3 style={{ fontSize: 28, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4, lineHeight: 1.1 }}>{lead.name}</h3>
                  {lead.role && <span style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted }}>{lead.role}</span>}
                </div>
              </>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 96, fontWeight: 700, color: colors.accent, opacity: 0.08, fontFamily: '"Fraunces", serif' }}>{lead.name.charAt(0)}</span>
                <h3 style={{ fontSize: 28, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginTop: 8 }}>{lead.name}</h3>
                {lead.role && <span style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, marginTop: 4 }}>{lead.role}</span>}
              </div>
            )}
          </div>
        </div>
        {/* Right: character details */}
        <div style={{ flex: 1, padding: '48px 64px 48px 36px', display: 'flex', flexDirection: 'column' }}>
          <SectionTag label="Characters" color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 40, fontWeight: 600, color: colors.text, marginBottom: 20 }}>{slide.title}</h2>
          {/* Lead description */}
          <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${colors.accentMuted}` }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4 }}>{lead.name}</h3>
            {lead.role && <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 8 }}>{lead.role}</span>}
            <p style={{ fontSize: 14, lineHeight: 1.6, color: colors.text, opacity: 0.88, fontFamily: `"${fontBody}", sans-serif` }}>{lead.description}</p>
          </div>
          {/* Supporting cast */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'flex-start', overflow: 'hidden' }}>
            {supporting.slice(0, 4).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {c.imageUrl ? (
                  <div style={{
                    width: 56, height: 56, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                    border: `1px solid ${colors.accentMuted}`, background: colors.bg,
                  }}>
                    <img src={c.imageUrl} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.8)' }} />
                  </div>
                ) : (
                  <div style={{
                    width: 56, height: 56, borderRadius: 6, flexShrink: 0,
                    background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: colors.accent, opacity: 0.15 }}>{c.name.charAt(0)}</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 2, lineHeight: 1.2 }}>{c.name}</h4>
                  {c.role && <span style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, display: 'block', marginBottom: 4 }}>{c.role}</span>}
                  <p style={{ fontSize: 12, lineHeight: 1.5, color: colors.text, opacity: 0.8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   THEMES — text-led with subtle atmospheric support
   ═══════════════════════════════════════════════════════════════════════ */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const heroImg = slide.backgroundImageUrl || slide.imageUrl;
  const hasStrongImage = !!heroImg;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {hasStrongImage && <CinematicBackground src={heroImg!} colors={colors} overlayStrength="medium" overlayDirection="center-vignette" />}
        {!hasStrongImage && <DecorativeGradientBg colors={colors} variant="radial" />}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, padding: '64px 56px 56px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Themes & Tone" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 18, lineHeight: 1.6, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>{capText(slide.body, 320, true)}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>{capText(slide.bodySecondary, 250, true)}</p>}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape themes — full-bleed atmospheric background, centered text ──
  return (
    <div style={baseStyle} className="slide-content">
      {heroImg && <CinematicBackground src={heroImg} colors={colors} overlayStrength="heavy" overlayDirection="center-vignette" />}
      {!heroImg && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '72px 120px' }}>
        <SectionTag label="Themes & Tone" color={colors.accent} />
        <AccentRule color={colors.accent} width={44} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
        <GlassPanel colors={colors} style={{ padding: '32px 40px', maxWidth: 720 }}>
          {slide.body && <p style={{ fontSize: 18, lineHeight: 1.65, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: slide.bodySecondary ? 16 : 0 }}>{slide.body}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
        </GlassPanel>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VISUAL LANGUAGE — editorial image grid with compact bullets
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
              gridTemplateColumns: imgs.length === 1 ? '1fr' : '1fr 1fr',
              gap: 6,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{ overflow: 'hidden', borderRadius: 6, background: colors.bgSecondary }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.05)' }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, padding: '24px 56px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Visual Language" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 40, fontWeight: 600, marginBottom: 14, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 14 }}>{capText(slide.body, 280, true)}</p>}
            {(slide.bullets || []).length > 0 && (
              <div style={{ marginTop: 4 }}>
                {slide.bullets!.slice(0, 4).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 5, opacity: 0.7 }} />
                    <span style={{ fontSize: 13, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{capText(b, 100, true)}</span>
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

  // ── Landscape visual language — dominant image grid right, compact text left ──
  const vlBg = slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {vlBg && !hasImages && <CinematicBackground src={vlBg} colors={colors} overlayStrength="heavy" overlayDirection="left-heavy" />}
      {!vlBg && !hasImages && <DecorativeGradientBg colors={colors} variant="geometric" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        {/* Left text — compact */}
        <div style={{ width: hasImages ? '36%' : '50%', padding: '64px 32px 64px 80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Visual Language" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 15, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 14 }}>{slide.body}</p>}
          {(slide.bullets || []).length > 0 && (
            <div style={{ marginTop: 4 }}>
              {slide.bullets!.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Right: image grid — fills aggressively */}
        {hasImages && (
          <div style={{
            flex: 1, padding: '24px 32px 24px 0',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : '1fr 1fr',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
            gap: 8,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${colors.accentMuted}`,
                ...(imgs.length === 1 ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}),
                ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
              }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.05)' }} />
              </div>
            ))}
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
  const bullets = slide.bullets || [];
  const seBg = slide.backgroundImageUrl || slide.imageUrl;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {seBg && (
          <div className="absolute inset-0">
            <img src={seBg} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.05, filter: 'saturate(0.3) blur(8px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f5 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
          </div>
        )}
        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, padding: '56px 56px 48px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Story Engine" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 40, fontWeight: 600, marginBottom: 16, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12, maxWidth: 900 }}>{capText(slide.body, 260, true)}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 13, lineHeight: 1.55, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 12, maxWidth: 860 }}>{capText(slide.bodySecondary, 180, true)}</p>}
          {bullets.length > 0 && (
            <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: '16px 20px', marginTop: 4 }}>
              {bullets.slice(0, 4).map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: i < bullets.length - 1 ? 8 : 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent, opacity: 0.5, minWidth: 20, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{capText(b, 100, true)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape story engine — atmospheric background, centered content ──
  return (
    <div style={baseStyle} className="slide-content">
      {seBg && <CinematicBackground src={seBg} colors={colors} overlayStrength="heavy" overlayDirection="center-vignette" />}
      {!seBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '64px 80px 56px 88px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Story Engine" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 46, fontWeight: 600, marginBottom: 24, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 40, flex: 1, minHeight: 0, alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: 600 }}>
            {slide.body && <p style={{ fontSize: 17, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 14 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 14, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {bullets.length > 0 && (
            <GlassPanel colors={colors} style={{ width: 380, flexShrink: 0, padding: '24px 28px' }}>
              {bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: i < bullets.length - 1 ? 10 : 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.accent, opacity: 0.5, minWidth: 22, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{b}</span>
                </div>
              ))}
            </GlassPanel>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   KEY MOMENTS — cinematic image triptych/montage
   ═══════════════════════════════════════════════════════════════════════ */
function KeyMomentsSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const imgCount = imgs.length;
  const sectionLabel = slide.title?.toLowerCase().includes('poster') ? 'Poster Directions' : 'Key Moments';

  const getGridStyle = (): React.CSSProperties => {
    if (isPortrait) {
      if (imgCount === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
      if (imgCount === 2) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
      if (imgCount === 3) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '2fr 1fr' };
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    }
    if (imgCount === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    if (imgCount === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    if (imgCount === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
    if (imgCount === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
  };

  const getSpanStyle = (i: number): React.CSSProperties => {
    if (isPortrait) {
      if (imgCount === 3 && i === 0) return { gridColumn: '1 / -1' };
      if (imgCount >= 5 && i === 0) return { gridColumn: '1 / -1' };
      return {};
    }
    if (imgCount >= 5 && i === 0) return { gridRow: '1 / 3' };
    return {};
  };

  // ── Empty state ──
  if (imgCount === 0) {
    return (
      <div style={baseStyle} className="slide-content">
        <DecorativeGradientBg colors={colors} variant="geometric" />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: isPortrait ? '56px 56px' : '72px 88px' }}>
          <SectionTag label={sectionLabel} color={colors.accent} />
          <AccentRule color={colors.accent} centered />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 44 : 52, fontWeight: 600, marginBottom: 20, color: colors.text, textAlign: 'center' }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: isPortrait ? 16 : 17, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 560, textAlign: 'center' }}>{slide.body}</p>}
          <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%', maxWidth: 580 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                aspectRatio: '16/9', borderRadius: 6,
                border: `1px dashed ${colors.accent}28`,
                background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 18, color: colors.accent, opacity: 0.1 }}>●</span>
              </div>
            ))}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  const hint = slide.layoutHint || 'default';

  // ── Asymmetric split: hero left 60%, supports stacked right ──
  if (!isPortrait && hint === 'asymmetric_split' && imgCount >= 2) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '32px 72px 8px', flexShrink: 0 }}>
            <SectionTag label={sectionLabel} color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 38, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>
          <div style={{ flex: 1, display: 'flex', padding: '0 32px 32px', gap: 8, minHeight: 0 }}>
            {/* Hero — 60% width */}
            <div style={{ flex: 3, borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}` }}>
              <img src={imgs[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
            </div>
            {/* Supports stacked — 40% */}
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {imgs.slice(1, 4).map((url, i) => (
                <div key={i} style={{ flex: 1, borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}` }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Hero top grid: full-width hero top, support grid below ──
  if (!isPortrait && hint === 'hero_top_grid' && imgCount >= 3) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 72px 8px', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 20 }}>
            <SectionTag label={sectionLabel} color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 36, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>
          {/* Hero — full width, 55% height */}
          <div style={{ height: '55%', flexShrink: 0, padding: '0 32px 4px', overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}` }}>
              <img src={imgs[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
            </div>
          </div>
          {/* Support grid below */}
          <div style={{
            flex: 1, padding: '4px 32px 24px',
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(imgs.length - 1, 4)}, 1fr)`,
            gap: 8, minHeight: 0,
          }}>
            {imgs.slice(1, 5).map((url, i) => (
              <div key={i} style={{ borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}` }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
              </div>
            ))}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Default grid layout (existing) ──
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: isPortrait ? '28px 48px 8px' : '32px 72px 12px', flexShrink: 0 }}>
          <SectionTag label={sectionLabel} color={colors.accent} />
          <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', alignItems: isPortrait ? 'flex-start' : 'baseline', gap: isPortrait ? 4 : 20 }}>
            <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 38, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
            {slide.body && <p style={{ fontSize: isPortrait ? 12 : 13, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 480 }}>{slide.body}</p>}
          </div>
        </div>
        <div style={{
          flex: 1, padding: isPortrait ? '0 12px 20px' : '0 32px 32px',
          display: 'grid', ...getGridStyle(), gap: isPortrait ? 6 : 8, minHeight: 0,
        }}>
          {imgs.slice(0, 6).map((url, i) => (
            <div key={i} style={{
              borderRadius: 6, overflow: 'hidden',
              border: `1px solid ${colors.accentMuted}`,
              ...getSpanStyle(i),
            }}>
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
            </div>
          ))}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPARABLES — market positioning
   ═══════════════════════════════════════════════════════════════════════ */
function ComparablesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const comps = slide.comparables || [];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ padding: '52px 56px 48px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <SectionTag label="Market Positioning" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 40, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' }}>
            {comps.slice(0, 4).map((c, i) => (
              <div key={i} style={{
                background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                borderRadius: 8, padding: '20px 24px', display: 'flex', alignItems: 'flex-start', gap: 16,
              }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: colors.accent, opacity: 0.2, lineHeight: 1, minWidth: 36 }}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 4, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                  {c.reason && <p style={{ fontSize: 13, lineHeight: 1.5, color: colors.textMuted }}>{capText(c.reason, 160, true)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  const compBg = slide.backgroundImageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {compBg && <CinematicBackground src={compBg} colors={colors} overlayStrength="heavy" overlayDirection="even" />}
      {!compBg && <DecorativeGradientBg colors={colors} variant="diagonal" />}
      <div style={{ position: 'relative', zIndex: 1, padding: '56px 72px 56px 88px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Market Positioning" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 28, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, flex: 1, alignContent: 'center' }}>
          {comps.map((c, i) => (
            <GlassPanel key={i} colors={colors} style={{ padding: '22px 24px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: colors.accent, opacity: 0.2, lineHeight: 1, minWidth: 40 }}>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 4, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                {c.reason && <p style={{ fontSize: 13, lineHeight: 1.55, color: colors.textMuted }}>{c.reason}</p>}
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
   CLOSING — atmospheric bookend
   ═══════════════════════════════════════════════════════════════════════ */
function ClosingSlide({ slide, colors, titleStyle, baseStyle, fontBody, isPortrait }: SlideProps) {
  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {slide.backgroundImageUrl && (
          <div className="absolute inset-0">
            <img src={slide.backgroundImageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', filter: 'saturate(0.2) blur(20px) contrast(0.8)', opacity: 0.25, transform: 'scale(1.1)' }} />
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${colors.bg}cc 0%, ${colors.bg}ee 60%, ${colors.bg} 100%)` }} />
          </div>
        )}
        {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 56px' }}>
          <AccentRule color={colors.accent} width={56} centered />
          <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 700, color: colors.text, textAlign: 'center', marginBottom: 20, lineHeight: 0.95 }}>{slide.title}</h2>
          {slide.subtitle && <p style={{ fontSize: 18, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, textAlign: 'center', maxWidth: 580, marginBottom: 40 }}>{capText(slide.subtitle, 140, true)}</p>}
          <CinematicCreditBlock title={slide.title} companyName={slide.companyName} credit={slide.credit} companyLogoUrl={slide.companyLogoUrl} colors={colors} variant="full" centered scale={0.9} />
        </div>
      </div>
    );
  }

  return (
    <div style={baseStyle} className="slide-content">
      {slide.backgroundImageUrl && (
        <div className="absolute inset-0">
          <img src={slide.backgroundImageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', filter: 'saturate(0.2) blur(20px) contrast(0.8)', opacity: 0.25, transform: 'scale(1.1)' }} />
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${colors.bg}cc 0%, ${colors.bg}ee 60%, ${colors.bg} 100%)` }} />
        </div>
      )}
      {!slide.backgroundImageUrl && <DecorativeGradientBg colors={colors} variant="radial" />}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 100px' }}>
        <AccentRule color={colors.accent} width={56} centered />
        <h2 style={{ ...titleStyle, fontSize: 64, fontWeight: 700, color: colors.text, textAlign: 'center', marginBottom: 16, lineHeight: 0.95 }}>{slide.title}</h2>
        {slide.subtitle && <p style={{ fontSize: 20, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, textAlign: 'center', maxWidth: 640, marginBottom: 40 }}>{slide.subtitle}</p>}
        <CinematicCreditBlock title={slide.title} companyName={slide.companyName} credit={slide.credit} companyLogoUrl={slide.companyLogoUrl} colors={colors} variant="full" centered />
      </div>
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
      <div style={{ position: 'relative', zIndex: 1, padding: isPortrait ? '56px 48px' : '64px 80px 64px 88px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <SectionTag label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 42 : 48, fontWeight: 600, marginBottom: 24, color: colors.text }}>{slide.title}</h2>
        {slide.body && <p style={{ fontSize: isPortrait ? 16 : 18, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 760 }}>{isPortrait ? capText(slide.body, 350, true) : slide.body}</p>}
        {slide.bodySecondary && <p style={{ fontSize: isPortrait ? 13 : 15, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginTop: 16, maxWidth: 680 }}>{isPortrait ? capText(slide.bodySecondary, 250, true) : slide.bodySecondary}</p>}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

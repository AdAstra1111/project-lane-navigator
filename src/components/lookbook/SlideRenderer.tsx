{/**
 * SlideRenderer — Premium cinematic slide compositions.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 * Portrait mode is editorially recomposed for vertical drama —
 * not just stacked landscape layouts.
 *
 * VERTICAL DRAMA CONTRACT:
 * - Portrait images use object-contain (native-fit), NOT object-cover (crop-rescue)
 * - Image zones are sized to match 9:16 source aspect ratios
 * - Layouts are authored for vertical presentation, not squeezed landscape logic
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
    console.info('[LookBook] Rendering slide with normalized data', {
      slideIndex, slideType: slide.type, title: normalizedSlide.title || null,
      debugImageIds: normalizedSlide._debug_image_ids || [],
    });
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

/* ─── Layout-family-aware image zone for landscape slides ─── */

/**
 * Renders the image zone of a landscape slide using layout family metadata.
 * Supports portrait-hero, two-up-portrait, mixed-editorial, and standard.
 * Falls back to standard grid when no layoutFamily is set.
 */
function LayoutAwareImageZone({ slide, colors, maxImages = 4 }: {
  slide: SlideContent;
  colors: LookBookVisualIdentity['colors'];
  maxImages?: number;
}) {
  // Prefer slot-driven image order when slotAssignments exist
  const slotUrls = slide.slotAssignments
    ?.filter(s => s.assignedUrl)
    .map(s => s.assignedUrl!) || [];
  const rawImgs = (slide.imageUrls?.length ? slide.imageUrls : slide.imageUrl ? [slide.imageUrl] : []);
  const imgs = (slotUrls.length > 0 ? slotUrls : rawImgs).slice(0, maxImages);
  if (imgs.length === 0) return null;

  const family = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const border = `1px solid ${colors.accentMuted}`;

  // ── Portrait Hero: single portrait image centered in landscape frame ──
  if (family === 'landscape_portrait_hero') {
    return (
      <div style={{
        width: 420, flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: '100%', height: '100%', maxWidth: 380,
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

  // ── Two-Up Portrait: two portrait images side by side ──
  if (family === 'landscape_two_up_portrait') {
    return (
      <div style={{
        width: 640, flexShrink: 0,
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

  // ── Mixed Editorial: primary large + secondary smaller ──
  if (family === 'landscape_mixed_editorial' && imgs.length >= 2) {
    return (
      <div style={{
        width: 680, flexShrink: 0,
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

  // ── Character Portraits: portrait-led cards inside landscape slide ──
  if (family === 'landscape_character_portraits') {
    return (
      <div style={{
        width: imgs.length === 1 ? 360 : 640, flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : 'repeat(3, 1fr)',
        gap: 12, alignItems: 'stretch',
      }}>
        {imgs.slice(0, 3).map((url, i) => (
          <div key={i} style={{
            borderRadius: 8, overflow: 'hidden', border,
            background: colors.bgSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            aspectRatio: '9 / 16',
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

  // ── Landscape Standard (default grid) ──
  return (
    <div style={{
      width: imgs.length === 1 ? 680 : 640, flexShrink: 0,
      display: 'grid',
      gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
      gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
      gap: 8,
    }}>
      {imgs.slice(0, 4).map((url, i) => (
        <div key={i} style={{
          borderRadius: 6, overflow: 'hidden', border,
          ...(imgs.length === 1 ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}),
          ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
        }}>
          <img src={url} alt="" style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            filter: 'saturate(0.85) contrast(1.05)',
          }} />
        </div>
      ))}
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

function AccentRule({ color, width = 48 }: { color: string; width?: number }) {
  return <div style={{ width, height: 2, background: color, opacity: 0.5, marginBottom: 24 }} />;
}

function SectionTag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      color, opacity: 0.6, fontSize: 11, letterSpacing: '0.35em',
      textTransform: 'uppercase', display: 'block', marginBottom: 12,
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

/** Portrait text density cap — truncates body text for vertical slides */
function capText(text: string | undefined, maxChars: number, isPortrait: boolean): string | undefined {
  if (!text || !isPortrait) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

/**
 * Native-fit image renderer for portrait slides.
 * Uses object-contain for primary images (no cropping), object-cover only for
 * background washes at very low opacity where cropping is invisible.
 */
function PortraitImage({ src, alt = '', style, isBackground = false }: {
  src: string; alt?: string; style?: React.CSSProperties; isBackground?: boolean;
}) {
  // Background washes (opacity < 0.2, blurred) can use cover — invisible crop
  // Primary visible images MUST use contain — no crop rescue
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
 * Unresolved placeholder — elegant visual indicator that a strict VD slot
 * has no compliant winner image. Used instead of silently omitting or
 * showing a broken gap.
 */
function UnresolvedPlaceholder({ label = 'Awaiting compliant vertical image', colors }: {
  label?: string; colors: { bg: string; textMuted: string; accent: string; accentMuted: string };
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
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

/**
 * Renders either the image or an unresolved placeholder based on slide state.
 * For portrait strict VD slides, when _has_unresolved=true and no image URL exists.
 */
function PortraitImageOrPlaceholder({ src, colors, alt = '', style, isBackground = false, hasUnresolved = false }: {
  src?: string; colors: { bg: string; textMuted: string; accent: string; accentMuted: string };
  alt?: string; style?: React.CSSProperties; isBackground?: boolean; hasUnresolved?: boolean;
}) {
  if (src) {
    return <PortraitImage src={src} alt={alt} style={style} isBackground={isBackground} />;
  }
  if (hasUnresolved) {
    return <UnresolvedPlaceholder colors={colors} />;
  }
  return null;
}


/* ═══════════════════════════════════════════════════════════════════════
   COVER — full-bleed poster with bottom title lockup
   Portrait: 9:16 hero fills frame via contain, title lockup at bottom
   ═══════════════════════════════════════════════════════════════════════ */
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody, isPortrait }: SlideProps) {
  const hasHero = !!slide.imageUrl;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {/* Cover hero — strict VD: native-fit contain with atmospheric bg wash */}
        {hasHero && (
          <div className="absolute inset-0" style={{ background: colors.bg }}>
            {/* Decorative blurred background wash — object-cover allowed (invisible crop) */}
            <img
              src={slide.imageUrl!}
              alt=""
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center top',
                filter: 'saturate(0.3) blur(16px) contrast(1.1)',
                opacity: 0.18, transform: 'scale(1.08)',
              }}
            />
            {/* Primary truth surface — object-contain, no crop rescue */}
            <img
              src={slide.imageUrl!}
              alt=""
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'contain', objectPosition: 'center 15%',
                filter: 'saturate(0.75) contrast(1.15)',
              }}
            />
            {/* Bottom-heavy scrim for title readability */}
            <div className="absolute inset-0" style={{
              background: `linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}f0 18%, ${colors.bg}99 40%, transparent 65%)`,
            }} />
          </div>
        )}

        {/* Title lockup — anchored to bottom third */}
        <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0 64px 96px' }}>
          <div style={{ maxWidth: 960 }}>
            <div style={{ width: 56, height: 3, background: colors.accent, opacity: 0.7, marginBottom: 24 }} />
            <h1 style={{
              ...titleStyle, fontSize: 88, fontWeight: 700,
              lineHeight: 0.92, color: colors.text, marginBottom: 20,
            }}>
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p style={{
                fontSize: 22, lineHeight: 1.45, color: colors.textMuted,
                fontFamily: `"${fontBody}", sans-serif`, maxWidth: 640, marginBottom: 32,
              }}>
                {capText(slide.subtitle, 160, true)}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              {slide.credit && (
                <span style={{ fontSize: 13, letterSpacing: '0.12em', color: colors.accent, opacity: 0.85 }}>
                  {slide.credit}
                </span>
              )}
              {slide.companyName && (
                <span style={{ fontSize: 12, letterSpacing: '0.2em', color: colors.textMuted, opacity: 0.45, textTransform: 'uppercase' }}>
                  {slide.companyName}
                </span>
              )}
            </div>
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
              {/* Blurred background wash */}
              <img src={slide.imageUrl} alt="" className="w-full h-full" style={{
                objectFit: 'cover', filter: 'saturate(0.3) blur(16px) contrast(1.1)',
                opacity: 0.15, transform: 'scale(1.08)',
              }} />
              {/* Portrait hero — contain, right-of-center */}
              <div style={{
                position: 'absolute', top: 40, bottom: 40, right: 80, width: 440,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, overflow: 'hidden',
              }}>
                <img src={slide.imageUrl} alt="" style={{
                  width: '100%', height: '100%',
                  objectFit: 'contain',
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
      <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '80px 96px 88px' }}>
        <div style={{ maxWidth: isPortraitHero ? 780 : hasHero ? 960 : 1200 }}>
          <div style={{ width: 48, height: 2, background: colors.accent, opacity: 0.6, marginBottom: 28 }} />
          <h1 style={{ ...titleStyle, fontSize: hasHero ? 96 : 112, fontWeight: 700, lineHeight: 0.95, color: colors.text, marginBottom: 16 }}>
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p style={{ fontSize: 24, lineHeight: 1.5, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 720, marginBottom: 40 }}>
              {slide.subtitle}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            {slide.credit && <span style={{ fontSize: 14, letterSpacing: '0.12em', color: colors.accent, opacity: 0.85 }}>{slide.credit}</span>}
            {slide.companyName && <span style={{ fontSize: 13, letterSpacing: '0.15em', color: colors.textMuted, opacity: 0.45, textTransform: 'uppercase' }}>{slide.companyName}</span>}
          </div>
        </div>
      </div>
      {slide.companyLogoUrl && (
        <div className="absolute top-12 right-14">
          <img src={slide.companyLogoUrl} alt="" className="h-7 object-contain" style={{ opacity: 0.4, filter: 'brightness(2)' }} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW — project metadata
   Portrait: full-width logline block + metadata grid below
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

          {/* Logline — large, commanding */}
          {slide.body && (
            <p style={{
              fontSize: 28, lineHeight: 1.4, fontWeight: 500,
              color: colors.text, fontFamily: `"${fontBody}", sans-serif`,
              marginBottom: 32, maxWidth: 900,
            }}>
              {capText(slide.body, 280, true)}
            </p>
          )}

          {/* Synopsis — secondary */}
          {slide.bodySecondary && (
            <p style={{
              fontSize: 18, lineHeight: 1.65, color: colors.textMuted,
              fontFamily: `"${fontBody}", sans-serif`, marginBottom: 48, maxWidth: 860,
            }}>
              {capText(slide.bodySecondary, 400, true)}
            </p>
          )}

          {/* Metadata — spread as a horizontal grid near bottom */}
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

  // ── Landscape overview ──
  const pad = '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Project Overview" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 600, marginBottom: 48, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 64, flex: 1 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {slide.body && <p style={{ fontSize: 28, lineHeight: 1.45, fontWeight: 500, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 28 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 17, lineHeight: 1.7, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{
              width: 360, flexShrink: 0, background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`, borderRadius: 8,
              padding: '40px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28,
            }}>
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
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   WORLD — immersive atmosphere
   Portrait: single 9:16 image displayed natively (contain) in top 50%,
   text flows below. No crop rescue.
   ═══════════════════════════════════════════════════════════════════════ */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {/* Subtle background wash — low-opacity blurred, crop is invisible here */}
        {(slide.imageUrl || imgs[0]) && (
          <div className="absolute inset-0">
            <img src={slide.imageUrl || imgs[0]} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.08, filter: 'saturate(0.3) blur(6px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f0 0%, ${colors.bg}cc 40%, ${colors.bg}e0 100%)` }} />
          </div>
        )}

        <EdgeAccent color={colors.accent} />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Image zone — native-fit for 9:16 images, 50% height */}
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
                  ...(imgs.length === 1 ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}),
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                }}>
                  <PortraitImage src={url} style={{ filter: 'saturate(0.85) contrast(1.08)', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          )}

          {/* Text zone */}
          <div style={{ flex: 1, padding: '32px 64px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="The World" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
            {slide.body && (
              <p style={{ fontSize: 18, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 14, maxWidth: 900 }}>
                {capText(slide.body, 320, true)}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>
                {capText(slide.bodySecondary, 220, true)}
              </p>
            )}
            {slide.quote && (
              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}` }}>
                <p style={{ fontSize: 17, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6, fontFamily: `"${fontBody}", sans-serif` }}>"{capText(slide.quote, 160, true)}"</p>
              </div>
            )}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape world ──
  const pad = '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      {(slide.imageUrl || imgs[0]) && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl || imgs[0]} alt="" className="w-full h-full object-cover" style={{ opacity: 0.15, filter: 'saturate(0.4) contrast(1.1) blur(2px)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f0 0%, ${colors.bg}cc 40%, ${colors.bg}e0 100%)` }} />
        </div>
      )}
      <EdgeAccent color={colors.accent} />
      <div style={{ position: 'relative', zIndex: 1, padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="The World" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 48, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
            {slide.body && <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
            {slide.quote && (
              <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
                <p style={{ fontSize: 20, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.65, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
              </div>
            )}
          </div>
          {hasImages && <LayoutAwareImageZone slide={slide} colors={colors} />}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CHARACTERS — premium cast page
   Portrait: EDITORIAL DOSSIER layout — lead character gets full-width
   9:16 image with overlaid name plate; supporting cast in 2-col cards.
   No object-cover cropping on character portraits.
   ═══════════════════════════════════════════════════════════════════════ */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const chars = slide.characters || [];
  const lead = chars[0];
  const supporting = chars.slice(1);
  const isSmallCast = chars.length <= 3;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Compact header */}
          <div style={{ padding: '48px 56px 20px', flexShrink: 0 }}>
            <SectionTag label="Characters" color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
          </div>

          {/* Lead character — full-width editorial card */}
          {lead && (
            <div style={{
              flexShrink: 0, margin: '0 24px',
              height: supporting.length > 0 ? 520 : 820,
              borderRadius: 10, overflow: 'hidden',
              position: 'relative',
              background: colors.bgSecondary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {lead.imageUrl ? (
                <>
                  <PortraitImage
                    src={lead.imageUrl}
                    style={{ filter: 'saturate(0.8) contrast(1.05)' }}
                  />
                  {/* Name plate overlay at bottom */}
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
                <div style={{ padding: '32px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                  <span style={{ fontSize: 80, fontWeight: 700, color: colors.accent, opacity: 0.12, fontFamily: '"Fraunces", serif' }}>{lead.name.charAt(0)}</span>
                  <h3 style={{ fontSize: 28, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginTop: 12, marginBottom: 4 }}>{lead.name}</h3>
                  {lead.role && <span style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 12 }}>{lead.role}</span>}
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.text, opacity: 0.85, textAlign: 'center', maxWidth: 600 }}>{capText(lead.description, 200, true)}</p>
                </div>
              )}
            </div>
          )}

          {/* Supporting cast — compact cards, 2-column grid */}
          {supporting.length > 0 && (
            <div style={{
              flex: 1, margin: '16px 24px 20px',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(supporting.length, 2)}, 1fr)`,
              gap: 12, alignContent: 'start', minHeight: 0,
            }}>
              {supporting.slice(0, 4).map((c, i) => (
                <div key={i} style={{
                  background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                  borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}>
                  {c.imageUrl ? (
                    <div style={{ height: 220, overflow: 'hidden', flexShrink: 0, background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PortraitImage src={c.imageUrl} style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
                    </div>
                  ) : (
                    <div style={{ height: 60, flexShrink: 0, background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${colors.accentMuted}` }}>
                      <span style={{ fontSize: 24, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: '"Fraunces", serif' }}>{c.name.charAt(0)}</span>
                    </div>
                  )}
                  <div style={{ padding: '14px 16px', flex: 1 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 3, lineHeight: 1.2 }}>{c.name}</h3>
                    {c.role && <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 6, display: 'block' }}>{c.role}</span>}
                    <p style={{ fontSize: 12, lineHeight: 1.45, color: colors.text, opacity: 0.8, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
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

  // ── Landscape characters ──
  const pad = '72px 96px 72px 100px';
  const charEffective = slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard';
  const isPortraitFamily = charEffective === 'landscape_character_portraits'
    || charEffective === 'landscape_two_up_portrait'
    || charEffective === 'landscape_portrait_hero';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Characters" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>
        {isSmallCast ? (
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {chars.map((c, i) => (
              <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={i === 0} tall useContain={isPortraitFamily} isPortrait={false} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {lead && (
              <div style={{ width: 420, flexShrink: 0 }}>
                <CharCard char={lead} colors={colors} fontBody={fontBody} isLead tall useContain={isPortraitFamily} isPortrait={false} />
              </div>
            )}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignContent: 'start' }}>
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

/** Landscape-only character card — supports portrait-led contain mode */
function CharCard({ char, colors, fontBody, isLead, tall, isPortrait, useContain = false }: {
  char: { name: string; role: string; description: string; imageUrl?: string };
  colors: LookBookVisualIdentity['colors']; fontBody: string;
  isLead: boolean; tall: boolean; isPortrait: boolean; useContain?: boolean;
}) {
  const imgH = tall ? (useContain ? 340 : 280) : (useContain ? 220 : 180);
  const padText = tall ? '24px 28px' : '16px 20px';
  return (
    <div style={{
      flex: tall ? 1 : undefined, background: colors.bgSecondary,
      border: `1px solid ${colors.accentMuted}`, borderRadius: 8,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      ...(isLead ? { borderColor: colors.accent } : {}),
    }}>
      {char.imageUrl ? (
        <div style={{ height: imgH, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgSecondary }}>
          {(isPortrait || useContain) ? (
            <PortraitImage src={char.imageUrl} alt={char.name} style={{ objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
          ) : (
            <img src={char.imageUrl} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
          )}
        </div>
      ) : (
        <div style={{ height: tall ? 140 : 80, flexShrink: 0, background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${colors.accentMuted}` }}>
          <span style={{ fontSize: tall ? 36 : 24, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: '"Fraunces", serif' }}>{char.name.charAt(0)}</span>
        </div>
      )}
      <div style={{ padding: padText, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: isLead ? 24 : 19, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4, lineHeight: 1.2 }}>{char.name}</h3>
        {char.role && <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 8, display: 'block' }}>{char.role}</span>}
        <p style={{ fontSize: tall ? 15 : 13, lineHeight: 1.55, color: colors.text, opacity: 0.82, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: tall ? 6 : 4, WebkitBoxOrient: 'vertical' }}>{char.description}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   THEMES — atmosphere-led editorial
   Portrait: 9:16 hero image (native-fit) in top zone, text below
   ═══════════════════════════════════════════════════════════════════════ */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const heroImg = slide.imageUrl || imgs[0];

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        {/* Background wash — invisible crop at very low opacity */}
        {heroImg && (
          <div className="absolute inset-0">
            <img src={heroImg} alt="" className="w-full h-full" style={{ objectFit: 'cover', opacity: 0.1, filter: 'saturate(0.3) blur(6px)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${colors.bg}e8 0%, ${colors.bg}cc 35%, ${colors.bg}f5 100%)` }} />
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Image zone — 45% with native-fit rendering */}
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

          {/* Text — fills remaining vertical space */}
          <div style={{
            flex: 1, padding: '32px 64px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <SectionTag label="Themes & Tone" color={colors.accent} />
            <AccentRule color={colors.accent} width={40} />
            <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 24, color: colors.text }}>{slide.title}</h2>
            {slide.body && (
              <p style={{ fontSize: 19, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>
                {capText(slide.body, 320, true)}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 860 }}>
                {capText(slide.bodySecondary, 250, true)}
              </p>
            )}
          </div>
        </div>
        <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
      </div>
    );
  }

  // ── Landscape themes ──
  return (
    <div style={baseStyle} className="slide-content">
      {heroImg && (
        <div className="absolute inset-0">
          <img src={heroImg} alt="" className="w-full h-full object-cover" style={{ opacity: 0.12, filter: 'saturate(0.3) blur(4px)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f2 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex' }}>
        <div style={{ flex: 1, padding: '72px 48px 72px 100px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: !hasImages ? 'center' : 'flex-start', textAlign: !hasImages ? 'center' : 'left' }}>
          <SectionTag label="Themes & Tone" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>
          <div style={{ maxWidth: 720 }}>
            {slide.body && <p style={{ fontSize: 22, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 16, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
        </div>
        {hasImages && (
          <div style={{ width: '50%', padding: '48px 56px 48px 0', display: 'flex', alignItems: 'center' }}>
            <LayoutAwareImageZone slide={slide} colors={colors} />
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VISUAL LANGUAGE — aesthetic thesis with evidence
   Portrait: evidence strip (contain) across top 40%, thesis text below
   ═══════════════════════════════════════════════════════════════════════ */
function VisualLanguageSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

  if (isPortrait) {
    return (
      <div style={baseStyle} className="slide-content">
        <EdgeAccent color={colors.accent} />
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Evidence strip — 40% of portrait height, native-fit */}
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

          {/* Thesis text */}
          <div style={{ flex: 1, padding: '32px 64px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Visual Language" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
            {slide.body && (
              <p style={{ fontSize: 17, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20, maxWidth: 900 }}>
                {capText(slide.body, 300, true)}
              </p>
            )}
            {(slide.bullets || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {slide.bullets!.slice(0, 4).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 12 }}>
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
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ height: '100%', display: 'flex' }}>
        <div style={{ flex: 1, padding: '72px 56px 72px 100px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SectionTag label="Visual Language" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 32, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: 18, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20, maxWidth: 620 }}>{slide.body}</p>}
          {(slide.bullets || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {slide.bullets!.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 12 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: 16, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {hasImages && (
          <div style={{ width: '55%', padding: '40px 48px 40px 0', display: 'flex', alignItems: 'center' }}>
            <LayoutAwareImageZone slide={slide} colors={colors} />
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STORY ENGINE — narrative propulsion
   Portrait: top image strip (35% native-fit), text + numbered beats below
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
          {/* Image strip — 35% with native-fit */}
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

          {/* Text + beats */}
          <div style={{ flex: 1, padding: '28px 64px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SectionTag label="Story Engine" color={colors.accent} />
            <AccentRule color={colors.accent} />
            <h2 style={{ ...titleStyle, fontSize: 42, fontWeight: 600, marginBottom: 20, color: colors.text }}>{slide.title}</h2>
            {slide.body && (
              <p style={{ fontSize: 17, lineHeight: 1.6, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 900 }}>
                {capText(slide.body, 280, true)}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16, maxWidth: 860 }}>
                {capText(slide.bodySecondary, 180, true)}
              </p>
            )}
            {bullets.length > 0 && (
              <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: '20px 24px', marginTop: 4 }}>
                {bullets.slice(0, 4).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: i < bullets.length - 1 ? 12 : 0 }}>
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
  const pad = '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      {slide.imageUrl && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" style={{ opacity: 0.08, filter: 'saturate(0.3) blur(4px)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f5 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
        </div>
      )}
      <EdgeAccent color={colors.accent} />
      <div style={{ position: 'relative', zIndex: 1, padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Story Engine" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'flex', gap: 40, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: hasImages ? 640 : 780 }}>
            {slide.body && <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.bodySecondary}</p>}
            {bullets.length > 0 && (
              <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: '24px 28px', marginTop: 8 }}>
                {bullets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: i < bullets.length - 1 ? 12 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.accent, opacity: 0.5, fontFamily: `"${fontBody}", sans-serif`, minWidth: 22, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: 15, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {hasImages && <LayoutAwareImageZone slide={slide} colors={colors} />}
        </div>
        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}`, maxWidth: 700 }}>
            <p style={{ fontSize: 17, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   KEY MOMENTS — cinematic image showcase
   Portrait: full-bleed mosaic with native-fit images, compact header
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

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      {imgCount === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: isPortrait ? '60px 64px' : '80px 100px' }}>
          <SectionTag label="Key Moments" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 48 : 52, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: isPortrait ? 19 : 20, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 800 }}>{slide.body}</p>}
        </div>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: isPortrait ? '36px 56px 12px' : '48px 100px 24px', flexShrink: 0 }}>
            <SectionTag label="Key Moments" color={colors.accent} />
            <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', alignItems: isPortrait ? 'flex-start' : 'baseline', gap: isPortrait ? 8 : 32 }}>
              <h2 style={{ ...titleStyle, fontSize: isPortrait ? 40 : 44, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
              {slide.body && <p style={{ fontSize: isPortrait ? 14 : 15, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 500 }}>{slide.body}</p>}
            </div>
          </div>
          <div style={{
            flex: 1, padding: isPortrait ? '0 20px 32px' : '0 48px 48px',
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
      )}
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPARABLES — market positioning
   Portrait: single-column stack with larger cards
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
          <h2 style={{ ...titleStyle, fontSize: 44, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center' }}>
            {comps.slice(0, 4).map((c, i) => (
              <div key={i} style={{
                background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`,
                borderRadius: 10, padding: '28px 32px',
                display: 'flex', alignItems: 'flex-start', gap: 20,
              }}>
                <span style={{
                  fontSize: 32, fontWeight: 700, color: colors.accent, opacity: 0.2,
                  fontFamily: `"${fontBody}", sans-serif`, lineHeight: 1, minWidth: 44,
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 style={{ fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                  {c.reason && <p style={{ fontSize: 15, lineHeight: 1.55, color: colors.textMuted }}>{capText(c.reason, 180, true)}</p>}
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
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Market Positioning" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 48, color: colors.text }}>{slide.title}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 32, flex: 1, alignContent: 'center' }}>
          {comps.map((c, i) => (
            <div key={i} style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: '28px 32px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: colors.accent, opacity: 0.25, fontFamily: `"${fontBody}", sans-serif`, lineHeight: 1, minWidth: 48 }}>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 style={{ fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                {c.reason && <p style={{ fontSize: 15, lineHeight: 1.55, color: colors.textMuted }}>{c.reason}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CREATIVE STATEMENT — centred, authoritative
   Portrait: vertically centered with generous spacing
   ═══════════════════════════════════════════════════════════════════════ */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isPortrait ? '80px 72px' : '80px 180px',
      }}>
        <div style={{ maxWidth: isPortrait ? 880 : 920, textAlign: 'center' }}>
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 44 : 48, fontWeight: 600, marginBottom: isPortrait ? 36 : 40, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{
              fontSize: isPortrait ? 20 : 19, lineHeight: 1.7,
              color: colors.text, opacity: 0.88,
              fontFamily: `"${fontBody}", sans-serif`, marginBottom: 40,
            }}>
              {capText(slide.body, 450, isPortrait)}
            </p>
          )}
          {slide.credit && (
            <p style={{ fontSize: 14, letterSpacing: '0.1em', color: colors.accent, opacity: 0.65 }}>— {slide.credit}</p>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CLOSING — minimal, authoritative
   ═══════════════════════════════════════════════════════════════════════ */
function ClosingSlide({ slide, colors, titleStyle, baseStyle, isPortrait }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 48, height: 3, background: colors.accent, opacity: 0.5, marginBottom: 36 }} />
        <h1 style={{
          ...titleStyle, fontSize: isPortrait ? 68 : 72, fontWeight: 700,
          marginBottom: 20, color: colors.text, textAlign: 'center',
          padding: isPortrait ? '0 56px' : undefined,
        }}>
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p style={{
            fontSize: isPortrait ? 20 : 21, lineHeight: 1.5,
            maxWidth: 700, textAlign: 'center',
            color: colors.textMuted, marginBottom: isPortrait ? 44 : 48,
            padding: isPortrait ? '0 48px' : undefined,
          }}>
            {capText(slide.subtitle, 160, isPortrait)}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {slide.credit && (
            <span style={{ fontSize: 14, letterSpacing: '0.12em', color: colors.accent }}>{slide.credit}</span>
          )}
          {slide.companyLogoUrl ? (
            <img src={slide.companyLogoUrl} alt="" style={{ height: 28, objectFit: 'contain', opacity: 0.45, filter: 'brightness(2)', marginTop: 14 }} />
          ) : slide.companyName ? (
            <span style={{ fontSize: 12, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, opacity: 0.4, marginTop: 14 }}>
              {slide.companyName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ═══ CONTENT — generic fallback ═══ */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const pad = isPortrait ? '56px 64px' : '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 48 : 52, fontWeight: 600, marginBottom: isPortrait ? 32 : 40, color: colors.text }}>{slide.title}</h2>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: isPortrait ? 900 : 780 }}>
          {slide.body && <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 24 }}>{capText(slide.body, 400, isPortrait)}</p>}
          {slide.bodySecondary && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{capText(slide.bodySecondary, 300, isPortrait)}</p>}
        </div>
        {slide.bullets && slide.bullets.length > 0 && (
          <div style={{ marginTop: 'auto' }}>
            {slide.bullets.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 8, opacity: 0.6 }} />
                <span style={{ fontSize: isPortrait ? 15 : 16, lineHeight: 1.55, color: colors.text, opacity: 0.82 }}>{b}</span>
              </div>
            ))}
          </div>
        )}
        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
            <p style={{ fontSize: 17, fontStyle: 'italic', color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

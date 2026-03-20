/**
 * SlideRenderer — Premium cinematic slide compositions.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 * Each slide type has a purpose-built editorial layout with portrait variants.
 */
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
  if (!Array.isArray(value)) {
    warnings.push(field);
    return undefined;
  }

  const normalized = value
    .map((item, index) => {
      if (typeof item === 'string') return item;
      warnings.push(`${field}[${index}]`);
      return '';
    })
    .filter(Boolean);

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
      slideIndex,
      slideType: slide.type,
      title: normalizedSlide.title || null,
      debugImageIds: normalizedSlide._debug_image_ids || [],
    });
    if (warnings.length > 0) {
      console.warn('[LookBook] WARNING: non-string reached renderer (should not happen)', {
        slideIndex,
        slideType: slide.type,
        fields: warnings,
      });
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
    <span
      style={{
        color,
        opacity: 0.6,
        fontSize: 11,
        letterSpacing: '0.35em',
        textTransform: 'uppercase',
        display: 'block',
        marginBottom: 12,
      }}
    >
      {label}
    </span>
  );
}

/** Decorative vertical accent bar on left edge */
function EdgeAccent({ color }: { color: string }) {
  return (
    <div
      className="absolute left-0 top-0 bottom-0"
      style={{ width: 4, background: `linear-gradient(to bottom, transparent, ${color}, transparent)`, opacity: 0.3 }}
    />
  );
}

/* ═══ COVER — cinematic key art opener ═══ */
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody, isPortrait }: SlideProps) {
  const hasHero = !!slide.imageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {/* Full-bleed hero with strong overlay */}
      {hasHero && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover object-top" style={{ filter: 'saturate(0.7) contrast(1.15)' }} />
          <div className="absolute inset-0" style={{
            background: isPortrait
              ? `linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}ee 30%, transparent 60%)`
              : `
                linear-gradient(to right, ${colors.bg} 0%, ${colors.bg}ee 35%, transparent 65%),
                linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}cc 25%, transparent 50%),
                linear-gradient(135deg, ${colors.bg}aa 0%, transparent 60%)
              `,
          }} />
        </div>
      )}

      {/* Title lockup — bottom-weighted */}
      <div className="absolute inset-0 flex flex-col justify-end" style={{
        padding: isPortrait ? '60px 56px 72px' : '80px 96px 88px',
      }}>
        <div style={{ maxWidth: isPortrait ? 960 : (hasHero ? 960 : 1200) }}>
          <div style={{ width: 48, height: 2, background: colors.accent, opacity: 0.6, marginBottom: isPortrait ? 20 : 28 }} />
          <h1
            style={{
              ...titleStyle,
              fontSize: isPortrait ? (hasHero ? 72 : 84) : (hasHero ? 96 : 112),
              fontWeight: 700,
              lineHeight: 0.95,
              color: colors.text,
              marginBottom: 16,
            }}
          >
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p style={{
              fontSize: isPortrait ? 20 : 24,
              lineHeight: 1.5,
              color: colors.textMuted,
              fontFamily: `"${fontBody}", sans-serif`,
              maxWidth: isPortrait ? 560 : 720,
              marginBottom: isPortrait ? 28 : 40,
            }}>
              {slide.subtitle}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: isPortrait ? 20 : 32 }}>
            {slide.credit && (
              <span style={{ fontSize: isPortrait ? 12 : 14, letterSpacing: '0.12em', color: colors.accent, opacity: 0.85 }}>
                {slide.credit}
              </span>
            )}
            {slide.companyName && (
              <span style={{ fontSize: isPortrait ? 11 : 13, letterSpacing: '0.15em', color: colors.textMuted, opacity: 0.45, textTransform: 'uppercase' }}>
                {slide.companyName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Company logo — top right, subtle */}
      {slide.companyLogoUrl && (
        <div className="absolute top-12 right-14">
          <img src={slide.companyLogoUrl} alt="" className="h-7 object-contain" style={{ opacity: 0.4, filter: 'brightness(2)' }} />
        </div>
      )}
    </div>
  );
}

/* ═══ OVERVIEW — editorial layout, stacked in portrait ═══ */
function OverviewSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const pad = isPortrait ? '56px 48px 56px 56px' : '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Project Overview" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 44 : 56, fontWeight: 600, marginBottom: isPortrait ? 32 : 48, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? 32 : 64, flex: 1 }}>
          {/* Logline + synopsis */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {slide.body && (
              <p style={{
                fontSize: isPortrait ? 22 : 28,
                lineHeight: 1.45,
                fontWeight: 500,
                color: colors.text,
                fontFamily: `"${fontBody}", sans-serif`,
                marginBottom: isPortrait ? 20 : 28,
              }}>
                {slide.body}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{
                fontSize: isPortrait ? 15 : 17,
                lineHeight: 1.7,
                color: colors.textMuted,
                fontFamily: `"${fontBody}", sans-serif`,
              }}>
                {slide.bodySecondary}
              </p>
            )}
          </div>

          {/* Metadata panel */}
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{
              width: isPortrait ? '100%' : 360,
              flexShrink: 0,
              background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8,
              padding: isPortrait ? '28px 32px' : '40px 36px',
              display: 'flex',
              flexDirection: isPortrait ? 'row' : 'column',
              flexWrap: isPortrait ? 'wrap' : 'nowrap',
              justifyContent: 'center',
              gap: isPortrait ? 20 : 28,
            }}>
              {slide.bullets.map((b, i) => {
                const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
                return (
                  <div key={i} style={{ minWidth: isPortrait ? '40%' : undefined }}>
                    {label && <span style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.accent, display: 'block', marginBottom: 6 }}>{label}</span>}
                    <span style={{ fontSize: isPortrait ? 17 : 20, color: colors.text, fontWeight: 500 }}>{value}</span>
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

/* ═══ WORLD — immersive atmosphere ═══ */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const pad = isPortrait ? '56px 48px 56px 56px' : '72px 96px 72px 100px';

  return (
    <div style={baseStyle} className="slide-content">
      {/* Background wash from first image */}
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
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 40 : 52, fontWeight: 600, marginBottom: isPortrait ? 24 : 36, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? 24 : 48, flex: 1, minHeight: 0 }}>
          {/* Image grid — top in portrait, right in landscape */}
          {isPortrait && hasImages && (
            <div style={{
              height: 560,
              flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
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

          {/* Text column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
            {slide.body && (
              <p style={{ fontSize: isPortrait ? 17 : 19, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>
                {slide.body}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>
                {slide.bodySecondary}
              </p>
            )}
            {slide.quote && (
              <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
                <p style={{ fontSize: isPortrait ? 17 : 20, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.65, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
              </div>
            )}
          </div>

          {/* Image grid — right in landscape */}
          {!isPortrait && hasImages && (
            <div style={{
              width: imgs.length === 1 ? 680 : 640,
              flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
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
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ CHARACTERS — premium cast dossier ═══ */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const chars = slide.characters || [];
  const lead = chars[0];
  const supporting = chars.slice(1);
  const isSmallCast = chars.length <= 3;
  const pad = isPortrait ? '48px 44px 48px 52px' : '72px 96px 72px 100px';

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Characters" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 40 : 52, fontWeight: 600, marginBottom: isPortrait ? 28 : 40, color: colors.text }}>{slide.title}</h2>

        {isPortrait ? (
          /* ── Portrait: vertical card stack ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflow: 'hidden' }}>
            {/* Lead — hero card */}
            {lead && (
              <div style={{
                flexShrink: 0,
                display: 'flex',
                gap: 16,
                background: colors.bgSecondary,
                border: `1px solid ${colors.accent}`,
                borderRadius: 8,
                overflow: 'hidden',
                minHeight: isSmallCast ? 320 : 240,
              }}>
                {lead.imageUrl ? (
                  <div style={{ width: '45%', flexShrink: 0 }}>
                    <img src={lead.imageUrl} alt={lead.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
                  </div>
                ) : (
                  <div style={{ width: 120, flexShrink: 0, background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 48, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: '"Fraunces", serif' }}>{lead.name.charAt(0)}</span>
                  </div>
                )}
                <div style={{ padding: '24px 24px 24px 0', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <h3 style={{ fontSize: 24, fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4, lineHeight: 1.2 }}>{lead.name}</h3>
                  {lead.role && <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 12, display: 'block' }}>{lead.role}</span>}
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: colors.text, opacity: 0.82, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>{lead.description}</p>
                </div>
              </div>
            )}
            {/* Supporting — compact 2-col grid */}
            {supporting.length > 0 && (
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, alignContent: 'start', minHeight: 0 }}>
                {supporting.map((c, i) => (
                  <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={false} tall={false} isPortrait />
                ))}
              </div>
            )}
          </div>
        ) : isSmallCast ? (
          /* ── Landscape: horizontal editorial for ≤3 ── */
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {chars.map((c, i) => (
              <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={i === 0} tall isPortrait={false} />
            ))}
          </div>
        ) : (
          /* ── Landscape: lead + grid for 4+ ── */
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {lead && (
              <div style={{ width: 420, flexShrink: 0 }}>
                <CharCard char={lead} colors={colors} fontBody={fontBody} isLead tall isPortrait={false} />
              </div>
            )}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignContent: 'start' }}>
              {supporting.map((c, i) => (
                <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={false} tall={false} isPortrait={false} />
              ))}
            </div>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

function CharCard({ char, colors, fontBody, isLead, tall, isPortrait }: {
  char: { name: string; role: string; description: string; imageUrl?: string };
  colors: LookBookVisualIdentity['colors'];
  fontBody: string;
  isLead: boolean;
  tall: boolean;
  isPortrait: boolean;
}) {
  const imgH = isPortrait ? (tall ? 200 : 120) : (tall ? 280 : 180);
  const padText = isPortrait ? (tall ? '20px 24px' : '14px 16px') : (tall ? '24px 28px' : '16px 20px');
  return (
    <div style={{
      flex: tall && !isPortrait ? 1 : undefined,
      background: colors.bgSecondary,
      border: `1px solid ${colors.accentMuted}`,
      borderRadius: 8,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...(isLead ? { borderColor: colors.accent, borderWidth: 1 } : {}),
    }}>
      {char.imageUrl ? (
        <div style={{ height: imgH, overflow: 'hidden', flexShrink: 0 }}>
          <img src={char.imageUrl} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
        </div>
      ) : (
        <div style={{
          height: isPortrait ? (tall ? 80 : 48) : (tall ? 140 : 80),
          flexShrink: 0,
          background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: `1px solid ${colors.accentMuted}`,
        }}>
          <span style={{ fontSize: tall ? 36 : 24, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: '"Fraunces", serif' }}>{char.name.charAt(0)}</span>
        </div>
      )}
      <div style={{ padding: padText, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: isLead ? (isPortrait ? 18 : 24) : (isPortrait ? 15 : 19), fontWeight: 600, color: colors.accent, fontFamily: '"Fraunces", serif', marginBottom: 4, lineHeight: 1.2 }}>{char.name}</h3>
        {char.role && <span style={{ fontSize: isPortrait ? 10 : 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 8, display: 'block' }}>{char.role}</span>}
        <p style={{ fontSize: isPortrait ? (tall ? 13 : 12) : (tall ? 15 : 13), lineHeight: 1.55, color: colors.text, opacity: 0.82, fontFamily: `"${fontBody}", sans-serif`, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: isPortrait ? (tall ? 4 : 3) : (tall ? 6 : 4), WebkitBoxOrient: 'vertical' }}>{char.description}</p>
      </div>
    </div>
  );
}

/* ═══ THEMES — editorial with atmospheric imagery ═══ */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const pad = isPortrait ? '48px 44px 48px 52px' : '80px 100px';

  return (
    <div style={baseStyle} className="slide-content">
      {(slide.imageUrl || imgs[0]) && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl || imgs[0]} alt="" className="w-full h-full object-cover" style={{ opacity: 0.12, filter: 'saturate(0.3) blur(4px)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f2 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: isPortrait ? 'column' : 'row' }}>
        {/* In portrait, images on top */}
        {isPortrait && hasImages && (
          <div style={{
            height: 640,
            flexShrink: 0,
            padding: '48px 44px 12px 44px',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
                ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
              }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.7) contrast(1.1)' }} />
              </div>
            ))}
          </div>
        )}

        {/* Text panel */}
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: !hasImages && !isPortrait ? 'center' : 'flex-start',
          justifyContent: 'center',
          padding: isPortrait ? '24px 44px 48px 52px' : (hasImages ? '80px 48px 80px 100px' : pad),
          textAlign: !hasImages && !isPortrait ? 'center' : 'left',
        }}>
          <SectionTag label="Themes & Tone" color={colors.accent} />
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 52, fontWeight: 600, marginBottom: isPortrait ? 24 : 40, color: colors.text }}>{slide.title}</h2>
          <div style={{ maxWidth: isPortrait ? 960 : 720 }}>
            {slide.body && <p style={{ fontSize: isPortrait ? 18 : 22, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
        </div>

        {/* Landscape: image strip on right */}
        {!isPortrait && hasImages && (
          <div style={{
            width: '50%', padding: '48px 56px 48px 0',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : '1fr 1fr',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : '1fr 1fr',
            gap: 10,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
                ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
              }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.7) contrast(1.1)' }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ VISUAL LANGUAGE — aesthetic thesis with evidence ═══ */
function VisualLanguageSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const pad = isPortrait ? '48px 44px 48px 52px' : '72px 56px 72px 100px';

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />

      <div style={{ height: '100%', display: 'flex', flexDirection: isPortrait ? 'column' : 'row' }}>
        {/* Portrait: images on top */}
        {isPortrait && hasImages && (
          <div style={{
            height: 620,
            flexShrink: 0,
            padding: '48px 44px 12px',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
                ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
              }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.05)' }} />
              </div>
            ))}
          </div>
        )}

        {/* Text panel */}
        <div style={{
          flex: 1,
          padding: isPortrait ? '24px 44px 48px 52px' : pad,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <SectionTag label="Visual Language" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 48, fontWeight: 600, marginBottom: isPortrait ? 20 : 32, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: isPortrait ? 16 : 18, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20, maxWidth: isPortrait ? 960 : 620 }}>{slide.body}</p>}
          {(slide.bullets || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {slide.bullets!.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 12 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Landscape: image panel right */}
        {!isPortrait && hasImages && (
          <div style={{
            width: '55%', padding: '40px 48px 40px 0',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
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

/* ═══ STORY ENGINE — narrative propulsion with visual evidence ═══ */
function StoryEngineSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;
  const bullets = slide.bullets || [];
  const pad = isPortrait ? '48px 44px 48px 52px' : '72px 96px 72px 100px';

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
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 52, fontWeight: 600, marginBottom: isPortrait ? 24 : 36, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? 24 : 40, flex: 1, minHeight: 0 }}>
          {/* Portrait: images on top */}
          {isPortrait && hasImages && (
            <div style={{
              height: 440,
              flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
              gap: 8,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.8) contrast(1.05)' }} />
                </div>
              ))}
            </div>
          )}

          {/* Text + bullets */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: isPortrait ? 960 : (hasImages ? 640 : 780) }}>
            {slide.body && <p style={{ fontSize: isPortrait ? 16 : 19, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: isPortrait ? 13 : 15, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 16 }}>{slide.bodySecondary}</p>}
            {bullets.length > 0 && (
              <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}`, borderRadius: 8, padding: isPortrait ? '20px 24px' : '24px 28px', marginTop: 8 }}>
                {bullets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: i < bullets.length - 1 ? 12 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.accent, opacity: 0.5, fontFamily: `"${fontBody}", sans-serif`, minWidth: 22, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: isPortrait ? 13 : 15, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Landscape: images right */}
          {!isPortrait && hasImages && (
            <div style={{
              width: 440, flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
              gap: 8,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div key={i} style={{
                  borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`,
                  ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.8) contrast(1.05)' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${colors.accentMuted}`, maxWidth: isPortrait ? 960 : 700 }}>
            <p style={{ fontSize: isPortrait ? 15 : 17, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ KEY MOMENTS — cinematic image showcase ═══ */
function KeyMomentsSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const imgCount = imgs.length;

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

  const headerPad = isPortrait ? '40px 44px 16px 52px' : '48px 100px 24px';

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />

      {imgCount === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: isPortrait ? '60px 52px' : '80px 100px' }}>
          <SectionTag label="Key Moments" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 40 : 52, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>
          {slide.body && <p style={{ fontSize: isPortrait ? 17 : 20, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 800 }}>{slide.body}</p>}
        </div>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: headerPad, flexShrink: 0 }}>
            <SectionTag label="Key Moments" color={colors.accent} />
            <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', alignItems: isPortrait ? 'flex-start' : 'baseline', gap: isPortrait ? 8 : 32 }}>
              <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 44, fontWeight: 600, color: colors.text }}>{slide.title}</h2>
              {slide.body && <p style={{ fontSize: isPortrait ? 14 : 15, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 500 }}>{slide.body}</p>}
            </div>
          </div>

          <div style={{
            flex: 1, padding: isPortrait ? '0 36px 40px' : '0 48px 48px', display: 'grid', ...getGridStyle(), gap: isPortrait ? 8 : 10, minHeight: 0,
          }}>
            {imgs.slice(0, 6).map((url, i) => (
              <div key={i} style={{ borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.accentMuted}`, ...getSpanStyle(i) }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.08)' }} />
              </div>
            ))}
          </div>
        </div>
      )}
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ CONTENT — generic fallback ═══ */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const pad = isPortrait ? '48px 44px 48px 52px' : '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 40 : 52, fontWeight: 600, marginBottom: isPortrait ? 28 : 40, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? 24 : 48, flex: 1 }}>
          <div style={{ flex: 1, maxWidth: isPortrait ? 960 : 780 }}>
            {slide.body && <p style={{ fontSize: isPortrait ? 16 : 19, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 24 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{ width: isPortrait ? '100%' : 420, flexShrink: 0 }}>
              {slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 8, opacity: 0.6 }} />
                  <span style={{ fontSize: isPortrait ? 14 : 16, lineHeight: 1.55, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${colors.accentMuted}` }}>
            <p style={{ fontSize: isPortrait ? 15 : 17, fontStyle: 'italic', color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ COMPARABLES — market positioning ═══ */
function ComparablesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  const comps = slide.comparables || [];
  const pad = isPortrait ? '48px 44px 48px 52px' : '72px 96px 72px 100px';
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: pad, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Market Positioning" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: isPortrait ? 36 : 52, fontWeight: 600, marginBottom: isPortrait ? 32 : 48, color: colors.text }}>{slide.title}</h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isPortrait ? '1fr' : 'repeat(2, 1fr)',
          gap: isPortrait ? 20 : 32,
          flex: 1,
          alignContent: 'center',
        }}>
          {comps.map((c, i) => (
            <div key={i} style={{
              background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8,
              padding: isPortrait ? '24px 28px' : '28px 32px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: isPortrait ? 16 : 20,
            }}>
              <span style={{
                fontSize: isPortrait ? 28 : 36,
                fontWeight: 700, color: colors.accent, opacity: 0.25,
                fontFamily: `"${fontBody}", sans-serif`, lineHeight: 1, minWidth: isPortrait ? 36 : 48,
              }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 style={{ fontSize: isPortrait ? 18 : 22, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: '"Fraunces", serif' }}>{c.title}</h3>
                {c.reason && <p style={{ fontSize: isPortrait ? 13 : 15, lineHeight: 1.55, color: colors.textMuted }}>{c.reason}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ CREATIVE STATEMENT — centred, authoritative ═══ */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides, isPortrait }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isPortrait ? '60px 56px' : '80px 180px' }}>
        <div style={{ maxWidth: isPortrait ? 880 : 920, textAlign: 'center' }}>
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: isPortrait ? 38 : 48, fontWeight: 600, marginBottom: isPortrait ? 28 : 40, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{ fontSize: isPortrait ? 17 : 19, lineHeight: 1.7, color: colors.text, opacity: 0.88, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 36 }}>
              {slide.body}
            </p>
          )}
          {slide.credit && (
            <p style={{ fontSize: isPortrait ? 13 : 14, letterSpacing: '0.1em', color: colors.accent, opacity: 0.65 }}>— {slide.credit}</p>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ CLOSING — minimal, authoritative ═══ */
function ClosingSlide({ slide, colors, titleStyle, baseStyle, isPortrait }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 2, background: colors.accent, opacity: 0.5, marginBottom: isPortrait ? 28 : 36 }} />
        <h1 style={{ ...titleStyle, fontSize: isPortrait ? 56 : 72, fontWeight: 700, marginBottom: 16, color: colors.text, textAlign: 'center', padding: isPortrait ? '0 40px' : undefined }}>
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p style={{ fontSize: isPortrait ? 18 : 21, lineHeight: 1.5, maxWidth: isPortrait ? 600 : 700, textAlign: 'center', color: colors.textMuted, marginBottom: isPortrait ? 36 : 48, padding: isPortrait ? '0 32px' : undefined }}>
            {slide.subtitle}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {slide.credit && (
            <span style={{ fontSize: isPortrait ? 13 : 14, letterSpacing: '0.12em', color: colors.accent }}>{slide.credit}</span>
          )}
          {slide.companyLogoUrl ? (
            <img src={slide.companyLogoUrl} alt="" style={{ height: isPortrait ? 24 : 28, objectFit: 'contain', opacity: 0.45, filter: 'brightness(2)', marginTop: 12 }} />
          ) : slide.companyName ? (
            <span style={{ fontSize: 12, letterSpacing: '0.25em', textTransform: 'uppercase', color: colors.textMuted, opacity: 0.4, marginTop: 12 }}>
              {slide.companyName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
/**
 * SlideRenderer — Renders a single Look Book slide at 1920×1080 fixed resolution.
 * Each slide type has its own deterministic layout composition.
 */
import { cn } from '@/lib/utils';
import type { SlideContent, LookBookVisualIdentity } from '@/lib/lookbook/types';

interface SlideRendererProps {
  slide: SlideContent;
  identity: LookBookVisualIdentity;
  slideIndex: number;
  totalSlides: number;
}

export function SlideRenderer({ slide, identity, slideIndex, totalSlides }: SlideRendererProps) {
  const { colors, typography } = identity;
  const fontTitle = typography.titleFont;
  const fontBody = typography.bodyFont;

  const baseStyle: React.CSSProperties = {
    width: 1920,
    height: 1080,
    background: `linear-gradient(135deg, ${colors.bg}, ${colors.gradientTo})`,
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

  switch (slide.type) {
    case 'cover':
      return <CoverSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} />;
    case 'overview':
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'world':
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'characters':
      return <CharacterSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'themes':
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'visual_language':
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'story_engine':
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'comparables':
      return <ComparablesSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'creative_statement':
      return <StatementSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
    case 'closing':
      return <ClosingSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} />;
    default:
      return <ContentSlide slide={slide} colors={colors} titleStyle={titleStyle} baseStyle={baseStyle} fontBody={fontBody} slideIndex={slideIndex} totalSlides={totalSlides} />;
  }
}

/* ── Shared sub-components ── */

interface SlideProps {
  slide: SlideContent;
  colors: LookBookVisualIdentity['colors'];
  titleStyle: React.CSSProperties;
  baseStyle: React.CSSProperties;
  fontBody: string;
  slideIndex?: number;
  totalSlides?: number;
}

function SlideNumber({ index, total, color }: { index: number; total: number; color: string }) {
  return (
    <div
      className="absolute bottom-10 right-16 text-sm tracking-widest"
      style={{ color, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}
    >
      {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
    </div>
  );
}

function AccentLine({ color }: { color: string }) {
  return (
    <div
      className="mb-8"
      style={{ width: 60, height: 2, background: color, opacity: 0.6 }}
    />
  );
}

/* ── Cover Slide ── */
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex">
      {/* Left: image area */}
      {slide.imageUrl && (
        <div className="absolute inset-0">
          <img
            src={slide.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ opacity: 0.35, filter: 'saturate(0.7)' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${colors.bg} 30%, transparent 70%), linear-gradient(to top, ${colors.bg} 10%, transparent 50%)`,
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-end p-24 pb-32 w-full">
        <AccentLine color={colors.accent} />
        <h1
          className="text-8xl font-bold leading-none mb-6"
          style={{ ...titleStyle, color: colors.text }}
        >
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p
            className="text-2xl leading-relaxed max-w-3xl mb-10"
            style={{ color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}
          >
            {slide.subtitle}
          </p>
        )}
        <div className="flex items-center gap-8 mt-4">
          {slide.credit && (
            <span className="text-base tracking-wider" style={{ color: colors.accent, opacity: 0.8 }}>
              {slide.credit}
            </span>
          )}
          {slide.companyName && (
            <span className="text-base tracking-wider" style={{ color: colors.textMuted, opacity: 0.5 }}>
              {slide.companyName}
            </span>
          )}
        </div>
      </div>

      {/* Company logo - bottom right */}
      {slide.companyLogoUrl && (
        <div className="absolute bottom-10 right-16 z-10">
          <img
            src={slide.companyLogoUrl}
            alt={slide.companyName || ''}
            className="h-8 object-contain"
            style={{ opacity: 0.5, filter: 'brightness(2)' }}
          />
        </div>
      )}
    </div>
  );
}

/* ── Content Slide (generic) ── */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      {/* Section label */}
      <div className="mb-4">
        <span
          className="text-xs tracking-[0.3em] uppercase"
          style={{ color: colors.accent, opacity: 0.7 }}
        >
          {slide.type.replace(/_/g, ' ')}
        </span>
      </div>

      <AccentLine color={colors.accent} />

      <h2
        className="text-6xl font-semibold mb-12"
        style={{ ...titleStyle, color: colors.text }}
      >
        {slide.title}
      </h2>

      <div className="flex gap-20 flex-1">
        {/* Main body */}
        <div className="flex-1 max-w-3xl">
          {slide.body && (
            <p
              className="text-xl leading-relaxed mb-8"
              style={{ color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif` }}
            >
              {slide.body}
            </p>
          )}
          {slide.bodySecondary && (
            <p
              className="text-lg leading-relaxed"
              style={{ color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}
            >
              {slide.bodySecondary}
            </p>
          )}
        </div>

        {/* Bullets */}
        {slide.bullets && slide.bullets.length > 0 && (
          <div className="flex-1 max-w-xl">
            {slide.bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-4 mb-6">
                <div
                  className="w-1.5 h-1.5 rounded-full mt-2.5 shrink-0"
                  style={{ background: colors.accent }}
                />
                <span className="text-lg leading-relaxed" style={{ color: colors.text, opacity: 0.85 }}>
                  {b}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quote */}
      {slide.quote && (
        <div
          className="mt-auto pt-12 border-t"
          style={{ borderColor: colors.accentMuted }}
        >
          <p
            className="text-lg italic"
            style={{ color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}
          >
            "{slide.quote}"
          </p>
        </div>
      )}

      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Character Slide ── */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  const chars = slide.characters || [];
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <div className="mb-4">
        <span className="text-xs tracking-[0.3em] uppercase" style={{ color: colors.accent, opacity: 0.7 }}>
          characters
        </span>
      </div>
      <AccentLine color={colors.accent} />
      <h2 className="text-6xl font-semibold mb-16" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div className="grid grid-cols-2 gap-8 flex-1" style={{ gridTemplateColumns: chars.length <= 3 ? `repeat(${chars.length}, 1fr)` : 'repeat(2, 1fr)' }}>
        {chars.map((c, i) => (
          <div
            key={i}
            className="p-8 rounded-lg"
            style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}` }}
          >
            <h3
              className="text-2xl font-semibold mb-2"
              style={{ color: colors.accent, fontFamily: `"${slide.title ? 'Fraunces' : fontBody}", serif` }}
            >
              {c.name}
            </h3>
            {c.role && (
              <p className="text-sm tracking-wider uppercase mb-4" style={{ color: colors.textMuted }}>
                {c.role}
              </p>
            )}
            <p className="text-base leading-relaxed" style={{ color: colors.text, opacity: 0.85 }}>
              {c.description}
            </p>
          </div>
        ))}
      </div>

      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Comparables Slide ── */
function ComparablesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  const comps = slide.comparables || [];
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <div className="mb-4">
        <span className="text-xs tracking-[0.3em] uppercase" style={{ color: colors.accent, opacity: 0.7 }}>
          market positioning
        </span>
      </div>
      <AccentLine color={colors.accent} />
      <h2 className="text-6xl font-semibold mb-16" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div className="grid grid-cols-2 gap-10 flex-1">
        {comps.map((c, i) => (
          <div key={i} className="flex items-start gap-6">
            <div
              className="text-5xl font-bold shrink-0 w-16 text-center"
              style={{ color: colors.accent, opacity: 0.3, fontFamily: `"${fontBody}", sans-serif` }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
            <div>
              <h3 className="text-2xl font-semibold mb-2" style={{ color: colors.text }}>
                {c.title}
              </h3>
              {c.reason && (
                <p className="text-base leading-relaxed" style={{ color: colors.textMuted }}>
                  {c.reason}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Statement Slide ── */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex items-center justify-center p-24">
      <div className="max-w-4xl text-center">
        <AccentLine color={colors.accent} />
        <h2 className="text-5xl font-semibold mb-12 mx-auto" style={{ ...titleStyle, color: colors.text }}>
          {slide.title}
        </h2>
        {slide.body && (
          <p
            className="text-xl leading-relaxed mb-12"
            style={{ color: colors.text, opacity: 0.85, fontFamily: `"${fontBody}", sans-serif` }}
          >
            {slide.body}
          </p>
        )}
        {slide.credit && (
          <p className="text-base tracking-wider" style={{ color: colors.accent, opacity: 0.7 }}>
            — {slide.credit}
          </p>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Closing Slide ── */
function ClosingSlide({ slide, colors, titleStyle, baseStyle, fontBody }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex items-center justify-center">
      <div className="text-center">
        <AccentLine color={colors.accent} />
        <h1
          className="text-7xl font-bold mb-6"
          style={{ ...titleStyle, color: colors.text }}
        >
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p className="text-2xl leading-relaxed max-w-3xl mx-auto mb-12" style={{ color: colors.textMuted }}>
            {slide.subtitle}
          </p>
        )}
        <div className="flex flex-col items-center gap-4">
          {slide.credit && (
            <span className="text-base tracking-wider" style={{ color: colors.accent }}>
              {slide.credit}
            </span>
          )}
          {slide.companyLogoUrl ? (
            <img
              src={slide.companyLogoUrl}
              alt={slide.companyName || ''}
              className="h-10 object-contain mt-4"
              style={{ opacity: 0.6, filter: 'brightness(2)' }}
            />
          ) : slide.companyName ? (
            <span className="text-sm tracking-[0.2em] uppercase mt-4" style={{ color: colors.textMuted, opacity: 0.5 }}>
              {slide.companyName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

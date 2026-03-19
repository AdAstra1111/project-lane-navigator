/**
 * SlideRenderer — Renders a single Look Book slide at 1920×1080 fixed resolution.
 * Each slide type has its own deterministic layout composition.
 */
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

  const shared: SlideProps = { slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides };

  switch (slide.type) {
    case 'cover':
      return <CoverSlide {...shared} />;
    case 'overview':
      return <OverviewSlide {...shared} />;
    case 'world':
      return <WorldSlide {...shared} />;
    case 'characters':
      return <CharacterSlide {...shared} />;
    case 'themes':
      return <ThemesSlide {...shared} />;
    case 'visual_language':
      return <VisualLanguageSlide {...shared} />;
    case 'story_engine':
      return <ContentSlide {...shared} />;
    case 'comparables':
      return <ComparablesSlide {...shared} />;
    case 'creative_statement':
      return <StatementSlide {...shared} />;
    case 'closing':
      return <ClosingSlide {...shared} />;
    default:
      return <ContentSlide {...shared} />;
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

function AccentLine({ color, centered }: { color: string; centered?: boolean }) {
  return (
    <div
      className="mb-8"
      style={{
        width: 60,
        height: 2,
        background: color,
        opacity: 0.6,
        ...(centered ? { margin: '0 auto 2rem auto' } : {}),
      }}
    />
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <div className="mb-4">
      <span
        className="text-xs tracking-[0.3em] uppercase"
        style={{ color, opacity: 0.7 }}
      >
        {label}
      </span>
    </div>
  );
}

/* ── Cover Slide ── */
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex">
      {slide.imageUrl && (
        <div className="absolute inset-0">
          <img
            src={slide.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ opacity: 0.3, filter: 'saturate(0.6) contrast(1.1)' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${colors.bg} 35%, transparent 75%), linear-gradient(to top, ${colors.bg} 15%, transparent 55%)`,
            }}
          />
        </div>
      )}

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

/* ── Overview Slide — distinctive two-panel layout ── */
function OverviewSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <SectionLabel label="project overview" color={colors.accent} />
      <AccentLine color={colors.accent} />

      <h2 className="text-6xl font-semibold mb-16" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div className="flex gap-24 flex-1">
        {/* Left: logline as pull-quote */}
        <div className="flex-1 flex flex-col justify-center">
          {slide.body && (
            <p
              className="text-3xl leading-snug font-medium mb-8"
              style={{ color: colors.text, fontFamily: `"${fontBody}", sans-serif` }}
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

        {/* Right: metadata panel */}
        {slide.bullets && slide.bullets.length > 0 && (
          <div
            className="w-96 shrink-0 p-10 rounded-lg flex flex-col justify-center gap-8"
            style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}` }}
          >
            {slide.bullets.map((b, i) => {
              const [label, value] = b.includes(':') ? b.split(':').map(s => s.trim()) : ['', b];
              return (
                <div key={i}>
                  {label && (
                    <span className="text-xs tracking-[0.2em] uppercase block mb-1" style={{ color: colors.accent }}>
                      {label}
                    </span>
                  )}
                  <span className="text-xl" style={{ color: colors.text }}>
                    {value}
                  </span>
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

/* ── World Slide — atmospheric with image grid ── */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  const hasGallery = slide.imageUrls && slide.imageUrls.length > 0;
  return (
    <div style={baseStyle} className="slide-content flex">
      {/* Background hero image */}
      {slide.imageUrl && !hasGallery && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" style={{ opacity: 0.2, filter: 'saturate(0.5) contrast(1.1)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${colors.bg} 40%, transparent 80%), linear-gradient(to top, ${colors.bg} 20%, transparent 60%)` }} />
        </div>
      )}

      <div className="relative z-10 flex flex-col p-24 w-full">
        <SectionLabel label="the world" color={colors.accent} />
        <AccentLine color={colors.accent} />
        <h2 className="text-6xl font-semibold mb-12" style={{ ...titleStyle, color: colors.text }}>{slide.title}</h2>

        <div className="flex gap-16 flex-1">
          <div className="flex-1 flex flex-col justify-between">
            {slide.body && (
              <p className="text-xl leading-relaxed mb-8" style={{ color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif` }}>{slide.body}</p>
            )}
            {slide.bodySecondary && (
              <p className="text-lg leading-relaxed" style={{ color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>
            )}
            {slide.quote && (
              <div className="mt-auto pt-10 border-t max-w-3xl" style={{ borderColor: colors.accentMuted }}>
                <p className="text-2xl italic leading-relaxed" style={{ color: colors.accent, opacity: 0.7, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
              </div>
            )}
          </div>

          {hasGallery && (
            <div className="w-[600px] shrink-0 grid grid-cols-2 gap-4">
              {slide.imageUrls!.slice(0, 4).map((url, i) => (
                <div key={i} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${colors.accentMuted}` }}>
                  <img src={url} alt="" className="w-full h-full object-cover" style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
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

/* ── Themes Slide — centered, typographic emphasis ── */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex flex-col items-center justify-center p-24 text-center">
      <SectionLabel label="themes & tone" color={colors.accent} />
      <AccentLine color={colors.accent} centered />

      <h2 className="text-6xl font-semibold mb-16" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div className="max-w-4xl">
        {slide.body && (
          <p
            className="text-3xl leading-relaxed mb-10 font-light"
            style={{ color: colors.text, fontFamily: `"${fontBody}", sans-serif` }}
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

      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Visual Language Slide — grid of attributes with images ── */
function VisualLanguageSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  const hasGallery = slide.imageUrls && slide.imageUrls.length > 0;
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <SectionLabel label="visual language" color={colors.accent} />
      <AccentLine color={colors.accent} />
      <h2 className="text-6xl font-semibold mb-12" style={{ ...titleStyle, color: colors.text }}>{slide.title}</h2>

      <div className="flex gap-16 flex-1">
        <div className="flex-1">
          {slide.body && (
            <p className="text-xl leading-relaxed mb-10" style={{ color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif` }}>{slide.body}</p>
          )}
          {(slide.bullets || []).map((b, i) => (
            <div key={i} className="flex items-start gap-4 mb-5">
              <div className="w-1.5 h-1.5 rounded-full mt-2.5 shrink-0" style={{ background: colors.accent }} />
              <span className="text-lg leading-relaxed" style={{ color: colors.text, opacity: 0.85 }}>{b}</span>
            </div>
          ))}
        </div>

        {hasGallery && (
          <div className="w-[560px] shrink-0 grid grid-cols-2 gap-4">
            {slide.imageUrls!.slice(0, 4).map((url, i) => (
              <div key={i} className="rounded-lg overflow-hidden aspect-[4/3]" style={{ border: `1px solid ${colors.accentMuted}` }}>
                <img src={url} alt="" className="w-full h-full object-cover" style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ── Content Slide (generic fallback) ── */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <SectionLabel label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
      <AccentLine color={colors.accent} />

      <h2 className="text-6xl font-semibold mb-12" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div className="flex gap-20 flex-1">
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

      {slide.quote && (
        <div className="mt-auto pt-12 border-t" style={{ borderColor: colors.accentMuted }}>
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

/* ── Character Slide — with character images ── */
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  const chars = slide.characters || [];
  return (
    <div style={baseStyle} className="slide-content flex flex-col p-24">
      <SectionLabel label="characters" color={colors.accent} />
      <AccentLine color={colors.accent} />
      <h2 className="text-6xl font-semibold mb-16" style={{ ...titleStyle, color: colors.text }}>
        {slide.title}
      </h2>

      <div
        className="grid gap-8 flex-1"
        style={{ gridTemplateColumns: chars.length <= 3 ? `repeat(${chars.length}, 1fr)` : 'repeat(2, 1fr)' }}
      >
        {chars.map((c, i) => (
          <div
            key={i}
            className="rounded-lg overflow-hidden flex flex-col"
            style={{ background: colors.bgSecondary, border: `1px solid ${colors.accentMuted}` }}
          >
            {c.imageUrl && (
              <div className="h-48 overflow-hidden">
                <img src={c.imageUrl} alt={c.name} className="w-full h-full object-cover object-top" style={{ filter: 'saturate(0.8) contrast(1.05)' }} />
              </div>
            )}
            <div className="p-8 flex-1">
              <h3
                className="text-2xl font-semibold mb-2"
                style={{ color: colors.accent, fontFamily: '"Fraunces", serif' }}
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
      <SectionLabel label="market positioning" color={colors.accent} />
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

/* ── Statement Slide — centered, elegant ── */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex = 0, totalSlides = 1 }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex items-center justify-center p-24">
      <div className="max-w-4xl text-center">
        <AccentLine color={colors.accent} centered />
        <h2 className="text-5xl font-semibold mb-12" style={{ ...titleStyle, color: colors.text }}>
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
function ClosingSlide({ slide, colors, titleStyle, baseStyle }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content flex items-center justify-center">
      <div className="text-center">
        <AccentLine color={colors.accent} centered />
        <h1 className="text-7xl font-bold mb-6" style={{ ...titleStyle, color: colors.text }}>
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

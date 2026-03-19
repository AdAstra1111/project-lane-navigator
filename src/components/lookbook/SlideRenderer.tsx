/**
 * SlideRenderer — Premium cinematic slide compositions at 1920×1080.
 * Each slide type has a purpose-built editorial layout.
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

  const shared: SlideProps = { slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides };

  switch (slide.type) {
    case 'cover': return <CoverSlide {...shared} />;
    case 'overview': return <OverviewSlide {...shared} />;
    case 'world': return <WorldSlide {...shared} />;
    case 'characters': return <CharacterSlide {...shared} />;
    case 'themes': return <ThemesSlide {...shared} />;
    case 'visual_language': return <VisualLanguageSlide {...shared} />;
    case 'story_engine': return <StoryEngineSlide {...shared} />;
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
function CoverSlide({ slide, colors, titleStyle, baseStyle, fontBody }: SlideProps) {
  const hasHero = !!slide.imageUrl;
  return (
    <div style={baseStyle} className="slide-content">
      {/* Full-bleed hero with strong overlay */}
      {hasHero && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover object-top" style={{ filter: 'saturate(0.7) contrast(1.15)' }} />
          <div className="absolute inset-0" style={{
            background: `
              linear-gradient(to right, ${colors.bg} 0%, ${colors.bg}ee 35%, transparent 65%),
              linear-gradient(to top, ${colors.bg} 0%, ${colors.bg}cc 25%, transparent 50%),
              linear-gradient(135deg, ${colors.bg}aa 0%, transparent 60%)
            `,
          }} />
        </div>
      )}

      {/* Title lockup — left-aligned, bottom-weighted for cinematic authority */}
      <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '80px 96px 88px' }}>
        <div style={{ maxWidth: hasHero ? 960 : 1200 }}>
          <div style={{ width: 48, height: 2, background: colors.accent, opacity: 0.6, marginBottom: 28 }} />
          <h1
            style={{
              ...titleStyle,
              fontSize: hasHero ? 96 : 112,
              fontWeight: 700,
              lineHeight: 0.95,
              color: colors.text,
              marginBottom: 20,
            }}
          >
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p style={{
              fontSize: 24,
              lineHeight: 1.5,
              color: colors.textMuted,
              fontFamily: `"${fontBody}", sans-serif`,
              maxWidth: 720,
              marginBottom: 40,
            }}>
              {slide.subtitle}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            {slide.credit && (
              <span style={{ fontSize: 14, letterSpacing: '0.12em', color: colors.accent, opacity: 0.85 }}>
                {slide.credit}
              </span>
            )}
            {slide.companyName && (
              <span style={{ fontSize: 13, letterSpacing: '0.15em', color: colors.textMuted, opacity: 0.45, textTransform: 'uppercase' }}>
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

/* ═══ OVERVIEW — two-panel editorial ═══ */
function OverviewSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Project Overview" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 600, marginBottom: 48, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', gap: 64, flex: 1 }}>
          {/* Left — logline + synopsis */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {slide.body && (
              <p style={{
                fontSize: 28,
                lineHeight: 1.45,
                fontWeight: 500,
                color: colors.text,
                fontFamily: `"${fontBody}", sans-serif`,
                marginBottom: 28,
                maxWidth: 780,
              }}>
                {slide.body}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{
                fontSize: 17,
                lineHeight: 1.7,
                color: colors.textMuted,
                fontFamily: `"${fontBody}", sans-serif`,
                maxWidth: 720,
              }}>
                {slide.bodySecondary}
              </p>
            )}
          </div>

          {/* Right — metadata panel */}
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{
              width: 360,
              flexShrink: 0,
              background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8,
              padding: '40px 36px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 28,
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

/* ═══ WORLD — immersive atmosphere ═══ */
function WorldSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

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
      <div style={{ position: 'relative', zIndex: 1, padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="The World" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 36, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', gap: 48, flex: 1, minHeight: 0 }}>
          {/* Text column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
            {slide.body && (
              <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, opacity: 0.92, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 20, maxWidth: 680 }}>
                {slide.body}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif`, maxWidth: 640 }}>
                {slide.bodySecondary}
              </p>
            )}
            {slide.quote && (
              <div style={{ marginTop: 'auto', paddingTop: 28, borderTop: `1px solid ${colors.accentMuted}`, maxWidth: 600 }}>
                <p style={{ fontSize: 20, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.65, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
              </div>
            )}
          </div>

          {/* Image grid — adaptive */}
          {hasImages && (
            <div style={{
              width: imgs.length === 1 ? 680 : 640,
              flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
              gap: 8,
            }}>
              {imgs.slice(0, 4).map((url, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: `1px solid ${colors.accentMuted}`,
                    ...(imgs.length === 1 ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}),
                    ...(imgs.length === 3 && i === 0 ? { gridRow: '1 / 3' } : {}),
                  }}
                >
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
function CharacterSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  const chars = slide.characters || [];
  const withImage = chars.filter(c => c.imageUrl);
  const withoutImage = chars.filter(c => !c.imageUrl);
  // Lead = first character; rest are supporting
  const lead = chars[0];
  const supporting = chars.slice(1);
  const isSmallCast = chars.length <= 3;

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Characters" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>

        {isSmallCast ? (
          /* ── Horizontal editorial layout for ≤3 characters ── */
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {chars.map((c, i) => (
              <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={i === 0} tall />
            ))}
          </div>
        ) : (
          /* ── Lead + supporting grid for 4+ ── */
          <div style={{ display: 'flex', gap: 28, flex: 1, minHeight: 0 }}>
            {/* Lead character — larger panel */}
            {lead && (
              <div style={{ width: 420, flexShrink: 0 }}>
                <CharCard char={lead} colors={colors} fontBody={fontBody} isLead tall />
              </div>
            )}
            {/* Supporting — compact 2-col grid */}
            <div style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 16,
              alignContent: 'start',
            }}>
              {supporting.map((c, i) => (
                <CharCard key={i} char={c} colors={colors} fontBody={fontBody} isLead={false} tall={false} />
              ))}
            </div>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

function CharCard({ char, colors, fontBody, isLead, tall }: {
  char: { name: string; role: string; description: string; imageUrl?: string };
  colors: LookBookVisualIdentity['colors'];
  fontBody: string;
  isLead: boolean;
  tall: boolean;
}) {
  return (
    <div style={{
      flex: tall ? 1 : undefined,
      background: colors.bgSecondary,
      border: `1px solid ${colors.accentMuted}`,
      borderRadius: 8,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...(isLead ? { borderColor: colors.accent, borderWidth: 1 } : {}),
    }}>
      {/* Image area */}
      {char.imageUrl ? (
        <div style={{ height: tall ? 280 : 180, overflow: 'hidden', flexShrink: 0 }}>
          <img src={char.imageUrl} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'saturate(0.8) contrast(1.05)' }} />
        </div>
      ) : (
        /* Graceful fallback — accent monogram */
        <div style={{
          height: tall ? 140 : 80,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${colors.bgSecondary}, ${colors.bg})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: `1px solid ${colors.accentMuted}`,
        }}>
          <span style={{ fontSize: tall ? 48 : 32, fontWeight: 700, color: colors.accent, opacity: 0.2, fontFamily: `"Fraunces", serif` }}>
            {char.name.charAt(0)}
          </span>
        </div>
      )}

      {/* Text area */}
      <div style={{ padding: tall ? '24px 28px' : '16px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{
          fontSize: isLead ? 24 : 19,
          fontWeight: 600,
          color: colors.accent,
          fontFamily: '"Fraunces", serif',
          marginBottom: 4,
          lineHeight: 1.2,
        }}>
          {char.name}
        </h3>
        {char.role && (
          <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: colors.textMuted, marginBottom: 12, display: 'block' }}>
            {char.role}
          </span>
        )}
        <p style={{
          fontSize: tall ? 15 : 13,
          lineHeight: 1.55,
          color: colors.text,
          opacity: 0.82,
          fontFamily: `"${fontBody}", sans-serif`,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: tall ? 6 : 4,
          WebkitBoxOrient: 'vertical',
        }}>
          {char.description}
        </p>
      </div>
    </div>
  );
}

/* ═══ THEMES — centered typographic emphasis ═══ */
function ThemesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 160px', textAlign: 'center' }}>
        <SectionTag label="Themes & Tone" color={colors.accent} />
        <AccentRule color={colors.accent} width={40} />
        <h2 style={{ ...titleStyle, fontSize: 56, fontWeight: 600, marginBottom: 48, color: colors.text }}>{slide.title}</h2>

        <div style={{ maxWidth: 900 }}>
          {slide.body && (
            <p style={{ fontSize: 26, lineHeight: 1.55, fontWeight: 300, color: colors.text, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 32 }}>
              {slide.body}
            </p>
          )}
          {slide.bodySecondary && (
            <p style={{ fontSize: 17, lineHeight: 1.65, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>
              {slide.bodySecondary}
            </p>
          )}
        </div>
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ VISUAL LANGUAGE — aesthetic thesis with evidence ═══ */
function VisualLanguageSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  const imgs = (slide.imageUrls || []).filter(Boolean);
  const hasImages = imgs.length > 0;

  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />

      {/* Layout: images take right 55%, text left 45% when images exist */}
      <div style={{ height: '100%', display: 'flex' }}>
        {/* Text panel */}
        <div style={{
          width: hasImages ? '45%' : '100%',
          padding: '72px 56px 72px 100px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          <SectionTag label="Visual Language" color={colors.accent} />
          <AccentRule color={colors.accent} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 32, color: colors.text }}>{slide.title}</h2>

          {slide.body && (
            <p style={{
              fontSize: 18,
              lineHeight: 1.65,
              color: colors.text,
              opacity: 0.92,
              fontFamily: `"${fontBody}", sans-serif`,
              marginBottom: 28,
              maxWidth: 620,
            }}>
              {slide.body}
            </p>
          )}

          {(slide.bullets || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {slide.bullets!.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: 16, lineHeight: 1.5, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Image panel — magazine-style grid */}
        {hasImages && (
          <div style={{
            width: '55%',
            padding: '40px 48px 40px 0',
            display: 'grid',
            gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gridTemplateRows: imgs.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {imgs.slice(0, 4).map((url, i) => (
              <div key={i} style={{
                borderRadius: 6,
                overflow: 'hidden',
                border: `1px solid ${colors.accentMuted}`,
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

/* ═══ STORY ENGINE — narrative propulsion ═══ */
function StoryEngineSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  const hasImage = !!slide.imageUrl;
  const bullets = slide.bullets || [];

  return (
    <div style={baseStyle} className="slide-content">
      {/* Subtle background image wash */}
      {hasImage && (
        <div className="absolute inset-0">
          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" style={{ opacity: 0.1, filter: 'saturate(0.3) blur(3px)' }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${colors.bg}f5 0%, ${colors.bg}dd 50%, ${colors.bg}f0 100%)` }} />
        </div>
      )}

      <EdgeAccent color={colors.accent} />
      <div style={{
        position: 'relative',
        zIndex: 1,
        padding: '72px 96px 72px 100px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <SectionTag label="Story Engine" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', gap: 56, flex: 1, minHeight: 0 }}>
          {/* Primary text column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 780 }}>
            {slide.body && (
              <p style={{
                fontSize: 20,
                lineHeight: 1.65,
                color: colors.text,
                opacity: 0.92,
                fontFamily: `"${fontBody}", sans-serif`,
                marginBottom: 32,
              }}>
                {slide.body}
              </p>
            )}
            {slide.bodySecondary && (
              <p style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: colors.textMuted,
                fontFamily: `"${fontBody}", sans-serif`,
                marginBottom: 24,
              }}>
                {slide.bodySecondary}
              </p>
            )}
          </div>

          {/* Structural beats — right column */}
          {bullets.length > 0 && (
            <div style={{
              width: 440,
              flexShrink: 0,
              background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8,
              padding: '36px 32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 20,
            }}>
              {bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.accent, opacity: 0.5, fontFamily: `"${fontBody}", sans-serif`, minWidth: 24, paddingTop: 2 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 16, lineHeight: 1.5, color: colors.text, opacity: 0.85 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {slide.quote && (
          <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: `1px solid ${colors.accentMuted}`, maxWidth: 700 }}>
            <p style={{ fontSize: 18, fontStyle: 'italic', lineHeight: 1.5, color: colors.accent, opacity: 0.6, fontFamily: `"${fontBody}", sans-serif` }}>"{slide.quote}"</p>
          </div>
        )}
      </div>
      <SlideNumber index={slideIndex} total={totalSlides} color={colors.textMuted} />
    </div>
  );
}

/* ═══ CONTENT — generic fallback ═══ */
function ContentSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label={slide.type.replace(/_/g, ' ')} color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'flex', gap: 48, flex: 1 }}>
          <div style={{ flex: 1, maxWidth: 780 }}>
            {slide.body && <p style={{ fontSize: 19, lineHeight: 1.65, color: colors.text, opacity: 0.9, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 24 }}>{slide.body}</p>}
            {slide.bodySecondary && <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textMuted, fontFamily: `"${fontBody}", sans-serif` }}>{slide.bodySecondary}</p>}
          </div>
          {slide.bullets && slide.bullets.length > 0 && (
            <div style={{ width: 420, flexShrink: 0 }}>
              {slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, flexShrink: 0, marginTop: 8, opacity: 0.6 }} />
                  <span style={{ fontSize: 16, lineHeight: 1.55, color: colors.text, opacity: 0.82 }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

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

/* ═══ COMPARABLES — market positioning ═══ */
function ComparablesSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  const comps = slide.comparables || [];
  return (
    <div style={baseStyle} className="slide-content">
      <EdgeAccent color={colors.accent} />
      <div style={{ padding: '72px 96px 72px 100px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SectionTag label="Market Positioning" color={colors.accent} />
        <AccentRule color={colors.accent} />
        <h2 style={{ ...titleStyle, fontSize: 52, fontWeight: 600, marginBottom: 48, color: colors.text }}>{slide.title}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 32, flex: 1, alignContent: 'center' }}>
          {comps.map((c, i) => (
            <div key={i} style={{
              background: colors.bgSecondary,
              border: `1px solid ${colors.accentMuted}`,
              borderRadius: 8,
              padding: '28px 32px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 20,
            }}>
              <span style={{
                fontSize: 36,
                fontWeight: 700,
                color: colors.accent,
                opacity: 0.25,
                fontFamily: `"${fontBody}", sans-serif`,
                lineHeight: 1,
                minWidth: 48,
              }}>
                {String(i + 1).padStart(2, '0')}
              </span>
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

/* ═══ CREATIVE STATEMENT — centred, authoritative ═══ */
function StatementSlide({ slide, colors, titleStyle, baseStyle, fontBody, slideIndex, totalSlides }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 180px' }}>
        <div style={{ maxWidth: 920, textAlign: 'center' }}>
          <AccentRule color={colors.accent} width={40} />
          <h2 style={{ ...titleStyle, fontSize: 48, fontWeight: 600, marginBottom: 40, color: colors.text }}>{slide.title}</h2>
          {slide.body && (
            <p style={{ fontSize: 19, lineHeight: 1.7, color: colors.text, opacity: 0.88, fontFamily: `"${fontBody}", sans-serif`, marginBottom: 36 }}>
              {slide.body}
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

/* ═══ CLOSING — minimal, authoritative ═══ */
function ClosingSlide({ slide, colors, titleStyle, baseStyle }: SlideProps) {
  return (
    <div style={baseStyle} className="slide-content">
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 2, background: colors.accent, opacity: 0.5, marginBottom: 36 }} />
        <h1 style={{ ...titleStyle, fontSize: 72, fontWeight: 700, marginBottom: 16, color: colors.text, textAlign: 'center' }}>
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p style={{ fontSize: 21, lineHeight: 1.5, maxWidth: 700, textAlign: 'center', color: colors.textMuted, marginBottom: 48 }}>
            {slide.subtitle}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {slide.credit && (
            <span style={{ fontSize: 14, letterSpacing: '0.12em', color: colors.accent }}>{slide.credit}</span>
          )}
          {slide.companyLogoUrl ? (
            <img src={slide.companyLogoUrl} alt="" style={{ height: 28, objectFit: 'contain', opacity: 0.45, filter: 'brightness(2)', marginTop: 12 }} />
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

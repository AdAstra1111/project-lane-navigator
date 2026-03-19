/**
 * PosterCompositor — Deterministic cinematic poster layout engine.
 * Takes key art + structured credits → renders a branded poster with title + billing block.
 * All text is deterministic — NO hallucinated names.
 *
 * Title typography is template-aware with configurable modes:
 *   prestige_serif, classic_theatrical_serif, commercial_refined, minimalist_elegant
 */
import { useRef, useEffect, useState } from "react";

export interface PosterCreditsData {
  writtenBy?: string[];
  producedBy?: string[];
  createdByCredit?: string | null;
  basedOnCredit?: string | null;
}

export type PosterLayoutVariant = "classic-theatrical" | "prestige-awards" | "prestige" | "commercial" | "cinematic-dark" | "cinematic-light" | "minimal";

export type TitleTypographyMode =
  | "prestige_serif"
  | "classic_theatrical_serif"
  | "commercial_refined"
  | "minimalist_elegant";

export type TitleCaseMode = "uppercase" | "mixed" | "small_caps";

export type TitlePositionMode = "center" | "lower_center" | "lower_third" | "lower_left" | "auto";

export type TitleBalanceMode = "compact" | "balanced" | "airy";

export interface TitleStyleConfig {
  typographyMode?: TitleTypographyMode;
  caseMode?: TitleCaseMode;
  colorHex?: string;
  opacity?: number;
  positionMode?: TitlePositionMode;
  balanceMode?: TitleBalanceMode;
  /** Override weight (100-900) */
  weightOverride?: number;
  /** Override tracking multiplier */
  trackingOverride?: number;
  /** Subtle emboss/depth effect */
  enableDepth?: boolean;
}

/** Exported metadata for UI */
export interface TitleTypographyInfo {
  label: string;
  description: string;
}

export const TITLE_TYPOGRAPHY_MODES: Record<TitleTypographyMode, TitleTypographyInfo> = {
  prestige_serif: {
    label: "Prestige Serif",
    description: "Refined serif, light weight, high tracking — festival / awards aesthetic",
  },
  classic_theatrical_serif: {
    label: "Classic Theatrical",
    description: "Strong serif with gravitas — classic cinema lobby one-sheet",
  },
  commercial_refined: {
    label: "Commercial Refined",
    description: "Bold but designed sans-serif — mainstream theatrical appeal",
  },
  minimalist_elegant: {
    label: "Minimalist Elegant",
    description: "Ultra-light, maximum restraint — auteur / A24 style",
  },
};

export const TITLE_CASE_OPTIONS: Record<TitleCaseMode, string> = {
  uppercase: "ALL CAPS",
  mixed: "Mixed Case",
  small_caps: "Small Caps",
};

export const TITLE_POSITION_OPTIONS: Record<TitlePositionMode, string> = {
  auto: "Auto (composition-aware)",
  center: "Center",
  lower_center: "Lower Center",
  lower_third: "Lower Third",
  lower_left: "Lower Left",
};

export const TITLE_BALANCE_OPTIONS: Record<TitleBalanceMode, string> = {
  compact: "Compact",
  balanced: "Balanced",
  airy: "Airy",
};

interface PosterCompositorProps {
  keyArtUrl: string;
  title: string;
  tagline?: string;
  companyLogoUrl?: string | null;
  companyName?: string | null;
  credits?: PosterCreditsData;
  aspectRatio?: "2:3" | "1:1" | "16:9";
  layoutVariant?: PosterLayoutVariant;
  titleStyle?: TitleStyleConfig;
  width?: number;
  onRender?: (canvas: HTMLCanvasElement) => void;
  className?: string;
}

// Brand palette
const BRAND = {
  dark: "#0C0D10",
  darkMid: "#141519",
  amber: "#C4913A",
  amberLight: "#D4A84E",
  amberDim: "#A07830",
  white: "#F5F2ED",
  ivory: "#F0EBE1",
  bone: "#E5DFD3",
  warmGold: "#D4B878",
  mutedGold: "#B8A06A",
  silver: "#B8B5AE",
  creditGray: "#8A877F",
  billingGray: "#6E6B64",
};

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  "2:3": { w: 800, h: 1200 },
  "1:1": { w: 1000, h: 1000 },
  "16:9": { w: 1280, h: 720 },
};

// ── Typography Mode → Font Config ────────────────────────────────────────────

interface TitleFontConfig {
  fontFamily: string;
  weight: number;
  tracking: number;
  defaultCase: TitleCaseMode;
  defaultColor: string;
  defaultOpacity: number;
  shadowBlur: number;
  shadowAlpha: number;
  sizeScale: number;
}

const TYPOGRAPHY_CONFIGS: Record<TitleTypographyMode, TitleFontConfig> = {
  prestige_serif: {
    fontFamily: '"Fraunces", "Crimson Pro", Georgia, serif',
    weight: 300,
    tracking: 0.18,
    defaultCase: "mixed",
    defaultColor: BRAND.ivory,
    defaultOpacity: 0.92,
    shadowBlur: 16,
    shadowAlpha: 0.5,
    sizeScale: 0.88,
  },
  classic_theatrical_serif: {
    fontFamily: '"Fraunces", "Crimson Pro", Georgia, serif',
    weight: 600,
    tracking: 0.12,
    defaultCase: "uppercase",
    defaultColor: BRAND.bone,
    defaultOpacity: 0.95,
    shadowBlur: 20,
    shadowAlpha: 0.6,
    sizeScale: 1.0,
  },
  commercial_refined: {
    fontFamily: '"DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
    weight: 700,
    tracking: 0.06,
    defaultCase: "uppercase",
    defaultColor: BRAND.white,
    defaultOpacity: 0.97,
    shadowBlur: 22,
    shadowAlpha: 0.65,
    sizeScale: 1.02,
  },
  minimalist_elegant: {
    fontFamily: '"Fraunces", "Crimson Pro", Georgia, serif',
    weight: 200,
    tracking: 0.28,
    defaultCase: "mixed",
    defaultColor: BRAND.bone,
    defaultOpacity: 0.82,
    shadowBlur: 10,
    shadowAlpha: 0.35,
    sizeScale: 0.82,
  },
};

// ── Template → Default Typography Mode ───────────────────────────────────────

const TEMPLATE_TYPOGRAPHY_DEFAULTS: Record<PosterLayoutVariant, TitleTypographyMode> = {
  "classic-theatrical": "classic_theatrical_serif",
  "prestige-awards": "prestige_serif",
  prestige: "prestige_serif",
  commercial: "commercial_refined",
  "cinematic-dark": "classic_theatrical_serif",
  "cinematic-light": "classic_theatrical_serif",
  minimal: "minimalist_elegant",
};

// ── Template → Default auto-position bias ────────────────────────────────────

const TEMPLATE_AUTO_POSITION_BIAS: Record<PosterLayoutVariant, TitlePositionMode> = {
  "classic-theatrical": "lower_center",
  "prestige-awards": "lower_third",
  prestige: "lower_third",
  commercial: "lower_center",
  "cinematic-dark": "lower_center",
  "cinematic-light": "lower_center",
  minimal: "lower_third",
};

// ── Template → Default Title Color (warm tones instead of harsh white) ───────

const TEMPLATE_COLOR_HINTS: Record<PosterLayoutVariant, string> = {
  "classic-theatrical": BRAND.bone,
  "prestige-awards": BRAND.ivory,
  prestige: BRAND.ivory,
  commercial: BRAND.white,
  "cinematic-dark": BRAND.bone,
  "cinematic-light": BRAND.warmGold,
  minimal: BRAND.bone,
};

export function PosterCompositor({
  keyArtUrl,
  title,
  tagline,
  companyLogoUrl,
  companyName,
  credits,
  aspectRatio = "2:3",
  layoutVariant = "cinematic-dark",
  titleStyle,
  width,
  onRender,
  className,
}: PosterCompositorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS["2:3"];
    canvas.width = dims.w;
    canvas.height = dims.h;

    const img = new Image();
    img.crossOrigin = "anonymous";

    let logoImg: HTMLImageElement | null = null;
    let logoLoaded = false;
    let keyArtLoaded = false;

    const tryRender = () => {
      if (!keyArtLoaded) return;
      // Draw key art (cover fill)
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const canvasAspect = dims.w / dims.h;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (imgAspect > canvasAspect) {
        sw = img.naturalHeight * canvasAspect;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = img.naturalWidth / canvasAspect;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dims.w, dims.h);

      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null, credits, titleStyle);
      setLoaded(true);
      onRender?.(canvas);
    };

    img.onload = () => {
      keyArtLoaded = true;
      if (!companyLogoUrl || logoLoaded) tryRender();
    };
    img.onerror = () => {
      ctx.fillStyle = BRAND.dark;
      ctx.fillRect(0, 0, dims.w, dims.h);
      keyArtLoaded = true;
      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null, credits, titleStyle);
      setLoaded(true);
    };
    img.src = keyArtUrl;

    if (companyLogoUrl) {
      logoImg = new Image();
      logoImg.crossOrigin = "anonymous";
      logoImg.onload = () => { logoLoaded = true; if (keyArtLoaded) tryRender(); };
      logoImg.onerror = () => { logoImg = null; logoLoaded = true; if (keyArtLoaded) tryRender(); };
      logoImg.src = companyLogoUrl;
    }
  }, [keyArtUrl, title, tagline, aspectRatio, layoutVariant, titleStyle, onRender, companyLogoUrl, companyName, credits]);

  const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS["2:3"];
  const displayWidth = width || 320;
  const displayHeight = (displayWidth * dims.h) / dims.w;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: displayWidth,
        height: displayHeight,
        borderRadius: 8,
      }}
    />
  );
}

// ── Layout Variant Config ────────────────────────────────────────────────────

interface LayoutConfig {
  titleZoneY: number;
  gradientCoverage: number;
  gradientMaxAlpha: number;
  titleTracking: number;
  showAccentLine: boolean;
  billingCondensed: boolean;
  titleWeight: number;
}

/** Exported template metadata for UI selection */
export interface PosterTemplateInfo {
  label: string;
  description: string;
}

export const POSTER_TEMPLATES: Record<PosterLayoutVariant, PosterTemplateInfo> = {
  "classic-theatrical": { label: "Classic Theatrical", description: "Full composition with prominent billing block — classic 27×40 cinema lobby feel" },
  "prestige-awards": { label: "Prestige Awards", description: "Elegant dramatic composition with refined billing — Cannes / TIFF aesthetic" },
  prestige: { label: "Prestige", description: "Thin typography, high letter-spacing, condensed billing — festival aesthetic" },
  commercial: { label: "Commercial", description: "Bold typography, labeled billing sections — mainstream appeal" },
  "cinematic-dark": { label: "Cinematic Dark", description: "Balanced hierarchy, amber accents, standard billing — default theatrical" },
  "cinematic-light": { label: "Cinematic Light", description: "Lighter gradient, same structure — for bright key art" },
  minimal: { label: "Minimal", description: "Elegant, condensed, maximum negative space — auteur style" },
};

const LAYOUT_CONFIGS: Record<string, LayoutConfig> = {
  "classic-theatrical": {
    titleZoneY: 0.72,
    gradientCoverage: 0.45,
    gradientMaxAlpha: 0.92,
    titleTracking: 0.10,
    showAccentLine: false,
    billingCondensed: false,
    titleWeight: 700,
  },
  "prestige-awards": {
    titleZoneY: 0.76,
    gradientCoverage: 0.50,
    gradientMaxAlpha: 0.95,
    titleTracking: 0.20,
    showAccentLine: false,
    billingCondensed: true,
    titleWeight: 300,
  },
  prestige: {
    titleZoneY: 0.80,
    gradientCoverage: 0.55,
    gradientMaxAlpha: 0.97,
    titleTracking: 0.25,
    showAccentLine: false,
    billingCondensed: true,
    titleWeight: 300,
  },
  commercial: {
    titleZoneY: 0.76,
    gradientCoverage: 0.50,
    gradientMaxAlpha: 0.95,
    titleTracking: 0.08,
    showAccentLine: true,
    billingCondensed: false,
    titleWeight: 800,
  },
  "cinematic-dark": {
    titleZoneY: 0.78,
    gradientCoverage: 0.50,
    gradientMaxAlpha: 0.95,
    titleTracking: 0.12,
    showAccentLine: true,
    billingCondensed: false,
    titleWeight: 700,
  },
  "cinematic-light": {
    titleZoneY: 0.78,
    gradientCoverage: 0.50,
    gradientMaxAlpha: 0.90,
    titleTracking: 0.12,
    showAccentLine: true,
    billingCondensed: false,
    titleWeight: 700,
  },
  minimal: {
    titleZoneY: 0.82,
    gradientCoverage: 0.45,
    gradientMaxAlpha: 0.92,
    titleTracking: 0.30,
    showAccentLine: false,
    billingCondensed: true,
    titleWeight: 300,
  },
};

// ── Title Position Resolver ──────────────────────────────────────────────────

function resolveTitlePosition(
  positionMode: TitlePositionMode,
  dims: { w: number; h: number },
  cfg: LayoutConfig,
): { titleY: number; textAlign: CanvasTextAlign; titleX: number } {
  switch (positionMode) {
    case "lower_third":
      return { titleY: dims.h * 0.84, textAlign: "center", titleX: dims.w / 2 };
    case "lower_center":
      return { titleY: dims.h * 0.80, textAlign: "center", titleX: dims.w / 2 };
    case "lower_left":
      return { titleY: dims.h * 0.80, textAlign: "left", titleX: dims.w * 0.08 };
    case "center":
    default:
      return { titleY: dims.h * cfg.titleZoneY, textAlign: "center", titleX: dims.w / 2 };
  }
}

// ── Apply Title Case ─────────────────────────────────────────────────────────

function applyTitleCase(text: string, mode: TitleCaseMode): string {
  switch (mode) {
    case "uppercase":
      return text.toUpperCase();
    case "small_caps":
      return text.toUpperCase(); // rendered smaller; visual distinction via font size
    case "mixed":
    default:
      return text;
  }
}

// ── Deterministic Layout Engine ──────────────────────────────────────────────

function applyLayout(
  ctx: CanvasRenderingContext2D,
  dims: { w: number; h: number },
  title: string,
  tagline?: string,
  variant: string = "cinematic-dark",
  logoImg?: HTMLImageElement | null,
  companyName?: string | null,
  credits?: PosterCreditsData,
  titleStyle?: TitleStyleConfig,
) {
  const { w, h } = dims;
  const cfg = LAYOUT_CONFIGS[variant] || LAYOUT_CONFIGS["cinematic-dark"];
  const layoutVariant = variant as PosterLayoutVariant;

  // Resolve typography mode
  const typoMode = titleStyle?.typographyMode || TEMPLATE_TYPOGRAPHY_DEFAULTS[layoutVariant] || "classic_theatrical_serif";
  const typo = TYPOGRAPHY_CONFIGS[typoMode];

  // Resolve effective values with overrides
  const effectiveCase = titleStyle?.caseMode || typo.defaultCase;
  const effectiveColor = titleStyle?.colorHex || TEMPLATE_COLOR_HINTS[layoutVariant] || typo.defaultColor;
  const effectiveOpacity = titleStyle?.opacity ?? typo.defaultOpacity;
  const effectiveWeight = titleStyle?.weightOverride ?? typo.weight;
  const effectiveTracking = titleStyle?.trackingOverride ?? typo.tracking;
  const positionMode = titleStyle?.positionMode || "center";
  const enableDepth = titleStyle?.enableDepth ?? false;

  // ── Bottom gradient overlay ──
  const gradientHeight = h * cfg.gradientCoverage;
  const grad = ctx.createLinearGradient(0, h - gradientHeight, 0, h);
  grad.addColorStop(0, "rgba(12, 13, 16, 0)");
  grad.addColorStop(0.25, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.3})`);
  grad.addColorStop(0.5, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.65})`);
  grad.addColorStop(0.75, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.85})`);
  grad.addColorStop(1, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - gradientHeight, w, gradientHeight);

  // ── Solid strip at bottom for billing legibility ──
  const stripH = h * 0.12;
  ctx.fillStyle = `rgba(12, 13, 16, ${Math.min(cfg.gradientMaxAlpha + 0.02, 1)})`;
  ctx.fillRect(0, h - stripH, w, stripH);

  // ── Top subtle vignette ──
  const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.12);
  topGrad.addColorStop(0, "rgba(12, 13, 16, 0.35)");
  topGrad.addColorStop(1, "rgba(12, 13, 16, 0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h * 0.12);

  ctx.textBaseline = "alphabetic";

  // ── Resolve title position ──
  const pos = resolveTitlePosition(positionMode, dims, cfg);
  ctx.textAlign = pos.textAlign;

  // ── Calculate title font size ──
  const titleFontSize = calculateTitleFontSize(title, w, cfg, typo.sizeScale, effectiveCase === "small_caps");
  const fontSpec = `${effectiveWeight} ${titleFontSize}px ${typo.fontFamily}`;
  const displayTitle = applyTitleCase(title, effectiveCase);

  const maxTextWidth = pos.textAlign === "left" ? w * 0.75 : w * 0.82;
  const lines = wrapText(ctx, displayTitle, maxTextWidth, fontSpec);
  const lineHeight = titleFontSize * 1.15;
  const totalTitleHeight = lines.length * lineHeight;
  const startY = pos.titleY - totalTitleHeight / 2;

  // ── Accent line (only for templates that use it) ──
  if (cfg.showAccentLine) {
    const accentLineY = startY - 14;
    const accentLineW = Math.min(60, w * 0.075);
    ctx.strokeStyle = BRAND.amber;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.textAlign = "center";
    ctx.beginPath();
    ctx.moveTo(w / 2 - accentLineW / 2, accentLineY);
    ctx.lineTo(w / 2 + accentLineW / 2, accentLineY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = pos.textAlign;
  }

  // ── Title rendering ──
  // Depth / emboss layer (subtle)
  if (enableDepth) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.font = fontSpec;
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight + titleFontSize;
      drawTrackedText(ctx, line, pos.titleX, y + 2, effectiveTracking * titleFontSize, pos.textAlign);
    });
    ctx.restore();
  }

  // Main title
  ctx.shadowColor = `rgba(0, 0, 0, ${typo.shadowAlpha})`;
  ctx.shadowBlur = typo.shadowBlur;
  ctx.shadowOffsetY = 2;
  ctx.shadowOffsetX = 0;

  ctx.fillStyle = effectiveColor;
  ctx.globalAlpha = effectiveOpacity;
  ctx.font = fontSpec;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight + titleFontSize;
    if (effectiveTracking > 0.08) {
      drawTrackedText(ctx, line, pos.titleX, y, effectiveTracking * titleFontSize, pos.textAlign);
    } else {
      ctx.fillText(line, pos.titleX, y);
    }
  });

  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Tagline ──
  ctx.textAlign = "center";
  let nextY = startY + lines.length * lineHeight + titleFontSize + 16;
  if (tagline) {
    const tagSize = Math.max(10, Math.round(titleFontSize * 0.26));
    ctx.font = `400 ${tagSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amberLight;
    ctx.globalAlpha = 0.85;
    drawTrackedText(ctx, tagline.toUpperCase(), w / 2, nextY, tagSize * 0.15, "center");
    ctx.globalAlpha = 1;
    nextY += tagSize + 14;
  }

  // ── Billing Block ──
  const hasCredits = credits && (
    (credits.writtenBy && credits.writtenBy.length > 0) ||
    (credits.producedBy && credits.producedBy.length > 0)
  );

  if (hasCredits) {
    const billingStartY = h - stripH + 16;
    let billingY = billingStartY;

    if (cfg.billingCondensed) {
      billingY = renderCondensedBilling(ctx, w, billingY, credits);
    } else {
      billingY = renderStandardBilling(ctx, w, billingY, credits);
    }

    const microSize = Math.max(7, Math.round(w * 0.009));
    if (credits.createdByCredit) {
      ctx.font = `400 ${microSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.billingGray;
      ctx.globalAlpha = 0.55;
      ctx.fillText(credits.createdByCredit.toUpperCase(), w / 2, billingY);
      ctx.globalAlpha = 1;
      billingY += microSize + 4;
    }
    if (credits.basedOnCredit) {
      ctx.font = `400 ${microSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.billingGray;
      ctx.globalAlpha = 0.55;
      ctx.fillText(credits.basedOnCredit.toUpperCase(), w / 2, billingY);
      ctx.globalAlpha = 1;
    }
  }

  // ── Bottom branding ──
  const footerY = h - 10;
  if (logoImg && logoImg.naturalWidth > 0) {
    const maxLogoH = Math.max(12, Math.round(h * 0.025));
    const aspect = logoImg.naturalWidth / logoImg.naturalHeight;
    const lh = maxLogoH;
    const lw = lh * aspect;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(logoImg, w / 2 - lw / 2, footerY - lh + 2, lw, lh);
    ctx.globalAlpha = 1;
  } else if (companyName) {
    const compSize = Math.max(8, Math.round(w * 0.012));
    ctx.font = `500 ${compSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amber;
    ctx.globalAlpha = 0.45;
    drawTrackedText(ctx, companyName.toUpperCase(), w / 2, footerY, compSize * 0.25, "center");
    ctx.globalAlpha = 1;
  }
}

// ── Standard billing block ───────────────────────────────────────────────────

function renderStandardBilling(
  ctx: CanvasRenderingContext2D,
  w: number,
  startY: number,
  credits: PosterCreditsData,
): number {
  let y = startY;
  const titleX = w / 2;
  const creditFontSize = Math.max(9, Math.round(w * 0.013));
  const labelFontSize = Math.max(7, Math.round(w * 0.008));

  ctx.textAlign = "center";

  const sepW = w * 0.35;
  ctx.strokeStyle = BRAND.amberDim;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(titleX - sepW / 2, y);
  ctx.lineTo(titleX + sepW / 2, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  y += 12;

  if (credits.writtenBy && credits.writtenBy.length > 0) {
    ctx.font = `400 ${labelFontSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.billingGray;
    ctx.globalAlpha = 0.6;
    ctx.fillText("WRITTEN BY", titleX, y);
    y += labelFontSize + 3;

    ctx.font = `500 ${creditFontSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.silver;
    ctx.globalAlpha = 0.85;
    ctx.fillText(credits.writtenBy.join("  ·  ").toUpperCase(), titleX, y);
    ctx.globalAlpha = 1;
    y += creditFontSize + 8;
  }

  if (credits.producedBy && credits.producedBy.length > 0) {
    ctx.font = `400 ${labelFontSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.billingGray;
    ctx.globalAlpha = 0.6;
    ctx.fillText("PRODUCED BY", titleX, y);
    y += labelFontSize + 3;

    ctx.font = `500 ${creditFontSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.silver;
    ctx.globalAlpha = 0.85;
    const producerText = credits.producedBy.join("  ·  ").toUpperCase();
    const prodLines = wrapText(ctx, producerText, w * 0.7, ctx.font);
    prodLines.forEach((line) => {
      ctx.fillText(line, titleX, y);
      y += creditFontSize + 2;
    });
    ctx.globalAlpha = 1;
    y += 4;
  }

  return y;
}

// ── Condensed billing block ──────────────────────────────────────────────────

function renderCondensedBilling(
  ctx: CanvasRenderingContext2D,
  w: number,
  startY: number,
  credits: PosterCreditsData,
): number {
  const titleX = w / 2;
  let y = startY;
  ctx.textAlign = "center";

  const parts: string[] = [];

  if (credits.writtenBy && credits.writtenBy.length > 0) {
    parts.push(`WRITTEN BY  ${credits.writtenBy.join("  ").toUpperCase()}`);
  }
  if (credits.producedBy && credits.producedBy.length > 0) {
    parts.push(`PRODUCED BY  ${credits.producedBy.join("  ").toUpperCase()}`);
  }

  if (parts.length === 0) return y;

  const sepW = w * 0.3;
  ctx.strokeStyle = BRAND.amberDim;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(titleX - sepW / 2, y);
  ctx.lineTo(titleX + sepW / 2, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  y += 10;

  const billingFontSize = Math.max(7, Math.round(w * 0.0095));

  for (const part of parts) {
    ctx.font = `400 ${billingFontSize}px "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.creditGray;
    ctx.globalAlpha = 0.7;

    const billingLines = wrapText(ctx, part, w * 0.7, ctx.font);
    for (const line of billingLines) {
      drawTrackedText(ctx, line, titleX, y, billingFontSize * 0.15, "center");
      y += billingFontSize + 2;
    }
    y += 2;
  }

  ctx.globalAlpha = 1;
  return y;
}

// ── Typography Helpers ───────────────────────────────────────────────────────

function calculateTitleFontSize(
  title: string,
  canvasWidth: number,
  cfg: LayoutConfig,
  sizeScale: number = 1.0,
  isSmallCaps: boolean = false,
): number {
  const charCount = title.length;
  const baseSize = canvasWidth * 0.08;
  let size: number;
  if (charCount <= 8) size = baseSize * 1.2;
  else if (charCount <= 15) size = baseSize;
  else if (charCount <= 25) size = baseSize * 0.85;
  else if (charCount <= 40) size = baseSize * 0.7;
  else size = baseSize * 0.55;

  size *= sizeScale;

  // Small caps gets slightly larger base to compensate
  if (isSmallCaps) {
    size *= 0.85;
  }

  return size;
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  y: number,
  spacing: number,
  align: CanvasTextAlign = "center",
) {
  const chars = text.split("");
  let totalWidth = 0;
  for (const ch of chars) {
    totalWidth += ctx.measureText(ch).width + spacing;
  }
  totalWidth -= spacing;

  let x: number;
  if (align === "left") {
    x = anchorX;
  } else if (align === "right") {
    x = anchorX - totalWidth;
  } else {
    x = anchorX - totalWidth / 2;
  }

  for (const ch of chars) {
    const charW = ctx.measureText(ch).width;
    ctx.fillText(ch, x + charW / 2, y);
    x += charW + spacing;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font?: string): string[] {
  if (font) ctx.font = font;
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.slice(0, 3);
}

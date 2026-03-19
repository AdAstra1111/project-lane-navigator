/**
 * PosterCompositor — Deterministic cinematic poster layout engine.
 * Takes key art + structured credits → renders a branded poster with title + billing block.
 * All text is deterministic — NO hallucinated names.
 *
 * Layout system:
 *   Upper 70%  — visual key art
 *   Mid zone   — large title (centered)
 *   Lower zone — credits + billing block
 *   Bottom bar — company branding
 */
import { useRef, useEffect, useState } from "react";

export interface PosterCreditsData {
  writtenBy?: string[];
  producedBy?: string[];
  createdByCredit?: string | null;
  basedOnCredit?: string | null;
}

export type PosterLayoutVariant = "classic-theatrical" | "prestige-awards" | "prestige" | "commercial" | "cinematic-dark" | "cinematic-light" | "minimal";

interface PosterCompositorProps {
  keyArtUrl: string;
  title: string;
  tagline?: string;
  companyLogoUrl?: string | null;
  companyName?: string | null;
  credits?: PosterCreditsData;
  aspectRatio?: "2:3" | "1:1" | "16:9";
  layoutVariant?: PosterLayoutVariant;
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
  silver: "#B8B5AE",
  creditGray: "#8A877F",
  billingGray: "#6E6B64",
};

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  "2:3": { w: 800, h: 1200 },
  "1:1": { w: 1000, h: 1000 },
  "16:9": { w: 1280, h: 720 },
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

      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null, credits);
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
      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null, credits);
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
  }, [keyArtUrl, title, tagline, aspectRatio, layoutVariant, onRender, companyLogoUrl, companyName, credits]);

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
  /** Where the title baseline sits (as fraction of canvas height) */
  titleZoneY: number;
  /** Gradient coverage from bottom (as fraction) */
  gradientCoverage: number;
  /** Gradient darkness at bottom (0-1) */
  gradientMaxAlpha: number;
  /** Title tracking (letter-spacing relative to font size) */
  titleTracking: number;
  /** Whether to show the amber accent line */
  showAccentLine: boolean;
  /** Billing block condensed mode */
  billingCondensed: boolean;
  /** Title font weight */
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
) {
  const { w, h } = dims;
  const cfg = LAYOUT_CONFIGS[variant] || LAYOUT_CONFIGS["cinematic-dark"];

  // ── Bottom gradient overlay — the foundation of the title zone ──
  const gradientHeight = h * cfg.gradientCoverage;
  const grad = ctx.createLinearGradient(0, h - gradientHeight, 0, h);
  grad.addColorStop(0, "rgba(12, 13, 16, 0)");
  grad.addColorStop(0.25, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.3})`);
  grad.addColorStop(0.5, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.65})`);
  grad.addColorStop(0.75, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha * 0.85})`);
  grad.addColorStop(1, `rgba(12, 13, 16, ${cfg.gradientMaxAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - gradientHeight, w, gradientHeight);

  // ── Solid black strip at very bottom for billing block legibility ──
  const stripH = h * 0.12;
  ctx.fillStyle = `rgba(12, 13, 16, ${Math.min(cfg.gradientMaxAlpha + 0.02, 1)})`;
  ctx.fillRect(0, h - stripH, w, stripH);

  // ── Top subtle vignette ──
  const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.12);
  topGrad.addColorStop(0, "rgba(12, 13, 16, 0.35)");
  topGrad.addColorStop(1, "rgba(12, 13, 16, 0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h * 0.12);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ── Amber accent line above title ──
  const titleFontSize = calculateTitleFontSize(title, w, cfg);
  const titleY = h * cfg.titleZoneY;

  const lines = wrapText(ctx, title.toUpperCase(), w * 0.82, `${cfg.titleWeight} ${titleFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`);
  const lineHeight = titleFontSize * 1.12;
  const totalTitleHeight = lines.length * lineHeight;
  const startY = titleY - totalTitleHeight / 2;
  const titleX = w / 2;

  if (cfg.showAccentLine) {
    const accentLineY = startY - 14;
    const accentLineW = Math.min(60, w * 0.075);
    ctx.strokeStyle = BRAND.amber;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(titleX - accentLineW / 2, accentLineY);
    ctx.lineTo(titleX + accentLineW / 2, accentLineY);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Title treatment ──
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = BRAND.white;
  ctx.font = `${cfg.titleWeight} ${titleFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  // Apply letter-spacing via manual character placement
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight + titleFontSize;
    if (cfg.titleTracking > 0.15) {
      drawTrackedText(ctx, line, titleX, y, cfg.titleTracking * titleFontSize);
    } else {
      ctx.fillText(line, titleX, y);
    }
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Tagline ──
  let nextY = startY + lines.length * lineHeight + titleFontSize + 16;
  if (tagline) {
    const tagSize = Math.max(10, Math.round(titleFontSize * 0.26));
    ctx.font = `400 ${tagSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amberLight;
    ctx.globalAlpha = 0.85;
    drawTrackedText(ctx, tagline.toUpperCase(), titleX, nextY, tagSize * 0.15);
    ctx.globalAlpha = 1;
    nextY += tagSize + 14;
  }

  // ── Billing Block (structured credits) ──
  const hasCredits = credits && (
    (credits.writtenBy && credits.writtenBy.length > 0) ||
    (credits.producedBy && credits.producedBy.length > 0)
  );

  if (hasCredits) {
    // Position billing block in the solid bottom zone
    const billingStartY = h - stripH + 16;
    let billingY = billingStartY;

    if (cfg.billingCondensed) {
      // ── Condensed billing: single-line format like real theatrical posters ──
      billingY = renderCondensedBilling(ctx, w, billingY, credits);
    } else {
      // ── Standard billing: labeled sections ──
      billingY = renderStandardBilling(ctx, w, billingY, credits);
    }

    // Created by / Based on (if present)
    const microSize = Math.max(7, Math.round(w * 0.009));
    if (credits.createdByCredit) {
      ctx.font = `400 ${microSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.billingGray;
      ctx.globalAlpha = 0.55;
      ctx.fillText(credits.createdByCredit.toUpperCase(), w / 2, billingY);
      ctx.globalAlpha = 1;
      billingY += microSize + 4;
    }
    if (credits.basedOnCredit) {
      ctx.font = `400 ${microSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.billingGray;
      ctx.globalAlpha = 0.55;
      ctx.fillText(credits.basedOnCredit.toUpperCase(), w / 2, billingY);
      ctx.globalAlpha = 1;
    }
  }

  // ── Bottom branding: company logo or name ──
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
    ctx.font = `500 ${compSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amber;
    ctx.globalAlpha = 0.45;
    drawTrackedText(ctx, companyName.toUpperCase(), w / 2, footerY, compSize * 0.25);
    ctx.globalAlpha = 1;
  }
}

// ── Standard billing block (labeled rows) ────────────────────────────────────

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

  // Thin separator
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

  // Written by
  if (credits.writtenBy && credits.writtenBy.length > 0) {
    ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.billingGray;
    ctx.globalAlpha = 0.6;
    ctx.fillText("WRITTEN BY", titleX, y);
    y += labelFontSize + 3;

    ctx.font = `500 ${creditFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.silver;
    ctx.globalAlpha = 0.85;
    ctx.fillText(credits.writtenBy.join("  ·  ").toUpperCase(), titleX, y);
    ctx.globalAlpha = 1;
    y += creditFontSize + 8;
  }

  // Produced by
  if (credits.producedBy && credits.producedBy.length > 0) {
    ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.billingGray;
    ctx.globalAlpha = 0.6;
    ctx.fillText("PRODUCED BY", titleX, y);
    y += labelFontSize + 3;

    ctx.font = `500 ${creditFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
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

// ── Condensed billing block (prestige / minimal — single dense block) ────────

function renderCondensedBilling(
  ctx: CanvasRenderingContext2D,
  w: number,
  startY: number,
  credits: PosterCreditsData,
): number {
  const titleX = w / 2;
  let y = startY;

  // Build a single condensed billing string like real theatrical posters:
  // WRITTEN BY SEBASTIAN STREET   PRODUCED BY SEBASTIAN STREET  MERLIN MERTON  ALEX CHANG  GREER ELLISON
  const parts: string[] = [];

  if (credits.writtenBy && credits.writtenBy.length > 0) {
    parts.push(`WRITTEN BY  ${credits.writtenBy.join("  ").toUpperCase()}`);
  }
  if (credits.producedBy && credits.producedBy.length > 0) {
    parts.push(`PRODUCED BY  ${credits.producedBy.join("  ").toUpperCase()}`);
  }

  if (parts.length === 0) return y;

  // Thin separator
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

  // Render each credit line in condensed format
  for (const part of parts) {
    ctx.font = `400 ${billingFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.creditGray;
    ctx.globalAlpha = 0.7;

    const billingLines = wrapText(ctx, part, w * 0.7, ctx.font);
    for (const line of billingLines) {
      drawTrackedText(ctx, line, titleX, y, billingFontSize * 0.15);
      y += billingFontSize + 2;
    }
    y += 2;
  }

  ctx.globalAlpha = 1;
  return y;
}

// ── Typography Helpers ───────────────────────────────────────────────────────

function calculateTitleFontSize(title: string, canvasWidth: number, cfg: LayoutConfig): number {
  const charCount = title.length;
  const baseSize = canvasWidth * 0.08;
  let size: number;
  if (charCount <= 8) size = baseSize * 1.2;
  else if (charCount <= 15) size = baseSize;
  else if (charCount <= 25) size = baseSize * 0.85;
  else if (charCount <= 40) size = baseSize * 0.7;
  else size = baseSize * 0.55;

  // Prestige / minimal variants use slightly smaller, more elegant titles
  if (cfg.titleWeight <= 300) {
    size *= 0.92;
  }
  return size;
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  spacing: number,
) {
  // Measure total width with spacing
  const chars = text.split("");
  let totalWidth = 0;
  for (const ch of chars) {
    totalWidth += ctx.measureText(ch).width + spacing;
  }
  totalWidth -= spacing; // no trailing space

  let x = centerX - totalWidth / 2;
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

/**
 * PosterCompositor — Deterministic cinematic poster layout engine.
 * Takes key art + structured credits → renders a branded poster with title + billing block.
 * All text is deterministic — NO hallucinated names.
 */
import { useRef, useEffect, useState } from "react";

export interface PosterCreditsData {
  writtenBy?: string[];
  producedBy?: string[];
  createdByCredit?: string | null;
  basedOnCredit?: string | null;
}

interface PosterCompositorProps {
  keyArtUrl: string;
  title: string;
  tagline?: string;
  companyLogoUrl?: string | null;
  companyName?: string | null;
  credits?: PosterCreditsData;
  aspectRatio?: "2:3" | "1:1" | "16:9";
  layoutVariant?: "cinematic-dark" | "cinematic-light" | "minimal";
  width?: number;
  onRender?: (canvas: HTMLCanvasElement) => void;
  className?: string;
}

// Brand colors
const BRAND = {
  dark: "#141519",
  amber: "#C4913A",
  amberLight: "#D4A84E",
  white: "#F5F2ED",
  silver: "#B8B5AE",
  creditGray: "#9A978F",
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

  // ── Bottom gradient overlay for text legibility ──
  const gradientHeight = h * 0.5;
  const grad = ctx.createLinearGradient(0, h - gradientHeight, 0, h);
  grad.addColorStop(0, "rgba(20, 21, 25, 0)");
  grad.addColorStop(0.3, "rgba(20, 21, 25, 0.5)");
  grad.addColorStop(0.6, "rgba(20, 21, 25, 0.8)");
  grad.addColorStop(1, "rgba(20, 21, 25, 0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - gradientHeight, w, gradientHeight);

  // ── Top subtle vignette ──
  const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.15);
  topGrad.addColorStop(0, "rgba(20, 21, 25, 0.4)");
  topGrad.addColorStop(1, "rgba(20, 21, 25, 0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h * 0.15);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ── Title treatment ──
  const titleFontSize = calculateTitleFontSize(title, w);
  const titleY = h * 0.78;
  const titleX = w / 2;

  // Title shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = BRAND.white;
  ctx.font = `700 ${titleFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  const lines = wrapText(ctx, title.toUpperCase(), w * 0.8);
  const lineHeight = titleFontSize * 1.15;
  const totalTitleHeight = lines.length * lineHeight;
  const startY = titleY - totalTitleHeight / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, titleX, startY + i * lineHeight + titleFontSize);
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Amber accent line above title ──
  const accentLineY = startY - 16;
  const accentLineW = Math.min(80, w * 0.1);
  ctx.strokeStyle = BRAND.amber;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(titleX - accentLineW / 2, accentLineY);
  ctx.lineTo(titleX + accentLineW / 2, accentLineY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Tagline ──
  let nextY = startY + lines.length * lineHeight + titleFontSize + 20;
  if (tagline) {
    ctx.font = `400 ${Math.round(titleFontSize * 0.3)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amberLight;
    ctx.globalAlpha = 0.9;
    ctx.fillText(tagline.toUpperCase(), titleX, nextY);
    ctx.globalAlpha = 1;
    nextY += Math.round(titleFontSize * 0.3) + 16;
  }

  // ── Billing block (structured credits) ──
  const hasCredits = credits && (
    (credits.writtenBy && credits.writtenBy.length > 0) ||
    (credits.producedBy && credits.producedBy.length > 0)
  );

  if (hasCredits) {
    // Thin separator line
    const sepW = w * 0.5;
    ctx.strokeStyle = BRAND.amber;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(titleX - sepW / 2, nextY);
    ctx.lineTo(titleX + sepW / 2, nextY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    nextY += 14;

    const creditFontSize = Math.max(9, Math.round(w * 0.014));
    const labelFontSize = Math.max(7, Math.round(w * 0.009));

    // Written by
    if (credits.writtenBy && credits.writtenBy.length > 0) {
      ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.creditGray;
      ctx.globalAlpha = 0.7;
      ctx.fillText("WRITTEN BY", titleX, nextY);
      nextY += labelFontSize + 3;

      ctx.font = `500 ${creditFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.silver;
      ctx.globalAlpha = 0.9;
      ctx.fillText(credits.writtenBy.join("  ·  ").toUpperCase(), titleX, nextY);
      ctx.globalAlpha = 1;
      nextY += creditFontSize + 10;
    }

    // Produced by
    if (credits.producedBy && credits.producedBy.length > 0) {
      ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.creditGray;
      ctx.globalAlpha = 0.7;
      ctx.fillText("PRODUCED BY", titleX, nextY);
      nextY += labelFontSize + 3;

      ctx.font = `500 ${creditFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.silver;
      ctx.globalAlpha = 0.9;
      // Wrap long producer lists
      const producerText = credits.producedBy.join("  ·  ").toUpperCase();
      const prodLines = wrapText(ctx, producerText, w * 0.75);
      prodLines.forEach((line) => {
        ctx.fillText(line, titleX, nextY);
        nextY += creditFontSize + 3;
      });
      ctx.globalAlpha = 1;
      nextY += 6;
    }

    // Created by / Based on
    if (credits.createdByCredit) {
      ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.creditGray;
      ctx.globalAlpha = 0.6;
      ctx.fillText(credits.createdByCredit.toUpperCase(), titleX, nextY);
      ctx.globalAlpha = 1;
      nextY += labelFontSize + 6;
    }
    if (credits.basedOnCredit) {
      ctx.font = `400 ${labelFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = BRAND.creditGray;
      ctx.globalAlpha = 0.6;
      ctx.fillText(credits.basedOnCredit.toUpperCase(), titleX, nextY);
      ctx.globalAlpha = 1;
      nextY += labelFontSize + 6;
    }
  }

  // ── Bottom branding: company logo or name ──
  const footerY = h - 18;
  if (logoImg && logoImg.naturalWidth > 0) {
    const maxLogoH = Math.max(14, Math.round(h * 0.03));
    const aspect = logoImg.naturalWidth / logoImg.naturalHeight;
    const lh = maxLogoH;
    const lw = lh * aspect;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(logoImg, w / 2 - lw / 2, footerY - lh + 4, lw, lh);
    ctx.globalAlpha = 1;
  } else if (companyName) {
    ctx.font = `500 ${Math.max(9, Math.round(w * 0.013))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amber;
    ctx.globalAlpha = 0.5;
    ctx.fillText(companyName.toUpperCase(), w / 2, footerY);
    ctx.globalAlpha = 1;
  }
}

function calculateTitleFontSize(title: string, canvasWidth: number): number {
  const charCount = title.length;
  const baseSize = canvasWidth * 0.08;
  if (charCount <= 8) return baseSize * 1.2;
  if (charCount <= 15) return baseSize;
  if (charCount <= 25) return baseSize * 0.85;
  if (charCount <= 40) return baseSize * 0.7;
  return baseSize * 0.55;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

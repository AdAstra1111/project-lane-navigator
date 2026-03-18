/**
 * PosterCompositor — Deterministic cinematic poster layout engine.
 * Takes key art + project data → renders a branded poster with title treatment.
 * This is a client-side preview compositor; the layout rules are deterministic.
 */
import { useRef, useEffect, useState } from "react";

interface PosterCompositorProps {
  keyArtUrl: string;
  title: string;
  tagline?: string;
  companyLogoUrl?: string | null;
  companyName?: string | null;
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
  overlay: "rgba(20, 21, 25, 0.75)",
  overlayLight: "rgba(20, 21, 25, 0.45)",
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

    // Load key art image
    const img = new Image();
    img.crossOrigin = "anonymous";

    // Optionally load company logo
    let logoImg: HTMLImageElement | null = null;
    let logoLoaded = false;
    let keyArtLoaded = false;

    const tryRender = () => {
      if (!keyArtLoaded) return;
      // Draw key art
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

      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null);
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
      applyLayout(ctx, dims, title, tagline, layoutVariant, logoImg, companyName || null);
      setLoaded(true);
    };
    img.src = keyArtUrl;

    if (companyLogoUrl) {
      logoImg = new Image();
      logoImg.crossOrigin = "anonymous";
      logoImg.onload = () => {
        logoLoaded = true;
        if (keyArtLoaded) tryRender();
      };
      logoImg.onerror = () => {
        logoImg = null;
        logoLoaded = true;
        if (keyArtLoaded) tryRender();
      };
      logoImg.src = companyLogoUrl;
    }
  }, [keyArtUrl, title, tagline, aspectRatio, layoutVariant, onRender, companyLogoUrl, companyName]);

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
) {
  const { w, h } = dims;

  // ── Bottom gradient overlay for text legibility ──
  const gradientHeight = h * 0.45;
  const grad = ctx.createLinearGradient(0, h - gradientHeight, 0, h);
  grad.addColorStop(0, "rgba(20, 21, 25, 0)");
  grad.addColorStop(0.4, "rgba(20, 21, 25, 0.55)");
  grad.addColorStop(1, "rgba(20, 21, 25, 0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - gradientHeight, w, gradientHeight);

  // ── Top subtle vignette ──
  const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.15);
  topGrad.addColorStop(0, "rgba(20, 21, 25, 0.4)");
  topGrad.addColorStop(1, "rgba(20, 21, 25, 0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h * 0.15);

  // ── Title treatment ──
  const titleFontSize = calculateTitleFontSize(title, w);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Title position: lower third
  const titleY = h * 0.82;
  const titleX = w / 2;

  // Title shadow for depth
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;

  // Draw title
  ctx.fillStyle = BRAND.white;
  ctx.font = `700 ${titleFontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  // Word-wrap title if needed
  const lines = wrapText(ctx, title.toUpperCase(), w * 0.8);
  const lineHeight = titleFontSize * 1.15;
  const totalTitleHeight = lines.length * lineHeight;
  const startY = titleY - totalTitleHeight / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, titleX, startY + i * lineHeight + titleFontSize);
  });

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── Tagline ──
  if (tagline) {
    const tagY = startY + lines.length * lineHeight + titleFontSize + 24;
    ctx.font = `400 ${Math.round(titleFontSize * 0.35)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = BRAND.amberLight;
    ctx.globalAlpha = 0.9;
    ctx.fillText(tagline.toUpperCase(), titleX, tagY);
    ctx.globalAlpha = 1;
  }

  // ── Subtle amber accent line above title ──
  const lineY = startY - 16;
  const lineW = Math.min(80, w * 0.1);
  ctx.strokeStyle = BRAND.amber;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(titleX - lineW / 2, lineY);
  ctx.lineTo(titleX + lineW / 2, lineY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Bottom micro-label ──
  const footerY = h - 20;
  ctx.font = `400 ${Math.max(9, Math.round(w * 0.012))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.fillStyle = BRAND.amber;
  ctx.globalAlpha = 0.4;
  ctx.fillText("DEVELOPED IN IFFY", titleX, footerY);
  ctx.globalAlpha = 1;
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

  // Max 3 lines for poster
  return lines.slice(0, 3);
}

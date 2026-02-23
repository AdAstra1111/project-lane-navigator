/**
 * Client-side trailer cut renderer using Canvas + MediaRecorder.
 * Draws timeline entries as image frames with text overlays.
 */
import type { TimelineEntry } from './types';

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_OPTIONS: RenderOptions = {
  width: 1280,
  height: 720,
  fps: 24,
};

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
  const barH = Math.max(60, h * 0.12);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, h - barH, w, barH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(18, barH * 0.4)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h - barH / 2, w - 40);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, role: string) {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e94560';
  ctx.font = `bold ${Math.max(24, h * 0.06)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(role.toUpperCase().replace(/_/g, ' '), w / 2, h / 2);
}

function drawTextCard(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(32, h * 0.08)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Word wrap
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w * 0.8) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineH = Math.max(40, h * 0.1);
  const startY = h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, startY + i * lineH));
}

export async function renderTrailerCut(
  timeline: TimelineEntry[],
  opts: Partial<RenderOptions> = {}
): Promise<Blob> {
  const { width, height, fps, onProgress } = { ...DEFAULT_OPTIONS, ...opts };

  if (!timeline || timeline.length === 0) {
    throw new Error('Cannot render: timeline is empty');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Preload images
  const imageCache: Record<string, HTMLImageElement> = {};
  const imageUrls = timeline.filter(t => t.clip_url && t.media_type === 'video').map(t => t.clip_url!);
  const uniqueUrls = [...new Set(imageUrls)];

  await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      try { imageCache[url] = await loadImage(url); } catch { /* skip */ }
    })
  );

  // Setup MediaRecorder — use captureStream(0) for manual frame capture
  const stream = canvas.captureStream(0);
  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mimeType = '';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
  }
  if (!mimeType) throw new Error('No supported video codec found');

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(100);

  const frameDuration = 1000 / fps;
  // Speed up rendering: use a shorter delay per frame (10ms vs real-time ~42ms)
  const renderDelay = Math.min(frameDuration, 10);

  const drawEntry = (entry: TimelineEntry) => {
    if (entry.text_overlay && entry.role === 'title_card') {
      drawTextCard(ctx, entry.text_overlay, width, height);
    } else if (entry.clip_url && imageCache[entry.clip_url]) {
      const img = imageCache[entry.clip_url];
      const scale = Math.min(width / img.width, height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
      if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
    } else {
      drawPlaceholder(ctx, width, height, entry.role);
      if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
    }
  };

  // Draw an initial frame to ensure stream has data
  drawEntry(timeline[0]);
  await new Promise((r) => setTimeout(r, 50));

  for (let tIdx = 0; tIdx < timeline.length; tIdx++) {
    const entry = timeline[tIdx];
    const frames = Math.max(1, Math.round(entry.duration_ms / frameDuration));

    for (let f = 0; f < frames; f++) {
      drawEntry(entry);
      // Yield to the event loop so MediaRecorder can capture the frame
      await new Promise((r) => setTimeout(r, renderDelay));
    }

    onProgress?.(tIdx + 1, timeline.length);
  }

  // Final flush — give recorder time to capture last frames
  await new Promise((r) => setTimeout(r, 200));

  recorder.stop();
  await recordingDone;

  const blob = new Blob(chunks, { type: 'video/webm' });
  if (blob.size < 100) {
    throw new Error('Render produced empty video. Try again or check browser compatibility.');
  }
  return blob;
}

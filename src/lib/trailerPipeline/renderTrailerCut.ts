/**
 * Client-side trailer cut renderer using Canvas + MediaRecorder.
 * Draws timeline entries as video/image frames with text overlays.
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

async function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const timeout = setTimeout(() => reject(new Error(`Video load timeout: ${url}`)), 30000);

    video.onloadeddata = () => {
      clearTimeout(timeout);
      resolve(video);
    };
    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to load video: ${url}`));
    };
    video.src = url;
    video.load();
  });
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
    || lower.includes('video') || lower.includes('/object/');
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

function drawMediaToCanvas(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  w: number,
  h: number
) {
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (srcW === 0 || srcH === 0) return;

  const scale = Math.min(w / srcW, h / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

type MediaAsset = { type: 'image'; el: HTMLImageElement } | { type: 'video'; el: HTMLVideoElement };

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

  // Preload all media assets (images AND videos)
  const mediaCache: Record<string, MediaAsset> = {};
  const urlsToLoad = timeline
    .filter(t => t.clip_url)
    .map(t => t.clip_url!)
    .filter((url, i, arr) => arr.indexOf(url) === i);

  await Promise.allSettled(
    urlsToLoad.map(async (url) => {
      try {
        if (isVideoUrl(url)) {
          const video = await loadVideo(url);
          mediaCache[url] = { type: 'video', el: video };
        } else {
          const img = await loadImage(url);
          mediaCache[url] = { type: 'image', el: img };
        }
      } catch {
        // Try the other type as fallback
        try {
          const img = await loadImage(url);
          mediaCache[url] = { type: 'image', el: img };
        } catch { /* skip — will show placeholder */ }
      }
    })
  );

  // Setup MediaRecorder
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

  // Draw initial frame
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  await new Promise((r) => setTimeout(r, 50));

  for (let tIdx = 0; tIdx < timeline.length; tIdx++) {
    const entry = timeline[tIdx];
    const totalFrames = Math.max(1, Math.round(entry.duration_ms / frameDuration));
    const asset = entry.clip_url ? mediaCache[entry.clip_url] : undefined;

    if (entry.text_overlay && entry.role === 'title_card') {
      // Text card — static frame
      for (let f = 0; f < totalFrames; f++) {
        drawTextCard(ctx, entry.text_overlay, width, height);
        await new Promise((r) => setTimeout(r, 10));
      }
    } else if (asset?.type === 'video') {
      // Video clip — seek through frames
      const video = asset.el;
      const videoDuration = video.duration || 1;
      const clipDurationS = entry.duration_ms / 1000;
      const playbackDuration = Math.min(clipDurationS, videoDuration);

      // Start playback from beginning
      video.currentTime = 0;
      await new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked);
      });

      for (let f = 0; f < totalFrames; f++) {
        // Seek to the proportional position in the video
        const t = (f / totalFrames) * playbackDuration;
        video.currentTime = Math.min(t, videoDuration - 0.01);

        // Wait for seek to complete
        await new Promise<void>((resolve) => {
          const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
          video.addEventListener('seeked', onSeeked);
          // Timeout fallback in case seeked doesn't fire
          setTimeout(resolve, 100);
        });

        drawMediaToCanvas(ctx, video, width, height);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await new Promise((r) => setTimeout(r, 10));
      }
    } else if (asset?.type === 'image') {
      // Image — static frame with overlay
      for (let f = 0; f < totalFrames; f++) {
        drawMediaToCanvas(ctx, asset.el, width, height);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await new Promise((r) => setTimeout(r, 10));
      }
    } else {
      // No media — placeholder
      for (let f = 0; f < totalFrames; f++) {
        drawPlaceholder(ctx, width, height, entry.role);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    onProgress?.(tIdx + 1, timeline.length);
  }

  // Final flush
  await new Promise((r) => setTimeout(r, 200));

  recorder.stop();
  await recordingDone;

  // Clean up videos
  for (const asset of Object.values(mediaCache)) {
    if (asset.type === 'video') {
      asset.el.src = '';
      asset.el.load();
    }
  }

  const blob = new Blob(chunks, { type: 'video/webm' });
  if (blob.size < 100) {
    throw new Error('Render produced empty video. Try again or check browser compatibility.');
  }
  return blob;
}

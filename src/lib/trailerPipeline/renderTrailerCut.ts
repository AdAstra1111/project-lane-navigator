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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(blob);
    let finished = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.src = '';
      video.load();
    };

    const done = (seconds: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cleanup();
      resolve(seconds);
    };

    const readDuration = () => {
      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        done(duration);
        return;
      }

      // WebM metadata can report Infinity until seeking to the end once.
      if (duration === Infinity) {
        const onSeeked = () => {
          const resolvedDuration = Number(video.duration);
          done(Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : 0);
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        try {
          video.currentTime = 1e10;
        } catch {
          done(0);
        }
      }
    };

    const timeout = setTimeout(() => done(0), 10000);

    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', readDuration, { once: true });
    video.addEventListener('durationchange', readDuration);
    video.onerror = () => done(0);
    video.src = objectUrl;
  });
}

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

  // Setup MediaRecorder — prefer manual frame control, fallback to timed stream
  let stream = canvas.captureStream(0);
  let videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  let canRequestFrame = !!videoTrack && typeof videoTrack.requestFrame === 'function';

  if (!canRequestFrame) {
    stream.getTracks().forEach((track) => track.stop());
    stream = canvas.captureStream(fps);
    videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    canRequestFrame = !!videoTrack && typeof videoTrack.requestFrame === 'function';
  }

  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mimeType = '';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
  }
  if (!mimeType) throw new Error('No supported video codec found');

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('MediaRecorder failed while encoding trailer'));
  });
  // Start in single-blob mode to improve duration metadata reliability.
  recorder.start();

  const frameDuration = 1000 / fps;
  const commitDelayMs = canRequestFrame ? 10 : Math.max(16, Math.round(frameDuration / 2));

  // Helper: commit current canvas to the video stream
  const commitFrame = async () => {
    if (canRequestFrame && videoTrack?.requestFrame) {
      videoTrack.requestFrame();
    }
    await sleep(commitDelayMs);
  };

  const waitForSeek = async (video: HTMLVideoElement, timeoutMs = 60) => {
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, timeoutMs);
      video.addEventListener('seeked', onSeeked, { once: true });
    });
  };

  // Draw initial frame
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  await commitFrame();

  for (let tIdx = 0; tIdx < timeline.length; tIdx++) {
    const entry = timeline[tIdx];
    const totalFrames = Math.max(1, Math.round(entry.duration_ms / frameDuration));
    const asset = entry.clip_url ? mediaCache[entry.clip_url] : undefined;

    if (entry.text_overlay && entry.role === 'title_card') {
      for (let f = 0; f < totalFrames; f++) {
        drawTextCard(ctx, entry.text_overlay, width, height);
        await commitFrame();
      }
    } else if (asset?.type === 'video') {
      const video = asset.el;
      const videoDuration = video.duration || 1;
      const clipDurationS = entry.duration_ms / 1000;
      const playbackDuration = Math.min(clipDurationS, videoDuration);

      video.currentTime = 0;
      await waitForSeek(video, 120);

      for (let f = 0; f < totalFrames; f++) {
        const t = (f / totalFrames) * playbackDuration;
        video.currentTime = Math.min(t, videoDuration - 0.01);

        await waitForSeek(video);

        drawMediaToCanvas(ctx, video, width, height);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await commitFrame();
      }
    } else if (asset?.type === 'image') {
      for (let f = 0; f < totalFrames; f++) {
        drawMediaToCanvas(ctx, asset.el, width, height);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await commitFrame();
      }
    } else {
      for (let f = 0; f < totalFrames; f++) {
        drawPlaceholder(ctx, width, height, entry.role);
        if (entry.text_overlay) drawTextOverlay(ctx, entry.text_overlay, width, height);
        await commitFrame();
      }
    }

    onProgress?.(tIdx + 1, timeline.length);
  }

  // Final flush — ensure last frames are captured and metadata gets sealed
  await commitFrame();
  await commitFrame();
  await sleep(Math.max(frameDuration, 40));

  recorder.stop();
  await recordingDone;
  stream.getTracks().forEach((track) => track.stop());

  // Clean up videos
  for (const asset of Object.values(mediaCache)) {
    if (asset.type === 'video') {
      asset.el.src = '';
      asset.el.load();
    }
  }

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  if (blob.size < 100) {
    throw new Error('Render produced empty video. Try again or check browser compatibility.');
  }

  const seconds = await probeVideoDuration(blob);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Render finished but video duration is invalid (0s). Please retry after refreshing the page.');
  }

  return blob;
}

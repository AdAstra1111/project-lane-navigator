/**
 * renderAnimatic — Client-side Canvas + MediaRecorder video renderer.
 * Produces a WebM blob from storyboard frame images.
 */

export interface AnimaticAsset {
  panel_id: string;
  unit_key: string;
  panel_index: number;
  frame_url: string | null;
  caption_text: string;
  duration_ms: number;
}

export interface AnimaticOptions {
  width?: number;
  height?: number;
  fps?: number;
  default_duration_ms?: number;
  lead_in_ms?: number;
  tail_out_ms?: number;
  caption?: boolean;
}

/**
 * Loads an image from URL, returns ImageBitmap or null on failure.
 */
async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Preloads images with concurrency limit.
 */
async function preloadImages(
  assets: AnimaticAsset[],
  concurrency = 4,
): Promise<Map<string, ImageBitmap | null>> {
  const result = new Map<string, ImageBitmap | null>();
  const queue = [...assets];

  async function worker() {
    while (queue.length > 0) {
      const asset = queue.shift()!;
      if (asset.frame_url) {
        result.set(asset.panel_id, await loadImage(asset.frame_url));
      } else {
        result.set(asset.panel_id, null);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, assets.length) }, () => worker());
  await Promise.all(workers);
  return result;
}

/**
 * Draws a single frame onto the canvas context.
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  img: ImageBitmap | null,
  captionText: string,
  showCaption: boolean,
) {
  // Black background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (img) {
    // Letterbox fit
    const imgAspect = img.width / img.height;
    const canvasAspect = width / height;
    let drawW: number, drawH: number, drawX: number, drawY: number;

    if (imgAspect > canvasAspect) {
      drawW = width;
      drawH = width / imgAspect;
      drawX = 0;
      drawY = (height - drawH) / 2;
    } else {
      drawH = height;
      drawW = height * imgAspect;
      drawX = (width - drawW) / 2;
      drawY = 0;
    }
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  } else {
    // Missing frame placeholder
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#666';
    ctx.font = `bold ${Math.round(height / 15)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MISSING FRAME', width / 2, height / 2);
  }

  // Caption overlay
  if (showCaption && captionText) {
    const lines = captionText.split('\n').filter(Boolean);
    const barHeight = Math.max(36, lines.length * 18 + 12);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, height - barHeight, width, barHeight);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    lines.forEach((line, i) => {
      ctx.font = i === 0 ? `bold 12px sans-serif` : `11px sans-serif`;
      ctx.fillText(line.slice(0, 100), 12, height - barHeight + 6 + i * 16);
    });
  }
}

/**
 * Renders an animatic video from assets using Canvas + MediaRecorder.
 * Returns a WebM Blob.
 */
export async function renderAnimatic(
  assets: AnimaticAsset[],
  options: AnimaticOptions,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<Blob> {
  const width = options.width || 1280;
  const height = options.height || 720;
  const fps = options.fps || 24;
  const showCaption = options.caption !== false;
  const leadInMs = options.lead_in_ms ?? 300;
  const tailOutMs = options.tail_out_ms ?? 500;
  const frameDurationMs = 1000 / fps;

  // Preload all images
  const imageMap = await preloadImages(assets);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Find supported mime type
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mimeType = 'video/webm';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) {
      mimeType = mt;
      break;
    }
  }

  // Setup MediaRecorder
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100); // collect data every 100ms

  const total = assets.length;

  // Lead-in: black frame
  const leadInFrames = Math.max(1, Math.round(leadInMs / frameDurationMs));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (let f = 0; f < leadInFrames; f++) {
    await new Promise(r => setTimeout(r, frameDurationMs));
  }

  // Render each panel
  for (let i = 0; i < assets.length; i++) {
    if (isCancelled?.()) break;

    const asset = assets[i];
    const img = imageMap.get(asset.panel_id) || null;
    const repeatCount = Math.max(1, Math.round(asset.duration_ms / frameDurationMs));

    drawFrame(ctx, width, height, img, asset.caption_text, showCaption);

    // Hold this frame for duration
    for (let f = 0; f < repeatCount; f++) {
      if (isCancelled?.()) break;
      // Redraw to ensure the recorder captures it
      if (f > 0 && f % fps === 0) {
        drawFrame(ctx, width, height, img, asset.caption_text, showCaption);
      }
      await new Promise(r => setTimeout(r, frameDurationMs));
    }

    onProgress?.(i + 1, total);
  }

  // Tail-out: black frame
  const tailOutFrames = Math.max(1, Math.round(tailOutMs / frameDurationMs));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (let f = 0; f < tailOutFrames; f++) {
    await new Promise(r => setTimeout(r, frameDurationMs));
  }

  recorder.stop();
  await recordingDone;

  return new Blob(chunks, { type: 'video/webm' });
}

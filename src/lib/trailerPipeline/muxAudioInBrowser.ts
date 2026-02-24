/**
 * In-browser audio muxing: combines a video-only WebM blob
 * with one or more audio files into a single WebM with audio.
 *
 * Uses Web Audio API + MediaRecorder to capture combined streams.
 */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MuxAudioOptions {
  /** Primary audio URL (e.g. music bed / mix master) */
  audioUrl: string;
  /** Optional VO audio URL to layer on top */
  voUrl?: string;
  /** Music gain in dB (default -10) */
  musicGainDb?: number;
  /** VO gain in dB (default 0) */
  voGainDb?: number;
  /** Progress callback */
  onProgress?: (pct: number) => void;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

async function fetchAudioBuffer(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuf);
  } catch (err) {
    console.warn('Failed to fetch/decode audio:', url, err);
    return null;
  }
}

/**
 * Mux a video-only WebM blob with audio tracks into a new WebM blob.
 * Plays back in real-time, capturing the combined output.
 */
export async function muxAudioInBrowser(
  videoBlob: Blob,
  options: MuxAudioOptions
): Promise<Blob> {
  const {
    audioUrl,
    voUrl,
    musicGainDb = -10,
    voGainDb = 0,
    onProgress,
  } = options;

  // Create video element from the blob
  const videoObjectUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true; // muted so it doesn't play through speakers
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoObjectUrl;

  // Wait for video to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Video load timeout during mux')), 15000);
    video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
    video.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load video for mux')); };
  });

  // Seek to fix duration for WebM
  if (!Number.isFinite(video.duration) || video.duration === Infinity) {
    video.currentTime = 1e10;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      setTimeout(resolve, 2000);
    });
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      setTimeout(resolve, 1000);
    });
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration <= 0) {
    URL.revokeObjectURL(videoObjectUrl);
    throw new Error('Cannot mux: video duration is 0');
  }

  // Set up audio context
  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  // Load audio files
  const [musicBuffer, voBuffer] = await Promise.all([
    fetchAudioBuffer(audioCtx, audioUrl),
    voUrl ? fetchAudioBuffer(audioCtx, voUrl) : Promise.resolve(null),
  ]);

  if (!musicBuffer && !voBuffer) {
    audioCtx.close();
    URL.revokeObjectURL(videoObjectUrl);
    throw new Error('No audio could be loaded for muxing');
  }

  // Capture video from canvas (we'll draw video frames to it)
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d')!;

  const videoStream = canvas.captureStream(0);
  const videoTrack = videoStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };

  // Combine video + audio streams
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  // Set up MediaRecorder
  const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  let mimeType = '';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
  }
  if (!mimeType) {
    audioCtx.close();
    URL.revokeObjectURL(videoObjectUrl);
    throw new Error('No supported video+audio codec found');
  }

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('MediaRecorder failed during audio mux'));
  });

  // Start recording
  recorder.start();

  // Schedule audio playback
  if (musicBuffer) {
    const musicSource = audioCtx.createBufferSource();
    musicSource.buffer = musicBuffer;
    const musicGain_ = audioCtx.createGain();
    musicGain_.gain.value = dbToGain(musicGainDb);
    musicSource.connect(musicGain_);
    musicGain_.connect(destination);
    musicSource.start(0);
  }

  if (voBuffer) {
    const voSource = audioCtx.createBufferSource();
    voSource.buffer = voBuffer;
    const voGain_ = audioCtx.createGain();
    voGain_.gain.value = dbToGain(voGainDb);
    voSource.connect(voGain_);
    voGain_.connect(destination);
    voSource.start(0);
  }

  // Play the video and draw frames to canvas in real-time
  video.currentTime = 0;
  video.play();

  const drawLoop = () => {
    if (video.ended || video.paused) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (videoTrack.requestFrame) {
      videoTrack.requestFrame();
    }

    const pct = Math.min(100, (video.currentTime / duration) * 100);
    onProgress?.(pct);

    requestAnimationFrame(drawLoop);
  };

  requestAnimationFrame(drawLoop);

  // Wait for video to end
  await new Promise<void>((resolve) => {
    video.onended = () => resolve();
    // Safety timeout: duration + 3s buffer
    setTimeout(resolve, (duration + 3) * 1000);
  });

  // Final frame flush
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (videoTrack.requestFrame) videoTrack.requestFrame();
  await sleep(200);

  // Stop recording
  recorder.stop();
  await recordingDone;

  // Cleanup
  combinedStream.getTracks().forEach((t) => t.stop());
  videoStream.getTracks().forEach((t) => t.stop());
  audioCtx.close();
  video.src = '';
  video.load();
  URL.revokeObjectURL(videoObjectUrl);

  onProgress?.(100);

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  if (blob.size < 100) {
    throw new Error('Audio mux produced empty result');
  }

  return blob;
}

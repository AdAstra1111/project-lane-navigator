/**
 * useScreenRecorder — Records a DOM element to MP4/WebM using MediaRecorder API.
 */
import { useState, useRef, useCallback } from 'react';

interface UseScreenRecorderOptions {
  /** Target element to capture */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Filename prefix */
  filenamePrefix?: string;
}

export function useScreenRecorder({ targetRef, filenamePrefix = 'IFFY-Demo' }: UseScreenRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const getMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
  };

  const startRecording = useCallback(async () => {
    const el = targetRef.current;
    if (!el) return;

    try {
      // Use canvas capture if available, otherwise use getDisplayMedia
      const canvas = document.createElement('canvas');
      const rect = el.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;

      // Attempt element capture via html2canvas-like approach isn't viable for animations.
      // Use getDisplayMedia (screen share) as the reliable approach.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = getMimeType();

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenamePrefix}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        chunksRef.current = [];
        setIsRecording(false);
      };

      // Also stop if user ends screen share
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
      });

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // collect in 1s chunks
      setIsRecording(true);
    } catch (err) {
      console.warn('Screen recording not available:', err);
      setIsRecording(false);
    }
  }, [targetRef, filenamePrefix]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return { isRecording, startRecording, stopRecording, toggleRecording };
}

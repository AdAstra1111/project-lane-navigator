/**
 * TrailerPlayer — Slideshow-style trailer preview player.
 * Plays through timeline frames at their intended durations with
 * text card overlays, fade transitions, and playback controls.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, SkipBack, SkipForward, Maximize2, Minimize2, RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TimelineBeat {
  index: number;
  shot_title: string;
  shot_description: string;
  intended_duration: number;
  has_frame: boolean;
  frame_url: string | null;
  has_motion_still: boolean;
  motion_still_url: string | null;
  text_card: string | null;
}

interface TrailerPlayerProps {
  timeline: TimelineBeat[];
  totalDuration: number;
  projectTitle?: string;
}

export function TrailerPlayer({ timeline, totalDuration, projectTitle }: TrailerPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0); // elapsed within current beat
  const [fullscreen, setFullscreen] = useState(false);
  const [finished, setFinished] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const current = timeline[currentIndex];
  const TICK_MS = 50;

  // Compute cumulative start times
  const cumulativeStarts = timeline.reduce<number[]>((acc, beat, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + timeline[i - 1].intended_duration);
    return acc;
  }, []);
  const globalElapsed = cumulativeStarts[currentIndex] + elapsed;
  const globalProgress = totalDuration > 0 ? (globalElapsed / totalDuration) * 100 : 0;

  const advanceBeat = useCallback(() => {
    if (currentIndex < timeline.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setElapsed(0);
    } else {
      setPlaying(false);
      setFinished(true);
    }
  }, [currentIndex, timeline.length]);

  useEffect(() => {
    if (!playing || !current) return;

    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        const next = prev + TICK_MS / 1000;
        if (next >= current.intended_duration) {
          advanceBeat();
          return 0;
        }
        return next;
      });
    }, TICK_MS);

    return () => clearInterval(timerRef.current);
  }, [playing, current, advanceBeat]);

  const togglePlay = () => {
    if (finished) {
      setCurrentIndex(0);
      setElapsed(0);
      setFinished(false);
      setPlaying(true);
    } else {
      setPlaying(p => !p);
    }
  };

  const restart = () => {
    setCurrentIndex(0);
    setElapsed(0);
    setFinished(false);
    setPlaying(false);
  };

  const skipPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setElapsed(0);
    }
  };

  const skipNext = () => {
    if (currentIndex < timeline.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setElapsed(0);
    }
  };

  const seekToGlobal = (pct: number) => {
    const targetTime = (pct / 100) * totalDuration;
    let acc = 0;
    for (let i = 0; i < timeline.length; i++) {
      if (acc + timeline[i].intended_duration > targetTime) {
        setCurrentIndex(i);
        setElapsed(targetTime - acc);
        setFinished(false);
        return;
      }
      acc += timeline[i].intended_duration;
    }
    // At end
    setCurrentIndex(timeline.length - 1);
    setElapsed(timeline[timeline.length - 1].intended_duration);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setFullscreen(false));
    }
  };

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') skipPrev();
      if (e.code === 'ArrowRight') skipNext();
      if (e.code === 'Escape' && fullscreen) document.exitFullscreen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, playing, finished, fullscreen]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const imageUrl = current?.motion_still_url || current?.frame_url;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg border border-border bg-black ${
        fullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : ''
      }`}
    >
      {/* Viewport */}
      <div className={`relative w-full ${fullscreen ? 'h-full' : 'aspect-video'} flex items-center justify-center overflow-hidden`}>
        <AnimatePresence mode="wait">
          {current?.text_card && !imageUrl ? (
            <motion.div
              key={`text-${currentIndex}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="text-center px-8">
                <p className="text-2xl md:text-4xl font-bold tracking-wider text-white uppercase">
                  {current.text_card}
                </p>
                {projectTitle && (
                  <p className="text-sm md:text-lg text-white/60 mt-4 tracking-widest uppercase">
                    {projectTitle}
                  </p>
                )}
              </div>
            </motion.div>
          ) : imageUrl ? (
            <motion.img
              key={`img-${currentIndex}`}
              src={imageUrl}
              alt={current?.shot_title}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <motion.div
              key={`empty-${currentIndex}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <p className="text-white/40 text-sm">No frame available</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text card overlay on frames */}
        {current?.text_card && imageUrl && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-16 left-0 right-0 text-center"
          >
            <span className="bg-black/70 px-6 py-2 text-white text-lg md:text-2xl font-bold tracking-wider uppercase">
              {current.text_card}
            </span>
          </motion.div>
        )}

        {/* Beat info overlay */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm rounded px-2 py-1">
            <p className="text-[10px] text-white/80 font-mono">
              Beat {current?.index || 0} / {timeline.length}
            </p>
          </div>
          <div className="bg-black/50 backdrop-blur-sm rounded px-2 py-1">
            <p className="text-[10px] text-white/80 font-mono">
              {formatTime(globalElapsed)} / {formatTime(totalDuration)}
            </p>
          </div>
        </div>

        {/* Shot description */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 pointer-events-none">
          <p className="text-[10px] text-white/70 truncate">{current?.shot_title}</p>
        </div>

        {/* Finished overlay */}
        {finished && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4 z-10">
            <p className="text-white text-lg font-medium">Preview Complete</p>
            <Button size="sm" variant="outline" onClick={restart} className="gap-1 text-xs">
              <RotateCcw className="h-3 w-3" /> Watch Again
            </Button>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-card border-t border-border px-3 py-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={skipPrev} disabled={currentIndex === 0}>
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={skipNext} disabled={currentIndex >= timeline.length - 1}>
          <SkipForward className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1 mx-2">
          <Slider
            value={[globalProgress]}
            max={100}
            step={0.5}
            onValueChange={([v]) => seekToGlobal(v)}
            className="h-1"
          />
        </div>

        <span className="text-[10px] text-muted-foreground font-mono min-w-[70px] text-right">
          {formatTime(globalElapsed)} / {formatTime(totalDuration)}
        </span>

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

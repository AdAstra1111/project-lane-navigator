/**
 * IFFY Guided Demo — Full-screen interactive demo player.
 * Replaces the need for a recorded video.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipForward, SkipBack, X, ChevronRight,
  MessageSquareText, RotateCcw, Circle, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEMO_STEPS, DEMO_CHAPTERS, DEMO_CONFIG, type DemoStep, type DemoView } from './demoConfig';
import { useDemoState } from './useDemoState';

// Screen components
import { DemoColdOpen } from './screens/DemoColdOpen';
import { DemoSuiteMap } from './screens/DemoSuiteMap';
import { DemoMagicTrick } from './screens/DemoMagicTrick';
import { DemoLibrary } from './screens/DemoLibrary';
import { DemoDevEngine } from './screens/DemoDevEngine';
import { DemoNotes } from './screens/DemoNotes';
import { DemoPackage } from './screens/DemoPackage';
import { DemoDifferentiators } from './screens/DemoDifferentiators';
import { DemoCTA } from './screens/DemoCTA';
import { useScreenRecorder } from './useScreenRecorder';

export default function GuidedDemo() {
  const navigate = useNavigate();
  const { state, executeAction, reset } = useDemoState();
  const [stepIdx, setStepIdx] = useState(DEMO_CONFIG.defaultChapterStart);
  const [isPlaying, setIsPlaying] = useState(DEMO_CONFIG.autoplay);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval>>();
  const demoContainerRef = useRef<HTMLDivElement>(null);

  const { isRecording, toggleRecording } = useScreenRecorder({
    targetRef: demoContainerRef,
    filenamePrefix: `IFFY-Demo-${DEMO_CHAPTERS[DEMO_CHAPTERS.indexOf(DEMO_STEPS[stepIdx]?.chapter)] ?? 'Full'}`,
  });

  const step = DEMO_STEPS[stepIdx];
  const total = DEMO_STEPS.length;

  // Chapter index for current step
  const chapterStarts = useMemo(() => {
    const map = new Map<string, number>();
    DEMO_STEPS.forEach((s, i) => {
      if (!map.has(s.chapter)) map.set(s.chapter, i);
    });
    return map;
  }, []);

  const currentChapterIdx = DEMO_CHAPTERS.indexOf(step.chapter);

  // Total duration for progress
  const totalDurationMs = useMemo(() => DEMO_STEPS.reduce((sum, s) => sum + s.durationMs, 0), []);
  const elapsedBeforeStep = useMemo(() =>
    DEMO_STEPS.slice(0, stepIdx).reduce((sum, s) => sum + s.durationMs, 0), [stepIdx]);

  // Execute action when step changes
  useEffect(() => {
    if (step.action) {
      const delay = step.action === 'APPLY_FIX' ? 1500 : 800;
      const t = setTimeout(() => executeAction(step.action), delay);
      return () => clearTimeout(t);
    }
  }, [stepIdx, step.action, executeAction]);

  // Auto-advance timer
  useEffect(() => {
    if (!isPlaying) return;
    setElapsed(0);
    timerRef.current = setTimeout(() => {
      if (stepIdx < total - 1) {
        setStepIdx(i => i + 1);
      } else {
        setIsPlaying(false);
      }
    }, step.durationMs);

    // Progress tick
    elapsedRef.current = setInterval(() => {
      setElapsed(e => Math.min(e + 100, step.durationMs));
    }, 100);

    return () => {
      clearTimeout(timerRef.current);
      clearInterval(elapsedRef.current);
    };
  }, [stepIdx, isPlaying, step.durationMs, total]);

  const goToStep = useCallback((i: number) => {
    clearTimeout(timerRef.current);
    clearInterval(elapsedRef.current);
    setStepIdx(i);
    setElapsed(0);
    setIsPlaying(true);
  }, []);

  const goToChapter = useCallback((chapter: string) => {
    const idx = chapterStarts.get(chapter);
    if (idx !== undefined) goToStep(idx);
    setShowChapters(false);
  }, [chapterStarts, goToStep]);

  const togglePlay = useCallback(() => {
    setIsPlaying(p => !p);
  }, []);

  const nextStep = () => { if (stepIdx < total - 1) goToStep(stepIdx + 1); };
  const prevStep = () => { if (stepIdx > 0) goToStep(stepIdx - 1); };

  const handleRestart = () => {
    reset();
    goToStep(0);
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextStep(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevStep(); }
      if (e.key === 'Escape') navigate(-1);
      if (e.key === 'c') setShowCaptions(c => !c);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stepIdx]);

  // Progress percentage
  const progressPct = ((elapsedBeforeStep + elapsed) / totalDurationMs) * 100;

  // Render current screen
  const renderView = (view: DemoView) => {
    switch (view) {
      case 'cold-open':
        return <DemoColdOpen overlayText={step.overlayText} />;
      case 'suite-map':
        return <DemoSuiteMap />;
      case 'magic-trick':
        return <DemoMagicTrick state={state} currentAction={step.action} overlayText={step.overlayText} />;
      case 'library':
        return <DemoLibrary state={state} />;
      case 'dev-engine':
        return <DemoDevEngine />;
      case 'notes':
        return <DemoNotes state={state} />;
      case 'package':
        return <DemoPackage state={state} />;
      case 'differentiators':
        return <DemoDifferentiators />;
      case 'cta':
        return <DemoCTA />;
      default:
        return null;
    }
  };

  return (
    <div ref={demoContainerRef} className="fixed inset-0 z-[300] bg-[hsl(225,18%,4%)] overflow-hidden select-none flex flex-col">
      {/* Top bar: chapter nav + close */}
      <div className="relative z-40 flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowChapters(!showChapters)}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          >
            <span className="font-display font-medium text-primary text-[10px] uppercase tracking-wider">
              {step.chapter}
            </span>
            <ChevronRight className={`h-3 w-3 transition-transform ${showChapters ? 'rotate-90' : ''}`} />
          </button>
          <span className="text-[10px] text-white/20">
            {stepIdx + 1} / {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRecording}
            className={`p-1.5 rounded transition-colors ${isRecording ? 'text-red-500 animate-pulse' : 'text-white/25 hover:text-white/50'}`}
            title={isRecording ? 'Stop recording & download' : 'Record as video'}
          >
            {isRecording ? <Square className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setShowCaptions(c => !c)}
            className={`p-1.5 rounded transition-colors ${showCaptions ? 'text-primary' : 'text-white/25 hover:text-white/50'}`}
            title="Toggle captions (C)"
          >
            <MessageSquareText className="h-4 w-4" />
          </button>
          <button
            onClick={handleRestart}
            className="p-1.5 rounded text-white/25 hover:text-white/50 transition-colors"
            title="Restart"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded text-white/25 hover:text-white/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative z-40 h-[2px] bg-white/5">
        <motion.div
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${progressPct}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Chapters sidebar */}
      <AnimatePresence>
        {showChapters && (
          <motion.div
            initial={{ opacity: 0, x: -200 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -200 }}
            transition={{ duration: 0.25 }}
            className="absolute left-0 top-[42px] bottom-[80px] z-50 w-64 bg-black/90 backdrop-blur-xl border-r border-white/5 overflow-y-auto"
          >
            <div className="p-4 space-y-1">
              <h3 className="text-[10px] font-display uppercase tracking-[0.2em] text-white/30 mb-3">Chapters</h3>
              {DEMO_CHAPTERS.map((chapter, i) => {
                const isActive = chapter === step.chapter;
                const startIdx = chapterStarts.get(chapter) ?? 0;
                const isPast = startIdx < stepIdx;
                return (
                  <button
                    key={chapter}
                    onClick={() => goToChapter(chapter)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : isPast
                          ? 'text-white/40 hover:text-white/60 hover:bg-white/5'
                          : 'text-white/25 hover:text-white/40 hover:bg-white/5'
                    }`}
                  >
                    <span className="text-[10px] text-white/20 mr-2">{String(i + 1).padStart(2, '0')}</span>
                    {chapter}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Ambient glow */}
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.06, 0.15, 0.06] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20 blur-[180px] pointer-events-none"
        />

        {/* Film grain */}
        <div className="absolute inset-0 z-10 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Screen content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 z-20"
          >
            {renderView(step.view)}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom bar: controls + captions */}
      <div className="relative z-40 bg-black/60 backdrop-blur-sm border-t border-white/5">
        {/* Captions */}
        <AnimatePresence>
          {showCaptions && step.narrationText && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="px-6 py-3 border-b border-white/5"
            >
              <p className="text-sm text-white/60 max-w-3xl mx-auto text-center leading-relaxed">
                {step.narrationText}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-4 py-3 px-4">
          <button
            onClick={prevStep}
            disabled={stepIdx === 0}
            className="text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            onClick={togglePlay}
            className="h-10 w-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          <button
            onClick={nextStep}
            disabled={stepIdx === total - 1}
            className="text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Step progress segments */}
          <div className="hidden sm:flex items-center gap-0.5 ml-4">
            {DEMO_STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => goToStep(i)}
                className={`h-1 rounded-full transition-all ${
                  i < stepIdx ? 'w-2 bg-primary/50' :
                  i === stepIdx ? 'w-4 bg-primary' :
                  'w-1.5 bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

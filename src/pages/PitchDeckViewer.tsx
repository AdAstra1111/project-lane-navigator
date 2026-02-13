import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronLeft, ChevronRight, Maximize, Minimize, Download,
  Film, Tv, Users, DollarSign, Target, TrendingUp, BarChart3,
  Sparkles, Building2, Share2, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LaneBadge } from '@/components/LaneBadge';
import { cn } from '@/lib/utils';
import { usePitchDecks, usePitchDeckByToken, type PitchSlide } from '@/hooks/usePitchDeck';
import { useProject } from '@/hooks/useProjects';
import { MonetisationLane } from '@/lib/types';
import logoImg from '@/assets/iffy-logo-v3.png';

const SLIDE_W = 1920;
const SLIDE_H = 1080;

/* ─── Scaled Slide Container ─── */
function ScaledSlide({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      setScale(Math.min(w / SLIDE_W, h / SLIDE_H));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <div
        className="absolute"
        style={{
          width: SLIDE_W, height: SLIDE_H,
          left: '50%', top: '50%',
          marginLeft: -SLIDE_W / 2, marginTop: -SLIDE_H / 2,
          transform: `scale(${scale})`, transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Slide transition ─── */
const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 120 : -120, scale: 0.96 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -120 : 120, scale: 0.96 }),
};
const slideTrans = { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] };

/* ─── Slide icon map ─── */
const SLIDE_ICONS: Record<string, typeof Film> = {
  title: Film, opportunity: Sparkles, creative_vision: Target,
  package: Users, financial: DollarSign, market: TrendingUp,
  readiness: BarChart3, the_ask: Building2,
};

/* ─── Individual slide renderer ─── */
function SlideContent({ slide, projectData }: { slide: PitchSlide; projectData?: any }) {
  const Icon = SLIDE_ICONS[slide.slide_type] || Sparkles;
  const pd = slide.project_data || {};

  // Title slide
  if (slide.slide_type === 'title') {
    const heroUrl = pd.hero_image_url || projectData?.hero_image_url;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center bg-[hsl(225,20%,6%)] px-[200px] relative overflow-hidden">
        {heroUrl && (
          <img src={heroUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(225,20%,6%)] via-[hsl(225,20%,6%)]/80 to-[hsl(225,20%,6%)]/40" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-primary/5 blur-[200px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center gap-8">
          <div className="flex items-center gap-3">
            {pd.format === 'tv-series' ? <Tv className="h-6 w-6 text-primary/70" /> : <Film className="h-6 w-6 text-primary/70" />}
            <span className="uppercase tracking-[0.35em] text-sm text-primary/70 font-display">
              {pd.format === 'tv-series' ? 'TV Series' : pd.format === 'documentary' ? 'Documentary' : 'Feature Film'}
            </span>
          </div>

          <motion.h1
            className="text-[88px] font-display font-bold text-white tracking-tight leading-[1.05] max-w-[1400px]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            {pd.title || slide.headline}
          </motion.h1>

          {slide.subheadline && (
            <motion.p
              className="text-2xl text-white/50 font-display max-w-[1000px] italic"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {slide.subheadline}
            </motion.p>
          )}

          {pd.genres?.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap justify-center mt-2">
              {pd.genres.map((g: string) => (
                <span key={g} className="px-5 py-2 rounded-full border border-white/10 text-white/60 text-lg font-display">{g}</span>
              ))}
            </div>
          )}

          {pd.lane && (
            <div className="mt-2">
              <LaneBadge lane={pd.lane as MonetisationLane} size="lg" />
            </div>
          )}
        </div>

        <div className="absolute bottom-12 flex items-center gap-3 opacity-30">
          <img src={logoImg} alt="IFFY" className="h-6 invert" />
        </div>
      </div>
    );
  }

  // Standard content slides
  return (
    <div className="w-full h-full flex bg-[hsl(225,20%,6%)] relative overflow-hidden">
      {/* Gradient orb */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-primary/4 blur-[180px] pointer-events-none" />

      {/* Main content area */}
      <div className="relative z-10 flex flex-col justify-center px-[120px] py-[80px] flex-1 max-w-[1200px]">
        {/* Stage badge */}
        <motion.div
          className="flex items-center gap-3 mb-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Icon className="h-5 w-5 text-primary/70" />
          <span className="uppercase tracking-[0.3em] text-xs text-primary/60 font-display">
            {slide.slide_type.replace(/_/g, ' ')}
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h2
          className="text-[56px] font-display font-bold text-white leading-[1.1] mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          {slide.headline}
        </motion.h2>

        {slide.subheadline && (
          <motion.p
            className="text-xl text-white/40 mb-8 font-display"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            {slide.subheadline}
          </motion.p>
        )}

        {/* Body text */}
        <motion.div
          className="text-lg text-white/60 leading-relaxed max-w-[900px] whitespace-pre-line mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {slide.body}
        </motion.div>

        {/* Bullet points */}
        {slide.bullet_points && slide.bullet_points.length > 0 && (
          <motion.ul
            className="space-y-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {slide.bullet_points.map((point, i) => (
              <motion.li
                key={i}
                className="flex items-start gap-3 text-white/50"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.08 }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2.5 shrink-0" />
                <span className="text-base">{point}</span>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>

      {/* Right side — pull quote or data panel */}
      <div className="flex-1 flex items-center justify-center px-[60px] relative">
        {slide.pull_quote && (
          <motion.div
            className="max-w-[500px]"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6 }}
          >
            <div className="border-l-2 border-primary/30 pl-8">
              <p className="text-[28px] font-display font-medium text-white/80 italic leading-[1.4]">
                "{slide.pull_quote}"
              </p>
            </div>
          </motion.div>
        )}

        {/* Package slide: show cast/team data */}
        {slide.slide_type === 'package' && pd.cast?.length > 0 && !slide.pull_quote && (
          <motion.div
            className="space-y-4 w-full max-w-[500px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {pd.cast.map((c: any, i: number) => (
              <motion.div
                key={i}
                className="flex items-center gap-4 px-6 py-4 rounded-xl bg-white/5 border border-white/10"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
              >
                <Users className="h-5 w-5 text-primary/60 shrink-0" />
                <div>
                  <p className="text-white font-display font-medium">{c.name}</p>
                  <p className="text-sm text-white/40">{c.role || c.status}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Financial slide: show deal data */}
        {slide.slide_type === 'financial' && pd.deals?.length > 0 && !slide.pull_quote && (
          <motion.div
            className="space-y-3 w-full max-w-[500px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {pd.deals.filter((d: any) => d.status === 'closed').slice(0, 6).map((d: any, i: number) => (
              <motion.div
                key={i}
                className="flex items-center justify-between px-6 py-3 rounded-xl bg-white/5 border border-white/10"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.08 }}
              >
                <span className="text-white/70 font-display">{d.territory || d.type}</span>
                <span className="text-primary font-display font-semibold">${d.amount || 'TBD'}</span>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Readiness slide: show confidence ring */}
        {slide.slide_type === 'readiness' && pd.confidence && !slide.pull_quote && (
          <motion.div
            className="flex flex-col items-center gap-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
          >
            <ConfidenceRing value={pd.confidence} size={240} />
            <span className="text-lg font-display text-white/50">Viability Score</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ─── Confidence Ring ─── */
function ConfidenceRing({ value, size = 200 }: { value: number; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={size * 0.05} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="hsl(var(--primary))" strokeWidth={size * 0.05}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.4, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <motion.span
        className="absolute inset-0 flex items-center justify-center font-display font-bold text-white"
        style={{ fontSize: size * 0.3 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {value}
      </motion.span>
    </div>
  );
}

/* ─── Main Page ─── */
export default function PitchDeckViewer() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shareToken = searchParams.get('token');

  // Either viewing by project id or by share token
  const { project } = useProject(shareToken ? undefined : id);
  const { decks, generate } = usePitchDecks(id);
  const { data: sharedDeck, isLoading: sharedLoading } = usePitchDeckByToken(shareToken || undefined);

  const deck = shareToken ? sharedDeck : decks[0];
  const slides = (deck?.slides || []) as PitchSlide[];
  const isGenerating = generate.isPending || deck?.status === 'generating';

  const [[current, direction], setSlide] = useState([0, 0]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const cursorTimer = useRef<ReturnType<typeof setTimeout>>();

  const go = useCallback((idx: number) => {
    setSlide(([prev]) => [Math.max(0, Math.min(slides.length - 1, idx)), idx > prev ? 1 : -1]);
  }, [slides.length]);
  const prev = useCallback(() => go(current - 1), [go, current]);
  const next = useCallback(() => go(current + 1), [go, current]);

  /* Keyboard */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (id) navigate(`/projects/${id}`);
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, navigate, id]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (!isFullscreen) { setCursorHidden(false); return; }
    const handleMove = () => {
      setCursorHidden(false);
      clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setCursorHidden(true), 3000);
    };
    window.addEventListener('mousemove', handleMove);
    cursorTimer.current = setTimeout(() => setCursorHidden(true), 3000);
    return () => { window.removeEventListener('mousemove', handleMove); clearTimeout(cursorTimer.current); };
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  const handleShare = () => {
    if (!deck?.share_token) return;
    const url = `${window.location.origin}/projects/${id}/pitch-deck?token=${deck.share_token}`;
    navigator.clipboard.writeText(url);
    import('sonner').then(({ toast }) => toast.success('Share link copied to clipboard'));
  };

  // Loading / generating state
  if (isGenerating || sharedLoading) {
    return (
      <div className="h-screen bg-[hsl(225,20%,6%)] flex flex-col items-center justify-center gap-6">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-10 w-10 text-primary" />
        </motion.div>
        <p className="text-white/50 font-display text-lg">Generating your pitch deck...</p>
        <p className="text-white/30 text-sm">AI is crafting strategic narrative for each slide</p>
      </div>
    );
  }

  // No deck yet — show generate prompt
  if (!deck || slides.length === 0) {
    return (
      <div className="h-screen bg-[hsl(225,20%,6%)] flex flex-col items-center justify-center gap-8">
        <div className="text-center space-y-4">
          <Sparkles className="h-12 w-12 text-primary/60 mx-auto" />
          <h1 className="text-3xl font-display font-bold text-white">Generate Pitch Deck</h1>
          <p className="text-white/40 max-w-md">
            AI will analyze your project data and create a cinematic pitch deck with strategic narrative tailored to your project's tone and market position.
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="border-white/10 text-white/60 hover:bg-white/5"
            onClick={() => id && navigate(`/projects/${id}`)}
          >
            Back to Project
          </Button>
          <Button
            className="bg-primary text-primary-foreground"
            onClick={() => id && generate.mutate(id)}
            disabled={generate.isPending}
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate Deck
          </Button>
        </div>
      </div>
    );
  }

  const progress = slides.length > 1 ? current / (slides.length - 1) : 1;

  return (
    <div className={cn('h-screen bg-[hsl(225,20%,6%)] flex flex-col select-none', cursorHidden && 'cursor-none')}>
      {/* Top Chrome */}
      <div className={cn(
        'flex items-center justify-between px-5 py-2.5 bg-[hsl(225,20%,8%)] border-b border-white/5 z-50 transition-opacity duration-500',
        isFullscreen && 'opacity-0 hover:opacity-100'
      )}>
        <div className="flex items-center gap-4">
          {!shareToken && (
            <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/5" onClick={() => navigate(`/projects/${id}`)}>
              <X className="h-4 w-4 mr-1.5" /> Exit
            </Button>
          )}
          <div className="h-4 w-px bg-white/10" />
          <span className="text-sm font-display font-medium text-white/80 truncate max-w-[300px]">
            {project?.title || 'Pitch Deck'}
          </span>
          <Badge variant="outline" className="border-primary/30 text-primary/80 text-xs">
            AI-Generated
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={cn(
                'rounded-full transition-all duration-300',
                i === current ? 'w-7 h-2 bg-primary' : 'w-2 h-2 bg-white/20 hover:bg-white/40'
              )}
            />
          ))}
          <span className="text-xs text-white/40 ml-2 tabular-nums">{current + 1} / {slides.length}</span>
        </div>

        <div className="flex items-center gap-1">
          {!shareToken && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5" onClick={handleShare} title="Copy share link">
              <Share2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5" onClick={toggleFullscreen} title="Fullscreen (F)">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-0.5 bg-white/5 relative z-50">
        <motion.div className="h-full bg-primary" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
      </div>

      {/* Slide Area */}
      <div className="flex-1 relative overflow-hidden">
        {current > 0 && (
          <motion.button
            onClick={prev}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/5 backdrop-blur-md hover:bg-white/10 border border-white/10 transition-colors"
          >
            <ChevronLeft className="h-6 w-6 text-white/70" />
          </motion.button>
        )}
        {current < slides.length - 1 && (
          <motion.button
            onClick={next}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/5 backdrop-blur-md hover:bg-white/10 border border-white/10 transition-colors"
          >
            <ChevronRight className="h-6 w-6 text-white/70" />
          </motion.button>
        )}

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={slideTrans}
            className="absolute inset-0"
          >
            <ScaledSlide>
              <SlideContent slide={slides[current]} projectData={project} />
            </ScaledSlide>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

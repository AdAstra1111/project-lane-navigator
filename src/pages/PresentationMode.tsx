import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Film, Tv, TrendingUp, DollarSign, Users, Target, BarChart3,
  ChevronLeft, ChevronRight, Maximize, Minimize, Download, Building2,
  Sparkles, ShieldCheck, Clapperboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LaneBadge } from '@/components/LaneBadge';
import { useProject } from '@/hooks/useProjects';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { useProjectDeals } from '@/hooks/useDeals';
import { useBuyerMatches } from '@/hooks/useBuyerMatches';
import { useCompanies } from '@/hooks/useCompanies';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';
import { exportProjectPDF } from '@/lib/pdf-export';
import { MonetisationLane, FullAnalysis } from '@/lib/types';
import { cn } from '@/lib/utils';
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
        className="absolute slide-content"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          left: '50%',
          top: '50%',
          marginLeft: -SLIDE_W / 2,
          marginTop: -SLIDE_H / 2,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Slide Transition ─── */
const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 120 : -120, scale: 0.96 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -120 : 120, scale: 0.96 }),
};
const slideTransition = { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] };

/* ─── Score Ring ─── */
function ScoreRing({ value, label, color, size = 200 }: { value: number; label: string; color: string; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={size * 0.05} />
          <motion.circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={size * 0.05}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.4, ease: 'easeOut', delay: 0.3 }}
          />
        </svg>
        <motion.span
          className="absolute inset-0 flex items-center justify-center font-display font-bold text-foreground"
          style={{ fontSize: size * 0.32 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          {value}
        </motion.span>
      </div>
      <span className="text-lg font-display font-medium text-muted-foreground tracking-wide">{label}</span>
    </div>
  );
}

/* ─── Main ─── */
export default function PresentationMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { project, isLoading } = useProject(id);
  const { cast } = useProjectCast(id);
  const { partners } = useProjectPartners(id);
  const { scripts } = useProjectScripts(id);
  const { scenarios: financeScenarios } = useProjectFinance(id);
  const { hods } = useProjectHODs(id);
  const { deals } = useProjectDeals(id);
  const { companies } = useCompanies();
  const primaryCompany = companies.length > 0 ? companies[0] : null;

  const buyerMatchInput = project ? {
    id: project.id, format: project.format, genres: project.genres || [],
    budget_range: project.budget_range, tone: project.tone,
    target_audience: project.target_audience, assigned_lane: project.assigned_lane,
  } : null;
  const { matches: buyerMatches } = useBuyerMatches(buyerMatchInput);

  const readiness = useMemo(() => {
    if (!project) return null;
    return calculateReadiness(project, cast, partners, scripts, financeScenarios, hods, false);
  }, [project, cast, partners, scripts, financeScenarios, hods]);

  const financeReadiness = useMemo(() => {
    if (!project) return null;
    return calculateFinanceReadiness(project, cast, partners, scripts, financeScenarios, hods, false);
  }, [project, cast, partners, scripts, financeScenarios, hods]);

  const analysis = project?.analysis_passes as FullAnalysis | null;
  const confirmedCast = cast.filter(c => ['confirmed', 'offer', 'attached'].includes(c.status));
  const confirmedPartners = partners.filter(p => ['confirmed', 'in-talks', 'in-discussion'].includes(p.status));

  /* ─── Build slides ─── */
  const slides = useMemo(() => {
    const s: string[] = ['title'];
    if (project?.reasoning) s.push('logline');
    s.push('scores');
    if (confirmedCast.length > 0 || confirmedPartners.length > 0) s.push('team');
    if (financeScenarios.length > 0) s.push('finance');
    if (analysis?.verdict) s.push('verdict');
    if (analysis?.do_next?.length) s.push('strategy');
    if ((buyerMatches || []).length > 0) s.push('buyers');
    return s;
  }, [project?.reasoning, confirmedCast.length, confirmedPartners.length, financeScenarios.length, analysis, buyerMatches]);

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
        else navigate(`/projects/${id}`);
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, navigate, id]);

  /* Fullscreen state */
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  /* Auto-hide cursor in fullscreen */
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

  const handleExportPDF = () => {
    if (!project || !readiness) return;
    exportProjectPDF({
      project, readiness, financeReadiness,
      cast, partners, hods, financeScenarios,
      buyerMatches: buyerMatches || [], deals: deals || [],
    });
  };

  if (isLoading || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          className="h-10 w-10 rounded-lg bg-primary"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </div>
    );
  }

  const slideId = slides[current];
  const progress = slides.length > 1 ? current / (slides.length - 1) : 1;
  const formatLabel = project.format === 'tv-series' ? 'TV Series' : project.format === 'documentary' ? 'Documentary' : 'Feature Film';

  return (
    <div className={cn('h-screen bg-[hsl(225,20%,6%)] flex flex-col select-none', cursorHidden && 'cursor-none')}>
      {/* ─── Top Chrome ─── */}
      <div className={cn(
        'flex items-center justify-between px-5 py-2.5 bg-[hsl(225,20%,8%)] border-b border-white/5 z-50 transition-opacity duration-500',
        isFullscreen && 'opacity-0 hover:opacity-100'
      )}>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/5" onClick={() => navigate(`/projects/${id}`)}>
            <X className="h-4 w-4 mr-1.5" /> Exit
          </Button>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-sm font-display font-medium text-white/80 truncate max-w-[300px]">{project.title}</span>
        </div>

        {/* Slide dots */}
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
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
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5" onClick={handleExportPDF} title="Export PDF">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/5" onClick={toggleFullscreen} title="Fullscreen (F)">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ─── Progress Bar ─── */}
      <div className="h-0.5 bg-white/5 relative z-50">
        <motion.div
          className="h-full bg-primary"
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* ─── Slide Area ─── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Nav arrows */}
        {current > 0 && (
          <motion.button
            onClick={prev}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/5 backdrop-blur-md hover:bg-white/10 border border-white/10 transition-colors"
          >
            <ChevronLeft className="h-6 w-6 text-white/70" />
          </motion.button>
        )}
        {current < slides.length - 1 && (
          <motion.button
            onClick={next}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/5 backdrop-blur-md hover:bg-white/10 border border-white/10 transition-colors"
          >
            <ChevronRight className="h-6 w-6 text-white/70" />
          </motion.button>
        )}

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slideId}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={slideTransition}
            className="absolute inset-0"
          >
            <ScaledSlide>
              {/* ─── TITLE SLIDE ─── */}
              {slideId === 'title' && (
                <div className="w-full h-full flex flex-col items-center justify-center text-center bg-[hsl(225,20%,6%)] px-[200px]">
                  {/* Subtle gradient orb */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-primary/5 blur-[200px] pointer-events-none" />

                  <div className="relative z-10 flex flex-col items-center gap-10">
                    {primaryCompany && (
                      <div className="flex items-center gap-4 mb-4">
                        {primaryCompany.logo_url ? (
                          <img src={primaryCompany.logo_url} alt="" className="h-14 rounded-xl object-cover" />
                        ) : (
                          <div className="h-14 w-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <Building2 className="h-7 w-7 text-white/40" />
                          </div>
                        )}
                        <span className="text-xl font-display text-white/50">{primaryCompany.name}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      {project.format === 'tv-series' ? <Tv className="h-6 w-6 text-primary/70" /> : <Film className="h-6 w-6 text-primary/70" />}
                      <span className="uppercase tracking-[0.35em] text-sm text-primary/70 font-display">{formatLabel}</span>
                    </div>

                    <h1 className="text-[96px] font-display font-bold text-white tracking-tight leading-[1.05] max-w-[1400px]">
                      {project.title}
                    </h1>

                    <div className="flex items-center gap-3 flex-wrap justify-center">
                      {project.genres?.map(g => (
                        <span key={g} className="px-5 py-2 rounded-full border border-white/10 text-white/60 text-lg font-display">{g}</span>
                      ))}
                    </div>

                    {project.assigned_lane && (
                      <div className="mt-4">
                        <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
                      </div>
                    )}

                    {project.comparable_titles && (
                      <p className="text-lg text-white/30 mt-6 max-w-[800px]">
                        <span className="uppercase tracking-[0.25em] text-xs block mb-2 text-white/20">Comparable Titles</span>
                        {project.comparable_titles}
                      </p>
                    )}
                  </div>

                  {/* Footer branding */}
                  <div className="absolute bottom-12 flex items-center gap-3 opacity-30">
                    <img src={logoImg} alt="IFFY" className="h-6 invert" />
                  </div>
                </div>
              )}

              {/* ─── LOGLINE SLIDE ─── */}
              {slideId === 'logline' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[280px]">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/4 blur-[180px] pointer-events-none" />
                  <div className="relative z-10 text-center space-y-10">
                    <div className="flex items-center justify-center gap-3">
                      <Sparkles className="h-6 w-6 text-primary/60" />
                      <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Logline</span>
                    </div>
                    <p className="text-[44px] font-display font-medium text-white leading-[1.35] max-w-[1200px] italic">
                      "{project.reasoning}"
                    </p>
                    {project.target_audience && (
                      <p className="text-lg text-white/30">
                        <span className="uppercase tracking-[0.2em] text-xs text-white/20 mr-3">Target Audience</span>
                        {project.target_audience}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ─── SCORES SLIDE ─── */}
              {slideId === 'scores' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[160px] gap-16">
                  <div className="text-center space-y-3">
                    <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Project Intelligence</span>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">Readiness Overview</h2>
                  </div>

                  <div className="flex gap-24">
                    {readiness && <ScoreRing value={readiness.score} label="Overall Readiness" color="hsl(var(--primary))" size={220} />}
                    {financeReadiness && <ScoreRing value={financeReadiness.score} label="Finance Readiness" color="hsl(142 71% 45%)" size={220} />}
                  </div>

                  <div className="grid grid-cols-4 gap-8 w-full max-w-[1200px]">
                    <MetricCard icon={DollarSign} label="Budget" value={project.budget_range || 'TBD'} />
                    <MetricCard icon={Target} label="Audience" value={project.target_audience || 'TBD'} />
                    <MetricCard icon={Users} label="Cast Attached" value={`${confirmedCast.length}`} />
                    <MetricCard icon={Clapperboard} label="Stage" value={project.pipeline_stage.replace(/-/g, ' ')} />
                  </div>
                </div>
              )}

              {/* ─── TEAM SLIDE ─── */}
              {slideId === 'team' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[160px] gap-12">
                  <div className="text-center space-y-3">
                    <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Package</span>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">Cast & Partners</h2>
                  </div>

                  <div className="grid grid-cols-2 gap-16 w-full max-w-[1400px]">
                    {confirmedCast.length > 0 && (
                      <div>
                        <h3 className="text-xl font-display font-semibold text-white/80 mb-6 flex items-center gap-3">
                          <Users className="h-5 w-5 text-primary" /> Cast
                        </h3>
                        <div className="space-y-3">
                          {confirmedCast.slice(0, 8).map(c => (
                            <div key={c.id} className="rounded-xl border border-white/8 bg-white/3 px-6 py-4 flex justify-between items-center">
                              <span className="text-lg font-display font-medium text-white">{c.actor_name}</span>
                              <span className="text-base text-white/40">{c.role_name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {confirmedPartners.length > 0 && (
                      <div>
                        <h3 className="text-xl font-display font-semibold text-white/80 mb-6 flex items-center gap-3">
                          <TrendingUp className="h-5 w-5 text-primary" /> Partners
                        </h3>
                        <div className="space-y-3">
                          {confirmedPartners.slice(0, 8).map(p => (
                            <div key={p.id} className="rounded-xl border border-white/8 bg-white/3 px-6 py-4 flex justify-between items-center">
                              <div>
                                <span className="text-lg font-display font-medium text-white">{p.partner_name}</span>
                                <span className="text-sm text-white/30 ml-3">{p.partner_type}</span>
                              </div>
                              <span className="text-base text-white/40">{p.territory}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── FINANCE SLIDE ─── */}
              {slideId === 'finance' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[160px] gap-12">
                  <div className="text-center space-y-3">
                    <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Financing</span>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">Finance Plan</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-8 w-full max-w-[1400px]">
                    {financeScenarios.slice(0, 4).map(fs => (
                      <div key={fs.id} className="rounded-2xl border border-white/8 bg-white/3 p-8">
                        <h4 className="font-display font-semibold text-white text-2xl mb-6">{fs.scenario_name}</h4>
                        <div className="grid grid-cols-2 gap-4">
                          {fs.total_budget && <FinStat label="Budget" value={`$${Number(fs.total_budget).toLocaleString()}`} />}
                          {fs.presales_amount && <FinStat label="Pre-sales" value={`$${Number(fs.presales_amount).toLocaleString()}`} />}
                          {fs.equity_amount && <FinStat label="Equity" value={`$${Number(fs.equity_amount).toLocaleString()}`} />}
                          {fs.incentive_amount && <FinStat label="Incentives" value={`$${Number(fs.incentive_amount).toLocaleString()}`} />}
                          {fs.gap_amount && <FinStat label="Gap" value={`$${Number(fs.gap_amount).toLocaleString()}`} highlight />}
                          {fs.other_sources && <FinStat label="Other" value={`$${Number(fs.other_sources).toLocaleString()}`} />}
                        </div>
                        <div className="mt-5 pt-4 border-t border-white/5">
                          <span className="text-sm text-white/30 uppercase tracking-wider">{fs.confidence} confidence</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── VERDICT SLIDE ─── */}
              {slideId === 'verdict' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[240px] gap-12">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/3 blur-[200px] pointer-events-none" />
                  <div className="relative z-10 text-center space-y-10 max-w-[1300px]">
                    <div className="flex items-center justify-center gap-3">
                      <ShieldCheck className="h-7 w-7 text-primary/60" />
                      <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Assessment</span>
                    </div>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">IFFY Verdict</h2>
                    <div className="rounded-2xl border-l-4 border-primary bg-white/3 border border-white/8 p-10 text-left">
                      <p className="text-2xl text-white/90 leading-relaxed font-display">{analysis?.verdict}</p>
                    </div>
                  </div>
                  {analysis?.market_reality && (
                    <div className="relative z-10 grid grid-cols-3 gap-6 max-w-[1300px] w-full">
                      <VerdictCard title="Audience" text={analysis.market_reality.likely_audience} />
                      <VerdictCard title="Budget Implications" text={analysis.market_reality.budget_implications} />
                      <VerdictCard title="Risks" text={analysis.market_reality.commercial_risks} />
                    </div>
                  )}
                </div>
              )}

              {/* ─── STRATEGY SLIDE ─── */}
              {slideId === 'strategy' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[200px] gap-12">
                  <div className="text-center space-y-3">
                    <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Roadmap</span>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">Strategic Next Steps</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-16 max-w-[1400px] w-full">
                    <div>
                      <h3 className="text-lg uppercase tracking-[0.2em] text-primary font-display font-semibold mb-8">Do Next</h3>
                      <div className="space-y-5">
                        {analysis?.do_next?.slice(0, 5).map((item, i) => (
                          <div key={i} className="flex gap-5 items-start">
                            <span className="text-3xl font-display font-bold text-primary/40 leading-none mt-1">{i + 1}</span>
                            <p className="text-lg text-white/80 leading-relaxed">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {analysis?.avoid && analysis.avoid.length > 0 && (
                      <div>
                        <h3 className="text-lg uppercase tracking-[0.2em] text-red-400/80 font-display font-semibold mb-8">Avoid</h3>
                        <div className="space-y-5">
                          {analysis.avoid.slice(0, 5).map((item, i) => (
                            <div key={i} className="flex gap-5 items-start">
                              <span className="text-xl text-red-400/50 mt-1">✕</span>
                              <p className="text-lg text-white/60 leading-relaxed">{item}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── BUYERS SLIDE ─── */}
              {slideId === 'buyers' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(225,20%,6%)] px-[160px] gap-12">
                  <div className="text-center space-y-3">
                    <span className="uppercase tracking-[0.3em] text-sm text-primary/60 font-display">Distribution</span>
                    <h2 className="text-[56px] font-display font-bold text-white tracking-tight">Top Buyer Matches</h2>
                  </div>
                  <div className="grid grid-cols-3 gap-6 w-full max-w-[1400px]">
                    {(buyerMatches || []).slice(0, 6).map(b => (
                      <div key={b.buyerId} className="rounded-2xl border border-white/8 bg-white/3 p-7">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xl font-display font-semibold text-white">{b.buyerName}</span>
                          <span className="text-2xl font-display font-bold text-primary">{b.score}%</span>
                        </div>
                        <p className="text-base text-white/40 mb-2">{b.companyType}</p>
                        <p className="text-sm text-white/25">{b.matchReasons.slice(0, 2).join(' · ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ScaledSlide>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Small components ─── */
function MetricCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-7 text-center space-y-3">
      <Icon className="h-7 w-7 text-primary mx-auto" />
      <p className="text-xs text-white/30 uppercase tracking-[0.2em]">{label}</p>
      <p className="text-2xl font-display font-semibold text-white capitalize">{value}</p>
    </div>
  );
}

function FinStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-sm text-white/30 mb-1">{label}</p>
      <p className={cn('text-xl font-display font-semibold', highlight ? 'text-amber-400' : 'text-white')}>{value}</p>
    </div>
  );
}

function VerdictCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-6">
      <p className="text-xs text-white/30 uppercase tracking-[0.2em] mb-3">{title}</p>
      <p className="text-base text-white/70 leading-relaxed">{text}</p>
    </div>
  );
}

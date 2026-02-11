import { useMemo, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Film, Tv, TrendingUp, DollarSign, Users, Target, BarChart3,
  ChevronLeft, ChevronRight, Maximize, Download, Building2
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

/* ─── Score Ring ─── */
function ScoreRing({ value, label, color, size = 120 }: { value: number; label: string; color: string; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={size * 0.06} />
          <motion.circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={size * 0.06}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-bold text-foreground" style={{ fontSize: size * 0.28 }}>
          {value}
        </span>
      </div>
      <span className="text-sm text-muted-foreground font-medium tracking-wide">{label}</span>
    </div>
  );
}

/* ─── Slide Shell ─── */
function Slide({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -60 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn('w-full h-full flex flex-col items-center justify-center px-12 md:px-24 py-12', className)}
    >
      {children}
    </motion.div>
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

  /* ─── Build slide list ─── */
  const slides = useMemo(() => {
    const s: string[] = ['title', 'scores'];
    if (confirmedCast.length > 0 || confirmedPartners.length > 0) s.push('team');
    if (financeScenarios.length > 0) s.push('finance');
    if (analysis?.verdict) s.push('verdict');
    if (analysis?.do_next?.length) s.push('strategy');
    if ((buyerMatches || []).length > 0) s.push('buyers');
    return s;
  }, [confirmedCast.length, confirmedPartners.length, financeScenarios.length, analysis, buyerMatches]);

  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const prev = useCallback(() => setCurrent(c => Math.max(0, c - 1)), []);
  const next = useCallback(() => setCurrent(c => Math.min(slides.length - 1, c + 1)), [slides.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen();
        else navigate(`/projects/${id}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, navigate, id]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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
        <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
      </div>
    );
  }

  const slideId = slides[current];

  return (
    <div className="min-h-screen bg-background flex flex-col select-none">
      {/* Top bar */}
      <div className={cn(
        'flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/90 backdrop-blur z-50 transition-opacity',
        isFullscreen && 'opacity-0 hover:opacity-100'
      )}>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${id}`)}>
          <X className="h-4 w-4 mr-1" /> Exit
        </Button>
        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === current ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'
              )}
            />
          ))}
          <span className="text-xs text-muted-foreground ml-2">{current + 1}/{slides.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExportPDF} title="Export PDF">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen} title="Fullscreen">
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Slide area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Nav arrows */}
        {current > 0 && (
          <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 z-40 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-background border border-border/50 transition-colors">
            <ChevronLeft className="h-5 w-5 text-foreground" />
          </button>
        )}
        {current < slides.length - 1 && (
          <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 z-40 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-background border border-border/50 transition-colors">
            <ChevronRight className="h-5 w-5 text-foreground" />
          </button>
        )}

        <AnimatePresence mode="wait">
          {/* ─── TITLE SLIDE ─── */}
          {slideId === 'title' && (
            <Slide key="title" className="text-center gap-6">
              {primaryCompany && (
                <div className="flex items-center gap-2.5 mb-2">
                  {primaryCompany.logo_url ? (
                    <img src={primaryCompany.logo_url} alt="" className="h-10 rounded-lg object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                  )}
                  <span className="text-sm font-medium text-muted-foreground">{primaryCompany.name}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                {project.format === 'tv-series' ? <Tv className="h-5 w-5" /> : <Film className="h-5 w-5" />}
                <span className="uppercase tracking-[0.2em] text-xs">
                  {project.format === 'tv-series' ? 'TV Series' : project.format === 'documentary' ? 'Documentary' : 'Feature Film'}
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-display font-bold text-foreground tracking-tight leading-tight max-w-4xl">
                {project.title}
              </h1>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {project.genres?.map(g => (
                  <Badge key={g} variant="secondary" className="text-sm px-3 py-1">{g}</Badge>
                ))}
              </div>
              {project.assigned_lane && (
                <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
              )}
              {project.comparable_titles && (
                <p className="text-sm text-muted-foreground mt-4 max-w-lg">
                  <span className="uppercase tracking-wider text-[10px] block mb-1">Comparable Titles</span>
                  {project.comparable_titles}
                </p>
              )}
            </Slide>
          )}

          {/* ─── SCORES SLIDE ─── */}
          {slideId === 'scores' && (
            <Slide key="scores" className="gap-12">
              <h2 className="text-3xl font-display font-semibold text-foreground">Project Readiness</h2>
              <div className="flex gap-16">
                {readiness && <ScoreRing value={readiness.score} label="Overall Readiness" color="hsl(var(--primary))" size={160} />}
                {financeReadiness && <ScoreRing value={financeReadiness.score} label="Finance Readiness" color="hsl(142 71% 45%)" size={160} />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4 w-full max-w-3xl">
                <InfoCard icon={DollarSign} label="Budget" value={project.budget_range || 'TBD'} />
                <InfoCard icon={Target} label="Audience" value={project.target_audience || 'TBD'} />
                <InfoCard icon={Users} label="Cast" value={`${confirmedCast.length} attached`} />
                <InfoCard icon={BarChart3} label="Stage" value={project.pipeline_stage.replace(/-/g, ' ')} />
              </div>
            </Slide>
          )}

          {/* ─── TEAM SLIDE ─── */}
          {slideId === 'team' && (
            <Slide key="team" className="gap-8">
              <h2 className="text-3xl font-display font-semibold text-foreground">Cast & Partners</h2>
              <div className="grid md:grid-cols-2 gap-10 w-full max-w-4xl">
                {confirmedCast.length > 0 && (
                  <div>
                    <h3 className="text-lg font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" /> Cast
                    </h3>
                    <div className="space-y-2">
                      {confirmedCast.slice(0, 8).map(c => (
                        <div key={c.id} className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 flex justify-between items-center">
                          <span className="font-medium text-foreground">{c.actor_name}</span>
                          <span className="text-sm text-muted-foreground">{c.role_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {confirmedPartners.length > 0 && (
                  <div>
                    <h3 className="text-lg font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" /> Partners
                    </h3>
                    <div className="space-y-2">
                      {confirmedPartners.slice(0, 8).map(p => (
                        <div key={p.id} className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 flex justify-between items-center">
                          <div>
                            <span className="font-medium text-foreground">{p.partner_name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{p.partner_type}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{p.territory}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Slide>
          )}

          {/* ─── FINANCE SLIDE ─── */}
          {slideId === 'finance' && (
            <Slide key="finance" className="gap-8">
              <h2 className="text-3xl font-display font-semibold text-foreground">Finance Plan</h2>
              <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl">
                {financeScenarios.slice(0, 4).map(fs => (
                  <div key={fs.id} className="rounded-xl border border-border/50 bg-card/50 p-6">
                    <h4 className="font-display font-semibold text-foreground mb-4 text-lg">{fs.scenario_name}</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {fs.total_budget && <Stat label="Budget" value={`$${fs.total_budget}`} />}
                      {fs.presales_amount && <Stat label="Pre-sales" value={`$${fs.presales_amount}`} />}
                      {fs.equity_amount && <Stat label="Equity" value={`$${fs.equity_amount}`} />}
                      {fs.incentive_amount && <Stat label="Incentives" value={`$${fs.incentive_amount}`} />}
                      {fs.gap_amount && <Stat label="Gap" value={`$${fs.gap_amount}`} />}
                      {fs.other_sources && <Stat label="Other" value={`$${fs.other_sources}`} />}
                    </div>
                    <Badge variant="outline" className="mt-3 text-xs">{fs.confidence} confidence</Badge>
                  </div>
                ))}
              </div>
            </Slide>
          )}

          {/* ─── VERDICT SLIDE ─── */}
          {slideId === 'verdict' && (
            <Slide key="verdict" className="gap-8">
              <h2 className="text-3xl font-display font-semibold text-foreground">IFFY Verdict</h2>
              <div className="max-w-3xl w-full rounded-xl border-l-4 border-primary bg-card/50 border border-border/50 p-8">
                <p className="text-lg text-foreground leading-relaxed">{analysis?.verdict}</p>
              </div>
              {analysis?.market_reality && (
                <div className="grid md:grid-cols-3 gap-6 max-w-4xl w-full mt-4">
                  <MiniCard title="Audience" text={analysis.market_reality.likely_audience} />
                  <MiniCard title="Budget Implications" text={analysis.market_reality.budget_implications} />
                  <MiniCard title="Risks" text={analysis.market_reality.commercial_risks} />
                </div>
              )}
            </Slide>
          )}

          {/* ─── STRATEGY SLIDE ─── */}
          {slideId === 'strategy' && (
            <Slide key="strategy" className="gap-8">
              <h2 className="text-3xl font-display font-semibold text-foreground">Strategic Next Steps</h2>
              <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full">
                <div>
                  <h3 className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">Do Next</h3>
                  <div className="space-y-3">
                    {analysis?.do_next?.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="text-primary font-bold text-sm mt-0.5">{i + 1}</span>
                        <p className="text-foreground text-sm leading-relaxed">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {analysis?.avoid && analysis.avoid.length > 0 && (
                  <div>
                    <h3 className="text-sm uppercase tracking-wider text-destructive font-semibold mb-4">Avoid</h3>
                    <div className="space-y-3">
                      {analysis.avoid.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex gap-3 items-start">
                          <span className="text-destructive font-bold text-sm mt-0.5">✕</span>
                          <p className="text-foreground text-sm leading-relaxed">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Slide>
          )}

          {/* ─── BUYERS SLIDE ─── */}
          {slideId === 'buyers' && (
            <Slide key="buyers" className="gap-8">
              <h2 className="text-3xl font-display font-semibold text-foreground">Top Buyer Matches</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-4xl">
                {(buyerMatches || []).slice(0, 6).map(b => (
                  <div key={b.buyerId} className="rounded-xl border border-border/50 bg-card/50 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">{b.buyerName}</span>
                      <Badge variant="outline" className="text-xs">{b.score}%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{b.companyType}</p>
                    <p className="text-xs text-muted-foreground mt-1">{b.matchReasons.slice(0, 2).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </Slide>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Small components ─── */
function InfoCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-5 text-center space-y-2">
      <Icon className="h-5 w-5 text-primary mx-auto" />
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-base font-display font-semibold text-foreground capitalize">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function MiniCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{title}</p>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  );
}

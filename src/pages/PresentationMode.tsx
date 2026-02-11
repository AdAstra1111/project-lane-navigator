import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X, Film, Tv, TrendingUp, DollarSign, Users, Target, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LaneBadge } from '@/components/LaneBadge';
import { useProject } from '@/hooks/useProjects';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { useCompanies } from '@/hooks/useCompanies';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';
import { MonetisationLane, LANE_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

function ScoreRing({ value, label, color }: { value: number; label: string; color: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="100" height="100" className="transform -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <motion.circle
            cx="50" cy="50" r={radius}
            fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-foreground">
          {value}
        </span>
      </div>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

export default function PresentationMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { project, isLoading } = useProject(id);
  const { cast } = useProjectCast(id);
  const { partners } = useProjectPartners(id);
  const { scripts } = useProjectScripts(id);
  const { scenarios: financeScenarios } = useProjectFinance(id);
  const { hods } = useProjectHODs(id);
  const { companies } = useCompanies();
  const primaryCompany = companies.length > 0 ? companies[0] : null;

  const readiness = useMemo(() => {
    if (!project) return null;
    return calculateReadiness(project, cast, partners, scripts, financeScenarios, hods, false);
  }, [project, cast, partners, scripts, financeScenarios, hods]);

  const financeReadiness = useMemo(() => {
    if (!project) return null;
    return calculateFinanceReadiness(project, cast, partners, scripts, financeScenarios, hods, false);
  }, [project, cast, partners, scripts, financeScenarios, hods]);

  if (isLoading || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const confirmedCast = cast.filter(c => c.status === 'confirmed' || c.status === 'offer');
  const confirmedPartners = partners.filter(p => p.status === 'confirmed' || p.status === 'in-talks');

  return (
    <div className="min-h-screen bg-background">
      {/* Exit button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 right-4 z-50 bg-background/80 backdrop-blur"
        onClick={() => navigate(`/projects/${id}`)}
      >
        <X className="h-5 w-5" />
      </Button>

      <div className="max-w-5xl mx-auto px-8 py-16 space-y-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          {primaryCompany && (
            <div className="flex items-center justify-center gap-2 mb-4">
              {primaryCompany.logo_url ? (
                <img src={primaryCompany.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : null}
              <span className="text-sm font-medium text-muted-foreground">{primaryCompany.name}</span>
            </div>
          )}
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            {project.format === 'tv-series' ? <Tv className="h-5 w-5" /> : <Film className="h-5 w-5" />}
            <span className="uppercase tracking-widest text-xs">{project.format === 'tv-series' ? 'TV Series' : 'Feature Film'}</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-display font-bold text-foreground tracking-tight">
            {project.title}
          </h1>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {project.genres?.map(g => (
              <Badge key={g} variant="secondary" className="text-sm">{g}</Badge>
            ))}
          </div>
          {project.assigned_lane && (
            <div className="pt-2">
              <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
            </div>
          )}
        </motion.div>

        {/* Scores */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex justify-center gap-12"
        >
          {readiness && (
            <ScoreRing value={readiness.score} label="Readiness" color="hsl(var(--primary))" />
          )}
          {financeReadiness && (
            <ScoreRing value={financeReadiness.score} label="Finance Ready" color="hsl(142 71% 45%)" />
          )}
        </motion.div>

        {/* Key Info Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-6"
        >
          <InfoCard icon={DollarSign} label="Budget" value={project.budget_range || 'TBD'} />
          <InfoCard icon={Target} label="Audience" value={project.target_audience || 'TBD'} />
          <InfoCard icon={Users} label="Cast Attached" value={`${confirmedCast.length} confirmed`} />
          <InfoCard icon={BarChart3} label="Stage" value={project.pipeline_stage.replace('-', ' ')} />
        </motion.div>

        {/* Cast & Partners */}
        {(confirmedCast.length > 0 || confirmedPartners.length > 0) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="grid md:grid-cols-2 gap-8"
          >
            {confirmedCast.length > 0 && (
              <div>
                <h3 className="text-lg font-display font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Cast
                </h3>
                <div className="space-y-2">
                  {confirmedCast.slice(0, 6).map(c => (
                    <div key={c.id} className="glass-card rounded-lg px-4 py-3 flex justify-between">
                      <span className="font-medium text-foreground">{c.actor_name}</span>
                      <span className="text-sm text-muted-foreground">{c.role_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {confirmedPartners.length > 0 && (
              <div>
                <h3 className="text-lg font-display font-semibold text-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Partners
                </h3>
                <div className="space-y-2">
                  {confirmedPartners.slice(0, 6).map(p => (
                    <div key={p.id} className="glass-card rounded-lg px-4 py-3 flex justify-between">
                      <span className="font-medium text-foreground">{p.partner_name}</span>
                      <span className="text-sm text-muted-foreground">{p.territory}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Finance Scenarios */}
        {financeScenarios.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
          >
            <h3 className="text-lg font-display font-semibold text-foreground mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Finance Plan
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              {financeScenarios.slice(0, 2).map(fs => (
                <div key={fs.id} className="glass-card rounded-xl p-5">
                  <h4 className="font-medium text-foreground mb-2">{fs.scenario_name}</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {fs.total_budget && <div><span className="text-muted-foreground">Budget:</span> <span className="text-foreground">${fs.total_budget}</span></div>}
                    {fs.presales_amount && <div><span className="text-muted-foreground">Pre-sales:</span> <span className="text-foreground">${fs.presales_amount}</span></div>}
                    {fs.equity_amount && <div><span className="text-muted-foreground">Equity:</span> <span className="text-foreground">${fs.equity_amount}</span></div>}
                    {fs.incentive_amount && <div><span className="text-muted-foreground">Incentives:</span> <span className="text-foreground">${fs.incentive_amount}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Comparable Titles */}
        {project.comparable_titles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            className="text-center"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Comparable Titles</p>
            <p className="text-lg text-foreground">{project.comparable_titles}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="glass-card rounded-xl p-5 text-center space-y-2">
      <Icon className="h-5 w-5 text-primary mx-auto" />
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-lg font-display font-semibold text-foreground capitalize">{value}</p>
    </div>
  );
}

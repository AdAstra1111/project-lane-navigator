import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowLeftRight, ChevronDown } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LaneBadge } from '@/components/LaneBadge';
import { ProjectReadinessScore } from '@/components/project/ProjectReadinessScore';
import { FinanceReadinessBreakdown } from '@/components/finance/FinanceReadinessBreakdown';
import { useProjects, useProject } from '@/hooks/useProjects';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';
import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import { cn } from '@/lib/utils';

function ProjectColumn({ projectId }: { projectId: string }) {
  const { project, isLoading } = useProject(projectId);
  const { cast } = useProjectCast(projectId);
  const { partners } = useProjectPartners(projectId);
  const { scripts } = useProjectScripts(projectId);
  const { scenarios: financeScenarios } = useProjectFinance(projectId);
  const { hods } = useProjectHODs(projectId);

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
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    );
  }

  const attachedCast = cast.filter(c => c.status === 'attached');
  const attachedHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const confirmedPartners = partners.filter(p => p.status === 'confirmed');

  return (
    <div className="space-y-4">
      {/* Title & Lane */}
      <div>
        <Link to={`/projects/${project.id}`} className="text-lg font-display font-bold text-foreground hover:text-primary transition-colors">
          {project.title}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{project.format === 'tv-series' ? 'TV Series' : 'Film'}</span>
          {project.assigned_lane && <LaneBadge lane={project.assigned_lane as any} size="sm" />}
        </div>
      </div>

      {/* Readiness Score */}
      {readiness && (
        <div className="glass-card rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Readiness</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-foreground">{readiness.score}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <Badge className="text-[10px]">{readiness.stage}</Badge>

          {/* Breakdown bars */}
          <div className="space-y-2">
            {[
              { label: 'Script', value: readiness.breakdown.script, max: 25 },
              { label: 'Packaging', value: readiness.breakdown.packaging, max: 30 },
              { label: 'Finance', value: readiness.breakdown.finance, max: 25 },
              { label: 'Market', value: readiness.breakdown.market, max: 20 },
            ].map(item => (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="text-foreground font-medium">{item.value}/{item.max}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${(item.value / item.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Script Coverage Verdict */}
      {project.script_coverage_verdict && (
        <div className="glass-card rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-medium text-foreground">Script Coverage</h3>
          <div className="flex items-center gap-2">
            <Badge className={cn(
              'text-xs',
              project.script_coverage_verdict === 'RECOMMEND' && 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
              project.script_coverage_verdict === 'CONSIDER' && 'bg-amber-500/15 text-amber-400 border-amber-500/30',
              project.script_coverage_verdict === 'PASS' && 'bg-red-500/15 text-red-400 border-red-500/30',
            )}>
              {project.script_coverage_verdict}
            </Badge>
          </div>
        </div>
      )}

      {/* Key Details */}
      <div className="glass-card rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Project Details</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">Budget:</span> <span className="text-foreground">{project.budget_range || '—'}</span></div>
          <div><span className="text-muted-foreground">Audience:</span> <span className="text-foreground">{project.target_audience || '—'}</span></div>
          <div><span className="text-muted-foreground">Tone:</span> <span className="text-foreground">{project.tone || '—'}</span></div>
          <div><span className="text-muted-foreground">Genres:</span> <span className="text-foreground">{project.genres?.join(', ') || '—'}</span></div>
        </div>
      </div>

      {/* Packaging Summary */}
      <div className="glass-card rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Packaging</h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cast attached</span>
            <span className="text-foreground font-medium">{attachedCast.length}</span>
          </div>
          {attachedCast.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachedCast.map(c => (
                <span key={c.id} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">{c.actor_name}</span>
              ))}
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">HODs attached</span>
            <span className="text-foreground font-medium">{attachedHods.length}</span>
          </div>
          {attachedHods.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachedHods.map(h => (
                <span key={h.id} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">{h.person_name} ({h.department})</span>
              ))}
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Partners confirmed</span>
            <span className="text-foreground font-medium">{confirmedPartners.length}</span>
          </div>
        </div>
      </div>

      {/* Strengths & Blockers */}
      {readiness && (
        <div className="glass-card rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">Assessment</h3>
          {readiness.strengths.length > 0 && (
            <div className="space-y-1">
              {readiness.strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <span className="text-emerald-400 shrink-0">✓</span>
                  <span className="text-foreground">{s}</span>
                </div>
              ))}
            </div>
          )}
          {readiness.blockers.length > 0 && (
            <div className="space-y-1">
              {readiness.blockers.map((b, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <span className="text-red-400 shrink-0">✗</span>
                  <span className="text-foreground">{b}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-primary font-medium">{readiness.bestNextStep}</p>
        </div>
      )}

      {/* Greenlight Probability */}
      {financeReadiness && (
        <div className="glass-card rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Greenlight Probability</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-2xl font-bold',
                financeReadiness.score >= 70 ? 'text-emerald-400' : financeReadiness.score >= 40 ? 'text-amber-400' : 'text-red-400'
              )}>{financeReadiness.score}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge className="text-[10px]">Vol: {financeReadiness.volatilityIndex}</Badge>
            <Badge className="text-[10px]">{financeReadiness.geographySensitivity}</Badge>
          </div>
          <FinanceReadinessBreakdown subscores={financeReadiness.subscores} />
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {(['low', 'target', 'stretch'] as const).map(key => {
              const band = financeReadiness.budgetBands[key];
              return (
                <div key={key} className={cn('rounded border p-1.5', key === 'target' ? 'border-primary/30 bg-primary/5' : 'border-border')}>
                  <p className="text-[9px] text-muted-foreground uppercase">{key}</p>
                  <p className="text-[11px] font-semibold text-foreground">{band.rangeHint}</p>
                </div>
              );
            })}
          </div>
          {financeReadiness.riskFlags.length > 0 && (
            <div className="text-xs text-red-400">
              ⚠ {financeReadiness.riskFlags.length} risk flag{financeReadiness.riskFlags.length !== 1 ? 's' : ''}: <span className="text-muted-foreground">{financeReadiness.riskFlags.map(f => f.tag).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CompareProjects() {
  const { projects, isLoading } = useProjects();
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');

  // Auto-select first two projects
  const initialized = useMemo(() => {
    if (projects.length >= 2 && !leftId && !rightId) {
      setLeftId(projects[0].id);
      setRightId(projects[1].id);
      return true;
    }
    return leftId && rightId;
  }, [projects, leftId, rightId]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>

          <div className="flex items-center gap-3">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-display font-bold text-foreground">Compare Scenarios</h1>
          </div>

          {isLoading ? (
            <div className="animate-pulse h-64 bg-muted rounded-lg" />
          ) : projects.length < 2 ? (
            <div className="glass-card rounded-lg p-8 text-center">
              <p className="text-muted-foreground">You need at least 2 projects to compare. Duplicate a project from its detail page to create a scenario variant.</p>
              <Link to="/dashboard">
                <Button variant="outline" className="mt-4">Back to Dashboard</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Project selectors */}
              <div className="grid grid-cols-2 gap-6">
                <Select value={leftId} onValueChange={setLeftId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select project A" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.filter(p => p.id !== rightId).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={rightId} onValueChange={setRightId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select project B" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.filter(p => p.id !== leftId).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Side-by-side columns */}
              <div className="grid grid-cols-2 gap-6">
                {leftId && <ProjectColumn projectId={leftId} />}
                {rightId && <ProjectColumn projectId={rightId} />}
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}

/**
 * ProjectProfileCoverage: Coverage panel for the project overview/profile.
 * Shows whole-package, narrative, and per-document coverage.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { Shield, FileSearch, AlertTriangle, ChevronDown, ChevronUp, Play, Loader2, BookOpen, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getBundleDefinitions } from '@/lib/coverage/bundles';
import { normalizeDocRole } from '@/lib/coverage/normalizeDocRole';
import { COVERAGE_ROLE_LABELS } from '@/lib/coverage/types';
import type { CoverageRunRow, CoverageOutput, BundleKey } from '@/lib/coverage/types';

interface Props {
  projectId: string;
  format: string;
}

function ScoreChip({ score, label }: { score: number | null; label: string }) {
  if (score == null) return null;
  const color = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-primary' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  const bg = score >= 80 ? 'bg-emerald-500/10' : score >= 60 ? 'bg-primary/10' : score >= 40 ? 'bg-amber-500/10' : 'bg-red-500/10';
  return (
    <div className={`rounded-lg px-3 py-2 ${bg} text-center min-w-[80px]`}>
      <div className={`text-2xl font-bold font-mono ${color}`}>{Math.round(score)}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function BundleCard({ bundleKey, bundleName, run, onRun, isRunning }: {
  bundleKey: BundleKey;
  bundleName: string;
  run: CoverageRunRow | null;
  onRun: () => void;
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const output = run?.output as CoverageOutput | undefined;

  const icon = bundleKey === 'NARRATIVE' ? BookOpen : bundleKey === 'COMMERCIAL' ? TrendingUp : Shield;
  const Icon = icon;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">{bundleName}</h4>
        </div>
        <div className="flex items-center gap-2">
          {!run && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Not run</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onRun}
            disabled={isRunning}
            className="h-7 text-xs"
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
            {run ? 'Rerun' : 'Run'}
          </Button>
        </div>
      </div>

      {run && output?.scores ? (
        <>
          <div className="flex gap-2 flex-wrap">
            <ScoreChip score={output.scores.creative?.score ?? null} label="Creative" />
            <ScoreChip score={output.scores.commercial?.score ?? null} label="Commercial" />
            {output.scores.narrative && <ScoreChip score={output.scores.narrative.score} label="Narrative" />}
            <ScoreChip score={output.confidence?.score ?? null} label="Confidence" />
          </div>

          {/* Risk flags count */}
          {(output.risk_flags?.length || 0) > 0 && (
            <div className="mt-2 flex items-center gap-1 text-xs text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {output.risk_flags.length} risk flag{output.risk_flags.length !== 1 ? 's' : ''}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="mt-3 space-y-3 text-xs"
            >
              {/* Strengths */}
              {output.strengths?.length > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Strengths</p>
                  <ul className="space-y-0.5">
                    {output.strengths.map((s, i) => (
                      <li key={i} className="text-emerald-400">✓ {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses */}
              {output.weaknesses?.length > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Weaknesses</p>
                  <ul className="space-y-0.5">
                    {output.weaknesses.map((w, i) => (
                      <li key={i} className="text-amber-400">⚠ {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Contradictions */}
              {output.contradictions?.length > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Contradictions</p>
                  {output.contradictions.map((c, i) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-lg p-2 mb-1">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Badge variant="outline" className={`text-[9px] ${c.severity === 'high' ? 'border-red-500/50 text-red-400' : 'border-amber-500/50 text-amber-400'}`}>
                          {c.severity}
                        </Badge>
                        <span className="text-foreground">{c.type}</span>
                      </div>
                      <p className="text-muted-foreground">{c.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {output.recommendations?.length > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Recommendations</p>
                  {output.recommendations.slice(0, 5).map((r, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1">
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${r.priority === 'high' ? 'border-red-500/50 text-red-400' : r.priority === 'med' ? 'border-amber-500/50 text-amber-400' : 'border-muted-foreground/50'}`}>
                        {r.priority}
                      </Badge>
                      <div>
                        <p className="text-foreground font-medium">{r.title}</p>
                        <p className="text-muted-foreground">{r.action}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </>
      ) : !isRunning ? (
        <p className="text-xs text-muted-foreground">Run coverage to see creative, commercial, and narrative scores.</p>
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}
    </div>
  );
}

export function ProjectProfileCoverage({ projectId, format }: Props) {
  const queryClient = useQueryClient();
  const bundles = getBundleDefinitions(format);
  const [runningBundle, setRunningBundle] = useState<string | null>(null);

  // Fetch subjects + latest runs
  const { data: coverageData, isLoading } = useQuery({
    queryKey: ['project-coverage', projectId],
    queryFn: async () => {
      const { data: subjects } = await supabase
        .from('project_coverage_subjects')
        .select('*')
        .eq('project_id', projectId);

      if (!subjects?.length) return { subjects: [], runs: {} };

      const subjectIds = subjects.map(s => s.id);
      const { data: runs } = await supabase
        .from('project_coverage_runs')
        .select('*')
        .in('subject_id', subjectIds)
        .order('created_at', { ascending: false });

      // Build latest run per subject
      const latestBySubject: Record<string, any> = {};
      for (const run of (runs || [])) {
        if (!latestBySubject[run.subject_id]) {
          latestBySubject[run.subject_id] = run;
        }
      }

      return { subjects, runs: latestBySubject };
    },
  });

  // Fetch docs for per-document list
  const { data: projectDocs } = useQuery({
    queryKey: ['project-docs-coverage', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_documents')
        .select('id, doc_type, title, file_name, latest_version_id')
        .eq('project_id', projectId)
        .not('latest_version_id', 'is', null);
      return data || [];
    },
  });

  const runCoverage = useMutation({
    mutationFn: async ({ bundleKey }: { bundleKey: BundleKey }) => {
      setRunningBundle(bundleKey);
      const { data, error } = await supabase.functions.invoke('coverage-engine', {
        body: {
          projectId,
          subject: { type: 'bundle', bundleKey },
        },
      });
      if (error) throw error;
      if (data?.error === 'RATE_LIMIT') throw new Error('AI rate limit reached. Please wait a moment and try again.');
      if (data?.error === 'PAYMENT_REQUIRED') throw new Error('AI usage limit reached. Please check your plan.');
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Coverage analysis complete');
      queryClient.invalidateQueries({ queryKey: ['project-coverage', projectId] });
      setRunningBundle(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Coverage analysis failed');
      setRunningBundle(null);
    },
  });

  const runDocCoverage = useMutation({
    mutationFn: async (docVersionId: string) => {
      const { data, error } = await supabase.functions.invoke('coverage-engine', {
        body: {
          projectId,
          subject: { type: 'document_version', documentVersionId: docVersionId },
        },
      });
      if (error) throw error;
      if (data?.error === 'RATE_LIMIT') throw new Error('AI rate limit reached. Please wait a moment and try again.');
      if (data?.error === 'PAYMENT_REQUIRED') throw new Error('AI usage limit reached. Please check your plan.');
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Document coverage complete');
      queryClient.invalidateQueries({ queryKey: ['project-coverage', projectId] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Document coverage failed');
    },
  });

  // Map bundle subjects to latest runs
  const getBundleRun = (key: string): CoverageRunRow | null => {
    if (!coverageData) return null;
    const subject = coverageData.subjects.find(
      (s: any) => s.subject_type === 'bundle' && s.bundle_key === key
    );
    if (!subject) return null;
    return (coverageData.runs[subject.id] as CoverageRunRow) || null;
  };

  const getDocRun = (versionId: string): CoverageRunRow | null => {
    if (!coverageData) return null;
    const subject = coverageData.subjects.find(
      (s: any) => s.subject_type === 'document_version' && s.document_version_id === versionId
    );
    if (!subject) return null;
    return (coverageData.runs[subject.id] as CoverageRunRow) || null;
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-sm">Project Profile Coverage</h3>
      </div>

      {/* Bundle Cards */}
      <div className="space-y-3">
        {bundles.map((bundle) => (
          <BundleCard
            key={bundle.key}
            bundleKey={bundle.key}
            bundleName={bundle.name}
            run={getBundleRun(bundle.key)}
            onRun={() => runCoverage.mutate({ bundleKey: bundle.key })}
            isRunning={runningBundle === bundle.key}
          />
        ))}
      </div>

      {/* Per-Document Coverage */}
      {projectDocs && projectDocs.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Coverage by Document</h4>
          <div className="space-y-1.5">
            {projectDocs.map((doc: any) => {
              const role = normalizeDocRole({ doc_type: doc.doc_type, title: doc.title, file_name: doc.file_name });
              const run = doc.latest_version_id ? getDocRun(doc.latest_version_id) : null;
              const output = run?.output as CoverageOutput | undefined;

              return (
                <div key={doc.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{doc.title || doc.file_name}</p>
                    <Badge variant="outline" className="text-[9px] mt-0.5">{COVERAGE_ROLE_LABELS[role] || role}</Badge>
                  </div>
                  {run && output?.scores ? (
                    <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
                      <span className={output.scores.creative?.score >= 60 ? 'text-emerald-400' : 'text-amber-400'}>
                        C:{output.scores.creative?.score ?? '–'}
                      </span>
                      <span className={output.scores.commercial?.score >= 60 ? 'text-emerald-400' : 'text-amber-400'}>
                        M:{output.scores.commercial?.score ?? '–'}
                      </span>
                      {output.risk_flags?.length > 0 && (
                        <span className="text-red-400">⚑{output.risk_flags.length}</span>
                      )}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => doc.latest_version_id && runDocCoverage.mutate(doc.latest_version_id)}
                      disabled={runDocCoverage.isPending || !doc.latest_version_id}
                      className="h-6 text-[10px] px-2"
                    >
                      {runDocCoverage.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

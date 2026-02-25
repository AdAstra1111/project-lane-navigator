/**
 * Demo Dashboard — One-click investor demo orchestration.
 * Deterministic project selection + pipeline status + artifact display.
 */
import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDemoProject } from '@/hooks/useDemoProject';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Play, CheckCircle2, XCircle, Loader2, AlertTriangle,
  FileText, Film, Layout, Scissors, Package, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

/* ── Pipeline step definitions ── */

const PIPELINE_STEPS = [
  { key: 'analysis', label: 'Analysis', icon: FileText },
  { key: 'trailer', label: 'Trailer', icon: Film },
  { key: 'storyboard', label: 'Storyboard', icon: Layout },
  { key: 'rough_cut', label: 'Rough Cut', icon: Scissors },
  { key: 'export', label: 'Export Bundle', icon: Package },
] as const;

type StepKey = typeof PIPELINE_STEPS[number]['key'];
type StepStatus = 'pending' | 'running' | 'complete' | 'error' | 'unavailable';

interface StepState {
  status: StepStatus;
  error?: string;
  artifactId?: string;
}

/* ── Component ── */

export default function DemoDashboard() {
  const { selection, isLoading } = useDemoProject();
  const qc = useQueryClient();
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    analysis: { status: 'pending' },
    trailer: { status: 'pending' },
    storyboard: { status: 'pending' },
    rough_cut: { status: 'pending' },
    export: { status: 'pending' },
  });
  const [isRunning, setIsRunning] = useState(false);

  const updateStep = useCallback((key: StepKey, update: Partial<StepState>) => {
    setSteps(prev => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }, []);

  // Fetch existing demo run artifacts
  const { data: artifacts } = useQuery({
    queryKey: ['demo-dashboard-artifacts', selection?.projectId],
    queryFn: async () => {
      if (!selection) return null;
      const pid = selection.projectId;
      const [analysisRes, trailerRes, storyboardRes, roughCutRes, bundleRes] = await Promise.all([
        supabase.from('cinematic_quality_runs').select('id, final_pass, final_score, created_at')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
        (supabase as any).from('demo_runs').select('id, status, step, created_at')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
        (supabase as any).from('storyboard_runs').select('id, status, created_at')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
        (supabase as any).from('rough_cuts').select('id, status, created_at')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
        (supabase as any).from('demo_bundles').select('id, storage_path, created_at')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
      ]);
      return {
        analysis: analysisRes.data?.[0] || null,
        trailer: trailerRes.data?.[0] || null,
        storyboard: storyboardRes.data?.[0] || null,
        roughCut: roughCutRes.data?.[0] || null,
        bundle: bundleRes.data?.[0] || null,
      };
    },
    enabled: !!selection?.projectId,
    refetchInterval: isRunning ? 4000 : false,
  });

  // ── Orchestration ──
  const runDemo = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('No demo project selected');
      setIsRunning(true);
      const { projectId, documentId, includeDocumentIds, lane } = selection;

      // Step 1: Analysis
      updateStep('analysis', { status: 'running' });
      try {
        const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single();
        if (!project) throw new Error('Project not found');
        const allDocs = await supabase.from('project_documents').select('file_path')
          .eq('project_id', projectId);
        const paths = (allDocs.data || []).map(d => d.file_path).filter((p): p is string => !!p);
        await supabase.functions.invoke('analyze-project', {
          body: {
            projectInput: {
              id: project.id, title: project.title,
              genres: project.genres, target_audience: project.target_audience,
              tone: project.tone, comparable_titles: project.comparable_titles,
            },
            documentPaths: paths,
            ...(includeDocumentIds ? { includeDocumentIds } : {}),
          },
        });
        updateStep('analysis', { status: 'complete' });
      } catch (e: any) {
        updateStep('analysis', { status: 'error', error: e.message });
        // Continue despite analysis error
      }

      // Step 2: Trailer
      updateStep('trailer', { status: 'running' });
      try {
        const { data, error } = await supabase.functions.invoke('trailer-cinematic-engine', {
          body: {
            project_id: projectId,
            document_id: documentId,
            action: 'create_trailer_script_v2',
            ...(includeDocumentIds ? { include_document_ids: includeDocumentIds } : {}),
          },
        });
        if (error) throw error;
        updateStep('trailer', { status: 'complete', artifactId: data?.run_id });
      } catch (e: any) {
        updateStep('trailer', { status: 'error', error: e.message });
      }

      // Step 3: Storyboard
      updateStep('storyboard', { status: 'running' });
      try {
        const { data, error } = await supabase.functions.invoke('storyboard-engine', {
          body: {
            project_id: projectId,
            ...(includeDocumentIds ? { include_document_ids: includeDocumentIds } : {}),
          },
        });
        if (error) throw error;
        updateStep('storyboard', { status: 'complete', artifactId: data?.run_id });
      } catch (e: any) {
        updateStep('storyboard', { status: 'error', error: e.message });
      }

      // Step 4: Rough Cut
      updateStep('rough_cut', { status: 'running' });
      try {
        const { data, error } = await supabase.functions.invoke('create-rough-cut', {
          body: { project_id: projectId },
        });
        if (error) throw error;
        updateStep('rough_cut', { status: 'complete', artifactId: data?.id });
      } catch (e: any) {
        updateStep('rough_cut', { status: 'unavailable', error: 'Requires completed render jobs' });
      }

      // Step 5: Export Bundle
      updateStep('export', { status: 'running' });
      try {
        const { data, error } = await supabase.functions.invoke('export-demo-bundle', {
          body: { project_id: projectId },
        });
        if (error) throw error;
        updateStep('export', { status: 'complete', artifactId: data?.url });
      } catch (e: any) {
        updateStep('export', { status: 'unavailable', error: 'Requires completed pipeline' });
      }

      qc.invalidateQueries({ queryKey: ['demo-dashboard-artifacts', projectId] });
      setIsRunning(false);
    },
    onError: (e: any) => {
      toast.error('Demo pipeline failed: ' + e.message);
      setIsRunning(false);
    },
    onSuccess: () => {
      toast.success('Demo pipeline complete');
    },
  });

  const completedCount = Object.values(steps).filter(s => s.status === 'complete').length;
  const progress = isRunning ? Math.round((completedCount / PIPELINE_STEPS.length) * 100) : (completedCount > 0 ? Math.round((completedCount / PIPELINE_STEPS.length) * 100) : 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Demo Mode</h1>
            {selection && (
              <p className="text-sm text-muted-foreground mt-1">
                Project: <span className="font-medium text-foreground">{selection.projectTitle}</span>
                <Badge variant="outline" className="ml-2 text-[10px]">{selection.lane}</Badge>
                {selection.docSetId && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">Doc Set</Badge>
                )}
              </p>
            )}
          </div>
          <Button
            size="lg"
            disabled={!selection || isRunning || runDemo.isPending}
            onClick={() => runDemo.mutate()}
            className="gap-2"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isRunning ? 'Running…' : 'Run Demo'}
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Selecting demo project…
          </div>
        )}

        {!isLoading && !selection && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
              <p>No projects found. Create a project first to use Demo Mode.</p>
            </CardContent>
          </Card>
        )}

        {/* Progress */}
        {(isRunning || completedCount > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pipeline Progress</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Step Timeline */}
        {selection && (
          <div className="grid gap-3">
            {PIPELINE_STEPS.map((step, idx) => {
              const state = steps[step.key];
              const Icon = step.icon;
              return (
                <Card key={step.key} className={state.status === 'running' ? 'border-primary/50 shadow-sm' : ''}>
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{step.label}</span>
                        <StepBadge status={state.status} />
                      </div>
                      {state.error && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{state.error}</p>
                      )}
                    </div>
                    {idx < PIPELINE_STEPS.length - 1 && state.status === 'complete' && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Existing Artifacts */}
        {artifacts && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Latest Artifacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ArtifactRow
                label="Analysis"
                exists={!!artifacts.analysis}
                detail={artifacts.analysis ? `Score: ${artifacts.analysis.final_score} | ${artifacts.analysis.final_pass ? 'Pass' : 'Fail'}` : undefined}
              />
              <ArtifactRow
                label="Demo Run"
                exists={!!artifacts.trailer}
                detail={artifacts.trailer ? `Status: ${artifacts.trailer.status} | Step: ${artifacts.trailer.step}` : undefined}
              />
              <ArtifactRow
                label="Storyboard"
                exists={!!artifacts.storyboard}
                detail={artifacts.storyboard ? `Status: ${artifacts.storyboard.status}` : undefined}
              />
              <ArtifactRow
                label="Rough Cut"
                exists={!!artifacts.roughCut}
                detail={artifacts.roughCut ? `Status: ${artifacts.roughCut.status}` : undefined}
              />
              <ArtifactRow
                label="Bundle"
                exists={!!artifacts.bundle}
                detail={artifacts.bundle ? 'Ready' : undefined}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

/* ── Sub-components ── */

function StepBadge({ status }: { status: StepStatus }) {
  switch (status) {
    case 'running': return <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Running</Badge>;
    case 'complete': return <Badge className="text-[10px] px-1.5 py-0 bg-accent text-accent-foreground gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Complete</Badge>;
    case 'error': return <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1"><XCircle className="h-2.5 w-2.5" />Error</Badge>;
    case 'unavailable': return <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">Not available</Badge>;
    default: return <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">Pending</Badge>;
  }
}

function ArtifactRow({ label, exists, detail }: { label: string; exists: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      {exists ? (
        <span className="text-foreground">{detail || 'Available'}</span>
      ) : (
        <span className="text-muted-foreground italic">None</span>
      )}
    </div>
  );
}

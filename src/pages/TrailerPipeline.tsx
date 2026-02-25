/**
 * Trailer Pipeline v2 — Cinematic Intelligence Studio
 * Tabbed layout: Script Studio, Rhythm Grid, Shot Design, Plans, etc.
 */
import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ArrowLeft, Film, Sparkles, Music, Camera, Clapperboard, Wand2, Paintbrush, Video, Loader2, LayoutList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrailerScriptStudio } from '@/components/trailer/cinematic/TrailerScriptStudio';
import { RhythmGridViewer } from '@/components/trailer/cinematic/RhythmGridViewer';
import { RhythmTimelineOverlay } from '@/components/trailer/cinematic/RhythmTimelineOverlay';
import { ShotDesignViewer } from '@/components/trailer/cinematic/ShotDesignViewer';
import { AutoAssemblyPanel } from '@/components/trailer/cinematic/AutoAssemblyPanel';
import { ContinuityPanel } from '@/components/trailer/cinematic/ContinuityPanel';
import { StudioFinishPanel } from '@/components/trailer/cinematic/StudioFinishPanel';
import { LearningBiasIndicator } from '@/components/trailer/cinematic/LearningBiasIndicator';
import { CanonPackManager } from '@/components/trailer/cinematic/CanonPackManager';
import { TrailerPlansPanel, useAutoSelectPlan } from '@/components/trailer/cinematic/TrailerPlansPanel';
const LazyClipCandidatesStudio = lazy(() => import('./ClipCandidatesStudio'));
import VideoPlanViewer from '@/components/cinematic/VideoPlanViewer';
import { useScriptRuns } from '@/lib/trailerPipeline/cinematicHooks';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { updateSearchParams } from '@/lib/searchParams';
import { useUIMode } from '@/hooks/useUIMode';

export default function TrailerPipelinePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'script');
  const [selectedScriptRunId, setSelectedScriptRunId] = useState<string>();
  const { mode } = useUIMode();

  // Active plan from URL or auto-select
  const blueprintIdParam = searchParams.get('blueprintId') || undefined;
  const autoSelectedPlanId = useAutoSelectPlan(projectId);
  const activePlanId = blueprintIdParam || autoSelectedPlanId;

  const handleSelectPlan = (id: string) => {
    updateSearchParams(setSearchParams, (next) => next.set('blueprintId', id), { replace: true });
  };

  // Fetch trailer definition packs for the project
  const { data: canonPacks } = useQuery({
    queryKey: ['trailer-definition-packs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_definition_packs')
        .select('id, title, project_id, created_at')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  const [canonPackId, setCanonPackId] = useState<string>();
  const { data: scriptRuns } = useScriptRuns(projectId);
  // Legacy blueprint tab removed
  const queryClient = useQueryClient();

  const createPackMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('trailer_definition_packs')
        .insert({ project_id: projectId!, title: `Canon Pack ${(canonPacks?.length || 0) + 1}`, created_by: user.id, updated_by: user.id })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trailer-definition-packs', projectId] });
      setCanonPackId(data.id);
      toast.success('Canon pack created');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Auto-select first script run and canon pack
  if (scriptRuns?.length && !selectedScriptRunId) {
    setSelectedScriptRunId(scriptRuns[0].id);
  }
  if (canonPacks?.length && !canonPackId) {
    setCanonPackId(canonPacks[0].id);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}/visual-dev/trailer`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Cinematic Studio</h1>
          <Badge variant="outline" className="text-[10px]">v2</Badge>

          {/* Canon Pack Selector */}
          <div className="flex items-center gap-2 ml-4">
            <Label className="text-[10px] text-muted-foreground">Canon Pack</Label>
            <Select value={canonPackId || ''} onValueChange={(v) => {
              if (v === '__create__') { createPackMutation.mutate(); return; }
              setCanonPackId(v);
            }}>
              <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue placeholder="Select pack" /></SelectTrigger>
              <SelectContent>
                {(canonPacks || []).map((cp: any) => (
                  <SelectItem key={cp.id} value={cp.id}>
                    {cp.title || cp.id.slice(0, 8)}
                  </SelectItem>
                ))}
                <SelectItem value="__create__" className="text-primary">
                  <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> New Pack</span>
                </SelectItem>
              </SelectContent>
            </Select>
            {canonPackId && <CanonPackManager projectId={projectId!} canonPackId={canonPackId} />}
          </div>

          {/* Script Run Selector */}
          {scriptRuns && scriptRuns.length > 1 && (
            <div className="flex items-center gap-2 ml-2">
              <Label className="text-[10px] text-muted-foreground">Script Run</Label>
              <Select value={selectedScriptRunId || ''} onValueChange={setSelectedScriptRunId}>
                <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {scriptRuns.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.id.slice(0, 8)} · {r.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            {projectId && <LearningBiasIndicator projectId={projectId} />}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4">
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); updateSearchParams(setSearchParams, (n) => n.set('tab', v), { replace: true }); }}>
          <TabsList className="mb-4">
            <TabsTrigger value="script" className="text-xs gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Script Studio
            </TabsTrigger>
            <TabsTrigger value="rhythm" className="text-xs gap-1.5">
              <Music className="h-3.5 w-3.5" /> Rhythm Grid
            </TabsTrigger>
            <TabsTrigger value="shots" className="text-xs gap-1.5">
              <Camera className="h-3.5 w-3.5" /> Shot Design
            </TabsTrigger>
            {mode === 'advanced' && (
              <TabsTrigger value="plans" className="text-xs gap-1.5">
                <LayoutList className="h-3.5 w-3.5" /> Trailer Plans
              </TabsTrigger>
            )}
            <TabsTrigger value="assembly" className="text-xs gap-1.5">
              <Wand2 className="h-3.5 w-3.5" /> Auto Assembly
            </TabsTrigger>
            <TabsTrigger value="videoplan" className="text-xs gap-1.5">
              <Video className="h-3.5 w-3.5" /> Video Plan
            </TabsTrigger>
            <TabsTrigger value="finish" className="text-xs gap-1.5">
              <Paintbrush className="h-3.5 w-3.5" /> Studio Finish
            </TabsTrigger>
            <TabsTrigger value="clips" className="text-xs gap-1.5">
              <Clapperboard className="h-3.5 w-3.5" /> Clips
            </TabsTrigger>
          </TabsList>

          <TabsContent value="script">
            <TrailerScriptStudio projectId={projectId!} canonPackId={canonPackId} />
          </TabsContent>

          <TabsContent value="rhythm">
            <div className="space-y-4">
              <RhythmTimelineOverlay scriptRunId={selectedScriptRunId} />
              <RhythmGridViewer scriptRunId={selectedScriptRunId} />
            </div>
          </TabsContent>

          <TabsContent value="shots">
            <ShotDesignViewer projectId={projectId!} scriptRunId={selectedScriptRunId} />
          </TabsContent>

          <TabsContent value="assembly">
            <div className="space-y-4">
              <AutoAssemblyPanel
                projectId={projectId!}
                scriptRunId={selectedScriptRunId}
              />
              <ContinuityPanel
                projectId={projectId!}
              />
            </div>
          </TabsContent>

          {mode === 'advanced' && (
            <TabsContent value="plans">
              <TrailerPlansPanel
                projectId={projectId!}
                activePlanId={activePlanId}
                onSelectPlan={handleSelectPlan}
                scriptRunId={selectedScriptRunId}
                canonPackId={canonPackId}
              />
            </TabsContent>
          )}

          <TabsContent value="videoplan">
            <VideoPlanViewer projectId={projectId!} />
          </TabsContent>

          <TabsContent value="finish">
            <StudioFinishPanel
              projectId={projectId!}
              scriptRunId={selectedScriptRunId}
            />
          </TabsContent>

          <TabsContent value="clips">
            <Suspense fallback={
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }>
              <LazyClipCandidatesStudio embedded />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

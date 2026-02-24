/**
 * Trailer Pipeline v2 — Cinematic Intelligence Studio
 * Tabbed layout: Script Studio, Rhythm Grid, Shot Design, Legacy Blueprint
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Film, Sparkles, Music, Camera, Archive, Clapperboard, Wand2, Paintbrush } from 'lucide-react';
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
import { LegacyBlueprintTab } from '@/components/trailer/cinematic/LegacyBlueprintTab';
import { CanonPackManager } from '@/components/trailer/cinematic/CanonPackManager';
import { useBlueprints } from '@/lib/trailerPipeline/useTrailerPipeline';
import { useScriptRuns } from '@/lib/trailerPipeline/cinematicHooks';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function TrailerPipelinePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState('script');
  const [selectedScriptRunId, setSelectedScriptRunId] = useState<string>();

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
  const { data: bpListData } = useBlueprints(projectId);
  const hasLegacyBlueprints = (bpListData?.blueprints || []).length > 0;
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
            <Link to={`/projects/${projectId}/trailer-clips`}>
              <Button variant="outline" size="sm" className="text-xs">
                <Clapperboard className="h-3 w-3 mr-1" /> Clip Studio
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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
            <TabsTrigger value="assembly" className="text-xs gap-1.5">
              <Wand2 className="h-3.5 w-3.5" /> Auto Assembly
            </TabsTrigger>
            <TabsTrigger value="finish" className="text-xs gap-1.5">
              <Paintbrush className="h-3.5 w-3.5" /> Studio Finish
            </TabsTrigger>
            {hasLegacyBlueprints && (
              <TabsTrigger value="legacy" className="text-xs gap-1.5">
                <Archive className="h-3.5 w-3.5" /> Legacy (Blueprint v1)
              </TabsTrigger>
            )}
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

          <TabsContent value="finish">
            <StudioFinishPanel
              projectId={projectId!}
              scriptRunId={selectedScriptRunId}
            />
          </TabsContent>

          {hasLegacyBlueprints && (
            <TabsContent value="legacy">
              <LegacyBlueprintTab projectId={projectId!} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

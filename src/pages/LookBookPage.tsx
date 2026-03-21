/**
 * LookBookPage — Section-driven visual pitch deck engine.
 * Route: /projects/:id/lookbook
 * Canonical lookbook_sections are the authoritative runtime model.
 * Workspace is always accessible and is the default authoring mode.
 * 
 * PIPELINE: All builds (manual + auto-complete) go through runLookbookPipeline.
 * This page does NOT contain orchestration logic — it calls the pipeline.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, BookOpen, RefreshCw, AlertTriangle, Wrench, AlertCircle, Sparkles,
} from 'lucide-react';
import { useLookbookStaleness } from '@/hooks/useLookbookStaleness';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FramingStrategyPanel } from '@/components/framing/FramingStrategyPanel';
import { LookBookViewer } from '@/components/lookbook/LookBookViewer';
import { LookbookSectionPanel } from '@/components/lookbook/LookbookSectionPanel';
import { useProjectBranding } from '@/hooks/useProjectBranding';
import { useProject } from '@/hooks/useProjects';
import { useLookbookSections, type CanonicalSectionKey } from '@/hooks/useLookbookSections';
import { useSectionReset } from '@/hooks/useSectionReset';
import { useLookbookAutoRebuild } from '@/hooks/useLookbookAutoRebuild';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LookBookData } from '@/lib/lookbook/types';
import type { LayoutFamilyKey } from '@/lib/lookbook/lookbookLayoutFamilies';
import { VisualCanonResetPanel } from '@/components/images/VisualCanonResetPanel';
import { LookbookRebuildHistoryStrip } from '@/components/images/LookbookRebuildHistoryStrip';
import { LookbookTriggerDiagnosticsStrip } from '@/components/images/LookbookTriggerDiagnosticsStrip';
import { runLookbookPipeline } from '@/lib/lookbook/pipeline/runLookbookPipeline';
import type { PipelineMode } from '@/lib/lookbook/pipeline/types';
import { sectionKeyToEdgeFunctionSection, sectionKeyToAssetGroup } from '@/lib/lookbook/pipeline/lookbookSlotRegistry';

type LookbookMode = 'workspace' | 'viewer';

export default function LookBookPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { data: branding } = useProjectBranding(projectId);
  const [lookBookData, setLookBookData] = useState<LookBookData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const [populatingSection, setPopulatingSection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<LookbookMode>('workspace');
  const [lookbookBuildEpoch, setLookbookBuildEpoch] = useState(0);
  const [rebuildHistoryEpoch, setRebuildHistoryEpoch] = useState(0);
  const consumedAutoBuildKeyRef = useRef<string | null>(null);

  // ── Staleness detection ──
  const staleness = useLookbookStaleness(projectId, lookbookBuildEpoch);

  // ── Auto-rebuild orchestration ──
  const autoRebuild = useLookbookAutoRebuild(projectId, {
    onRebuildComplete: (result) => {
      setRebuildHistoryEpoch(e => e + 1);
      if (result.executionStatus === 'completed' || result.executionStatus === 'completed_with_unresolved') {
        // Invalidate caches so next lookbook build uses fresh data
        invalidateImageCaches();
        setLookBookData(null);
      }
    },
  });

  const {
    sections,
    isLoading: sectionsLoading,
    isBootstrapped,
    structureStatus,
    bootstrap,
    isBootstrapping,
    bootstrapFailed,
    updateSectionStatus,
  } = useLookbookSections(projectId);

  const {
    resetSection,
    regenerateClean,
    resettingSection,
    regeneratingSection,
  } = useSectionReset(projectId || '');

  useEffect(() => {
    if (!sectionsLoading && !isBootstrapped && projectId && !isBootstrapping && !bootstrapFailed) {
      bootstrap();
    }
  }, [sectionsLoading, isBootstrapped, projectId, isBootstrapping, bootstrapFailed, bootstrap]);

  useEffect(() => {
    console.info('[LookBookPage] render_state', {
      component: 'LookBookPage',
      route: location.pathname,
      projectIdPresent: !!projectId,
      sectionsCount: sections.length,
      structureStatus,
      viewMode,
      viewerDataPresent: !!lookBookData,
      buildEpoch: lookbookBuildEpoch,
    });
  }, [location.pathname, projectId, sections.length, structureStatus, viewMode, lookBookData, lookbookBuildEpoch]);

  /**
   * Invalidate all react-query caches that could hold stale image data.
   * This ensures the next build resolves fresh images from DB.
   */
  const invalidateImageCaches = useCallback(() => {
    if (!projectId) return;
    // Invalidate workspace section content caches (20-min staleTime)
    queryClient.invalidateQueries({ queryKey: ['lookbook-section-content', projectId] });
    // Invalidate any project-images caches
    queryClient.invalidateQueries({ queryKey: ['project-images', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
    console.log('[LookBookPage] ✓ invalidated all image caches for fresh build');
  }, [projectId, queryClient]);

  // Use a ref for the previous slides so handleGenerate doesn't depend on lookBookData
  const prevSlidesRef = useRef<LookBookData['slides'] | null>(null);
  const prevResolvedIdsRef = useRef<string[] | null>(null);

  // Keep ref in sync
  useEffect(() => {
    prevSlidesRef.current = lookBookData?.slides ?? null;
  }, [lookBookData]);

  /**
   * Build LookBook via canonical pipeline.
   * Mode: 'fresh_build' (default) or 'reuse_recovery' (auto-complete).
   */
  const handleGenerate = useCallback(async (mode: PipelineMode = 'fresh_build') => {
    if (!projectId) return;
    setGenerating(true);
    try {
      invalidateImageCaches();

      const result = await runLookbookPipeline({
        projectId,
        mode,
        companyName: branding?.companyName || null,
        companyLogoUrl: branding?.companyLogoUrl || null,
        previousSlides: prevSlidesRef.current,
      });

      // Log provenance for debugging
      console.log('[LookBookPage] ✓ Pipeline complete', {
        buildId: result.data.buildId,
        slideCount: result.data.slides.length,
        totalImageRefs: result.data.totalImageRefs,
        durationMs: result.durationMs,
        qaPublishable: result.qa.publishable,
        stages: result.stages.map(s => `${s.stage}:${s.status}`).join(' '),
      });

      setLookBookData(result.data);
      setLookbookBuildEpoch(Date.now());

      // Change detection
      const newIds = result.data.resolvedImageIds || [];
      const prevIds = prevResolvedIdsRef.current || [];
      const changed = newIds.length !== prevIds.length || newIds.some((id, i) => id !== prevIds[i]);
      prevResolvedIdsRef.current = newIds;

      if (changed || !prevIds.length) {
        toast.success(`Look Book built (${result.data.totalImageRefs || 0} images resolved)`);
      } else {
        toast.info(
          'Look Book rebuilt — same images as before. Approve new images or generate fresh ones to change the deck.',
          { duration: 6000 },
        );
      }

      if (!result.qa.publishable && result.qa.unresolvedSlides.length > 0) {
        toast.warning(`${result.qa.unresolvedSlides.length} slides have unresolved images`, { duration: 5000 });
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate Look Book');
    } finally {
      setGenerating(false);
    }
  }, [projectId, branding, invalidateImageCaches]);

  useEffect(() => {
    const routeState = location.state as { mode?: LookbookMode; autoBuild?: boolean; buildKey?: string } | null;
    if (!routeState) return;

    if (routeState.mode === 'viewer' && viewMode !== 'viewer') {
      setViewMode('viewer');
    }

    if (routeState.autoBuild && routeState.buildKey && consumedAutoBuildKeyRef.current !== routeState.buildKey && !generating) {
      consumedAutoBuildKeyRef.current = routeState.buildKey;
      handleGenerate().finally(() => {
        navigate(location.pathname, { replace: true });
      });
    }
  }, [location.state, location.pathname, viewMode, generating, handleGenerate, navigate]);

  // Auto-rebuild when switching to viewer — always fetch fresh data
  // This ensures approved/synced images are reflected immediately
  useEffect(() => {
    if (viewMode === 'viewer' && !generating && projectId) {
      handleGenerate();
    }
    // Only trigger on viewMode change, not on handleGenerate identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, projectId]);

  // Persist layout-family override into canonical lookbook data via slide_id
  const handleSlideLayoutOverride = useCallback((slideId: string, familyKey: LayoutFamilyKey | null) => {
    setLookBookData(prev => {
      if (!prev) return prev;
      const updatedSlides = prev.slides.map(slide => {
        if (slide.slide_id !== slideId) return slide;
        if (familyKey === null) {
          // Reset to auto — clear user decisions
          return {
            ...slide,
            user_decisions: { ...slide.user_decisions, layout_family: null },
            layoutFamilyOverride: null,
            layoutFamilyOverrideSource: null,
            layoutFamilyEffective: slide.layoutFamily || 'landscape_standard',
          };
        }
        return {
          ...slide,
          user_decisions: { ...slide.user_decisions, layout_family: familyKey },
          layoutFamilyOverride: familyKey,
          layoutFamilyOverrideSource: 'user' as const,
          layoutFamilyEffective: familyKey,
        };
      });
      return { ...prev, slides: updatedSlides };
    });
  }, []);

  const handleExportPDF = useCallback(async () => {
    if (!lookBookData || !projectId) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('export-lookbook-pdf', {
        body: { projectId, lookBookData },
      });
      if (error) throw error;
      if (data?.signed_url) {
        window.open(data.signed_url, '_blank');
        toast.success('PDF exported');
      }
    } catch (e: any) {
      toast.error(e.message || 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [lookBookData, projectId]);

  const handlePopulate = useCallback(async (sectionKey: CanonicalSectionKey) => {
    if (!projectId) return;
    setPopulatingSection(sectionKey);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: sectionKey === 'character_identity' ? 'character'
            : sectionKey === 'world_locations' ? 'world'
            : sectionKey === 'atmosphere_lighting' ? 'visual_language'
            : sectionKey === 'texture_detail' ? 'visual_language'
            : sectionKey === 'symbolic_motifs' ? 'key_moment'
            : sectionKey === 'key_moments' ? 'key_moment'
            : 'world',
          count: 4,
          asset_group: sectionKey === 'character_identity' ? 'character'
            : sectionKey === 'world_locations' ? 'world'
            : sectionKey === 'atmosphere_lighting' ? 'visual_language'
            : sectionKey === 'texture_detail' ? 'visual_language'
            : sectionKey === 'symbolic_motifs' ? 'key_moment'
            : sectionKey === 'key_moments' ? 'key_moment'
            : 'poster',
          pack_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} images for ${sectionKey.replace(/_/g, ' ')}`);
        await updateSectionStatus(sectionKey, { section_status: 'partially_populated' });
        // Invalidate stale lookbook data so next build picks up new images
        invalidateImageCaches();
        setLookBookData(null);
      } else {
        toast.info('No images generated — check upstream prerequisites');
      }
    } catch (e: any) {
      toast.error(e.message || `Failed to populate ${sectionKey}`);
    } finally {
      setPopulatingSection(null);
    }
  }, [projectId, updateSectionStatus, invalidateImageCaches]);

  const handleResetSection = useCallback(async (sectionKey: CanonicalSectionKey) => {
    const result = await resetSection(sectionKey);
    if (result && result.archivedCount > 0) {
      setLookBookData(null); // Force rebuild on next viewer open
    }
  }, [resetSection]);

  const handleRegenerateClean = useCallback(async (sectionKey: CanonicalSectionKey) => {
    await regenerateClean(sectionKey);
    setLookBookData(null); // Force rebuild on next viewer open
  }, [regenerateClean]);

  /**
   * Auto Complete LookBook — Analyze gaps, orchestrate resolution, rebuild.
   */
  const handleAutoComplete = useCallback(async () => {
    if (!projectId || !lookBookData) {
      toast.error('Build the LookBook first, then auto-complete');
      return;
    }
    setAutoCompleting(true);
    try {
      // 1. Analyze gaps
      const gapAnalysis = analyzeLookBookGaps(lookBookData);
      if (gapAnalysis.gaps.length === 0) {
        toast.success('LookBook is already complete — no gaps found');
        return;
      }

      // 2. Get project context for prompts
      const { data: proj } = await supabase
        .from('projects')
        .select('title, genres, tone, format')
        .eq('id', projectId)
        .maybeSingle();
      const projectTitle = (proj as any)?.title || '';
      const genre = Array.isArray((proj as any)?.genres) ? (proj as any).genres.join(', ') : '';
      const tone = (proj as any)?.tone || '';

      // 3. Orchestrate resolution (retrieve / reuse)
      const promptContext = { projectTitle, genre, tone };
      const result = await orchestrateGapResolution(projectId, gapAnalysis, promptContext);

      const summary = summarizeOrchestration(result);
      toast.success(`Auto-complete analysis: ${summary}`);

      // 4. Execute generation for all queued gaps (closed-loop)
      if (result.generationsQueued > 0) {
        toast.info(`Generating ${result.generationsQueued} missing images…`);
        const genResult = await executeGapGenerations(projectId, result.resolutions, promptContext);
        if (genResult.generated > 0) {
          toast.success(`Generated ${genResult.generated} new image${genResult.generated > 1 ? 's' : ''}`);
        }
        if (genResult.failed > 0) {
          toast.warning(`${genResult.failed} generation${genResult.failed > 1 ? 's' : ''} failed — can retry`);
        }
      }

      // 5. Build working set (NO canon promotion — images stay as candidates)
      let workingSet = await buildWorkingSetFromResolutions(result.resolutions);

      // 6. Augment with recently generated candidates
      if (result.generationsQueued > 0) {
        workingSet = await augmentWorkingSetWithRecentGenerations(projectId, workingSet, result.resolutions);
      }

      const wsSize = workingSet.bySlotKey.size;
      const candidateCount = workingSet.entries.filter(e => e.source !== 'active').length;
      if (wsSize > 0) {
        toast.success(`Working set: ${wsSize} slots filled (${candidateCount} provisional — approve in Review Studio to make permanent)`);
      }

      // 7. Store working set and rebuild with overlay
      setActiveWorkingSet(workingSet);  // store for manual rebuilds
      invalidateImageCaches();
      await handleGenerate(workingSet);  // pass directly — no stale closure
    } catch (e: any) {
      toast.error(e.message || 'Auto-complete failed');
    } finally {
      setAutoCompleting(false);
    }
  }, [projectId, lookBookData, invalidateImageCaches, handleGenerate]);

  if (projectLoading || sectionsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const populatedCount = sections.filter(s => s.section_status !== 'empty_but_bootstrapped').length;
  const viewerAvailable = !!lookBookData;
  const isViewerMode = viewMode === 'viewer';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar — always shrink-0 ── */}
      <div className="px-4 py-2 border-b border-border bg-card/50 shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">
            {isViewerMode ? 'Look Book Presentation' : 'Look Book Workspace'}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {structureStatus === 'fully_populated' ? 'Complete' :
             structureStatus === 'partially_populated' ? `${populatedCount}/${sections.length} sections` :
             structureStatus === 'empty_but_bootstrapped' ? 'Ready' : 'Needs Setup'}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {structureStatus === 'invalid_structure' && (
            <Button size="sm" variant="destructive" className="gap-1 text-xs h-7" onClick={bootstrap} disabled={isBootstrapping}>
              {isBootstrapping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Rebuild Structure
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => handleGenerate()} disabled={generating}>
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
            Build Look Book
          </Button>
          {lookBookData && (
            <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={handleAutoComplete} disabled={autoCompleting || generating}>
              {autoCompleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Auto Complete
            </Button>
          )}
        </div>
      </div>

      {/* ── Main content area ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {structureStatus === 'invalid_structure' && (
          <div className="mx-4 mt-3 mb-0 rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 shrink-0">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Lookbook structure missing or incomplete</p>
              <p className="text-xs text-destructive/70 mt-0.5">
                Click "Rebuild Structure" to create the canonical section scaffolding.
              </p>
            </div>
          </div>
        )}

        {/* ── Staleness banner ── */}
        {staleness.isStale && (
          <div className="mx-4 mt-3 mb-0 shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">LookBook is out of date</p>
                <p className="text-xs text-muted-foreground">Images have changed since your last build. Rebuild to preview the latest approved images.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="gap-1 text-xs h-7 shrink-0 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10" onClick={() => handleGenerate()} disabled={generating}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Rebuild Now
            </Button>
          </div>
        )}

        {projectId && (
          <div className="mx-4 mt-3 mb-0 shrink-0 space-y-2">
            <LookbookTriggerDiagnosticsStrip
              diagnostics={autoRebuild.diagnostics}
              evaluating={autoRebuild.evaluating}
              rebuilding={autoRebuild.rebuilding}
              onLaunchRebuild={() => {
                autoRebuild.launchRebuild({ triggerSource: 'auto_run' }).then(result => {
                  if (result) {
                    const { executionStatus, rebuildResult } = result;
                    const modeLabel = rebuildResult.mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD' ? 'Preserve' : 'Reset';
                    if (executionStatus === 'completed') {
                      const fallbackNote = rebuildResult.fallbackMatchCount > 0
                        ? ` (${rebuildResult.fallbackMatchCount} fallback matches — improvable)`
                        : '';
                      toast.success(`${modeLabel} auto-rebuild: ${rebuildResult.attachedWinnerCount} winners from ${rebuildResult.totalSlots} slots${fallbackNote}`);
                    } else if (executionStatus === 'completed_with_unresolved') {
                      const fallbackNote = rebuildResult.fallbackMatchCount > 0
                        ? `, ${rebuildResult.fallbackMatchCount} fallback matches (improvable)`
                        : '';
                      toast.warning(`${modeLabel} auto-rebuild: ${rebuildResult.unresolvedSlots} unresolved of ${rebuildResult.totalSlots} slots${fallbackNote}`);
                    } else if (executionStatus === 'no_op') {
                      toast.info('No weak slots — no rebuild performed');
                    } else if (executionStatus === 'failed') {
                      toast.error(`Auto-rebuild failed: ${result.failureMessage || 'Unknown error'}`);
                    }
                  }
                });
              }}
            />
            <VisualCanonResetPanel
              projectId={projectId}
              onLookbookRebuild={async () => {
                await handleGenerate();
                setRebuildHistoryEpoch(e => e + 1);
                autoRebuild.reevaluate();
              }}
            />
            <LookbookRebuildHistoryStrip
              projectId={projectId}
              refreshEpoch={rebuildHistoryEpoch}
            />
          </div>
        )}

        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as LookbookMode)}
          className="flex-1 min-h-0 flex flex-col px-4 pt-3"
        >
          <TabsList className="mb-3 shrink-0">
            <TabsTrigger value="workspace">Sections</TabsTrigger>
            <TabsTrigger value="viewer" className="relative">
              Viewer
              {staleness.isStale && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Workspace: scrollable content ── */}
          <TabsContent value="workspace" className="mt-0 flex-1 min-h-0 overflow-y-auto pb-4 data-[state=active]:flex data-[state=active]:flex-col">
            {sections.length > 0 ? (
              <div className="space-y-1.5">
                {sections.map(section => (
                  <LookbookSectionPanel
                    key={section.id}
                    projectId={projectId!}
                    section={section}
                    onPopulate={handlePopulate}
                    isPopulating={populatingSection === section.section_key}
                    onResetSection={handleResetSection}
                    isResettingSection={resettingSection === section.section_key}
                    onRegenerateClean={handleRegenerateClean}
                    isRegeneratingSection={regeneratingSection === section.section_key}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                <p className="text-sm text-foreground mb-1">No lookbook sections found.</p>
                <p className="text-xs text-muted-foreground mb-4">Bootstrap the canonical structure to enter the section workspace.</p>
                <Button size="sm" variant="outline" onClick={bootstrap} disabled={isBootstrapping}>
                  {isBootstrapping ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Bootstrap Structure
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Viewer: flex-fill, no scroll ── */}
          <TabsContent value="viewer" className="mt-0 flex-1 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
            {viewerAvailable ? (
              <div className="flex flex-col flex-1 min-h-0 rounded-lg border border-border bg-card/40 overflow-hidden">
                {projectId && (
                  <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0">
                    <FramingStrategyPanel projectId={projectId} contentType="lookbook" compact />
                  </div>
                )}
                <LookBookViewer
                  data={lookBookData!}
                  onExportPDF={handleExportPDF}
                  isExporting={exporting}
                  className="flex-1 min-h-0"
                  onSlideLayoutOverride={handleSlideLayoutOverride}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                <p className="text-sm text-foreground mb-1">No built lookbook yet.</p>
                <p className="text-xs text-muted-foreground mb-4">Build the lookbook from the canonical workspace sections first.</p>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => handleGenerate()} disabled={generating}>
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Build Look Book
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * LookBookPage — Section-driven visual pitch deck engine.
 * Route: /projects/:id/lookbook
 * Canonical lookbook_sections are the authoritative runtime model.
 * Workspace is always accessible and is the default authoring mode.
 */
import { useState, useCallback, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Loader2, BookOpen, RefreshCw, AlertTriangle, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FramingStrategyPanel } from '@/components/framing/FramingStrategyPanel';
import { LookBookViewer } from '@/components/lookbook/LookBookViewer';
import { LookbookSectionPanel } from '@/components/lookbook/LookbookSectionPanel';
import { generateLookBookData } from '@/lib/lookbook/generateLookBookData';
import { useProjectBranding } from '@/hooks/useProjectBranding';
import { useProject } from '@/hooks/useProjects';
import { useLookbookSections, type CanonicalSectionKey } from '@/hooks/useLookbookSections';
import { useSectionReset } from '@/hooks/useSectionReset';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LookBookData, SlideContent } from '@/lib/lookbook/types';
import type { LayoutFamilyKey } from '@/lib/lookbook/lookbookLayoutFamilies';
import { getEffectiveLayoutFamily } from '@/lib/lookbook/lookbookLayoutResolutionState';
import { VisualCanonResetPanel } from '@/components/images/VisualCanonResetPanel';

type LookbookMode = 'workspace' | 'viewer';

export default function LookBookPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { data: branding } = useProjectBranding(projectId);
  const [lookBookData, setLookBookData] = useState<LookBookData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [populatingSection, setPopulatingSection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<LookbookMode>('workspace');
  const [lookbookBuildEpoch, setLookbookBuildEpoch] = useState(0);

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

  const handleGenerate = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      // Invalidate all image caches before building
      invalidateImageCaches();

      // Always re-resolve from DB — no stale snapshot reuse
      console.log('[LookBookPage] Building lookbook from fresh DB state...');
      const freshData = await generateLookBookData(projectId, {
        companyName: branding?.companyName || null,
        companyLogoUrl: branding?.companyLogoUrl || null,
      });

      // Preserve user layout overrides from previous build by matching slide type
      if (lookBookData?.slides) {
        const prevOverrides = new Map<string, { override: string; source: string }>();
        lookBookData.slides.forEach(s => {
          if (s.layoutFamilyOverride && s.layoutFamilyOverrideSource === 'user' && s.type) {
            prevOverrides.set(s.type, {
              override: s.layoutFamilyOverride,
              source: 'user',
            });
          }
        });
        if (prevOverrides.size > 0) {
          freshData.slides = freshData.slides.map(s => {
            const prev = prevOverrides.get(s.type);
            if (prev) {
              return {
                ...s,
                layoutFamilyOverride: prev.override,
                layoutFamilyOverrideSource: 'user' as const,
                layoutFamilyEffective: prev.override,
              };
            }
            return s;
          });
          console.log('[LookBookPage] ✓ Preserved layout overrides for', prevOverrides.size, 'slide types');
        }
      }

      // Log provenance for debugging stale-data issues
      const imageCount = freshData.slides.reduce((acc, s) => acc + (s._debug_image_ids?.length || 0), 0);
      console.log('[LookBookPage] ✓ Build complete', {
        slideCount: freshData.slides.length,
        totalImageRefs: imageCount,
        generatedAt: freshData.generatedAt,
      });

      setLookBookData(freshData);
      setLookbookBuildEpoch(Date.now());
      toast.success('Look Book generated — open Viewer to preview slides');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate Look Book');
    } finally {
      setGenerating(false);
    }
  }, [projectId, branding, invalidateImageCaches, lookBookData]);

  // Auto-rebuild when switching to viewer if no data exists yet
  useEffect(() => {
    if (viewMode === 'viewer' && !lookBookData && !generating && projectId) {
      handleGenerate();
    }
  }, [viewMode, lookBookData, generating, projectId, handleGenerate]);

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
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
            Build Look Book
          </Button>
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

        {projectId && (
          <div className="mx-4 mt-3 mb-0 shrink-0">
            <VisualCanonResetPanel
              projectId={projectId}
              onLookbookRebuild={handleGenerate}
            />
          </div>
        )}

        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as LookbookMode)}
          className="flex-1 min-h-0 flex flex-col px-4 pt-3"
        >
          <TabsList className="mb-3 shrink-0">
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="viewer">Viewer</TabsTrigger>
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
                <Button size="sm" variant="outline" className="gap-1" onClick={handleGenerate} disabled={generating}>
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

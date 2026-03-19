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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LookBookData } from '@/lib/lookbook/types';
import { VisualCanonResetPanel } from '@/components/images/VisualCanonResetPanel';

type LookbookMode = 'workspace' | 'viewer';

export default function LookBookPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { data: branding } = useProjectBranding(projectId);
  const [lookBookData, setLookBookData] = useState<LookBookData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [populatingSection, setPopulatingSection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<LookbookMode>('workspace');

  const {
    sections,
    isLoading: sectionsLoading,
    isBootstrapped,
    structureStatus,
    bootstrap,
    isBootstrapping,
    updateSectionStatus,
  } = useLookbookSections(projectId);

  useEffect(() => {
    if (!sectionsLoading && !isBootstrapped && projectId && !isBootstrapping) {
      bootstrap();
    }
  }, [sectionsLoading, isBootstrapped, projectId, isBootstrapping, bootstrap]);

  useEffect(() => {
    console.info('[LookBookPage] render_state', {
      component: 'LookBookPage',
      route: location.pathname,
      projectIdPresent: !!projectId,
      sectionsCount: sections.length,
      structureStatus,
      viewMode,
      viewerDataPresent: !!lookBookData,
    });
  }, [location.pathname, projectId, sections.length, structureStatus, viewMode, lookBookData]);

  const handleGenerate = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const data = await generateLookBookData(projectId, {
        companyName: branding?.companyName || null,
        companyLogoUrl: branding?.companyLogoUrl || null,
      });
      setLookBookData(data);
      toast.success('Look Book generated — open Viewer to preview slides');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate Look Book');
    } finally {
      setGenerating(false);
    }
  }, [projectId, branding]);

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
            : 'world',
          count: 4,
          asset_group: sectionKey === 'character_identity' ? 'character'
            : sectionKey === 'world_locations' ? 'world'
            : sectionKey === 'atmosphere_lighting' ? 'visual_language'
            : sectionKey === 'texture_detail' ? 'visual_language'
            : sectionKey === 'symbolic_motifs' ? 'key_moment'
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
      } else {
        toast.info('No images generated — check upstream prerequisites');
      }
    } catch (e: any) {
      toast.error(e.message || `Failed to populate ${sectionKey}`);
    } finally {
      setPopulatingSection(null);
    }
  }, [projectId, updateSectionStatus]);

  if (projectLoading || sectionsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const populatedCount = sections.filter(s => s.section_status !== 'empty_but_bootstrapped').length;
  const viewerAvailable = !!lookBookData;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-card/50 shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">
            {viewMode === 'workspace' ? 'Look Book Workspace' : 'Look Book Presentation'}
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

      <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
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
          <div className="mb-4">
            <VisualCanonResetPanel projectId={projectId} />
          </div>
        )}

        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as LookbookMode)} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="viewer">Viewer</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="mt-0">
            {sections.length > 0 ? (
              <div className="space-y-1.5">
                {sections.map(section => (
                  <LookbookSectionPanel
                    key={section.id}
                    projectId={projectId!}
                    section={section}
                    onPopulate={handlePopulate}
                    isPopulating={populatingSection === section.section_key}
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

          <TabsContent value="viewer" className="mt-0">
            {viewerAvailable ? (
              <div className="overflow-hidden rounded-lg border border-border bg-card/40">
                {projectId && (
                  <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0 overflow-y-auto max-h-64">
                    <FramingStrategyPanel projectId={projectId} contentType="lookbook" compact />
                  </div>
                )}
                <LookBookViewer data={lookBookData!} onExportPDF={handleExportPDF} isExporting={exporting} className="flex-1" />
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

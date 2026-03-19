/**
 * LookBookPage — Studio-quality visual pitch deck / look book.
 * Route: /projects/:id/lookbook
 * Always shows structured section shells. Never blank dead state.
 * Auto-bootstraps canonical sections on first visit.
 */
import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, BookOpen, RefreshCw, Globe, User, Zap, Palette, ChevronRight, AlertTriangle, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FramingStrategyPanel } from '@/components/framing/FramingStrategyPanel';
import { LookBookViewer } from '@/components/lookbook/LookBookViewer';
import { LookbookSectionShell } from '@/components/lookbook/LookbookSectionShell';
import { ImageSelectorGrid } from '@/components/images/ImageSelectorGrid';
import { generateLookBookData } from '@/lib/lookbook/generateLookBookData';
import { useProjectBranding } from '@/hooks/useProjectBranding';
import { useProject } from '@/hooks/useProjects';
import { useLookbookSections } from '@/hooks/useLookbookSections';
import { useLookbookSectionImages } from '@/hooks/useLookbookSectionImages';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SHOT_PACKS } from '@/lib/images/types';
import type { CurationState } from '@/lib/images/types';
import type { LookBookData } from '@/lib/lookbook/types';
import { CharacterBaseLookPanel } from '@/components/images/CharacterBaseLookPanel';
import { WorldLocationLookPanel } from '@/components/images/WorldLocationLookPanel';
import { VisualCanonResetPanel } from '@/components/images/VisualCanonResetPanel';

// Legacy image section keys mapping to lookbook section images
const IMAGE_SECTIONS = [
  { key: 'world' as const, label: 'World / Setting', icon: Globe, description: 'Establishing shots, atmospheric details, and environmental storytelling', packSize: SHOT_PACKS.world.length },
  { key: 'character' as const, label: 'Characters', icon: User, description: 'Multi-angle character portraits: close-up, medium, full body, profile', packSize: SHOT_PACKS.character.length },
  { key: 'key_moment' as const, label: 'Key Moments', icon: Zap, description: 'Pivotal dramatic scenes across different framings', packSize: SHOT_PACKS.key_moment.length },
  { key: 'visual_language' as const, label: 'Visual Language', icon: Palette, description: 'Lighting, texture, composition, and color references', packSize: SHOT_PACKS.visual_language.length },
] as const;

type CurationFilter = 'active' | 'candidate' | 'archived' | 'all';

function SectionImagePanel({ projectId, section }: { projectId: string; section: typeof IMAGE_SECTIONS[number] }) {
  const [filter, setFilter] = useState<CurationFilter>('all');
  const { sectionImages, generating, generate, total, hasMore, loadMore } = useLookbookSectionImages(
    projectId, section.key, undefined,
    { curationFilter: filter === 'all' ? 'all' : filter, pageSize: 12 },
  );
  const [open, setOpen] = useState(sectionImages.length > 0);

  const activeCount = sectionImages.filter(i => i.curation_state === 'active').length;
  const candidateCount = sectionImages.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = sectionImages.filter(i => i.curation_state === 'archived').length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <section.icon className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{section.label}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {activeCount > 0 && <span className="text-[10px] text-primary font-medium">{activeCount} active</span>}
            {candidateCount > 0 && <span className="text-[10px] text-muted-foreground">{candidateCount} candidates</span>}
            {archivedCount > 0 && <span className="text-[10px] text-muted-foreground/50">{archivedCount} archived</span>}
            {sectionImages.length === 0 && <span className="text-[10px] text-muted-foreground/60">empty</span>}
            {total > 0 && <span className="text-[10px] text-muted-foreground/40">({total} total)</span>}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="text-xs text-muted-foreground mb-2">{section.description}</p>
        {sectionImages.length > 0 && (
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {(['all', 'active', 'candidate', 'archived'] as CurationFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                  filter === f ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {f}
                {f === 'active' && activeCount > 0 && ` (${activeCount})`}
                {f === 'candidate' && candidateCount > 0 && ` (${candidateCount})`}
                {f === 'archived' && archivedCount > 0 && ` (${archivedCount})`}
              </button>
            ))}
          </div>
        )}
        <ImageSelectorGrid
          projectId={projectId}
          images={sectionImages}
          onGenerate={() => generate(section.packSize)}
          isGenerating={generating}
          generateLabel={`Generate Pack (${section.packSize} shots)`}
          emptyLabel={`No ${section.label.toLowerCase()} images yet`}
          showShotTypes
          showCurationControls
          enableCompare
          showProvenance
        />
        {hasMore && (
          <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-muted-foreground" onClick={loadMore}>
            Load More
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function LookBookPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { data: branding } = useProjectBranding(projectId);
  const [lookBookData, setLookBookData] = useState<LookBookData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Canonical section structure
  const {
    sections,
    isLoading: sectionsLoading,
    isBootstrapped,
    structureStatus,
    bootstrap,
    isBootstrapping,
  } = useLookbookSections(projectId);

  // Auto-bootstrap on first visit if no sections exist
  useEffect(() => {
    if (!sectionsLoading && !isBootstrapped && projectId && !isBootstrapping) {
      bootstrap();
    }
  }, [sectionsLoading, isBootstrapped, projectId, isBootstrapping, bootstrap]);

  // Legacy image counts for backward compat
  const worldImages = useLookbookSectionImages(projectId, 'world');
  const charImages = useLookbookSectionImages(projectId, 'character');
  const momentImages = useLookbookSectionImages(projectId, 'key_moment');
  const vlImages = useLookbookSectionImages(projectId, 'visual_language');
  const totalImages = (worldImages.sectionImages?.length || 0) +
    (charImages.sectionImages?.length || 0) +
    (momentImages.sectionImages?.length || 0) +
    (vlImages.sectionImages?.length || 0);

  const handleGenerate = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const data = await generateLookBookData(projectId, {
        companyName: branding?.companyName || null,
        companyLogoUrl: branding?.companyLogoUrl || null,
      });
      setLookBookData(data);
      toast.success('Look Book generated');
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

  if (projectLoading || sectionsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── VIEWER MODE: lookbook slides generated ──
  if (lookBookData) {
    return (
      <div className="h-full flex flex-col">
        <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate
          </Button>
        </div>
        {projectId && (
          <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0 overflow-y-auto max-h-64">
            <FramingStrategyPanel projectId={projectId} contentType="lookbook" compact />
          </div>
        )}
        <LookBookViewer data={lookBookData} onExportPDF={handleExportPDF} isExporting={exporting} className="flex-1" />
      </div>
    );
  }

  // ── WORKSPACE MODE: structured sections + image panels ──
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-border bg-card/50 shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Look Book</span>
          <Badge variant="secondary" className="text-[10px]">
            {structureStatus === 'fully_populated' ? 'Complete' :
             structureStatus === 'partially_populated' ? 'Partial' :
             structureStatus === 'empty_but_bootstrapped' ? 'Ready' : 'Needs Setup'}
          </Badge>
          {totalImages > 0 && (
            <Badge variant="outline" className="text-[10px]">{totalImages} images</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
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

      {/* Scrollable workspace */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Structure warning banner */}
        {structureStatus === 'invalid_structure' && (
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

        {/* Visual Canon Reset */}
        {projectId && (
          <div className="mb-4">
            <VisualCanonResetPanel projectId={projectId} />
          </div>
        )}

        {/* Canonical Section Shells — always visible */}
        {sections.length > 0 && (
          <div className="space-y-1.5 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Lookbook Sections</p>
            {sections.map(section => (
              <LookbookSectionShell key={section.id} section={section} />
            ))}
          </div>
        )}

        {/* Image Pack Panels */}
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Image Packs</p>
          {IMAGE_SECTIONS.map(section => (
            <SectionImagePanel key={section.key} projectId={projectId!} section={section} />
          ))}
        </div>

        {/* World & Location Reference System */}
        {projectId && (
          <div className="mt-6 border-t border-border pt-4">
            <WorldLocationLookPanel projectId={projectId} />
          </div>
        )}

        {/* Character Base Look System */}
        {projectId && (
          <div className="mt-6 border-t border-border pt-4">
            <CharacterBaseLookPanel projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
}

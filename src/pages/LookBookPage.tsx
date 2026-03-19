/**
 * LookBookPage — Studio-quality visual pitch deck / look book.
 * Route: /projects/:id/lookbook
 * Full Visual Asset System with pack generation, curation, and selection.
 */
import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, BookOpen, RefreshCw, Globe, User, Zap, Palette, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FramingStrategyPanel } from '@/components/framing/FramingStrategyPanel';
import { LookBookViewer } from '@/components/lookbook/LookBookViewer';
import { ImageSelectorGrid } from '@/components/images/ImageSelectorGrid';
import { generateLookBookData } from '@/lib/lookbook/generateLookBookData';
import { useProjectBranding } from '@/hooks/useProjectBranding';
import { useProject } from '@/hooks/useProjects';
import { useLookbookSectionImages } from '@/hooks/useLookbookSectionImages';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SHOT_PACKS } from '@/lib/images/types';
import type { LookBookData } from '@/lib/lookbook/types';

const SECTIONS = [
  { key: 'world' as const, label: 'World / Setting', icon: Globe, description: 'Establishing shots, atmospheric details, and environmental storytelling', packSize: SHOT_PACKS.world.length },
  { key: 'character' as const, label: 'Characters', icon: User, description: 'Multi-angle character portraits: close-up, medium, full body, profile', packSize: SHOT_PACKS.character.length },
  { key: 'key_moment' as const, label: 'Key Moments', icon: Zap, description: 'Pivotal dramatic scenes across different framings', packSize: SHOT_PACKS.key_moment.length },
  { key: 'visual_language' as const, label: 'Visual Language', icon: Palette, description: 'Lighting, texture, composition, and color references', packSize: SHOT_PACKS.visual_language.length },
] as const;

function SectionImagePanel({ projectId, section }: { projectId: string; section: typeof SECTIONS[number] }) {
  const { sectionImages, generating, generate } = useLookbookSectionImages(projectId, section.key);
  const [open, setOpen] = useState(sectionImages.length > 0);

  const activeCount = sectionImages.filter(i => i.curation_state === 'active' || i.is_primary).length;
  const candidateCount = sectionImages.filter(i => i.curation_state === 'candidate' && !i.is_primary).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <section.icon className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{section.label}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {activeCount > 0 && (
              <span className="text-[10px] text-primary font-medium">{activeCount} active</span>
            )}
            {candidateCount > 0 && (
              <span className="text-[10px] text-muted-foreground">{candidateCount} candidates</span>
            )}
            {sectionImages.length === 0 && (
              <span className="text-[10px] text-muted-foreground/60">empty</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn(
          'h-3.5 w-3.5 text-muted-foreground transition-transform',
          open && 'rotate-90'
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="text-xs text-muted-foreground mb-2">{section.description}</p>
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
        />
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

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lookBookData) {
    return (
      <div className="flex flex-col h-full">
        {/* Visual Asset System panel */}
        {projectId && (
          <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0 overflow-y-auto max-h-[55vh]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Visual Asset System</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Generate multi-shot packs per section. Select, compare, and curate before building.
                </p>
              </div>
            </div>
            <div className="space-y-0.5">
              {SECTIONS.map(section => (
                <SectionImagePanel key={section.key} projectId={projectId} section={section} />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-display font-semibold text-foreground">Look Book</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generate a studio-quality visual pitch deck from your project's canon, 
              characters, world, and creative vision. Curate images above, then build.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <BookOpen className="h-4 w-4" />
                Generate Look Book
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>

      {projectId && (
        <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0 overflow-y-auto max-h-64">
          <FramingStrategyPanel projectId={projectId} contentType="lookbook" compact />
        </div>
      )}

      <LookBookViewer
        data={lookBookData}
        onExportPDF={handleExportPDF}
        isExporting={exporting}
        className="flex-1"
      />
    </div>
  );
}

// Re-export cn for the template
function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(' ');
}

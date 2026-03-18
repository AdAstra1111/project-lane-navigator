/**
 * LookBookPage — Studio-quality visual pitch deck / look book.
 * Route: /projects/:id/lookbook
 */
import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, BookOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LookBookViewer } from '@/components/lookbook/LookBookViewer';
import { generateLookBookData } from '@/lib/lookbook/generateLookBookData';
import { useProjectBranding } from '@/hooks/useProjectBranding';
import { useProject } from '@/hooks/useProjects';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LookBookData } from '@/lib/lookbook/types';

export default function LookBookPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
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

  // Empty state — no look book generated yet
  if (!lookBookData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-semibold text-foreground">Look Book</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Generate a studio-quality visual pitch deck from your project's canon, 
            characters, world, and creative vision. Presentation-ready for producers, 
            investors, and streamers.
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
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Regenerate button in top-right */}
      <div className="absolute top-2 right-2 z-20">
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
      <LookBookViewer
        data={lookBookData}
        onExportPDF={handleExportPDF}
        isExporting={exporting}
        className="flex-1"
      />
    </div>
  );
}

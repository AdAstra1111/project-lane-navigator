import { useState, useMemo } from 'react';
import { Zap, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReverseEngineer } from '@/hooks/useReverseEngineer';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ReverseEngineerCalloutProps {
  projectId: string;
  documents: any[];
}

export function ReverseEngineerCallout({ projectId, documents }: ReverseEngineerCalloutProps) {
  const [dismissed, setDismissed] = useState(false);
  const { reverseEngineerFromScript, isRunning } = useReverseEngineer();
  const queryClient = useQueryClient();

  const scriptDoc = useMemo(() =>
    documents.find(d => {
      const dt = (d.doc_type || '') as string;
      const role = (d.doc_role || '') as string;
      const title = (d.title || '') as string;
      if (dt.includes('script')) return true;
      if (dt === 'source_script') return true;
      if (role === 'source_script') return true;
      if (role === 'creative_primary' && title.toLowerCase().includes('script')) return true;
      return false;
    }), [documents]);

  const hasConceptBrief = useMemo(() =>
    documents.some(d => d.doc_type === 'concept_brief'), [documents]);

  if (dismissed || !scriptDoc || hasConceptBrief) return null;

  const handleGenerate = async () => {
    const result = await reverseEngineerFromScript(projectId, scriptDoc.id);
    if (result.success) {
      toast.success(`Pipeline documents generated! ${result.documents_created || ''} docs created.`);
      queryClient.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      setDismissed(true);
    } else {
      toast.error(result.error || 'Could not generate pipeline documents');
    }
  };

  return (
    <div className="relative rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mb-4">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-3">
        <div className="rounded-md bg-amber-500/10 p-2 shrink-0">
          <Zap className="h-4 w-4 text-amber-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground mb-1">
            Script detected — generate full pipeline?
          </h4>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Generate Concept Brief, Market Sheet, Format Rules, Character Bible, Story Arc and Episode Grid from your script in one click.
          </p>

          {isRunning && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-center gap-2 mb-3 animate-pulse">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              <span className="text-[11px] text-amber-400">Reverse engineering pipeline… ~90 seconds</span>
            </div>
          )}

          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-foreground border-0"
            disabled={isRunning}
            onClick={handleGenerate}
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Generate Pipeline Documents
          </Button>
        </div>
      </div>
    </div>
  );
}

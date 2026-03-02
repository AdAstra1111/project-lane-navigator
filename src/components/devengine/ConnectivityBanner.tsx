import { AlertTriangle, CheckCircle, Link2, RefreshCw, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ConnectivityBannerProps {
  projectId: string | undefined;
  currentResolverHash: string | null;
  staleDocCount: number;
  staleDocTypes: string[];
  totalDocs: number;
  criteriaLinkedDocs: number;
  provenanceKnownDocs: number;
  /** When true, soften non-stale warnings (autopilot is actively running) */
  isAutopilotActive?: boolean;
}

export function ConnectivityBanner({
  projectId,
  currentResolverHash,
  staleDocCount,
  staleDocTypes,
  totalDocs,
  criteriaLinkedDocs,
  provenanceKnownDocs,
  isAutopilotActive = false,
}: ConnectivityBannerProps) {
  const qc = useQueryClient();

  const regenerateAll = useMutation({
    mutationFn: async () => {
      if (!projectId || staleDocTypes.length === 0) return;
      const { data, error } = await supabase.functions.invoke('regenerate-stale-docs', {
        body: { projectId, docTypes: staleDocTypes, mode: 'draft' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Regenerated ${data?.succeeded || 0} docs (${data?.failed || 0} errors)`);
      qc.invalidateQueries({ queryKey: ['package-status', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
    },
    onError: (err: any) => toast.error('Regeneration failed: ' + err.message),
  });

  const missingCriteriaLink = totalDocs - criteriaLinkedDocs;
  const unknownProvenance = totalDocs - provenanceKnownDocs;

  // All good: every doc has criteria link and no stale
  if (staleDocCount === 0 && criteriaLinkedDocs === totalDocs) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
        <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-foreground">All documents criteria-linked</span>
        <Badge variant="outline" className="text-[9px] ml-auto">{currentResolverHash}</Badge>
      </div>
    );
  }

  // PATCH C3: During active autopilot, soften non-stale criteria warnings
  if (staleDocCount === 0 && missingCriteriaLink > 0 && isAutopilotActive) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/50 text-xs">
        <Info className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <p className="text-muted-foreground text-[10px]">
          Criteria links will be established after qualifications run completes.
        </p>
      </div>
    );
  }

  // No staleness and all provenance known (just missing criteria hash — common for seed docs before qualifications resolve)
  if (staleDocCount === 0 && missingCriteriaLink > 0 && unknownProvenance === 0) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border text-xs">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-foreground">
            {missingCriteriaLink} missing criteria link{missingCriteriaLink > 1 ? 's' : ''}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Origin known (provenance tracked). Run qualifications to establish criteria links.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          {staleDocCount > 0 ? `${staleDocCount} stale doc${staleDocCount > 1 ? 's' : ''}` : ''}
          {staleDocCount > 0 && missingCriteriaLink > 0 ? ' · ' : ''}
          {missingCriteriaLink > 0 ? `${missingCriteriaLink} missing criteria link${missingCriteriaLink > 1 ? 's' : ''}` : ''}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {staleDocCount > 0
            ? 'Canonical qualifications changed — regenerate affected docs.'
            : unknownProvenance > 0
              ? `${unknownProvenance} doc${unknownProvenance > 1 ? 's' : ''} lack provenance tracking.`
              : 'Run qualifications to establish criteria links.'}
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {staleDocCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1"
            onClick={() => regenerateAll.mutate()}
            disabled={regenerateAll.isPending}
          >
            <RefreshCw className={`h-3 w-3 ${regenerateAll.isPending ? 'animate-spin' : ''}`} />
            Regenerate All
          </Button>
        )}
      </div>
    </div>
  );
}
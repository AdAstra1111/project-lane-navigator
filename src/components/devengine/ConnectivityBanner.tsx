import { AlertTriangle, CheckCircle, Link2, RefreshCw } from 'lucide-react';
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
  connectedDocs: number;
}

export function ConnectivityBanner({
  projectId,
  currentResolverHash,
  staleDocCount,
  staleDocTypes,
  totalDocs,
  connectedDocs,
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

  if (staleDocCount === 0 && connectedDocs === totalDocs) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
        <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-foreground">All documents connected</span>
        <Badge variant="outline" className="text-[9px] ml-auto">{currentResolverHash}</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          {staleDocCount > 0 ? `${staleDocCount} stale doc${staleDocCount > 1 ? 's' : ''}` : ''}
          {staleDocCount > 0 && connectedDocs < totalDocs ? ' · ' : ''}
          {connectedDocs < totalDocs ? `${totalDocs - connectedDocs} unconnected` : ''}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {staleDocCount > 0
            ? 'Canonical qualifications changed — regenerate affected docs.'
            : 'Some documents lack provenance tracking.'}
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

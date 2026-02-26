import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  idea: PitchIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted: () => void;
}

export function PromoteToDevSeedDialog({ idea, open, onOpenChange, onPromoted }: Props) {
  const [promoting, setPromoting] = useState(false);

  if (!idea) return null;

  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;

  const handlePromote = async () => {
    setPromoting(true);
    try {
      const { data, error } = await supabase.functions.invoke('promote-to-devseed', {
        body: { pitchIdeaId: idea.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('DevSeed created — bible starter, nuance contract, and market rationale attached');
      onPromoted();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Promotion failed');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Promote to DevSeed
          </DialogTitle>
          <DialogDescription>
            This creates a DevSeed payload with a bible starter, nuance contract, and market rationale. It does NOT write to canon or project prefs — those are applied separately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md border border-border/40 p-3 space-y-2">
            <h4 className="font-semibold text-sm">{idea.title}</h4>
            <p className="text-sm text-muted-foreground line-clamp-3">{idea.logline}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-xs">{idea.genre}</Badge>
              <Badge variant="outline" className="text-xs">{laneLabel}</Badge>
              <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>
              {Number(idea.score_total) > 0 && (
                <Badge variant="default" className="text-xs">Score: {Number(idea.score_total).toFixed(0)}</Badge>
              )}
            </div>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground mb-1">DevSeed will include:</p>
            <p>• Bible Starter — character, world, and tone foundations</p>
            <p>• Nuance Contract — restraint level, conflict mode, complexity caps</p>
            <p>• Market Rationale — comps analysis, lane justification, buyer positioning</p>
            <p className="mt-2 text-muted-foreground">⚠ This is a draft — Apply flow required to commit to a project.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={promoting}>Cancel</Button>
          <Button onClick={handlePromote} disabled={promoting} className="gap-1.5">
            {promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Create DevSeed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

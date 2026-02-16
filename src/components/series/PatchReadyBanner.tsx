import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Eye } from 'lucide-react';

export interface PatchRun {
  id: string;
  episode_id: string;
  status: string;
  issue_title: string;
  patch_summary: string | null;
  proposed_changes: any;
  created_at: string;
}

interface Props {
  patchRun: PatchRun;
  onReview: () => void;
  onApply: () => void;
  onReject: () => void;
  isApplying?: boolean;
  isRejecting?: boolean;
}

export function PatchReadyBanner({ patchRun, onReview, onApply, onReject, isApplying, isRejecting }: Props) {
  if (patchRun.status !== 'complete') return null;

  return (
    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">Patch Ready</Badge>
          <span className="text-xs font-medium text-foreground">{patchRun.issue_title}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(patchRun.created_at).toLocaleDateString()}
        </span>
      </div>

      {patchRun.patch_summary && (
        <p className="text-[11px] text-muted-foreground">{patchRun.patch_summary}</p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onReview}>
          <Eye className="h-3 w-3" /> Review
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={onApply} disabled={isApplying}>
          {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Apply
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive" onClick={onReject} disabled={isRejecting}>
          {isRejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
          Reject
        </Button>
      </div>
    </div>
  );
}

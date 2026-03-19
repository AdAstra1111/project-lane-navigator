/**
 * ApprovalGovernanceDialog — Structured approval/rejection dialog
 * with DNA-aware reasoning, reject reason taxonomy, and reuse pool option.
 */
import { useState } from 'react';
import { CheckCircle, XCircle, Archive, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REJECT_REASONS, REJECT_REASON_LABELS, type RejectReason, type ApprovalDecision } from '@/lib/images/imageEvaluation';

interface Props {
  open: boolean;
  onClose: () => void;
  onDecide: (decision: ApprovalDecision) => void;
  imageId: string;
  characterName?: string;
  evaluationSummary?: string;
}

export function ApprovalGovernanceDialog({ open, onClose, onDecide, imageId, characterName, evaluationSummary }: Props) {
  const [mode, setMode] = useState<'approve' | 'reject' | 'reuse_pool'>('approve');
  const [rejectReason, setRejectReason] = useState<RejectReason>('other');
  const [note, setNote] = useState('');
  const [destination, setDestination] = useState<'identity_anchor' | 'reference' | 'flexible'>('reference');
  
  const handleSubmit = () => {
    const decision: ApprovalDecision = {
      decisionType: mode,
      reason: mode === 'reject' ? REJECT_REASON_LABELS[rejectReason] : mode === 'reuse_pool' ? 'Reuse pool candidate' : 'Approved',
      note,
      traitsSatisfied: [],
      traitsViolated: [],
      destination: mode === 'approve' ? destination : mode === 'reuse_pool' ? 'reuse_pool' : 'archive',
    };
    onDecide(decision);
    onClose();
    setNote('');
  };
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Visual Approval Decision</DialogTitle>
          {characterName && (
            <DialogDescription className="text-xs">
              {characterName} — Image governance decision
            </DialogDescription>
          )}
        </DialogHeader>
        
        {evaluationSummary && (
          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 border border-border/50">
            {evaluationSummary}
          </div>
        )}
        
        {/* Decision Mode */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'approve' ? 'default' : 'outline'}
            className="flex-1 text-xs gap-1"
            onClick={() => setMode('approve')}
          >
            <CheckCircle className="h-3 w-3" /> Approve
          </Button>
          <Button
            size="sm"
            variant={mode === 'reject' ? 'destructive' : 'outline'}
            className="flex-1 text-xs gap-1"
            onClick={() => setMode('reject')}
          >
            <XCircle className="h-3 w-3" /> Reject
          </Button>
          <Button
            size="sm"
            variant={mode === 'reuse_pool' ? 'secondary' : 'outline'}
            className="flex-1 text-xs gap-1"
            onClick={() => setMode('reuse_pool')}
          >
            <Archive className="h-3 w-3" /> Reuse
          </Button>
        </div>
        
        {/* Approve options */}
        {mode === 'approve' && (
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Destination
            </label>
            <Select value={destination} onValueChange={(v: any) => setDestination(v)}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="identity_anchor" className="text-xs">Identity Anchor (locked)</SelectItem>
                <SelectItem value="reference" className="text-xs">Reference Image</SelectItem>
                <SelectItem value="flexible" className="text-xs">Flexible / Scene Use</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Reject reason */}
        {mode === 'reject' && (
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Reject Reason
            </label>
            <Select value={rejectReason} onValueChange={(v: any) => setRejectReason(v)}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASONS.map(r => (
                  <SelectItem key={r} value={r} className="text-xs">{REJECT_REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Reuse pool info */}
        {mode === 'reuse_pool' && (
          <div className="text-[10px] text-muted-foreground bg-muted/20 rounded p-2 border border-border/50">
            Image will be stored in the reuse pool — available for future casting or cross-project use, but never treated as canon.
          </div>
        )}
        
        {/* Note */}
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Notes (optional)
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add decision context..."
            className="mt-1 text-xs min-h-[60px] resize-none"
          />
        </div>
        
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button
            size="sm"
            className="text-xs"
            variant={mode === 'reject' ? 'destructive' : 'default'}
            onClick={handleSubmit}
          >
            Confirm {mode === 'approve' ? 'Approval' : mode === 'reject' ? 'Rejection' : 'Reuse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

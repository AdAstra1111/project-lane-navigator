/**
 * DriftBanner — Shows drift detection warning with resolution options.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, GitBranch, RotateCcw, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type ResolutionType = 'accept_drift' | 'intentional_pivot' | 'reseed';

interface DriftBannerProps {
  drift: any;
  onAcknowledge: () => void;
  onResolve: (resolutionType: ResolutionType) => void;
  resolvePending?: boolean;
}

const RESOLUTION_OPTIONS: { type: ResolutionType; label: string; description: string; icon: typeof Check }[] = [
  {
    type: 'accept_drift',
    label: 'Accept Current Direction',
    description: 'Keep the current document as-is and update the baseline. Future drift checks will measure from this version.',
    icon: Check,
  },
  {
    type: 'intentional_pivot',
    label: 'Mark as Intentional Pivot',
    description: 'Acknowledge this is a deliberate creative choice. The narrative chain will be updated to reflect the new direction.',
    icon: ArrowRight,
  },
  {
    type: 'reseed',
    label: 'Re-seed from Upstream',
    description: 'Regenerate this document using the original upstream core elements (protagonist, stakes, tone, etc.) to realign with the source material.',
    icon: RotateCcw,
  },
];

export function DriftBanner({ drift, onAcknowledge, onResolve, resolvePending }: DriftBannerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!drift || drift.drift_level === 'none' || drift.resolved) return null;

  const isMajor = drift.drift_level === 'major';

  const handleResolve = (type: ResolutionType) => {
    onResolve(type);
    setDialogOpen(false);
  };

  return (
    <>
      <div className={`p-3 rounded-lg border ${
        isMajor ? 'bg-destructive/10 border-destructive/30' : 'bg-amber-500/10 border-amber-500/30'
      }`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${isMajor ? 'text-destructive' : 'text-amber-500'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${isMajor ? 'text-destructive' : 'text-amber-500'}`}>
              {isMajor ? 'Major Narrative Pivot Detected' : 'Structural Drift Detected'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isMajor
                ? 'Core elements differ significantly. Reconcile before convergence.'
                : 'This document diverges from inherited core. Resolve or acknowledge.'}
            </p>
            {drift.drift_items?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {drift.drift_items.slice(0, 4).map((item: any, i: number) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                    {item.field}: {item.similarity}%
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 mt-2">
              {!drift.acknowledged && (
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={onAcknowledge}>
                  Acknowledge
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setDialogOpen(true)} disabled={resolvePending}>
                {resolvePending ? 'Resolving…' : 'Resolve'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Resolve Narrative Drift
            </DialogTitle>
            <DialogDescription>
              Choose how to handle the detected {isMajor ? 'major pivot' : 'structural drift'} in this document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {RESOLUTION_OPTIONS.map(opt => (
              <button
                key={opt.type}
                onClick={() => handleResolve(opt.type)}
                disabled={resolvePending}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <opt.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <span className="text-sm font-medium">{opt.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 ml-6">{opt.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

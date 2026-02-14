/**
 * DriftBanner — Shows drift detection warning with action buttons.
 */
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface DriftBannerProps {
  drift: any;
  onAcknowledge: () => void;
  onResolve: () => void;
}

export function DriftBanner({ drift, onAcknowledge, onResolve }: DriftBannerProps) {
  if (!drift || drift.drift_level === 'none' || drift.resolved) return null;

  const isMajor = drift.drift_level === 'major';

  return (
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
            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={onResolve}>
              Resolve
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

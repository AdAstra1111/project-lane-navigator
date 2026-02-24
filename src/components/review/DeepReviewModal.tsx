import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const QUICK_ITEMS = [
  'Structural overview',
  'Budget estimate',
  'Market snapshot',
  'Top 3 priorities',
];

const DEEP_ITEMS = [
  'Scene-level diagnostics',
  'Structural heat mapping',
  'Market trend alignment',
  'Financing risk modelling',
  'Strategic optimisation paths',
  'Rewrite scope planning',
];

interface DeepReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart?: () => void;
}

export function DeepReviewModal({ open, onOpenChange, onStart }: DeepReviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden gap-0">
        <DialogHeader className="px-8 pt-8 pb-2 text-center">
          <DialogTitle className="font-display text-2xl font-medium tracking-tight">
            Deep Review
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            Full structural, commercial and strategic analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-px bg-border/40 mx-8 my-6 rounded-xl overflow-hidden">
          {/* Quick Review column */}
          <div className="bg-card/40 p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
                Quick Review
              </p>
              <p className="text-[11px] text-muted-foreground/40">Completed</p>
            </div>
            <ul className="space-y-2.5">
              {QUICK_ITEMS.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-muted-foreground/50">
                  <Check className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Deep Review column */}
          <div className="bg-card p-5 space-y-4 ring-1 ring-primary/10">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">
                Deep Review
              </p>
              <p className="text-[11px] text-primary/70 font-medium">Full Analysis</p>
            </div>
            <ul className="space-y-2.5">
              {DEEP_ITEMS.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-foreground">
                  <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                  <span className="text-sm font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 px-8 pb-8">
          <Button
            size="lg"
            className="w-full rounded-xl text-sm font-medium"
            onClick={() => {
              onStart?.();
              onOpenChange(false);
            }}
          >
            Start Deep Review
          </Button>
          <button
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

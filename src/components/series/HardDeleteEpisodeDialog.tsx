import { useState } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeNumber: number;
  episodeTitle: string;
  warnings?: string[];
  onConfirm: () => void;
  isPending?: boolean;
}

export function HardDeleteEpisodeDialog({
  open, onOpenChange, episodeNumber, episodeTitle,
  warnings = [], onConfirm, isPending,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');

  const handleOpenChange = (v: boolean) => {
    if (!v) { setStep(1); setConfirmText(''); }
    onOpenChange(v);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Permanently Delete Episode {episodeNumber}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {step === 1 ? (
                <>
                  <p>
                    This will <strong>permanently remove</strong> EP {String(episodeNumber).padStart(2, '0')} "{episodeTitle}" and ALL linked artifacts:
                  </p>
                  <ul className="list-disc pl-4 text-xs space-y-1 text-muted-foreground">
                    <li>Episode script and all versions</li>
                    <li>Validations, compliance reports, continuity ledgers</li>
                    <li>Metrics, comments, and patch runs</li>
                  </ul>
                  {warnings.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                        <AlertTriangle className="h-3 w-3" /> References Found
                      </div>
                      {warnings.map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-400/80">{w}</p>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-destructive font-medium">This action cannot be undone.</p>
                </>
              ) : (
                <>
                  <p>Type <Badge variant="destructive" className="text-xs font-mono">DELETE</Badge> to confirm permanent deletion.</p>
                  <Input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="Type DELETE"
                    className="font-mono text-sm"
                    autoFocus
                  />
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {step === 1 ? (
            <Button variant="destructive" size="sm" onClick={() => setStep(2)}>
              Continue
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmText !== 'DELETE' || isPending}
              onClick={() => { onConfirm(); handleOpenChange(false); }}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Permanently Delete
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectTitle: string;
  onConfirm: () => void;
  isPending?: boolean;
}

export function DeleteProjectDialog({ open, onOpenChange, projectTitle, onConfirm, isPending }: Props) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.toLowerCase() === 'delete';

  const handleConfirm = () => {
    if (!confirmed) return;
    onConfirm();
    setTyped('');
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">Delete Project</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              You are about to permanently delete <strong className="text-foreground">{projectTitle}</strong>. This will remove all associated documents, analysis, scores, and history.
            </span>
            <span className="block font-medium text-destructive">This action cannot be undone.</span>
            <span className="block text-xs text-muted-foreground mt-2">
              Type <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono text-xs">delete</code> to confirm.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type delete to confirm"
          className="font-mono"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && confirmed) handleConfirm(); }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!confirmed || isPending}
          >
            {isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useState, useEffect } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  /** Current project title */
  currentTitle: string;
  /** Called when the user confirms a new title */
  onRename: (newTitle: string) => Promise<void>;
  /** Optional trigger; if omitted a pencil icon button is rendered */
  trigger?: React.ReactNode;
}

export function RenameProjectDialog({ currentTitle, onRename, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentTitle);
  const [saving, setSaving] = useState(false);

  // Sync when prop changes (e.g. realtime update)
  useEffect(() => {
    if (!open) setValue(currentTitle);
  }, [currentTitle, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentTitle) { setOpen(false); return; }
    setSaving(true);
    try {
      await onRename(trimmed);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="cursor-pointer">
          {trigger}
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
          title="Rename project"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="project-title">Working Title</Label>
              <Input
                id="project-title"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                placeholder="Enter new title…"
                disabled={saving}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !value.trim() || value.trim() === currentTitle}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Rename
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

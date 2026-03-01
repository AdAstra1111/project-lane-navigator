/**
 * ResolveRenameDialog — Minimal dialog for resolving name conflicts
 * via the canon-decisions edge function.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ResolveRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  oldName: string;
  onSuccess: () => void;
}

export function ResolveRenameDialog({
  open,
  onOpenChange,
  projectId,
  oldName,
  onSuccess,
}: ResolveRenameDialogProps) {
  const [newName, setNewName] = useState('');
  const [entityKind, setEntityKind] = useState('character');
  const [notes, setNotes] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    if (!newName.trim()) {
      toast.error('New name is required');
      return;
    }
    setIsApplying(true);
    try {
      const resp = await supabase.functions.invoke('canon-decisions', {
        body: {
          action: 'create_and_apply',
          projectId,
          decision: {
            type: 'RENAME_ENTITY',
            payload: {
              entity_kind: entityKind,
              old_name: oldName,
              new_name: newName.trim(),
              notes: notes.trim() || null,
            },
          },
          apply: { mode: 'auto' },
        },
      });

      if (resp.error) throw new Error(resp.error.message || 'Failed');
      const data = resp.data;
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Renamed "${oldName}" → "${newName.trim()}" across ${data?.applied?.docs_modified || 0} document(s)`
      );
      onOpenChange(false);
      setNewName('');
      setNotes('');
      onSuccess();
    } catch (e: any) {
      toast.error(e.message || 'Rename failed');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            Resolve Name Conflict
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Old Name</Label>
            <Input value={oldName} readOnly className="h-8 text-xs bg-muted/30" />
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">New Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter canonical name..."
              className="h-8 text-xs"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Entity Kind</Label>
            <Select value={entityKind} onValueChange={setEntityKind}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="character">Character</SelectItem>
                <SelectItem value="location">Location</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for rename..."
              className="h-8 text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={isApplying || !newName.trim()}>
            {isApplying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Apply Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

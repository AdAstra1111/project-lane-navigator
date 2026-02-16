import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCompanies } from '@/hooks/useCompanies';
import { useProjectCompanies } from '@/hooks/useCompanies';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
}

export function AssignCompanyDialog({ open, onOpenChange, projectId, projectTitle }: Props) {
  const { companies } = useCompanies();
  const { linkProject } = useProjectCompanies(projectId);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const handleAssign = () => {
    if (!selected) return;
    linkProject.mutate(
      { projectId, companyId: selected },
      {
        onSuccess: () => {
          toast.success('Project assigned to company');
          queryClient.invalidateQueries({ queryKey: ['all-company-links'] });
          queryClient.invalidateQueries({ queryKey: ['projects'] });
          onOpenChange(false);
          setSelected(null);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign to Company</DialogTitle>
          <DialogDescription>
            Choose a company for <strong>{projectTitle}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {companies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No companies available</p>
          ) : (
            companies.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors',
                  selected === c.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-foreground'
                )}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!selected || linkProject.isPending} onClick={handleAssign}>
            {linkProject.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

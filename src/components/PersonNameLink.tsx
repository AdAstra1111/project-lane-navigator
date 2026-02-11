import { useState } from 'react';
import { User } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import { usePersonImage } from '@/hooks/usePersonImage';
import type { ProjectContext } from '@/components/ProjectAttachmentTabs';

interface PersonNameLinkProps {
  personName: string;
  reason: string;
  projectContext?: ProjectContext;
}

export function PersonNameLink({ personName, reason, projectContext }: PersonNameLinkProps) {
  const [open, setOpen] = useState(false);
  const imageUrl = usePersonImage(personName);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        onClick={() => setOpen(true)}
      >
        <Avatar className="h-6 w-6">
          {imageUrl && <AvatarImage src={imageUrl} alt={personName} />}
          <AvatarFallback className="text-[10px]">
            <User className="h-3 w-3" />
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground truncate hover:underline cursor-pointer">
          {personName}
        </span>
      </button>
      <CastInfoDialog
        personName={personName}
        reason={reason}
        open={open}
        onOpenChange={setOpen}
        projectContext={projectContext}
      />
    </>
  );
}

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
  size?: 'sm' | 'md';
}

const sizeClasses = {
  sm: { avatar: 'h-6 w-6', fallbackIcon: 'h-3 w-3', text: 'text-sm', fallbackText: 'text-[10px]' },
  md: { avatar: 'h-10 w-10', fallbackIcon: 'h-4 w-4', text: 'text-sm', fallbackText: 'text-xs' },
};

export function PersonNameLink({ personName, reason, projectContext, size = 'sm' }: PersonNameLinkProps) {
  const [open, setOpen] = useState(false);
  const imageUrl = usePersonImage(personName);
  const s = sizeClasses[size];

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
        onClick={() => setOpen(true)}
      >
        <Avatar className={`${s.avatar} shrink-0`}>
          {imageUrl && <AvatarImage src={imageUrl} alt={personName} className="object-cover" />}
          <AvatarFallback className={s.fallbackText}>
            <User className={s.fallbackIcon} />
          </AvatarFallback>
        </Avatar>
        <span className={`${s.text} font-medium text-foreground truncate hover:underline cursor-pointer`}>
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

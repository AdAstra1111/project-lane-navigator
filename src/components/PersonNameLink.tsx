import { useState, useEffect, useRef } from 'react';
import { User } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import { usePersonLookup } from '@/hooks/usePersonImage';
import type { ProjectContext } from '@/components/ProjectAttachmentTabs';

interface ContactFields {
  agent_name: string;
  manager_name: string;
  agency: string;
  contact_phone: string;
  contact_email: string;
}

interface PersonNameLinkProps {
  personName: string;
  reason: string;
  projectContext?: ProjectContext;
  size?: 'sm' | 'md';
  onNameCorrected?: (canonicalName: string) => void;
  contactFields?: ContactFields;
  onContactSave?: (fields: ContactFields) => void;
  onExternalIds?: (ids: { imdb_id?: string; tmdb_id?: string }) => void;
}

const sizeClasses = {
  sm: { avatar: 'h-6 w-6', fallbackIcon: 'h-3 w-3', text: 'text-sm', fallbackText: 'text-[10px]' },
  md: { avatar: 'h-10 w-10', fallbackIcon: 'h-4 w-4', text: 'text-sm', fallbackText: 'text-xs' },
};

export function PersonNameLink({ personName, reason, projectContext, size = 'sm', onNameCorrected, contactFields, onContactSave, onExternalIds }: PersonNameLinkProps) {
  const [open, setOpen] = useState(false);
  const { imageUrl, canonicalName } = usePersonLookup(personName);
  const correctedRef = useRef(false);
  const s = sizeClasses[size];

  useEffect(() => {
    if (
      canonicalName &&
      imageUrl &&
      onNameCorrected &&
      !correctedRef.current &&
      canonicalName !== personName.trim()
    ) {
      correctedRef.current = true;
      onNameCorrected(canonicalName);
    }
  }, [canonicalName, imageUrl, personName, onNameCorrected]);

  const displayName = (canonicalName && imageUrl) ? canonicalName : personName;

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
        onClick={() => setOpen(true)}
      >
        <Avatar className={`${s.avatar} shrink-0`}>
          {imageUrl && <AvatarImage src={imageUrl} alt={displayName} className="object-cover" />}
          <AvatarFallback className={s.fallbackText}>
            <User className={s.fallbackIcon} />
          </AvatarFallback>
        </Avatar>
        <span className={`${s.text} font-medium text-foreground truncate hover:underline cursor-pointer`}>
          {displayName}
        </span>
      </button>
      <CastInfoDialog
        personName={displayName}
        reason={reason}
        open={open}
        onOpenChange={setOpen}
        projectContext={projectContext}
        contactFields={contactFields}
        onContactSave={onContactSave}
        onExternalIds={onExternalIds}
      />
    </>
  );
}

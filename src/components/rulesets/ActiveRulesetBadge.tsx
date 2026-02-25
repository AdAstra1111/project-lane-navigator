import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Lock } from 'lucide-react';
import type { ActiveEngineProfile } from '@/hooks/useProjectRuleset';

interface Props {
  profile: ActiveEngineProfile | null | undefined;
  isLocked?: boolean;
  className?: string;
}

export function ActiveRulesetBadge({ profile, isLocked, className }: Props) {
  if (!profile) {
    return (
      <Badge variant="outline" className={`text-[9px] gap-1 ${className || ''}`}>
        <Shield className="h-2.5 w-2.5" />
        Lane Defaults
      </Badge>
    );
  }

  const rules = profile.rules;
  const caps = [
    rules?.engine?.story_engine && `Engine: ${(rules.engine.story_engine as string).replace(/_/g, ' ')}`,
    rules?.budgets?.drama_budget != null && `Drama: ${rules.budgets.drama_budget}`,
    rules?.budgets?.twist_cap != null && `Twists: ${rules.budgets.twist_cap}`,
  ].filter(Boolean);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={`text-[9px] gap-1 cursor-default ${className || ''}`}>
          <Shield className="h-2.5 w-2.5 text-primary" />
          {profile.name || 'Engine Profile'}
          {isLocked && <Lock className="h-2 w-2 text-muted-foreground" />}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[10px] max-w-xs">
        <p className="font-medium mb-1">{profile.name}</p>
        {caps.length > 0 && <p className="text-muted-foreground">{caps.join(' · ')}</p>}
        {profile.conflicts?.length > 0 && (
          <p className="text-destructive mt-1">{profile.conflicts.length} conflict(s)</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

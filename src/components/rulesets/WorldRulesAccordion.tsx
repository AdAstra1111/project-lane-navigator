/**
 * WorldRulesAccordion — Unified accordion wrapping CompsPanel + WorldRulesPanel + Overrides.
 * Drop this into any generation entry point.
 */
import React, { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Shield, Lock, Unlock } from 'lucide-react';
import { CompsPanel } from './CompsPanel';
import { WorldRulesPanel } from './WorldRulesPanel';
import { ConflictsPanel } from './ConflictsPanel';
import { OverridesEditor } from './OverridesEditor';
import { ResolvedRulesPreview } from './ResolvedRulesPreview';
import { ActiveRulesetBadge } from './ActiveRulesetBadge';
import { useProjectRuleset } from '@/hooks/useProjectRuleset';

interface Props {
  projectId: string;
  lane: string;
  userId: string;
  className?: string;
}

export function WorldRulesAccordion({ projectId, lane, userId, className }: Props) {
  const {
    prefs, activeProfile, savePrefs, isLocked, autoDiversify,
    invalidateProfile,
  } = useProjectRuleset(projectId, lane);

  const handleInfluencersSet = () => {
    invalidateProfile();
  };

  const handleRulesChanged = () => {
    invalidateProfile();
  };

  const toggleLock = () => {
    savePrefs.mutate({ lock_ruleset: !isLocked });
  };

  const toggleDiversify = () => {
    savePrefs.mutate({ auto_diversify: !autoDiversify });
  };

  return (
    <Accordion type="single" collapsible className={className}>
      <AccordionItem value="world-rules" className="border-border/50">
        <AccordionTrigger className="py-2 text-xs hover:no-underline">
          <div className="flex items-center gap-2 w-full">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span>World Rules</span>
            <ActiveRulesetBadge profile={activeProfile} isLocked={isLocked} className="ml-auto mr-2" />
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Lock + Diversify toggles */}
          <div className="flex items-center gap-4 text-[10px]">
            <div className="flex items-center gap-1.5 cursor-pointer" onClick={toggleLock}>
              {isLocked ? <Lock className="h-3 w-3 text-primary" /> : <Unlock className="h-3 w-3 text-muted-foreground" />}
              <span className="text-muted-foreground">{isLocked ? 'Locked' : 'Unlocked'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch checked={autoDiversify} onCheckedChange={toggleDiversify} className="scale-75" />
              <span className="text-muted-foreground">Auto-diversify</span>
            </div>
          </div>

          {/* Comps Panel */}
          {!isLocked && (
            <CompsPanel
              projectId={projectId}
              lane={lane}
              userId={userId}
              onInfluencersSet={handleInfluencersSet}
            />
          )}

          {/* World Rules Panel */}
          <WorldRulesPanel
            projectId={projectId}
            lane={lane}
            userId={userId}
            engineProfile={activeProfile ? {
              id: activeProfile.id,
              rules: activeProfile.rules as any,
              rules_summary: activeProfile.rules_summary,
              conflicts: activeProfile.conflicts || [],
            } : null}
            savedPacingFeel={prefs.pacing_feel}
            savedBenchmark={prefs.style_benchmark}
            onRulesChanged={handleRulesChanged}
            onPacingPrefsChanged={(p) => {
              savePrefs.mutate({ pacing_feel: p.pacing_feel, style_benchmark: p.style_benchmark });
            }}
          />

          {/* Conflicts */}
          {activeProfile?.conflicts && activeProfile.conflicts.length > 0 && (
            <ConflictsPanel
              projectId={projectId}
              lane={lane}
              userId={userId}
              conflicts={activeProfile.conflicts}
              onResolved={handleRulesChanged}
            />
          )}

          {/* Overrides Editor */}
          {!isLocked && (
            <Accordion type="single" collapsible>
              <AccordionItem value="overrides" className="border-border/50">
                <AccordionTrigger className="py-1.5 text-[10px] hover:no-underline text-muted-foreground">
                  Override Rules
                </AccordionTrigger>
                <AccordionContent>
                  <OverridesEditor
                    projectId={projectId}
                    lane={lane}
                    userId={userId}
                    currentRules={activeProfile?.rules as any}
                    onSaved={handleRulesChanged}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/**
 * WorldRulesAccordion — Unified accordion wrapping CompsPanel + WorldRulesPanel + Overrides.
 * Drop this into any generation entry point.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { WritingVoiceSelector } from './WritingVoiceSelector';
import { TeamVoiceSelector } from './TeamVoiceSelector';
import { TeamVoiceManager } from './TeamVoiceManager';
import { useProjectRuleset } from '@/hooks/useProjectRuleset';
import { useTeamVoices, type TeamVoice } from '@/hooks/useTeamVoices';
import type { WritingVoicePreset } from '@/lib/writingVoices/types';

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

  const { voices } = useTeamVoices(userId);

  // --- Team Voice: draft state + race-proof auto-save ---
  const [draftTeamVoiceId, setDraftTeamVoiceId] = useState<string>(prefs.team_voice?.id ?? '');
  const [teamVoiceSaving, setTeamVoiceSaving] = useState(false);
  const [teamVoiceManagerOpen, setTeamVoiceManagerOpen] = useState(false);
  const latestTeamVoiceRef = useRef<string>('');

  useEffect(() => {
    setDraftTeamVoiceId(prefs.team_voice?.id ?? '');
  }, [prefs.team_voice?.id]);

  const handleTeamVoiceSelect = useCallback((voice: TeamVoice | null) => {
    const id = voice?.id ?? '';
    setDraftTeamVoiceId(id);
    latestTeamVoiceRef.current = id;
    setTeamVoiceSaving(true);
    savePrefs.mutate(
      {
        team_voice: voice ? {
          id: voice.id,
          label: voice.label,
          description: voice.description || undefined,
          updated_at: voice.updated_at,
        } : undefined,
      },
      {
        onSettled: () => {
          if (latestTeamVoiceRef.current === id) setTeamVoiceSaving(false);
        },
      },
    );
  }, [savePrefs]);

  // --- Writing Voice: draft state + race-proof auto-save ---
  const [draftVoiceId, setDraftVoiceId] = useState<string>(prefs.writing_voice?.id ?? '');
  const [voiceSaving, setVoiceSaving] = useState(false);
  const latestVoiceRef = useRef<string>('');

  // Sync draft when prefs load/change (e.g. lane switch)
  useEffect(() => {
    setDraftVoiceId(prefs.writing_voice?.id ?? '');
  }, [prefs.writing_voice?.id]);

  const handleVoiceSelect = useCallback((voice: WritingVoicePreset) => {
    const id = voice.id;
    setDraftVoiceId(id);
    latestVoiceRef.current = id;
    setVoiceSaving(true);
    savePrefs.mutate(
      { writing_voice: voice as any },
      {
        onSettled: () => {
          // Only clear saving if this was the last requested save
          if (latestVoiceRef.current === id) {
            setVoiceSaving(false);
          }
        },
      },
    );
  }, [savePrefs]);

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
    <>
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

          {/* Team Voice — auto-saves on select with race protection */}
          {!isLocked && (
            <TeamVoiceSelector
              voices={voices}
              selectedVoiceId={draftTeamVoiceId || null}
              onSelect={handleTeamVoiceSelect}
              onManage={() => setTeamVoiceManagerOpen(true)}
              disabled={teamVoiceSaving}
            />
          )}
          {teamVoiceSaving && (
            <p className="text-[9px] text-muted-foreground animate-pulse ml-1">Saving…</p>
          )}

          {/* Writing Voice — auto-saves on select with race protection */}
          {!isLocked && (
            <WritingVoiceSelector
              lane={lane}
              selectedVoiceId={draftVoiceId}
              onSelect={handleVoiceSelect}
              disabled={voiceSaving}
            />
          )}
          {voiceSaving && (
            <p className="text-[9px] text-muted-foreground animate-pulse ml-1">Saving…</p>
          )}

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

      {/* Team Voice Manager Dialog */}
      <TeamVoiceManager
        open={teamVoiceManagerOpen}
        onOpenChange={setTeamVoiceManagerOpen}
        projectId={projectId}
        lane={lane}
        userId={userId}
        onVoiceCreated={(voice) => handleTeamVoiceSelect(voice)}
      />
    </>
  );
}

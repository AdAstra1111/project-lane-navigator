/**
 * SeriesWriterReadiness — Readiness scoring panel for entering Series Writer stage.
 * Shows score ring, component breakdown, blockers, and "Enter Series Writer" button.
 */

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Layers, Lock, AlertTriangle, CheckCircle2, ArrowRight, 
  Loader2, ChevronDown, ChevronUp, Gauge, Shield 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { InfoTooltip } from '@/components/InfoTooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  computeSeriesWriterReadiness,
  blockerTargetStage,
  type SeriesWriterReadinessResult,
  type SeriesWriterReadinessInput,
  type SeriesWriterBlocker,
} from '@/lib/series-writer-readiness';
import { DELIVERABLE_LABELS, type DeliverableType } from '@/lib/dev-os-config';

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? 'hsl(145, 55%, 42%)'
    : score >= 60 ? 'hsl(38, 65%, 55%)'
    : score >= 40 ? 'hsl(38, 80%, 55%)'
    : 'hsl(0, 62%, 50%)';

  return (
    <div className="relative w-[72px] h-[72px]">
      <svg className="w-[72px] h-[72px] -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="36" stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
        <motion.circle
          cx="50" cy="50" r="36"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-display font-bold text-foreground">{score}</span>
      </div>
    </div>
  );
}

function ComponentBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">{score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${
            score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5, delay: 0.3 }}
        />
      </div>
    </div>
  );
}

function BlockerItem({ blocker, onGoTo }: { blocker: SeriesWriterBlocker; onGoTo: (stage: string) => void }) {
  const severityColor = blocker.severity === 'high' ? 'text-red-400' : blocker.severity === 'med' ? 'text-amber-400' : 'text-muted-foreground';
  const target = blockerTargetStage(blocker.code);

  return (
    <div className="flex items-start gap-2 text-xs">
      <AlertTriangle className={`h-3 w-3 shrink-0 mt-0.5 ${severityColor}`} />
      <div className="flex-1 min-w-0">
        <span className={severityColor}>{blocker.message}</span>
        <p className="text-[10px] text-muted-foreground mt-0.5">{blocker.how_to_fix}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[10px] shrink-0"
        onClick={() => onGoTo(target)}
      >
        Go to {DELIVERABLE_LABELS[target as DeliverableType] || target}
      </Button>
    </div>
  );
}

interface Props {
  projectId: string;
  onEnterSeriesWriter: () => void;
  onGoToStage: (stage: string) => void;
  isEntering?: boolean;
}

export function SeriesWriterReadiness({ projectId, onEnterSeriesWriter, onGoToStage, isEntering }: Props) {
  const [readiness, setReadiness] = useState<SeriesWriterReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockersOpen, setBlockersOpen] = useState(true);

  useEffect(() => {
    computeReadiness();
  }, [projectId]);

  async function computeReadiness() {
    setLoading(true);
    try {
      // Fetch all project documents
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, doc_type, plaintext, extracted_text')
        .eq('project_id', projectId);

      const { data: project } = await supabase
        .from('projects')
        .select('season_episode_count')
        .eq('id', projectId)
        .single();

      const existingDocTypes = (docs || []).map(d => d.doc_type);
      const seasonEpisodeCount = (project as any)?.season_episode_count ?? null;

      // Find specific documents
      const findDoc = (type: string) => (docs || []).find(d => 
        d.doc_type.toLowerCase().replace(/[\s\-]+/g, '_') === type
      );

      const gridDoc = findDoc('episode_grid');
      const blueprintDoc = findDoc('blueprint') || findDoc('season_arc');
      const bibleDoc = findDoc('character_bible');
      const scriptDoc = findDoc('script');

      // Get latest version texts
      const getText = async (docId: string | undefined): Promise<string | null> => {
        if (!docId) return null;
        const { data } = await supabase
          .from('project_document_versions')
          .select('plaintext')
          .eq('document_id', docId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data?.plaintext as string) || null;
      };

      const [gridText, bpText, cbText, scriptText] = await Promise.all([
        getText(gridDoc?.id),
        getText(blueprintDoc?.id),
        getText(bibleDoc?.id),
        getText(scriptDoc?.id),
      ]);

      // Simple screenplay format checks for Episode 1
      let sceneHeadingCount = 0;
      let dialogueBlockCount = 0;
      if (scriptText) {
        const lines = scriptText.split('\n');
        sceneHeadingCount = lines.filter(l => /^(INT\.|EXT\.)/.test(l.trim())).length;
        // Count dialogue blocks (character name in caps followed by dialogue)
        let inDialogue = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (/^[A-Z][A-Z\s\.\-]+$/.test(trimmed) && trimmed.length > 1 && trimmed.length < 40) {
            inDialogue = true;
          } else if (inDialogue && trimmed.length > 0) {
            dialogueBlockCount++;
            inDialogue = false;
          } else {
            inDialogue = false;
          }
        }
      }

      // Check for open high drift flags
      const { count: driftCount } = await (supabase as any)
        .from('document_drift_events')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('drift_level', 'major')
        .eq('resolved', false);

      const input: SeriesWriterReadinessInput = {
        existingDocTypes,
        seasonEpisodeCount,
        episodeGridText: gridText || gridDoc?.plaintext || gridDoc?.extracted_text || null,
        episodeGridApproved: !!gridDoc, // Treat existence as approval for now
        blueprintText: bpText || blueprintDoc?.plaintext || blueprintDoc?.extracted_text || null,
        blueprintApproved: !!blueprintDoc,
        characterBibleText: cbText || bibleDoc?.plaintext || bibleDoc?.extracted_text || null,
        characterBibleApproved: !!bibleDoc,
        episode1ScriptText: scriptText,
        episode1Approved: !!scriptDoc,
        episode1SceneHeadingCount: sceneHeadingCount,
        episode1DialogueBlockCount: dialogueBlockCount,
        episode1CliffhangerStrength: null,
        episode1RetentionScore: null,
        openHighDriftFlags: driftCount || 0,
        canonConsistencyScore: null,
      };

      const result = computeSeriesWriterReadiness(input);
      setReadiness(result);
    } catch (err) {
      console.error('Readiness computation error:', err);
      toast.error('Failed to compute Series Writer readiness');
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!readiness) return null;

  const { readiness_score, components, blockers, eligible, recommendation_message } = readiness;
  const highBlockers = blockers.filter(b => b.severity === 'high');
  const otherBlockers = blockers.filter(b => b.severity !== 'high');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={`${eligible ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/50'}`}>
        <CardContent className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Series Writer Readiness</h3>
            <InfoTooltip text="All five structural components must pass before entering canon-locked Series Writer mode." />
          </div>

          {/* Score + Components */}
          <div className="flex items-center gap-4">
            <ScoreRing score={readiness_score} />
            <div className="flex-1 space-y-1.5">
              <ComponentBar label="Episode Grid" score={components.episode_grid_integrity} />
              <ComponentBar label="Blueprint" score={components.blueprint_stability} />
              <ComponentBar label="Character Bible" score={components.character_bible_completeness} />
              <ComponentBar label="Episode 1" score={components.episode1_quality} />
              <ComponentBar label="Canon Consistency" score={components.canon_consistency} />
            </div>
          </div>

          {/* Recommendation */}
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
            eligible ? 'bg-emerald-500/10' : 'bg-amber-500/10'
          }`}>
            {eligible ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            )}
            <p className="text-xs text-foreground font-medium">{recommendation_message}</p>
          </div>

          {/* Blockers */}
          {blockers.length > 0 && (
            <Collapsible open={blockersOpen} onOpenChange={setBlockersOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full">
                {blockersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>{blockers.length} blocker{blockers.length !== 1 ? 's' : ''}</span>
                {highBlockers.length > 0 && (
                  <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400 bg-red-500/10 ml-auto">
                    {highBlockers.length} critical
                  </Badge>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {blockers.map((b, i) => (
                  <BlockerItem key={i} blocker={b} onGoTo={onGoToStage} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Enter Button */}
          {eligible && (
            <Button
              onClick={onEnterSeriesWriter}
              disabled={isEntering}
              className="w-full h-9 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              {isEntering ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Creating Canon Snapshot…</>
              ) : (
                <><Lock className="h-3 w-3" /> Enter Series Writer (Episodes 2–N)</>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

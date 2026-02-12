/**
 * Script Engine Panel: Multi-phase script development pipeline.
 * Blueprint → Architecture → Batched Drafting → Quality Scoring → Rewrite → Lock
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Pen, BookOpen, Layers, BarChart3, Lock,
  ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2,
  MapPin, Users, Download, Eye, Copy, ArrowRight, FileText, Clock, FileCode
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/InfoTooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useScriptEngine, type ScriptScene } from '@/hooks/useScriptEngine';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

const STATUS_ORDER = ['BLUEPRINT', 'ARCHITECTURE', 'DRAFTING', 'DRAFT_1', 'DRAFT_2', 'DRAFT_3', 'LOCKED'];
const REWRITE_PASSES = [
  { key: 'structural', label: 'Structural Tightening', icon: Layers },
  { key: 'character', label: 'Character Depth', icon: Users },
  { key: 'dialogue', label: 'Dialogue Sharpening', icon: Pen },
  { key: 'market', label: 'Market Alignment', icon: BarChart3 },
  { key: 'production', label: 'Production Realism', icon: MapPin },
];

function ScoreBar({ label, score, tooltip }: { label: string; score: number | null; tooltip?: string }) {
  if (score == null) return null;
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <span className="font-mono font-medium text-foreground">{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function PhaseStep({ label, status }: { label: string; status: 'done' | 'current' | 'pending' }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${
      status === 'done' ? 'text-emerald-400' : status === 'current' ? 'text-primary font-medium' : 'text-muted-foreground'
    }`}>
      {status === 'done' ? <CheckCircle2 className="h-3 w-3" /> :
       status === 'current' ? <Circle className="h-3 w-3 fill-primary/20" /> :
       <Circle className="h-3 w-3" />}
      {label}
    </div>
  );
}

function SceneRow({ scene }: { scene: ScriptScene }) {
  const weightColor = scene.production_weight === 'HIGH' ? 'text-red-400 bg-red-500/10' :
    scene.production_weight === 'LOW' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10';

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs font-mono text-muted-foreground w-6 shrink-0 pt-0.5">{scene.scene_number}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-relaxed">{scene.beat_summary}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{scene.pov_character}</span>
          {scene.location && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <MapPin className="h-2.5 w-2.5" /> {scene.location}
            </span>
          )}
          {scene.cast_size > 1 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" /> {scene.cast_size}
            </span>
          )}
          <span className={`text-[9px] px-1 py-0 rounded font-medium ${weightColor}`}>{scene.production_weight}</span>
          {scene.conflict_type && (
            <span className="text-[9px] px-1 py-0 rounded border border-border text-muted-foreground">{scene.conflict_type}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftViewer({ text, storagePath, onDownload, onCopy }: {
  text: string;
  storagePath: string | null;
  onDownload: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Eye className="h-3 w-3" /> Draft Output
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={onCopy}>
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={onDownload}>
            <Download className="h-3 w-3 mr-1" /> Download
          </Button>
        </div>
      </div>
      <ScrollArea className="h-80">
        <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">
          {text}
        </pre>
      </ScrollArea>
    </div>
  );
}

export function ScriptEnginePanel({ projectId }: Props) {
  const {
    activeScript, scenes, versions, blueprint, isLoading,
    draftText, draftStoragePath, setDraftText,
    generateBlueprint, generateArchitecture, generateDraft,
    scoreScript, rewritePass, lockScript, fetchDraft, importToDocs,
  } = useScriptEngine(projectId);

  const [showScenes, setShowScenes] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [showDraft, setShowDraft] = useState(true);

  // Auto-load latest draft text from storage when panel mounts (if we have a path but no text)
  useEffect(() => {
    if (!draftText && activeScript?.latest_batch_storage_path && !fetchDraft.isPending) {
      fetchDraft.mutate(activeScript.latest_batch_storage_path);
    }
  }, [activeScript?.latest_batch_storage_path]);

  const status = activeScript?.status || '';
  const isLocked = status === 'LOCKED';
  const hasDraft = status.startsWith('DRAFT_') || status === 'DRAFTING';
  const hasArchitecture = scenes.length > 0;
  const hasBlueprint = !!blueprint;
  const isAnyLoading = generateBlueprint.isPending || generateArchitecture.isPending ||
    generateDraft.isPending || scoreScript.isPending || rewritePass.isPending || lockScript.isPending;

  // Compute next batch info
  const maxScene = hasArchitecture ? Math.max(...scenes.map(s => s.scene_number)) : 0;
  const lastBatchIndex = activeScript?.latest_batch_index || 0;
  const nextBatchStart = lastBatchIndex > 0 ? (lastBatchIndex * 15) + 1 : 1;
  const allBatchesDone = nextBatchStart > maxScene;

  function getPhaseStatus(phase: string): 'done' | 'current' | 'pending' {
    const order = STATUS_ORDER;
    const currentIdx = order.findIndex(s => status.startsWith(s) || status === s);
    const phaseIdx = order.indexOf(phase);
    if (currentIdx < 0) return phase === 'BLUEPRINT' ? 'current' : 'pending';
    if (phaseIdx < currentIdx) return 'done';
    if (phaseIdx === currentIdx) return 'current';
    return 'pending';
  }

  const scores = activeScript ? [
    activeScript.structural_score, activeScript.dialogue_score,
    activeScript.economy_score, activeScript.budget_score, activeScript.lane_alignment_score,
  ].filter(s => s != null) : [];
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a! + b!, 0)! / scores.length)
    : null;

  function handleCopyDraft() {
    if (draftText) {
      navigator.clipboard.writeText(draftText);
      toast.success('Draft text copied');
    }
  }

  function handleDownloadDraft() {
    if (draftText) {
      const blob = new Blob([draftText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `draft_${activeScript?.draft_number || 1}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function handleContinueNextBatch() {
    if (!allBatchesDone) {
      generateDraft.mutate({ batchStart: nextBatchStart, batchEnd: Math.min(nextBatchStart + 14, maxScene) });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Pen className="h-4 w-4 text-primary" />
        <h4 className="font-display font-semibold text-foreground">Script Engine</h4>
        <InfoTooltip text="Multi-phase AI script development: Blueprint → Architecture → Draft → Score → Rewrite → Lock" />
        {activeScript && (
          <Badge className={`ml-auto text-[10px] ${
            isLocked ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
            'bg-primary/15 text-primary border-primary/30'
          }`}>
            {isLocked ? 'LOCKED' : status.replace('_', ' ')}
          </Badge>
        )}
      </div>

      {/* Page Count + Runtime Metrics */}
      {activeScript && (activeScript.latest_page_count_est || activeScript.latest_runtime_min_est) && (
        <div className="flex items-center gap-4 mb-3 text-xs">
          {activeScript.latest_page_count_est && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <FileCode className="h-3 w-3" />
              <span className="font-medium text-foreground">~{Math.round(activeScript.latest_page_count_est)} pages</span>
            </span>
          )}
          {activeScript.latest_runtime_min_est && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="font-medium text-foreground">
                ~{Math.round(activeScript.latest_runtime_min_est)} min
              </span>
              {activeScript.latest_runtime_min_low && activeScript.latest_runtime_min_high && (
                <span className="text-muted-foreground">
                  ({Math.round(activeScript.latest_runtime_min_low)}–{Math.round(activeScript.latest_runtime_min_high)})
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Phase Progress */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <PhaseStep label="Blueprint" status={getPhaseStatus('BLUEPRINT')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        <PhaseStep label="Architecture" status={getPhaseStatus('ARCHITECTURE')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        <PhaseStep label="Draft" status={getPhaseStatus('DRAFTING')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        <PhaseStep label="Score & Rewrite" status={hasDraft && status.startsWith('DRAFT_') ? 'current' : 'pending'} />
        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        <PhaseStep label="Locked" status={getPhaseStatus('LOCKED')} />
      </div>

      {/* Action Buttons */}
      {!isLocked && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            size="sm"
            variant={hasBlueprint ? "outline" : "default"}
            onClick={() => generateBlueprint.mutate()}
            disabled={isAnyLoading}
          >
            {generateBlueprint.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <BookOpen className="h-3 w-3 mr-1" />}
            {hasBlueprint ? 'Regenerate Blueprint' : 'Generate Blueprint'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => generateArchitecture.mutate()}
            disabled={isAnyLoading || !hasBlueprint}
          >
            {generateArchitecture.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Layers className="h-3 w-3 mr-1" />}
            Generate Architecture
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => generateDraft.mutate({})}
            disabled={isAnyLoading || !hasArchitecture}
          >
            {generateDraft.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Pen className="h-3 w-3 mr-1" />}
            {status === 'DRAFTING' && !allBatchesDone ? 'Continue Draft' : 'Draft Script'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => scoreScript.mutate()}
            disabled={isAnyLoading || !hasDraft}
          >
            {scoreScript.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <BarChart3 className="h-3 w-3 mr-1" />}
            Score Quality
          </Button>

          {hasDraft && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => lockScript.mutate()}
              disabled={isAnyLoading}
              className="ml-auto"
            >
              <Lock className="h-3 w-3 mr-1" /> Lock Script
            </Button>
          )}
        </div>
      )}

      {/* Draft Output Viewer */}
      {draftText && showDraft && (
        <DraftViewer
          text={draftText}
          storagePath={draftStoragePath}
          onDownload={handleDownloadDraft}
          onCopy={handleCopyDraft}
        />
      )}

      {/* Continue Next Batch button */}
      {status === 'DRAFTING' && !allBatchesDone && !isLocked && draftText && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleContinueNextBatch}
            disabled={isAnyLoading}
          >
            {generateDraft.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowRight className="h-3 w-3 mr-1" />}
            Continue Next Batch (scenes {nextBatchStart}–{Math.min(nextBatchStart + 14, maxScene)})
          </Button>
          <span className="text-xs text-muted-foreground">
            {lastBatchIndex} of {Math.ceil(maxScene / 15)} batches complete
          </span>
        </div>
      )}

      {/* Import for Coverage button — shown when draft is complete */}
      {hasDraft && status.startsWith('DRAFT_') && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => importToDocs.mutate()}
            disabled={isAnyLoading || importToDocs.isPending}
          >
            {importToDocs.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
            Import for Coverage
          </Button>
          <span className="text-xs text-muted-foreground">
            Adds draft to Documents for Script Coverage analysis
          </span>
        </div>
      )}

      {/* Toggle draft viewer when draft exists but is hidden */}
      {draftText && !showDraft && (
        <button
          onClick={() => setShowDraft(true)}
          className="text-xs text-primary hover:underline mt-2"
        >
          Show draft output
        </button>
      )}

      {/* Load draft from storage if we have versions with paths but no text loaded */}
      {!draftText && hasDraft && versions.some(v => v.full_text_storage_path) && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const latestWithPath = versions.find(v => v.full_text_storage_path);
              if (latestWithPath?.full_text_storage_path) {
                fetchDraft.mutate(latestWithPath.full_text_storage_path);
              }
            }}
            disabled={fetchDraft.isPending}
          >
            {fetchDraft.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
            Open Draft
          </Button>
        </div>
      )}

      {/* Quality Scores */}
      {activeScript && avgScore != null && (
        <div className="mb-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Quality Scores</span>
            <span className={`text-sm font-mono font-bold ${
              avgScore >= 80 ? 'text-emerald-400' : avgScore >= 60 ? 'text-amber-400' : 'text-red-400'
            }`}>{avgScore} avg</span>
          </div>
          <div className="grid gap-2">
            <ScoreBar label="Structural" score={activeScript.structural_score} tooltip="Tension, stakes, act breaks, scene necessity" />
            <ScoreBar label="Dialogue" score={activeScript.dialogue_score} tooltip="Subtext, voice differentiation, exposition density" />
            <ScoreBar label="Economy" score={activeScript.economy_score} tooltip="Repetition, redundancy, compressibility" />
            <ScoreBar label="Budget" score={activeScript.budget_score} tooltip="Location/cast/VFX creep vs budget band" />
            <ScoreBar label="Lane Alignment" score={activeScript.lane_alignment_score} tooltip="Tone drift, market lane match, audience fit" />
          </div>
        </div>
      )}

      {/* Rewrite Passes */}
      {hasDraft && status.startsWith('DRAFT_') && !isLocked && (
        <div className="mb-4">
          <p className="text-xs font-medium text-foreground mb-2">Rewrite Passes</p>
          <div className="flex flex-wrap gap-1.5">
            {REWRITE_PASSES.map(p => (
              <Button
                key={p.key}
                size="sm"
                variant="outline"
                className="text-[11px] h-7"
                onClick={() => rewritePass.mutate(p.key)}
                disabled={isAnyLoading}
              >
                {rewritePass.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <p.icon className="h-3 w-3 mr-1" />}
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Blueprint Preview */}
      {hasBlueprint && (
        <Collapsible open={showBlueprint} onOpenChange={setShowBlueprint}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full mb-2">
            {showBlueprint ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Blueprint Preview
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-foreground leading-relaxed max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-mono text-[11px]">
                {JSON.stringify(blueprint, null, 2)}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Scene Architecture */}
      {hasArchitecture && (
        <Collapsible open={showScenes} onOpenChange={setShowScenes}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full mb-2">
            {showScenes ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Scene Architecture ({scenes.length} scenes)
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-80 overflow-y-auto">
              {scenes.map(scene => (
                <SceneRow key={scene.id} scene={scene} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Draft History */}
      {versions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-foreground mb-2">Draft History</p>
          <div className="space-y-1">
            {versions.filter(v => v.draft_number > 0 || v.full_text_storage_path).map(v => (
              <div key={v.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-foreground">
                    {v.is_partial ? `Batch ${v.batch_index}` : `Draft ${v.draft_number}`}
                    {v.rewrite_pass && <span className="text-muted-foreground ml-1">({v.rewrite_pass})</span>}
                  </span>
                  {v.page_count_est != null && (
                    <span className="text-muted-foreground text-[10px]">~{Math.round(v.page_count_est)} pg</span>
                  )}
                  {v.runtime_min_est != null && (
                    <span className="text-muted-foreground text-[10px]">
                      ~{Math.round(v.runtime_min_est)} min
                      {v.runtime_min_low != null && v.runtime_min_high != null &&
                        ` (${Math.round(v.runtime_min_low)}–${Math.round(v.runtime_min_high)})`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {v.full_text_storage_path && (
                    <button
                      onClick={() => fetchDraft.mutate(v.full_text_storage_path!)}
                      className="text-primary hover:underline text-[10px]"
                    >
                      View
                    </button>
                  )}
                  <span className="text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!activeScript && !isLoading && (
        <div className="text-center py-6">
          <Pen className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No engine script started</p>
          <p className="text-xs text-muted-foreground mt-1">Generate a blueprint to begin the development pipeline</p>
        </div>
      )}
    </motion.div>
  );
}

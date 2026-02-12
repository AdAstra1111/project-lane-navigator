import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, Unlock, FlaskConical, ScrollText, Users, Globe, Palette, Map,
  Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  Copy, Shield, History, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConceptExpansion, useStressTest, useConceptLockVersions } from '@/hooks/useConceptLock';
import type { PitchIdea } from '@/hooks/usePitchIdeas';

interface Props {
  idea: PitchIdea;
  onUpdate?: (params: { id: string } & Partial<PitchIdea>) => void;
}

const PASS_THRESHOLD = 70;
const MIN_DIMENSION = 50;

export function ConceptLockPanel({ idea, onUpdate }: Props) {
  const { latestExpansion, expand, expanding } = useConceptExpansion(idea.id);
  const { latestTest, runTest, testing } = useStressTest(latestExpansion?.id || null);
  const { versions, lock, unlock } = useConceptLockVersions(idea.id);
  const [activeDocTab, setActiveDocTab] = useState('treatment');
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const isLocked = (idea as any).concept_lock_status === 'locked';
  const lockVersion = (idea as any).concept_lock_version || 0;

  const handleExpand = async () => {
    await expand({ pitchIdea: idea, productionType: idea.production_type });
  };

  const handleStressTest = async () => {
    if (!latestExpansion) return;
    await runTest({ pitchIdea: idea, expansion: latestExpansion, productionType: idea.production_type });
  };

  const handleLock = async () => {
    if (!latestTest || !latestExpansion || !latestTest.passed) return;
    await lock({
      lockedFields: {
        title: idea.title,
        logline: idea.logline,
        genre: idea.genre,
        recommended_lane: idea.recommended_lane,
        budget_band: idea.budget_band,
        risk_level: idea.risk_level,
        one_page_pitch: idea.one_page_pitch,
      },
      stressTestId: latestTest.id,
      expansionId: latestExpansion.id,
    });
  };

  const handleUnlock = async () => {
    await unlock(unlockReason || 'Core element changed');
    setUnlockDialogOpen(false);
    setUnlockReason('');
  };

  const copyDoc = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const docTabs = [
    { key: 'treatment', label: 'Treatment', icon: ScrollText, content: latestExpansion?.treatment },
    { key: 'characters', label: 'Characters', icon: Users, content: latestExpansion?.character_bible },
    { key: 'world', label: 'World', icon: Globe, content: latestExpansion?.world_bible },
    { key: 'tone', label: 'Tone', icon: Palette, content: latestExpansion?.tone_doc },
    { key: 'arc', label: 'Arc Map', icon: Map, content: latestExpansion?.arc_map },
  ];

  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const progressColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border/30">
      {/* Header with lock status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">Concept Lock</h3>
          {isLocked && (
            <Badge className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
              <Lock className="h-3 w-3" /> Locked v{lockVersion}
            </Badge>
          )}
          {!isLocked && lockVersion > 0 && (
            <Badge variant="outline" className="gap-1 text-yellow-400 border-yellow-500/30">
              <Unlock className="h-3 w-3" /> Unlocked
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {versions.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setVersionHistoryOpen(!versionHistoryOpen)}>
              <History className="h-3 w-3" /> v{lockVersion}
            </Button>
          )}
          {isLocked && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-yellow-400 border-yellow-500/30" onClick={() => setUnlockDialogOpen(true)}>
              <Unlock className="h-3 w-3" /> Unlock
            </Button>
          )}
        </div>
      </div>

      {/* Version History */}
      <AnimatePresence>
        {versionHistoryOpen && versions.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <Card className="border-border/30">
              <CardContent className="pt-4 space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Version History</h4>
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm border-b border-border/20 pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">v{v.version}</Badge>
                      <span className="text-muted-foreground text-xs">{new Date(v.locked_at).toLocaleDateString()}</span>
                    </div>
                    {v.unlocked_at ? (
                      <span className="text-xs text-yellow-400">Unlocked: {v.unlock_reason}</span>
                    ) : (
                      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">Active</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 1: Expansion Engine */}
      <Card className="border-border/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              Phase 1: Expansion Engine
            </CardTitle>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleExpand}
              disabled={expanding || isLocked}
            >
              {expanding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {latestExpansion ? 'Re-expand' : 'Generate'}
            </Button>
          </div>
        </CardHeader>
        {latestExpansion && (
          <CardContent className="pt-0">
            <Tabs value={activeDocTab} onValueChange={setActiveDocTab}>
              <TabsList className="h-8 w-full justify-start">
                {docTabs.map(t => (
                  <TabsTrigger key={t.key} value={t.key} className="text-xs gap-1 h-7">
                    <t.icon className="h-3 w-3" /> {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {docTabs.map(t => (
                <TabsContent key={t.key} value={t.key} className="mt-3">
                  <div className="flex justify-end mb-2">
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => copyDoc(t.label, t.content || '')}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <div className="max-h-96 overflow-y-auto rounded-md border border-border/20 p-4 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {t.content || 'No content generated.'}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
            <div className="mt-2 text-xs text-muted-foreground">
              Expansion v{latestExpansion.version} • {idea.production_type} • Generated {new Date(latestExpansion.created_at).toLocaleDateString()}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Phase 2: Stress Test Engine */}
      {latestExpansion && (
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                Phase 2: Stress Test
              </CardTitle>
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleStressTest}
                disabled={testing || isLocked}
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                {latestTest ? 'Re-test' : 'Run Test'}
              </Button>
            </div>
          </CardHeader>
          {latestTest && (
            <CardContent className="pt-0 space-y-3">
              {/* Overall result */}
              <div className="flex items-center gap-3">
                {latestTest.passed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-400" />
                )}
                <span className={cn('text-lg font-bold', scoreColor(Number(latestTest.score_total)))}>
                  {Number(latestTest.score_total).toFixed(0)}
                </span>
                <Badge className={latestTest.passed ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}>
                  {latestTest.passed ? 'PASSED' : 'FAILED'}
                </Badge>
                {latestTest.passed && !isLocked && (
                  <Button size="sm" className="h-7 text-xs gap-1 ml-auto" onClick={handleLock}>
                    <Lock className="h-3 w-3" /> Lock Concept
                  </Button>
                )}
              </div>

              {/* Score bars */}
              {[
                { label: 'Creative Structure', score: Number(latestTest.score_creative_structure), key: 'creative_structure' },
                { label: 'Market Alignment', score: Number(latestTest.score_market_alignment), key: 'market_alignment' },
                { label: 'Engine Sustainability', score: Number(latestTest.score_engine_sustainability), key: 'engine_sustainability' },
              ].map(dim => {
                const detail = latestTest.details?.[dim.key];
                return (
                  <Collapsible key={dim.key}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{dim.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={cn('font-bold', scoreColor(dim.score))}>{dim.score}</span>
                          {dim.score < MIN_DIMENSION && <AlertTriangle className="h-3 w-3 text-red-400" />}
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', progressColor(dim.score))} style={{ width: `${dim.score}%` }} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2 pl-2 border-l-2 border-border/30">
                      {detail?.strengths?.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-green-400">Strengths</span>
                          {detail.strengths.map((s: string, i: number) => (
                            <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                          ))}
                        </div>
                      )}
                      {detail?.weaknesses?.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-red-400">Weaknesses</span>
                          {detail.weaknesses.map((w: string, i: number) => (
                            <p key={i} className="text-xs text-muted-foreground">• {w}</p>
                          ))}
                        </div>
                      )}
                      {detail?.critical_question && (
                        <div>
                          <span className="text-xs font-semibold text-yellow-400">Critical Question</span>
                          <p className="text-xs text-muted-foreground">{detail.critical_question}</p>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}

              {/* Verdict */}
              {latestTest.details?.overall_verdict && (
                <p className="text-xs text-muted-foreground italic border-t border-border/20 pt-2">
                  {latestTest.details.overall_verdict}
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Unlock Dialog */}
      <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock Concept</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Unlocking will require re-expansion and re-testing before the concept can be locked again. Provide a reason for unlocking.
          </p>
          <Textarea
            placeholder="Reason for unlocking (e.g., 'Changing protagonist goal based on market feedback')"
            value={unlockReason}
            onChange={(e) => setUnlockReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleUnlock}>Unlock & Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * GenerateSeedPackModal — Pitch Architecture Engine v1.
 * Generates deterministic seed pack + strategic analysis.
 * NEC edits committed via server-side commitOnly flow (no client DB writes).
 */
import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sprout, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultLane?: string;
  onSuccess?: () => void;
}

const LANE_OPTIONS = [
  { value: 'feature_film', label: 'Feature Film' },
  { value: 'series', label: 'Series' },
  { value: 'vertical_drama', label: 'Vertical Drama' },
  { value: 'documentary', label: 'Documentary' },
];

const RISK_OPTIONS = [
  { value: 'auto', label: 'Auto (Restrained)' },
  { value: 'robust', label: 'Robust' },
  { value: 'edge', label: 'Edge' },
  { value: 'provocative', label: 'Provocative' },
];

const PROGRESS_STAGES = [
  'Distilling concept...',
  'Extracting emotional thesis...',
  'Stress-testing differentiation...',
  'Validating sustainability...',
  'Locking polarity...',
  'Testing inevitability...',
  'Constructing Narrative Energy Contract...',
  'Assembling Seed Pack...',
];

interface StrategicAnalysis {
  concept_distillation?: Record<string, string>;
  emotional_thesis?: Record<string, string>;
  differentiation_analysis?: Record<string, string>;
  sustainability_validation?: Record<string, string>;
  polarity_lock?: Record<string, string>;
  engine_inevitability_test?: Record<string, string>;
  failure_modes?: Array<{ risk: string; safeguard: string }>;
  risk_posture?: { derived_mode: string; justification: string; override_applied: boolean };
  compression?: { words_25?: string; words_75?: string };
}

export function GenerateSeedPackModal({ open, onOpenChange, projectId, defaultLane, onSuccess }: Props) {
  const [pitch, setPitch] = useState('');
  const [lane, setLane] = useState(defaultLane || 'feature_film');
  const [targetPlatform, setTargetPlatform] = useState('');
  const [riskPosture, setRiskPosture] = useState('auto');
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressIdx, setProgressIdx] = useState(0);
  const [strategicAnalysis, setStrategicAnalysis] = useState<StrategicAnalysis | null>(null);
  const [necText, setNecText] = useState('');
  const [necOriginal, setNecOriginal] = useState('');
  const [necDocId, setNecDocId] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === 'generating') {
      setProgressIdx(0);
      progressInterval.current = setInterval(() => {
        setProgressIdx(prev => (prev < PROGRESS_STAGES.length - 1 ? prev + 1 : prev));
      }, 2800);
    } else {
      if (progressInterval.current) clearInterval(progressInterval.current);
    }
    return () => { if (progressInterval.current) clearInterval(progressInterval.current); };
  }, [status]);

  const handleGenerate = async () => {
    if (!pitch.trim()) {
      toast({ title: 'Pitch required', description: 'Enter your project pitch.', variant: 'destructive' });
      return;
    }

    setStatus('generating');
    setErrorMsg('');
    setStrategicAnalysis(null);
    setNecText('');
    setNecOriginal('');
    setNecDocId(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-seed-pack', {
        body: {
          projectId,
          pitch: pitch.trim(),
          lane,
          targetPlatform: targetPlatform.trim() || null,
          riskOverride: riskPosture === 'auto' ? null : riskPosture,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setStatus('success');
      setStrategicAnalysis(data.strategic_analysis || null);

      if (data.nec) {
        setNecDocId(data.nec.document_id || null);
        setNecText(data.nec.plaintext || '');
        setNecOriginal(data.nec.plaintext || '');
      }

      toast({ title: 'Pitch Architecture complete', description: `${data.documents?.length || 0} documents created.` });
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const handleCommitNec = async () => {
    if (!necDocId || !necText.trim()) return;
    if (necText.trim() === necOriginal.trim()) {
      toast({ title: 'No changes', description: 'NEC text unchanged.' });
      return;
    }

    setIsCommitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('generate-seed-pack', {
        body: {
          projectId,
          pitch: pitch.trim(),
          lane,
          targetPlatform: targetPlatform.trim() || null,
          riskOverride: riskPosture === 'auto' ? null : riskPosture,
          commitOnly: true,
          necOverride: necText.trim(),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setNecOriginal(necText.trim());
      toast({ title: 'NEC updated', description: 'New version committed.' });
      onSuccess?.();
    } catch (err: unknown) {
      toast({ title: 'Commit failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsCommitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (status === 'generating' || isCommitting) return;
    onOpenChange(v);
    if (!v) {
      setStatus('idle');
      setErrorMsg('');
      setStrategicAnalysis(null);
      setNecText('');
      setNecOriginal('');
      setNecDocId(null);
      setAnalysisOpen(false);
    }
  };

  const renderAnalysisSection = (title: string, data: Record<string, string> | undefined) => {
    if (!data) return null;
    return (
      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</h4>
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{k.replace(/_/g, ' ')}:</span> {String(v)}
          </div>
        ))}
      </div>
    );
  };

  const showResults = status === 'success' && strategicAnalysis;
  const necChanged = necText.trim() !== necOriginal.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={showResults ? "sm:max-w-2xl max-h-[90vh]" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-primary" />
            {showResults ? 'Pitch Architecture — Results' : 'Pitch Architecture Engine'}
          </DialogTitle>
          <DialogDescription>
            {showResults
              ? 'Review strategic analysis and edit the Narrative Energy Contract before committing.'
              : 'Generate a structured, restrained seed pack with strategic analysis from your pitch.'}
          </DialogDescription>
        </DialogHeader>

        {!showResults && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="seed-pitch">Project Pitch</Label>
              <Textarea
                id="seed-pitch"
                placeholder="Describe your project concept, story, and vision..."
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                rows={5}
                disabled={status === 'generating'}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Lane</Label>
                <Select value={lane} onValueChange={setLane} disabled={status === 'generating'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Risk Posture</Label>
                <Select value={riskPosture} onValueChange={setRiskPosture} disabled={status === 'generating'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RISK_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="seed-platform">Platform <span className="text-muted-foreground text-xs">(opt)</span></Label>
                <Input
                  id="seed-platform"
                  placeholder="e.g. Netflix"
                  value={targetPlatform}
                  onChange={(e) => setTargetPlatform(e.target.value)}
                  disabled={status === 'generating'}
                />
              </div>
            </div>

            {status === 'generating' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-lg bg-muted/50">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span className="animate-pulse">{PROGRESS_STAGES[progressIdx]}</span>
              </div>
            )}
            {status === 'error' && (
              <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/10">
                <AlertTriangle className="h-4 w-4" />
                {errorMsg || 'Generation failed. Please try again.'}
              </div>
            )}
          </div>
        )}

        {showResults && (
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="space-y-4 py-2">
              {/* NEC Editor */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  Narrative Energy Contract
                  <span className="text-xs text-muted-foreground">(editable)</span>
                </Label>
                <Textarea
                  value={necText}
                  onChange={(e) => setNecText(e.target.value)}
                  rows={8}
                  className="text-xs font-mono resize-y"
                  disabled={isCommitting}
                />
                <Button
                  size="sm"
                  onClick={handleCommitNec}
                  disabled={!necChanged || isCommitting}
                  className="gap-1"
                >
                  {isCommitting
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <CheckCircle2 className="h-3 w-3" />}
                  Commit NEC Edits
                </Button>
              </div>

              {/* Strategic Analysis Collapsible */}
              <Collapsible open={analysisOpen} onOpenChange={setAnalysisOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors w-full py-2">
                  {analysisOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Strategic Analysis
                  <span className="text-xs text-muted-foreground font-normal">(read-only)</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-4 pt-2 pl-2 border-l border-border ml-2">
                    {renderAnalysisSection('Concept Distillation', strategicAnalysis.concept_distillation)}
                    {renderAnalysisSection('Emotional Thesis', strategicAnalysis.emotional_thesis)}
                    {renderAnalysisSection('Differentiation', strategicAnalysis.differentiation_analysis)}
                    {renderAnalysisSection('Sustainability', strategicAnalysis.sustainability_validation)}
                    {renderAnalysisSection('Polarity Lock', strategicAnalysis.polarity_lock)}
                    {renderAnalysisSection('Inevitability Test', strategicAnalysis.engine_inevitability_test)}

                    {strategicAnalysis.failure_modes && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Failure Modes</h4>
                        {strategicAnalysis.failure_modes.map((fm, i) => (
                          <div key={i} className="text-xs text-muted-foreground">
                            <span className="font-medium text-destructive/80">Risk:</span> {fm.risk}
                            <br />
                            <span className="font-medium text-primary/80">Safeguard:</span> {fm.safeguard}
                          </div>
                        ))}
                      </div>
                    )}

                    {strategicAnalysis.risk_posture && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Risk Posture</h4>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">Mode:</span> {strategicAnalysis.risk_posture.derived_mode}
                          {strategicAnalysis.risk_posture.override_applied && <span className="ml-1 text-accent">(override)</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{strategicAnalysis.risk_posture.justification}</div>
                      </div>
                    )}

                    {strategicAnalysis.compression && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Compression</h4>
                        {strategicAnalysis.compression.words_25 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">25w:</span> {strategicAnalysis.compression.words_25}
                          </div>
                        )}
                        {strategicAnalysis.compression.words_75 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">75w:</span> {strategicAnalysis.compression.words_75}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={status === 'generating' || isCommitting}>
            {showResults ? 'Close' : 'Cancel'}
          </Button>
          {!showResults && (
            <Button onClick={handleGenerate} disabled={status === 'generating' || !pitch.trim()} className="gap-1.5">
              {status === 'generating' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sprout className="h-3.5 w-3.5" />}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

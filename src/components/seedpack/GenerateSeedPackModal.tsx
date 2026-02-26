/**
 * GenerateSeedPackModal — Pitch Architecture Engine v1.
 * Generates deterministic seed pack + strategic analysis.
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
import { Loader2, Sprout, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Shield, Zap, Flame } from 'lucide-react';
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
  { value: 'auto', label: 'Auto (Restrained)', icon: null },
  { value: 'robust', label: 'Robust', icon: Shield },
  { value: 'edge', label: 'Edge', icon: Zap },
  { value: 'provocative', label: 'Provocative', icon: Flame },
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
  const [necDocId, setNecDocId] = useState<string | null>(null);
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

      // Find NEC doc
      const necDoc = (data.documents || []).find((d: any) => d.doc_type === 'nec');
      if (necDoc) setNecDocId(necDoc.document_id);

      // Find NEC content from strategic_analysis is not stored there — it's in the doc.
      // We need to fetch it from the version
      if (necDoc) {
        const { data: verData } = await supabase
          .from('project_document_versions')
          .select('plaintext')
          .eq('document_id', necDoc.document_id)
          .eq('is_current', true)
          .single();
        if (verData?.plaintext) setNecText(verData.plaintext);
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

    try {
      // Get max version
      const { data: maxVer } = await supabase
        .from('project_document_versions')
        .select('version_number')
        .eq('document_id', necDocId)
        .order('version_number', { ascending: false })
        .limit(1);

      const currentMax = maxVer?.[0]?.version_number || 1;

      // Check if text changed from current
      const { data: currentVer } = await supabase
        .from('project_document_versions')
        .select('plaintext')
        .eq('document_id', necDocId)
        .eq('is_current', true)
        .single();

      if (currentVer?.plaintext === necText.trim()) {
        toast({ title: 'No changes', description: 'NEC text unchanged.' });
        return;
      }

      // Clear current
      await supabase
        .from('project_document_versions')
        .update({ is_current: false } as any)
        .eq('document_id', necDocId)
        .eq('is_current', true);

      // Insert new version
      const { error } = await supabase
        .from('project_document_versions')
        .insert({
          document_id: necDocId,
          version_number: currentMax + 1,
          plaintext: necText.trim(),
          is_current: true,
          status: 'active',
          label: `nec_edited_v${currentMax + 1}`,
          approval_status: 'draft',
        } as any);

      if (error) throw error;
      toast({ title: 'NEC updated', description: `Version ${currentMax + 1} saved.` });
    } catch (err: unknown) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleClose = (v: boolean) => {
    if (status === 'generating') return;
    onOpenChange(v);
    if (!v) {
      setStatus('idle');
      setErrorMsg('');
      setStrategicAnalysis(null);
      setNecText('');
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
            <span className="font-medium text-foreground/80">{k.replace(/_/g, ' ')}:</span> {v}
          </div>
        ))}
      </div>
    );
  };

  const showResults = status === 'success' && strategicAnalysis;

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
                />
                <Button size="sm" onClick={handleCommitNec} className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Commit NEC Edits
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

                    {/* Failure Modes */}
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

                    {/* Risk Posture */}
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

                    {/* Compression */}
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
          <Button variant="outline" onClick={() => handleClose(false)} disabled={status === 'generating'}>
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

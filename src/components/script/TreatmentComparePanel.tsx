/**
 * Treatment vs Script Comparison Panel
 * Side-by-side view comparing treatment documents against the current script.
 * Includes AI-powered deep comparison analysis.
 */

import { useState } from 'react';
import { GitCompareArrows, FileText, ScrollText, ChevronDown, ChevronUp, Sparkles, Loader2, TrendingUp, TrendingDown, ArrowRight, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectDocument } from '@/lib/types';

interface TreatmentComparePanelProps {
  documents: ProjectDocument[];
  scriptText: string | null;
  currentScriptLabel?: string;
  projectContext?: {
    title?: string;
    genres?: string[];
    format?: string;
    tone?: string;
    budget_range?: string;
    assigned_lane?: string;
    target_audience?: string;
    comparable_titles?: string;
  };
}

interface CompareResult {
  overall_verdict: string;
  treatment_rating: { score: number; headline: string; strengths: string[]; weaknesses: string[] };
  script_rating: { score: number; headline: string; strengths: string[]; weaknesses: string[] };
  narrative_comparison: { structural_alignment: string; character_evolution: string; tone_consistency: string; pacing_analysis: string };
  commercial_analysis: { market_positioning: string; audience_clarity: string; packaging_leverage: string; budget_implications: string };
  key_divergences: { area: string; treatment_approach: string; script_approach: string; verdict: string }[];
  recommendations: string[];
  fidelity_score: number;
}

function ScoreRing({ score, label, size = 'md' }: { score: number; label: string; size?: 'sm' | 'md' }) {
  const color = score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const dim = size === 'sm' ? 'h-16 w-16' : 'h-20 w-20';
  const textSize = size === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${dim} rounded-full border-2 border-border/40 flex items-center justify-center bg-muted/20`}>
        <span className={`${textSize} font-bold ${color}`}>{score}</span>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

function RatingCard({ title, data, icon, color }: { title: string; data: CompareResult['treatment_rating']; icon: React.ReactNode; color: string }) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <div className={`${color} px-3 py-2 border-b border-border/40 flex items-center justify-between`}>
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-semibold">{title}</span>
        </div>
        <Badge variant="outline" className="text-xs">{data.score}/100</Badge>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs font-medium text-foreground">{data.headline}</p>
        <div className="space-y-1">
          {data.strengths.map((s, i) => (
            <div key={`s-${i}`} className="flex items-start gap-1.5 text-xs text-emerald-400">
              <TrendingUp className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{s}</span>
            </div>
          ))}
          {data.weaknesses.map((w, i) => (
            <div key={`w-${i}`} className="flex items-start gap-1.5 text-xs text-red-400">
              <TrendingDown className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{w}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TreatmentComparePanel({ documents, scriptText, currentScriptLabel, projectContext }: TreatmentComparePanelProps) {
  const treatments = documents.filter(d => d.doc_type === 'treatment' && d.extracted_text);
  const [selectedId, setSelectedId] = useState<string>(treatments[0]?.id || '');
  const [expanded, setExpanded] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);

  if (treatments.length === 0) return null;
  if (!scriptText) return null;

  const selectedTreatment = treatments.find(t => t.id === selectedId);
  const treatmentText = selectedTreatment?.extracted_text || '';

  const scriptWords = scriptText.split(/\s+/).length;
  const treatmentWords = treatmentText.split(/\s+/).length;

  const runDeepCompare = async () => {
    if (!treatmentText || !scriptText) return;
    setComparing(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('treatment-compare', {
        body: { treatmentText, scriptText, projectContext },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data as CompareResult);
      toast.success('Deep comparison complete');
    } catch (e: any) {
      console.error('Deep compare failed:', e);
      toast.error(e.message || 'Comparison failed. Please try again.');
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Treatment vs Script</h4>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={runDeepCompare}
            disabled={comparing}
            className="gap-1.5 text-xs"
          >
            {comparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {comparing ? 'Analysing…' : 'Deep Compare'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="gap-1 text-xs"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </div>

      {/* Treatment selector */}
      {treatments.length > 1 && (
        <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setResult(null); }}>
          <SelectTrigger className="w-full mb-3 h-8 text-xs">
            <SelectValue placeholder="Select treatment" />
          </SelectTrigger>
          <SelectContent>
            {treatments.map(t => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.file_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <ScrollText className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-xs font-medium text-muted-foreground">Treatment</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{selectedTreatment?.file_name}</p>
          <p className="text-xs text-muted-foreground">{treatmentWords.toLocaleString()} words</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-medium text-muted-foreground">Script</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{currentScriptLabel || 'Current Draft'}</p>
          <p className="text-xs text-muted-foreground">{scriptWords.toLocaleString()} words</p>
        </div>
      </div>

      {/* Ratio badge */}
      <div className="flex items-center gap-2 mb-4">
        <Badge variant="outline" className="text-xs">
          Treatment is {Math.round((treatmentWords / scriptWords) * 100)}% of script length
        </Badge>
      </div>

      {/* ── AI Deep Comparison Results ── */}
      {comparing && (
        <div className="border border-border/40 rounded-lg p-6 mb-4 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Running deep narrative & commercial analysis…</p>
          <p className="text-xs text-muted-foreground/60">This may take 15–30 seconds</p>
        </div>
      )}

      {result && (
        <div className="space-y-4 mb-4">
          {/* Score rings */}
          <div className="flex items-center justify-center gap-6 py-3">
            <ScoreRing score={result.treatment_rating.score} label="Treatment" />
            <ScoreRing score={result.fidelity_score} label="Fidelity" size="sm" />
            <ScoreRing score={result.script_rating.score} label="Script" />
          </div>

          {/* Verdict */}
          <div className="bg-muted/20 border border-border/40 rounded-lg p-4">
            <p className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-primary" /> Executive Verdict
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{result.overall_verdict}</p>
          </div>

          {/* Rating cards side by side */}
          <div className="grid grid-cols-2 gap-3">
            <RatingCard
              title="Treatment"
              data={result.treatment_rating}
              icon={<ScrollText className="h-3.5 w-3.5 text-purple-400" />}
              color="bg-purple-500/10"
            />
            <RatingCard
              title="Script"
              data={result.script_rating}
              icon={<FileText className="h-3.5 w-3.5 text-blue-400" />}
              color="bg-blue-500/10"
            />
          </div>

          {/* Narrative Comparison */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">Narrative Comparison</span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-3">
              {Object.entries(result.narrative_comparison).map(([key, val]) => (
                <div key={key} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Commercial Analysis */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">Commercial Analysis</span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-3">
              {Object.entries(result.commercial_analysis).map(([key, val]) => (
                <div key={key} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Key Divergences */}
          {result.key_divergences?.length > 0 && (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Key Divergences</span>
              </div>
              <div className="divide-y divide-border/30">
                {result.key_divergences.map((d, i) => (
                  <div key={i} className="p-3 space-y-1.5">
                    <Badge variant="outline" className="text-[10px]">{d.area}</Badge>
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                      <div>
                        <p className="text-[10px] text-purple-400 font-medium mb-0.5">Treatment</p>
                        <p className="text-xs text-muted-foreground">{d.treatment_approach}</p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40 mt-3" />
                      <div>
                        <p className="text-[10px] text-blue-400 font-medium mb-0.5">Script</p>
                        <p className="text-xs text-muted-foreground">{d.script_approach}</p>
                      </div>
                    </div>
                    <p className="text-xs text-foreground/80 italic">→ {d.verdict}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-primary/10 px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Recommendations</span>
              </div>
              <ul className="p-3 space-y-1.5">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary font-bold mt-px">›</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fidelity bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Script Fidelity to Treatment</span>
              <span className="text-xs font-bold text-foreground">{result.fidelity_score}%</span>
            </div>
            <Progress value={result.fidelity_score} className="h-2" />
          </div>
        </div>
      )}

      {/* Side-by-side text comparison */}
      {expanded && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-purple-500/10 px-3 py-1.5 border-b border-border/40">
              <span className="text-xs font-medium text-purple-400">Treatment</span>
            </div>
            <ScrollArea className="h-[400px]">
              <pre className="p-3 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {treatmentText.slice(0, 15000)}
                {treatmentText.length > 15000 && '\n\n[...truncated for display]'}
              </pre>
            </ScrollArea>
          </div>
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-blue-500/10 px-3 py-1.5 border-b border-border/40">
              <span className="text-xs font-medium text-blue-400">Script</span>
            </div>
            <ScrollArea className="h-[400px]">
              <pre className="p-3 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {scriptText.slice(0, 15000)}
                {scriptText.length > 15000 && '\n\n[...truncated for display]'}
              </pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

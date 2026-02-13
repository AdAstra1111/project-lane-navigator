/**
 * Treatment vs Script Comparison Panel
 * Side-by-side view comparing treatment (proposed adaptation direction) against the current script.
 * Includes AI-powered deep comparison analysis.
 */

import { useState } from 'react';
import { GitCompareArrows, FileText, ScrollText, ChevronDown, ChevronUp, Sparkles, Loader2, TrendingUp, TrendingDown, ArrowRight, BarChart3, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
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
  adaptation_value: { score: number; headline: string; gains: string[]; risks: string[] };
  current_script_assessment: { score: number; headline: string; strengths: string[]; vulnerabilities: string[] };
  story_impact: { structural_changes: string; character_impact: string; emotional_trajectory: string; thematic_clarity: string };
  package_impact: { lead_role_magnetism: string; director_appeal: string; sales_leverage: string; audience_targeting: string };
  commercial_delta: { score: number; market_positioning_shift: string; budget_implications: string; festival_vs_commercial: string };
  key_proposed_changes: { area: string; current_script: string; treatment_proposes: string; impact_verdict: string }[];
  rewrite_recommendations: string[];
  adoption_score: number;
}

function ScoreRing({ score, label, size = 'md', subtitle }: { score: number; label: string; size?: 'sm' | 'md'; subtitle?: string }) {
  const color = score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : score >= 25 ? 'text-orange-400' : 'text-red-400';
  const dim = size === 'sm' ? 'h-16 w-16' : 'h-20 w-20';
  const textSize = size === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${dim} rounded-full border-2 border-border/40 flex items-center justify-center bg-muted/20`}>
        <span className={`${textSize} font-bold ${color}`}>{score}</span>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
      {subtitle && <span className="text-[9px] text-muted-foreground/60">{subtitle}</span>}
    </div>
  );
}

function DeltaBadge({ score }: { score: number }) {
  const positive = score > 0;
  const neutral = score === 0;
  const color = positive ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' : neutral ? 'text-muted-foreground border-border/40 bg-muted/20' : 'text-red-400 border-red-400/30 bg-red-400/10';
  return (
    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${color}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : neutral ? null : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{score} Commercial Delta
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: string }) {
  const v = verdict.toUpperCase();
  if (v.startsWith('ADOPT')) return <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (v.startsWith('REJECT')) return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
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

      {/* ── Loading state ── */}
      {comparing && (
        <div className="border border-border/40 rounded-lg p-6 mb-4 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Evaluating treatment as adaptation direction…</p>
          <p className="text-xs text-muted-foreground/60">Analysing story impact, package effect & commercial delta</p>
        </div>
      )}

      {/* ── AI Deep Comparison Results ── */}
      {result && (
        <div className="space-y-4 mb-4">
          {/* Score rings */}
          <div className="flex items-center justify-center gap-6 py-3">
            <ScoreRing score={result.current_script_assessment.score} label="Current Script" subtitle="Story Strength" />
            <ScoreRing score={result.adaptation_value.score} label="Adaptation Value" size="sm" subtitle="Treatment Worth" />
            <ScoreRing score={result.adoption_score} label="Adopt?" subtitle="Recommendation" />
          </div>

          {/* Commercial Delta */}
          <div className="flex justify-center">
            <DeltaBadge score={result.commercial_delta.score} />
          </div>

          {/* Executive Verdict */}
          <div className="bg-muted/20 border border-border/40 rounded-lg p-4">
            <p className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-primary" /> Executive Verdict
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{result.overall_verdict}</p>
          </div>

          {/* Adaptation Value + Current Script side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Adaptation Value */}
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-purple-500/10 px-3 py-2 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ScrollText className="h-3.5 w-3.5 text-purple-400" />
                  <span className="text-xs font-semibold">Treatment Direction</span>
                </div>
                <Badge variant="outline" className="text-xs">{result.adaptation_value.score}/100</Badge>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">{result.adaptation_value.headline}</p>
                {result.adaptation_value.gains.map((g, i) => (
                  <div key={`g-${i}`} className="flex items-start gap-1.5 text-xs">
                    <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400" />
                    <span className="text-muted-foreground">{g}</span>
                  </div>
                ))}
                {result.adaptation_value.risks.map((r, i) => (
                  <div key={`r-${i}`} className="flex items-start gap-1.5 text-xs">
                    <TrendingDown className="h-3 w-3 mt-0.5 shrink-0 text-red-400" />
                    <span className="text-muted-foreground">{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Current Script */}
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-blue-500/10 px-3 py-2 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs font-semibold">Current Script</span>
                </div>
                <Badge variant="outline" className="text-xs">{result.current_script_assessment.score}/100</Badge>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">{result.current_script_assessment.headline}</p>
                {result.current_script_assessment.strengths.map((s, i) => (
                  <div key={`s-${i}`} className="flex items-start gap-1.5 text-xs">
                    <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400" />
                    <span className="text-muted-foreground">{s}</span>
                  </div>
                ))}
                {result.current_script_assessment.vulnerabilities.map((v, i) => (
                  <div key={`v-${i}`} className="flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-400" />
                    <span className="text-muted-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Story Impact */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">Story Impact — If Treatment Direction Is Adopted</span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-3">
              {Object.entries(result.story_impact).map(([key, val]) => (
                <div key={key} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Package Impact */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">Package & Commercial Impact</span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-3">
              {Object.entries(result.package_impact).map(([key, val]) => (
                <div key={key} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Commercial Delta detail */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold text-foreground">Commercial Delta Detail</span>
            </div>
            <div className="p-3 grid grid-cols-3 gap-3">
              {(['market_positioning_shift', 'budget_implications', 'festival_vs_commercial'] as const).map(key => (
                <div key={key} className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{result.commercial_delta[key]}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Key Proposed Changes */}
          {result.key_proposed_changes?.length > 0 && (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Key Proposed Changes — Adopt / Reject / Modify</span>
              </div>
              <div className="divide-y divide-border/30">
                {result.key_proposed_changes.map((c, i) => (
                  <div key={i} className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <VerdictIcon verdict={c.impact_verdict} />
                      <Badge variant="outline" className="text-[10px]">{c.area}</Badge>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                      <div>
                        <p className="text-[10px] text-blue-400 font-medium mb-0.5">Current Script</p>
                        <p className="text-xs text-muted-foreground">{c.current_script}</p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40 mt-3" />
                      <div>
                        <p className="text-[10px] text-purple-400 font-medium mb-0.5">Treatment Proposes</p>
                        <p className="text-xs text-muted-foreground">{c.treatment_proposes}</p>
                      </div>
                    </div>
                    <p className="text-xs text-foreground/80 font-medium">→ {c.impact_verdict}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rewrite Recommendations */}
          {result.rewrite_recommendations?.length > 0 && (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="bg-primary/10 px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Rewrite Recommendations</span>
              </div>
              <ul className="p-3 space-y-1.5">
                {result.rewrite_recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary font-bold mt-px">›</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Adoption Score bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Adoption Recommendation</span>
              <span className="text-xs font-bold text-foreground">{result.adoption_score}/100</span>
            </div>
            <Progress value={result.adoption_score} className="h-2" />
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

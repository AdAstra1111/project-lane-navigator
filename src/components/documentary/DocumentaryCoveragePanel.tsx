/**
 * Documentary Coverage Engine — replaces script coverage for doc projects.
 * 3-pass: Cultural Relevance → Access & Risk → Market Fit
 * Outputs: Greenlight score, Grant probability, Festival probability, Impact score
 */

import { useState } from 'react';
import { Loader2, FileSearch, BarChart3, Trophy, Landmark, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { OperationProgress } from '@/components/OperationProgress';

const DOC_COVERAGE_STAGES = [
  { at: 5, label: 'Pass 1: Cultural Relevance…' },
  { at: 30, label: 'Pass 2: Access & Risk…' },
  { at: 60, label: 'Pass 3: Market Fit…' },
  { at: 85, label: 'Scoring & saving…' },
];

interface DocCoverageResult {
  greenlight_score: number;
  grant_probability: number;
  festival_probability: number;
  impact_score: number;
  cultural_relevance: string;
  access_risk: string;
  market_fit: string;
  risk_flags: string[];
  recommendations: string[];
}

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  lane?: string;
}

function ScoreCard({ label, score, icon: Icon, color }: { label: string; score: number; icon: any; color: string }) {
  const bg = score >= 70 ? 'bg-emerald-500/10 border-emerald-500/30' :
    score >= 40 ? 'bg-amber-500/10 border-amber-500/30' :
    'bg-red-500/10 border-red-500/30';
  const textColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={`text-2xl font-mono font-bold ${textColor}`}>{score}</span>
      <span className="text-xs text-muted-foreground">/100</span>
    </div>
  );
}

export function DocumentaryCoveragePanel({ projectId, projectTitle, format, genres, lane }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DocCoverageResult | null>(null);
  const [progress, setProgress] = useState(0);

  const runCoverage = async () => {
    if (!user) return;
    setLoading(true);
    setProgress(5);

    try {
      // Fetch project documents for analysis
      const { data: docs } = await supabase
        .from('project_documents')
        .select('extracted_text, file_name, char_count')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      const combinedText = (docs || [])
        .filter((d: any) => d.extracted_text && (d.char_count || 0) > 200)
        .map((d: any) => `--- ${d.file_name} ---\n${d.extracted_text}`)
        .join('\n\n')
        .slice(0, 30000);

      if (!combinedText || combinedText.length < 500) {
        toast.error('Not enough document text for analysis. Upload and extract documents first.');
        setLoading(false);
        return;
      }

      setProgress(30);

      const { data, error } = await supabase.functions.invoke('script-coverage', {
        body: {
          projectId,
          scriptId: projectId,
          scriptText: combinedText,
          format,
          genres,
          lane,
          draftLabel: 'Documentary Coverage',
          documentaryMode: true,
        },
      });

      if (error) throw error;

      setProgress(90);

      // Parse documentary-specific scores from the coverage result
      const metrics = data?.metrics || {};
      const scoringGrid = metrics.scoring_grid || {};

      setResult({
        greenlight_score: scoringGrid.greenlight_score || scoringGrid.overall_producer_confidence ? (scoringGrid.overall_producer_confidence || 0) * 10 : 55,
        grant_probability: scoringGrid.grant_probability || scoringGrid.cultural_relevance ? (scoringGrid.cultural_relevance || 5) * 10 : 50,
        festival_probability: scoringGrid.festival_probability || scoringGrid.festival_potential ? (scoringGrid.festival_potential || 5) * 10 : 50,
        impact_score: scoringGrid.impact_score || scoringGrid.impact ? (scoringGrid.impact || 5) * 10 : 40,
        cultural_relevance: data?.pass_a || '',
        access_risk: data?.pass_b || '',
        market_fit: data?.final_coverage || '',
        risk_flags: metrics.risk_flags || [],
        recommendations: [],
      });

      setProgress(100);
      toast.success('Documentary coverage complete');
    } catch (err: any) {
      toast.error(err.message || 'Coverage analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-sm font-medium text-foreground">Documentary Coverage Engine</h5>
          <p className="text-xs text-muted-foreground">Cultural Relevance → Access & Risk → Market Fit</p>
        </div>
        <Button
          size="sm"
          onClick={runCoverage}
          disabled={loading}
          className="gap-1.5 text-xs"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSearch className="h-3 w-3" />}
          {loading ? 'Analysing…' : 'Run Documentary Coverage'}
        </Button>
      </div>

      {loading && <OperationProgress isActive={loading} stages={DOC_COVERAGE_STAGES} />}

      {result && (
        <>
          {/* Score Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreCard label="Greenlight" score={result.greenlight_score} icon={BarChart3} color="text-emerald-400" />
            <ScoreCard label="Grant Probability" score={result.grant_probability} icon={Landmark} color="text-sky-400" />
            <ScoreCard label="Festival Probability" score={result.festival_probability} icon={Trophy} color="text-amber-400" />
            <ScoreCard label="Impact Score" score={result.impact_score} icon={Globe} color="text-purple-400" />
          </div>

          {/* Risk Flags */}
          {result.risk_flags.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Risk Flags</p>
              <div className="flex flex-wrap gap-1.5">
                {result.risk_flags.map((flag, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] border-red-500/40 text-red-400 bg-red-500/10">
                    {flag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Coverage Prose */}
          {result.market_fit && (
            <div className="border border-border rounded-lg p-4 mt-4">
              <h5 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Full Coverage Report</h5>
              <div className="prose prose-sm prose-invert max-w-none">
                {result.market_fit.split('\n').map((line, i) => {
                  if (line.match(/^#{1,3}\s/)) return <h4 key={i} className="text-primary font-display font-semibold mt-3 mb-1 text-sm">{line.replace(/^#+\s*/, '')}</h4>;
                  if (line.match(/^\*\*[A-Z]/)) return <p key={i} className="text-foreground font-semibold text-sm mt-2">{line.replace(/\*\*/g, '')}</p>;
                  if (line.match(/^[-•]\s/)) return <p key={i} className="text-sm text-muted-foreground pl-4">• {line.replace(/^[-•]\s*/, '')}</p>;
                  if (!line.trim()) return <div key={i} className="h-1" />;
                  return <p key={i} className="text-sm text-muted-foreground">{line}</p>;
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

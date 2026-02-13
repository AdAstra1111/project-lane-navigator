/**
 * Documentary Coverage Engine — replaces script coverage for doc projects.
 * 10-dimension analysis with collapsible sections for clarity.
 * Persists each run and shows history via dated dropdown.
 */

import { useState, useEffect } from 'react';
import { Loader2, FileSearch, BarChart3, Trophy, Landmark, Globe, History, ChevronDown, AlertTriangle, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { OperationProgress } from '@/components/OperationProgress';
import { format } from 'date-fns';

const DOC_COVERAGE_STAGES = [
  { at: 5, label: 'Pass 1: Cultural Relevance…' },
  { at: 30, label: 'Pass 2: Access & Risk…' },
  { at: 60, label: 'Pass 3: Market Fit…' },
  { at: 85, label: 'Scoring & saving…' },
];

interface DocCoverageResult {
  id?: string;
  greenlight_score: number;
  grant_probability: number;
  festival_probability: number;
  impact_score: number;
  cultural_relevance: string;
  access_risk: string;
  market_fit: string;
  risk_flags: string[];
  recommendations: string[];
  created_at?: string;
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

/** Parse the prose into titled sections for collapsible display */
function parseSections(text: string): { title: string; content: string }[] {
  if (!text) return [];
  const lines = text.split('\n');
  const sections: { title: string; content: string }[] = [];
  let currentTitle = 'Executive Summary';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    const boldHeadingMatch = !headingMatch && line.match(/^\*\*(\d+\.\s*.+?)\*\*/);
    if (headingMatch || boldHeadingMatch) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, content: currentLines.join('\n') });
      }
      currentTitle = (headingMatch ? headingMatch[1] : boldHeadingMatch![1]).replace(/\*\*/g, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, content: currentLines.join('\n') });
  }
  return sections;
}

function ProseBlock({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return null;
        if (line.match(/^\*\*[A-Z]/)) return <p key={i} className="text-foreground font-semibold text-xs mt-1.5">{line.replace(/\*\*/g, '')}</p>;
        if (line.match(/^[-•]\s/)) return <p key={i} className="text-xs text-muted-foreground pl-3">• {line.replace(/^[-•]\s*/, '')}</p>;
        return <p key={i} className="text-xs text-muted-foreground leading-relaxed">{line}</p>;
      })}
    </div>
  );
}

function CollapsibleSection({ title, content, defaultOpen = false }: { title: string; content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <ProseBlock text={content} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DocumentaryCoveragePanel({ projectId, projectTitle, format: fmt, genres, lane }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<DocCoverageResult[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const result = runs.find(r => r.id === selectedRunId) || null;

  useEffect(() => {
    if (!user) return;
    supabase
      .from('documentary_coverage_runs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setRuns(data as DocCoverageResult[]);
          setSelectedRunId(data[0].id);
        }
      });
  }, [projectId, user]);

  const runCoverage = async () => {
    if (!user) return;
    setLoading(true);
    setProgress(5);

    try {
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
          format: fmt,
          genres,
          lane,
          draftLabel: 'Documentary Coverage',
          documentaryMode: true,
        },
      });

      if (error) throw error;

      setProgress(90);

      const metrics = data?.metrics || {};
      const scoringGrid = metrics.scoring_grid || {};

      const newResult: DocCoverageResult = {
        greenlight_score: scoringGrid.greenlight_score ? scoringGrid.greenlight_score : (scoringGrid.overall_narrative_strength ? scoringGrid.overall_narrative_strength * 10 : 55),
        grant_probability: scoringGrid.grant_probability ? scoringGrid.grant_probability : (scoringGrid.grant_impact_potential ? scoringGrid.grant_impact_potential * 10 : 50),
        festival_probability: scoringGrid.festival_probability ? scoringGrid.festival_probability : (scoringGrid.market_positioning ? scoringGrid.market_positioning * 10 : 50),
        impact_score: scoringGrid.impact_score ? scoringGrid.impact_score : (scoringGrid.grant_impact_potential ? scoringGrid.grant_impact_potential * 10 : 40),
        cultural_relevance: data?.pass_a || '',
        access_risk: data?.pass_b || '',
        market_fit: data?.final_coverage || '',
        risk_flags: metrics.risk_flags || [],
        recommendations: [],
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('documentary_coverage_runs')
        .insert({
          project_id: projectId,
          user_id: user.id,
          ...newResult,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      const savedRun = { ...newResult, id: inserted.id, created_at: inserted.created_at };
      setRuns(prev => [savedRun, ...prev]);
      setSelectedRunId(inserted.id);

      setProgress(100);
      toast.success('Documentary coverage complete & saved');
    } catch (err: any) {
      toast.error(err.message || 'Coverage analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const sections = result ? parseSections(result.market_fit) : [];
  // First section is shown open by default as the executive summary
  const executiveSummary = sections.length > 0 ? sections[0] : null;
  const detailSections = sections.slice(1);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h5 className="text-sm font-medium text-foreground">Documentary Coverage Engine</h5>
          <p className="text-xs text-muted-foreground">10-dimension reality-locked analysis</p>
        </div>
        <div className="flex items-center gap-2">
          {runs.length > 0 && (
            <Select value={selectedRunId || ''} onValueChange={setSelectedRunId}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <History className="h-3 w-3 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Select run…" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run, i) => (
                  <SelectItem key={run.id} value={run.id!} className="text-xs">
                    {run.created_at
                      ? format(new Date(run.created_at), 'dd MMM yyyy, HH:mm')
                      : `Run ${runs.length - i}`}
                    {i === 0 && <Badge className="ml-2 text-[9px] bg-primary/15 text-primary border-primary/30">Latest</Badge>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            onClick={runCoverage}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSearch className="h-3 w-3" />}
            {loading ? 'Analysing…' : 'Run Coverage'}
          </Button>
        </div>
      </div>

      {loading && <OperationProgress isActive={loading} stages={DOC_COVERAGE_STAGES} />}

      {result && (
        <>
          {/* Score Cards — always visible */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreCard label="Greenlight" score={result.greenlight_score} icon={BarChart3} color="text-emerald-400" />
            <ScoreCard label="Grant Probability" score={result.grant_probability} icon={Landmark} color="text-sky-400" />
            <ScoreCard label="Festival Probability" score={result.festival_probability} icon={Trophy} color="text-amber-400" />
            <ScoreCard label="Impact Score" score={result.impact_score} icon={Globe} color="text-purple-400" />
          </div>

          {/* Risk Flags — compact pills */}
          {result.risk_flags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              {result.risk_flags.map((flag, i) => (
                <Badge key={i} variant="outline" className="text-[10px] border-red-500/40 text-red-400 bg-red-500/10">
                  {flag}
                </Badge>
              ))}
            </div>
          )}

          {/* Executive Summary — shown by default */}
          {executiveSummary && (
            <div className="border border-border rounded-lg p-4">
              <h5 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Lightbulb className="h-3 w-3" />
                {executiveSummary.title}
              </h5>
              <ProseBlock text={executiveSummary.content} />
            </div>
          )}

          {/* Detail Sections — collapsed by default */}
          {detailSections.length > 0 && (
            <div className="border border-border rounded-lg divide-y divide-border">
              {detailSections.map((section, i) => (
                <CollapsibleSection key={i} title={section.title} content={section.content} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

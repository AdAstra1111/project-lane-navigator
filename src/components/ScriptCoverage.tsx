import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileSearch, Loader2, ThumbsUp, ThumbsDown, Minus, BookOpen, Users2, TrendingUp, Lightbulb, AlertCircle, Film, RotateCw, ChevronDown, History, ArrowLeftRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useExtractDocuments } from '@/hooks/useExtractDocuments';
import { OperationProgress, COVERAGE_STAGES, EXTRACT_STAGES } from '@/components/OperationProgress';
import { useAuth } from '@/hooks/useAuth';
import { format as fmtDate } from 'date-fns';

interface Theme {
  name: string;
  description: string;
}

interface Comparable {
  title: string;
  reason: string;
}

interface CoverageData {
  logline: string;
  synopsis: string;
  themes: Theme[];
  structural_analysis: string;
  character_analysis: string;
  comparable_titles: Comparable[];
  strengths: string[];
  weaknesses: string[];
  market_positioning: string;
  recommendation: 'CONSIDER' | 'PASS' | 'RECOMMEND';
  recommendation_reason: string;
}

interface SavedCoverage extends CoverageData {
  id: string;
  draft_label: string;
  created_at: string;
}

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  hasDocuments: boolean;
}

const REC_STYLES: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  RECOMMEND: { icon: ThumbsUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  CONSIDER: { icon: Minus, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  PASS: { icon: ThumbsDown, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
};

function CoverageDetail({ coverage }: { coverage: CoverageData }) {
  const recStyle = REC_STYLES[coverage.recommendation] || REC_STYLES.CONSIDER;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{coverage.recommendation_reason}</p>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Logline</p>
        <p className="text-foreground font-medium italic">{coverage.logline}</p>
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Synopsis</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{coverage.synopsis}</p>
      </div>

      {coverage.themes?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Themes</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coverage.themes.map((t, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20" title={t.description}>
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Structure</p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{coverage.structural_analysis}</p>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users2 className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Characters</p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{coverage.character_analysis}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Strengths</p>
          <ul className="space-y-1.5">
            {coverage.strengths?.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-emerald-400 shrink-0">✓</span>
                <span className="text-foreground">{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Weaknesses</p>
          <ul className="space-y-1.5">
            {coverage.weaknesses?.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-foreground">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {coverage.comparable_titles?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Film className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Comparable Titles</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coverage.comparable_titles.map((c, i) => (
              <span key={i} className="text-xs px-2.5 py-1.5 rounded-lg bg-muted/50 text-foreground border border-border/50" title={c.reason}>
                {c.title}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Market Positioning</p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{coverage.market_positioning}</p>
      </div>
    </div>
  );
}

function CompareDialog({ coverages }: { coverages: SavedCoverage[] }) {
  const [leftId, setLeftId] = useState(coverages[0]?.id || '');
  const [rightId, setRightId] = useState(coverages[1]?.id || '');

  const left = coverages.find(c => c.id === leftId);
  const right = coverages.find(c => c.id === rightId);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1.5">
          <ArrowLeftRight className="h-3 w-3" />
          Compare Drafts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare Script Coverages</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger><SelectValue placeholder="Select draft" /></SelectTrigger>
            <SelectContent>
              {coverages.filter(c => c.id !== rightId).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.draft_label} — {fmtDate(new Date(c.created_at), 'dd MMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger><SelectValue placeholder="Select draft" /></SelectTrigger>
            <SelectContent>
              {coverages.filter(c => c.id !== leftId).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.draft_label} — {fmtDate(new Date(c.created_at), 'dd MMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-6 mt-4">
          <div className="space-y-4">
            {left && (
              <>
                <VerdictBadge recommendation={left.recommendation} />
                <CoverageDetail coverage={left} />
              </>
            )}
          </div>
          <div className="space-y-4">
            {right && (
              <>
                <VerdictBadge recommendation={right.recommendation} />
                <CoverageDetail coverage={right} />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VerdictBadge({ recommendation }: { recommendation: string }) {
  const recStyle = REC_STYLES[recommendation] || REC_STYLES.CONSIDER;
  const RecIcon = recStyle.icon;
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs ${recStyle.bg}`}>
      <RecIcon className={`h-3.5 w-3.5 ${recStyle.color}`} />
      <span className={`font-bold ${recStyle.color}`}>{recommendation}</span>
    </div>
  );
}

export function ScriptCoverage({ projectId, projectTitle, format, genres, hasDocuments }: Props) {
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [savedCoverages, setSavedCoverages] = useState<SavedCoverage[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const extract = useExtractDocuments(projectId);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Load saved coverages on mount
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('script_coverages')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        const mapped: SavedCoverage[] = data.map((row: any) => ({
          id: row.id,
          draft_label: row.draft_label,
          created_at: row.created_at,
          logline: row.logline,
          synopsis: row.synopsis,
          themes: row.themes as Theme[],
          structural_analysis: row.structural_analysis,
          character_analysis: row.character_analysis,
          comparable_titles: row.comparable_titles as Comparable[],
          strengths: row.strengths as string[],
          weaknesses: row.weaknesses as string[],
          market_positioning: row.market_positioning,
          recommendation: row.recommendation as 'CONSIDER' | 'PASS' | 'RECOMMEND',
          recommendation_reason: row.recommendation_reason,
        }));
        setSavedCoverages(mapped);
        setSelectedId(mapped[0].id);
        setCoverage(mapped[0]);
        // Auto-suggest next draft label
        setDraftLabel(`Draft ${data.length + 1}`);
      } else {
        setDraftLabel('Draft 1');
      }
    };
    load();
  }, [projectId]);

  const handleSelectCoverage = (id: string) => {
    setSelectedId(id);
    const found = savedCoverages.find(c => c.id === id);
    if (found) setCoverage(found);
  };

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const { data: docs, error: docsError } = await supabase
        .from('project_documents')
        .select('extracted_text')
        .eq('project_id', projectId)
        .not('extracted_text', 'is', null);

      if (docsError) throw docsError;

      let scriptText = (docs || [])
        .map((d: any) => d.extracted_text)
        .filter((t: string) => t && t.length > 100)
        .join('\n\n---\n\n');

      if (!scriptText || scriptText.length < 100) {
        const { data: scripts } = await supabase
          .from('project_scripts')
          .select('file_path')
          .eq('project_id', projectId)
          .eq('status', 'current')
          .limit(1);

        if (scripts?.length && scripts[0].file_path) {
          toast.info('Extracting script text — this may take a moment…');
          await supabase.functions.invoke('extract-documents', {
            body: { projectId, documentPaths: scripts.map(s => s.file_path) },
          });

          const { data: freshDocs } = await supabase
            .from('project_documents')
            .select('extracted_text')
            .eq('project_id', projectId)
            .not('extracted_text', 'is', null);

          scriptText = (freshDocs || [])
            .map((d: any) => d.extracted_text)
            .filter((t: string) => t && t.length > 100)
            .join('\n\n---\n\n');
        }
      }

      if (!scriptText || scriptText.length < 100) {
        toast.error('No extracted text found — try uploading the script via Documents first.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('script-coverage', {
        body: { scriptText, projectTitle, format, genres },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const coverageData = data as CoverageData;
      setCoverage(coverageData);

      // Save to database
      const label = draftLabel || `Draft ${savedCoverages.length + 1}`;
      const { data: inserted, error: insertError } = await supabase
        .from('script_coverages')
        .insert({
          project_id: projectId,
          user_id: user?.id,
          draft_label: label,
          logline: coverageData.logline,
          synopsis: coverageData.synopsis,
          themes: coverageData.themes as any,
          structural_analysis: coverageData.structural_analysis,
          character_analysis: coverageData.character_analysis,
          comparable_titles: coverageData.comparable_titles as any,
          strengths: coverageData.strengths as any,
          weaknesses: coverageData.weaknesses as any,
          market_positioning: coverageData.market_positioning,
          recommendation: coverageData.recommendation,
          recommendation_reason: coverageData.recommendation_reason,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to persist coverage:', insertError);
      } else if (inserted) {
        const newSaved: SavedCoverage = {
          ...coverageData,
          id: inserted.id,
          draft_label: label,
          created_at: inserted.created_at,
        };
        setSavedCoverages(prev => [newSaved, ...prev]);
        setSelectedId(inserted.id);
        setDraftLabel(`Draft ${savedCoverages.length + 2}`);
      }

      // Persist verdict to project for readiness scoring
      await supabase
        .from('projects')
        .update({ script_coverage_verdict: coverageData.recommendation })
        .eq('id', projectId);

      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Coverage analysis complete');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate coverage');
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasDocuments) return null;

  if (!coverage) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSearch className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-display font-semibold text-foreground">Script Coverage</h3>
              <p className="text-sm text-muted-foreground">AI-generated professional coverage notes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => extract.mutate()} disabled={extract.isPending} className="text-xs gap-1.5">
              <RotateCw className={`h-3 w-3 ${extract.isPending ? 'animate-spin' : ''}`} />
              {extract.isPending ? 'Extracting…' : 'Extract Text'}
            </Button>
            <Button onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Analysing…
                </>
              ) : (
                <>
                  <FileSearch className="h-4 w-4 mr-1.5" />
                  Generate Coverage
                </>
              )}
            </Button>
          </div>
        </div>
        <OperationProgress isActive={extract.isPending} stages={EXTRACT_STAGES} />
        <OperationProgress isActive={isLoading} stages={COVERAGE_STAGES} />
      </motion.div>
    );
  }

  const recStyle = REC_STYLES[coverage.recommendation] || REC_STYLES.CONSIDER;
  const RecIcon = recStyle.icon;

  return (
    <Collapsible defaultOpen>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl p-6"
      >
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSearch className="h-5 w-5 text-primary" />
              <h3 className="font-display font-semibold text-foreground">Script Coverage</h3>
              <VerdictBadge recommendation={coverage.recommendation} />
              {savedCoverages.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {savedCoverages.find(c => c.id === selectedId)?.draft_label}
                </span>
              )}
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-5 mt-5">
          {/* Draft selector & actions */}
          {savedCoverages.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <Select value={selectedId} onValueChange={handleSelectCoverage}>
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {savedCoverages.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.draft_label} — {fmtDate(new Date(c.created_at), 'dd MMM yyyy HH:mm')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {savedCoverages.length >= 2 && (
                <CompareDialog coverages={savedCoverages} />
              )}
            </div>
          )}

          <CoverageDetail coverage={coverage} />

          {/* Regenerate */}
          <div className="pt-2 border-t border-border/50 flex items-center gap-3 flex-wrap">
            <Input
              value={draftLabel}
              onChange={e => setDraftLabel(e.target.value)}
              placeholder="Draft label…"
              className="h-8 w-40 text-xs"
            />
            <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSearch className="h-3 w-3 mr-1" />}
              {savedCoverages.length > 0 ? 'New Coverage' : 'Regenerate Coverage'}
            </Button>
            <OperationProgress isActive={isLoading} stages={COVERAGE_STAGES} />
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
}

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileSearch, Loader2, ThumbsUp, ThumbsDown, Minus, BookOpen, Users2, TrendingUp, Lightbulb, AlertCircle, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

export function ScriptCoverage({ projectId, projectTitle, format, genres, hasDocuments }: Props) {
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      // Fetch extracted text on demand
      const { data: docs, error: docsError } = await supabase
        .from('project_documents')
        .select('extracted_text')
        .eq('project_id', projectId)
        .not('extracted_text', 'is', null);

      if (docsError) throw docsError;

      const scriptText = (docs || [])
        .map((d: any) => d.extracted_text)
        .filter((t: string) => t && t.length > 100)
        .join('\n\n---\n\n');

      if (!scriptText || scriptText.length < 100) {
        toast.error('No extracted script text found. Ensure documents have been processed.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('script-coverage', {
        body: { scriptText, projectTitle, format, genres },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setCoverage(data as CoverageData);
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
      </motion.div>
    );
  }

  const recStyle = REC_STYLES[coverage.recommendation] || REC_STYLES.CONSIDER;
  const RecIcon = recStyle.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6 space-y-5"
    >
      <div className="flex items-center gap-3">
        <FileSearch className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Script Coverage</h3>
      </div>

      {/* Recommendation Badge */}
      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${recStyle.bg}`}>
        <RecIcon className={`h-5 w-5 ${recStyle.color}`} />
        <span className={`font-display font-bold ${recStyle.color}`}>{coverage.recommendation}</span>
        <span className="text-sm text-muted-foreground ml-2">{coverage.recommendation_reason}</span>
      </div>

      {/* Logline */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Logline</p>
        <p className="text-foreground font-medium italic">{coverage.logline}</p>
      </div>

      {/* Synopsis */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Synopsis</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{coverage.synopsis}</p>
      </div>

      {/* Themes */}
      {coverage.themes?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Themes</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coverage.themes.map((t, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
                title={t.description}
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Structure & Character */}
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

      {/* Strengths / Weaknesses */}
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

      {/* Comparables */}
      {coverage.comparable_titles?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Film className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Comparable Titles</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coverage.comparable_titles.map((c, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-muted/50 text-foreground border border-border/50"
                title={c.reason}
              >
                {c.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Market Positioning */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Market Positioning</p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{coverage.market_positioning}</p>
      </div>

      {/* Regenerate */}
      <div className="pt-2 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSearch className="h-3 w-3 mr-1" />}
          Regenerate Coverage
        </Button>
      </div>
    </motion.div>
  );
}

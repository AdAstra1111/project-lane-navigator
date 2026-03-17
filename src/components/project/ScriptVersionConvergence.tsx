import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Upload, Loader2, FileText, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { CanonDriftBadge } from '@/components/devengine/CanonDriftBadge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ScriptVersionConvergenceProps {
  projectId: string;
}

interface VersionMeta {
  draft_label?: string;
  verdict?: string;
  tier?: string;
  producer_confidence?: number;
  ci?: number;
  gp?: number;
  notes?: { title: string; [k: string]: any }[];
}

interface VersionRow {
  id: string;
  document_id: string;
  version_number: number;
  is_current: boolean;
  status: string;
  created_at: string;
  meta_json: VersionMeta | null;
}

interface NoteBreakdown {
  resolved: number;
  carried: number;
  new_notes: number;
}

const TIER_PROGRESS: Record<string, number> = { D: 25, C: 50, B: 75, A: 100 };
const TIER_COLORS: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  B: 'bg-primary/15 text-primary border-primary/30',
  C: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  D: 'bg-red-500/15 text-red-400 border-red-500/30',
};
const VERDICT_COLORS: Record<string, string> = {
  GREENLIGHT: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CONSIDER: 'bg-primary/15 text-primary border-primary/30',
  DEVELOP: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PASS: 'bg-red-500/15 text-red-400 border-red-500/30',
};

function computeNoteBreakdown(current: VersionMeta['notes'], previous: VersionMeta['notes']): NoteBreakdown {
  const curTitles = new Set((current || []).map(n => n.title));
  const prevTitles = new Set((previous || []).map(n => n.title));
  return {
    resolved: [...prevTitles].filter(t => !curTitles.has(t)).length,
    carried: [...prevTitles].filter(t => curTitles.has(t)).length,
    new_notes: [...curTitles].filter(t => !prevTitles.has(t)).length,
  };
}

export function ScriptVersionConvergence({ projectId }: ScriptVersionConvergenceProps) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch script-type documents
  const { data: scriptDocs } = useQuery({
    queryKey: ['script-docs', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_documents')
        .select('id, file_name, doc_type')
        .eq('project_id', projectId)
        .like('doc_type', '%script%');
      if (error) throw error;
      return (data ?? []) as { id: string; file_name: string; doc_type: string }[];
    },
  });

  const activeDocId = selectedDocId || scriptDocs?.[0]?.id;

  // Fetch versions for selected document
  const { data: versions } = useQuery({
    queryKey: ['script-versions-convergence', activeDocId],
    queryFn: async () => {
      if (!activeDocId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('id, document_id, version_number, is_current, status, created_at, meta_json')
        .eq('document_id', activeDocId)
        .order('version_number', { ascending: true });
      if (error) throw error;
      return (data ?? []) as VersionRow[];
    },
    enabled: !!activeDocId,
  });

  const latestTier = useMemo(() => {
    if (!versions?.length) return null;
    const last = versions[versions.length - 1];
    return (last.meta_json?.tier as string) || null;
  }, [versions]);

  const convergencePercent = latestTier ? (TIER_PROGRESS[latestTier.toUpperCase()] ?? 0) : 0;

  const handleFileSelect = () => {
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setIsUploading(true);
      // Placeholder — processing wired separately
    }
  };

  if (!scriptDocs?.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-4 mt-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <h4 className="font-display font-semibold text-sm text-foreground truncate">Version Convergence</h4>
        </div>
        <div className="flex items-center gap-2">
          {scriptDocs.length > 1 && (
            <Select value={activeDocId || ''} onValueChange={v => setSelectedDocId(v)}>
              <SelectTrigger className="h-7 text-xs w-[160px]">
                <SelectValue placeholder="Select script" />
              </SelectTrigger>
              <SelectContent>
                {scriptDocs.map(d => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">{d.file_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={handleFileSelect}>
            <Upload className="h-3 w-3 mr-1" /> Upload Version
          </Button>
          <input ref={fileRef} type="file" accept=".pdf,.fdx,.fountain" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* Convergence bar */}
      {latestTier && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Convergence toward Tier A</span>
            <span className="font-medium text-foreground">{convergencePercent}%</span>
          </div>
          <Progress value={convergencePercent} className="h-2" />
        </div>
      )}

      {/* Upload placeholder */}
      <AnimatePresence>
        {isUploading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-3"
          >
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            <span className="text-sm text-amber-300">Coverage analysis running…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Version History */}
      {versions && versions.length > 0 && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span>Version History ({versions.length})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 mt-2">
              {[...versions].reverse().map((v, idx) => {
                const meta = v.meta_json || {};
                const reversedIdx = versions.length - 1 - idx;
                const prev = reversedIdx > 0 ? versions[reversedIdx - 1] : null;
                const prevMeta = prev?.meta_json || {};

                const ciDelta = meta.ci != null && prevMeta.ci != null ? meta.ci - prevMeta.ci : null;
                const gpDelta = meta.gp != null && prevMeta.gp != null ? meta.gp - prevMeta.gp : null;
                const noteBreakdown = computeNoteBreakdown(meta.notes, prevMeta.notes);
                const hasNotes = noteBreakdown.resolved + noteBreakdown.carried + noteBreakdown.new_notes > 0;

                return (
                  <motion.div
                    key={v.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5",
                      v.is_current ? "border-primary/30 bg-primary/5" : "border-border/50 bg-muted/20"
                    )}
                  >
                    {/* Row 1: version + draft label + date */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">v{v.version_number}</span>
                      {meta.draft_label && (
                        <span className="text-xs text-muted-foreground">— "{meta.draft_label}"</span>
                      )}
                      {v.is_current && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">current</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {format(new Date(v.created_at), 'MMM d, yyyy')}
                      </span>
                    </div>

                    {/* Row 2: badges */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {meta.tier && (
                        <Badge className={cn("text-[10px] px-1.5 py-0 border", TIER_COLORS[meta.tier.toUpperCase()] || '')}>
                          Tier {meta.tier.toUpperCase()}
                        </Badge>
                      )}
                      {meta.verdict && (
                        <Badge className={cn("text-[10px] px-1.5 py-0 border", VERDICT_COLORS[meta.verdict.toUpperCase()] || 'bg-muted text-muted-foreground')}>
                          {meta.verdict.toUpperCase()}
                        </Badge>
                      )}
                      {meta.producer_confidence != null && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Conf: {meta.producer_confidence}%
                        </Badge>
                      )}

                      {/* Score deltas */}
                      {ciDelta !== null && (
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-0.5", ciDelta > 0 ? 'text-emerald-400' : ciDelta < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                          CI {ciDelta > 0 ? '+' : ''}{ciDelta}
                          {ciDelta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : ciDelta < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                        </Badge>
                      )}
                      {gpDelta !== null && (
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-0.5", gpDelta > 0 ? 'text-emerald-400' : gpDelta < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                          GP {gpDelta > 0 ? '+' : ''}{gpDelta}
                          {gpDelta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : gpDelta < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                        </Badge>
                      )}

                      {/* Note breakdown */}
                      {hasNotes && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          Notes:
                          {noteBreakdown.new_notes > 0 && <span className="text-amber-400 ml-1">{noteBreakdown.new_notes} new</span>}
                          {noteBreakdown.carried > 0 && <span className="text-muted-foreground ml-1">{noteBreakdown.carried} carried</span>}
                          {noteBreakdown.resolved > 0 && <span className="text-emerald-400 ml-1">{noteBreakdown.resolved} resolved</span>}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {(!versions || versions.length === 0) && (
        <p className="text-xs text-muted-foreground text-center py-3">No versions found for this document.</p>
      )}
    </motion.div>
  );
}

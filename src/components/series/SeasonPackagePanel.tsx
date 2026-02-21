/**
 * SeasonPackagePanel — Generates and manages the Complete Season Script deliverable.
 *
 * Part of the Project Package system. Assembles an Approved Pack from all
 * project documents, then either:
 *  - Compiles existing episode scripts (Path A: scripts exist)
 *  - Generates episode scripts from beats/grid/arc via LLM (Path B: no scripts)
 *
 * Records provenance, change log, and stores the result as `complete_season_script`.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronRight,
  FileText, Loader2, RotateCcw, Sparkles, XCircle, Package,
  Clock, Layers2, ArrowRight, Info,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { DocumentExportDropdown } from '@/components/DocumentExportDropdown';

// ─── Doc types that make up the Approved Pack ──────────────────────────────
const PACK_DOC_TYPES = [
  { key: 'topline_narrative', label: 'Topline Narrative', required: false },
  { key: 'concept_brief', label: 'Concept Brief', required: false },
  { key: 'vertical_market_sheet', label: 'Market Sheet (VD)', required: false },
  { key: 'format_rules', label: 'Format Rules', required: true },
  { key: 'character_bible', label: 'Character Bible', required: true },
  { key: 'season_arc', label: 'Season Arc', required: true },
  { key: 'episode_grid', label: 'Episode Grid', required: true },
  { key: 'vertical_episode_beats', label: 'Episode Beats', required: false },
] as const;

// ─── Types ──────────────────────────────────────────────────────────────────
interface PackageSource {
  episode_number: number;
  episode_id: string;
  script_id: string | null;
  version_id: string | null;
  source_type: 'approved' | 'latest' | 'latest_fallback' | 'generated_from_beats';
  title: string;
}

interface ChangeLogEntry {
  episode: string;
  change: string;
}

interface PackageResult {
  doc_id: string;
  version_id: string;
  version_number: number;
  path_used: 'compile' | 'generate_from_beats';
  episode_count: number;
  sources: PackageSource[];
  skipped: Array<{ episode_number: number; reason: string }>;
  change_log: ChangeLogEntry[];
  compiled_at: string;
  approved_pack_doc_types: string[];
  script_coverage_pct: number;
}

interface Props {
  projectId: string;
  episodeCount: number;
  completedEpisodeCount: number;
  onOpenDoc: (versionId: string, title: string) => void;
}

// ─── Source type badge config ────────────────────────────────────────────────
const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  approved: { label: 'approved', color: 'text-emerald-400' },
  latest: { label: 'latest draft', color: 'text-blue-400' },
  latest_fallback: { label: 'latest (no approval)', color: 'text-amber-400' },
  generated_from_beats: { label: 'AI-generated', color: 'text-violet-400' },
};

// ─── Component ──────────────────────────────────────────────────────────────
export function SeasonPackagePanel({ projectId, episodeCount, completedEpisodeCount, onOpenDoc }: Props) {
  const [useApproved, setUseApproved] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<PackageResult | null>(null);
  const [masterText, setMasterText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch existing complete_season_script doc (if any) ──────────────────
  const { data: existingDoc, refetch: refetchExisting } = useQuery({
    queryKey: ['complete-season-script', projectId],
    queryFn: async () => {
      const { data: doc } = await supabase
        .from('project_documents')
        .select('id, title, latest_version_id, updated_at')
        .eq('project_id', projectId)
        .eq('doc_type', 'complete_season_script')
        .maybeSingle();
      if (!doc?.latest_version_id) return null;

      // Use explicit cast to bypass strict typing for metadata column
      const { data: ver } = await (supabase as any)
        .from('project_document_versions')
        .select('id, version_number, plaintext, metadata, created_at')
        .eq('id', doc.latest_version_id)
        .single();

      return { doc, ver: ver as { id: string; version_number: number; plaintext: string; metadata: any; created_at: string } | null };
    },
    enabled: !!projectId,
  });

  // ── Fetch approved pack status ───────────────────────────────────────────
  const { data: packStatus = [] } = useQuery({
    queryKey: ['approved-pack-status', projectId],
    queryFn: async () => {
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', PACK_DOC_TYPES.map((d) => d.key));

      const results: Array<{ key: string; label: string; required: boolean; exists: boolean; approved: boolean }> = [];
      for (const packDoc of PACK_DOC_TYPES) {
        const found = docs?.find((d) => d.doc_type === packDoc.key);
        let approved = false;
        if (found) {
          const { data: ver } = await supabase
            .from('project_document_versions')
            .select('status')
            .eq('document_id', found.id)
            .eq('status', 'final')
            .limit(1)
            .maybeSingle();
          approved = !!ver;
        }
        results.push({ ...packDoc, exists: !!found, approved });
      }
      return results;
    },
    enabled: !!projectId,
  });

  const requiredMissing = packStatus.filter((d) => d.required && !d.exists);
  const approvedCount = packStatus.filter((d) => d.approved).length;
  const existingCount = packStatus.filter((d) => d.exists).length;
  const isSeasonComplete = completedEpisodeCount === episodeCount && episodeCount > 0;

  const prevMeta = existingDoc?.ver ? (existingDoc.ver.metadata as any) : null;
  const prevChanges: ChangeLogEntry[] = prevMeta?.change_log || [];

  // ── Generate / Recompile ─────────────────────────────────────────────────
  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/season-package`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ project_id: projectId, use_approved: useApproved }),
        }
      );

      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Package generation failed');

      setLastResult(data as PackageResult);
      toast.success(`Season script v${data.version_number} compiled — ${data.episode_count} episodes`);

      // Pre-fetch the master text for immediate open
      const { data: ver } = await supabase
        .from('project_document_versions')
        .select('plaintext')
        .eq('id', data.version_id)
        .single();
      setMasterText((ver?.plaintext as string) || null);

      refetchExisting();
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      toast.error(e.message || 'Failed to generate project package');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenDoc = () => {
    const versionId = lastResult?.version_id || existingDoc?.ver?.id;
    const text = masterText || (existingDoc?.ver?.plaintext as string) || '';
    if (!versionId) return;
    onOpenDoc(versionId, 'Complete Season 1 Script');
  };

  const result = lastResult || (existingDoc?.ver ? {
    version_number: existingDoc.ver.version_number as number,
    path_used: prevMeta?.path_used,
    episode_count: prevMeta?.episode_count,
    sources: prevMeta?.sources_used || [],
    skipped: prevMeta?.skipped || [],
    compiled_at: existingDoc.ver.created_at as string,
    approved_pack_doc_types: Object.keys(prevMeta?.approved_pack_versions || {}),
    script_coverage_pct: prevMeta?.script_coverage_pct,
    change_log: prevMeta?.change_log || [],
  } as Partial<PackageResult> : null);

  return (
    <TooltipProvider>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Complete Season Script
              <Badge variant="outline" className="text-[9px]">Season 1</Badge>
            </CardTitle>

            <div className="flex items-center gap-2">
              {result && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleOpenDoc}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Open Script
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleGenerate}
                disabled={isGenerating || requiredMissing.length > 0}
              >
                {isGenerating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : result ? <RotateCcw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isGenerating ? 'Compiling…' : result ? 'Recompile' : 'Compile Season Script'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Season progress + source mode */}
          <div className="flex flex-wrap gap-3">
            {/* Completeness */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs flex-1 min-w-48 ${
              isSeasonComplete
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              {isSeasonComplete
                ? <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--chart-2))] shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--chart-4))] shrink-0" />}
              <div>
                <p className={`font-medium ${isSeasonComplete ? 'text-[hsl(var(--chart-2))]' : 'text-[hsl(var(--chart-4))]'}`}>
                  {isSeasonComplete
                    ? `All ${episodeCount} episodes drafted`
                    : `${completedEpisodeCount} / ${episodeCount} episodes drafted`}
                </p>
                {!isSeasonComplete && (
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    Missing episodes will be generated from beats
                  </p>
                )}
              </div>
            </div>

            {/* Source option */}
            <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/40 cursor-pointer hover:border-border/70 transition-colors flex-1 min-w-48">
              <Checkbox
                checked={useApproved}
                onCheckedChange={(c) => setUseApproved(!!c)}
              />
              <div>
                <p className="text-xs font-medium text-foreground">Use approved versions only</p>
                <p className="text-[10px] text-muted-foreground">Falls back to latest if no approval</p>
              </div>
            </label>
          </div>

          {/* Approved Pack Status */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Approved Pack
              </h4>
              <span className="text-[10px] text-muted-foreground">
                {approvedCount} approved · {existingCount} available
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {packStatus.map((doc) => (
                <Tooltip key={doc.key}>
                  <TooltipTrigger asChild>
                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-[10px] ${
                      doc.approved
                        ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                        : doc.exists
                        ? 'border-blue-500/20 bg-blue-500/5 text-blue-400'
                        : doc.required
                        ? 'border-destructive/30 bg-destructive/5 text-destructive'
                        : 'border-border/30 text-muted-foreground'
                    }`}>
                      {doc.approved ? (
                        <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                      ) : doc.exists ? (
                        <FileText className="h-2.5 w-2.5 shrink-0" />
                      ) : (
                        <XCircle className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className="truncate">{doc.label}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px]">
                    {doc.approved ? 'Final/approved version available' : doc.exists ? 'Draft available (not approved)' : doc.required ? 'MISSING — required' : 'Not yet created'}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {requiredMissing.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
                <XCircle className="h-3 w-3 shrink-0" />
                Required docs missing: {requiredMissing.map((d) => d.label).join(', ')}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Result panel */}
          {result && (
            <>
              <Separator />

              <div className="space-y-3">
                {/* Result header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--chart-2))] shrink-0" />
                    <span className="text-xs font-semibold text-[hsl(var(--chart-2))]">
                      v{result.version_number} · {result.episode_count} episodes
                    </span>
                    <Badge variant="outline" className="text-[9px] border-border/30 text-muted-foreground">
                      {result.path_used === 'generate_from_beats' ? 'AI-generated' : 'compiled from scripts'}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {result.compiled_at ? new Date(result.compiled_at).toLocaleString() : ''}
                  </span>
                </div>

                {/* Skipped episodes */}
                {result.skipped && result.skipped.length > 0 && (
                  <div className="text-[11px] space-y-0.5 p-2.5 rounded-lg border bg-muted/30 border-border/50">
                    <p className="font-semibold text-[hsl(var(--chart-4))] flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Placeholders inserted
                    </p>
                    {result.skipped.map((s) => (
                      <p key={s.episode_number} className="pl-3 text-muted-foreground">
                        • EP{String(s.episode_number).padStart(2, '0')} — {
                          s.reason === 'no_content' ? 'no script or beats available' :
                          s.reason === 'generation_failed' ? 'generation failed' :
                          s.reason === 'placeholder_brackets_detected' ? 'placeholder text detected' :
                          s.reason
                        }
                      </p>
                    ))}
                  </div>
                )}

                {/* Change log */}
                {result.change_log && result.change_log.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Change Log</p>
                    <div className="max-h-24 overflow-y-auto space-y-0.5 pr-1">
                      {result.change_log.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className="font-mono text-muted-foreground shrink-0">{c.episode}</span>
                          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                          <span className="text-foreground/80">{c.change}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources used */}
                {result.sources && result.sources.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Sources ({result.sources.length} episodes)
                    </p>
                    <div className="max-h-28 overflow-y-auto space-y-0.5 pr-1">
                      {result.sources.map((s) => {
                        const cfg = SOURCE_LABELS[s.source_type] || { label: s.source_type, color: 'text-muted-foreground' };
                        return (
                          <div key={s.episode_id} className="flex items-center gap-2 text-[10px]">
                            <span className="font-mono text-muted-foreground shrink-0">
                              EP{String(s.episode_number).padStart(2, '0')}
                            </span>
                            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                            <span className={`${cfg.color} shrink-0`}>{cfg.label}</span>
                            {s.version_id && (
                              <span className="font-mono text-muted-foreground/50 text-[9px]">
                                ·{s.version_id.slice(0, 6)}
                              </span>
                            )}
                            <span className="text-muted-foreground/60 truncate">
                              {s.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Open + export actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    className="flex-1 h-8 text-xs gap-1.5"
                    onClick={handleOpenDoc}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Open Complete Season Script
                  </Button>
                </div>

                {/* Provenance notice */}
                <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>
                    Recompile after revising episode scripts or approved docs to generate a new version. All versions are preserved.
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

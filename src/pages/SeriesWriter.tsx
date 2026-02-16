/**
 * Series Writer — Dedicated full-page workspace for sequential episode generation.
 * Shows working set sidebar, episode list with lock-to-progress, and writing canvas.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, Layers, Lock, Unlock, Play, CheckCircle2, Circle, Loader2,
  AlertTriangle, BookOpen, Zap, RotateCcw, FileText, Shield, ChevronRight,
  ExternalLink, XCircle, Sparkles, Eye, EyeOff,
} from 'lucide-react';
import { useSeriesWriter, type SeriesEpisode } from '@/hooks/useSeriesWriter';
import { SeasonHealthDashboard } from '@/components/series/SeasonHealthDashboard';

// ── Working Set doc types for vertical drama ──
const WORKING_SET_DOC_TYPES = [
  'format_rules',
  'character_bible',
  'season_arc',
  'episode_grid',
] as const;

const OPTIONAL_WORKING_SET = ['vertical_market_sheet', 'pitch_document'] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  format_rules: 'Format Rules',
  character_bible: 'Character Bible',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  vertical_market_sheet: 'Market Sheet (VD)',
  pitch_document: 'Pitch Document',
  blueprint: 'Blueprint',
  script: 'Script',
};

const EPISODE_STATUS_CONFIG: Record<string, { icon: typeof Circle; color: string; label: string; bg: string }> = {
  pending:    { icon: Circle,        color: 'text-muted-foreground', label: 'Not Started', bg: 'bg-muted/20' },
  generating: { icon: Loader2,       color: 'text-amber-400',       label: 'Drafting',    bg: 'bg-amber-500/10' },
  complete:   { icon: CheckCircle2,  color: 'text-emerald-400',     label: 'Draft Complete', bg: 'bg-emerald-500/10' },
  locked:     { icon: Lock,          color: 'text-primary',         label: 'Locked',      bg: 'bg-primary/10' },
  template:   { icon: Shield,        color: 'text-violet-400',      label: 'Template',    bg: 'bg-violet-500/10' },
  needs_revision: { icon: AlertTriangle, color: 'text-orange-400',  label: 'Needs Revision', bg: 'bg-orange-500/10' },
  error:      { icon: AlertTriangle, color: 'text-red-400',         label: 'Error',       bg: 'bg-red-500/10' },
  invalidated: { icon: XCircle,      color: 'text-red-400',         label: 'Stale',       bg: 'bg-red-500/10' },
};

// ── Types for working set ──
interface WorkingSetDoc {
  id: string;
  doc_type: string;
  title: string;
  latest_version_id: string | null;
  is_stale: boolean;
  updated_at: string;
}

export default function SeriesWriter() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<SeriesEpisode | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerContent, setReaderContent] = useState('');
  const [readerLoading, setReaderLoading] = useState(false);
  const [lockConfirmEp, setLockConfirmEp] = useState<SeriesEpisode | null>(null);
  const [templatePromptEp, setTemplatePromptEp] = useState<SeriesEpisode | null>(null);
  const [autoRunConfirmOpen, setAutoRunConfirmOpen] = useState(false);

  const {
    episodes, isLoading, canonSnapshot, canonLoading,
    validations, episodeMetrics, metricsRunning, metricsRunningEp,
    progress, isGenerating, completedCount,
    isSeasonComplete, nextEpisode, hasFailedValidation, hasMetricsBlock, isCanonValid,
    createCanonSnapshot, createEpisodes, generateOne, generateAll,
    fetchScriptContent, runEpisodeMetrics,
  } = useSeriesWriter(projectId!);

  // ── Project metadata ──
  const { data: project } = useQuery({
    queryKey: ['sw-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('title, format, season_episode_count, episode_target_duration_seconds')
        .eq('id', projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  // ── Resolver hash ──
  const { data: resolverData } = useQuery({
    queryKey: ['sw-resolver', projectId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-qualifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId }),
      });
      if (!resp.ok) throw new Error('Failed to resolve qualifications');
      return resp.json();
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const resolverHash = resolverData?.resolver_hash || '';
  const seasonEpisodeCount = resolverData?.resolved?.season_episode_count || project?.season_episode_count || 0;
  const episodeDuration = resolverData?.resolved?.episode_target_duration_seconds || project?.episode_target_duration_seconds || 60;

  // ── Working set docs ──
  const { data: workingSetDocs = [] } = useQuery({
    queryKey: ['sw-working-set', projectId, resolverHash],
    queryFn: async () => {
      const allTypes = [...WORKING_SET_DOC_TYPES, ...OPTIONAL_WORKING_SET];
      const { data: docs, error } = await supabase
        .from('project_documents')
        .select('id, doc_type, title, created_at')
        .eq('project_id', projectId!)
        .in('doc_type', allTypes);
      if (error) throw error;
      if (!docs?.length) return [];

      // Get latest version for each doc
      const results: WorkingSetDoc[] = [];
      for (const doc of docs) {
        const { data: ver } = await supabase
          .from('project_document_versions')
          .select('id, depends_on_resolver_hash')
          .eq('document_id', doc.id)
          .order('version_number', { ascending: false })
          .limit(1)
          .single();
        
        results.push({
          id: doc.id,
          doc_type: doc.doc_type,
          title: doc.title || DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type,
          latest_version_id: ver?.id || null,
          is_stale: !!(ver?.depends_on_resolver_hash && resolverHash && ver.depends_on_resolver_hash !== resolverHash),
          updated_at: doc.created_at,
        });
      }
      return results;
    },
    enabled: !!projectId,
  });

  const requiredDocs = workingSetDocs.filter(d => (WORKING_SET_DOC_TYPES as readonly string[]).includes(d.doc_type));
  const optionalDocs = workingSetDocs.filter(d => (OPTIONAL_WORKING_SET as readonly string[]).includes(d.doc_type));
  const staleDocs = workingSetDocs.filter(d => d.is_stale);
  const missingRequired = WORKING_SET_DOC_TYPES.filter(
    t => !workingSetDocs.some(d => d.doc_type === t)
  );

  // ── Session management ──
  const { data: session } = useQuery({
    queryKey: ['sw-session', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('series_writer_sessions')
        .select('*')
        .eq('project_id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  // ── Lock episode ──
  const lockEpisode = useMutation({
    mutationFn: async (episode: SeriesEpisode) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Mark as locked
      await supabase.from('series_episodes').update({
        status: 'complete',
        locked_at: new Date().toISOString(),
        resolver_hash_used: resolverHash,
      }).eq('id', episode.id);

      // Create final snapshot version if script exists
      if (episode.script_id) {
        const { data: script } = await supabase
          .from('scripts')
          .select('text_content')
          .eq('id', episode.script_id)
          .single() as { data: { text_content: string } | null; error: any };

        if (script?.text_content) {
          // Export to package folder
          const epNum = String(episode.episode_number).padStart(2, '0');
          const filePath = `${projectId}/package/episodes/EP${epNum}_LATEST.md`;
          const blob = new Blob([script.text_content], { type: 'text/markdown' });
          const file = new File([blob], `EP${epNum}_LATEST.md`, { type: 'text/markdown' });

          await supabase.storage
            .from('projects')
            .upload(filePath, file, { upsert: true });

          // Generate continuity notes
          await supabase.from('episode_continuity_notes').upsert({
            project_id: projectId!,
            episode_number: episode.episode_number,
            user_id: user.id,
            summary: {
              title: episode.title,
              logline: episode.logline,
              locked_at: new Date().toISOString(),
              script_length: script.text_content.length,
              // Basic extraction — future: AI-powered continuity
              ends_with: script.text_content.slice(-500),
            },
          }, { onConflict: 'project_id,episode_number' });
        }
      }
    },
    onSuccess: (_, ep) => {
      toast.success(`Episode ${ep.episode_number} locked`);
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      qc.invalidateQueries({ queryKey: ['episode-continuity', projectId] });

      // If this is EP1 and no template exists, prompt
      if (ep.episode_number === 1) {
        const hasTemplate = episodes.some(e => e.is_season_template);
        if (!hasTemplate) {
          setTemplatePromptEp(ep);
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Set as season template ──
  const setAsTemplate = useMutation({
    mutationFn: async (episode: SeriesEpisode) => {
      // Clear existing templates
      await supabase.from('series_episodes')
        .update({ is_season_template: false })
        .eq('project_id', projectId!);

      // Set this episode as template
      await supabase.from('series_episodes')
        .update({ is_season_template: true })
        .eq('id', episode.id);
    },
    onSuccess: (_, ep) => {
      toast.success(`Episode ${ep.episode_number} set as Season Template`);
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Read script ──
  const openReader = useCallback(async (episode: SeriesEpisode) => {
    if (!episode.script_id) return;
    setSelectedEpisode(episode);
    setReaderOpen(true);
    setReaderLoading(true);
    try {
      const content = await fetchScriptContent(episode.script_id);
      setReaderContent(content);
    } catch {
      setReaderContent('Failed to load script.');
    }
    setReaderLoading(false);
  }, [fetchScriptContent]);

  // ── Determine episode write-enabled state ──
  const getEpisodeState = useCallback((ep: SeriesEpisode, idx: number) => {
    const isLocked = !!ep.locked_at;
    const isTemplate = ep.is_season_template;
    const prevLocked = idx === 0 || !!episodes[idx - 1]?.locked_at;
    const canWrite = !isLocked && prevLocked && isCanonValid && !isGenerating;
    const canLock = !isLocked && (ep.status === 'complete' || ep.status === 'needs_revision') && !!ep.script_id;

    let displayStatus = ep.status;
    if (isTemplate) displayStatus = 'template';
    else if (isLocked) displayStatus = 'locked';

    return { isLocked, isTemplate, prevLocked, canWrite, canLock, displayStatus };
  }, [episodes, isCanonValid, isGenerating]);

  if (!projectId) return null;

  const anyLoading = isLoading || canonLoading;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <PageTransition>
        {/* Top Bar */}
        <div className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="max-w-[1800px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => navigate(`/projects/${projectId}/development`)}
            >
              <ArrowLeft className="h-3 w-3" /> Dev Engine
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Layers className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">{project?.title || 'Project'}</span>
              <Badge variant="outline" className="text-[9px] shrink-0">Vertical Drama</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
              <span className="font-mono">{seasonEpisodeCount} eps</span>
              <span>•</span>
              <span className="font-mono">{episodeDuration}s each</span>
              {resolverHash && (
                <>
                  <span>•</span>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {resolverHash.slice(0, 8)}
                  </Badge>
                </>
              )}
              {staleDocs.length > 0 && (
                <Badge variant="destructive" className="text-[9px]">
                  {staleDocs.length} stale
                </Badge>
              )}
            </div>
          </div>
        </div>

        {anyLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-w-[1800px] mx-auto px-4 py-4 flex gap-4 flex-1">
            {/* ── Left Sidebar: Working Set ── */}
            <div className="w-64 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Working Set</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  onClick={() => setShowAllDocs(!showAllDocs)}
                >
                  {showAllDocs ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showAllDocs ? 'Hide' : 'All Docs'}
                </Button>
              </div>

              {/* Stale banner */}
              {staleDocs.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                    <AlertTriangle className="h-3 w-3" />
                    {staleDocs.length} source{staleDocs.length > 1 ? 's' : ''} stale
                  </div>
                  <p className="text-[10px] text-amber-400/70">
                    Canonical qualifications changed. Regenerate before writing.
                  </p>
                </div>
              )}

              {/* Missing required */}
              {missingRequired.length > 0 && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
                  <span className="text-xs text-red-400 font-medium">Missing Required</span>
                  {missingRequired.map(t => (
                    <div key={t} className="text-[10px] text-red-400/70 flex items-center gap-1">
                      <XCircle className="h-2.5 w-2.5" /> {DOC_TYPE_LABELS[t] || t}
                    </div>
                  ))}
                </div>
              )}

              {/* Required docs */}
              <div className="space-y-1">
                {requiredDocs.map(doc => (
                  <Link
                    key={doc.id}
                    to={`/projects/${projectId}/development?doc=${doc.id}`}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{doc.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.is_stale ? (
                        <Badge variant="destructive" className="text-[8px] px-1 py-0">STALE</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-emerald-500/30 text-emerald-400">LATEST</Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>

              {/* Optional docs */}
              {optionalDocs.length > 0 && (
                <>
                  <Separator />
                  <span className="text-[10px] text-muted-foreground uppercase">Optional</span>
                  <div className="space-y-1">
                    {optionalDocs.map(doc => (
                      <Link
                        key={doc.id}
                        to={`/projects/${projectId}/development?doc=${doc.id}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                      >
                        <FileText className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                        <span className="text-[11px] text-muted-foreground truncate">{doc.title}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}

              {showAllDocs && (
                <>
                  <Separator />
                  <Link
                    to={`/projects/${projectId}/development`}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Open full Dev Engine
                  </Link>
                </>
              )}

              {/* Canon status */}
              <Separator />
              <div className={`p-2.5 rounded-lg border ${isCanonValid
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/20 bg-amber-500/5'
              }`}>
                <div className="flex items-center gap-1.5">
                  {isCanonValid ? (
                    <Lock className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  <span className={`text-xs font-medium ${isCanonValid ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {isCanonValid ? 'Canon Locked' : canonSnapshot ? 'Canon Invalid' : 'Canon Not Locked'}
                  </span>
                </div>
                {canonSnapshot && (
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    {canonSnapshot.season_episode_count} episodes locked
                  </span>
                )}
                {!isCanonValid && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 mt-2 w-full"
                    onClick={() => createCanonSnapshot.mutate()}
                    disabled={createCanonSnapshot.isPending || isGenerating}
                  >
                    {createCanonSnapshot.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                    {canonSnapshot ? 'Re-lock Canon' : 'Lock Canon'}
                  </Button>
                )}
              </div>
            </div>

            {/* ── Main Content: Episode List + Canvas ── */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* Season Progress */}
              {episodes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">Episodes</h2>
                      <span className="text-xs text-muted-foreground font-mono">
                        {episodes.filter(e => !!e.locked_at).length} locked / {completedCount} drafted / {episodes.length} total
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {nextEpisode && !hasFailedValidation && isCanonValid && !isGenerating && (
                        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => generateOne(nextEpisode)}>
                          <Play className="h-3 w-3" /> Generate EP {nextEpisode.episode_number}
                        </Button>
                      )}
                      {!isGenerating && episodes.filter(e => e.status === 'pending').length > 1 && !hasFailedValidation && isCanonValid && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                          onClick={() => setAutoRunConfirmOpen(true)}>
                          <Zap className="h-3 w-3" /> AutoRun Season
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="flex gap-0.5">
                    {episodes.map(ep => {
                      const state = getEpisodeState(ep, episodes.indexOf(ep));
                      return (
                        <div
                          key={ep.id}
                          className={`h-2 flex-1 rounded-sm transition-colors cursor-pointer ${
                            state.isTemplate ? 'bg-violet-500' :
                            state.isLocked ? 'bg-primary' :
                            ep.status === 'complete' ? 'bg-emerald-500' :
                            ep.status === 'needs_revision' ? 'bg-orange-500' :
                            ep.status === 'generating' ? 'bg-amber-500 animate-pulse' :
                            ep.status === 'error' || ep.status === 'invalidated' ? 'bg-red-500' :
                            'bg-muted/30'
                          }`}
                          title={`EP ${ep.episode_number}: ${state.displayStatus}`}
                          onClick={() => setSelectedEpisode(ep)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Generation Progress */}
              {isGenerating && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-foreground font-medium flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                      Generating Episode {progress.currentEpisode} of {progress.totalEpisodes}
                    </span>
                    <span className="text-muted-foreground">{progress.phase}</span>
                  </div>
                  <Progress value={progress.totalEpisodes > 0 ? (progress.currentEpisode / progress.totalEpisodes) * 100 : 0} className="h-1.5" />
                </div>
              )}

              {/* Season complete */}
              {isSeasonComplete && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">
                    Season Complete — All {episodes.length} episodes generated
                  </span>
                </div>
              )}

              {/* Create episodes if canon locked but no episodes */}
              {isCanonValid && episodes.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-center space-y-3">
                    <p className="text-sm text-foreground font-medium">Ready to begin</p>
                    <p className="text-xs text-muted-foreground">
                      Canon locked with {canonSnapshot?.season_episode_count || seasonEpisodeCount} episodes. Create slots to start writing.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => createEpisodes.mutate(canonSnapshot?.season_episode_count || seasonEpisodeCount)}
                      disabled={createEpisodes.isPending}
                    >
                      {createEpisodes.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                      Create {canonSnapshot?.season_episode_count || seasonEpisodeCount} Episode Slots
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Episode List */}
              {episodes.length > 0 && (
                <ScrollArea className="max-h-[calc(100vh-280px)]">
                  <div className="space-y-1">
                    {episodes.map((ep, idx) => {
                      const state = getEpisodeState(ep, idx);
                      const cfg = EPISODE_STATUS_CONFIG[state.displayStatus] || EPISODE_STATUS_CONFIG.pending;
                      const Icon = cfg.icon;

                      return (
                        <div
                          key={ep.id}
                          className={`border rounded-lg transition-colors ${
                            selectedEpisode?.id === ep.id ? 'border-primary/50 bg-primary/5' : 'border-border/40 hover:border-border/70'
                          } ${cfg.bg}`}
                        >
                          <div className="flex items-center gap-3 px-3 py-2">
                            <Icon className={`h-4 w-4 shrink-0 ${cfg.color} ${ep.status === 'generating' ? 'animate-spin' : ''}`} />

                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedEpisode(ep)}>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-muted-foreground">
                                  EP {String(ep.episode_number).padStart(2, '0')}
                                </span>
                                <span className="text-sm font-medium text-foreground truncate">
                                  {ep.title || `Episode ${ep.episode_number}`}
                                </span>
                                {state.isTemplate && (
                                  <Badge className="text-[8px] bg-violet-500/20 text-violet-400 border-violet-500/30">
                                    Template
                                  </Badge>
                                )}
                              </div>
                              {ep.logline && (
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ep.logline}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Read */}
                              {ep.script_id && (ep.status === 'complete' || state.isLocked) && (
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => openReader(ep)}>
                                  <BookOpen className="h-3 w-3" /> Read
                                </Button>
                              )}

                              {/* Generate */}
                              {state.canWrite && (ep.status === 'pending' || ep.status === 'invalidated') && (
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1"
                                  onClick={() => generateOne(ep)} disabled={isGenerating}>
                                  <Play className="h-3 w-3" /> Generate
                                </Button>
                              )}

                              {/* Retry / Revise */}
                              {state.canWrite && (ep.status === 'error' || ep.status === 'needs_revision') && (
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1 border-orange-500/30 text-orange-400"
                                  onClick={() => generateOne(ep)} disabled={isGenerating}>
                                  <RotateCcw className="h-3 w-3" /> {ep.status === 'needs_revision' ? 'Revise' : 'Retry'}
                                </Button>
                              )}

                              {/* Lock */}
                              {state.canLock && (
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1 border-primary/30 text-primary"
                                  onClick={() => setLockConfirmEp(ep)} disabled={lockEpisode.isPending}>
                                  <Lock className="h-3 w-3" /> Lock
                                </Button>
                              )}

                              {/* Set as template (only for locked eps without template set) */}
                              {state.isLocked && !state.isTemplate && !episodes.some(e => e.is_season_template) && (
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-violet-400"
                                  onClick={() => setAsTemplate.mutate(ep)}>
                                  <Shield className="h-3 w-3" /> Template
                                </Button>
                              )}

                              <Badge variant="outline" className={`text-[9px] ${
                                state.isLocked ? 'border-primary/30 text-primary' :
                                cfg.color.replace('text-', 'border-').replace('400', '500/30') + ' ' + cfg.color
                              }`}>
                                {cfg.label}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}

              {/* Season Health */}
              {episodes.length > 0 && episodeMetrics.length > 0 && (
                <SeasonHealthDashboard
                  metrics={episodeMetrics}
                  seasonEpisodeCount={canonSnapshot?.season_episode_count || episodes.length}
                  onRunMetrics={(ep) => runEpisodeMetrics(ep)}
                  onAutoFix={(ep) => toast.info(`Auto-fix for EP ${ep} coming soon`)}
                  isRunning={metricsRunning}
                  runningEpisode={metricsRunningEp}
                />
              )}
            </div>
          </div>
        )}
      </PageTransition>

      {/* Lock Confirmation Dialog */}
      <AlertDialog open={!!lockConfirmEp} onOpenChange={open => !open && setLockConfirmEp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock Episode {lockConfirmEp?.episode_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Locking creates a final snapshot and exports the script to the package folder.
              Once locked, this episode becomes the reference for the next episode's continuity.
              {lockConfirmEp?.episode_number === 1 && " You'll be prompted to set it as the Season Template."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { lockEpisode.mutate(lockConfirmEp!); setLockConfirmEp(null); }}>
              Lock Episode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Template Prompt Dialog */}
      <AlertDialog open={!!templatePromptEp} onOpenChange={open => !open && setTemplatePromptEp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set EP1 as Season Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will use Episode 1's style and pacing as the benchmark for all subsequent episodes.
              Recommended for maintaining consistency across the season.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Skip</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setAsTemplate.mutate(templatePromptEp!); setTemplatePromptEp(null); }}>
              Set as Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AutoRun Confirm */}
      <AlertDialog open={autoRunConfirmOpen} onOpenChange={setAutoRunConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>AutoRun Season</AlertDialogTitle>
            <AlertDialogDescription>
              Generate all {episodes.filter(e => e.status === 'pending').length} remaining episodes sequentially.
              Each episode is validated before the next begins.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => generateAll()}>Start AutoRun</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Script Reader Dialog */}
      <Dialog open={readerOpen} onOpenChange={setReaderOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              {selectedEpisode
                ? `EP ${String(selectedEpisode.episode_number).padStart(2, '0')} — ${selectedEpisode.title || `Episode ${selectedEpisode.episode_number}`}`
                : 'Script'}
            </DialogTitle>
          </DialogHeader>
          {readerLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1 max-h-[60vh]">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono text-foreground p-4">
                {readerContent}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

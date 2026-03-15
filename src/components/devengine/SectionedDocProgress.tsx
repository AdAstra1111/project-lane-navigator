/**
 * SectionedDocProgress — Progressive scene/beat card viewer for sectioned doc types
 * (story_outline, treatment, beat_sheet) during background generation.
 * Shows each completed section as a card that fades in as it arrives.
 * Polls project_document_chunks every 8s while bg_generating.
 * Supports: click-to-expand completed sections, retry failed sections.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Loader2, Clock, XCircle, ChevronDown, ChevronUp, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  content: string | null;
  char_count: number | null;
  meta_json: Record<string, any> | null;
}

interface SectionedDocProgressProps {
  versionId: string;
  docType: string;
  projectId?: string;
  documentId?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  story_outline: 'Story Outline',
  treatment: 'Treatment',
  beat_sheet: 'Beat Sheet',
  long_treatment: 'Long Treatment',
  character_bible: 'Character Bible',
  feature_script: 'Feature Script',
};

const FAILED_STATUSES = new Set(['failed', 'failed_validation', 'error', 'needs_regen', 'skipped']);

function isSectionFailed(status: string) {
  return FAILED_STATUSES.has(status);
}

function sectionIcon(status: string) {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
  if (isSectionFailed(status)) return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

/** Strip metadata-like preamble lines to show actual prose content */
function cleanContent(raw: string): string {
  const lines = raw.split('\n');
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i].trim();
    if (!line || /^#+\s/.test(line) || /^(Deliverable|Completion|Completeness|Status|Section|Type)\s*(Type|Status|Check)?:/i.test(line)) {
      startIdx = i + 1;
    } else {
      break;
    }
  }
  return lines.slice(startIdx).join('\n').trim();
}

function cleanPreview(raw: string): string {
  const prose = cleanContent(raw);
  const preview = prose.slice(0, 400);
  return preview + (prose.length > 400 ? '…' : '');
}

export function SectionedDocProgress({ versionId, docType, projectId, documentId }: SectionedDocProgressProps) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['sectioned-doc-chunks', versionId],
    queryFn: async () => {
      if (!versionId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, chunk_index, chunk_key, status, content, char_count, meta_json')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChunkRow[];
    },
    enabled: !!versionId,
    refetchInterval: 8000,
  });

  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const total = safeChunks.length;
  const doneCount = safeChunks.filter(c => c.status === 'done').length;
  const failedChunks = safeChunks.filter(c => isSectionFailed(c.status));
  const runningChunk = safeChunks.find(c => c.status === 'running');
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const label = DOC_TYPE_LABELS[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const progressLabel = runningChunk
    ? `Writing ${runningChunk.meta_json?.label || runningChunk.chunk_key.replace(/_/g, ' ')} (${doneCount + 1} of ${total})…`
    : doneCount < total
      ? `Preparing section ${doneCount + 1} of ${total}…`
      : 'Assembling final document…';

  const handleRetrySection = async (chunk: ChunkRow) => {
    if (!projectId || !documentId) {
      toast.error('Missing project context for retry');
      return;
    }
    setRetryingId(chunk.id);
    try {
      // 1. Mark this specific chunk as needs_regen so resumeChunkedGeneration picks it up
      const { error: markErr } = await (supabase as any)
        .from('project_document_chunks')
        .update({ status: 'needs_regen', error: null })
        .eq('id', chunk.id);
      if (markErr) throw markErr;

      // 2. Invoke generate-document in resume mode:
      //    - resumeVersionId tells the backend to reuse the existing version (not create a new one)
      //    - docType is required for prompt-building and chunk plan
      const { error } = await supabase.functions.invoke('generate-document', {
        body: {
          projectId,
          documentId,
          docType,
          resumeVersionId: versionId,
        },
      });
      if (error) throw error;

      toast.success(`Retrying ${chunk.meta_json?.label || chunk.chunk_key.replace(/_/g, ' ')}…`);
      queryClient.invalidateQueries({ queryKey: ['sectioned-doc-chunks', versionId] });
    } catch (err: any) {
      toast.error(`Retry failed: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="flex flex-col w-full space-y-4">
      {/* Header + progress bar */}
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Generating {label}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {doneCount} / {total || '?'} sections
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        <p className="text-xs text-muted-foreground">{progressLabel}</p>
      </div>

      {/* Section cards */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sections…
        </div>
      ) : safeChunks.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting generation…
        </div>
      ) : (
        <div className="w-full space-y-3">
          {safeChunks.map((chunk) => {
            const sectionLabel = chunk.meta_json?.label
              || chunk.chunk_key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            const isDone = chunk.status === 'done';
            const isRunning = chunk.status === 'running';
            const isFailed = isSectionFailed(chunk.status);
            const isExpanded = expandedId === chunk.id;
            const isRetrying = retryingId === chunk.id;

            const previewText = isDone && chunk.content ? cleanPreview(chunk.content) : null;
            const fullText = isDone && chunk.content ? cleanContent(chunk.content) : null;

            return (
              <Card
                key={chunk.id}
                className={`transition-all duration-300 ${
                  isDone
                    ? 'opacity-100 border-border/40 cursor-pointer hover:border-border/60'
                    : isRunning
                      ? 'opacity-90 border-blue-500/30 animate-pulse'
                      : isFailed
                        ? 'opacity-100 border-destructive/40'
                        : 'opacity-40 border-border/20'
                }`}
                onClick={() => isDone && toggleExpand(chunk.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{sectionIcon(chunk.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                          {sectionLabel}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isDone && chunk.char_count != null && (
                            <span className="text-[10px] text-muted-foreground/60 font-mono">
                              {chunk.char_count.toLocaleString()} chars
                            </span>
                          )}
                          {isDone && (
                            isExpanded
                              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/60" />
                              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                          )}
                        </div>
                      </div>

                      {/* Failed: show error + retry */}
                      {isFailed && (
                        <div className="space-y-2">
                          <p className="text-xs text-destructive/80 italic">
                            {chunk.status === 'failed_validation' ? 'Failed validation' 
                              : chunk.status === 'needs_regen' ? 'Needs regeneration'
                              : chunk.status === 'skipped' ? 'Skipped'
                              : 'Generation failed'}
                          </p>
                          {projectId && documentId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetrySection(chunk);
                              }}
                              disabled={!!retryingId}
                            >
                              {isRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                              Retry section
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Done: preview or expanded content */}
                      {isDone && !isExpanded && previewText && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                          {previewText}
                        </p>
                      )}
                      {isDone && isExpanded && fullText && (
                        <ScrollArea className="max-h-[400px] mt-2">
                          <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap pr-3">
                            {fullText}
                          </div>
                        </ScrollArea>
                      )}
                      {isDone && isExpanded && !fullText && (
                        <p className="text-xs text-muted-foreground/50 italic mt-2">
                          Content not yet available — try refreshing.
                        </p>
                      )}
                      {isDone && !isExpanded && !previewText && (
                        <p className="text-xs text-muted-foreground/50 italic">Complete — click to read</p>
                      )}

                      {/* Running */}
                      {isRunning && (
                        <p className="text-xs text-muted-foreground/70 italic">Generating…</p>
                      )}

                      {/* Pending */}
                      {!isDone && !isRunning && !isFailed && (
                        <p className="text-xs text-muted-foreground/40 italic">Pending</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/60 text-center">
        This may take a few minutes. The page will update automatically when ready.
      </p>
    </div>
  );
}

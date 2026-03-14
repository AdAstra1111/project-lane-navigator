/**
 * SectionedDocProgress — Progressive scene/beat card viewer for sectioned doc types
 * (story_outline, treatment, beat_sheet) during background generation.
 * Shows each completed section as a card that fades in as it arrives.
 * Polls project_document_chunks every 8s while bg_generating.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, Loader2, Clock, XCircle } from 'lucide-react';
import { CheckCircle, Loader2, Clock, XCircle } from 'lucide-react';

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
}

const DOC_TYPE_LABELS: Record<string, string> = {
  story_outline: 'Story Outline',
  treatment: 'Treatment',
  beat_sheet: 'Beat Sheet',
  long_treatment: 'Long Treatment',
  character_bible: 'Character Bible',
  feature_script: 'Feature Script',
};

function sectionIcon(status: string) {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
  if (status === 'failed' || status === 'failed_validation') return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

/** Strip metadata-like preamble lines to show actual prose content */
function cleanPreview(raw: string): string {
  const lines = raw.split('\n');
  // Skip lines that look like metadata (key: value, markdown headers, blank)
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i].trim();
    if (!line || /^#+\s/.test(line) || /^(Deliverable|Completion|Completeness|Status|Section|Type)\s*(Type|Status|Check)?:/i.test(line)) {
      startIdx = i + 1;
    } else {
      break;
    }
  }
  const prose = lines.slice(startIdx).join('\n').trim();
  const preview = prose.slice(0, 400);
  return preview + (prose.length > 400 ? '…' : '');
}

export function SectionedDocProgress({ versionId, docType }: SectionedDocProgressProps) {
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
  const runningChunk = safeChunks.find(c => c.status === 'running');
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const label = DOC_TYPE_LABELS[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Progress label: "Writing Act 2A Rising Action (2 of 4)…"
  const progressLabel = runningChunk
    ? `Writing ${runningChunk.meta_json?.label || runningChunk.chunk_key.replace(/_/g, ' ')} (${doneCount + 1} of ${total})…`
    : doneCount < total
      ? `Preparing section ${doneCount + 1} of ${total}…`
      : 'Assembling final document…';

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

            // Extract a clean prose preview — skip metadata-like lines at the start
            const previewText = isDone && chunk.content
              ? cleanPreview(chunk.content)
              : null;

            return (
              <Card
                key={chunk.id}
                className={`transition-all duration-300 ${
                  isDone
                    ? 'opacity-100 border-border/40'
                    : isRunning
                      ? 'opacity-90 border-blue-500/30 animate-pulse'
                      : 'opacity-40 border-border/20'
                }`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{sectionIcon(chunk.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                          {sectionLabel}
                        </h4>
                        {isDone && chunk.char_count != null && (
                          <span className="text-[10px] text-muted-foreground/60 font-mono">
                            {chunk.char_count.toLocaleString()} chars
                          </span>
                        )}
                      </div>
                      {previewText ? (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                          {previewText}
                        </p>
                      ) : isRunning ? (
                        <p className="text-xs text-muted-foreground/70 italic">Generating…</p>
                      ) : isDone ? (
                        <p className="text-xs text-muted-foreground/50 italic">Complete</p>
                      ) : (
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

/**
 * SectionedDocViewer — Persistent read-only structured viewer for completed sectioned documents.
 * Renders section cards from project_document_chunks, with expand/collapse per section.
 * This is the POST-generation counterpart to SectionedDocProgress (which handles in-flight generation).
 *
 * v2: Detects selective rewrites with partial chunks and shows a banner guiding users
 *     to the Raw view for the full merged document.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, ChevronsUpDown, FileText, AlertTriangle } from 'lucide-react';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  content: string | null;
  char_count: number | null;
  meta_json: Record<string, any> | null;
}

interface SectionedDocViewerProps {
  versionId: string;
  /** Version label — used to detect selective rewrites */
  versionLabel?: string | null;
  /** Callback to switch parent to raw view */
  onSwitchToRaw?: () => void;
}

function formatSectionTitle(chunk: ChunkRow): string {
  if (chunk.meta_json?.label) return chunk.meta_json.label;
  return chunk.chunk_key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanContent(raw: string): string {
  let text = raw.trim();
  // Strip markdown fences
  text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '');
  // Strip leading heading if it duplicates the chunk_key label
  text = text.replace(/^#{1,3}\s+.*\n+/, '');
  return text.trim();
}

export function SectionedDocViewer({ versionId, versionLabel, onSwitchToRaw }: SectionedDocViewerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['sectioned-doc-viewer-chunks', versionId],
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
    staleTime: 60_000,
  });

  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const doneChunks = safeChunks.filter((c) => c.status === 'done' && c.content);

  // Detect selective rewrite: version label pattern or very few chunks relative to a typical full doc
  const isSelectiveRewrite = !!(versionLabel && /selective scene rewrite/i.test(versionLabel));

  const toggleSection = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedIds.size === doneChunks.length) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(doneChunks.map((c) => c.id)));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        Loading sections…
      </div>
    );
  }

  if (doneChunks.length === 0) {
    return null; // Caller should fall back to raw view
  }

  const allExpanded = expandedIds.size === doneChunks.length;

  return (
    <div>
      {/* Selective rewrite partial-content banner */}
      {isSelectiveRewrite && (
        <div className="mb-3 flex items-start gap-2 p-2.5 rounded-md border border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-amber-300 font-medium">Partial View — Selective Rewrite</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Only rewritten sections are shown below. Scores reflect the full merged document.
              {onSwitchToRaw && ' Switch to Raw view to see the complete document.'}
            </p>
            {onSwitchToRaw && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] mt-1 px-2 text-amber-400 hover:text-amber-300"
                onClick={onSwitchToRaw}
              >
                View full document →
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Expand/Collapse all */}
      <div className="flex justify-end mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={toggleAll}
        >
          <ChevronsUpDown className="h-3 w-3" />
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      <ScrollArea className="max-h-[70vh]">
        <div className="flex flex-col gap-2">
          {doneChunks.map((chunk) => {
            const isExpanded = expandedIds.has(chunk.id);
            const title = formatSectionTitle(chunk);
            const content = chunk.content ? cleanContent(chunk.content) : '';
            const charCount = chunk.char_count ?? content.length;

            return (
              <div
                key={chunk.id}
                className="border border-border/50 rounded-md overflow-hidden bg-card/30"
              >
                {/* Section header — clickable */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/30 transition-colors"
                  onClick={() => toggleSection(chunk.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {title}
                    </span>
                    <span className="text-[0.65rem] text-muted-foreground/60 shrink-0">
                      {charCount.toLocaleString()} chars
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-1 border-t border-border/30">
                    <div className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed font-body">
                      {content}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
/**
 * Hook to check if chunks exist for a version.
 * Used by the parent to decide whether to show structured view toggle.
 */
export function useHasChunks(versionId: string | undefined) {
  return useQuery({
    queryKey: ['has-chunks', versionId],
    queryFn: async () => {
      if (!versionId) return false;
      const { count, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('version_id', versionId)
        .eq('status', 'done');
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!versionId,
    staleTime: 30_000,
  });
}

/**
 * VersionsPanel — document version list inside ProjectShell drawer.
 * Select a document, see versions, switch current.
 * Shows "★ BEST" badge when a version matches the auto-run job's best_version_id.
 */
import { useState, useMemo } from 'react';
import { useProjectDocuments } from '@/hooks/useProjects';
import { useDocumentVersions, useSetCurrentVersion } from '@/hooks/useDocumentVersions';
import { cn } from '@/lib/utils';
import { Check, Loader2, FileText, Star, ArrowUp, Clock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { useDocTypeScopedBest } from '@/hooks/useRunSnapshot';

interface VersionsPanelProps {
  projectId: string;
}

export function VersionsPanel({ projectId }: VersionsPanelProps) {
  const { documents, isLoading: docsLoading } = useProjectDocuments(projectId);
  const [selectedDocId, setSelectedDocId] = useState<string | undefined>();

  // Filter to dev-engine docs (those without file_path = pipeline docs)
  const devDocs = useMemo(() =>
    documents.filter(d => !d.file_path || (d.doc_type as string) === 'script_pdf'),
    [documents],
  );

  // Auto-select first if none selected
  const effectiveDocId = selectedDocId ?? devDocs[0]?.id;

  // Fetch best version scoped to the selected document's doc_type (not global)
  const { data: bestInfo } = useDocTypeScopedBest(projectId, effectiveDocId);

  const bestVersionId = bestInfo?.versionId ?? null;
  const bestScore = bestInfo?.score ?? null;
  const bestDocType = bestInfo?.docType ?? null;

  const { data: versions = [], isLoading: versionsLoading } = useDocumentVersions(effectiveDocId);
  const setCurrentVersion = useSetCurrentVersion();

  if (docsLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (devDocs.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 h-full">
        <p className="text-xs text-muted-foreground/50 text-center">No documents with versions yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Document selector */}
      <div className="px-3 py-2 border-b border-border/20">
        <Select value={effectiveDocId} onValueChange={setSelectedDocId}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select document" />
          </SelectTrigger>
          <SelectContent>
            {devDocs.map(d => (
              <SelectItem key={d.id} value={d.id} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  {(d.doc_type as string) || d.file_name || 'Document'}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Best version info (now scoped to selected doc_type) */}
      {bestVersionId && bestDocType && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/20 flex items-center gap-1">
          <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
          Best for {bestDocType.replace(/_/g, ' ')} (score {bestScore})
        </div>
      )}

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versionsLoading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center p-4">No versions</p>
        ) : (
          <div className="divide-y divide-border/10">
            {versions.map(v => {
              const isBest = bestVersionId === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    if (!v.is_current && effectiveDocId) {
                      setCurrentVersion.mutate({ documentId: effectiveDocId, versionId: v.id });
                    }
                  }}
                  disabled={v.is_current || setCurrentVersion.isPending}
                  className={cn(
                    'w-full text-left px-3 py-2.5 text-xs transition-colors hover:bg-muted/30',
                    v.is_current && 'bg-primary/5',
                    isBest && !v.is_current && 'bg-amber-500/5',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      v{v.version_number}
                      {v.is_current && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-primary">
                          <Check className="h-3 w-3" /> current
                        </span>
                      )}
                      {isBest && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-amber-400 font-semibold">
                          <Star className="h-3 w-3 fill-amber-400" /> BEST
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground/60">
                      {format(new Date(v.created_at), 'MMM d, HH:mm')}
                    </span>
                  </div>
                  {(v as any).meta_json?.bg_generating === true ? (
                    <p className="text-blue-400 mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3 animate-pulse" />
                      ⏳ Generating…
                    </p>
                  ) : (
                    <>
                      {(v as any).label && (
                        <p className="text-muted-foreground/70 mt-0.5 line-clamp-1">{(v as any).label}</p>
                      )}
                      {v.change_summary && (
                        <p className="text-muted-foreground/70 mt-0.5 line-clamp-1">{v.change_summary}</p>
                      )}
                    </>
                  )}
                  {v.approval_status && v.approval_status !== 'none' && (
                    <span className={cn(
                      'inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full',
                      v.approval_status === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400',
                    )}>
                      {v.approval_status}
                    </span>
                  )}
                  {isBest && !v.is_current && (
                    <span
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium hover:bg-amber-500/25 transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (effectiveDocId) {
                          setCurrentVersion.mutate({ documentId: effectiveDocId, versionId: v.id });
                        }
                      }}
                    >
                      <ArrowUp className="h-2.5 w-2.5" /> Promote BEST to current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

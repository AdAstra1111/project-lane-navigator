/**
 * VersionsPanel — document version list inside ProjectShell drawer.
 * Select a document, see versions, switch current.
 * Shows "★ BEST" badge when a version matches the auto-run job's best_version_id.
 * v2: Shows version type (Full / Selective / Batch Fix) and score scope badges.
 */
import { useState, useMemo } from 'react';
import { useProjectDocuments } from '@/hooks/useProjects';
import { useDocumentVersions, useSetCurrentVersion, type DocumentVersion } from '@/hooks/useDocumentVersions';
import { useDeleteVersion } from '@/hooks/useDeleteVersion';
import { cn } from '@/lib/utils';
import { Check, Loader2, FileText, Star, ArrowUp, Layers, Target, Wrench, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { useDocTypeScopedBest } from '@/hooks/useRunSnapshot';

interface VersionsPanelProps {
  projectId: string;
}

/** Derive a human-readable version type from label + generator_id + meta_json */
function deriveVersionType(v: DocumentVersion): { type: 'full' | 'selective' | 'batch_fix' | 'generation'; label: string; scope?: string } {
  const label = v.label ?? '';
  const genId = v.generator_id ?? '';
  const metaJson = v.meta_json ?? {};

  // Selective scene rewrite — label encodes scope
  const selectiveMatch = label.match(/Selective scene rewrite \((\d+)\/(\d+) scenes?\)/i);
  if (selectiveMatch) {
    return { type: 'selective', label: 'Selective Rewrite', scope: `${selectiveMatch[1]}/${selectiveMatch[2]} scenes` };
  }

  // Full scene rewrite
  if (label.toLowerCase().includes('scene rewrite') || genId.includes('scene-rewrite')) {
    return { type: 'full', label: 'Full Rewrite' };
  }

  // Batch fix
  if (label.toLowerCase().includes('batch fix') || genId.includes('apply-staged-fixes')) {
    return { type: 'batch_fix', label: 'Batch Fix' };
  }

  // Decision / bundle rewrite
  if (genId.includes('decision') || genId.includes('bundle')) {
    return { type: 'full', label: 'Targeted Rewrite' };
  }

  // Background generation (sectioned)
  if (metaJson.bg_generating === true || genId.includes('bg-generate') || genId.includes('sectioned')) {
    return { type: 'generation', label: 'Generation' };
  }

  // Default: full document
  return { type: 'full', label: 'Full Document' };
}

function VersionTypeBadge({ versionType }: { versionType: ReturnType<typeof deriveVersionType> }) {
  const config = {
    full: { icon: Layers, color: 'bg-primary/10 text-primary border-primary/20' },
    selective: { icon: Target, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    batch_fix: { icon: Wrench, color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
    generation: { icon: Layers, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  };
  const { icon: Icon, color } = config[versionType.type];

  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border', color)}>
      <Icon className="h-2.5 w-2.5" />
      {versionType.label}
    </span>
  );
}

function ScoreBadges({ metaJson, versionType }: { metaJson?: Record<string, any> | null; versionType: ReturnType<typeof deriveVersionType> }) {
  const ci = metaJson?.ci;
  const gp = metaJson?.gp;
  if (typeof ci !== 'number' && typeof gp !== 'number') return null;

  const scopeLabel = versionType.type === 'selective' ? 'full doc score' : undefined;

  return (
    <div className="flex items-center gap-2 mt-1">
      {typeof ci === 'number' && (
        <span className="text-[9px] text-muted-foreground">
          CI <span className="font-semibold text-foreground">{ci}</span>
        </span>
      )}
      {typeof gp === 'number' && (
        <span className="text-[9px] text-muted-foreground">
          GP <span className="font-semibold text-foreground">{gp}</span>
        </span>
      )}
      {scopeLabel && (
        <span className="text-[8px] text-muted-foreground/50 italic">{scopeLabel}</span>
      )}
    </div>
  );
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
  const deleteVersion = useDeleteVersion();

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
              const versionType = deriveVersionType(v);
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

                  {/* Version type + scope badge */}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <VersionTypeBadge versionType={versionType} />
                    {versionType.scope && (
                      <span className="text-[9px] text-muted-foreground/60">{versionType.scope}</span>
                    )}
                  </div>

                  <>
                    {v.meta_json?.bg_generating === true ? (
                      <p className="text-amber-400/80 mt-0.5 text-[10px]">⏳ Generating…</p>
                    ) : (
                      <>
                        {v.change_summary && (
                          <p className="text-muted-foreground/70 mt-0.5 line-clamp-1">{v.change_summary.replace(/^Chunked rewrite across (\d+) iterations?\.$/i, 'Episode-scoped rewrite across $1 passes.').replace(/Generated via chunked large-risk pipeline/i, 'Generated via episodic pipeline')}</p>
                        )}
                      </>
                    )}
                  </>

                  {/* CI/GP scores with scope label */}
                  <ScoreBadges metaJson={v.meta_json} versionType={versionType} />

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
                  {/* Delete button — only for non-sole versions */}
                  {versions.length > 1 && !v.is_current && (
                    <span
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-destructive/10 text-destructive font-medium hover:bg-destructive/20 transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (effectiveDocId && confirm(`Delete v${v.version_number}? This cannot be undone.`)) {
                          deleteVersion.mutate({ versionId: v.id, documentId: effectiveDocId });
                        }
                      }}
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Delete
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

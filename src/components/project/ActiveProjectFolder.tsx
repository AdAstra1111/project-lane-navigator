/**
 * ActiveProjectFolder: Displays and manages the canonical active document per type.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { FolderOpen, Check, RefreshCw, Loader2, ChevronDown, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { DOC_TYPE_KEY_LABELS, type DocTypeKey } from '@/lib/active-folder/normalizeDocTypeKey';
import { initActiveFolder, setActiveVersion, approveAndActivate } from '@/lib/active-folder/approveAndActivate';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  projectId: string;
}

interface ActiveDocRow {
  id: string;
  project_id: string;
  doc_type_key: string;
  document_version_id: string;
  approved_at: string;
  approved_by: string | null;
  source_flow: string | null;
  notes: string | null;
}

export function ActiveProjectFolder({ projectId }: Props) {
  const queryClient = useQueryClient();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Fetch active docs
  const { data: activeDocs, isLoading } = useQuery({
    queryKey: ['active-folder', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_active_docs')
        .select('*')
        .eq('project_id', projectId)
        .order('doc_type_key');
      if (error) throw error;
      return (data || []) as ActiveDocRow[];
    },
  });

  // Fetch all project docs for version selection
  const { data: projectDocs } = useQuery({
    queryKey: ['project-docs-for-folder', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_documents')
        .select('id, doc_type, title, file_name, latest_version_id')
        .eq('project_id', projectId)
        .not('latest_version_id', 'is', null);
      return data || [];
    },
  });

  // Fetch version details for active docs
  const activeVersionIds = (activeDocs || []).map(d => d.document_version_id);
  const { data: versionDetails } = useQuery({
    queryKey: ['active-folder-versions', activeVersionIds.join(',')],
    queryFn: async () => {
      if (!activeVersionIds.length) return {};
      const { data } = await supabase
        .from('project_document_versions')
        .select('id, version_number, document_id, created_at')
        .in('id', activeVersionIds);
      const map: Record<string, any> = {};
      for (const v of (data || [])) map[v.id] = v;
      return map;
    },
    enabled: activeVersionIds.length > 0,
  });

  // Doc ID -> doc info map
  const docMap: Record<string, any> = {};
  for (const d of (projectDocs || [])) docMap[d.id] = d;

  const initFolder = useMutation({
    mutationFn: () => initActiveFolder(projectId),
    onSuccess: (data: any) => {
      toast.success(`Initialized ${data.initialized} active doc${data.initialized !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to initialize'),
  });

  const setActive = useMutation({
    mutationFn: (opts: { docTypeKey: string; documentVersionId: string }) =>
      setActiveVersion({ projectId, ...opts }),
    onSuccess: () => {
      toast.success('Active document updated');
      queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to set active'),
  });

  const approveDoc = useMutation({
    mutationFn: (versionId: string) =>
      approveAndActivate({ projectId, documentVersionId: versionId, sourceFlow: 'manual' }),
    onSuccess: () => {
      toast.success('Document approved and activated');
      queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to approve'),
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-4 space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const isEmpty = !activeDocs?.length;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">Active Project Folder</h4>
          {!isEmpty && (
            <Badge variant="outline" className="text-[10px]">
              {activeDocs.length} doc{activeDocs.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => initFolder.mutate()}
          disabled={initFolder.isPending}
          className="h-7 text-xs"
        >
          {initFolder.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {isEmpty ? 'Initialize' : 'Refresh'}
        </Button>
      </div>

      {isEmpty ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No active documents set yet.</p>
          <p className="text-xs mt-1">Click Initialize to auto-populate from your latest documents.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {activeDocs.map((doc) => {
            const version = versionDetails?.[doc.document_version_id];
            const parentDoc = version ? docMap[version.document_id] : null;
            const label = DOC_TYPE_KEY_LABELS[doc.doc_type_key as DocTypeKey] || doc.doc_type_key;
            const title = parentDoc?.title || parentDoc?.file_name || 'Document';

            return (
              <div
                key={doc.id}
                className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{title}</span>
                    {version && (
                      <span className="text-[10px] text-muted-foreground font-mono">v{version.version_number}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[9px] h-4">{label}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.approved_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Check className="h-3 w-3 text-emerald-400" />

                  {/* Replace dropdown - shows other versions of same doc type */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {(projectDocs || [])
                        .filter(d => d.latest_version_id && d.latest_version_id !== doc.document_version_id)
                        .slice(0, 10)
                        .map(d => (
                          <DropdownMenuItem
                            key={d.id}
                            onClick={() => {
                              if (d.latest_version_id) {
                                setActive.mutate({
                                  docTypeKey: doc.doc_type_key,
                                  documentVersionId: d.latest_version_id,
                                });
                              }
                            }}
                            className="text-xs"
                          >
                            {d.title || d.file_name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick approve section for unapproved docs */}
      {projectDocs && projectDocs.length > (activeDocs?.length || 0) && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Available to activate</p>
          <div className="space-y-1">
            {projectDocs
              .filter(d => d.latest_version_id && !activeDocs?.some(a => a.document_version_id === d.latest_version_id))
              .slice(0, 5)
              .map(d => (
                <div key={d.id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-muted/20">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground flex-1 truncate">{d.title || d.file_name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 text-[10px] px-2"
                    onClick={() => d.latest_version_id && approveDoc.mutate(d.latest_version_id)}
                    disabled={approveDoc.isPending}
                  >
                    Activate
                  </Button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ActiveProjectFolder: Displays and manages the canonical active document per type.
 * Shows candidates from init (not auto-populated), filtered replace dropdown by doc_type_key.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { FolderOpen, Check, RefreshCw, Loader2, ChevronDown, FileText, ShieldCheck, AlertCircle, Download } from 'lucide-react';
import { DocumentExportDropdown } from '@/components/DocumentExportDropdown';
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
import { DOC_TYPE_KEY_LABELS, type DocTypeKey, normalizeDocTypeKey } from '@/lib/active-folder/normalizeDocTypeKey';
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

interface Candidate {
  doc_type_key: string;
  document_version_id: string;
  title: string;
  approval_status: string;
  reason: string;
}

export function ActiveProjectFolder({ projectId }: Props) {
  const queryClient = useQueryClient();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

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

  // Fetch project format for normalization
  const { data: projectData } = useQuery({
    queryKey: ['active-folder-project', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('format')
        .eq('id', projectId)
        .single();
      return data;
    },
  });

  const isSeries = ['tv-series', 'limited-series', 'vertical-drama', 'digital-series', 'documentary-series', 'anim-series']
    .includes((projectData?.format || '').toLowerCase().replace(/_/g, '-'));

  // Fetch all project doc versions for replace dropdown (with approval_status + doc_type info)
  const { data: allVersions } = useQuery({
    queryKey: ['active-folder-all-versions', projectId],
    queryFn: async () => {
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, doc_type, title, file_name')
        .eq('project_id', projectId);
      if (!docs?.length) return [];

      const docIds = docs.map(d => d.id);
      const { data: versions } = await supabase
        .from('project_document_versions')
        .select('id, document_id, version_number, deliverable_type, label, stage, approval_status, created_at')
        .in('document_id', docIds)
        .order('version_number', { ascending: false });

      const docMap: Record<string, any> = {};
      for (const d of docs) docMap[d.id] = d;

      return (versions || []).map(v => {
        const parent = docMap[v.document_id];
        const docTypeKey = normalizeDocTypeKey({
          deliverable_type: v.deliverable_type,
          doc_type: parent?.doc_type,
          title: parent?.title,
          file_name: parent?.file_name,
          label: v.label,
          stage: v.stage,
        }, isSeries);
        return {
          ...v,
          parentTitle: parent?.title || parent?.file_name || 'Document',
          doc_type_key: docTypeKey,
        };
      });
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
        .select('id, version_number, document_id, created_at, approval_status, plaintext')
        .in('id', activeVersionIds);
      const map: Record<string, any> = {};
      for (const v of (data || [])) map[v.id] = v;
      return map;
    },
    enabled: activeVersionIds.length > 0,
  });

  // Fetch parent doc info for active versions
  const { data: projectDocs } = useQuery({
    queryKey: ['project-docs-for-folder', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_documents')
        .select('id, doc_type, title, file_name, latest_version_id')
        .eq('project_id', projectId);
      return data || [];
    },
  });

  const docMap: Record<string, any> = {};
  for (const d of (projectDocs || [])) docMap[d.id] = d;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
    queryClient.invalidateQueries({ queryKey: ['active-folder-all-versions', projectId] });
  };

  const initFolder = useMutation({
    mutationFn: () => initActiveFolder(projectId),
    onSuccess: (data: any) => {
      const cands = data.candidates || [];
      setCandidates(cands);
      setShowCandidates(true);
      if (cands.length === 0) {
        toast.info('No new candidates found — all doc types already have active versions or no documents exist.');
      } else {
        toast.success(`Found ${cands.length} candidate${cands.length !== 1 ? 's' : ''} to review`);
      }
    },
    onError: (err: any) => toast.error(err.message || 'Failed to scan'),
  });

  const approveDoc = useMutation({
    mutationFn: (versionId: string) =>
      approveAndActivate({ projectId, documentVersionId: versionId, sourceFlow: 'manual' }),
    onSuccess: () => {
      toast.success('Document approved and activated');
      invalidateAll();
      // Remove from candidates
      setCandidates(prev => prev?.filter(c => c.document_version_id !== approveDoc.variables) || null);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to approve'),
  });

  const setActive = useMutation({
    mutationFn: (opts: { docTypeKey: string; documentVersionId: string }) =>
      setActiveVersion({ projectId, ...opts }),
    onSuccess: () => {
      toast.success('Active document updated');
      invalidateAll();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to set active'),
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
  const activeCandidates = candidates?.filter(c => !activeDocs?.some(a => a.doc_type_key === c.doc_type_key)) || [];

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
          {isEmpty ? 'Scan Documents' : 'Scan for New'}
        </Button>
      </div>

      {/* Candidates section */}
      {showCandidates && activeCandidates.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-2 font-medium">
            Candidates to Approve & Activate
          </p>
          <div className="space-y-1">
            {activeCandidates.map(c => {
              const label = DOC_TYPE_KEY_LABELS[c.doc_type_key as DocTypeKey] || c.doc_type_key;
              return (
                <div key={c.document_version_id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/20">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-foreground truncate block">{c.title}</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[9px] h-4">{label}</Badge>
                      {c.approval_status === 'approved' ? (
                        <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                          <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Approved
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] h-4 border-amber-500/30 text-amber-400 bg-amber-500/10">
                          <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Draft
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-6 text-[10px] px-2 gap-1"
                    onClick={() => approveDoc.mutate(c.document_version_id)}
                    disabled={approveDoc.isPending}
                  >
                    {approveDoc.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ShieldCheck className="h-2.5 w-2.5" />}
                    Approve & Activate
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isEmpty && !showCandidates ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No active documents set yet.</p>
          <p className="text-xs mt-1">Click "Scan Documents" to find candidates, then approve them.</p>
        </div>
      ) : !isEmpty && (
        <div className="space-y-1">
          {activeDocs.map((doc) => {
            const version = versionDetails?.[doc.document_version_id];
            const parentDoc = version ? docMap[version.document_id] : null;
            const label = DOC_TYPE_KEY_LABELS[doc.doc_type_key as DocTypeKey] || doc.doc_type_key;
            const title = parentDoc?.title || parentDoc?.file_name || 'Document';

            // Filter replace options: same doc_type_key, approved only, not current
            const replaceOptions = (allVersions || [])
              .filter(v =>
                v.doc_type_key === doc.doc_type_key &&
                v.id !== doc.document_version_id &&
                v.approval_status === 'approved'
              )
              .slice(0, 10);

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
                    <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                      <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Approved
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.approved_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Export */}
                  {version?.plaintext && (
                    <DocumentExportDropdown
                      text={version.plaintext}
                      title={`${title}_v${version?.version_number || 1}`}
                      size="sm"
                      showLabel={false}
                    />
                  )}
                  <Check className="h-3 w-3 text-emerald-400" />

                  {/* Replace dropdown - only shows APPROVED versions of SAME doc_type_key */}
                  {replaceOptions.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <div className="px-2 py-1 text-[10px] text-muted-foreground font-medium">
                          Replace with (approved only)
                        </div>
                        {replaceOptions.map(v => (
                          <DropdownMenuItem
                            key={v.id}
                            onClick={() => setActive.mutate({
                              docTypeKey: doc.doc_type_key,
                              documentVersionId: v.id,
                            })}
                            className="text-xs"
                          >
                            {v.parentTitle} v{v.version_number}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

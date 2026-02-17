/**
 * ToplineNarrativeCard: Shows logline + synopsis excerpt from active/latest topline,
 * with Open, Download, Generate, Approve & Activate, and Create CTA for legacy projects.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Sparkles, ShieldCheck, Loader2, Plus, ExternalLink } from 'lucide-react';
import { DocumentExportDropdown } from '@/components/DocumentExportDropdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { approveAndActivate } from '@/lib/active-folder/approveAndActivate';

interface Props {
  projectId: string;
  onNavigateToDoc?: (documentId: string, versionId?: string) => void;
  onGenerateTopline?: () => void;
}

function parseToplineSections(text: string) {
  const loglineMatch = text.match(/# LOGLINE\s*\n([\s\S]*?)(?=\n# |$)/i);
  const shortSynMatch = text.match(/# SHORT SYNOPSIS\s*\n([\s\S]*?)(?=\n# |$)/i);
  const logline = loglineMatch?.[1]?.trim() || '';
  const shortSynopsis = shortSynMatch?.[1]?.trim() || '';
  return { logline, shortSynopsis };
}

export function ToplineNarrativeCard({ projectId, onNavigateToDoc, onGenerateTopline }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // Fetch topline doc: prefer active folder, else latest version
  const { data: toplineData, isLoading } = useQuery({
    queryKey: ['topline-narrative', projectId],
    queryFn: async () => {
      // 1) Check active folder
      const { data: activeDoc } = await supabase
        .from('project_active_docs')
        .select('document_version_id')
        .eq('project_id', projectId)
        .eq('doc_type_key', 'topline_narrative')
        .maybeSingle();

      let versionId = activeDoc?.document_version_id || null;
      let documentId: string | null = null;
      let isActive = !!activeDoc;

      // 2) Fallback: find project_documents row
      const { data: docRow } = await supabase
        .from('project_documents')
        .select('id, latest_version_id')
        .eq('project_id', projectId)
        .eq('doc_type', 'topline_narrative')
        .maybeSingle();

      if (docRow) {
        documentId = docRow.id;
        if (!versionId) versionId = docRow.latest_version_id;
      }

      if (!versionId) return { exists: !!docRow, documentId, version: null, isActive: false };

      // 3) Fetch version content
      const { data: version } = await supabase
        .from('project_document_versions')
        .select('id, version_number, plaintext, approval_status, created_at')
        .eq('id', versionId)
        .single();

      return { exists: true, documentId, version, isActive };
    },
  });

  const openDocument = (docId: string, versionId?: string) => {
    if (onNavigateToDoc) {
      onNavigateToDoc(docId, versionId);
    } else {
      // Fallback: navigate to dev engine with doc + version params
      const params = new URLSearchParams();
      params.set('doc', docId);
      if (versionId) params.set('version', versionId);
      navigate(`/projects/${projectId}/development?${params.toString()}`);
    }
  };

  const createTopline = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('project-docs-admin', {
        body: { action: 'ensure-topline', projectId },
      });
      if (error) throw error;
      toast.success('Topline Narrative created');
      queryClient.invalidateQueries({ queryKey: ['topline-narrative', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-docs-for-folder', projectId] });
      queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
      if (data?.documentId) {
        openDocument(data.documentId, data.versionId);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create topline');
    } finally {
      setCreating(false);
    }
  };

  const approveMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return approveAndActivate({
        projectId,
        documentVersionId: versionId,
        sourceFlow: 'manual',
      });
    },
    onSuccess: () => {
      toast.success('Topline approved and activated');
      queryClient.invalidateQueries({ queryKey: ['topline-narrative', projectId] });
      queryClient.invalidateQueries({ queryKey: ['active-folder', projectId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to approve'),
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-4">
        <Skeleton className="h-5 w-40 mb-3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // No topline doc at all → show CTA
  if (!toplineData?.exists) {
    return (
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">Topline Narrative</h4>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">Missing</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          A Topline Narrative (logline + synopsis + story pillars) helps anchor all development. Create one to get started.
        </p>
        <Button
          size="sm"
          onClick={createTopline}
          disabled={creating}
          className="gap-1.5"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create Topline Narrative
        </Button>
      </div>
    );
  }

  const version = toplineData.version;
  const isTemplate = !version?.plaintext || version.plaintext.includes('[1–2 sentences]');
  const { logline, shortSynopsis } = version?.plaintext ? parseToplineSections(version.plaintext) : { logline: '', shortSynopsis: '' };
  const isTemplateLogline = !logline || logline === '[1–2 sentences]';
  const isDraft = version?.approval_status === 'draft';

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">Topline Narrative</h4>
          {version && (
            <span className="text-[10px] text-muted-foreground font-mono">v{version.version_number}</span>
          )}
          {toplineData.isActive ? (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
              <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Active
            </Badge>
          ) : isDraft ? (
            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10">Draft</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {/* Download/Export — same props as DocumentExportDropdown everywhere else */}
          {version?.plaintext && !isTemplate && (
            <DocumentExportDropdown
              text={version.plaintext}
              title={`Topline_Narrative_v${version.version_number}`}
              size="sm"
              showLabel={false}
            />
          )}
          {/* Open — works even without onNavigateToDoc */}
          {toplineData.documentId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => openDocument(toplineData.documentId!, version?.id)}
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </Button>
          )}
        </div>
      </div>

      {/* Content preview */}
      {isTemplate ? (
        <p className="text-xs text-muted-foreground italic mb-3">
          Template created — fill in your logline, synopsis, and story pillars.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {!isTemplateLogline && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Logline</p>
              <p className="text-xs text-foreground leading-relaxed">{logline}</p>
            </div>
          )}
          {shortSynopsis && shortSynopsis !== '[150–300 words]' && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Synopsis</p>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{shortSynopsis}</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {onGenerateTopline && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onGenerateTopline}>
            <Sparkles className="h-3 w-3" />
            Generate
          </Button>
        )}
        {version && isDraft && !toplineData.isActive && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => approveMutation.mutate(version.id)}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            Approve & Activate
          </Button>
        )}
      </div>
    </div>
  );
}

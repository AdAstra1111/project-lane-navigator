import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getDocPackage, getRequiredDocsForStage, getDocOrderPrefix } from '@/lib/document-packages';

export interface PackageDocStatus {
  docType: string;
  order: number;
  documentId: string | null;
  latestVersionId: string | null;
  status: 'missing' | 'draft' | 'final' | 'superseded' | 'stale';
  resolverHash: string | null;
  exportPath: string | null;
  updatedAt: string | null;
  required: boolean;
}

export function useDocumentPackage(projectId: string | undefined) {
  const qc = useQueryClient();

  // Fetch project metadata
  const { data: project } = useQuery({
    queryKey: ['package-project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await (supabase as any)
        .from('projects')
        .select('id, format, pipeline_stage, resolved_qualifications_hash')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const productionType = project?.format || 'film';
  const pipelineStage = project?.pipeline_stage || 'development';
  const currentResolverHash = project?.resolved_qualifications_hash || null;

  // Fetch all project_documents with their latest version status
  const { data: packageStatus = [], isLoading } = useQuery({
    queryKey: ['package-status', projectId, productionType, pipelineStage],
    queryFn: async () => {
      if (!projectId) return [];

      const pkg = getDocPackage(productionType);
      const allDocTypes = Object.keys(pkg.doc_order);
      const requiredDocs = getRequiredDocsForStage(productionType, pipelineStage);

      // Fetch all documents for this project
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, latest_version_id, latest_export_path, updated_at')
        .eq('project_id', projectId);

      const docMap = new Map((docs || []).map((d: any) => [d.doc_type, d]));

      // For docs that exist, fetch their latest version status
      const docsWithVersion = (docs || []).filter((d: any) => d.latest_version_id);
      const docIds = docsWithVersion.map((d: any) => d.latest_version_id as string);
      let versionMap = new Map<string, any>();
      if (docIds.length > 0) {
        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('id, status, depends_on_resolver_hash, is_stale, stale_reason, inputs_used, depends_on, generator_id')
          .in('id', docIds);
        versionMap = new Map((versions || []).map((v: any) => [v.id, v]));
      }

      const result: PackageDocStatus[] = allDocTypes.map(docType => {
        const doc = docMap.get(docType) as any;
        const version = doc?.latest_version_id ? versionMap.get(doc.latest_version_id) : null;

        let status: PackageDocStatus['status'] = 'missing';
        if (version) {
          if (version.status === 'final') {
            if (currentResolverHash && version.depends_on_resolver_hash && version.depends_on_resolver_hash !== currentResolverHash) {
              status = 'stale';
            } else {
              status = 'final';
            }
          } else {
            status = version.status || 'draft';
          }
        } else if (doc) {
          status = 'draft';
        }

        return {
          docType,
          order: pkg.doc_order[docType] || 99,
          documentId: doc?.id || null,
          latestVersionId: doc?.latest_version_id || null,
          status,
          resolverHash: version?.depends_on_resolver_hash || null,
          exportPath: doc?.latest_export_path || null,
          updatedAt: doc?.updated_at || null,
          required: requiredDocs.includes(docType),
        };
      });

      return result.sort((a, b) => a.order - b.order);
    },
    enabled: !!projectId,
  });

  // Compute package readiness
  const requiredDocs = packageStatus.filter(d => d.required);
  const finalizedRequired = requiredDocs.filter(d => d.status === 'final');
  const packageReadyPct = requiredDocs.length > 0
    ? Math.round((finalizedRequired.length / requiredDocs.length) * 100)
    : 0;
  const canProgress = requiredDocs.length > 0 && requiredDocs.every(d => d.status === 'final');
  const hasStale = packageStatus.some(d => d.status === 'stale' && d.required);

  // Publish mutation
  const publish = useMutation({
    mutationFn: async ({ docTypes, advanceStage }: { docTypes: string[]; advanceStage?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('publish-package', {
        body: { projectId, docTypes, advanceStage },
      });
      if (error) throw error;
      if (data?.errors?.length > 0) {
        console.warn('[publish-package] partial errors:', data.errors);
      }
      return data;
    },
    onSuccess: (data) => {
      const publishedCount = data?.published?.length || 0;
      const errorCount = data?.errors?.length || 0;
      if (errorCount > 0) {
        toast.warning(`Published ${publishedCount} docs, ${errorCount} errors`);
      } else {
        toast.success(`Published ${publishedCount} documents${data?.advancedStage ? ' — stage advanced' : ''}`);
      }
      qc.invalidateQueries({ queryKey: ['package-status', projectId] });
      qc.invalidateQueries({ queryKey: ['package-project', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
    },
    onError: (err: any) => {
      toast.error('Publish failed: ' + (err.message || 'Unknown error'));
    },
  });

  return {
    packageStatus,
    isLoading,
    packageReadyPct,
    canProgress,
    hasStale,
    currentResolverHash,
    pipelineStage,
    productionType,
    publish,
  };
}

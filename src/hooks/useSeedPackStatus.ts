/**
 * useSeedPackStatus — Fetches seed doc presence AND current version info
 * to provide truthful ✓ / ⚠ / ✗ status for each canonical seed doc type.
 * No LLM calls. Pure DB query.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const SEED_DOC_TYPES = ['project_overview', 'creative_brief', 'market_positioning', 'canon', 'nec'] as const;
export type SeedDocType = typeof SEED_DOC_TYPES[number];

const MIN_SEED_CHARS = 20;

export interface SeedDocInfo {
  doc_type: SeedDocType;
  doc_id: string | null;
  has_current_version: boolean;
  char_count: number;
  approval_status: string | null;
  status: 'present' | 'short' | 'missing';
}

export interface SeedPackStatusResult {
  docs: SeedDocInfo[];
  presentCount: number;
  warningCount: number;
  missingCount: number;
  allPresent: boolean;
  allApproved: boolean;
  isLoading: boolean;
}

export function useSeedPackStatus(projectId: string | undefined): SeedPackStatusResult {
  const { data, isLoading } = useQuery({
    queryKey: ['seed-pack-versions', projectId],
    queryFn: async (): Promise<SeedDocInfo[]> => {
      if (!projectId) return SEED_DOC_TYPES.map(dt => ({ doc_type: dt, doc_id: null, has_current_version: false, char_count: 0, approval_status: null, status: 'missing' as const }));

      // Fetch seed docs
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', [...SEED_DOC_TYPES]);

      const docMap = new Map<string, string>();
      for (const d of (docs || [])) {
        docMap.set(d.doc_type, d.id);
      }

      // Fetch current versions for those docs
      const docIds = Array.from(docMap.values());
      let versionMap = new Map<string, { chars: number; approval_status: string | null }>();
      if (docIds.length > 0) {
        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('document_id, plaintext, approval_status')
          .in('document_id', docIds)
          .eq('is_current', true);

        for (const v of (versions || [])) {
          versionMap.set(v.document_id, { chars: (v.plaintext || '').trim().length, approval_status: v.approval_status });
        }
      }

      return SEED_DOC_TYPES.map(dt => {
        const docId = docMap.get(dt) || null;
        if (!docId) return { doc_type: dt, doc_id: null, has_current_version: false, char_count: 0, approval_status: null, status: 'missing' as const };
        const info = versionMap.get(docId);
        if (!info) return { doc_type: dt, doc_id: docId, has_current_version: false, char_count: 0, approval_status: null, status: 'missing' as const };
        if (info.chars < MIN_SEED_CHARS) return { doc_type: dt, doc_id: docId, has_current_version: true, char_count: info.chars, approval_status: info.approval_status, status: 'short' as const };
        return { doc_type: dt, doc_id: docId, has_current_version: true, char_count: info.chars, approval_status: info.approval_status, status: 'present' as const };
      });
    },
    enabled: !!projectId,
    staleTime: 5_000,
  });

  const docs = data || SEED_DOC_TYPES.map(dt => ({ doc_type: dt, doc_id: null, has_current_version: false, char_count: 0, approval_status: null, status: 'missing' as const }));
  const presentCount = docs.filter(d => d.status === 'present').length;
  const warningCount = docs.filter(d => d.status === 'short').length;
  const missingCount = docs.filter(d => d.status === 'missing').length;
  const allApproved = missingCount === 0 && docs.every(d => d.approval_status === 'approved');

  return {
    docs,
    presentCount,
    warningCount,
    missingCount,
    allPresent: missingCount === 0,
    allApproved,
    isLoading,
  };
}

/**
 * BgGenBanner — wraps SeasonScriptProgress, SectionedDocProgress, or SceneIndexedProgress
 * in an error boundary.
 * Routes to the appropriate progress component based on:
 *  1. Doc type (episodic → SeasonScriptProgress)
 *  2. Detected chunk strategy from chunk keys (scene_indexed → SceneIndexedProgress)
 *  3. Fallback: sectioned prose docs → SectionedDocProgress
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SeasonScriptProgress } from './SeasonScriptProgress';
import { SectionedDocProgress } from './SectionedDocProgress';
import { SceneIndexedProgress } from './SceneIndexedProgress';

const SECTIONED_PROSE_TYPES = new Set([
  'story_outline', 'treatment', 'long_treatment', 'beat_sheet',
  'feature_script', 'screenplay_draft', 'production_draft', 'character_bible', 'long_character_bible',
]);

/** Detect generation strategy from the first few chunk keys */
const SCENE_INDEXED_KEY_RE = /^SC\d+-SC\d+$/;

type DetectedStrategy = 'scene_indexed' | 'sectioned' | 'unknown';

function detectStrategyFromChunks(chunks: Array<{ chunk_key: string }>): DetectedStrategy {
  if (!chunks || chunks.length === 0) return 'unknown';
  // If any chunk key matches scene_indexed pattern, it's scene_indexed
  const hasSceneKeys = chunks.some(c => SCENE_INDEXED_KEY_RE.test(c.chunk_key));
  if (hasSceneKeys) return 'scene_indexed';
  return 'sectioned';
}

interface BgGenBannerProps {
  versionId: string;
  episodeCount?: number;
  docType?: string;
  projectId?: string;
  documentId?: string;
}

interface State { hasError: boolean }

class BgGenBannerErrorBoundary extends React.Component<
  BgGenBannerProps & { children: React.ReactNode },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-[300px] gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating in background — refresh when complete.
        </div>
      );
    }
    return this.props.children;
  }
}

function BgGenBannerInner({ versionId, episodeCount, docType, projectId, documentId }: BgGenBannerProps) {
  const isSectioned = docType && SECTIONED_PROSE_TYPES.has(docType);

  // For sectioned prose types, detect actual strategy from chunk keys
  // to distinguish scene_indexed (scene batches) from act-based sectioned
  const { data: detectedStrategy = 'unknown' } = useQuery<DetectedStrategy>({
    queryKey: ['bg-gen-strategy-detect', versionId],
    queryFn: async () => {
      if (!versionId) return 'unknown';
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('chunk_key')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true })
        .limit(3);
      if (error || !data) return 'unknown';
      return detectStrategyFromChunks(data);
    },
    enabled: !!versionId && !!isSectioned,
    staleTime: 30000,
  });

  // Episodic doc types (season_script etc.) → episode progress
  if (!isSectioned) {
    return <SeasonScriptProgress versionId={versionId} episodeCount={episodeCount} />;
  }

  // Scene-indexed screenplay docs → scene batch progress
  if (detectedStrategy === 'scene_indexed') {
    return <SceneIndexedProgress versionId={versionId} docType={docType} />;
  }

  // Default: act-based sectioned progress (story_outline, treatment, etc.)
  return <SectionedDocProgress versionId={versionId} docType={docType!} projectId={projectId} documentId={documentId} />;
}

export function BgGenBanner({ versionId, episodeCount, docType, projectId, documentId }: BgGenBannerProps) {
  return (
    <BgGenBannerErrorBoundary versionId={versionId} episodeCount={episodeCount} docType={docType}>
      <BgGenBannerInner
        versionId={versionId}
        episodeCount={episodeCount}
        docType={docType}
        projectId={projectId}
        documentId={documentId}
      />
    </BgGenBannerErrorBoundary>
  );
}

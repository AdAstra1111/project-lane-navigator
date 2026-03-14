/**
 * BgGenBanner — wraps SeasonScriptProgress or SectionedDocProgress in an error boundary.
 * Routes to the appropriate progress component based on doc type.
 * Falls back to a simple spinner on error.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { SeasonScriptProgress } from './SeasonScriptProgress';
import { SectionedDocProgress } from './SectionedDocProgress';

const SECTIONED_PROSE_TYPES = new Set([
  'story_outline', 'treatment', 'long_treatment', 'beat_sheet',
  'feature_script', 'screenplay_draft', 'character_bible', 'long_character_bible',
]);

interface BgGenBannerProps {
  versionId: string;
  episodeCount?: number;
  docType?: string;
  onAllChunksDone?: (assembledContent: string) => void;
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

export function BgGenBanner({ versionId, episodeCount, docType }: BgGenBannerProps) {
  const isSectioned = docType && SECTIONED_PROSE_TYPES.has(docType);

  return (
    <BgGenBannerErrorBoundary versionId={versionId} episodeCount={episodeCount} docType={docType}>
      {isSectioned ? (
        <SectionedDocProgress versionId={versionId} docType={docType} />
      ) : (
        <SeasonScriptProgress versionId={versionId} episodeCount={episodeCount} />
      )}
    </BgGenBannerErrorBoundary>
  );
}

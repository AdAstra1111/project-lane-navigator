/**
 * BgGenBanner — wraps SeasonScriptProgress in an error boundary.
 * If SeasonScriptProgress throws for any reason, falls back to a simple spinner.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { SeasonScriptProgress } from './SeasonScriptProgress';

interface BgGenBannerProps {
  versionId: string;
  episodeCount?: number;
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

export function BgGenBanner({ versionId, episodeCount }: BgGenBannerProps) {
  return (
    <BgGenBannerErrorBoundary versionId={versionId} episodeCount={episodeCount}>
      <SeasonScriptProgress versionId={versionId} episodeCount={episodeCount} />
    </BgGenBannerErrorBoundary>
  );
}

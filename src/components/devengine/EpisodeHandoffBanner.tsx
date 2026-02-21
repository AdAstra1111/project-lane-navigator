/**
 * EpisodeHandoffBanner — Displayed in Dev Engine when the current document
 * is linked to a Series Writer episode handoff.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, FlaskConical, Loader2, XCircle } from 'lucide-react';

interface Version {
  id: string;
  version_number: number;
  change_summary: string | null;
  created_at: string;
}

interface Props {
  handoffId: string;
  episodeNumber: number;
  issueTitle?: string | null;
  versions: Version[];
  onReturn: (handoffId: string, versionId: string) => void;
  onCancel: (handoffId: string) => void;
  isReturning?: boolean;
  isCancelling?: boolean;
}

export function EpisodeHandoffBanner({
  handoffId, episodeNumber, issueTitle,
  versions, onReturn, onCancel,
  isReturning, isCancelling,
}: Props) {
  const latestVersion = versions[0];
  const [selectedVersionId, setSelectedVersionId] = useState(latestVersion?.id || '');

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-xs font-semibold text-blue-400">
          Episode {String(episodeNumber).padStart(2, '0')} — From Series Writer
        </span>
        {issueTitle && (
          <Badge variant="outline" className="text-[9px] border-blue-500/20 text-blue-400/80">
            {issueTitle}
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        This document is linked to Series Writer. When you're done, return the updated version.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {versions.length > 1 && (
          <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
            <SelectTrigger className="h-7 w-40 text-[10px]">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              {versions.map(v => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  v{v.version_number} — {v.change_summary?.slice(0, 30) || 'No summary'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
          onClick={() => onReturn(handoffId, selectedVersionId)}
          disabled={!selectedVersionId || isReturning}
        >
          {isReturning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowLeft className="h-3 w-3" />}
          Return to Series Writer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onCancel(handoffId)}
          disabled={isCancelling}
        >
          {isCancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
          Cancel Handoff
        </Button>
      </div>
    </div>
  );
}

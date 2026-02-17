import { Link2, AlertTriangle, RefreshCw, CheckCircle, ExternalLink, Hash, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface ProvenancePanelProps {
  docType: string;
  versionNumber: number | null;
  status: string | null;
  dependsOnHash: string | null;
  currentResolverHash: string | null;
  isStale: boolean;
  staleReason: string | null;
  inputsUsed: Record<string, { version_id: string; version_number: number }> | null;
  dependsOn: string[] | null;
  generatorId: string | null;
  resolvedQualifications: {
    season_episode_count?: number | null;
    episode_target_duration_seconds?: number | null;
    episode_target_duration_min_seconds?: number | null;
    episode_target_duration_max_seconds?: number | null;
    format?: string;
  } | null;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export function ProvenancePanel({
  docType,
  versionNumber,
  status,
  dependsOnHash,
  currentResolverHash,
  isStale,
  staleReason,
  inputsUsed,
  dependsOn,
  generatorId,
  resolvedQualifications,
  onRegenerate,
  isRegenerating,
}: ProvenancePanelProps) {
  const hashMatch = dependsOnHash && currentResolverHash
    ? dependsOnHash === currentResolverHash
    : null;

  const inputs = inputsUsed ? Object.entries(inputsUsed) : [];
  const deps = dependsOn || [];

  return (
    <div className="space-y-3 text-xs">
      {/* Staleness warning */}
      {isStale && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Document is stale</p>
            <p className="text-[10px] text-muted-foreground">{staleReason || 'Canonical qualifications have changed since generation.'}</p>
            {onRegenerate && (
              <Button size="sm" variant="outline" className="mt-1.5 h-6 text-[10px] gap-1" onClick={onRegenerate} disabled={isRegenerating}>
                <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                Regenerate
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Canonical qualifications */}
      {resolvedQualifications && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Canonical Qualifications</p>
          <div className="space-y-0.5 text-muted-foreground">
            {resolvedQualifications.format && (
              <p>Format: <span className="text-foreground">{resolvedQualifications.format}</span></p>
            )}
            {resolvedQualifications.season_episode_count != null && (
              <p>Episodes: <span className="text-foreground">{resolvedQualifications.season_episode_count}</span></p>
            )}
            {resolvedQualifications.episode_target_duration_min_seconds != null || resolvedQualifications.episode_target_duration_seconds != null ? (
              <p>Duration: <span className="text-foreground">
                {resolvedQualifications.episode_target_duration_min_seconds && resolvedQualifications.episode_target_duration_max_seconds && resolvedQualifications.episode_target_duration_min_seconds !== resolvedQualifications.episode_target_duration_max_seconds
                  ? `${resolvedQualifications.episode_target_duration_min_seconds}–${resolvedQualifications.episode_target_duration_max_seconds}s`
                  : `${resolvedQualifications.episode_target_duration_min_seconds || resolvedQualifications.episode_target_duration_seconds}s`}
              </span></p>
            ) : null}
            {currentResolverHash && (
              <p className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                <span className="text-foreground font-mono text-[9px]">{currentResolverHash}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <Separator />

      {/* This document */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">This Document</p>
        <div className="space-y-0.5 text-muted-foreground">
          <p>Type: <span className="text-foreground">{docType?.replace(/_/g, ' ')}</span></p>
          {versionNumber != null && <p>Version: <span className="text-foreground">v{versionNumber}</span></p>}
          <p className="flex items-center gap-1">
            Status:
            <Badge variant={status === 'final' ? 'default' : 'secondary'} className="text-[9px] h-4">
              {status || 'unknown'}
            </Badge>
          </p>
          {generatorId && <p>Generator: <span className="text-foreground font-mono text-[9px]">{generatorId}</span></p>}
          {dependsOnHash && (
            <p className="flex items-center gap-1">
              Generated under:
              <span className="font-mono text-[9px] text-foreground">{dependsOnHash}</span>
              {hashMatch === true && <CheckCircle className="h-3 w-3 text-primary" />}
              {hashMatch === false && <AlertTriangle className="h-3 w-3 text-destructive" />}
            </p>
          )}
        </div>
      </div>

      {/* Dependencies */}
      {deps.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Depends On</p>
            <div className="space-y-0.5">
              {deps.map(dep => (
                <p key={dep} className="text-muted-foreground flex items-center gap-1">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-[9px]">{dep}</span>
                </p>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Inputs used */}
      {inputs.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Inputs Used</p>
            <div className="space-y-0.5">
              {inputs.map(([docType, info]) => (
                <p key={docType} className="text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span>{docType.replace(/_/g, ' ')}</span>
                  <span className="text-foreground text-[9px]">v{info.version_number}</span>
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

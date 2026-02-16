import { useState } from 'react';
import { AlertTriangle, RefreshCw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ArtifactConflict {
  artifactName: string;
  artifactEpisodeCount: number;
  canonicalEpisodeCount: number;
}

interface Props {
  conflicts: ArtifactConflict[];
  onRegenerate: (artifactName: string) => void;
  onKeep: (artifactName: string) => void;
  onCreateDecision: (artifactName: string) => void;
  isRegenerating?: boolean;
}

export function QualificationConflictBanner({ conflicts, onRegenerate, onKeep, onCreateDecision, isRegenerating }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const activeConflicts = conflicts.filter(c => !dismissed.has(c.artifactName));
  if (activeConflicts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {activeConflicts.map(c => (
        <div key={c.artifactName} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-foreground">
              <strong>Conflict:</strong> {c.artifactName} references{' '}
              <Badge variant="outline" className="text-[9px] mx-0.5 bg-destructive/10 text-destructive">
                {c.artifactEpisodeCount} episodes
              </Badge>{' '}
              but canonical is{' '}
              <Badge variant="outline" className="text-[9px] mx-0.5 bg-primary/10 text-primary">
                {c.canonicalEpisodeCount} episodes
              </Badge>
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[9px] gap-0.5"
                onClick={() => onRegenerate(c.artifactName)}
                disabled={isRegenerating}
              >
                <RefreshCw className="h-2.5 w-2.5" /> Regenerate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9px] gap-0.5"
                onClick={() => {
                  onKeep(c.artifactName);
                  setDismissed(prev => new Set(prev).add(c.artifactName));
                }}
              >
                <Check className="h-2.5 w-2.5" /> Keep artifact
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9px] gap-0.5"
                onClick={() => onCreateDecision(c.artifactName)}
              >
                Create change decision
              </Button>
            </div>
          </div>
          <button
            onClick={() => setDismissed(prev => new Set(prev).add(c.artifactName))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

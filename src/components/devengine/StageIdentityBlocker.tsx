/**
 * StageIdentityBlocker — Prominent blocker panel shown when a document
 * fails stage identity validation. Shows violation details, explanation,
 * and repair/regenerate CTAs.
 */

import { AlertTriangle, RefreshCw, Minimize2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface StageIdentityBlockerProps {
  metaJson?: Record<string, any> | null;
  docType: string;
  onRegenerate?: () => void;
  onCompress?: () => void;
  regenerating?: boolean;
}

const VIOLATION_LABELS: Record<string, string> = {
  IDEA_STAGE_SHAPE_VIOLATION: 'Screenplay Formatting Detected',
  IDEA_TOO_EXPANDED: 'Over-Expanded for Idea Stage',
  IDEA_STAGE_IDENTITY_VIOLATION: 'Stage Identity Mismatch',
  CONCEPT_BRIEF_STAGE_SHAPE_VIOLATION: 'Screenplay Formatting in Concept Brief',
};

const VIOLATION_EXPLANATIONS: Record<string, string> = {
  IDEA_STAGE_SHAPE_VIOLATION:
    'This idea document contains screenplay formatting (scene headings, dialogue cues, V.O./O.S.) which is invalid for the idea stage. It must be regenerated as concise concept-stage prose.',
  IDEA_TOO_EXPANDED:
    'This idea document has expanded beyond idea-stage density and resembles a concept brief. It must be compressed or regenerated to stay within the idea stage boundary.',
  IDEA_STAGE_IDENTITY_VIOLATION:
    'This idea document structure does not match the idea stage contract. It needs to be regenerated with correct stage constraints.',
  CONCEPT_BRIEF_STAGE_SHAPE_VIOLATION:
    'This concept brief contains screenplay formatting which is invalid for the concept brief stage. It must be regenerated as structured development prose.',
};

export function StageIdentityBlocker({
  metaJson,
  docType,
  onRegenerate,
  onCompress,
  regenerating,
}: StageIdentityBlockerProps) {
  if (!metaJson?.stage_identity) return null;
  const si = metaJson.stage_identity;
  if (typeof si.passed !== 'boolean' || si.passed) return null;

  const violation = si.violation as string;
  const label = VIOLATION_LABELS[violation] || 'Stage Identity Violation';
  const explanation = VIOLATION_EXPLANATIONS[violation] || si.repair_hint || 'This document is invalid for its stage.';
  const isOverExpanded = violation === 'IDEA_TOO_EXPANDED';

  return (
    <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm text-destructive">Stage Identity Blocked</h4>
            <Badge variant="destructive" className="text-[10px]">{label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>

          {si.violations?.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-0.5">
              {si.violations.map((v: string, i: number) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <p className="text-[11px] text-muted-foreground flex-1">
          Review, scoring, convergence, and promotion are blocked until this is resolved.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {onRegenerate && (
          <Button
            size="sm"
            variant="destructive"
            onClick={onRegenerate}
            disabled={regenerating}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
            Regenerate as valid {docType}
          </Button>
        )}
        {isOverExpanded && onCompress && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCompress}
            disabled={regenerating}
            className="gap-1.5 text-xs"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            Compress to idea density
          </Button>
        )}
      </div>
    </div>
  );
}

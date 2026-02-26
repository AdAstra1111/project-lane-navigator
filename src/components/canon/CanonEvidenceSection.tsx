/**
 * CanonEvidenceSection — Collapsible section showing canon source attribution
 * and evidence (populated fields, active decisions). Used in DecisionModePanel
 * and CanonicalEditor to eliminate "phantom canon" confusion.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Info, ShieldCheck, FileText, AlertTriangle } from 'lucide-react';
import type { CanonSource, CanonEvidence } from '@/lib/canon/getCanonicalProjectState';

interface Props {
  source: CanonSource;
  sourceLabel: string;
  evidence: CanonEvidence | null;
  /** If true, shows a compact inline variant (for DecisionModePanel) */
  compact?: boolean;
  defaultOpen?: boolean;
}

const SOURCE_STYLES: Record<CanonSource, { bg: string; border: string; icon: string }> = {
  canon_editor: { bg: 'bg-primary/5', border: 'border-primary/20', icon: 'text-primary' },
  locked_facts: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', icon: 'text-amber-500' },
  doc_set: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', icon: 'text-blue-500' },
  unknown: { bg: 'bg-destructive/5', border: 'border-destructive/20', icon: 'text-destructive' },
};

export function CanonEvidenceSection({ source, sourceLabel, evidence, compact = false, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const style = SOURCE_STYLES[source];

  if (!evidence && source === 'unknown') {
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] border ${style.bg} ${style.border}`}>
        <AlertTriangle className={`h-2.5 w-2.5 shrink-0 ${style.icon}`} />
        <span>Canon: <strong>{sourceLabel}</strong> — engines will not assert canonical facts</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-[10px] border transition-colors hover:bg-muted/20 ${style.bg} ${style.border}`}>
        <Info className={`h-3 w-3 shrink-0 ${style.icon}`} />
        <span className="flex-1 text-left text-foreground">
          Canon: <strong>{sourceLabel}</strong>
          {evidence && source === 'canon_editor' && evidence.canon_editor_fields.length > 0 && (
            <span className="text-muted-foreground ml-1">
              ({evidence.canon_editor_fields.length} field{evidence.canon_editor_fields.length !== 1 ? 's' : ''})
            </span>
          )}
          {evidence && evidence.locked_decision_count > 0 && (
            <span className="text-muted-foreground ml-1">
              · {evidence.locked_decision_count} decision{evidence.locked_decision_count !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <ChevronDown className={`h-2.5 w-2.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>

      <CollapsibleContent className="px-2 pt-1.5 pb-2 space-y-1.5">
        {/* Populated canon fields */}
        {evidence?.canon_editor_populated && evidence.canon_editor_fields.length > 0 && (
          <div className="space-y-0.5">
            <span className="text-[9px] font-medium text-muted-foreground flex items-center gap-1">
              <FileText className="h-2.5 w-2.5" /> Populated Canon Fields
            </span>
            <div className="flex flex-wrap gap-1">
              {evidence.canon_editor_fields.map(f => (
                <Badge key={f} variant="outline" className="text-[8px] px-1.5 py-0 border-primary/30 text-primary bg-primary/5">
                  {f.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Active decisions */}
        {evidence && evidence.locked_decision_count > 0 && (
          <div className="space-y-0.5">
            <span className="text-[9px] font-medium text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-2.5 w-2.5" /> Active Decisions ({evidence.locked_decision_count})
            </span>
            <div className="text-[9px] text-muted-foreground space-y-0.5">
              {(evidence.locked_decision_titles || evidence.locked_decision_ids).slice(0, 5).map((label, i) => (
                <div key={evidence.locked_decision_ids[i] || i} className="truncate pl-1 border-l border-muted-foreground/20">
                  {label}
                </div>
              ))}
              {evidence.locked_decision_count > 5 && (
                <div className="pl-1 text-[8px] text-muted-foreground/60">
                  +{evidence.locked_decision_count - 5} more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty evidence */}
        {evidence && !evidence.canon_editor_populated && evidence.locked_decision_count === 0 && (
          <p className="text-[9px] text-muted-foreground italic">
            No canon fields or decisions found. Fill in the Canon Editor to establish ground truth.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

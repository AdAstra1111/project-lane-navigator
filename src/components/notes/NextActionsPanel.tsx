/**
 * NextActionsPanel — Shows top NOW notes for the current document context.
 * Algorithm: Pull open/reopened/needs_decision notes, filter timing=now, match docType,
 * sort blocker/high first, show top 5.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ProjectNote } from '@/lib/types/notes';

const SEVERITY_ORDER: Record<string, number> = { blocker: 0, high: 1, med: 2, low: 3 };
const SEVERITY_STYLES: Record<string, string> = {
  blocker: 'bg-destructive/20 text-destructive border-destructive/30',
  high: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  med: 'bg-muted/40 text-muted-foreground border-border/50',
  low: 'bg-muted/20 text-muted-foreground/70 border-border/30',
};

interface NextActionsPanelProps {
  notes: ProjectNote[];
  currentDocType?: string;
  currentDocumentId?: string;
  projectId: string;
  onOpenNote?: (note: ProjectNote) => void;
  maxItems?: number;
}

export function NextActionsPanel({
  notes, currentDocType, currentDocumentId, projectId, onOpenNote, maxItems = 5,
}: NextActionsPanelProps) {
  const actionNotes = useMemo(() => {
    const active = notes.filter(n =>
      ['open', 'reopened', 'needs_decision', 'in_progress'].includes(n.status) &&
      n.timing === 'now'
    );
    // Filter by current doc type if provided
    const contextual = currentDocType
      ? active.filter(n => !n.doc_type || n.doc_type === currentDocType)
      : active;
    // Sort by severity
    return contextual.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    ).slice(0, maxItems);
  }, [notes, currentDocType, maxItems]);

  if (actionNotes.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-primary" />
          Next Actions
          <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1">{actionNotes.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2 space-y-1">
        {actionNotes.map(note => (
          <button key={note.id}
            className="w-full text-left rounded border border-border/40 p-2 hover:border-border/70 transition-colors"
            onClick={() => onOpenNote?.(note)}>
            <div className="flex items-center gap-1 mb-0.5">
              <Badge variant="outline" className={`text-[7px] px-1 py-0 ${SEVERITY_STYLES[note.severity] || ''}`}>
                {note.severity}
              </Badge>
              <Badge variant="outline" className="text-[7px] px-1 py-0">{note.category}</Badge>
            </div>
            <p className="text-[10px] text-foreground truncate">{note.title}</p>
          </button>
        ))}
        <Link to={`/projects/${projectId}/notes`}>
          <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-1 w-full mt-1">
            View all <ExternalLink className="h-2.5 w-2.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

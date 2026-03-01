/**
 * ContextCards — compact visual cards for supporting documents in Writers' Room.
 * Uses only existing stored metadata (no extra LLM passes).
 * Ordering is deterministic: follows includeDocumentIds order.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Film, BookOpen, FileEdit, Scroll, File } from 'lucide-react';
import type { ProjectDocInfo } from '@/hooks/useNoteWritersRoom';

/* ── Types ── */

export interface ContextCardData {
  id: string;
  title: string;
  docType: string;
  typeBadge: string;
  summary: string | null;
  onClick?: () => void;
}

/* ── Pure helpers (exported for tests) ── */

const DOC_TYPE_LABELS: Record<string, string> = {
  screenplay_draft: 'Script',
  production_draft: 'Production Draft',
  feature_script: 'Script',
  script_pdf: 'Script',
  trailer_script: 'Trailer Script',
  treatment: 'Treatment',
  pitch_deck: 'Pitch Deck',
  character_bible: 'Character Bible',
  blueprint: 'Blueprint',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  episode_script: 'Episode Script',
  season_script: 'Season Script',
  script_coverage: 'Coverage',
  brief: 'Brief',
  notes: 'Notes',
  document: 'Document',
};

const DOC_TYPE_ICONS: Record<string, typeof FileText> = {
  screenplay_draft: Film,
  production_draft: Film,
  feature_script: Film,
  script_pdf: Film,
  treatment: BookOpen,
  character_bible: Scroll,
  blueprint: FileEdit,
  notes: FileText,
};

export function getDocTypeBadge(docType: string): string {
  return DOC_TYPE_LABELS[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * buildContextCardsData — assemble card data from project docs and includeDocumentIds.
 * Ordering is strictly by includeDocumentIds order (deterministic).
 * Documents not found in projectDocs are silently skipped.
 */
export function buildContextCardsData(
  projectDocs: Array<{ id: string; title?: string; doc_type?: string; file_name?: string }>,
  includeDocumentIds: string[]
): ContextCardData[] {
  const docMap = new Map(projectDocs.map(d => [d.id, d]));

  return includeDocumentIds
    .map(id => {
      const doc = docMap.get(id);
      if (!doc) return null;
      const docType = doc.doc_type || 'document';
      return {
        id: doc.id,
        title: doc.title || doc.file_name || 'Untitled',
        docType,
        typeBadge: getDocTypeBadge(docType),
        summary: null as string | null, // Only populate from existing stored fields
      };
    })
    .filter((c): c is ContextCardData => c !== null);
}

/* ── Component ── */

interface ContextCardsProps {
  projectDocs: Array<{ id: string; title?: string; doc_type?: string; file_name?: string }>;
  includeDocumentIds: string[];
  onCardClick?: (docId: string) => void;
}

export function ContextCards({ projectDocs, includeDocumentIds, onCardClick }: ContextCardsProps) {
  if (!includeDocumentIds || includeDocumentIds.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic">
        No supporting documents selected
      </div>
    );
  }

  const cards = buildContextCardsData(projectDocs, includeDocumentIds);

  if (cards.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic">
        No supporting documents selected
      </div>
    );
  }

  return (
    <div className="space-y-1.5 px-1">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2">
        Context Documents
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {cards.map(card => {
          const IconComponent = DOC_TYPE_ICONS[card.docType] || File;
          return (
            <Card
              key={card.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors border-border/50"
              onClick={() => onCardClick?.(card.id)}
            >
              <CardContent className="p-2 flex items-center gap-2">
                <IconComponent className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{card.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {card.summary || 'No summary available'}
                  </div>
                </div>
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 shrink-0">
                  {card.typeBadge}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

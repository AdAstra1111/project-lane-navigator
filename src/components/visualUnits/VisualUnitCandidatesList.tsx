import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { VisualUnitCandidate } from '@/lib/types/visualUnits';

interface Props {
  candidates: VisualUnitCandidate[];
  isLoading: boolean;
  onSelect: (c: VisualUnitCandidate) => void;
}

const statusColors: Record<string, string> = {
  proposed: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
  modified: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  superseded: 'bg-muted text-muted-foreground',
};

export function VisualUnitCandidatesList({ candidates, isLoading, onSelect }: Props) {
  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (candidates.length === 0) {
    return <p className="text-[10px] text-muted-foreground text-center py-8 px-3">No candidates. Select a run or create one.</p>;
  }

  return (
    <ScrollArea className="h-[65vh]">
      <div className="space-y-1 px-3 pb-3">
        {candidates.map(c => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="w-full text-left p-3 rounded border border-border hover:border-primary/30 transition-colors space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-muted-foreground truncate">{c.unit_key}</span>
              <Badge variant="outline" className={`text-[7px] shrink-0 ${statusColors[c.status] || ''}`}>
                {c.status}
              </Badge>
            </div>
            <p className="text-xs line-clamp-2">{c.candidate_payload?.logline}</p>
            <div className="flex gap-2 text-[9px] text-muted-foreground">
              <span>🎬 {c.scores?.trailer_value || 0}</span>
              <span>🖼 {c.scores?.storyboard_value || 0}</span>
              <span>📊 {c.scores?.pitch_value || 0}</span>
              <span>⚙️ {c.scores?.complexity || 0}</span>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

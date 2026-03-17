import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search } from 'lucide-react';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { useSimilarExemplars } from '@/hooks/useExemplarIdeas';
import { ExemplarCard } from './ExemplarCard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceIdea: PitchIdea | null;
  onCompare?: (exemplar: PitchIdea) => void;
  onOpen?: (idea: PitchIdea) => void;
}

export function SimilarExemplarsDrawer({ open, onOpenChange, sourceIdea, onCompare, onOpen }: Props) {
  const { data: similar = [], isLoading } = useSimilarExemplars(open ? sourceIdea : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-lg flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Similar Exemplars
          </SheetTitle>
          {sourceIdea && (
            <p className="text-xs text-muted-foreground">
              Finding top ideas similar to <span className="font-medium text-foreground">{sourceIdea.title}</span>
            </p>
          )}
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : similar.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No similar exemplars found. This idea may be uniquely positioned.
            </div>
          ) : (
            <div className="space-y-3 pb-8">
              {similar.map(idea => (
                <ExemplarCard
                  key={idea.id}
                  idea={idea}
                  showSimilarity
                  onCompare={onCompare}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

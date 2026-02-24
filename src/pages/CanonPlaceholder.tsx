import { BookOpen } from 'lucide-react';

export default function CanonPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <div className="h-14 w-14 rounded-xl bg-muted/50 flex items-center justify-center mb-6">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-display font-semibold text-foreground mb-2">
        Project Canon
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        The canonical source of truth for this project — characters, world rules, timeline, and format constraints. Coming soon to this workspace.
      </p>
    </div>
  );
}

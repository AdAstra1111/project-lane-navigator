import { Search } from 'lucide-react';

/**
 * Trigger button for the unified CommandPalette.
 * The actual search UI lives in CommandPalette.tsx (mounted globally in App.tsx).
 */
export function GlobalSearch() {
  const handleClick = () => {
    window.dispatchEvent(new Event('open-command-palette'));
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search…</span>
      <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  );
}

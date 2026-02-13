import { useState } from 'react';
import { ChevronDown, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ScriptCharacter } from '@/hooks/useScriptCharacters';

interface Props {
  characters: ScriptCharacter[];
  selected: ScriptCharacter | null;
  onSelect: (character: ScriptCharacter | null) => void;
  loading?: boolean;
}

export function CharacterSelector({ characters, selected, onSelect, loading }: Props) {
  const [open, setOpen] = useState(false);

  if (characters.length === 0 && !loading) return null;

  const sorted = [...characters].sort((a, b) => (b.scene_count || 0) - (a.scene_count || 0));

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={selected ? 'default' : 'outline'}
            className="h-7 text-xs gap-1.5"
            disabled={loading}
          >
            <User className="h-3 w-3" />
            {selected ? `For: ${selected.name}` : 'Cast for role…'}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2 max-h-64 overflow-y-auto" align="start">
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            General suggestions (no specific role)
          </button>
          {sorted.map((c) => (
            <button
              key={c.name}
              onClick={() => { onSelect(c); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                selected?.name === c.name ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{c.name}</span>
                {c.gender && c.gender !== 'unknown' && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 capitalize">
                    {c.gender}
                  </Badge>
                )}
                {c.scene_count && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                    {c.scene_count} scenes
                  </Badge>
                )}
              </div>
              {c.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>
              )}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {selected && (
        <button
          onClick={() => onSelect(null)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

import { useUIMode } from '@/hooks/useUIMode';
import { MODES } from '@/lib/mode';
import { Layers, Layers2 } from 'lucide-react';

export function ModeToggle() {
  const { mode, setMode, loading } = useUIMode();

  return (
    <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5">
      {MODES.map((m) => {
        const active = mode === m.value;
        const Icon = m.value === 'simple' ? Layers : Layers2;
        return (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            disabled={loading}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-pressed={active}
          >
            <Icon className="h-3 w-3" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

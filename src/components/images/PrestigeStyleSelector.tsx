/**
 * PrestigeStyleSelector — UI component for selecting a prestige style overlay.
 * Shows style swatches with labels and descriptions.
 */
import { cn } from '@/lib/utils';
import { Check, Palette } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  PRESTIGE_STYLES,
  PRESTIGE_STYLE_KEYS,
  type PrestigeStyleKey,
} from '@/lib/images/prestigeStyleRegistry';

interface PrestigeStyleSelectorProps {
  selectedStyle: string;
  onStyleChange: (styleKey: string) => void;
  /** Compact mode for inline toolbar */
  compact?: boolean;
  className?: string;
}

export function PrestigeStyleSelector({
  selectedStyle,
  onStyleChange,
  compact = false,
  className,
}: PrestigeStyleSelectorProps) {
  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
        <Palette className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {PRESTIGE_STYLE_KEYS.map((key) => {
          const style = PRESTIGE_STYLES[key];
          const isActive = selectedStyle === key;
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onStyleChange(key)}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-all duration-200',
                    isActive
                      ? 'border-primary ring-2 ring-primary/30 scale-110'
                      : 'border-muted hover:border-muted-foreground/50 hover:scale-105',
                  )}
                  style={{ backgroundColor: `hsl(${style.swatchHsl})` }}
                  aria-label={style.label}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[200px]">
                <p className="font-medium text-xs">{style.label}</p>
                <p className="text-[10px] text-muted-foreground">{style.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-3', className)}>
      {PRESTIGE_STYLE_KEYS.map((key) => {
        const style = PRESTIGE_STYLES[key];
        const isActive = selectedStyle === key;
        return (
          <button
            key={key}
            onClick={() => onStyleChange(key)}
            className={cn(
              'relative rounded-lg border p-3 text-left transition-all duration-200',
              isActive
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
            )}
          >
            {isActive && (
              <div className="absolute top-2 right-2">
                <Check className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="h-4 w-4 rounded-full shrink-0"
                style={{ backgroundColor: `hsl(${style.swatchHsl})` }}
              />
              <span className="text-sm font-medium text-foreground truncate">
                {style.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">
              {style.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/** Simple badge showing the active style */
export function PrestigeStyleBadge({
  styleKey,
  className,
}: {
  styleKey: string;
  className?: string;
}) {
  const style = PRESTIGE_STYLES[styleKey as PrestigeStyleKey];
  if (!style) return null;

  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] gap-1 font-normal', className)}
    >
      <span
        className="h-2 w-2 rounded-full inline-block"
        style={{ backgroundColor: `hsl(${style.swatchHsl})` }}
      />
      {style.label}
    </Badge>
  );
}

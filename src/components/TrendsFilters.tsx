import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface TrendsFiltersProps {
  filters: Record<string, string>;
  filterConfigs: FilterConfig[];
  onFilterChange: (key: string, value: string | undefined) => void;
  onReset: () => void;
}

export function TrendsFilters({ filters, filterConfigs, onFilterChange, onReset }: TrendsFiltersProps) {
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filterConfigs.map(config => (
          <Select
            key={config.key}
            value={filters[config.key] || ''}
            onValueChange={v => onFilterChange(config.key, v || undefined)}
          >
            <SelectTrigger className="w-[150px] h-8 text-xs bg-muted/50 border-border/50">
              <SelectValue placeholder={config.label} />
            </SelectTrigger>
            <SelectContent>
              {config.options.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={onReset}>
            <X className="h-3 w-3" />
            Clear ({activeCount})
          </Button>
        )}
      </div>
    </div>
  );
}

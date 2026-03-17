import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { ExemplarFilters } from '@/hooks/useExemplarIdeas';

const CI_THRESHOLDS = [
  { value: '100', label: 'CI = 100' },
  { value: '95', label: 'CI ≥ 95' },
  { value: '90', label: 'CI ≥ 90' },
  { value: '80', label: 'CI ≥ 80' },
];

const SORT_OPTIONS = [
  { value: 'ci_desc', label: 'CI Score ↓' },
  { value: 'gp_desc', label: 'Feasibility ↓' },
  { value: 'newest', label: 'Newest' },
];

interface Props {
  filters: ExemplarFilters;
  onChange: (filters: ExemplarFilters) => void;
  resultCount: number;
}

export function ExemplarFiltersBar({ filters, onChange, resultCount }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = (patch: Partial<ExemplarFilters>) => onChange({ ...filters, ...patch });
  const clear = () => onChange({ ciMin: 95, sortBy: 'ci_desc' });
  const hasFilters = !!(filters.search || filters.format || filters.lane || filters.genre || filters.engine || filters.budgetBand || filters.approvedOnly);

  return (
    <div className="space-y-3">
      {/* Primary row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search exemplars by title or logline…"
            value={filters.search || ''}
            onChange={e => set({ search: e.target.value })}
          />
        </div>

        {/* CI threshold */}
        <Select value={String(filters.ciMin ?? 95)} onValueChange={v => set({ ciMin: Number(v) })}>
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CI_THRESHOLDS.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={filters.sortBy || 'ci_desc'} onValueChange={v => set({ sortBy: v as any })}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Approved-only toggle */}
        <Badge
          variant={filters.approvedOnly ? 'default' : 'outline'}
          className="cursor-pointer h-9 px-3 flex items-center"
          onClick={() => set({ approvedOnly: !filters.approvedOnly })}
        >
          Manual Exemplar
        </Badge>

        {/* Learning-pool toggle */}
        <Badge
          variant={filters.learningPoolOnly ? 'default' : 'outline'}
          className="cursor-pointer h-9 px-3 flex items-center"
          onClick={() => set({ learningPoolOnly: !filters.learningPoolOnly })}
        >
          🎯 Learning Pool
        </Badge>

        {/* Advanced toggle */}
        <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => setShowAdvanced(!showAdvanced)}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 gap-1 text-destructive" onClick={clear}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {resultCount} result{resultCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Advanced filters row */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-2 pl-1">
          <Input
            className="h-8 w-32 text-xs"
            placeholder="Format…"
            value={filters.format || ''}
            onChange={e => set({ format: e.target.value || undefined })}
          />
          <Input
            className="h-8 w-32 text-xs"
            placeholder="Lane…"
            value={filters.lane || ''}
            onChange={e => set({ lane: e.target.value || undefined })}
          />
          <Input
            className="h-8 w-32 text-xs"
            placeholder="Genre…"
            value={filters.genre || ''}
            onChange={e => set({ genre: e.target.value || undefined })}
          />
          <Input
            className="h-8 w-32 text-xs"
            placeholder="Engine…"
            value={filters.engine || ''}
            onChange={e => set({ engine: e.target.value || undefined })}
          />
          <Input
            className="h-8 w-32 text-xs"
            placeholder="Budget…"
            value={filters.budgetBand || ''}
            onChange={e => set({ budgetBand: e.target.value || undefined })}
          />
        </div>
      )}
    </div>
  );
}

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Activity, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCorpusHealth } from '@/hooks/useCorpusInsights';

export function CorpusHealthDashboard() {
  const { data: scripts = [], isLoading } = useCorpusHealth();

  const stats = useMemo(() => {
    if (!scripts.length) return null;
    const total = scripts.length;
    const truncated = scripts.filter((s: any) => s.is_truncated);
    const healthy = scripts.filter((s: any) => !s.is_truncated);

    // Avg word_count per production_type
    const byType: Record<string, { words: number[]; pages: number[] }> = {};
    for (const s of scripts) {
      const pt = (s as any).production_type || 'unknown';
      if (!byType[pt]) byType[pt] = { words: [], pages: [] };
      if ((s as any).word_count) byType[pt].words.push((s as any).word_count);
      const pc = (s as any).page_count || (s as any).page_count_estimate;
      if (pc) byType[pt].pages.push(pc);
    }

    const formatStats = Object.entries(byType).map(([type, { words, pages }]) => ({
      type,
      count: words.length || pages.length,
      avgWordCount: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0,
      medianPageCount: pages.length
        ? (() => { const sorted = [...pages].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]; })()
        : 0,
    }));

    return { total, truncatedCount: truncated.length, healthyCount: healthy.length, truncatedScripts: truncated, formatStats };
  }, [scripts]);

  if (isLoading) return <div className="text-sm text-muted-foreground py-4 text-center">Loading corpus health…</div>;
  if (!stats) return <div className="text-sm text-muted-foreground py-4 text-center">No corpus scripts found.</div>;

  const healthPct = Math.round((stats.healthyCount / stats.total) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Corpus Health</h3>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Total Scripts</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Healthy (Full Text)</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.healthyCount}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Truncated</p>
          <p className="text-2xl font-bold text-amber-400">{stats.truncatedCount}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Health Score</p>
          <p className={`text-2xl font-bold ${healthPct >= 80 ? 'text-emerald-400' : healthPct >= 50 ? 'text-amber-400' : 'text-destructive'}`}>
            {healthPct}%
          </p>
        </div>
      </div>

      {/* Format Stats */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <h4 className="text-xs font-semibold text-muted-foreground mb-3">Metrics by Format</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Format</TableHead>
              <TableHead>Scripts</TableHead>
              <TableHead>Avg Words</TableHead>
              <TableHead>Median Pages</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.formatStats.map(f => (
              <TableRow key={f.type}>
                <TableCell className="font-medium capitalize">{f.type}</TableCell>
                <TableCell>{f.count}</TableCell>
                <TableCell>
                  <span className={f.avgWordCount < 12000 ? 'text-amber-400' : 'text-foreground'}>
                    {f.avgWordCount.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={f.medianPageCount < 70 ? 'text-amber-400' : 'text-foreground'}>
                    {f.medianPageCount}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Truncated Scripts List */}
      {stats.truncatedCount > 0 && (
        <div className="border border-amber-500/30 rounded-lg p-4 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-semibold text-amber-300">Truncated Scripts — Need Re-upload</h4>
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {stats.truncatedScripts.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                  <span className="text-foreground">{s.title || s.approved_sources?.title || '(untitled)'}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{((s.word_count || 0)).toLocaleString()} words</span>
                  <Badge variant="outline" className="text-[9px]">{s.ingestion_source || 'unknown'}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Activity, FileText, Upload, Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCorpusHealth, useReingestScript } from '@/hooks/useCorpusInsights';
import { toast } from 'sonner';

export function CorpusHealthDashboard() {
  const { data: scripts = [], isLoading } = useCorpusHealth();
  const reingest = useReingestScript();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!scripts.length) return null;
    const total = scripts.length;
    const truncated = scripts.filter((s: any) => s.is_truncated);
    const healthy = scripts.filter((s: any) => !s.is_truncated);

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

    // Top 10 worst by word_count
    const top10Worst = [...truncated]
      .sort((a: any, b: any) => (a.word_count || 0) - (b.word_count || 0))
      .slice(0, 10);

    return { total, truncatedCount: truncated.length, healthyCount: healthy.length, truncatedScripts: truncated, formatStats, top10Worst };
  }, [scripts]);

  const handleReplace = (scriptId: string) => {
    setReplacingId(scriptId);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingId) { setReplacingId(null); return; }

    const fileType = file.name.endsWith('.fdx') ? 'fdx' : file.name.endsWith('.pdf') ? 'pdf' : 'txt';

    try {
      let fileContent: string;
      if (fileType === 'pdf') {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer.slice(0, 4_000_000));
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
        }
        fileContent = btoa(binary);
      } else {
        fileContent = await file.text();
      }

      await reingest.mutateAsync({ scriptId: replacingId, fileContent, fileName: file.name, fileType });
    } catch {
      // error handled by mutation
    } finally {
      setReplacingId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportCSV = () => {
    if (!stats) return;
    const rows = stats.truncatedScripts.map((s: any) => ({
      title: s.title || s.approved_sources?.title || '(untitled)',
      ingestion_source: s.ingestion_source || 'unknown',
      word_count: s.word_count || 0,
      truncation_reason: s.truncation_reason || '',
    }));
    const header = 'Title,Source,Word Count,Truncation Reason\n';
    const csv = header + rows.map(r =>
      `"${r.title}","${r.ingestion_source}",${r.word_count},"${r.truncation_reason}"`
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'corpus_reupload_list.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported reupload list');
  };

  if (isLoading) return <div className="text-sm text-muted-foreground py-4 text-center">Loading corpus health…</div>;
  if (!stats) return <div className="text-sm text-muted-foreground py-4 text-center">No corpus scripts found.</div>;

  const healthPct = Math.round((stats.healthyCount / stats.total) * 100);

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept=".pdf,.fdx,.txt,.fountain" className="hidden" onChange={handleFileSelected} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Corpus Health</h3>
        </div>
        {stats.truncatedCount > 0 && (
          <Button size="sm" variant="outline" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export Reupload List
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Total Scripts</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Healthy (Full Text)</p>
          <p className="text-2xl font-bold text-foreground">{stats.healthyCount}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Truncated</p>
          <p className="text-2xl font-bold text-foreground">{stats.truncatedCount}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card">
          <p className="text-xs text-muted-foreground">Health Score</p>
          <p className={`text-2xl font-bold ${healthPct >= 80 ? 'text-primary' : 'text-destructive'}`}>
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
                  <span className={f.avgWordCount < 12000 ? 'text-destructive' : 'text-foreground'}>
                    {f.avgWordCount.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={f.medianPageCount < 70 ? 'text-destructive' : 'text-foreground'}>
                    {f.medianPageCount}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Top 10 Worst — Priority Reuploads */}
      {stats.top10Worst.length > 0 && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h4 className="text-xs font-semibold text-muted-foreground">Top 10 Priority Reuploads (Lowest Word Count)</h4>
          </div>
          <div className="space-y-1">
            {stats.top10Worst.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/20 last:border-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-foreground truncate">{s.title || s.approved_sources?.title || '(untitled)'}</span>
                  <span className="text-muted-foreground shrink-0">{((s.word_count || 0)).toLocaleString()} words</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs ml-2 shrink-0"
                  onClick={() => handleReplace(s.id)}
                  disabled={reingest.isPending && replacingId === s.id}
                >
                  {reingest.isPending && replacingId === s.id
                    ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    : <Upload className="w-3 h-3 mr-1" />}
                  Replace
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Truncated Scripts */}
      {stats.truncatedCount > 10 && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3">All Truncated Scripts ({stats.truncatedCount})</h4>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {stats.truncatedScripts.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-foreground truncate">{s.title || s.approved_sources?.title || '(untitled)'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground">{((s.word_count || 0)).toLocaleString()} words</span>
                  <Badge variant="outline" className="text-[9px]">{s.ingestion_source || 'unknown'}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-6 px-2"
                    onClick={() => handleReplace(s.id)}
                    disabled={reingest.isPending && replacingId === s.id}
                  >
                    {reingest.isPending && replacingId === s.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Upload className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

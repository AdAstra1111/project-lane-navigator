import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { TrendsPageShell } from '@/components/trends/TrendsPageShell';

interface CoverageData {
  ok: boolean;
  trend_signals: { by_type: { production_type: string; count: number }[]; total: number };
  cast_trends: { by_type: { production_type: string; count: number }[]; total: number };
  missing_required: { trend_signals: string[]; cast_trends: string[] };
  required_types: string[];
  is_admin: boolean;
  ts: string;
}

export default function TrendsCoverage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const { toast } = useToast();

  const fetchCoverage = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trends-coverage-audit`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({}) }
      );
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      toast({ title: 'Failed to load coverage', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCoverage(); }, []);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      for (const type of data?.required_types || []) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-trends`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ production_type: type, scope: 'one' }),
        });
      }
      toast({ title: 'Refresh complete', description: 'All required types refreshed.' });
      await fetchCoverage();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-trends-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      toast({ title: 'Backfill complete', description: `Attempted: ${result.attempted?.join(', ') || 'none'}` });
      await fetchCoverage();
    } catch (e: any) {
      toast({ title: 'Backfill failed', description: e.message, variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  const hasMissing = data && (data.missing_required.trend_signals.length > 0 || data.missing_required.cast_trends.length > 0);

  return (
    <TrendsPageShell
      badge="Admin"
      title="Trends Coverage"
      subtitle="Audit production_type coverage across trend_signals and cast_trends."
      rightSlot={
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={refreshing} className="h-8 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh All'}
          </Button>
          {hasMissing && (
            <Button size="sm" onClick={handleBackfill} disabled={backfilling} className="h-8 text-xs">
              <Zap className={`h-3.5 w-3.5 mr-1 ${backfilling ? 'animate-pulse' : ''}`} />
              {backfilling ? 'Backfilling…' : 'Backfill Missing'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={fetchCoverage} disabled={loading} className="h-8 text-xs">Reload</Button>
        </div>
      }
    >
      {/* Missing alert */}
      {hasMissing && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Missing Required Coverage
          </div>
          {data!.missing_required.trend_signals.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">trend_signals: </span>
              {data!.missing_required.trend_signals.map(t => (
                <Badge key={t} variant="destructive" className="text-[10px] mr-1">{t}</Badge>
              ))}
            </div>
          )}
          {data!.missing_required.cast_trends.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">cast_trends: </span>
              {data!.missing_required.cast_trends.map(t => (
                <Badge key={t} variant="destructive" className="text-[10px] mr-1">{t}</Badge>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground border-t border-destructive/20 pt-2">
            Missing types won't appear in <Link to="/trends/explorer" className="text-primary hover:underline">Trends Explorer</Link> until backfilled.
          </p>
        </div>
      )}

      {!hasMissing && data && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-border/30 px-3 py-2 bg-muted/20">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          All required types have coverage.
        </div>
      )}

      {/* Coverage tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CoverageTable title="trend_signals" loading={loading} rows={data?.trend_signals.by_type || []} total={data?.trend_signals.total || 0} />
        <CoverageTable title="cast_trends" loading={loading} rows={data?.cast_trends.by_type || []} total={data?.cast_trends.total || 0} />
      </div>

      {data && (
        <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-3">
          Last audited: {new Date(data.ts).toLocaleString()} · Required: {data.required_types.join(', ')}
        </div>
      )}
    </TrendsPageShell>
  );
}

function CoverageTable({ title, loading, rows, total }: {
  title: string; loading: boolean; rows: { production_type: string; count: number }[]; total: number;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/20">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] text-muted-foreground font-mono">Total: {total}</span>
      </div>
      <div className="px-4 py-2">
        {loading ? (
          <p className="text-xs text-muted-foreground animate-pulse py-3 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">No data.</p>
        ) : (
          rows.map(row => (
            <div key={row.production_type} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
              <span className="text-sm text-foreground">{row.production_type}</span>
              <Badge variant="outline" className="text-[10px] font-mono h-5">{row.count}</Badge>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

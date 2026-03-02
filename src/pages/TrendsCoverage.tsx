import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, Zap, Clock, Activity, ShieldAlert } from 'lucide-react';
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

interface LastRun {
  id: string;
  created_at: string;
  trigger: string;
  completed_types: string[];
  citations_total: number;
  signals_total: number;
  cast_total: number;
}

export default function TrendsCoverage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
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

  const fetchLastRun = async () => {
    try {
      // Only consider batch-complete runs (completed_types contains all required types)
      const requiredTypes = ['film', 'tv-series', 'vertical-drama', 'animation'];
      const { data: runs } = await supabase
        .from('trend_refresh_runs' as any)
        .select('id, created_at, trigger, completed_types, citations_total, signals_total, cast_total')
        .eq('ok', true)
        .contains('completed_types' as any, requiredTypes)
        .order('created_at', { ascending: false })
        .limit(1);
      if (runs && runs.length > 0) {
        setLastRun(runs[0] as any);
        // Compute global cooldown from batch-complete run (6h window)
        const lastAt = new Date((runs[0] as any).created_at).getTime();
        const cooldownEnd = lastAt + 6 * 3600_000;
        if (Date.now() < cooldownEnd) {
          setCooldownUntil(new Date(cooldownEnd).toISOString());
        } else {
          setCooldownUntil(null);
        }
      }
    } catch {
      // Non-critical
    }
  };

  useEffect(() => { fetchCoverage(); fetchLastRun(); }, []);

  // Clear cooldown when it expires
  useEffect(() => {
    if (!cooldownUntil) return;
    const remaining = new Date(cooldownUntil).getTime() - Date.now();
    if (remaining <= 0) { setCooldownUntil(null); return; }
    const timer = setTimeout(() => setCooldownUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  const isCooldownActive = !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scheduled-refresh-trends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      const result = await res.json();
      if (res.status === 429) {
        setCooldownUntil(result.next_allowed_at || null);
        toast({ title: 'Cooldown active', description: `All trends are on cooldown until ${new Date(result.next_allowed_at).toLocaleString()}.`, variant: 'destructive' });
      } else {
        if (result.next_allowed_at) {
          setCooldownUntil(result.next_allowed_at);
        }
        const successCount = result.refreshed_types_count || 0;
        const total = result.attempted?.length || 0;
        toast({ title: 'Batch refresh complete', description: `${successCount}/${total} types refreshed successfully.` });
      }
      await Promise.all([fetchCoverage(), fetchLastRun()]);
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
      await Promise.all([fetchCoverage(), fetchLastRun()]);
    } catch (e: any) {
      toast({ title: 'Backfill failed', description: e.message, variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  const handleNormalizeCooldown = async () => {
    setNormalizing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scheduled-refresh-trends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ trigger: 'manual', override_global_cooldown: true }),
      });
      const result = await res.json();
      if (res.ok) {
        setCooldownUntil(result.next_allowed_at || null);
        toast({ title: 'Cooldown normalized', description: `Next refresh allowed at ${new Date(result.next_allowed_at).toLocaleString()}.` });
      } else {
        toast({ title: 'Normalize failed', description: result.error || 'Unknown error', variant: 'destructive' });
      }
      await Promise.all([fetchCoverage(), fetchLastRun()]);
    } catch (e: any) {
      toast({ title: 'Normalize failed', description: e.message, variant: 'destructive' });
    } finally {
      setNormalizing(false);
    }
  };

  const hasMissing = data && (data.missing_required.trend_signals.length > 0 || data.missing_required.cast_trends.length > 0);
  const isAdmin = data?.is_admin === true;

  return (
    <TrendsPageShell
      badge="Admin"
      title="Trends Coverage"
      subtitle="Audit production_type coverage across trend_signals and cast_trends."
      rightSlot={
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={handleRefreshAll} disabled={refreshing || isCooldownActive} className="h-8 text-xs">
            <Activity className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-pulse' : ''}`} />
            {refreshing ? 'Refreshing All…' : 'Refresh All Types'}
          </Button>
          {hasMissing && (
            <Button variant="outline" size="sm" onClick={handleBackfill} disabled={backfilling} className="h-8 text-xs">
              <Zap className={`h-3.5 w-3.5 mr-1 ${backfilling ? 'animate-pulse' : ''}`} />
              {backfilling ? 'Backfilling…' : 'Backfill Missing'}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleNormalizeCooldown} disabled={normalizing || refreshing} className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
              <ShieldAlert className={`h-3.5 w-3.5 mr-1 ${normalizing ? 'animate-pulse' : ''}`} />
              {normalizing ? 'Normalizing…' : 'Normalize Cooldown'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { fetchCoverage(); fetchLastRun(); }} disabled={loading} className="h-8 text-xs">Reload</Button>
        </div>
      }
    >
      {/* Global Cooldown Banner */}
      {isCooldownActive && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">Cooldown active</span> — all trend types are on cooldown until{' '}
            <span className="font-semibold text-foreground">{new Date(cooldownUntil!).toLocaleString()}</span>
          </span>
        </div>
      )}

      {/* Last Refresh Run */}
      {lastRun && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground rounded-lg border border-border/30 px-3 py-2 bg-muted/20 flex-wrap">
          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>Last refresh: <span className="font-medium text-foreground">{new Date(lastRun.created_at).toLocaleString()}</span></span>
          <Badge variant="outline" className="text-[10px] h-5">{lastRun.trigger}</Badge>
          <span>{lastRun.completed_types?.length || 0} types</span>
          <span>·</span>
          <span>{lastRun.signals_total} signals</span>
          <span>·</span>
          <span>{lastRun.cast_total} cast</span>
          <span>·</span>
          <span>{lastRun.citations_total} citations</span>
        </div>
      )}

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
        <CoverageTable
          title="trend_signals"
          loading={loading}
          rows={data?.trend_signals.by_type || []}
          total={data?.trend_signals.total || 0}
        />
        <CoverageTable
          title="cast_trends"
          loading={loading}
          rows={data?.cast_trends.by_type || []}
          total={data?.cast_trends.total || 0}
        />
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
  title: string;
  loading: boolean;
  rows: { production_type: string; count: number }[];
  total: number;
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

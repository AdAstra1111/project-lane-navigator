import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Radio, AlertTriangle, CheckCircle2, RefreshCw, Zap } from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

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
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }
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
      toast({
        title: 'Backfill complete',
        description: `Attempted: ${result.attempted?.join(', ') || 'none'}`,
      });
      await fetchCoverage();
    } catch (e: any) {
      toast({ title: 'Backfill failed', description: e.message, variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  const hasMissing = data && (data.missing_required.trend_signals.length > 0 || data.missing_required.cast_trends.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-4xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Admin</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Trends Coverage</h1>
            <p className="text-muted-foreground mt-1">Audit production_type coverage across trend_signals and cast_trends.</p>
          </div>

          {/* Admin actions */}
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh All Required Types'}
            </Button>
            {hasMissing && (
              <Button variant="default" size="sm" onClick={handleBackfill} disabled={backfilling}>
                <Zap className={`h-4 w-4 mr-1.5 ${backfilling ? 'animate-pulse' : ''}`} />
                {backfilling ? 'Backfilling…' : 'Backfill Missing Types'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchCoverage} disabled={loading}>
              Reload
            </Button>
          </div>

          {/* Missing alert */}
          {hasMissing && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Missing Required Coverage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data!.missing_required.trend_signals.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">trend_signals missing: </span>
                    {data!.missing_required.trend_signals.map(t => (
                      <Badge key={t} variant="destructive" className="text-xs mr-1">{t}</Badge>
                    ))}
                  </div>
                )}
                {data!.missing_required.cast_trends.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">cast_trends missing: </span>
                    {data!.missing_required.cast_trends.map(t => (
                      <Badge key={t} variant="destructive" className="text-xs mr-1">{t}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!hasMissing && data && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border border-border/30 rounded-md px-3 py-2 bg-muted/20">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              All required types have coverage.
            </div>
          )}

          {/* Coverage tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">trend_signals by production_type</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading…</p>
                ) : (
                  <div className="space-y-1">
                    {data?.trend_signals.by_type.map(row => (
                      <div key={row.production_type} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                        <span className="text-sm font-medium text-foreground">{row.production_type}</span>
                        <Badge variant="outline" className="text-xs font-mono">{row.count}</Badge>
                      </div>
                    ))}
                    {data?.trend_signals.by_type.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No active signals.</p>
                    )}
                    <div className="pt-2 text-xs text-muted-foreground">Total: {data?.trend_signals.total}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">cast_trends by production_type</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading…</p>
                ) : (
                  <div className="space-y-1">
                    {data?.cast_trends.by_type.map(row => (
                      <div key={row.production_type} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                        <span className="text-sm font-medium text-foreground">{row.production_type}</span>
                        <Badge variant="outline" className="text-xs font-mono">{row.count}</Badge>
                      </div>
                    ))}
                    {data?.cast_trends.by_type.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No active cast trends.</p>
                    )}
                    <div className="pt-2 text-xs text-muted-foreground">Total: {data?.cast_trends.total}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {data && (
            <div className="text-xs text-muted-foreground border-t border-border/50 pt-4">
              Last audited: {new Date(data.ts).toLocaleString()} · Required types: {data.required_types.join(', ')}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}

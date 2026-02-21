import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface TestResultItem {
  name: string;
  ok: boolean;
  details: string;
}

interface SelfTestReport {
  ok: boolean;
  seed_used: number;
  tests: TestResultItem[];
  timings_ms: Record<string, number>;
}

interface Props {
  projectId: string;
}

export function EngineSelfTestPanel({ projectId }: Props) {
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTests = import.meta.env.VITE_SHOW_ENGINE_TESTS === 'true';

  const runTest = async () => {
    setIsRunning(true);
    setError(null);
    setReport(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'self_test', projectId, seed: 42 },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setReport(data as SelfTestReport);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Self-test failed');
    } finally {
      setIsRunning(false);
    }
  };
  if (!showTests) return null;

  return (
    <Card className="border-border/40 border-dashed">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <FlaskConical className="h-4 w-4" /> Engine Self-Test
          <Badge variant="outline" className="text-[10px] font-mono">DEV</Badge>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={runTest} disabled={isRunning}>
          {isRunning ? (
            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</>
          ) : (
            'Run Self-Test'
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        {report && (
          <>
            <div className="flex items-center gap-2">
              {report.ok ? (
                <Badge className="bg-emerald-600 text-white text-[10px]">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> ALL PASS
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  <XCircle className="h-3 w-3 mr-1" /> FAIL
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground font-mono">
                seed={report.seed_used} • {report.timings_ms.total}ms
              </span>
            </div>

            <div className="space-y-1">
              {report.tests.map((t) => (
                <div
                  key={t.name}
                  className="flex items-start gap-2 text-[11px] font-mono border border-border/30 rounded px-2.5 py-1.5"
                >
                  {t.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold">{t.name}</span>
                    <p className="text-muted-foreground">{t.details}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-muted-foreground font-mono">
              Timings: {Object.entries(report.timings_ms)
                .filter(([k]) => k !== 'total')
                .map(([k, v]) => `${k}=${v}ms`)
                .join(' • ')}
            </div>
          </>
        )}

        {!report && !error && !isRunning && (
          <p className="text-xs text-muted-foreground">
            Runs deterministic checks on cascade, rank, projection, and merge logic. No DB writes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

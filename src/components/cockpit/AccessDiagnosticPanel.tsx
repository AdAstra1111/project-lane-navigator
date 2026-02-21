import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

/**
 * Developer-only diagnostic panel for verifying JWT + access guard behavior.
 *
 * AUDIT NOTE — Test C (forbidden project → 404):
 *   NOT RUNTIME-VERIFIED via tooling; requires real user JWT session.
 *   This panel enables manual runtime verification from a logged-in browser session.
 */
export function AccessDiagnosticPanel() {
  const [projectIdToTest, setProjectIdToTest] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error' | 'exception'; summary: Record<string, any>; raw: any } | null>(null);
  const [running, setRunning] = useState(false);

  const isVisible = import.meta.env.DEV || localStorage.getItem('iffy_debug') === '1';
  if (!isVisible) return null;

  const runTest = async () => {
    if (!projectIdToTest.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'initialize', projectId: projectIdToTest.trim() },
      });
      if (error) {
        const errObj = error as any;
        setResult({
          type: 'error',
          summary: {
            name: errObj?.name ?? 'Unknown',
            message: errObj?.message ?? String(error),
            ...(errObj?.context ? { context: errObj.context } : {}),
          },
          raw: errObj,
        });
      } else {
        setResult({
          type: 'success',
          summary: {
            stateGraph: !!data?.stateGraph,
            cascaded: !!data?.cascaded,
            confidence_score: data?.cascaded?.revenue_state?.confidence_score ?? data?.stateGraph?.revenue_state?.confidence_score ?? '—',
          },
          raw: data,
        });
      }
    } catch (e: any) {
      setResult({
        type: 'exception',
        summary: { message: e.message || String(e) },
        raw: e,
      });
    } finally {
      setRunning(false);
    }
  };

  const StatusIcon = result?.type === 'success' ? CheckCircle2 : result?.type === 'error' ? XCircle : AlertTriangle;
  const statusColor = result?.type === 'success' ? 'text-green-500' : result?.type === 'error' ? 'text-red-500' : 'text-yellow-500';

  return (
    <details className="border border-dashed border-border/60 rounded-lg p-4 bg-muted/30">
      <summary className="flex items-center gap-2 cursor-pointer text-xs font-mono text-muted-foreground select-none">
        <ShieldAlert className="h-3.5 w-3.5" />
        JWT / Access Diagnostic (dev only)
      </summary>

      <div className="mt-3 space-y-3 text-xs">
        <div className="bg-muted/50 rounded p-3 space-y-2 text-muted-foreground">
          <p className="font-semibold">How to verify forbidden-project access (Test C):</p>
          <p>Use a project UUID that <strong>definitely exists</strong> but you do <strong>not</strong> have access to (e.g. a teammate's project in another company).</p>
          <p className="italic">404 can mean either forbidden OR non-existent. To prove the access guard works, the project must exist.</p>
          <div className="mt-2 space-y-0.5 font-mono">
            <p>• <span className="text-green-500">200</span> — You have access → stateGraph returned</p>
            <p>• <span className="text-yellow-500">404</span> — Forbidden or non-existent → "Project not found or access denied"</p>
            <p>• <span className="text-red-500">401</span> — Not authenticated</p>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <Input
            className="font-mono text-xs h-8"
            placeholder="Paste a project UUID you do NOT own…"
            value={projectIdToTest}
            onChange={(e) => setProjectIdToTest(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={runTest} disabled={running || !projectIdToTest.trim()}>
            {running ? 'Testing…' : 'Run Access Test'}
          </Button>
        </div>

        {result && (
          <div className="space-y-2">
            <div className={`flex items-center gap-2 font-semibold ${statusColor}`}>
              <StatusIcon className="h-4 w-4" />
              {result.type === 'success' ? 'Success (200)' : result.type === 'error' ? 'Error' : 'Exception'}
            </div>

            <div className="bg-background border border-border rounded p-3 space-y-1 font-mono">
              {Object.entries(result.summary).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-muted-foreground">{k}:</span>
                  <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>

            <details className="text-muted-foreground">
              <summary className="cursor-pointer select-none">Full response JSON</summary>
              <pre className="bg-background border border-border rounded p-3 overflow-auto max-h-48 mt-1 whitespace-pre-wrap">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </details>
  );
}

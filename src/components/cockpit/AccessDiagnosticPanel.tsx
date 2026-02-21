import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert } from 'lucide-react';

/**
 * Developer-only diagnostic panel for verifying JWT + access guard behavior.
 *
 * AUDIT NOTE — Test C (forbidden project → 404):
 *   NOT RUNTIME-VERIFIED via tooling; requires real user JWT session.
 *   This panel enables manual runtime verification from a logged-in browser session.
 *
 * Visible only when:
 *   - import.meta.env.DEV === true, OR
 *   - localStorage.getItem('iffy_debug') === '1'
 */
export function AccessDiagnosticPanel() {
  const [projectIdToTest, setProjectIdToTest] = useState('');
  const [result, setResult] = useState<{ status: string; body: any } | null>(null);
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
        const errBody = typeof error === 'object' && 'context' in error
          ? (error as any).context
          : error;
        setResult({ status: 'error', body: errBody });
      } else {
        setResult({ status: '200 OK', body: data });
      }
    } catch (e: any) {
      setResult({ status: 'exception', body: e.message || String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <details className="border border-dashed border-border/60 rounded-lg p-4 bg-muted/30">
      <summary className="flex items-center gap-2 cursor-pointer text-xs font-mono text-muted-foreground select-none">
        <ShieldAlert className="h-3.5 w-3.5" />
        JWT / Access Diagnostic (dev only)
      </summary>

      <div className="mt-3 space-y-3 text-xs">
        <div className="bg-muted/50 rounded p-3 space-y-1 font-mono text-muted-foreground">
          <p><strong>Expected outcomes:</strong></p>
          <p>• <span className="text-green-500">200</span> — User has access → stateGraph returned</p>
          <p>• <span className="text-yellow-500">404</span> — User does NOT have access → "Project not found or access denied"</p>
          <p>• <span className="text-red-500">401</span> — User is not authenticated</p>
        </div>

        <div className="flex gap-2 items-center">
          <Input
            className="font-mono text-xs h-8"
            placeholder="Project UUID to test…"
            value={projectIdToTest}
            onChange={(e) => setProjectIdToTest(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={runTest} disabled={running || !projectIdToTest.trim()}>
            {running ? 'Testing…' : 'Run Access Test'}
          </Button>
        </div>

        {result && (
          <pre className="bg-background border border-border rounded p-3 overflow-auto max-h-48 text-xs whitespace-pre-wrap">
            <strong>Status:</strong> {result.status}{'\n'}
            <strong>Response:</strong>{'\n'}
            {JSON.stringify(result.body, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

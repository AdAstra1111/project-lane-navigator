import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Loader2, CheckCircle2, XCircle, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCorpusIntegrityStatus } from '@/hooks/useCorpusIntegrity';
import { useQueryClient } from '@tanstack/react-query';

interface SelfTestResult {
  pass: boolean;
  timestamp: string;
  checks: Record<string, boolean>;
  evidence: {
    latest_calibration: {
      production_type: string;
      normalization_strategy: string;
      median_raw_pages: number;
      median_normalized_pages: number;
      median_page_count_clamped: number;
      sample_size: number;
      sample_size_used: number;
    } | null;
    counts: {
      total_complete: number;
      normalized_present: number;
      truncated: number;
      transcripts: number;
      manual_excluded: number;
      eligible: number;
    };
    idempotency_hashes: { run1: string; run2: string };
  };
  failures: string[];
}

const CHECK_LABELS: Record<string, string> = {
  schema_ok: 'Schema columns present',
  ingest_storage_ok: 'Normalization stored at ingest',
  strategy_ok: 'Strategy = stored_clean_word_count',
  async_leak_ok: 'No async fire-and-forget leaks',
  idempotent_ok: 'Aggregate is idempotent',
  sanity_ok: 'Raw ≥ normalized, clamped ≤ ceiling',
  eligibility_counts_ok: 'Exclusion counts match DB',
};

export function CorpusIntegrityPanel() {
  const { data: storedResult } = useCorpusIntegrityStatus();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use live result if available, otherwise fall back to stored
  const displayResult = result || (storedResult ? {
    pass: storedResult.pass,
    timestamp: storedResult.created_at,
    checks: storedResult.checks,
    evidence: storedResult.evidence,
    failures: storedResult.failures,
  } as SelfTestResult : null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('analyze-corpus', {
        body: { action: 'self_test' },
      });
      if (fnErr) throw fnErr;
      setResult(data as SelfTestResult);
      // Invalidate the stored status query so banner updates
      queryClient.invalidateQueries({ queryKey: ['corpus-integrity-status'] });
    } catch (e: any) {
      setError(e.message || 'Failed to run self-test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.19 }}
      className="glass-card rounded-xl p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Corpus Integrity
        </h2>
        <Button size="sm" variant="outline" onClick={runTest} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Run Integrity Check
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {displayResult && (
        <div className="space-y-4">
          {/* Overall verdict */}
          <div className={`rounded-lg p-4 flex items-center gap-3 ${displayResult.pass ? 'bg-primary/10 border border-primary/30' : 'bg-destructive/10 border border-destructive/30'}`}>
            {displayResult.pass
              ? <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
              : <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />}
            <div>
              <p className="font-semibold text-foreground">{displayResult.pass ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}</p>
              <p className="text-xs text-muted-foreground">{new Date(displayResult.timestamp).toLocaleString()}</p>
            </div>
          </div>

          {/* Individual checks */}
          <div className="grid gap-1.5">
            {Object.entries(displayResult.checks).map(([key, ok]) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                {ok
                  ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                <span className={ok ? 'text-muted-foreground' : 'text-destructive font-medium'}>
                  {CHECK_LABELS[key] || key}
                </span>
              </div>
            ))}
          </div>

          {/* Key evidence */}
          {displayResult.evidence?.latest_calibration && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1 font-mono">
              <p><span className="text-muted-foreground">strategy:</span> {displayResult.evidence.latest_calibration.normalization_strategy}</p>
              <p><span className="text-muted-foreground">median_raw:</span> {displayResult.evidence.latest_calibration.median_raw_pages} → <span className="text-muted-foreground">normalized:</span> {displayResult.evidence.latest_calibration.median_normalized_pages} → <span className="text-muted-foreground">clamped:</span> {displayResult.evidence.latest_calibration.median_page_count_clamped}</p>
              <p><span className="text-muted-foreground">sample:</span> {displayResult.evidence.latest_calibration.sample_size} (used: {displayResult.evidence.latest_calibration.sample_size_used})</p>
            </div>
          )}

          {/* Exclusion counts */}
          {displayResult.evidence?.counts && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="bg-muted px-2 py-1 rounded text-muted-foreground">Complete: {displayResult.evidence.counts.total_complete}</span>
              <span className="bg-muted px-2 py-1 rounded text-muted-foreground">Eligible: {displayResult.evidence.counts.eligible}</span>
              <span className="bg-muted px-2 py-1 rounded text-muted-foreground">Truncated: {displayResult.evidence.counts.truncated}</span>
              <span className="bg-muted px-2 py-1 rounded text-muted-foreground">Transcripts: {displayResult.evidence.counts.transcripts}</span>
              <span className="bg-muted px-2 py-1 rounded text-muted-foreground">Manual excl: {displayResult.evidence.counts.manual_excluded}</span>
            </div>
          )}

          {/* Idempotency hashes */}
          {displayResult.evidence?.idempotency_hashes && (
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <Hash className="h-3 w-3" />
              <span className="truncate">run1: {displayResult.evidence.idempotency_hashes.run1.slice(0, 16)}…</span>
              <span className="truncate">run2: {displayResult.evidence.idempotency_hashes.run2.slice(0, 16)}…</span>
              {displayResult.evidence.idempotency_hashes.run1 === displayResult.evidence.idempotency_hashes.run2
                ? <span className="text-primary">✓ match</span>
                : <span className="text-destructive">✗ mismatch</span>}
            </div>
          )}

          {/* Failures */}
          {displayResult.failures.length > 0 && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-1">
              <p className="text-xs font-semibold text-destructive">Failures:</p>
              {displayResult.failures.map((f, i) => (
                <p key={i} className="text-xs text-destructive/80 font-mono">{f}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {!displayResult && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          Run a self-test to verify normalization, idempotency, and async safety are intact.
        </p>
      )}
    </motion.section>
  );
}

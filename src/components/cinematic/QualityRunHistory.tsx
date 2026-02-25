/**
 * Quality Run History — Shows CIK quality run history for a project.
 * Displays pass/fail, scores, lanes, and diff between attempts.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, XCircle, Clock, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface QualityRun {
  id: string;
  engine: string;
  lane: string | null;
  model: string;
  attempt_count: number;
  final_pass: boolean;
  final_score: number;
  created_at: string;
}

interface QualityAttempt {
  id: string;
  run_id: string;
  attempt_index: number;
  score: number;
  pass: boolean;
  failures: string[];
  hard_failures: string[];
  diagnostic_flags: string[];
  unit_count: number | null;
  expected_unit_count: number | null;
  repair_instruction: string | null;
  units_json: any;
  metrics_json: any;
}

export default function QualityRunHistory() {
  const { id: projectId } = useParams<{ id: string }>();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const { data: runs, isLoading } = useQuery({
    queryKey: ['quality-runs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cinematic_quality_runs')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as QualityRun[];
    },
    enabled: !!projectId,
  });

  const { data: attempts } = useQuery({
    queryKey: ['quality-attempts', expandedRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cinematic_quality_attempts')
        .select('*')
        .eq('run_id', expandedRunId!)
        .order('attempt_index', { ascending: true });
      if (error) throw error;
      return (data || []) as QualityAttempt[];
    },
    enabled: !!expandedRunId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 animate-spin" />
            Loading quality history...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quality Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No quality runs recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Quality Run History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[500px]">
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <div key={run.id}>
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                >
                  {run.final_pass ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{run.engine}</Badge>
                      {run.lane && <Badge variant="secondary" className="text-xs">{run.lane}</Badge>}
                      <span className="text-xs text-muted-foreground">{run.model}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Score: {Number(run.final_score).toFixed(2)} · {run.attempt_count} attempt(s) · {new Date(run.created_at).toLocaleString()}
                    </div>
                  </div>
                  {expandedRunId === run.id ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {expandedRunId === run.id && attempts && (
                  <RunDetail attempts={attempts} />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function RunDetail({ attempts }: { attempts: QualityAttempt[] }) {
  if (attempts.length === 0) return null;

  const attempt0 = attempts.find(a => a.attempt_index === 0);
  const attempt1 = attempts.find(a => a.attempt_index === 1);

  const scoreDelta = attempt1 && attempt0 ? attempt1.score - attempt0.score : null;
  const failureDelta = attempt1 && attempt0
    ? attempt0.hard_failures.length - attempt1.hard_failures.length
    : null;

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Diff summary */}
      {attempt0 && attempt1 && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium mb-2">Repair Impact</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Score Δ: </span>
              <span className={scoreDelta && scoreDelta > 0 ? 'text-green-500' : 'text-destructive'}>
                {scoreDelta !== null ? (scoreDelta > 0 ? '+' : '') + scoreDelta.toFixed(3) : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Failures fixed: </span>
              <span className={failureDelta && failureDelta > 0 ? 'text-green-500' : 'text-muted-foreground'}>
                {failureDelta ?? '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="0" className="w-full">
        <TabsList className="w-full">
          {attempts.map((a) => (
            <TabsTrigger key={a.attempt_index} value={String(a.attempt_index)} className="flex-1 text-xs">
              {a.attempt_index === 0 ? 'Initial' : `Repair ${a.attempt_index}`}
              {a.pass ? (
                <CheckCircle2 className="h-3 w-3 ml-1 text-green-500" />
              ) : (
                <XCircle className="h-3 w-3 ml-1 text-destructive" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {attempts.map((attempt) => (
          <TabsContent key={attempt.attempt_index} value={String(attempt.attempt_index)} className="space-y-2 mt-2">
            <AttemptDetail attempt={attempt} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function AttemptDetail({ attempt }: { attempt: QualityAttempt }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="text-muted-foreground">Score: </span>
          <span className="font-mono">{Number(attempt.score).toFixed(3)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Units: </span>
          <span>{attempt.unit_count ?? '?'}{attempt.expected_unit_count ? ` / ${attempt.expected_unit_count}` : ''}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Pass: </span>
          <span>{attempt.pass ? '✓' : '✗'}</span>
        </div>
      </div>

      {attempt.hard_failures.length > 0 && (
        <div>
          <span className="text-muted-foreground">Hard failures: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {attempt.hard_failures.map(f => (
              <Badge key={f} variant="destructive" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {attempt.diagnostic_flags.length > 0 && (
        <div>
          <span className="text-muted-foreground">Diagnostic flags: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {attempt.diagnostic_flags.map(f => (
              <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {attempt.repair_instruction && (
        <div className="mt-2">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-muted-foreground">Repair instruction:</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1"
              onClick={() => {
                navigator.clipboard.writeText(attempt.repair_instruction || '');
                toast.success('Copied to clipboard');
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <pre className="bg-muted rounded p-2 text-[10px] leading-tight whitespace-pre-wrap max-h-40 overflow-auto font-mono">
            {attempt.repair_instruction}
          </pre>
        </div>
      )}

      {attempt.metrics_json && (
        <div>
          <span className="text-muted-foreground">Metrics:</span>
          <pre className="bg-muted rounded p-2 text-[10px] leading-tight whitespace-pre-wrap max-h-32 overflow-auto font-mono mt-1">
            {JSON.stringify(attempt.metrics_json, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

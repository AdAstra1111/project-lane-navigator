/**
 * AutopilotPanel — Persistent autopilot control for the Project Development page.
 * Reads state from canon via devseed-autopilot status, provides Start/Resume/Pause.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AutopilotProgress, type AutopilotState } from '@/components/pitch/AutopilotProgress';
import { Loader2, Play, Pause, Rocket, AlertTriangle } from 'lucide-react';

interface Props {
  projectId: string;
  pitchIdeaId?: string | null;
}

export function AutopilotPanel({ projectId, pitchIdeaId }: Props) {
  const [autopilot, setAutopilot] = useState<AutopilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [pausing, setPausing] = useState(false);
  const abortRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current = true; };
  }, []);

  // Fetch status on mount
  const fetchStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'status', projectId },
      });
      if (error) {
        // Function not deployed
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('Failed to fetch')) {
          toast.error('Autopilot function unavailable — please deploy edge function devseed-autopilot');
        }
        return;
      }
      if (mountedRef.current && data?.autopilot) {
        setAutopilot(data.autopilot);
      }
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Tick loop
  const runTicks = useCallback(async () => {
    if (abortRef.current) return;
    setTicking(true);
    try {
      let iterations = 0;
      const MAX = 20;
      while (iterations < MAX && !abortRef.current) {
        iterations++;
        const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
          body: { action: 'tick', projectId },
        });
        if (error) { console.error('[autopilot tick]', error.message); break; }
        const result = data as any;
        if (result?.autopilot && mountedRef.current) setAutopilot(result.autopilot);
        if (result?.done || result?.message === 'not_running') break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } finally {
      if (mountedRef.current) setTicking(false);
    }
  }, [projectId]);

  const handleStart = useCallback(async () => {
    abortRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: {
          action: 'start',
          projectId,
          pitchIdeaId: pitchIdeaId || undefined,
          options: {
            apply_seed_intel_pack: true,
            regen_foundation: true,
            generate_primary_script: true,
          },
        },
      });
      if (error) {
        if (error.message?.includes('Failed to fetch')) {
          toast.error('Autopilot function unavailable — please deploy edge function devseed-autopilot');
        } else {
          toast.error('Failed to start autopilot: ' + error.message);
        }
        return;
      }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
      runTicks();
    } catch (err: any) {
      toast.error('Failed to start autopilot');
    }
  }, [projectId, pitchIdeaId, runTicks]);

  const handleResume = useCallback(async () => {
    abortRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'start', projectId, pitchIdeaId: pitchIdeaId || undefined },
      });
      if (error) { toast.error('Failed to resume: ' + error.message); return; }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
      runTicks();
    } catch {
      toast.error('Failed to resume autopilot');
    }
  }, [projectId, pitchIdeaId, runTicks]);

  const handlePause = useCallback(async () => {
    setPausing(true);
    abortRef.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'pause', projectId },
      });
      if (error) { toast.error('Failed to pause: ' + error.message); return; }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
    } catch {
      toast.error('Failed to pause autopilot');
    } finally {
      if (mountedRef.current) setPausing(false);
    }
  }, [projectId]);

  if (loading) return null;

  const status = autopilot?.status;
  const isRunning = status === 'running' || ticking;
  const hasError = status === 'error' || (autopilot && Object.values(autopilot.stages || {}).some(s => s.status === 'error'));
  const isPaused = status === 'paused';
  const isComplete = status === 'complete';
  const canStart = !autopilot || status === 'idle';
  const canResume = (hasError || isPaused) && !ticking;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">DevSeed Autopilot</CardTitle>
          {isComplete && <Badge variant="default" className="text-[10px] h-5">Complete</Badge>}
          {isRunning && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
          {hasError && !isRunning && <Badge variant="destructive" className="text-[10px] h-5">Error</Badge>}
          {isPaused && !hasError && <Badge variant="secondary" className="text-[10px] h-5">Paused</Badge>}
        </div>
        <div className="flex gap-2">
          {canStart && (
            <Button size="sm" onClick={handleStart} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Start Autopilot
            </Button>
          )}
          {canResume && (
            <Button size="sm" variant="outline" onClick={handleResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {isRunning && (
            <Button size="sm" variant="outline" onClick={handlePause} disabled={pausing} className="h-7 text-xs gap-1">
              {pausing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
              Pause
            </Button>
          )}
        </div>
      </CardHeader>
      {autopilot && (
        <CardContent className="px-4 pb-3 pt-0">
          <AutopilotProgress
            autopilot={autopilot}
            onResume={canResume ? handleResume : undefined}
            isResuming={ticking}
          />
        </CardContent>
      )}
      {!autopilot && (
        <CardContent className="px-4 pb-3 pt-0">
          <p className="text-xs text-muted-foreground">
            No autopilot run yet. Click "Start Autopilot" to begin automated project setup.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

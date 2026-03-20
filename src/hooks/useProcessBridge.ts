/**
 * useProcessBridge — Bridge hook that registers a workflow into the global ProcessingTracker.
 * Call registerProcess() to start, then updateProcess/completeProcess/failProcess to update.
 */
import { useCallback, useRef, useEffect } from 'react';
import { useProcessingTracker } from '@/lib/processing/ProcessingContext';
import type { ActiveProcess, ProcessStatus } from '@/lib/processing/types';

interface BridgeOpts {
  /** Stable key prefix for deduplication */
  keyPrefix: string;
  type: string;
  projectId?: string;
  projectTitle?: string;
  href?: string;
  stages?: string[];
}

export function useProcessBridge(opts: BridgeOpts) {
  const tracker = useProcessingTracker();
  const activeIdRef = useRef<string | null>(null);

  // Clean up on unmount only if still running
  useEffect(() => {
    return () => {
      // Don't remove — let it persist in the global tracker
    };
  }, []);

  const register = useCallback((overrides?: Partial<ActiveProcess>) => {
    const id = `${opts.keyPrefix}-${opts.projectId || 'global'}-${Date.now()}`;
    activeIdRef.current = id;
    tracker.upsert({
      id,
      type: opts.type,
      projectId: opts.projectId,
      projectTitle: opts.projectTitle,
      status: 'running',
      startedAt: Date.now(),
      href: opts.href,
      stages: opts.stages,
      currentStageIndex: 0,
      ...overrides,
    });
    return id;
  }, [tracker, opts]);

  const update = useCallback((patch: Partial<ActiveProcess>) => {
    if (activeIdRef.current) {
      tracker.update(activeIdRef.current, patch);
    }
  }, [tracker]);

  const complete = useCallback(() => {
    if (activeIdRef.current) {
      tracker.complete(activeIdRef.current);
      activeIdRef.current = null;
    }
  }, [tracker]);

  const fail = useCallback((error: string) => {
    if (activeIdRef.current) {
      tracker.fail(activeIdRef.current, error);
      activeIdRef.current = null;
    }
  }, [tracker]);

  return { register, update, complete, fail, activeId: activeIdRef };
}

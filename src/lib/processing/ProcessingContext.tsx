/**
 * ProcessingContext — Global registry of active processes.
 * Components register/update/complete processes; the Processing Center reads them.
 */
import { createContext, useContext, useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ActiveProcess, ProcessStatus } from './types';

interface ProcessingStore {
  processes: Map<string, ActiveProcess>;
  listeners: Set<() => void>;
}

interface ProcessingContextValue {
  /** Register or update a process */
  upsert: (process: ActiveProcess) => void;
  /** Update specific fields */
  update: (id: string, patch: Partial<ActiveProcess>) => void;
  /** Mark completed */
  complete: (id: string) => void;
  /** Mark failed */
  fail: (id: string, error: string) => void;
  /** Remove from tracker */
  remove: (id: string) => void;
  /** Get all processes */
  getAll: () => ActiveProcess[];
  /** Subscribe for reactivity */
  subscribe: (listener: () => void) => () => void;
  /** Snapshot for useSyncExternalStore */
  getSnapshot: () => ActiveProcess[];
}

const ProcessingCtx = createContext<ProcessingContextValue | null>(null);

// Keep completed/failed processes visible for 60s
const RETENTION_MS = 60_000;

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ProcessingStore>({
    processes: new Map(),
    listeners: new Set(),
  });
  const snapshotRef = useRef<ActiveProcess[]>([]);

  const notify = useCallback(() => {
    const store = storeRef.current;
    snapshotRef.current = Array.from(store.processes.values()).sort((a, b) => {
      // Active first, then by start time desc
      const statusOrder: Record<ProcessStatus, number> = { running: 0, waiting: 1, queued: 2, failed: 3, completed: 4 };
      const oa = statusOrder[a.status] ?? 5;
      const ob = statusOrder[b.status] ?? 5;
      if (oa !== ob) return oa - ob;
      return b.startedAt - a.startedAt;
    });
    store.listeners.forEach(l => l());
  }, []);

  const cleanup = useCallback(() => {
    const store = storeRef.current;
    const now = Date.now();
    let changed = false;
    for (const [id, p] of store.processes) {
      if ((p.status === 'completed' || p.status === 'failed') && p.completedAt && (now - p.completedAt > RETENTION_MS)) {
        store.processes.delete(id);
        changed = true;
      }
    }
    if (changed) notify();
  }, [notify]);

  const upsert = useCallback((process: ActiveProcess) => {
    storeRef.current.processes.set(process.id, process);
    notify();
    cleanup();
  }, [notify, cleanup]);

  const update = useCallback((id: string, patch: Partial<ActiveProcess>) => {
    const existing = storeRef.current.processes.get(id);
    if (existing) {
      storeRef.current.processes.set(id, { ...existing, ...patch });
      notify();
    }
  }, [notify]);

  const complete = useCallback((id: string) => {
    const existing = storeRef.current.processes.get(id);
    if (existing) {
      storeRef.current.processes.set(id, { ...existing, status: 'completed', completedAt: Date.now(), percent: 100 });
      notify();
    }
  }, [notify]);

  const fail = useCallback((id: string, error: string) => {
    const existing = storeRef.current.processes.get(id);
    if (existing) {
      storeRef.current.processes.set(id, { ...existing, status: 'failed', completedAt: Date.now(), error });
      notify();
    }
  }, [notify]);

  const remove = useCallback((id: string) => {
    storeRef.current.processes.delete(id);
    notify();
  }, [notify]);

  const subscribe = useCallback((listener: () => void) => {
    storeRef.current.listeners.add(listener);
    return () => { storeRef.current.listeners.delete(listener); };
  }, []);

  const getAll = useCallback(() => snapshotRef.current, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const value: ProcessingContextValue = {
    upsert, update, complete, fail, remove, getAll, subscribe, getSnapshot,
  };

  return (
    <ProcessingCtx.Provider value={value}>
      {children}
    </ProcessingCtx.Provider>
  );
}

/** Hook to register/manage a process */
export function useProcessingTracker() {
  const ctx = useContext(ProcessingCtx);
  if (!ctx) throw new Error('useProcessingTracker must be used within ProcessingProvider');
  return ctx;
}

/** Hook to read all active processes reactively */
export function useActiveProcesses(): ActiveProcess[] {
  const ctx = useContext(ProcessingCtx);
  if (!ctx) return [];
  return useSyncExternalStore(ctx.subscribe, ctx.getSnapshot, ctx.getSnapshot);
}

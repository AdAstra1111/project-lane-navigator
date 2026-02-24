import { useState, useCallback } from 'react';

export type OperatingMode = 'develop' | 'produce';

const STORAGE_PREFIX = 'iffy_operating_mode_';

function getStoredMode(projectId: string): OperatingMode {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (stored === 'develop' || stored === 'produce') return stored;
  } catch {}
  return 'develop';
}

export function useOperatingMode(projectId: string | undefined) {
  const safeId = projectId || '__none__';
  const [mode, setModeState] = useState<OperatingMode>(() => getStoredMode(safeId));

  const setMode = useCallback(
    (next: OperatingMode) => {
      setModeState(next);
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${safeId}`, next);
      } catch {}
    },
    [safeId],
  );

  const toggle = useCallback(() => {
    setMode(mode === 'develop' ? 'produce' : 'develop');
  }, [mode, setMode]);

  return { mode, setMode, toggle } as const;
}

/**
 * useNuanceProfile — Manages nuance profile state per project.
 * Persists to localStorage keyed by projectId, sent with each generation run.
 */
import { useState, useCallback, useEffect } from 'react';
import type { NuanceProfile } from '@/lib/nuance/types';
import { getDefaultProfile } from '@/lib/nuance/defaults';

const STORAGE_KEY_PREFIX = 'nuance_profile_';

export function useNuanceProfile(projectId: string, lane?: string) {
  const [profile, setProfile] = useState<NuanceProfile>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
      if (stored) return JSON.parse(stored);
    } catch { /* use default */ }
    return getDefaultProfile(lane);
  });

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(profile));
    } catch { /* storage full, ignore */ }
  }, [profile, projectId]);

  const updateProfile = useCallback((next: NuanceProfile) => {
    setProfile(next);
  }, []);

  const resetToDefaults = useCallback(() => {
    setProfile(getDefaultProfile(lane));
  }, [lane]);

  return { profile, updateProfile, resetToDefaults };
}

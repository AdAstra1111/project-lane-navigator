import { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from 'react';
import type { UIMode } from '@/lib/mode';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface UIModeContextValue {
  mode: UIMode;
  setMode: (m: UIMode) => void;
  loading: boolean;
}

const UIModeContext = createContext<UIModeContextValue | null>(null);

export function UIModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile-mode', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('mode_preference')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: async (mode: UIMode) => {
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({ mode_preference: mode } as any)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-mode'] });
    },
  });

  const mode: UIMode = (profile as any)?.mode_preference === 'advanced' ? 'advanced' : 'simple';

  const setMode = useCallback((m: UIMode) => {
    // Optimistic update
    queryClient.setQueryData(['profile-mode', user?.id], (old: any) => ({
      ...old,
      mode_preference: m,
    }));
    mutation.mutate(m);
  }, [user?.id, mutation, queryClient]);

  const value = useMemo(() => ({ mode, setMode, loading: isLoading }), [mode, setMode, isLoading]);

  return <UIModeContext.Provider value={value}>{children}</UIModeContext.Provider>;
}

export function useUIMode(): UIModeContextValue {
  const ctx = useContext(UIModeContext);
  if (!ctx) throw new Error('useUIMode must be used within UIModeProvider');
  return ctx;
}

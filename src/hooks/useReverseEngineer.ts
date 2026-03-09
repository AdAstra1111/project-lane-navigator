import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ReverseEngineerResult {
  success: boolean;
  title?: string;
  format?: string;
  documents_created?: number;
  voice_profile_saved?: boolean;
  error?: string;
}

export function useReverseEngineer() {
  const [isRunning, setIsRunning] = useState(false);

  const reverseEngineerFromScript = useCallback(async (
    projectId: string,
    scriptDocumentId: string,
  ): Promise<ReverseEngineerResult> => {
    setIsRunning(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { data, error } = await supabase.functions.invoke('reverse-engineer-script', {
        body: {
          project_id: projectId,
          script_document_id: scriptDocumentId,
          user_id: userId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Reverse engineer failed');
      return data as ReverseEngineerResult;
    } catch (e: any) {
      return { success: false, error: e?.message || 'Unknown error' };
    } finally {
      setIsRunning(false);
    }
  }, []);

  return { reverseEngineerFromScript, isRunning };
}

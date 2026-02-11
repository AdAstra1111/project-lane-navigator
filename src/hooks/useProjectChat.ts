import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string;
}

export function useProjectChat(projectId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['project-chat', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_chat_messages')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []) as ChatMessage[];
    },
    enabled: !!projectId,
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!user || !projectId) throw new Error('Missing context');

      // Save user message
      await (supabase as any)
        .from('project_chat_messages')
        .insert({ project_id: projectId, user_id: user.id, role: 'user', content });

      setIsStreaming(true);

      // Call AI edge function
      const { data, error } = await supabase.functions.invoke('project-chat', {
        body: { projectId, question: content },
      });

      setIsStreaming(false);

      if (error) throw error;

      // Save AI response
      await (supabase as any)
        .from('project_chat_messages')
        .insert({
          project_id: projectId,
          user_id: user.id,
          role: 'assistant',
          content: data?.answer || 'I couldn\'t generate a response.',
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-chat', projectId] });
    },
  });

  const clearChat = useMutation({
    mutationFn: async () => {
      if (!projectId) return;
      await (supabase as any)
        .from('project_chat_messages')
        .delete()
        .eq('project_id', projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-chat', projectId] });
    },
  });

  return { messages, isLoading, sendMessage, clearChat, isStreaming };
}

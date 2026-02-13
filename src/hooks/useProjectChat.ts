import { useState, useCallback } from 'react';
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
  const [streamingContent, setStreamingContent] = useState('');

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

      // Invalidate to show user message immediately
      queryClient.invalidateQueries({ queryKey: ['project-chat', projectId] });

      setIsStreaming(true);
      setStreamingContent('');

      // Stream from edge function
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-chat`;
      const session = (await supabase.auth.getSession()).data.session;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId, question: content }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: 'Chat failed' }));
        setIsStreaming(false);
        throw new Error(errData.error || 'Chat failed');
      }

      if (!resp.body) {
        setIsStreaming(false);
        throw new Error('No response body');
      }

      // Parse SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let fullAnswer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              fullAnswer += delta;
              setStreamingContent(fullAnswer);
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Flush remaining
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              fullAnswer += delta;
              setStreamingContent(fullAnswer);
            }
          } catch { /* ignore */ }
        }
      }

      setIsStreaming(false);
      setStreamingContent('');

      // Save AI response
      const finalAnswer = fullAnswer || "I couldn't generate a response.";
      await (supabase as any)
        .from('project_chat_messages')
        .insert({
          project_id: projectId,
          user_id: user.id,
          role: 'assistant',
          content: finalAnswer,
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

  return { messages, isLoading, sendMessage, clearChat, isStreaming, streamingContent };
}

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectChat } from '@/hooks/useProjectChat';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';

interface ProjectChatProps {
  projectId: string;
}

export function ProjectChat({ projectId }: ProjectChatProps) {
  const { messages, isLoading, sendMessage, clearChat, isStreaming, streamingContent } = useProjectChat(projectId);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, streamingContent]);

  const handleSend = () => {
    if (!input.trim() || sendMessage.isPending) return;
    sendMessage.mutate(input.trim());
    setInput('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">AI Project Chat</h4>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => clearChat.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto p-4 space-y-3"
        >
          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div className="text-center py-8">
              <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Ask anything about this project</p>
              <p className="text-xs text-muted-foreground/60">
                "What if we reduced the budget?" · "Who are the best cast options?" · "What are the biggest risks?"
              </p>
            </div>
          ) : (
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex gap-2.5",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[80%] rounded-xl px-3.5 py-2.5",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}>
                    {msg.role === 'assistant' ? (
                      <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    )}
                    <p className={cn(
                      "text-[10px] mt-1",
                      msg.role === 'user' ? "text-primary-foreground/60" : "text-muted-foreground/60"
                    )}>
                      {format(new Date(msg.created_at), 'h:mm a')}
                    </p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-foreground" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          {/* Streaming message */}
          {isStreaming && (
            <div className="flex gap-2.5">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-xl px-3.5 py-2.5 max-w-[80%]">
                {streamingContent ? (
                  <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border/50 p-3 flex gap-2">
          <Input
            placeholder="Ask about this project..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={sendMessage.isPending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sendMessage.isPending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

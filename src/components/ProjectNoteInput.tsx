import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface ProjectNoteInputProps {
  projectId: string;
}

export function ProjectNoteInput({ projectId }: ProjectNoteInputProps) {
  const [note, setNote] = useState('');
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [impact, setImpact] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!note.trim()) return;
    setIsAnalysing(true);
    setImpact(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: 'Not authenticated', variant: 'destructive' });
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-note`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ project_id: projectId, note: note.trim() }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const result = await response.json();
      setImpact(result.impact);
      setNote('');

      // Refresh timeline
      queryClient.invalidateQueries({ queryKey: ['project-updates', projectId] });
    } catch (e: any) {
      console.error('Note analysis failed:', e);
      toast({
        title: 'Analysis failed',
        description: e.message || 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setIsAnalysing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Project Notes</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Add a thought, consideration, or question — IFFY will assess how it might affect finance readiness.
        </p>
        <Textarea
          placeholder="e.g. Considering moving the shoot to Spain, or We may be able to attach Renate Reinsve…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[80px] resize-none bg-background/50 border-border/50 focus:border-primary/50"
          disabled={isAnalysing}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">⌘+Enter to submit</span>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!note.trim() || isAnalysing}
          >
            {isAnalysing ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1.5" />
                Assess Impact
              </>
            )}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {impact && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-card rounded-xl p-5 border-l-4 border-primary"
          >
            <p className="text-xs text-primary font-medium uppercase tracking-wider mb-2">Impact Assessment</p>
            <p className="text-sm text-foreground leading-relaxed">{impact}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

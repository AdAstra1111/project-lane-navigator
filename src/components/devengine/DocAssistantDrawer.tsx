import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  MessageSquare, Loader2, Send, Sparkles, CheckCircle, XCircle, AlertTriangle,
  ChevronDown, TrendingUp, TrendingDown, Minus, Bot, User,
} from 'lucide-react';
import { useDocAssistantPersistent, type DAAction, type DATestRun } from '@/hooks/useDocAssistantPersistent';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DocAssistantDrawerProps {
  projectId: string | undefined;
  selectedDocType?: string;
  selectedVersionId?: string;
  selectedVersionText?: string;
  onVersionCreated?: (versionId: string) => void;
}

// Score delta display
function ScoreDelta({ label, baseline, after }: { label: string; baseline: number; after: number }) {
  const diff = after - baseline;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const color = diff > 5 ? 'text-primary' : diff < -5 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground capitalize">{label.replace(/_/g, ' ')}</span>
      <span className={cn('flex items-center gap-0.5 font-mono', color)}>
        {baseline}→{after} <Icon className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}

// Action card component
function ActionCard({ action, projectId }: { action: DAAction; projectId?: string }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const latestTest = action.document_assistant_test_runs?.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  )?.[0] as DATestRun | undefined;

  const statusBadge = {
    proposed: { variant: 'outline' as const, label: 'Proposed' },
    testing: { variant: 'secondary' as const, label: 'Testing…' },
    test_failed: { variant: 'destructive' as const, label: 'Test Failed' },
    ready_to_apply: { variant: 'default' as const, label: 'Ready to Apply' },
    applied: { variant: 'default' as const, label: 'Applied' },
    rejected: { variant: 'destructive' as const, label: 'Rejected' },
  }[action.status] || { variant: 'outline' as const, label: action.status };

  const scores = latestTest?.details?.scores;
  const recommendation = latestTest?.details?.recommendation;
  const financing = latestTest?.details?.financing_notes;

  const handleApply = async () => {
    if (!projectId || applying) return;
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-project-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          actionId: action.id,
          patch: action.patch || {},
          changeType: action.action_type,
        }),
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Apply failed');

      // Action status is now updated server-side
      const regenCount = result.docs_regenerated_count || 0;
      const errCount = result.regeneration_errors?.length || 0;

      if (regenCount > 0) {
        toast.success(`Applied! ${regenCount} document${regenCount > 1 ? 's' : ''} regenerated.`);
      } else if (result.affected_doc_types?.length > 0 && regenCount === 0) {
        toast.success('Applied! Affected documents have no versions yet — generate them first.');
      } else {
        toast.success('Change applied successfully');
      }

      if (errCount > 0) {
        toast.warning(`${errCount} document${errCount > 1 ? 's' : ''} failed to regenerate.`);
      }
    } catch (e: any) {
      console.error('[DocAssistant] Apply error:', e);
      toast.error(e.message || 'Failed to apply change');
    } finally {
      setApplying(false);
    }
  };

  const handleReject = async () => {
    try {
      await (supabase as any).from('document_assistant_actions')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', action.id);
      toast.info('Action rejected');
    } catch (e: any) {
      toast.error('Failed to reject action');
    }
  };

  return (
    <Card className="text-xs">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium truncate flex-1">{action.human_summary}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            {latestTest && (
              <Badge variant={
                latestTest.status === 'passed' ? 'default' :
                latestTest.status === 'failed' ? 'destructive' :
                latestTest.status === 'running' ? 'secondary' : 'outline'
              } className="text-[9px]">
                {latestTest.status === 'running' && <Loader2 className="h-2 w-2 animate-spin mr-0.5" />}
                {latestTest.status === 'passed' && <CheckCircle className="h-2 w-2 mr-0.5" />}
                {latestTest.status === 'failed' && <XCircle className="h-2 w-2 mr-0.5" />}
                {latestTest.status === 'error' && <AlertTriangle className="h-2 w-2 mr-0.5" />}
                {latestTest.status}
              </Badge>
            )}
            <Badge variant={statusBadge.variant} className="text-[9px]">{statusBadge.label}</Badge>
          </div>
        </div>
      </CardHeader>

      {scores && (
        <CardContent className="px-3 pb-2 pt-0 space-y-0.5">
          {['story_coherence', 'character_compelling', 'emotional_engagement', 'market_fit', 'finance_viability', 'buyer_attachability', 'budget_risk'].map(k => {
            const s = scores[k];
            if (!s) return null;
            return <ScoreDelta key={k} label={k} baseline={s.baseline} after={s.after} />;
          })}
        </CardContent>
      )}

      {/* Apply / Reject buttons — only when ready */}
      {action.status === 'ready_to_apply' && (
        <div className="px-3 pb-2 flex gap-1.5">
          <Button size="sm" className="flex-1 h-7 text-[10px] gap-1" onClick={handleApply} disabled={applying}>
            {applying ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
            Apply
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={handleReject}>
            <XCircle className="h-2.5 w-2.5" /> Reject
          </Button>
        </div>
      )}

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full h-6 text-[10px] gap-1 rounded-t-none">
            <ChevronDown className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-180")} />
            {detailsOpen ? 'Hide' : 'Show'} Details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-3 pb-3 pt-1 space-y-2 text-[11px]">
            {recommendation && (
              <div>
                <Badge variant={recommendation.verdict === 'APPLY' ? 'default' : recommendation.verdict === 'DONT_APPLY' ? 'destructive' : 'secondary'} className="text-[9px] mb-1">
                  {recommendation.verdict}
                  {recommendation.confidence != null && ` (${Math.round(recommendation.confidence * 100)}%)`}
                </Badge>
                {recommendation.why?.map((w: string, i: number) => (
                  <p key={i} className="text-muted-foreground">• {w}</p>
                ))}
                {recommendation.next_steps?.length > 0 && (
                  <div className="mt-1">
                    <p className="font-medium">Next steps:</p>
                    {recommendation.next_steps.map((s: string, i: number) => (
                      <p key={i} className="text-muted-foreground">→ {s}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {financing && (
              <div>
                <p className="font-medium">Financing</p>
                <p className="text-muted-foreground">Budget band: {financing.target_budget_band}</p>
                {financing.sales_red_flags?.length > 0 && (
                  <p className="text-destructive">⚠ {financing.sales_red_flags.join(', ')}</p>
                )}
                {financing.who_might_buy?.length > 0 && (
                  <p className="text-muted-foreground">Buyers: {financing.who_might_buy.join(', ')}</p>
                )}
              </div>
            )}

            {latestTest?.summary && (
              <p className="text-muted-foreground italic">{latestTest.summary}</p>
            )}

            {latestTest?.logs && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1">Show logs</Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="text-[9px] bg-muted/50 p-2 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {latestTest.logs.slice(0, 3000)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function DocAssistantDrawer({
  projectId, selectedDocType, selectedVersionId, selectedVersionText, onVersionCreated,
}: DocAssistantDrawerProps) {
  const assistant = useDocAssistantPersistent(projectId);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [assistant.messages]);

  const handleSubmit = () => {
    if (!input.trim() || assistant.isSending) return;
    assistant.sendMessage.mutate(input.trim());
    setInput('');
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Ask / Propose
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[520px] sm:w-[560px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <SheetTitle className="text-base">Document Assistant</SheetTitle>
          {assistant.hasRunningTests && (
            <Badge variant="secondary" className="text-[10px] w-fit">
              <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" /> Simulations running…
            </Badge>
          )}
        </SheetHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat messages */}
          <ScrollArea className="flex-1 px-4 py-3">
            <div ref={scrollRef} className="space-y-3">
              {assistant.isLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : assistant.messages.length === 0 ? (
                <div className="text-center py-8">
                  <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">Ask anything about this project</p>
                  <p className="text-xs text-muted-foreground/60">
                    "What if we changed the ending?" · "Reduce the budget scope" · "Strengthen the antagonist"
                  </p>
                </div>
              ) : (
                assistant.messages.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-2.5", msg.role === 'user' ? "justify-end" : "justify-start")}>
                    {msg.role !== 'user' && (
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[80%] rounded-xl px-3.5 py-2.5",
                      msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      {msg.role === 'user' ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : msg.metadata?.stage === 'ack' ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running simulations…
                        </div>
                      ) : (
                        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                    {msg.role === 'user' && (
                      <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-3.5 w-3.5 text-foreground" />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Action cards */}
          {assistant.actions.length > 0 && (
            <div className="border-t px-4 py-2 max-h-[40%] overflow-y-auto">
              <p className="text-[10px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Proposed Actions ({assistant.actions.length})
              </p>
              <div className="space-y-2">
                {assistant.actions.map(action => (
                  <ActionCard key={action.id} action={action} projectId={projectId} />
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t px-4 py-3 space-y-2">
            <Textarea
              placeholder="Ask a question or propose a change…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-[60px] text-sm resize-none"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
            />
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || assistant.isSending}
              className="w-full gap-1.5"
              size="sm"
            >
              {assistant.isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

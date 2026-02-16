import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  MessageSquare, Lightbulb, FlaskConical, Check, Loader2, Send,
  FileText, Package, AlertTriangle, CheckCircle, XCircle, RefreshCw, Sparkles,
} from 'lucide-react';
import { useDocAssistant, type AssistantMode, type AssistantScope } from '@/hooks/useDocAssistant';
import ReactMarkdown from 'react-markdown';

interface DocAssistantDrawerProps {
  projectId: string | undefined;
  selectedDocType?: string;
  selectedVersionId?: string;
  selectedVersionText?: string;
  onVersionCreated?: (versionId: string) => void;
}

const MODE_CONFIG: Record<AssistantMode, { icon: any; label: string; description: string }> = {
  ask: { icon: MessageSquare, label: 'Ask', description: 'Ask about documents' },
  propose: { icon: Lightbulb, label: 'Propose', description: 'Suggest a change' },
  test: { icon: FlaskConical, label: 'Test', description: 'Test proposal impact' },
  apply: { icon: Check, label: 'Apply', description: 'Apply changes' },
};

const SCOPE_OPTIONS: { value: AssistantScope; label: string; icon: any }[] = [
  { value: 'current_doc', label: 'This Document', icon: FileText },
  { value: 'full_package', label: 'Full Package', icon: Package },
];

export function DocAssistantDrawer({
  projectId, selectedDocType, selectedVersionId, selectedVersionText, onVersionCreated,
}: DocAssistantDrawerProps) {
  const assistant = useDocAssistant(projectId);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);

  // Auto-index current doc when drawer opens
  useEffect(() => {
    if (open && selectedVersionId && selectedVersionText && !isIndexed) {
      assistant.chunkDocument.mutate({
        versionId: selectedVersionId,
        docType: selectedDocType || 'unknown',
        text: selectedVersionText,
      }, { onSuccess: () => setIsIndexed(true) });
    }
  }, [open, selectedVersionId]); // eslint-disable-line

  // Reset indexed state when version changes
  useEffect(() => { setIsIndexed(false); }, [selectedVersionId]);

  const handleSubmit = () => {
    if (!input.trim()) return;
    if (assistant.mode === 'ask') {
      assistant.ask.mutate({
        queryText: input, docVersionId: selectedVersionId, docType: selectedDocType,
      });
    } else if (assistant.mode === 'propose') {
      assistant.propose.mutate({
        targetDocType: selectedDocType || 'unknown',
        targetVersionId: selectedVersionId,
        proposalText: input,
      });
    }
    setInput('');
  };

  const handleTest = () => {
    if (assistant.lastProposal?.proposalId) {
      assistant.testProposal.mutate(assistant.lastProposal.proposalId);
    }
  };

  const handleApply = () => {
    if (assistant.lastProposal?.proposalId) {
      assistant.applyProposal.mutate(assistant.lastProposal.proposalId, {
        onSuccess: (data) => {
          if (data.draftVersionId && onVersionCreated) onVersionCreated(data.draftVersionId);
        },
      });
    }
  };

  const report = assistant.lastTestReport;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Ask / Propose
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[480px] sm:w-[520px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <SheetTitle className="text-base">Document Assistant</SheetTitle>
        </SheetHeader>

        <div className="px-4 py-2 border-b space-y-2">
          {/* Mode tabs */}
          <Tabs value={assistant.mode} onValueChange={(v) => { assistant.setMode(v as AssistantMode); assistant.reset(); }}>
            <TabsList className="grid grid-cols-4 w-full">
              {(Object.entries(MODE_CONFIG) as [AssistantMode, typeof MODE_CONFIG['ask']][]).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <TabsTrigger key={key} value={key} className="text-xs gap-1">
                    <Icon className="h-3 w-3" /> {cfg.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {/* Scope selector */}
          {(assistant.mode === 'ask' || assistant.mode === 'propose') && (
            <Select value={assistant.scope} onValueChange={(v) => assistant.setScope(v as AssistantScope)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3" /> {opt.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Main content */}
        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-3">
            {/* Indexing status */}
            {assistant.chunkDocument.isPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Indexing document for search…
              </div>
            )}

            {/* Ask mode results */}
            {assistant.mode === 'ask' && assistant.lastAnswer && (
              <Card>
                <CardContent className="pt-4 text-sm prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{assistant.lastAnswer.answer}</ReactMarkdown>
                  {assistant.lastAnswer.citations.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Sources:</p>
                      {assistant.lastAnswer.citations.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] mr-1">
                          {c.doc_type} #{c.chunk_index}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Propose mode results */}
            {assistant.mode === 'propose' && assistant.lastProposal && (
              <div className="space-y-2">
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> Draft Revision
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <pre className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto bg-muted/50 p-2 rounded text-foreground">
                      {assistant.lastProposal.draftText?.slice(0, 3000)}
                      {(assistant.lastProposal.draftText?.length || 0) > 3000 && '\n\n[... truncated]'}
                    </pre>
                  </CardContent>
                </Card>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleTest} disabled={assistant.isProcessing} className="flex-1">
                    {assistant.testProposal.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}
                    Run Tests
                  </Button>
                </div>
              </div>
            )}

            {/* Test mode results */}
            {(assistant.mode === 'test' || assistant.mode === 'propose') && report && (
              <Card>
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <FlaskConical className="h-3 w-3" /> Test Report
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {/* Test results */}
                  {[
                    { key: 'canonical_test', label: 'Canonical Constraints' },
                    { key: 'continuity_test', label: 'Continuity' },
                    { key: 'style_test', label: 'Style & Tone' },
                  ].map(({ key, label }) => {
                    const test = (report as any)[key];
                    if (!test) return null;
                    return (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span>{label}</span>
                        {test.pass ? (
                          <Badge variant="default" className="text-[10px]">
                            <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Pass
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" /> Fail
                          </Badge>
                        )}
                      </div>
                    );
                  })}

                  {/* Impact scores */}
                  {report.impact_scores && (
                    <div className="space-y-1.5 mt-2">
                      <p className="text-xs font-medium">Impact Scores</p>
                      {Object.entries(report.impact_scores).map(([k, v]) => (
                        <div key={k} className="space-y-0.5">
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span className="capitalize">{k}</span>
                            <span>{v}</span>
                          </div>
                          <Progress value={v as number} className="h-1" />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Stale dependencies */}
                  {report.stale_dependencies && report.stale_dependencies.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-warning" />
                        Would make stale:
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {report.stale_dependencies.map((d) => (
                          <Badge key={d} variant="outline" className="text-[10px]">{d}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  {report.summary && (
                    <p className="text-xs text-muted-foreground mt-2">{report.summary}</p>
                  )}

                  {/* Recommendation + Apply button */}
                  <div className="flex items-center gap-2 mt-2">
                    {report.recommendation && (
                      <Badge variant={
                        report.recommendation === 'approve' ? 'default' :
                        report.recommendation === 'reject' ? 'destructive' : 'secondary'
                      } className="text-[10px]">
                        {report.recommendation}
                      </Badge>
                    )}
                    {report.recommendation !== 'reject' && (
                      <Button size="sm" onClick={handleApply} disabled={assistant.isProcessing} className="flex-1">
                        {assistant.applyProposal.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                        Apply as Decision
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Apply mode: show recent proposals */}
            {assistant.mode === 'apply' && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Recent Proposals</p>
                {assistant.proposals.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No proposals yet</p>
                )}
                {assistant.proposals.slice(0, 10).map((p: any) => (
                  <Card key={p.id} className="text-xs">
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate flex-1">{p.proposal_text?.slice(0, 60)}</span>
                        <Badge variant={
                          p.status === 'applied' ? 'default' :
                          p.status === 'tested' ? 'secondary' :
                          p.status === 'rejected' ? 'destructive' : 'outline'
                        } className="text-[10px] ml-2">
                          {p.status}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">{p.target_doc_type}</span>
                      {p.status === 'tested' && (
                        <Button size="sm" variant="outline" className="w-full mt-1 h-6 text-[10px]"
                          onClick={() => assistant.applyProposal.mutate(p.id, {
                            onSuccess: (data) => {
                              if (data.draftVersionId && onVersionCreated) onVersionCreated(data.draftVersionId);
                            },
                          })}
                          disabled={assistant.isProcessing}>
                          Apply
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area (for ask / propose modes) */}
        {(assistant.mode === 'ask' || assistant.mode === 'propose') && (
          <div className="border-t px-4 py-3 space-y-2">
            <Textarea
              placeholder={assistant.mode === 'ask'
                ? 'Ask a question about this document…'
                : 'Describe the change you want to make…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-[60px] text-sm resize-none"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
            />
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || assistant.isProcessing}
              className="w-full gap-1.5"
              size="sm"
            >
              {assistant.isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {assistant.mode === 'ask' ? 'Ask' : 'Propose Change'}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * NoteWritersRoomDrawer — Sheet-based Writers' Room for a single note.
 * Tabs: Discuss, Options, Synthesis, Plan.
 * Detects "apply" intent in chat to auto-propose a change plan.
 */
import { useState, useEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Send, Pin, X, Sparkles, Check, CheckCircle2,
  AlertTriangle, Lightbulb, Layers, Zap, FileEdit,
} from 'lucide-react';
import { useNoteWritersRoom } from '@/hooks/useNoteWritersRoom';
import { noteFingerprint } from '@/lib/decisions/fingerprint';
import { ChangePlanPanel } from './ChangePlanPanel';
import type { NoteOption, NoteOptionSet, NoteThreadSynthesis, ChangePlan } from '@/lib/types/writers-room';
import ReactMarkdown from 'react-markdown';

interface NoteWritersRoomDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documentId: string;
  versionId?: string;
  note: any;
  scriptContext?: string;
}

function computeNoteHash(note: any): string {
  if (note.note_hash) return note.note_hash;
  if (note.hash) return note.hash;
  return noteFingerprint(note);
}

const APPLY_INTENT_PATTERNS = [
  /\bok\b.*\bapply/i,
  /\bapply\s+that/i,
  /\blet'?s\s+apply/i,
  /\bdo\s+it\b/i,
  /\bgo\s+with\s+that/i,
  /\bapply\s+this/i,
  /\bapply\s+changes/i,
  /\bmake\s+(the\s+)?changes/i,
];

function hasApplyIntent(text: string): boolean {
  return APPLY_INTENT_PATTERNS.some(p => p.test(text));
}

export function NoteWritersRoomDrawer({
  open, onOpenChange, projectId, documentId, versionId, note, scriptContext,
}: NoteWritersRoomDrawerProps) {
  const noteHash = computeNoteHash(note);
  const noteSnapshot = {
    summary: note.note || note.description || '',
    detail: note.why_it_matters || note.detail || '',
    category: note.category,
    severity: note.severity,
    anchor: note.anchor,
    type: note.type,
  };

  const {
    query, planQuery, ensureThread, postMessage, updateState, generateOptions,
    selectOption, synthesizeBest, proposeChangePlan, confirmChangePlan, applyChangePlan,
    threadId,
  } = useNoteWritersRoom({
    projectId, documentId, noteHash, versionId,
    noteSnapshot, enabled: open,
  });

  const [tab, setTab] = useState('discuss');
  const [showPlan, setShowPlan] = useState(false);
  const [message, setMessage] = useState('');
  const [newPin, setNewPin] = useState('');
  const [directionMode, setDirectionMode] = useState('writers_room');
  const [directionNotes, setDirectionNotes] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const data = query.data;
  const state = data?.state;
  const messages = data?.messages || [];
  const optionSets = data?.optionSets || [];
  const selectedOption = state?.selected_option;
  const synthesis = state?.synthesis;
  const pins = state?.pinned_constraints || [];
  const currentPlan = planQuery.data;

  useEffect(() => {
    if (open && !query.data && !query.isLoading) {
      ensureThread.mutate();
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (state?.direction) {
      setDirectionMode(state.direction.mode || 'writers_room');
      setDirectionNotes(state.direction.notes || '');
    }
  }, [state?.direction]);

  // Auto-show plan panel when plan arrives
  useEffect(() => {
    if (currentPlan && (currentPlan.status === 'draft' || currentPlan.status === 'confirmed')) {
      setShowPlan(true);
      setTab('plan');
    }
  }, [currentPlan?.id]);

  function handleSendMessage() {
    if (!message.trim()) return;
    const text = message.trim();
    postMessage.mutate(text);
    setMessage('');

    // Detect apply intent → auto-propose plan
    if (hasApplyIntent(text)) {
      setTimeout(() => {
        proposeChangePlan.mutate();
      }, 1500); // Let message post first
    }
  }

  function handleAddPin() {
    if (!newPin.trim()) return;
    const updated = [...pins, newPin.trim()];
    updateState.mutate({ pinnedConstraints: updated });
    setNewPin('');
  }

  function handleRemovePin(idx: number) {
    const updated = pins.filter((_: string, i: number) => i !== idx);
    updateState.mutate({ pinnedConstraints: updated });
  }

  function handleSaveDirection() {
    updateState.mutate({
      direction: {
        mode: directionMode,
        notes: directionNotes,
      },
    });
  }

  function handleSelectOption(option: NoteOption) {
    selectOption.mutate(option);
  }

  function handleConfirmPlan(planId: string, editedPlan: ChangePlan) {
    confirmChangePlan.mutate({ planId, planPatch: editedPlan });
  }

  function handleApplyPlan(planId: string) {
    applyChangePlan.mutate(planId);
  }

  function handleRevisePlan(summary: string) {
    // Pin the plan summary as a constraint and go back to chat
    const updated = [...pins, `Previous plan: ${summary.slice(0, 200)}`];
    updateState.mutate({ pinnedConstraints: updated });
    setShowPlan(false);
    setTab('discuss');
  }

  const isLoading = query.isLoading || ensureThread.isPending;
  const hasPlan = !!currentPlan;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Writers' Room
          </SheetTitle>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {note.note || note.description || 'Note discussion'}
          </p>
        </SheetHeader>

        {/* Direction controls */}
        <div className="px-4 py-2 border-b border-border/40 space-y-2">
          <div className="flex items-center gap-2">
            <Select value={directionMode} onValueChange={setDirectionMode}>
              <SelectTrigger className="h-7 text-xs w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="writers_room">Writers' Room</SelectItem>
                <SelectItem value="producer_brain">Producer Brain</SelectItem>
                <SelectItem value="script_doctor">Script Doctor</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Direction notes..."
              value={directionNotes}
              onChange={(e) => setDirectionNotes(e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={handleSaveDirection}
              disabled={updateState.isPending}>
              {updateState.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showPlan && currentPlan ? (
          <ChangePlanPanel
            planRow={currentPlan}
            onConfirm={handleConfirmPlan}
            onApply={handleApplyPlan}
            onRevise={handleRevisePlan}
            onBack={() => { setShowPlan(false); setTab('discuss'); }}
            isConfirming={confirmChangePlan.isPending}
            isApplying={applyChangePlan.isPending}
          />
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-4 mt-2">
              <TabsTrigger value="discuss" className="text-xs">Discuss</TabsTrigger>
              <TabsTrigger value="options" className="text-xs">
                Options {optionSets.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1">{optionSets.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="synthesis" className="text-xs">Synthesis</TabsTrigger>
              {hasPlan && (
                <TabsTrigger value="plan" className="text-xs">
                  <FileEdit className="h-3 w-3 mr-1" />Plan
                </TabsTrigger>
              )}
            </TabsList>

            {/* ── DISCUSS TAB ── */}
            <TabsContent value="discuss" className="flex-1 flex flex-col min-h-0 m-0 px-4 py-2">
              {/* Pins */}
              <div className="space-y-1 mb-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Pin className="h-3 w-3" /> Locked constraints
                </div>
                <div className="flex flex-wrap gap-1">
                  {pins.map((pin: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0 gap-1">
                      {pin}
                      <button onClick={() => handleRemovePin(i)}>
                        <X className="h-2 w-2" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1">
                  <Input placeholder="Add constraint..." value={newPin} onChange={(e) => setNewPin(e.target.value)}
                    className="h-6 text-[10px] flex-1" onKeyDown={(e) => e.key === 'Enter' && handleAddPin()} />
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={handleAddPin}>
                    <Pin className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <Separator className="my-1" />

              {/* Chat messages */}
              <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
                <div className="space-y-2 pr-2 py-1">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}>
                        {msg.role === 'assistant' ? (
                          <div className="prose prose-xs prose-invert max-w-none [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:text-xs [&_p]:mb-1.5 [&_p]:leading-relaxed [&_ul]:text-xs [&_ul]:pl-4 [&_ul]:mb-1.5 [&_ol]:text-xs [&_ol]:pl-4 [&_ol]:mb-1.5 [&_li]:mb-0.5 [&_strong]:font-semibold [&_em]:italic [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_code]:bg-background/50 [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px]">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {(postMessage.isPending || proposeChangePlan.isPending) && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          {proposeChangePlan.isPending && (
                            <span className="text-[10px] text-muted-foreground">Generating change plan...</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Message input + action buttons */}
              <div className="space-y-2 mt-2">
                <div className="flex gap-1">
                  <Textarea
                    placeholder="Discuss this note... (say 'apply that' to generate a change plan)"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[40px] h-10 text-xs flex-1 resize-none"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  />
                  <Button size="sm" className="h-10 px-3" onClick={handleSendMessage} disabled={postMessage.isPending || !message.trim()}>
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1 flex-1"
                    onClick={() => proposeChangePlan.mutate()}
                    disabled={proposeChangePlan.isPending || !threadId}
                  >
                    {proposeChangePlan.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Proposing...</>
                      : <><FileEdit className="h-3 w-3" /> Propose changes</>
                    }
                  </Button>
                  {hasPlan && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-xs h-7 gap-1"
                      onClick={() => setShowPlan(true)}
                    >
                      <FileEdit className="h-3 w-3" /> View plan
                    </Button>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── OPTIONS TAB ── */}
            <TabsContent value="options" className="flex-1 min-h-0 m-0 px-4 py-2 overflow-auto">
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-2">
                  {optionSets.map((set: NoteOptionSet) => (
                    <div key={set.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">Set #{set.option_set_index}</Badge>
                        <span className="text-[9px] text-muted-foreground">{new Date(set.created_at).toLocaleString()}</span>
                      </div>
                      {(set.options || []).map((opt: NoteOption) => {
                        const isSelected = selectedOption?.id === opt.id;
                        return (
                          <div key={opt.id} className={`rounded border p-2 space-y-1 transition-colors ${
                            isSelected ? 'border-primary/60 bg-primary/5' : 'border-border/40 hover:border-border/60'
                          }`}>
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleSelectOption(opt)}
                                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                                }`}>
                                {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </button>
                              <p className="text-xs font-medium text-foreground flex-1">{opt.pitch}</p>
                              <Badge variant="outline" className="text-[8px] px-1">{opt.scope_estimate}</Badge>
                            </div>
                            <div className="pl-6 space-y-0.5">
                              <div className="flex flex-wrap gap-0.5">
                                {opt.what_changes?.map((c, i) => (
                                  <Badge key={i} variant="outline" className="text-[7px] px-1 py-0">{c}</Badge>
                                ))}
                              </div>
                              {opt.pros?.length > 0 && (
                                <p className="text-[9px] text-emerald-500">✓ {opt.pros.join(' • ')}</p>
                              )}
                              {opt.cons?.length > 0 && (
                                <p className="text-[9px] text-amber-500">⚠ {opt.cons.join(' • ')}</p>
                              )}
                              {opt.risk_flags?.length > 0 && (
                                <div className="flex flex-wrap gap-0.5">
                                  {opt.risk_flags.map((r, i) => (
                                    <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 border-destructive/30 text-destructive">
                                      <AlertTriangle className="h-2 w-2 mr-0.5" />{r}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {opt.rewrite_instructions?.length > 0 && (
                                <div className="text-[9px] text-muted-foreground mt-1">
                                  <span className="font-medium">Rewrite:</span>
                                  <ul className="list-disc pl-3 mt-0.5">
                                    {opt.rewrite_instructions.map((r, i) => <li key={i}>{r}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  <Button variant="outline" className="w-full text-xs h-8 gap-1"
                    onClick={() => generateOptions.mutate(scriptContext)}
                    disabled={generateOptions.isPending}>
                    {generateOptions.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                      : <><Lightbulb className="h-3 w-3" /> Find other solutions</>
                    }
                  </Button>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── SYNTHESIS TAB ── */}
            <TabsContent value="synthesis" className="flex-1 min-h-0 m-0 px-4 py-2 overflow-auto">
              {synthesis ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium">Synthesis Complete</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">Direction Summary</p>
                      <p className="text-xs text-foreground">{synthesis.direction_summary}</p>
                    </div>
                    {synthesis.locked_constraints_used?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground">Constraints Used</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {synthesis.locked_constraints_used.map((c, i) => (
                            <Badge key={i} variant="outline" className="text-[8px]">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">Rewrite Plan</p>
                      <ol className="list-decimal pl-4 text-xs text-foreground space-y-0.5 mt-0.5">
                        {synthesis.rewrite_plan?.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">Verification Checks</p>
                      <ul className="list-disc pl-4 text-xs text-foreground space-y-0.5 mt-0.5">
                        {synthesis.verification_checks?.map((check, i) => <li key={i}>{check}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Layers className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground text-center">
                    {selectedOption
                      ? 'Ready to synthesize — click below to generate a consolidated rewrite plan.'
                      : 'Select an option from the Options tab first, then synthesize.'}
                  </p>
                  <Button variant="default" className="text-xs h-8 gap-1"
                    onClick={() => synthesizeBest.mutate(scriptContext)}
                    disabled={synthesizeBest.isPending || !selectedOption}>
                    {synthesizeBest.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Synthesizing...</>
                      : <><Zap className="h-3 w-3" /> Synthesize best</>
                    }
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── PLAN TAB ── */}
            {hasPlan && (
              <TabsContent value="plan" className="flex-1 min-h-0 m-0">
                <ChangePlanPanel
                  planRow={currentPlan!}
                  onConfirm={handleConfirmPlan}
                  onApply={handleApplyPlan}
                  onRevise={handleRevisePlan}
                  onBack={() => setTab('discuss')}
                  isConfirming={confirmChangePlan.isPending}
                  isApplying={applyChangePlan.isPending}
                />
              </TabsContent>
            )}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

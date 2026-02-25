/**
 * NoteWritersRoomDrawer — Sheet-based Writers' Room for a single note.
 * Full context pack support: preset loading, custom doc selection, auto-load.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, Send, Pin, X, Sparkles, Check, CheckCircle2,
  AlertTriangle, Lightbulb, Layers, Zap, FileEdit, FileText, Settings2, Trash2,
  History,
} from 'lucide-react';
import { useNoteWritersRoom, type ContextPack, type ProjectDocInfo } from '@/hooks/useNoteWritersRoom';
import { useDocSets, docSetItemOrder, type DocSet, type DocSetWithItems } from '@/hooks/useDocSets';
import { noteFingerprint } from '@/lib/decisions/fingerprint';
import { ChangePlanPanel } from './ChangePlanPanel';
import { ChangesetTimeline } from './ChangesetTimeline';
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
  /\bok\b.*\bapply/i, /\bapply\s+that/i, /\blet'?s\s+apply/i, /\bdo\s+it\b/i,
  /\bgo\s+with\s+that/i, /\bapply\s+this/i, /\bapply\s+changes/i, /\bmake\s+(the\s+)?changes/i,
];

function hasApplyIntent(text: string): boolean {
  return APPLY_INTENT_PATTERNS.some(p => p.test(text));
}

const PRESETS = [
  { key: 'script_pack', label: 'Script Pack', desc: 'Script / screenplay documents' },
  { key: 'development_pack', label: 'Development Pack', desc: 'Idea, brief, market sheet, blueprint, architecture' },
  { key: 'canon_pack', label: 'Canon Pack', desc: 'Character bible, world bible, timeline' },
  { key: 'production_pack', label: 'Production Pack', desc: 'Scene list, shot plan, storyboard' },
  { key: 'approved_pack', label: 'Everything Approved', desc: 'All docs with approved versions' },
];

export function NoteWritersRoomDrawer({
  open, onOpenChange, projectId, documentId, versionId, note,
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
    query, planQuery, docsQuery, ensureThread, loadContextPack, postMessage, updateState,
    generateOptions, selectOption, synthesizeBest, proposeChangePlan, confirmChangePlan,
    applyChangePlan, threadId,
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

  // Context state
  const [contextPack, setContextPack] = useState<ContextPack | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [showContextModal, setShowContextModal] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Custom selection state
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [customVersionPref, setCustomVersionPref] = useState('current');
  const [customMode, setCustomMode] = useState('end');

  // Doc sets integration
  const docSets = useDocSets(projectId);
  const docSetsList = docSets.listQuery.data || [];
  const defaultDocSet = docSetsList.find(s => s.is_default);

  const data = query.data;
  const state = data?.state;
  const messages = data?.messages || [];
  const optionSets = data?.optionSets || [];
  const selectedOption = state?.selected_option;
  const synthesis = state?.synthesis;
  const pins = state?.pinned_constraints || [];
  const currentPlan = planQuery.data;
  const projectDocs = docsQuery.data || [];

  // ── Load doc set as context ──
  const loadDocSetContext = useCallback(async (docSetId: string) => {
    setContextLoading(true);
    setContextError(null);
    try {
      const full = await docSets.fetchDocSet(docSetId);
      const ids = docSetItemOrder(full.items);
      if (ids.length === 0) {
        setContextError('Doc set has no documents');
        return;
      }
      const result = await loadContextPack.mutateAsync({ includeDocumentIds: ids, mode: 'end' });
      if (result.ok && result.contextPack) {
        setContextPack({ ...result.contextPack, presetKey: `docset:${full.name}` });
      } else {
        setContextError('Failed to load doc set context');
      }
    } catch (e: any) {
      setContextError(e.message);
    } finally {
      setContextLoading(false);
    }
  }, [docSets, loadContextPack]);

  // ── Auto-load context on drawer open ──
  const loadPreset = useCallback(async (presetKey: string, mode = 'end') => {
    setContextLoading(true);
    setContextError(null);
    try {
      const result = await loadContextPack.mutateAsync({ presetKey, mode });
      if (result.ok && result.contextPack) {
        setContextPack(result.contextPack);
      } else {
        // Try fallback: script_pack
        if (presetKey !== 'script_pack') {
          const fallback = await loadContextPack.mutateAsync({ presetKey: 'script_pack', mode });
          if (fallback.ok && fallback.contextPack) {
            setContextPack(fallback.contextPack);
          } else {
            setContextError('No documents found for this preset');
          }
        } else {
          setContextError('No script documents found');
        }
      }
    } catch (e: any) {
      setContextError(e.message);
    } finally {
      setContextLoading(false);
    }
  }, [loadContextPack]);

  useEffect(() => {
    if (open && !autoLoaded && !contextPack) {
      setAutoLoaded(true);
      // If default doc set exists, use it; otherwise fall back to script_pack
      if (defaultDocSet) {
        loadDocSetContext(defaultDocSet.id);
      } else {
        loadPreset('script_pack', 'end');
      }
    }
  }, [open, autoLoaded, contextPack, loadPreset, defaultDocSet, loadDocSetContext]);

  // Reset auto-loaded when drawer closes
  useEffect(() => {
    if (!open) {
      setAutoLoaded(false);
    }
  }, [open]);

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

  useEffect(() => {
    if (currentPlan && (currentPlan.status === 'draft' || currentPlan.status === 'confirmed')) {
      setShowPlan(true);
      setTab('plan');
    }
  }, [currentPlan?.id]);

  function handleSendMessage() {
    if (!message.trim()) return;
    const text = message.trim();
    postMessage.mutate({ content: text, contextPack: contextPack || undefined });
    setMessage('');

    if (hasApplyIntent(text)) {
      setTimeout(() => {
        proposeChangePlan.mutate(contextPack || undefined);
      }, 1500);
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
    updateState.mutate({ direction: { mode: directionMode, notes: directionNotes } });
  }

  function handleSelectOption(option: NoteOption) {
    selectOption.mutate(option);
  }

  function handleConfirmPlan(planId: string, editedPlan: ChangePlan) {
    confirmChangePlan.mutate({ planId, planPatch: editedPlan });
  }

  function handleApplyPlan(planId: string) {
    applyChangePlan.mutate({ planId });
  }

  function handleRevisePlan(summary: string) {
    const updated = [...pins, `Previous plan: ${summary.slice(0, 200)}`];
    updateState.mutate({ pinnedConstraints: updated });
    setShowPlan(false);
    setTab('discuss');
  }

  async function handleLoadCustomContext() {
    if (selectedDocIds.length === 0) return;
    setContextLoading(true);
    setContextError(null);
    setShowContextModal(false);
    try {
      const result = await loadContextPack.mutateAsync({
        includeDocumentIds: selectedDocIds,
        versionPreference: customVersionPref,
        mode: customMode,
      });
      if (result.ok && result.contextPack) {
        setContextPack(result.contextPack);
      } else {
        setContextError('No text found for selected documents');
      }
    } catch (e: any) {
      setContextError(e.message);
    } finally {
      setContextLoading(false);
    }
  }

  function handleClearContext() {
    setContextPack(null);
    setContextError(null);
  }

  const isLoading = query.isLoading || ensureThread.isPending;
  const hasPlan = !!currentPlan;

  // Context indicator
  const contextLabel = contextPack
    ? `${contextPack.presetKey === 'custom' ? 'Custom' : PRESETS.find(p => p.key === contextPack.presetKey)?.label || contextPack.presetKey} • ${contextPack.docs.length} doc${contextPack.docs.length !== 1 ? 's' : ''}`
    : null;
  const latestUpdate = contextPack?.docs?.length
    ? new Date(Math.max(...contextPack.docs.map(d => new Date(d.updatedAt).getTime()))).toLocaleDateString()
    : null;

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

        {/* Context indicator bar */}
        <div className="px-4 py-1.5 border-b border-border/30 flex items-center gap-1.5 text-[10px]">
          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
          {contextLoading ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading context…
            </span>
          ) : contextError ? (
            <span className="flex items-center gap-1 text-destructive">
              Context load failed
              <Button variant="ghost" size="sm" className="h-4 text-[9px] px-1 py-0" onClick={() => loadPreset('script_pack')}>
                Retry
              </Button>
            </span>
          ) : contextPack ? (
            <span className="flex items-center gap-1 text-muted-foreground flex-1 min-w-0">
              <span className="truncate">
                Context: {contextLabel}{latestUpdate ? ` • ${latestUpdate}` : ''}
              </span>
              <Button variant="ghost" size="sm" className="h-4 text-[9px] px-1 py-0 shrink-0" onClick={() => setShowContextModal(true)}>
                <Settings2 className="h-2.5 w-2.5 mr-0.5" />Change
              </Button>
              <Button variant="ghost" size="sm" className="h-4 text-[9px] px-1 py-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={handleClearContext}>
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              Context: None
              <Button variant="ghost" size="sm" className="h-4 text-[9px] px-1.5 py-0 text-primary" onClick={() => setShowContextModal(true)}>
                Load context
              </Button>
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showPlan && currentPlan ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <ChangePlanPanel
              planRow={currentPlan}
              onConfirm={handleConfirmPlan}
              onApply={handleApplyPlan}
              onRevise={handleRevisePlan}
              onBack={() => { setShowPlan(false); setTab('discuss'); }}
              isConfirming={confirmChangePlan.isPending}
              isApplying={applyChangePlan.isPending}
            />
          </div>
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
              <TabsTrigger value="history" className="text-xs">
                <History className="h-3 w-3 mr-1" />History
              </TabsTrigger>
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
                    className="min-h-[60px] text-xs flex-1 resize-none"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  />
                  <Button size="sm" className="h-[60px] px-3" onClick={handleSendMessage} disabled={postMessage.isPending || !message.trim()}>
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline" size="sm" className="text-xs h-7 gap-1 flex-1"
                    onClick={() => proposeChangePlan.mutate(contextPack || undefined)}
                    disabled={proposeChangePlan.isPending || !threadId}
                  >
                    {proposeChangePlan.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Proposing...</>
                      : <><FileEdit className="h-3 w-3" /> Propose changes</>
                    }
                  </Button>
                  {hasPlan && (
                    <Button variant="secondary" size="sm" className="text-xs h-7 gap-1" onClick={() => setShowPlan(true)}>
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
                    onClick={() => generateOptions.mutate(contextPack || undefined)}
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
                    onClick={() => synthesizeBest.mutate(contextPack || undefined)}
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

            {/* ── HISTORY TAB ── */}
            <TabsContent value="history" className="flex-1 min-h-0 m-0 px-4 py-2">
              <ChangesetTimeline projectId={projectId} documentId={documentId} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>

      {/* ── Context Picker Modal ── */}
      <Dialog open={showContextModal} onOpenChange={setShowContextModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Load Context</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Presets */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Presets (one-click)</p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESETS.map(preset => (
                  <Button
                    key={preset.key}
                    variant="outline"
                    size="sm"
                    className="h-auto py-2 px-3 text-left flex flex-col items-start gap-0.5"
                    disabled={contextLoading}
                    onClick={() => {
                      setShowContextModal(false);
                      loadPreset(preset.key);
                    }}
                  >
                    <span className="text-xs font-medium">{preset.label}</span>
                    <span className="text-[9px] text-muted-foreground">{preset.desc}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Doc Sets */}
            {docSetsList.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Doc Sets
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {docSetsList.map(ds => (
                      <Button
                        key={ds.id}
                        variant="outline"
                        size="sm"
                        className="h-auto py-2 px-3 text-left flex flex-col items-start gap-0.5"
                        disabled={contextLoading}
                        onClick={() => {
                          setShowContextModal(false);
                          loadDocSetContext(ds.id);
                        }}
                      >
                        <span className="text-xs font-medium flex items-center gap-1">
                          {ds.name}
                          {ds.is_default && <Badge variant="secondary" className="text-[7px] px-1 py-0">Default</Badge>}
                        </span>
                        {ds.description && <span className="text-[9px] text-muted-foreground">{ds.description}</span>}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Custom selection */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Custom Selection</p>

              {docsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading docs…</span>
                </div>
              ) : projectDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No documents in this project</p>
              ) : (
                <>
                  <ScrollArea className="h-40 border rounded-md p-2">
                    <div className="space-y-1">
                      {projectDocs.map((doc) => (
                        <label key={doc.documentId} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/50 rounded px-1">
                          <Checkbox
                            checked={selectedDocIds.includes(doc.documentId)}
                            onCheckedChange={(checked) => {
                              setSelectedDocIds(prev =>
                                checked
                                  ? [...prev, doc.documentId]
                                  : prev.filter(id => id !== doc.documentId)
                              );
                            }}
                          />
                          <span className="text-xs flex-1 truncate">{doc.title}</span>
                          <Badge variant="outline" className="text-[8px] px-1 shrink-0">{doc.docType}</Badge>
                          {doc.currentVersionNumber && (
                            <span className="text-[8px] text-muted-foreground shrink-0">v{doc.currentVersionNumber || doc.latestVersionNumber}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[9px] text-muted-foreground">Version</label>
                      <Select value={customVersionPref} onValueChange={setCustomVersionPref}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">Current</SelectItem>
                          <SelectItem value="latest">Latest</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <label className="text-[9px] text-muted-foreground">Excerpt</label>
                      <Select value={customMode} onValueChange={setCustomMode}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="end">End</SelectItem>
                          <SelectItem value="start">Start</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button
                    className="w-full text-xs h-8"
                    disabled={selectedDocIds.length === 0 || contextLoading}
                    onClick={handleLoadCustomContext}
                  >
                    {contextLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Load {selectedDocIds.length} doc{selectedDocIds.length !== 1 ? 's' : ''}
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

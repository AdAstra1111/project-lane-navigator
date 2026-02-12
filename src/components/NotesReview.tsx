import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, HelpCircle, Pencil,
  Brain, Filter, Search, ListChecks, AlertTriangle, Users, Download,
  MessageSquare
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/hooks/useAuth';
import { useNoteFeedback, StructuredNote, NoteFeedbackEntry } from '@/hooks/useNoteFeedback';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'all', label: 'All', icon: '📋' },
  { value: 'structure', label: 'Structure', icon: '🏗️' },
  { value: 'character', label: 'Character', icon: '👤' },
  { value: 'dialogue', label: 'Dialogue', icon: '💬' },
  { value: 'theme', label: 'Theme', icon: '🎭' },
  { value: 'market', label: 'Market', icon: '📊' },
  { value: 'pacing', label: 'Pacing', icon: '⏱️' },
  { value: 'stakes', label: 'Stakes', icon: '⚡' },
  { value: 'tone', label: 'Tone', icon: '🎨' },
];

const PRIORITIES = [
  { value: 0, label: 'All' },
  { value: 1, label: '🔴 Core' },
  { value: 2, label: '🟡 Important' },
  { value: 3, label: '🟢 Optional' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'resolved', label: 'Resolved' },
];

const TAG_CONFIG: Record<string, { label: string; icon: React.ElementType; colorClass: string }> = {
  great: { label: 'Great note', icon: CheckCircle2, colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' },
  wrong: { label: 'Wrong', icon: XCircle, colorClass: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  vague: { label: 'Too vague', icon: HelpCircle, colorClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' },
  needs_example: { label: 'Needs example', icon: Brain, colorClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30' },
  edited: { label: 'Edited', icon: Pencil, colorClass: 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30' },
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-muted/40 text-muted-foreground border-border/50',
  accepted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  resolved: 'bg-primary/15 text-primary border-primary/30',
};

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-500/15 text-red-400 border-red-500/30',
  2: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  3: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

interface Props {
  notes: StructuredNote[];
  runId: string;
  projectId: string;
  projectType: string;
}

export function NotesReview({ notes, runId, projectId, projectType }: Props) {
  const { user } = useAuth();
  const { feedbackMap, upsertFeedback, getTeamStats } = useNoteFeedback(runId);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTeamOnly, setShowTeamOnly] = useState(false);

  // Navigation
  const [currentIndex, setCurrentIndex] = useState(0);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
      if (priorityFilter > 0 && n.priority !== priorityFilter) return false;
      if (statusFilter !== 'all') {
        const fb = feedbackMap[n.note_id];
        const st = fb?.writer_status || 'open';
        if (st !== statusFilter) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !n.note_text.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [notes, categoryFilter, priorityFilter, statusFilter, searchQuery, feedbackMap]);

  const currentNote = filteredNotes[currentIndex];
  const myFeedback = currentNote ? feedbackMap[currentNote.note_id] : undefined;
  const teamStats = currentNote ? getTeamStats(currentNote.note_id) : null;

  const goTo = (idx: number) => {
    if (idx >= 0 && idx < filteredNotes.length) setCurrentIndex(idx);
  };

  const handleTag = async (tag: string) => {
    if (!currentNote || !user) return;
    if (tag === 'edited') {
      setEditText(myFeedback?.user_edit || currentNote.note_text);
      setEditOpen(true);
      return;
    }
    if (tag === 'wrong' || tag === 'vague') {
      setPendingTag(tag);
      setReasonText('');
      return;
    }
    await upsertFeedback(currentNote.note_id, {
      tag,
      note_snapshot: currentNote,
      category: currentNote.category,
      priority: currentNote.priority,
      section: currentNote.section,
    });
    toast.success(`Tagged as ${TAG_CONFIG[tag]?.label || tag}`);
  };

  const confirmTagWithReason = async () => {
    if (!currentNote || !pendingTag) return;
    await upsertFeedback(currentNote.note_id, {
      tag: pendingTag,
      reason: reasonText || null,
      note_snapshot: currentNote,
      category: currentNote.category,
      priority: currentNote.priority,
      section: currentNote.section,
    });
    toast.success(`Tagged as ${TAG_CONFIG[pendingTag]?.label || pendingTag}`);
    setPendingTag(null);
    setReasonText('');
  };

  const handleSaveEdit = async () => {
    if (!currentNote || !editText.trim()) return;
    await upsertFeedback(currentNote.note_id, {
      tag: 'edited',
      user_edit: editText,
      note_snapshot: currentNote,
      category: currentNote.category,
      priority: currentNote.priority,
      section: currentNote.section,
    });
    toast.success('Edited note saved');
    setEditOpen(false);
  };

  const handleStatusChange = async (status: string) => {
    if (!currentNote) return;
    await upsertFeedback(currentNote.note_id, {
      writer_status: status,
      tag: myFeedback?.tag || 'great',
      note_snapshot: currentNote,
      category: currentNote.category,
      priority: currentNote.priority,
      section: currentNote.section,
    });
    toast.success(`Status → ${status}`);
  };

  const handlePromoteGreat = async () => {
    if (!currentNote || !user) return;
    try {
      await supabase.from('great_notes_library').insert({
        project_type: projectType,
        problem_type: currentNote.category || 'general',
        note_text: currentNote.note_text,
        source_coverage_run_id: runId,
        created_by: user.id,
      } as any);
      toast.success('Promoted to Great Notes Library');
    } catch {
      toast.error('Failed to promote');
    }
  };

  const handleExportChecklist = async () => {
    const accepted = notes.filter(n => feedbackMap[n.note_id]?.writer_status === 'accepted');
    if (!accepted.length) {
      toast.info('No accepted notes to export');
      return;
    }
    const csv = [
      'Priority,Category,Title,Note,Prescription',
      ...accepted.map(n =>
        [n.priority, n.category, `"${n.title}"`, `"${n.note_text.replace(/"/g, '""')}"`, `"${n.prescription.replace(/"/g, '""')}"`].join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revision-checklist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${accepted.length} accepted notes`);
  };

  // Aggregate stats
  const stats = useMemo(() => {
    const s = { open: 0, accepted: 0, rejected: 0, resolved: 0, total: notes.length };
    notes.forEach(n => {
      const st = (feedbackMap[n.note_id]?.writer_status || 'open') as keyof typeof s;
      if (st in s && typeof s[st] === 'number') (s[st] as number)++;
    });
    return s;
  }, [notes, feedbackMap]);

  if (!notes.length) {
    return <p className="text-sm text-muted-foreground">No structured notes available for this coverage run.</p>;
  }

  return (
    <div className="flex gap-4 min-h-[500px]">
      {/* Left Sidebar: Filters */}
      <div className="w-56 shrink-0 space-y-4">
        {/* Stats bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Reviewed</span>
            <span>{stats.total - stats.open}/{stats.total}</span>
          </div>
          <Progress value={((stats.total - stats.open) / stats.total) * 100} className="h-1.5" />
          <div className="flex gap-1.5 flex-wrap">
            {[
              { k: 'accepted', c: 'text-emerald-400' },
              { k: 'rejected', c: 'text-red-400' },
              { k: 'resolved', c: 'text-primary' },
              { k: 'open', c: 'text-muted-foreground' },
            ].map(s => (
              <span key={s.k} className={`text-[10px] ${s.c}`}>
                {stats[s.k as keyof typeof stats]} {s.k}
              </span>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
            placeholder="Search notes…"
            className="h-7 pl-7 text-xs"
          />
        </div>

        {/* Category */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Category</p>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => { setCategoryFilter(c.value); setCurrentIndex(0); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  categoryFilter === c.value
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
                }`}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Priority</p>
          <div className="flex flex-wrap gap-1">
            {PRIORITIES.map(p => (
              <button
                key={p.value}
                onClick={() => { setPriorityFilter(p.value); setCurrentIndex(0); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  priorityFilter === p.value
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</p>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.value}
                onClick={() => { setStatusFilter(s.value); setCurrentIndex(0); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  statusFilter === s.value
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Export */}
        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={handleExportChecklist}>
          <Download className="h-3 w-3" /> Export Checklist
        </Button>

        {/* Note list */}
        <div className="space-y-0.5 max-h-[250px] overflow-y-auto">
          {filteredNotes.map((n, i) => {
            const fb = feedbackMap[n.note_id];
            const isActive = i === currentIndex;
            return (
              <button
                key={n.note_id}
                onClick={() => setCurrentIndex(i)}
                className={`w-full text-left text-[11px] px-2 py-1.5 rounded transition-colors ${
                  isActive ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/30 text-muted-foreground'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] shrink-0">{n.note_id}</span>
                  <span className="truncate">{n.title}</span>
                </div>
                {fb && (
                  <div className="flex gap-1 mt-0.5">
                    <span className={`text-[9px] px-1 rounded ${STATUS_COLORS[fb.writer_status] || ''}`}>{fb.writer_status}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Panel: Note Viewer */}
      <div className="flex-1 min-w-0">
        {!currentNote ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No notes match your filters
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={currentNote.note_id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              {/* Navigation */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground font-mono">
                    Note {currentIndex + 1} of {filteredNotes.length}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex >= filteredNotes.length - 1}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <Progress value={((currentIndex + 1) / filteredNotes.length) * 100} className="w-32 h-1.5" />
              </div>

              {/* Note card */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">{currentNote.note_id}</span>
                      <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[currentNote.priority] || ''}`}>
                        P{currentNote.priority}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {CATEGORIES.find(c => c.value === currentNote.category)?.icon} {currentNote.category}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{currentNote.section}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{currentNote.title}</h4>
                  </div>

                  {/* Status dropdown */}
                  <Select
                    value={myFeedback?.writer_status || 'open'}
                    onValueChange={handleStatusChange}
                  >
                    <SelectTrigger className={`h-7 w-28 text-[10px] border ${STATUS_COLORS[myFeedback?.writer_status || 'open']}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.filter(s => s.value !== 'all').map(s => (
                        <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Note text */}
                <p className="text-sm text-foreground/90 leading-relaxed">{currentNote.note_text}</p>

                {/* Evidence */}
                {currentNote.evidence?.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger className="text-[10px] text-primary/80 hover:text-primary flex items-center gap-1">
                      📎 {currentNote.evidence.length} evidence reference{currentNote.evidence.length > 1 ? 's' : ''}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-1.5">
                      {currentNote.evidence.map((e, i) => (
                        <div key={i} className="text-xs px-3 py-1.5 rounded bg-muted/30 border border-border/30">
                          <span className="text-[10px] uppercase text-muted-foreground mr-2">{e.type}</span>
                          {e.ref}
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Prescription */}
                {currentNote.prescription && (
                  <div className="text-xs p-3 rounded bg-primary/5 border border-primary/20">
                    <p className="text-[10px] uppercase text-primary/60 mb-1 font-medium">Prescription</p>
                    <p className="text-foreground/80">{currentNote.prescription}</p>
                  </div>
                )}

                {/* Safe / Bold fixes */}
                {(currentNote.safe_fix || currentNote.bold_fix) && (
                  <div className="grid grid-cols-2 gap-3">
                    {currentNote.safe_fix && (
                      <div className="text-xs p-3 rounded bg-emerald-500/5 border border-emerald-500/20">
                        <p className="text-[10px] uppercase text-emerald-400/60 mb-1 font-medium">Safe Fix</p>
                        <p className="text-foreground/80">{currentNote.safe_fix}</p>
                      </div>
                    )}
                    {currentNote.bold_fix && (
                      <div className="text-xs p-3 rounded bg-amber-500/5 border border-amber-500/20">
                        <p className="text-[10px] uppercase text-amber-400/60 mb-1 font-medium">Bold Fix</p>
                        <p className="text-foreground/80">{currentNote.bold_fix}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Tags */}
                {currentNote.tags?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {currentNote.tags.map(t => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border/30">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* User edit display */}
                {myFeedback?.user_edit && (
                  <div className="text-xs p-3 rounded bg-primary/5 border border-primary/20">
                    <p className="text-[10px] uppercase text-primary/60 mb-1 font-medium">Your Edit</p>
                    <p className="text-foreground/80">{myFeedback.user_edit}</p>
                  </div>
                )}

                {/* Team stats */}
                {teamStats && (teamStats.accepted + teamStats.rejected + teamStats.resolved + teamStats.great + teamStats.wrong > 0) && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Team:</span>
                    {teamStats.great > 0 && <span className="text-[10px] text-emerald-400">✅{teamStats.great}</span>}
                    {teamStats.wrong > 0 && <span className="text-[10px] text-red-400">❌{teamStats.wrong}</span>}
                    {teamStats.vague > 0 && <span className="text-[10px] text-amber-400">🧩{teamStats.vague}</span>}
                    {teamStats.accepted > 0 && <span className="text-[10px] text-emerald-400">{teamStats.accepted} accepted</span>}
                    {teamStats.resolved > 0 && <span className="text-[10px] text-primary">{teamStats.resolved} resolved</span>}
                    {teamStats.conflict && (
                      <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-400 border-red-500/30 gap-0.5">
                        <AlertTriangle className="h-2.5 w-2.5" /> Conflict
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Feedback actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {Object.entries(TAG_CONFIG).map(([tag, cfg]) => {
                  const Icon = cfg.icon;
                  const isActive = myFeedback?.tag === tag;
                  return (
                    <Button
                      key={tag}
                      variant="outline"
                      size="sm"
                      onClick={() => handleTag(tag)}
                      className={`text-xs gap-1.5 border ${isActive ? cfg.colorClass : 'hover:bg-muted/50'}`}
                    >
                      <Icon className="h-3 w-3" />
                      {cfg.label}
                    </Button>
                  );
                })}
                {myFeedback?.tag === 'great' && myFeedback?.writer_status === 'accepted' && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5 text-emerald-400 border-emerald-500/30" onClick={handlePromoteGreat}>
                    <ListChecks className="h-3 w-3" /> Promote to Library
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Reason dialog */}
      <Dialog open={!!pendingTag} onOpenChange={open => !open && setPendingTag(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pendingTag === 'wrong' ? '❌ Why is this wrong?' : '🧩 Why is this vague?'}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={reasonText}
            onChange={e => setReasonText(e.target.value)}
            placeholder={pendingTag === 'wrong' ? 'This isn\'t in the script because…' : 'This note needs more detail about…'}
            rows={3}
            className="text-xs"
          />
          <Button size="sm" onClick={confirmTagWithReason} className="text-xs">Confirm</Button>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Note</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs p-2 rounded bg-muted/30 text-muted-foreground">
              <p className="text-[10px] uppercase mb-1">Original</p>
              {currentNote?.note_text}
            </div>
            <Textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              placeholder="Your preferred version…"
              rows={4}
              className="text-xs"
            />
            <Button size="sm" onClick={handleSaveEdit} className="text-xs">Save Edit</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

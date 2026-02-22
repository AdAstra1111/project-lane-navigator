import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, HelpCircle, Pencil,
  Brain, Filter, Search, ListChecks, AlertTriangle, Users, Download,
  MessageSquare, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { useNoteFeedback, StructuredNote, NoteFeedbackEntry } from '@/hooks/useNoteFeedback';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'structure', label: 'Structure' },
  { value: 'character', label: 'Character' },
  { value: 'dialogue', label: 'Dialogue' },
  { value: 'theme', label: 'Theme' },
  { value: 'market', label: 'Market' },
  { value: 'pacing', label: 'Pacing' },
  { value: 'stakes', label: 'Stakes' },
  { value: 'tone', label: 'Tone' },
];

const PRIORITIES = [
  { value: 0, label: 'All' },
  { value: 1, label: 'Core' },
  { value: 2, label: 'Important' },
  { value: 3, label: 'Optional' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'resolved', label: 'Resolved' },
];

const TAG_CONFIG: Record<string, { label: string; icon: React.ElementType; colorClass: string }> = {
  great: { label: 'Great', icon: CheckCircle2, colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' },
  wrong: { label: 'Wrong', icon: XCircle, colorClass: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  vague: { label: 'Vague', icon: HelpCircle, colorClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' },
  needs_example: { label: 'Example', icon: Brain, colorClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30' },
  edited: { label: 'Edit', icon: Pencil, colorClass: 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30' },
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-muted/40 text-muted-foreground border-border/50',
  accepted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  resolved: 'bg-primary/15 text-primary border-primary/30',
};

const PRIORITY_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'Core', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  2: { label: 'Important', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  3: { label: 'Optional', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
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

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

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

  const stats = useMemo(() => {
    const s = { open: 0, accepted: 0, rejected: 0, resolved: 0, total: notes.length };
    notes.forEach(n => {
      const st = (feedbackMap[n.note_id]?.writer_status || 'open') as keyof typeof s;
      if (st in s && typeof s[st] === 'number') (s[st] as number)++;
    });
    return s;
  }, [notes, feedbackMap]);

  const toggleExpanded = (noteId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const handleTag = async (note: StructuredNote, tag: string) => {
    if (!user) return;
    const fb = feedbackMap[note.note_id];
    if (tag === 'edited') {
      setCurrentIndex(filteredNotes.indexOf(note));
      setEditText(fb?.user_edit || note.note_text);
      setEditOpen(true);
      return;
    }
    if (tag === 'wrong' || tag === 'vague') {
      setCurrentIndex(filteredNotes.indexOf(note));
      setPendingTag(tag);
      setReasonText('');
      return;
    }
    await upsertFeedback(note.note_id, {
      tag,
      note_snapshot: note,
      category: note.category,
      priority: note.priority,
      section: note.section,
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

  const handleStatusChange = async (note: StructuredNote, status: string) => {
    const fb = feedbackMap[note.note_id];
    await upsertFeedback(note.note_id, {
      writer_status: status,
      tag: fb?.tag || 'great',
      note_snapshot: note,
      category: note.category,
      priority: note.priority,
      section: note.section,
    });
    toast.success(`Status → ${status}`);
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

  if (!notes.length) {
    return <p className="text-sm text-muted-foreground">No structured notes available for this coverage run.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Stats + Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">{stats.total} notes</span>
            <div className="flex gap-2 text-[11px]">
              <span className="text-emerald-400">{stats.accepted} accepted</span>
              <span className="text-red-400">{stats.rejected} rejected</span>
              <span className="text-primary">{stats.resolved} resolved</span>
              <span className="text-muted-foreground">{stats.open} open</span>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportChecklist}>
            <Download className="h-3 w-3" />Export
          </Button>
        </div>
        <Progress value={((stats.total - stats.open) / stats.total) * 100} className="h-1.5" />
      </div>

      {/* Compact filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
            placeholder="Search…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setCurrentIndex(0); }}>
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(priorityFilter)} onValueChange={v => { setPriorityFilter(Number(v)); setCurrentIndex(0); }}>
          <SelectTrigger className="h-7 w-[90px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map(p => (
              <SelectItem key={p.value} value={String(p.value)} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentIndex(0); }}>
          <SelectTrigger className="h-7 w-[90px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <p className="text-[11px] text-muted-foreground">
        {filteredNotes.length} note{filteredNotes.length !== 1 ? 's' : ''} matching filters
      </p>

      {/* Note list — each note is an expandable card */}
      <div className="space-y-2">
        {filteredNotes.map((note, idx) => {
          const fb = feedbackMap[note.note_id];
          const isExpanded = expandedNotes.has(note.note_id);
          const prio = PRIORITY_BADGE[note.priority];
          const status = fb?.writer_status || 'open';

          return (
            <div
              key={note.note_id}
              className="rounded-lg border border-border/40 bg-card/50 overflow-hidden transition-colors hover:border-border/60"
            >
              {/* Collapsed header — always visible */}
              <button
                onClick={() => toggleExpanded(note.note_id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {prio && (
                      <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${prio.cls}`}>
                        {prio.label}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      {note.category}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STATUS_COLORS[status]}`}>
                      {status}
                    </Badge>
                    {fb?.tag && TAG_CONFIG[fb.tag] && (
                      <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${TAG_CONFIG[fb.tag].colorClass}`}>
                        {TAG_CONFIG[fb.tag].label}
                      </Badge>
                    )}
                  </div>
                  <h4 className="text-sm font-medium text-foreground leading-snug">{note.title}</h4>
                  {!isExpanded && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{note.note_text}</p>
                  )}
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
                  {/* Full note text */}
                  <p className="text-sm text-foreground/90 leading-relaxed">{note.note_text}</p>

                  {/* Evidence */}
                  {note.evidence?.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="text-xs text-primary/80 hover:text-primary flex items-center gap-1">
                        📎 {note.evidence.length} evidence ref{note.evidence.length > 1 ? 's' : ''}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-1">
                        {note.evidence.map((e, i) => (
                          <div key={i} className="text-xs px-3 py-1.5 rounded bg-muted/30 border border-border/30">
                            <span className="text-[10px] uppercase text-muted-foreground mr-2">{e.type}</span>
                            {e.ref}
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Prescription */}
                  {note.prescription && (
                    <div className="text-xs p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-[10px] uppercase text-primary/60 mb-1 font-semibold tracking-wider">Prescription</p>
                      <p className="text-foreground/80 leading-relaxed">{note.prescription}</p>
                    </div>
                  )}

                  {/* Safe / Bold fixes */}
                  {(note.safe_fix || note.bold_fix) && (
                    <div className="space-y-2">
                      {note.safe_fix && (
                        <div className="text-xs p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                          <p className="text-[10px] uppercase text-emerald-400/60 mb-1 font-semibold tracking-wider">Safe Fix</p>
                          <p className="text-foreground/80 leading-relaxed">{note.safe_fix}</p>
                        </div>
                      )}
                      {note.bold_fix && (
                        <div className="text-xs p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                          <p className="text-[10px] uppercase text-amber-400/60 mb-1 font-semibold tracking-wider">Bold Fix</p>
                          <p className="text-foreground/80 leading-relaxed">{note.bold_fix}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* User edit */}
                  {fb?.user_edit && (
                    <div className="text-xs p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-[10px] uppercase text-primary/60 mb-1 font-semibold tracking-wider">Your Edit</p>
                      <p className="text-foreground/80 leading-relaxed">{fb.user_edit}</p>
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {/* Status */}
                    <Select
                      value={status}
                      onValueChange={s => handleStatusChange(note, s)}
                    >
                      <SelectTrigger className={`h-7 w-24 text-[11px] border ${STATUS_COLORS[status]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.filter(s => s.value !== 'all').map(s => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="h-5 w-px bg-border/40 mx-1" />

                    {/* Tag buttons */}
                    {Object.entries(TAG_CONFIG).map(([tag, cfg]) => {
                      const Icon = cfg.icon;
                      const isActive = fb?.tag === tag;
                      return (
                        <Button
                          key={tag}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTag(note, tag)}
                          className={`h-7 px-2 text-[11px] gap-1 border ${isActive ? cfg.colorClass : 'border-transparent hover:bg-muted/50'}`}
                        >
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
            className="text-sm"
          />
          <Button size="sm" onClick={confirmTagWithReason}>Confirm</Button>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Note</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs p-3 rounded bg-muted/30 text-muted-foreground">
              <p className="text-[10px] uppercase mb-1 font-semibold">Original</p>
              {currentNote?.note_text}
            </div>
            <Textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              placeholder="Your preferred version…"
              rows={4}
              className="text-sm"
            />
            <Button size="sm" onClick={handleSaveEdit}>Save Edit</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

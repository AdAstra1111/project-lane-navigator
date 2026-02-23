/**
 * NotesInbox — Project-level Notes Inbox page.
 * Route: /projects/:id/notes
 */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Loader2, Inbox, Filter, Trash2, Clock, Check } from 'lucide-react';
import { useProjectNotes, useNotesMutations } from '@/lib/notes/useProjectNotes';
import { NoteDrawer } from '@/components/notes/NoteDrawer';
import type { ProjectNote, NoteStatus, NoteTiming, NoteCategory, NoteSeverity } from '@/lib/types/notes';
import { toast } from 'sonner';

const SEVERITY_STYLES: Record<string, string> = {
  blocker: 'bg-destructive/20 text-destructive border-destructive/30',
  high: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  med: 'bg-muted/40 text-muted-foreground border-border/50',
  low: 'bg-muted/20 text-muted-foreground/70 border-border/30',
};

const TIMING_LABELS: Record<string, string> = { now: '⚡ NOW', later: '⏳ LATER', dependent: '🔗 DEP' };
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', applied: 'Applied', dismissed: 'Dismissed',
  deferred: 'Deferred', needs_decision: 'Needs Decision', reopened: 'Reopened',
};

function NotesInbox() {
  const { id: projectId } = useParams<{ id: string }>();
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [timingFilter, setTimingFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const activeStatuses: NoteStatus[] = ['open', 'reopened', 'needs_decision', 'in_progress'];
  const filters = useMemo(() => {
    const f: any = {};
    if (statusFilter === 'active') f.statuses = activeStatuses;
    else if (statusFilter !== 'all') f.status = statusFilter;
    if (timingFilter !== 'all') f.timing = timingFilter;
    if (categoryFilter !== 'all') f.category = categoryFilter;
    if (severityFilter !== 'all') f.severity = severityFilter;
    return f;
  }, [statusFilter, timingFilter, categoryFilter, severityFilter]);

  const { data: notes = [], isLoading } = useProjectNotes(projectId, filters);
  const { bulkTriageMutation } = useNotesMutations(projectId);

  const [selectedNote, setSelectedNote] = useState<ProjectNote | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDismiss = () => {
    if (!projectId || selectedIds.size === 0) return;
    bulkTriageMutation.mutate(
      { noteIds: Array.from(selectedIds), triage: { status: 'dismissed' } },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkDefer = () => {
    if (!projectId || selectedIds.size === 0) return;
    bulkTriageMutation.mutate(
      { noteIds: Array.from(selectedIds), triage: { status: 'deferred', timing: 'later' } },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 container max-w-5xl mx-auto py-6 px-4 space-y-4">
          <div className="flex items-center gap-3">
            <Link to={`/projects/${projectId}/development`}>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                <ArrowLeft className="h-3 w-3" />Back to Dev Engine
              </Button>
            </Link>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />Notes Inbox
            </h1>
            <Badge variant="outline" className="text-xs">{notes.length} notes</Badge>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Status</SelectItem>
                <SelectItem value="active" className="text-xs">Active</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={timingFilter} onValueChange={setTimingFilter}>
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Timing</SelectItem>
                <SelectItem value="now" className="text-xs">⚡ NOW</SelectItem>
                <SelectItem value="later" className="text-xs">⏳ LATER</SelectItem>
                <SelectItem value="dependent" className="text-xs">🔗 DEPENDENT</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Severity</SelectItem>
                <SelectItem value="blocker" className="text-xs">🔴 Blocker</SelectItem>
                <SelectItem value="high" className="text-xs">🟠 High</SelectItem>
                <SelectItem value="med" className="text-xs">⚪ Med</SelectItem>
                <SelectItem value="low" className="text-xs">Low</SelectItem>
              </SelectContent>
            </Select>

            {selectedIds.size > 0 && (
              <div className="flex gap-1 ml-auto">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleBulkDismiss}
                  disabled={bulkTriageMutation.isPending}>
                  <Trash2 className="h-3 w-3" />Dismiss {selectedIds.size}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleBulkDefer}
                  disabled={bulkTriageMutation.isPending}>
                  <Clock className="h-3 w-3" />Defer {selectedIds.size}
                </Button>
              </div>
            )}
          </div>

          {/* Notes list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : notes.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No notes match these filters.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {notes.map((note) => (
                <div key={note.id}
                  className="flex items-start gap-2 p-3 rounded-lg border border-border/40 bg-background hover:border-border/70 cursor-pointer transition-colors"
                  onClick={() => { setSelectedNote(note); setDrawerOpen(true); }}>
                  <Checkbox
                    checked={selectedIds.has(note.id)}
                    onCheckedChange={() => toggleSelect(note.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${SEVERITY_STYLES[note.severity] || ''}`}>
                        {note.severity}
                      </Badge>
                      <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>
                      <Badge variant="outline" className="text-[8px] px-1 py-0">{TIMING_LABELS[note.timing] || note.timing}</Badge>
                      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
                        note.status === 'applied' ? 'text-emerald-400 border-emerald-500/30' : ''
                      }`}>{note.status}</Badge>
                      {note.doc_type && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 text-primary border-primary/30">
                          {note.doc_type.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-medium text-foreground truncate">{note.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{note.summary}</p>
                  </div>
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {new Date(note.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <NoteDrawer
        open={drawerOpen}
        projectId={projectId || ''}
        noteId={selectedNote?.id || null}
        note={selectedNote}
        onApplied={() => {}}
        onClose={() => { setDrawerOpen(false); setSelectedNote(null); }}
      />
    </PageTransition>
  );
}

export default NotesInbox;

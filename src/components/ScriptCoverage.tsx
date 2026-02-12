import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  FileSearch, Loader2, ThumbsUp, ThumbsDown, Minus, ChevronDown, History,
  ArrowLeftRight, RotateCw, Star, CheckCircle2, XCircle, HelpCircle, Pencil,
  BarChart3, BookOpen, ClipboardList
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useExtractDocuments } from '@/hooks/useExtractDocuments';
import { OperationProgress, EXTRACT_STAGES } from '@/components/OperationProgress';
import { useAuth } from '@/hooks/useAuth';
import { format as fmtDate } from 'date-fns';
import { GreatNotesLibrary } from '@/components/GreatNotesLibrary';
import { NotesReview } from '@/components/NotesReview';
import { StructuredNote } from '@/hooks/useNoteFeedback';

const COVERAGE_3PASS_STAGES = [
  { at: 5, label: 'Pass A: Analyst diagnosis…' },
  { at: 25, label: 'Pass A: Extracting evidence…' },
  { at: 40, label: 'Pass B: Producer notes…' },
  { at: 60, label: 'Pass B: Building action plan…' },
  { at: 75, label: 'Pass C: QC + structuring notes…' },
  { at: 90, label: 'Saving results…' },
];

const PROBLEM_TYPES = [
  { value: 'structure', label: 'Structure' },
  { value: 'character', label: 'Character' },
  { value: 'dialogue', label: 'Dialogue' },
  { value: 'theme', label: 'Theme' },
  { value: 'market', label: 'Market' },
  { value: 'pacing', label: 'Pacing' },
  { value: 'stakes', label: 'Stakes' },
  { value: 'tone', label: 'Tone' },
  { value: 'general', label: 'General' },
];

// Legacy simple note shape (backward compat)
interface SimpleNote {
  id?: string;
  note_id?: string;
  text?: string;
  note_text?: string;
}

interface NoteFeedback {
  note_id: string;
  tag: string;
  user_edit?: string;
}

interface CoverageRunData {
  id: string;
  created_at: string;
  draft_label: string;
  final_coverage: string;
  structured_notes: StructuredNote[];
  metrics: Record<string, any>;
  pass_a: string;
  pass_b: string;
  pass_c: string;
  project_type: string;
  model: string;
  prompt_version_id: string;
}

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  hasDocuments: boolean;
  lane?: string;
}

const REC_STYLES: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  RECOMMEND: { icon: ThumbsUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  CONSIDER: { icon: Minus, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  PASS: { icon: ThumbsDown, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
};

function VerdictBadge({ recommendation }: { recommendation: string }) {
  const rec = recommendation?.match(/RECOMMEND|CONSIDER|PASS/)?.[0] || 'CONSIDER';
  const recStyle = REC_STYLES[rec] || REC_STYLES.CONSIDER;
  const RecIcon = recStyle.icon;
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs ${recStyle.bg}`}>
      <RecIcon className={`h-3.5 w-3.5 ${recStyle.color}`} />
      <span className={`font-bold ${recStyle.color}`}>{rec}</span>
    </div>
  );
}

function CoverageMarkdown({ markdown }: { markdown: string }) {
  // Strip any JSON code blocks or trailing structured_notes objects that leaked through
  const cleaned = markdown
    .replace(/```(?:json)?\s*[\s\S]*?```/g, '')
    .replace(/\{[\s\S]*?"structured_notes"[\s\S]*$/g, '')
    .replace(/\[?\s*\{[\s\S]*?"note_id"[\s\S]*$/g, '')
    .trim();
  const lines = cleaned.split('\n');
  return (
    <div className="prose prose-sm prose-invert max-w-none space-y-1">
      {lines.map((line, i) => {
        if (line.match(/^#{1,3}\s/)) {
          return <h4 key={i} className="text-primary font-display font-semibold mt-4 mb-1 text-sm">{line.replace(/^#+\s*/, '')}</h4>;
        }
        if (line.match(/^\*\*[A-Z]/)) {
          return <p key={i} className="text-foreground font-semibold text-sm mt-3">{line.replace(/\*\*/g, '')}</p>;
        }
        if (line.match(/^[-•*]\s/)) {
          return <p key={i} className="text-sm text-muted-foreground pl-4 before:content-['•'] before:mr-2 before:text-primary/60">{line.replace(/^[-•*]\s*/, '')}</p>;
        }
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{line}</p>;
      })}
    </div>
  );
}

const TAG_STYLES: Record<string, { label: string; color: string }> = {
  great: { label: '✅ Great', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  wrong: { label: '❌ Wrong', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  vague: { label: '🧩 Vague', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  edited: { label: '✏️ Edited', color: 'bg-primary/20 text-primary border-primary/30' },
};

// Helper to get note id/text from either old or new format
function getNoteId(note: any): string { return note.note_id || note.id || ''; }
function getNoteText(note: any): string { return note.note_text || note.text || ''; }

function NoteActions({ note, runId, projectType, existingTag }: { note: any; runId: string; projectType: string; existingTag?: NoteFeedback }) {
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [greatOpen, setGreatOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [problemType, setProblemType] = useState('general');
  const [tagged, setTagged] = useState<string | null>(existingTag?.tag || null);
  const noteId = getNoteId(note);
  const noteText = getNoteText(note);

  const handleTag = async (tag: string) => {
    if (!user) return;
    if (tag === 'great') { setGreatOpen(true); return; }
    try {
      await supabase.from('coverage_feedback_notes').insert({
        coverage_run_id: runId, note_id: noteId, tag, created_by: user.id,
      } as any);
      setTagged(tag);
      toast.success(`Note tagged as ${tag}`);
    } catch { toast.error('Failed to tag note'); }
  };

  const handlePromoteGreat = async () => {
    if (!user) return;
    try {
      await supabase.from('coverage_feedback_notes').insert({
        coverage_run_id: runId, note_id: noteId, tag: 'great', created_by: user.id,
      } as any);
      await supabase.from('great_notes_library').insert({
        project_type: projectType, problem_type: problemType,
        note_text: noteText, source_coverage_run_id: runId, created_by: user.id,
      } as any);
      setTagged('great');
      setGreatOpen(false);
      toast.success('Note promoted to Great Notes library');
    } catch { toast.error('Failed to promote note'); }
  };

  const handleEdit = async () => {
    if (!user || !editText.trim()) return;
    try {
      await supabase.from('coverage_feedback_notes').insert({
        coverage_run_id: runId, note_id: noteId, tag: 'edited', user_edit: editText, created_by: user.id,
      } as any);
      setTagged('edited');
      toast.success('Edited note saved');
      setEditOpen(false);
    } catch { toast.error('Failed to save edit'); }
  };

  return (
    <div className="flex items-center gap-1">
      {tagged && TAG_STYLES[tagged] ? (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TAG_STYLES[tagged].color}`}>
          {TAG_STYLES[tagged].label}
        </span>
      ) : (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => handleTag('great')} className="p-0.5 rounded hover:bg-emerald-500/20" title="Great note">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </button>
          <button onClick={() => handleTag('wrong')} className="p-0.5 rounded hover:bg-red-500/20" title="Wrong">
            <XCircle className="h-3.5 w-3.5 text-red-400" />
          </button>
          <button onClick={() => handleTag('vague')} className="p-0.5 rounded hover:bg-amber-500/20" title="Too vague">
            <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
          </button>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <button className="p-0.5 rounded hover:bg-primary/20" title="Edit">
                <Pencil className="h-3.5 w-3.5 text-primary" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Edit Note</DialogTitle></DialogHeader>
              <p className="text-xs text-muted-foreground mb-2">Original: {noteText}</p>
              <Textarea value={editText} onChange={e => setEditText(e.target.value)} placeholder="Your corrected version…" rows={4} />
              <Button onClick={handleEdit} className="mt-2">Save Edit</Button>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <Dialog open={greatOpen} onOpenChange={setGreatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Promote to Great Notes</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-1">"{noteText.slice(0, 120)}…"</p>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Problem Type</label>
              <Select value={problemType} onValueChange={setProblemType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROBLEM_TYPES.map(pt => (
                    <SelectItem key={pt.value} value={pt.value} className="text-xs">{pt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handlePromoteGreat} className="w-full text-xs gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Save to Library
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StructuredNotesView({ notes, runId, projectType, feedbackMap }: { notes: any[]; runId: string; projectType: string; feedbackMap: Record<string, NoteFeedback> }) {
  if (!notes?.length) return null;
  return (
    <div className="space-y-1.5 mt-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Structured Notes ({notes.length})</p>
      {notes.map(note => {
        const id = getNoteId(note);
        const text = getNoteText(note);
        return (
          <div key={id} className="group flex items-start gap-2 text-sm py-1 px-2 rounded hover:bg-muted/30">
            <span className="text-[10px] text-muted-foreground font-mono shrink-0 mt-0.5">{id}</span>
            <span className="text-foreground flex-1">{text}</span>
            <NoteActions note={note} runId={runId} projectType={projectType} existingTag={feedbackMap[id]} />
          </div>
        );
      })}
    </div>
  );
}

function FeedbackPanel({ runId }: { runId: string }) {
  const { user } = useAuth();
  const [ratings, setRatings] = useState({ overall: 3, accuracy: 3, specificity: 3, actionability: 3, market: 3 });
  const [freeText, setFreeText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('coverage_feedback')
      .select('*')
      .eq('coverage_run_id', runId)
      .eq('created_by', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExistingFeedback(data);
          setSubmitted(true);
          setRatings({
            overall: (data as any).overall_usefulness,
            accuracy: (data as any).accuracy_to_script,
            specificity: (data as any).specificity,
            actionability: (data as any).actionability,
            market: (data as any).market_realism,
          });
        }
      });
  }, [runId, user]);

  const handleSubmit = async () => {
    if (!user) return;
    try {
      await supabase.from('coverage_feedback').insert({
        coverage_run_id: runId,
        overall_usefulness: ratings.overall,
        accuracy_to_script: ratings.accuracy,
        specificity: ratings.specificity,
        actionability: ratings.actionability,
        market_realism: ratings.market,
        free_text: freeText || null,
        created_by: user.id,
      } as any);
      toast.success('Feedback submitted');
      setSubmitted(true);
    } catch {
      toast.error('Failed to submit feedback');
    }
  };

  if (submitted) {
    return (
      <div className="space-y-2 p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Feedback submitted</p>
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: 'Overall', value: ratings.overall },
            { label: 'Accuracy', value: ratings.accuracy },
            { label: 'Specificity', value: ratings.specificity },
            { label: 'Actionability', value: ratings.actionability },
            { label: 'Market', value: ratings.market },
          ].map(r => (
            <span key={r.label} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
              {r.label}: {r.value}/5
            </span>
          ))}
        </div>
      </div>
    );
  }

  const sliders = [
    { key: 'overall', label: 'Overall Usefulness' },
    { key: 'accuracy', label: 'Accuracy to Script' },
    { key: 'specificity', label: 'Specificity' },
    { key: 'actionability', label: 'Actionability' },
    { key: 'market', label: 'Market Realism' },
  ] as const;

  return (
    <div className="space-y-3 p-4 rounded-lg border border-border/50 bg-muted/20">
      <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Star className="h-3 w-3" /> Rate This Coverage
      </p>
      {sliders.map(s => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-32 shrink-0">{s.label}</span>
          <Slider
            value={[ratings[s.key]]}
            onValueChange={([v]) => setRatings(prev => ({ ...prev, [s.key]: v }))}
            min={1} max={5} step={1}
            className="flex-1"
          />
          <span className="text-xs font-mono w-4 text-right">{ratings[s.key]}</span>
        </div>
      ))}
      <Textarea value={freeText} onChange={e => setFreeText(e.target.value)} placeholder="Any additional feedback…" rows={2} className="text-xs" />
      <Button size="sm" onClick={handleSubmit} className="text-xs">Submit Feedback</Button>
    </div>
  );
}

function MetricsBadges({ metrics }: { metrics: Record<string, any> }) {
  if (!metrics || Object.keys(metrics).length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {metrics.specificity_rate != null && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          Specificity: {typeof metrics.specificity_rate === 'number' ? `${Math.round(metrics.specificity_rate * 100)}%` : metrics.specificity_rate}
        </span>
      )}
      {metrics.hallucinations_count != null && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${metrics.hallucinations_count === 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          Hallucinations: {metrics.hallucinations_count}
        </span>
      )}
      {metrics.contract_compliance != null && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${metrics.contract_compliance ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
          Contract: {metrics.contract_compliance ? '✓' : 'Partial'}
        </span>
      )}
    </div>
  );
}

function CompareDialog({ runs }: { runs: CoverageRunData[] }) {
  const [leftId, setLeftId] = useState(runs[0]?.id || '');
  const [rightId, setRightId] = useState(runs[1]?.id || '');
  const left = runs.find(r => r.id === leftId);
  const right = runs.find(r => r.id === rightId);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1.5">
          <ArrowLeftRight className="h-3 w-3" /> Compare Drafts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Compare Script Coverages</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger><SelectValue placeholder="Select draft" /></SelectTrigger>
            <SelectContent>
              {runs.filter(r => r.id !== rightId).map(r => (
                <SelectItem key={r.id} value={r.id}>{r.draft_label} — {fmtDate(new Date(r.created_at), 'dd MMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger><SelectValue placeholder="Select draft" /></SelectTrigger>
            <SelectContent>
              {runs.filter(r => r.id !== leftId).map(r => (
                <SelectItem key={r.id} value={r.id}>{r.draft_label} — {fmtDate(new Date(r.created_at), 'dd MMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-6 mt-4">
          {[left, right].map((run, idx) => (
            <div key={idx} className="space-y-3">
              {run && (
                <>
                  <div className="flex items-center gap-2">
                    <VerdictBadge recommendation={run.final_coverage} />
                    <MetricsBadges metrics={run.metrics} />
                  </div>
                  <CoverageMarkdown markdown={run.final_coverage} />
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScriptCoverage({ projectId, projectTitle, format, genres, hasDocuments, lane }: Props) {
  const [runs, setRuns] = useState<CoverageRunData[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [activeTab, setActiveTab] = useState('coverage');
  const [noteFeedbackMap, setNoteFeedbackMap] = useState<Record<string, NoteFeedback>>({});
  const [showLibrary, setShowLibrary] = useState(false);
  const extract = useExtractDocuments(projectId);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const selectedRun = runs.find(r => r.id === selectedId);

  // Load existing coverage runs
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('coverage_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (data?.length) {
        const mapped: CoverageRunData[] = data.map((row: any) => ({
          id: row.id,
          created_at: row.created_at,
          draft_label: row.draft_label,
          final_coverage: row.final_coverage,
          structured_notes: (row.structured_notes || []) as any[],
          metrics: (row.metrics || {}) as Record<string, any>,
          pass_a: row.pass_a,
          pass_b: row.pass_b,
          pass_c: row.pass_c,
          project_type: row.project_type,
          model: row.model,
          prompt_version_id: row.prompt_version_id,
        }));
        setRuns(mapped);
        setSelectedId(mapped[0].id);
        setDraftLabel(`Draft ${data.length + 1}`);
      } else {
        setDraftLabel('Draft 1');
      }
    };
    load();
  }, [projectId]);

  // Load existing note feedback when run changes
  useEffect(() => {
    if (!selectedId || !user) return;
    supabase
      .from('coverage_feedback_notes')
      .select('note_id, tag, user_edit')
      .eq('coverage_run_id', selectedId)
      .eq('created_by', user.id)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, NoteFeedback> = {};
          (data as any[]).forEach(d => { map[d.note_id] = d; });
          setNoteFeedbackMap(map);
        }
      });
  }, [selectedId, user]);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const { data: docs } = await supabase
        .from('project_documents')
        .select('extracted_text')
        .eq('project_id', projectId)
        .not('extracted_text', 'is', null);

      let scriptText = (docs || [])
        .map((d: any) => d.extracted_text)
        .filter((t: string) => t && t.length > 100)
        .join('\n\n---\n\n');

      if (!scriptText || scriptText.length < 100) {
        const { data: scripts } = await supabase
          .from('project_scripts' as any)
          .select('file_path')
          .eq('project_id', projectId)
          .eq('status', 'current')
          .limit(1);

        if (scripts?.length && (scripts[0] as any).file_path) {
          toast.info('Extracting script text — this may take a moment…');
          await supabase.functions.invoke('extract-documents', {
            body: { projectId, documentPaths: scripts.map((s: any) => s.file_path) },
          });

          const { data: freshDocs } = await supabase
            .from('project_documents')
            .select('extracted_text')
            .eq('project_id', projectId)
            .not('extracted_text', 'is', null);

          scriptText = (freshDocs || [])
            .map((d: any) => d.extracted_text)
            .filter((t: string) => t && t.length > 100)
            .join('\n\n---\n\n');
        }
      }

      if (!scriptText || scriptText.length < 100) {
        toast.error('No extracted text found — upload the script via Documents first.');
        return;
      }

      // Detect binary/garbage text (PDF not properly extracted)
      const printableRatio = (scriptText.slice(0, 2000).match(/[a-zA-Z0-9\s.,!?;:'"()\-]/g) || []).length / Math.min(scriptText.length, 2000);
      if (printableRatio < 0.3) {
        toast.error('The extracted text appears to be corrupted (raw PDF data). Please re-upload the script as a plain text or Word file, or re-extract the document.');
        return;
      }

      // Truncate client-side to keep request payload manageable (15k chars max)
      const trimmedScript = scriptText.slice(0, 15000);

      let scriptId: string | null = null;
      const { data: existingScripts } = await supabase
        .from('scripts')
        .select('id')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1);

      if (existingScripts?.length) {
        scriptId = existingScripts[0].id;
      } else {
        const { data: newScript } = await supabase
          .from('scripts')
          .insert({
            project_id: projectId,
            version: 1,
            text_content: trimmedScript,
            created_by: user!.id,
          } as any)
          .select('id')
          .single();
        scriptId = newScript?.id;
      }

      if (!scriptId) throw new Error('Failed to create script record');

      const label = draftLabel || `Draft ${runs.length + 1}`;

      const { data, error } = await supabase.functions.invoke('script-coverage', {
        body: { projectId, scriptId, draftLabel: label, scriptText: trimmedScript, format, genres, lane },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newRun: CoverageRunData = {
        id: data.id || crypto.randomUUID(),
        created_at: data.created_at || new Date().toISOString(),
        draft_label: label,
        final_coverage: data.final_coverage,
        structured_notes: data.structured_notes || [],
        metrics: data.metrics || {},
        pass_a: data.pass_a || '',
        pass_b: data.pass_b || '',
        pass_c: data.pass_c || '',
        project_type: FORMAT_LABELS[format] || 'Film',
        model: 'google/gemini-2.5-flash',
        prompt_version_id: '',
      };

      setRuns(prev => [newRun, ...prev]);
      setSelectedId(newRun.id);
      setDraftLabel(`Draft ${runs.length + 2}`);
      setNoteFeedbackMap({});

      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('3-pass coverage analysis complete');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate coverage');
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasDocuments) return null;

  if (!selectedRun) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSearch className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-display font-semibold text-foreground">Script Coverage</h3>
              <p className="text-sm text-muted-foreground">3-pass AI coverage: Analyst → Producer → QC</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="Draft label…" className="h-8 w-32 text-xs" />
            <Button variant="outline" size="sm" onClick={() => extract.mutate()} disabled={extract.isPending} className="text-xs gap-1.5">
              <RotateCw className={`h-3 w-3 ${extract.isPending ? 'animate-spin' : ''}`} />
              Extract Text
            </Button>
            <Button onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Analysing…</> : <><FileSearch className="h-4 w-4 mr-1.5" />Generate Coverage</>}
            </Button>
          </div>
        </div>
        <OperationProgress isActive={extract.isPending} stages={EXTRACT_STAGES} />
        <OperationProgress isActive={isLoading} stages={COVERAGE_3PASS_STAGES} />
      </motion.div>
    );
  }

  return (
    <>
      <Collapsible defaultOpen>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-6">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileSearch className="h-5 w-5 text-primary" />
                <h3 className="font-display font-semibold text-foreground">Script Coverage</h3>
                <VerdictBadge recommendation={selectedRun.final_coverage} />
                <MetricsBadges metrics={selectedRun.metrics} />
                {runs.length > 0 && (
                  <span className="text-xs text-muted-foreground">{selectedRun.draft_label}</span>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-5 mt-5">
            {runs.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {runs.map(r => (
                        <SelectItem key={r.id} value={r.id} className="text-xs">
                          {r.draft_label} — {fmtDate(new Date(r.created_at), 'dd MMM yyyy HH:mm')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {runs.length >= 2 && <CompareDialog runs={runs} />}
                <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setShowLibrary(true)}>
                  <BookOpen className="h-3 w-3" /> Great Notes Library
                </Button>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-muted/30">
                <TabsTrigger value="coverage" className="text-xs">Final Coverage</TabsTrigger>
                <TabsTrigger value="passes" className="text-xs">Analysis Passes</TabsTrigger>
                <TabsTrigger value="review" className="text-xs gap-1"><ClipboardList className="h-3 w-3" />Notes Review ({selectedRun.structured_notes?.length || 0})</TabsTrigger>
                <TabsTrigger value="notes" className="text-xs">Notes List</TabsTrigger>
                <TabsTrigger value="feedback" className="text-xs gap-1"><Star className="h-3 w-3" />Rate</TabsTrigger>
              </TabsList>

              <TabsContent value="coverage" className="mt-4">
                <CoverageMarkdown markdown={selectedRun.final_coverage} />
              </TabsContent>

              <TabsContent value="passes" className="mt-4 space-y-4">
                {[
                  { label: 'Pass A: Analyst Diagnostics', content: selectedRun.pass_a },
                  { label: 'Pass B: Producer Notes', content: selectedRun.pass_b },
                  { label: 'Pass C: QC Report', content: selectedRun.pass_c },
                ].map(pass => (
                  <Collapsible key={pass.label}>
                    <CollapsibleTrigger className="w-full text-left">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                        <BarChart3 className="h-3 w-3" /> {pass.label}
                        <ChevronDown className="h-3 w-3 ml-auto transition-transform [[data-state=open]_&]:rotate-180" />
                      </p>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 p-3 rounded-lg bg-muted/20 border border-border/30 max-h-[400px] overflow-y-auto">
                        <CoverageMarkdown markdown={pass.content} />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </TabsContent>

              <TabsContent value="review" className="mt-4">
                <NotesReview
                  notes={selectedRun.structured_notes}
                  runId={selectedRun.id}
                  projectId={projectId}
                  projectType={selectedRun.project_type}
                />
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <StructuredNotesView
                  notes={selectedRun.structured_notes}
                  runId={selectedRun.id}
                  projectType={selectedRun.project_type}
                  feedbackMap={noteFeedbackMap}
                />
              </TabsContent>

              <TabsContent value="feedback" className="mt-4">
                <FeedbackPanel runId={selectedRun.id} />
              </TabsContent>
            </Tabs>

            <div className="pt-2 border-t border-border/50 flex items-center gap-3 flex-wrap">
              <Input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="Draft label…" className="h-8 w-40 text-xs" />
              <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSearch className="h-3 w-3 mr-1" />}
                New Coverage
              </Button>
              <OperationProgress isActive={isLoading} stages={COVERAGE_3PASS_STAGES} />
            </div>
          </CollapsibleContent>
        </motion.div>
      </Collapsible>

      {/* Great Notes Library Dialog */}
      <Dialog open={showLibrary} onOpenChange={setShowLibrary}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Great Notes Library</DialogTitle></DialogHeader>
          <GreatNotesLibrary />
        </DialogContent>
      </Dialog>
    </>
  );
}

const FORMAT_LABELS: Record<string, string> = {
  film: "Feature Film", "tv-series": "TV Series", documentary: "Documentary Feature",
  "documentary-series": "Documentary Series", commercial: "Commercial / Advert",
  "branded-content": "Branded Content", "short-film": "Short Film",
  "music-video": "Music Video", "proof-of-concept": "Proof of Concept",
  "digital-series": "Digital / Social Series", hybrid: "Hybrid Project",
  "vertical-drama": "Vertical Drama",
};

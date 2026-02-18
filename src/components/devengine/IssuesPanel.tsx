/**
 * IssuesPanel — Persistent Issues backlog with batch staging, apply & verify.
 * Two tabs: Open Issues (DB-backed) | Detected This Run (ephemeral).
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, MinusCircle,
  Zap, Eye, Wrench, RotateCcw, Search, Filter, ChevronDown, ChevronRight,
  ShieldAlert, Sparkles, Play, SquareCheck,
} from 'lucide-react';
import {
  useProjectIssues,
  type ProjectIssue,
  type IssueCategory,
  type FixOption,
  CATEGORY_COLORS,
  NARRATIVE_PRESETS,
  CATEGORY_ORDER,
} from '@/hooks/useProjectIssues';

// ── Sub-components ─────────────────────────────────────────────────────────

function SeverityDots({ severity }: { severity: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= severity
              ? severity >= 4 ? 'bg-red-400' : severity >= 3 ? 'bg-amber-400' : 'bg-muted-foreground/60'
              : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </div>
  );
}

function StatusPill({ status, verifyStatus }: { status: ProjectIssue['status']; verifyStatus: ProjectIssue['verify_status'] }) {
  if (status === 'resolved') {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-400 flex items-center gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" /> Resolved
      </Badge>
    );
  }
  if (status === 'staged') {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-blue-500/40 text-blue-400 flex items-center gap-1">
        <Wrench className="h-2.5 w-2.5" /> Staged
      </Badge>
    );
  }
  if (status === 'dismissed') {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border text-muted-foreground flex items-center gap-1">
        <MinusCircle className="h-2.5 w-2.5" /> Dismissed
      </Badge>
    );
  }
  if (verifyStatus === 'fail') {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-red-500/40 text-red-400 flex items-center gap-1">
        <RotateCcw className="h-2.5 w-2.5" /> Reopened
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-500/40 text-orange-400 flex items-center gap-1">
      <AlertTriangle className="h-2.5 w-2.5" /> Open
    </Badge>
  );
}

function CategoryBadge({ category }: { category: IssueCategory }) {
  return (
    <Badge variant="outline" className={`text-[8px] px-1 py-0 capitalize ${CATEGORY_COLORS[category]}`}>
      {category}
    </Badge>
  );
}

// ── Stage Fix Modal ────────────────────────────────────────────────────────

interface StageFixModalProps {
  issue: ProjectIssue;
  fixOptions: FixOption[];
  isGenerating: boolean;
  onGenerate: () => void;
  onStage: (choice: FixOption) => void;
  onClose: () => void;
}

function StageFixModal({ issue, fixOptions, isGenerating, onGenerate, onStage, onClose }: StageFixModalProps) {
  const [selected, setSelected] = useState<number | null>(
    fixOptions.findIndex(o => o.recommended) >= 0 ? fixOptions.findIndex(o => o.recommended) : null
  );

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Stage Fix
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Select a fix option to apply in the next rewrite pass.
        </DialogDescription>
      </DialogHeader>

      {/* Issue detail */}
      <div className="bg-muted/30 rounded border border-border/40 p-3 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <CategoryBadge category={issue.category} />
          <SeverityDots severity={issue.severity} />
          {issue.anchor && (
            <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{issue.anchor}</span>
          )}
        </div>
        <p className="text-xs font-medium text-foreground">{issue.summary}</p>
        <p className="text-[10px] text-muted-foreground">{issue.detail}</p>
        {issue.evidence_snippet && (
          <p className="text-[9px] text-muted-foreground/70 italic border-l-2 border-border pl-2 mt-1">
            {issue.evidence_snippet}
          </p>
        )}
      </div>

      {/* Fix options */}
      {fixOptions.length === 0 ? (
        <div className="py-3 text-center">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate Fix Options
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2">AI will suggest 2–4 targeted approaches</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Fix Options</p>
          {fixOptions.map((opt, i) => (
            <button
              key={i}
              className={`w-full text-left rounded border px-3 py-2 space-y-0.5 transition-colors ${
                selected === i
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/40 bg-background/40 hover:border-border'
              }`}
              onClick={() => setSelected(i)}
            >
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full border-2 flex-shrink-0 ${selected === i ? 'border-primary bg-primary' : 'border-border'}`} />
                <span className="text-[10px] font-medium text-foreground">{opt.option_label}</span>
                {opt.recommended && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-primary/70 ml-auto">Recommended</Badge>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground ml-5">{opt.approach}</p>
              {selected === i && (
                <p className="text-[9px] text-primary/70 ml-5 mt-0.5">Impact: {opt.impact}</p>
              )}
            </button>
          ))}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => selected !== null && onStage(fixOptions[selected])}
              disabled={selected === null}
            >
              <Wrench className="h-3 w-3" />
              Stage Fix
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  );
}

// ── Issue Row ──────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: ProjectIssue;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStage: (issue: ProjectIssue) => void;
  onResolve: (issue: ProjectIssue) => void;
  onDismiss: (issue: ProjectIssue) => void;
  onUnstage: (issue: ProjectIssue) => void;
}

function IssueRow({ issue, isSelected, onToggleSelect, onStage, onResolve, onDismiss, onUnstage }: IssueRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded border transition-colors ${
      isSelected ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-background/40'
    }`}>
      <div className="flex items-start gap-2 px-2 py-1.5">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
          className="mt-0.5 h-3 w-3"
        />
        <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(v => !v)}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <CategoryBadge category={issue.category} />
            <SeverityDots severity={issue.severity} />
            {issue.anchor && (
              <span className="text-[8px] text-muted-foreground bg-muted/60 px-1 py-0.5 rounded truncate max-w-[80px]">
                {issue.anchor}
              </span>
            )}
            <StatusPill status={issue.status} verifyStatus={issue.verify_status} />
          </div>
          <p className="text-[10px] text-foreground font-medium mt-0.5 truncate">{issue.summary}</p>
          {issue.verify_status === 'fail' && issue.verify_detail && (
            <p className="text-[9px] text-red-400/80 mt-0.5 truncate">{issue.verify_detail}</p>
          )}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2 pt-0 space-y-1.5 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground mt-1.5">{issue.detail}</p>
          {issue.evidence_snippet && (
            <p className="text-[9px] text-muted-foreground/70 italic border-l-2 border-border pl-2">
              {issue.evidence_snippet}
            </p>
          )}
          {issue.staged_fix_choice && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded px-2 py-1">
              <p className="text-[9px] font-medium text-blue-400">Staged fix: {issue.staged_fix_choice.option_label}</p>
              <p className="text-[9px] text-muted-foreground">{issue.staged_fix_choice.approach}</p>
            </div>
          )}
          <div className="flex gap-1 pt-0.5 flex-wrap">
            {issue.status === 'open' && (
              <Button size="sm" variant="outline" className="h-5 text-[9px] px-2 gap-1" onClick={() => onStage(issue)}>
                <Wrench className="h-2.5 w-2.5" /> Stage Fix
              </Button>
            )}
            {issue.status === 'staged' && (
              <Button size="sm" variant="outline" className="h-5 text-[9px] px-2 gap-1" onClick={() => onUnstage(issue)}>
                <RotateCcw className="h-2.5 w-2.5" /> Unstage
              </Button>
            )}
            {issue.status !== 'resolved' && (
              <Button size="sm" variant="ghost" className="h-5 text-[9px] px-2 gap-1 text-emerald-400 hover:text-emerald-300" onClick={() => onResolve(issue)}>
                <CheckCircle2 className="h-2.5 w-2.5" /> Mark Resolved
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-5 text-[9px] px-2 gap-1 text-muted-foreground" onClick={() => onDismiss(issue)}>
              <XCircle className="h-2.5 w-2.5" /> Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ephemeral "Detected This Run" ─────────────────────────────────────────

interface EphemeralNote {
  category: string;
  severity?: number;
  anchor?: string;
  summary?: string;
  detail?: string;
  title?: string;
  description?: string;
}

function DetectedRunList({ notes }: { notes: EphemeralNote[] }) {
  if (notes.length === 0) {
    return <p className="text-[10px] text-muted-foreground py-4 text-center">No notes from the latest run.</p>;
  }
  return (
    <div className="space-y-1.5">
      {notes.map((note, i) => (
        <div key={i} className="rounded border border-border/40 bg-background/40 px-2 py-1.5 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[8px] px-1 py-0 capitalize ${CATEGORY_COLORS[(note.category as IssueCategory) || 'polish'] || ''}`}>
              {note.category}
            </Badge>
            {note.severity && <SeverityDots severity={note.severity} />}
            {note.anchor && (
              <span className="text-[8px] text-muted-foreground bg-muted/60 px-1 py-0.5 rounded">{note.anchor}</span>
            )}
          </div>
          <p className="text-[10px] text-foreground font-medium">{note.summary || note.title}</p>
          <p className="text-[10px] text-muted-foreground">{note.detail || note.description}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main IssuesPanel ───────────────────────────────────────────────────────

interface IssuesPanelProps {
  projectId: string;
  docType?: string;
  docVersionId?: string;
  currentText?: string;
  latestRunNotes?: EphemeralNote[];
  isRunning?: boolean;
}

export function IssuesPanel({
  projectId,
  docType,
  docVersionId,
  currentText = '',
  latestRunNotes = [],
  isRunning = false,
}: IssuesPanelProps) {
  const issues = useProjectIssues(projectId);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [anchorSearch, setAnchorSearch] = useState('');
  const [narrativePreset, setNarrativePreset] = useState<string>('all');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Stage modal state
  const [stageModalIssue, setStageModalIssue] = useState<ProjectIssue | null>(null);
  const [fixOptions, setFixOptions] = useState<FixOption[]>([]);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  // Filtered issues
  const filtered = useMemo(() => {
    const preset = NARRATIVE_PRESETS[narrativePreset];
    return issues.issues.filter(iss => {
      if (!preset.categories.includes(iss.category)) return false;
      if (categoryFilter !== 'all' && iss.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && iss.status !== statusFilter) return false;
      if (severityFilter !== 'all' && String(iss.severity) !== severityFilter) return false;
      if (anchorSearch && !(iss.anchor || '').toLowerCase().includes(anchorSearch.toLowerCase()) &&
          !iss.summary.toLowerCase().includes(anchorSearch.toLowerCase())) return false;
      return true;
    });
  }, [issues.issues, categoryFilter, statusFilter, severityFilter, anchorSearch, narrativePreset]);

  const stagedCount = issues.stagedIssues.length;
  const openCount = issues.openIssues.length;

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(i => i.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleGenerateFixes(issue?: ProjectIssue) {
    const ids = issue ? [issue.id] : [...selectedIds];
    if (ids.length === 0) return;
    setGeneratingFor(ids[0]);
    const result = await issues.generateFixes.mutateAsync({
      issue_ids: ids,
      current_text: currentText,
      doc_version_id: docVersionId,
    });
    if (result.fixes && stageModalIssue) {
      const issueFixes = result.fixes.find((f: any) => f.issue_id === stageModalIssue.id);
      setFixOptions(issueFixes?.options || []);
    }
    setGeneratingFor(null);
  }

  async function handleApplyStaged() {
    if (!docType || !docVersionId) {
      return;
    }
    const stagedIds = issues.stagedIssues.map(i => i.id);
    if (stagedIds.length === 0) return;
    await issues.applyStaged.mutateAsync({
      doc_type: docType,
      base_doc_version_id: docVersionId,
      issue_ids: stagedIds,
    });
  }

  async function handleVerify(newVersionId?: string) {
    const ids = issues.stagedIssues.map(i => i.id);
    if (ids.length === 0) return;
    await issues.verifyFixes.mutateAsync({
      issue_ids: ids,
      new_doc_version_id: newVersionId || docVersionId || '',
      new_text: currentText || undefined,
    });
  }

  function openStageModal(iss: ProjectIssue) {
    setStageModalIssue(iss);
    setFixOptions([]);
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">Issues Tracker</span>
          {openCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-500/30 text-orange-400">
              {openCount} open
            </Badge>
          )}
          {stagedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-blue-500/30 text-blue-400">
              {stagedCount} staged
            </Badge>
          )}
        </div>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* Narrative preset selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={narrativePreset} onValueChange={setNarrativePreset}>
          <SelectTrigger className="h-6 text-[10px] w-[140px]">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NARRATIVE_PRESETS).map(([key, val]) => (
              <SelectItem key={key} value={key} className="text-[10px]">{val.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-6 text-[10px] w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[10px]">All Status</SelectItem>
            <SelectItem value="open" className="text-[10px]">Open</SelectItem>
            <SelectItem value="staged" className="text-[10px]">Staged</SelectItem>
            <SelectItem value="resolved" className="text-[10px]">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="h-6 text-[10px] w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[10px]">All Sev.</SelectItem>
            {[5, 4, 3, 2, 1].map(s => (
              <SelectItem key={s} value={String(s)} className="text-[10px]">Sev {s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[100px]">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
          <Input
            placeholder="Search anchor / summary…"
            value={anchorSearch}
            onChange={e => setAnchorSearch(e.target.value)}
            className="h-6 text-[10px] pl-5"
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap bg-muted/30 border border-border/40 rounded px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">{selectedIds.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            className="h-5 text-[9px] px-2 gap-1"
            onClick={() => handleGenerateFixes()}
            disabled={issues.generateFixes.isPending}
          >
            {issues.generateFixes.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
            Gen. Fixes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[9px] px-2 text-muted-foreground"
            onClick={clearSelection}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[9px] px-2 text-muted-foreground ml-auto"
            onClick={selectAll}
          >
            All
          </Button>
        </div>
      )}

      {/* Apply staged + verify buttons */}
      {(stagedCount > 0 || issues.applyStaged.data) && (
        <div className="flex items-center gap-2 flex-wrap bg-blue-500/5 border border-blue-500/20 rounded px-3 py-2">
          <span className="text-[10px] text-blue-400 font-medium">{stagedCount} fix{stagedCount !== 1 ? 'es' : ''} staged</span>
          <Button
            size="sm"
            className="h-6 text-[10px] gap-1 ml-auto"
            onClick={handleApplyStaged}
            disabled={stagedCount === 0 || !docVersionId || issues.applyStaged.isPending}
          >
            {issues.applyStaged.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Play className="h-3 w-3" />}
            Apply Staged Fixes
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1 border-blue-500/30 text-blue-400"
            onClick={() => handleVerify(issues.applyStaged.data?.new_version_id)}
            disabled={!issues.applyStaged.data && stagedCount === 0 || issues.verifyFixes.isPending}
          >
            {issues.verifyFixes.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Eye className="h-3 w-3" />}
            Verify Fixes
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="open">
        <TabsList className="h-7 text-[10px]">
          <TabsTrigger value="open" className="text-[10px] h-6 px-3">
            Open Issues
            {issues.openIssues.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">{issues.openIssues.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="run" className="text-[10px] h-6 px-3">
            Detected This Run
            {latestRunNotes.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">{latestRunNotes.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-2">
          <ScrollArea className="h-[340px]">
            {issues.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center space-y-1">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 mx-auto" />
                <p className="text-[10px] text-muted-foreground">No open issues match your filters.</p>
              </div>
            ) : (
              <div className="space-y-1.5 pr-2">
                {filtered.map(iss => (
                  <IssueRow
                    key={iss.id}
                    issue={iss}
                    isSelected={selectedIds.has(iss.id)}
                    onToggleSelect={() => toggleSelect(iss.id)}
                    onStage={openStageModal}
                    onResolve={i => issues.resolveManually.mutate({ issueId: i.id })}
                    onDismiss={i => issues.dismissIssue.mutate({ issueId: i.id })}
                    onUnstage={i => issues.unstageIssue.mutate(i.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="run" className="mt-2">
          <ScrollArea className="h-[340px]">
            <div className="pr-2">
              {isRunning ? (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Generating…</span>
                </div>
              ) : (
                <DetectedRunList notes={latestRunNotes} />
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Stage Fix Modal */}
      <Dialog open={!!stageModalIssue} onOpenChange={open => !open && setStageModalIssue(null)}>
        {stageModalIssue && (
          <StageFixModal
            issue={stageModalIssue}
            fixOptions={fixOptions}
            isGenerating={generatingFor === stageModalIssue.id || issues.generateFixes.isPending}
            onGenerate={() => handleGenerateFixes(stageModalIssue)}
            onStage={async (choice) => {
              await issues.stageIssue.mutateAsync({ issueId: stageModalIssue.id, fixChoice: choice });
              setStageModalIssue(null);
            }}
            onClose={() => setStageModalIssue(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

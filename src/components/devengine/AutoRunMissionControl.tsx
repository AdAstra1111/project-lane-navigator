import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getLadderForFormat } from '@/lib/stages/registry';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import {
  Play, Pause, Square, RotateCcw, Zap, AlertTriangle, CheckCircle2, Loader2,
  Eye, FileText, Copy, Download, ChevronRight, Shield, Rocket, Settings2,
  HelpCircle, ArrowUpRight, Radio, Film,
} from 'lucide-react';
import type { AutoRunJob, AutoRunStep, PendingDecision } from '@/hooks/useAutoRun';
import type { DocumentTextResult } from '@/hooks/useAutoRunMissionControl';
import type { DeliverableType } from '@/lib/dev-os-config';

// ── Constants ──
const LADDER_LABELS: Record<string, string> = {
  idea: 'Idea', topline_narrative: 'Topline', concept_brief: 'Concept Brief',
  market_sheet: 'Market Sheet', vertical_market_sheet: 'Market Sheet (Vertical)',
  blueprint: 'Blueprint', architecture: 'Architecture',
  character_bible: 'Character Bible', beat_sheet: 'Beat Sheet',
  script: 'Script', production_draft: 'Production Draft', deck: 'Deck',
  format_rules: 'Format Rules', season_arc: 'Season Arc',
  episode_grid: 'Episode Grid', vertical_episode_beats: 'Episode Beats',
  documentary_outline: 'Doc Outline',
  series_writer: 'Series Writer', writers_room: "Writer's Room",
};
const LADDER_OPTIONS = [
  'idea','topline_narrative','concept_brief','market_sheet','blueprint',
  'architecture','character_bible','beat_sheet','script','production_draft',
];

// ── Provenance badge helper ──
type InferMethod = 'extracted' | 'inferred' | 'default' | 'project';
const METHOD_BADGE: Record<InferMethod, { label: string; color: string }> = {
  extracted: { label: 'From docs', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  inferred:  { label: 'Inferred',  color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  project:   { label: 'Project',   color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  default:   { label: 'Default',   color: 'bg-muted text-muted-foreground' },
};

async function callInferCriteria(projectId: string): Promise<{ criteria: Record<string, string>; sources: Record<string, { source_doc_type: string; method: InferMethod }> } | null> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/infer-criteria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  running: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: '● Running' },
  paused: { color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: '⏸ Paused' },
  stopped: { color: 'bg-destructive/15 text-destructive border-destructive/30', label: '⏹ Stopped' },
  completed: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: '✓ Completed' },
  failed: { color: 'bg-destructive/15 text-destructive border-destructive/30', label: '✗ Failed' },
  queued: { color: 'bg-muted text-muted-foreground', label: 'Queued' },
};

const LANE_OPTIONS = ['studio', 'indie-studio', 'independent-film', 'micro-budget', 'prestige', 'mainstream', 'genre', 'arthouse'];
const BUDGET_OPTIONS = ['micro', 'low', 'medium', 'high', 'tentpole'];

// ── Props ──
interface ProjectDocument {
  id: string;
  doc_type: string;
  title: string;
}

interface ProjectData {
  format?: string | null;
  assigned_lane?: string | null;
  budget_range?: string | null;
  genres?: string[] | null;
  comparable_titles?: string | null;
  tone?: string | null;
  target_audience?: string | null;
  episode_target_duration_seconds?: number | null;
  season_episode_count?: number | null;
  guardrails_config?: any;
  pitchLogline?: string | null;
  pitchPremise?: string | null;
}

// Must stay in sync with APPROVAL_REQUIRED_STAGES in src/lib/pipeline-brain.ts
const APPROVAL_REQUIRED_STAGES = new Set(['episode_grid', 'character_bible', 'season_arc', 'format_rules']);

const SEED_DOC_TYPES = ['project_overview', 'creative_brief', 'market_positioning', 'canon', 'nec'];
const SEED_LABELS: Record<string, string> = {
  project_overview: 'Overview', creative_brief: 'Brief', market_positioning: 'Market', canon: 'Canon', nec: 'NEC',
};

interface AutoRunMissionControlProps {
  projectId: string;
  currentDeliverable: DeliverableType;
  job: AutoRunJob | null;
  steps: AutoRunStep[];
  isRunning: boolean;
  error: string | null;
  activated: boolean;
  onActivate: () => void;
  onStart: (mode: string, startDoc: string, targetDoc?: string) => void;
  /** Map of document_id -> approved_version_id, used for pipeline progress */
  approvedVersionMap?: Record<string, string>;
  onPause: () => void;
  onResume: (followLatest?: boolean) => void;
  onSetResumeSource: (documentId: string, versionId: string) => Promise<void>;
  onStop: () => void;
  onRunNext: () => void;
  onClear: () => void;
  onGetPendingDoc: () => Promise<any>;
  onApproveNext: (decision: 'approve' | 'revise' | 'stop') => void;
  onApproveDecision: (decisionId: string, selectedValue: string) => void;
  onSetStage: (stage: string) => void;
  onForcePromote: () => void;
  onRestartFromStage: (stage: string) => void;
  onSaveStorySetup: (setup: Record<string, string>) => Promise<void>;
  onSaveQualifications: (quals: any) => Promise<void>;
  onSaveLaneBudget: (lane: string, budget: string) => Promise<void>;
  onSaveGuardrails: (gc: any) => Promise<void>;
  fetchDocumentText: (documentId?: string, versionId?: string) => Promise<DocumentTextResult | null>;
  /** Analysis data for auto-filling story setup */
  latestAnalysis?: any;
  /** Current document text to show in viewer */
  currentDocText?: string;
  /** Current document metadata */
  currentDocMeta?: { doc_type?: string; version?: number; char_count?: number };
  /** All documents in the project for start-from picker */
  availableDocuments?: ProjectDocument[];
  /** Project data for pre-filling fields */
  project?: ProjectData | null;
}

// ── Sub-components ──

function DecisionCard({ decision, onApprove }: { decision: PendingDecision; onApprove: (id: string, val: string) => void }) {
  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-2">
      <div className="flex items-start gap-2">
        <HelpCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs font-medium">{decision.question}</p>
      </div>
      <div className="space-y-1.5">
        {decision.options.map((opt) => (
          <button key={opt.value} onClick={() => onApprove(decision.id, opt.value)}
            className={`w-full text-left text-[11px] p-2 rounded border transition-colors hover:bg-primary/10 hover:border-primary/40 ${
              decision.recommended === opt.value ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-background'
            }`}>
            <span className="font-medium">{opt.value}</span>
            {decision.recommended === opt.value && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1.5 bg-primary/10 text-primary border-primary/30">recommended</Badge>
            )}
            <p className="text-muted-foreground mt-0.5">{opt.why}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepTimeline({ steps, onViewOutput }: { steps: AutoRunStep[]; onViewOutput: (step: AutoRunStep) => void }) {
  const actionColors: Record<string, string> = {
    review: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    rewrite: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    generate: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    promotion_check: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    approval_required: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    stop: 'bg-destructive/15 text-destructive border-destructive/30',
    start: 'bg-muted text-muted-foreground',
    force_promote: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    set_stage: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  };

  return (
    <div className="space-y-1">
      {steps.map((step) => {
        const color = actionColors[step.action] || 'bg-muted text-muted-foreground';
        const hasOutput = step.output_text || (step.output_ref as any)?.docId;
        return (
          <div key={step.id} className="flex items-start gap-2 p-2 rounded bg-muted/20 hover:bg-muted/40 transition-colors group">
            <div className="flex flex-col items-center pt-0.5">
              <span className="text-[9px] text-muted-foreground font-mono w-5 text-center">{step.step_index}</span>
              <div className="w-px h-full bg-border/50 mt-1" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className={`text-[8px] px-1.5 py-0 ${color}`}>{step.action}</Badge>
                <Badge variant="outline" className="text-[8px] px-1 py-0">{LADDER_LABELS[step.document] || step.document}</Badge>
                {step.readiness != null && (
                  <span className="text-[8px] text-muted-foreground">R:{step.readiness}</span>
                )}
                {step.confidence != null && (
                  <span className="text-[8px] text-muted-foreground">C:{step.confidence}</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{step.summary || '—'}</p>
              {step.risk_flags?.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {step.risk_flags.map((f, i) => (
                    <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 bg-destructive/10 text-destructive border-destructive/30">{f}</Badge>
                  ))}
                </div>
              )}
            </div>
            {hasOutput && (
              <Button variant="ghost" size="sm" className="h-5 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onViewOutput(step)}>
                <Eye className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Format error strings: strip HTML tags, extract structured codes, and truncate */
function formatErrorDisplay(err: string | null | undefined): string {
  if (!err) return '';
  let clean = err.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const codeMatch = clean.match(/^(.+?)\s+error\s+\((\d+)\):\s*(.*)/s);
  if (codeMatch) {
    const [, fn, status, body] = codeMatch;
    const truncBody = body.length > 200 ? body.slice(0, 200) + '…' : body;
    return `${fn} failed (HTTP ${status}): ${truncBody}`;
  }
  return clean.length > 300 ? clean.slice(0, 300) + '…' : clean;
}

// ── Main Component ──
export function AutoRunMissionControl({
  projectId, currentDeliverable, job, steps, isRunning, error,
  activated, onActivate,
  onStart, onPause, onResume, onSetResumeSource, onStop, onRunNext, onClear,
  onGetPendingDoc, onApproveNext, onApproveDecision,
  onSetStage, onForcePromote, onRestartFromStage,
  onSaveStorySetup, onSaveQualifications, onSaveLaneBudget, onSaveGuardrails,
  fetchDocumentText,
  latestAnalysis, currentDocText, currentDocMeta,
  availableDocuments, project, approvedVersionMap = {},
}: AutoRunMissionControlProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('balanced');
  const [safeMode, setSafeMode] = useState(true);
  const [startDocument, setStartDocument] = useState(currentDeliverable as string);

  // Document viewer state
  const [docViewerTab, setDocViewerTab] = useState('current');
  const [viewerText, setViewerText] = useState('');
  const [viewerMeta, setViewerMeta] = useState<{ doc_type?: string; version?: number; char_count?: number }>({});
  const [viewerLoading, setViewerLoading] = useState(false);

  // Pending doc state
  const [pendingDoc, setPendingDoc] = useState<any>(null);
  const [pendingLoading, setPendingLoading] = useState(false);

  // Intervention state
  const [storySetup, setStorySetup] = useState<Record<string, string>>({
    logline: '', premise: '', tone_genre: '', protagonist: '', antagonist: '',
    stakes: '', world_rules: '', comparables: '',
  });
  const [storySources, setStorySources] = useState<Record<string, { source_doc_type: string; method: InferMethod }>>({});
  const [inferLoading, setInferLoading] = useState(false);
  const [storyAutoFilled, setStoryAutoFilled] = useState(false);
  const inferFiredRef = useRef(false);

  // Reset infer ref when projectId changes so switching projects re-triggers inference
  useEffect(() => {
    inferFiredRef.current = false;
    setStoryAutoFilled(false);
  }, [projectId]);
  const [quals, setQuals] = useState({ episode_target_duration_min_seconds: 0, episode_target_duration_max_seconds: 0, season_episode_count: 0, target_runtime_min_low: 0, target_runtime_min_high: 0 });
  const [lane, setLane] = useState('');
  const [budget, setBudget] = useState('');
  const [jumpStage, setJumpStage] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [preflightErrors, setPreflightErrors] = useState<string[]>([]);

  // ── Seed Pack + Pipeline Progress (computed from availableDocuments + ladder) ──
  const projectFormat = (project?.format || 'film').toLowerCase().replace(/_/g, '-');
  const ladder = useMemo(() => getLadderForFormat(projectFormat), [projectFormat]);
  const finalStage = ladder[ladder.length - 1];

  const existingDocTypes = useMemo(
    () => new Set((availableDocuments || []).map(d => d.doc_type)),
    [availableDocuments],
  );

  // Seed pack status: check docs exist. Flag short docs as warnings.
  const seedStatus = useMemo(() => {
    const allDocs = availableDocuments || [];
    const present = SEED_DOC_TYPES.filter(dt => {
      const doc = allDocs.find(d => d.doc_type === dt);
      return !!doc;
    });
    const missing = SEED_DOC_TYPES.filter(dt => !present.includes(dt));
    // Warn on docs that exist but might be stubs (no way to check plaintext from here,
    // but server will surface warnings — this is a best-effort UI check)
    return { present, missing, allPresent: missing.length === 0 };
  }, [availableDocuments]);

  // approvedDocTypes: see APPROVAL_REQUIRED_STAGES at module top

  // Build set of doc_types that have an approved version
  const approvedDocTypes = useMemo(() => {
    const set = new Set<string>();
    if (!availableDocuments) return set;
    for (const doc of availableDocuments) {
      if (approvedVersionMap[doc.id]) {
        set.add(doc.doc_type);
      }
    }
    return set;
  }, [availableDocuments, approvedVersionMap]);

  const pipelineProgress = useMemo(() => {
    const satisfied = ladder.filter(stage => {
      if (!existingDocTypes.has(stage)) return false;
      // For approval-required stages, must also have an approved version
      if (APPROVAL_REQUIRED_STAGES.has(stage)) return approvedDocTypes.has(stage);
      return true;
    });
    return { satisfied: satisfied.length, total: ladder.length, stages: ladder, existingDocTypes, approvedDocTypes };
  }, [ladder, existingDocTypes, approvedDocTypes, APPROVAL_REQUIRED_STAGES]);

  const [starting, setStarting] = useState(false);

  const handlePerfectPackage = useCallback(async () => {
    setStarting(true);
    try {
      await onSaveStorySetup(storySetup);
      await onStart(mode, startDocument, finalStage);
    } catch (e: any) {
      toast({ title: 'Auto-Run failed to start', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  }, [storySetup, mode, startDocument, finalStage, onSaveStorySetup, onStart]);

  const [projectPreFilled, setProjectPreFilled] = useState(false);
  useEffect(() => {
    if (projectPreFilled || !project) return;
    // Lane & budget
    if (project.assigned_lane) setLane(project.assigned_lane);
    if (project.budget_range) setBudget(project.budget_range);
    // Qualifications
    const gc = project.guardrails_config;
    const gcQuals = gc?.overrides?.qualifications || {};
    setQuals(prev => ({
      episode_target_duration_min_seconds: gcQuals.episode_target_duration_min_seconds || (project as any).episode_target_duration_min_seconds || gcQuals.episode_target_duration_seconds || project.episode_target_duration_seconds || prev.episode_target_duration_min_seconds,
      episode_target_duration_max_seconds: gcQuals.episode_target_duration_max_seconds || (project as any).episode_target_duration_max_seconds || gcQuals.episode_target_duration_seconds || project.episode_target_duration_seconds || prev.episode_target_duration_max_seconds,
      season_episode_count: gcQuals.season_episode_count || project.season_episode_count || prev.season_episode_count,
      target_runtime_min_low: gcQuals.target_runtime_min_low || prev.target_runtime_min_low,
      target_runtime_min_high: gcQuals.target_runtime_min_high || prev.target_runtime_min_high,
    }));
    setProjectPreFilled(true);
  }, [project, projectPreFilled]);

  // ── Auto-infer story setup from project documents (fires once per projectId when activated) ──
  // inferFiredRef tracks whether we've already fetched for this projectId so we don't loop
  useEffect(() => {
    if (!activated || inferFiredRef.current || !projectId) return;
    inferFiredRef.current = true;
    setInferLoading(true);
    callInferCriteria(projectId).then(result => {
      if (!result) return;
      const { criteria, sources } = result;
      // Inference wins: overwrite any field that has a real value from docs/LLM
      // (method !== 'default'). Default-method values fill blanks only.
      setStorySetup(prev => {
        const merged = { ...prev };
        for (const [key, val] of Object.entries(criteria)) {
          if (!val?.trim()) continue;
          const method = sources?.[key]?.method;
          // Always overwrite if extracted or inferred; only fill blank if default
          if (method === 'extracted' || method === 'inferred' || !merged[key]) {
            merged[key] = val;
          }
        }
        return merged;
      });
      setStorySources(sources || {});
      setStoryAutoFilled(true);
    }).finally(() => setInferLoading(false));
  }, [activated, projectId]);

  // Fallback: also fill from latestAnalysis if any field still empty after inference
  useEffect(() => {
    if (!latestAnalysis) return;
    const a = latestAnalysis;
    const extracted: Record<string, string> = {};
    if (a.logline) extracted.logline = a.logline;
    if (a.premise) extracted.premise = a.premise;
    if (a.tone || a.genre) extracted.tone_genre = [a.tone, a.genre].filter(Boolean).join(' / ');
    if (a.protagonist) extracted.protagonist = typeof a.protagonist === 'string' ? a.protagonist : a.protagonist?.name || '';
    if (a.antagonist) extracted.antagonist = typeof a.antagonist === 'string' ? a.antagonist : a.antagonist?.name || '';
    if (a.stakes) extracted.stakes = a.stakes;
    if (a.world_rules) extracted.world_rules = a.world_rules;
    if (a.comparables) extracted.comparables = Array.isArray(a.comparables) ? a.comparables.join(', ') : a.comparables;
    if (!extracted.logline && a.concept?.logline) extracted.logline = a.concept.logline;
    if (!extracted.premise && a.concept?.premise) extracted.premise = a.concept.premise;
    if (!extracted.tone_genre && a.concept?.tone) extracted.tone_genre = a.concept.tone;
    if (!extracted.comparables && a.concept?.comparables) extracted.comparables = Array.isArray(a.concept.comparables) ? a.concept.comparables.join(', ') : a.concept.comparables;
    if (!extracted.protagonist && a.characters?.length > 0) {
      const protag = a.characters.find((c: any) => c.role === 'protagonist' || c.is_protagonist);
      if (protag) extracted.protagonist = protag.name || '';
    }
    if (!extracted.antagonist && a.characters?.length > 0) {
      const antag = a.characters.find((c: any) => c.role === 'antagonist' || c.is_antagonist);
      if (antag) extracted.antagonist = antag.name || '';
    }
    if (Object.keys(extracted).length > 0) {
      setStorySetup(prev => {
        const merged = { ...prev };
        for (const [key, val] of Object.entries(extracted)) {
          if (val && !merged[key]) merged[key] = val;
        }
        return merged;
      });
    }
  }, [latestAnalysis]);

  // Auto-load current document text into viewer
  useEffect(() => {
    if (currentDocText && !viewerText) {
      setViewerText(currentDocText);
      setViewerMeta(currentDocMeta || {});
    }
  }, [currentDocText, currentDocMeta]);

  // Load pending doc when approval gate activates
  useEffect(() => {
    if (job?.awaiting_approval && !pendingDoc && !pendingLoading) {
      setPendingLoading(true);
      onGetPendingDoc().then(doc => { setPendingDoc(doc); setPendingLoading(false); setDocViewerTab('pending'); })
        .catch(() => setPendingLoading(false));
    }
    if (!job?.awaiting_approval) { setPendingDoc(null); }
  }, [job?.awaiting_approval, job?.id]);

  // Load current doc text
  const loadCurrentDoc = async () => {
    if (!job) return;
    setViewerLoading(true);
    const result = await fetchDocumentText(undefined, undefined);
    // Fetch from current stage
    if (job.pending_doc_id) {
      const r = await fetchDocumentText(job.pending_doc_id);
      if (r) {
        setViewerText(r.plaintext);
        setViewerMeta({ doc_type: r.doc_type, version: r.version_number, char_count: r.char_count });
      }
    }
    setViewerLoading(false);
  };

  const loadStepDoc = async (step: AutoRunStep) => {
    const ref = step.output_ref as any;
    setDocViewerTab('step');
    setViewerLoading(true);
    if (ref?.docId || ref?.versionId || ref?.newVersionId) {
      const r = await fetchDocumentText(ref.docId, ref.versionId || ref.newVersionId);
      if (r) {
        setViewerText(r.plaintext);
        setViewerMeta({ doc_type: r.doc_type, version: r.version_number, char_count: r.char_count });
      }
    } else if (step.output_text) {
      setViewerText(step.output_text);
      setViewerMeta({ char_count: step.output_text.length });
    }
    setViewerLoading(false);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const downloadTxt = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const hasDecisions = job?.pending_decisions && job.pending_decisions.length > 0;
  const blockingDecision = hasDecisions
    ? (job!.pending_decisions as PendingDecision[]).find(d => d.impact === 'blocking') || (job!.pending_decisions as PendingDecision[])[0]
    : null;

  const hasEscalation = job?.last_risk_flags?.some((f: string) => f.startsWith('hard_gate:'))
    || job?.stop_reason?.includes('Executive Strategy');

  const progressPct = job && job.max_total_steps > 0 ? Math.round((job.step_count / job.max_total_steps) * 100) : 0;
  const statusStyle = STATUS_STYLES[job?.status || 'queued'] || STATUS_STYLES.queued;

  // ── All story setup fields ──
  const ALL_STORY_FIELDS = [
    { key: 'logline',     label: 'Logline',     required: true,  multiline: false },
    { key: 'premise',     label: 'Premise',      required: true,  multiline: true  },
    { key: 'tone_genre',  label: 'Tone / Genre', required: true,  multiline: false },
    { key: 'protagonist', label: 'Protagonist',  required: false, multiline: false },
    { key: 'antagonist',  label: 'Antagonist',   required: false, multiline: false },
    { key: 'stakes',      label: 'Stakes',       required: false, multiline: false },
    { key: 'world_rules', label: 'World Rules',  required: false, multiline: false },
    { key: 'comparables', label: 'Comparables',  required: false, multiline: false },
  ];

  const handleStartClick = useCallback(async () => {
    setStarting(true);
    try {
      await onSaveStorySetup(storySetup);
      await onStart(mode, startDocument);
    } catch (e: any) {
      toast({ title: 'Auto-Run failed to start', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  }, [storySetup, mode, startDocument, onSaveStorySetup, onStart]);

  const handleReInfer = useCallback(() => {
    setInferLoading(true);
    setStoryAutoFilled(false);
    callInferCriteria(projectId).then(result => {
      if (!result) { setInferLoading(false); return; }
      const { criteria, sources } = result;
      // Full overwrite on manual rebuild — replace all fields from docs
      setStorySetup(prev => {
        const merged = { ...prev };
        for (const [key, val] of Object.entries(criteria)) {
          if (!val?.trim()) continue;
          const method = sources?.[key]?.method;
          if (method === 'extracted' || method === 'inferred' || !merged[key]) {
            merged[key] = val;
          }
        }
        return merged;
      });
      setStorySources(sources || {});
      setStoryAutoFilled(true);
    }).finally(() => setInferLoading(false));
  }, [projectId]);

  // ── Not activated → Show activate button ──
  if (!activated) {
    return (
      <Card className="border-border/40">
        <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
          <Rocket className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Auto-Run is off</p>
            <p className="text-xs text-muted-foreground mt-1">Activate to automate the development ladder from idea to script.</p>
          </div>
          <Button size="sm" onClick={onActivate} className="gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Activate Auto-Run
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── No job or terminal state → Start form ──
  if (!job || ['completed', 'stopped', 'failed'].includes(job.status)) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Rocket className="h-4 w-4" /> Auto-Run Mission Control
            </CardTitle>
            {/* Re-infer button */}
            <Button
              variant="ghost" size="sm"
              className="h-6 text-[10px] gap-1 text-muted-foreground"
              onClick={handleReInfer}
              disabled={inferLoading}
              title="Re-pull fields from project documents"
            >
              {inferLoading
                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                : <RotateCcw className="h-2.5 w-2.5" />
              }
              {inferLoading ? 'Reading docs…' : 'Re-read docs'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {job?.status === 'completed' && (
            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
              ✓ {job.stop_reason || 'Target reached'} · {job.step_count} steps
            </div>
          )}
          {job?.status === 'stopped' && (
            <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              ⏹ {job.stop_reason}
            </div>
          )}
          {job?.status === 'failed' && (
            <div className="p-2.5 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive space-y-1.5">
              <div className="font-semibold">✗ Auto-Run Failed</div>
              <div>{job.stop_reason || formatErrorDisplay(job.error) || 'Unknown failure'}</div>
              {(job as any).missing_seed_docs && Array.isArray((job as any).missing_seed_docs) && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] font-medium text-destructive/80">Missing seed documents:</div>
                  <ul className="list-disc list-inside text-[10px] text-destructive/70">
                    {(job as any).missing_seed_docs.map((d: string) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Seed Pack Status ── */}
          <div className={`p-2.5 rounded-md border text-xs space-y-1.5 ${
            seedStatus.allPresent
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-amber-500/5 border-amber-500/20'
          }`}>
            <div className="flex items-center gap-1.5">
              {seedStatus.allPresent
                ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /><span className="text-emerald-400 font-medium">Seed Pack Ready</span></>
                : <><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /><span className="text-amber-400 font-medium">Seed Pack Incomplete</span></>
              }
              <span className="text-muted-foreground ml-auto text-[10px]">{seedStatus.present.length}/{SEED_DOC_TYPES.length}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {SEED_DOC_TYPES.map(dt => {
                const isPresent = seedStatus.present.includes(dt);
                return (
                  <Badge key={dt} variant="outline" className={`text-[8px] px-1.5 py-0 ${
                    isPresent
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}>
                    {isPresent ? '✓' : '✗'} {SEED_LABELS[dt] || dt}
                  </Badge>
                );
              })}
            </div>
            {seedStatus.missing.length > 0 && (
              <span className="text-[9px] text-muted-foreground">Missing docs will be auto-generated on start</span>
            )}
          </div>

          {/* ── Pipeline Progress ── */}
          <div className="p-2.5 rounded-md border border-border/40 bg-muted/10 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Pipeline Progress</span>
              <span className="text-[10px] font-semibold">{pipelineProgress.satisfied}/{pipelineProgress.total} stages</span>
            </div>
            <Progress value={(pipelineProgress.satisfied / Math.max(pipelineProgress.total, 1)) * 100} className="h-1.5" />
            <div className="flex gap-1 flex-wrap">
              {pipelineProgress.stages.map(stage => (
                <span key={stage} className={`text-[8px] px-1 py-0.5 rounded ${
                  pipelineProgress.existingDocTypes.has(stage)
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-muted/40 text-muted-foreground'
                }`}>
                  {LADDER_LABELS[stage] || stage}
                </span>
              ))}
            </div>
          </div>

          {/* ── Run to Perfect Package CTA ── */}
          <Button
            size="sm"
            variant="outline"
            className="w-full h-9 text-xs gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary/50"
            onClick={handlePerfectPackage}
            disabled={inferLoading || starting}
          >
            <Rocket className="h-3.5 w-3.5 text-primary" />
            Run to Perfect Package
            <Badge variant="outline" className="text-[8px] px-1 py-0 ml-auto bg-primary/10 text-primary border-primary/30">
              → {LADDER_LABELS[finalStage] || finalStage}
            </Badge>
          </Button>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Story Setup</p>
              {inferLoading && (
                <span className="text-[9px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Reading docs…
                </span>
              )}
              {storyAutoFilled && !inferLoading && (
                <span className="text-[9px] text-emerald-400">✓ Auto-filled from docs</span>
              )}
            </div>
            {ALL_STORY_FIELDS.map(field => {
              const src = storySources[field.key];
              const badge = src?.method ? METHOD_BADGE[src.method as InferMethod] : null;
              return (
                <div key={field.key}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <Label className="text-[10px] flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-destructive">*</span>}
                    </Label>
                    {badge && (
                      <Badge
                        variant="outline"
                        className={`text-[8px] px-1 py-0 ${badge.color}`}
                        title={src?.source_doc_type ? `From: ${src.source_doc_type}` : ''}
                      >
                        {badge.label}
                      </Badge>
                    )}
                  </div>
                  {field.multiline ? (
                    <Textarea
                      className="text-xs min-h-[50px]"
                      placeholder={inferLoading ? 'Reading documents…' : `Enter ${field.label.toLowerCase()}…`}
                      value={storySetup[field.key] || ''}
                      onChange={e => setStorySetup(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      className="h-7 text-xs"
                      placeholder={inferLoading ? 'Reading documents…' : `Enter ${field.label.toLowerCase()}…`}
                      value={storySetup[field.key] || ''}
                      onChange={e => setStorySetup(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Document selector */}
          {availableDocuments && availableDocuments.length > 0 && (
            <div>
              <Label className="text-[10px] text-muted-foreground">Start from document</Label>
              <Select value={startDocument} onValueChange={setStartDocument}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Select document…" /></SelectTrigger>
                <SelectContent>
                  {availableDocuments.map(doc => (
                    <SelectItem key={doc.id} value={doc.doc_type}>
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 shrink-0" />
                        {doc.title || LADDER_LABELS[doc.doc_type] || doc.doc_type}
                        <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1">{LADDER_LABELS[doc.doc_type] || doc.doc_type}</Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="h-8 text-xs w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">⚡ Fast (8)</SelectItem>
                <SelectItem value="balanced">⚖️ Balanced (12)</SelectItem>
                <SelectItem value="premium">💎 Premium (18)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 flex-1"
            onClick={handleStartClick}
              disabled={inferLoading || starting}
            >
              {starting
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Starting…</>
                : inferLoading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Reading docs…</>
                  : <><Play className="h-3.5 w-3.5" /> Confirm & Start</>
              }
            </Button>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>⚡ {mode === 'fast' ? '1 loop/stage, 8 steps' : mode === 'balanced' ? '2 loops/stage, 12 steps' : '3 loops/stage, 18 steps, ≥82 readiness'}</span>
          </div>

          {error && (
            <div className="text-[10px] text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
              {formatErrorDisplay(error)}
            </div>
          )}
          {job && (
            <Button variant="ghost" size="sm" className="h-7 text-[10px] w-full" onClick={onClear}>
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }
  // ── Active job → Full Mission Control ──
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ══════ LEFT COLUMN ══════ */}
        <div className="space-y-3">

          {/* A) Job Status Card */}
          <Card className="border-primary/20">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs flex items-center gap-2">
                <Rocket className="h-3.5 w-3.5" /> Mission Control
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ml-auto ${statusStyle.color}`}>
                  {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                  {statusStyle.label}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              {/* Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Step {job.step_count}/{job.max_total_steps}</span>
                  <span>Loop {job.stage_loop_count}/{job.max_stage_loops}</span>
                  <span className="uppercase text-[9px]">{job.mode}</span>
                </div>
                <Progress value={progressPct} className="h-1.5" />
              </div>

              {/* Stage info + pipeline progress */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/30">
                  {LADDER_LABELS[job.current_document] || job.current_document}
                </Badge>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">{LADDER_LABELS[job.target_document] || job.target_document}</span>
                <span className="text-[9px] ml-auto font-medium">{pipelineProgress.satisfied}/{pipelineProgress.total} stages</span>
              </div>

              {/* Scores */}
              {job.last_readiness != null && (
                <div className="grid grid-cols-5 gap-1 text-[9px]">
                  {[
                    { label: 'Readiness', value: job.last_readiness },
                    { label: 'CI', value: job.last_ci },
                    { label: 'GP', value: job.last_gp },
                    { label: 'Gap', value: job.last_gap },
                    { label: 'Conf', value: job.last_confidence },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center p-1 rounded bg-muted/30">
                      <div className="text-muted-foreground text-[8px]">{label}</div>
                      <div className="font-semibold">{value ?? '—'}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Risk flags */}
              {job.last_risk_flags?.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {job.last_risk_flags.map((f: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[8px] px-1 py-0 bg-destructive/10 text-destructive border-destructive/30">{f}</Badge>
                  ))}
                </div>
              )}

              {/* Stop reason / error (when not related to approval) */}
              {job.stop_reason && !job.awaiting_approval && !hasDecisions && (
                <div className="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded p-2">
                  {job.stop_reason}
                </div>
              )}
              {error && (
                <div className="text-[10px] text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
                  {formatErrorDisplay(error)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* B) Primary Controls */}
          <Card>
            <CardContent className="p-3">
              <div className="flex gap-1.5 flex-wrap">
                {job.status === 'running' && !job.awaiting_approval && (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onPause}>
                      <Pause className="h-3 w-3" /> Pause
                    </Button>
                    <Button variant="destructive" size="sm" className="h-7 text-[10px] gap-1" onClick={onStop}>
                      <Square className="h-3 w-3" /> Stop
                    </Button>
                  </>
                )}
                {job.status === 'paused' && !hasDecisions && !job.awaiting_approval && (
                  <>
                    <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => onResume()}>
                      <Play className="h-3 w-3" /> Resume
                    </Button>
                    <Button variant="destructive" size="sm" className="h-7 text-[10px] gap-1" onClick={onStop}>
                      <Square className="h-3 w-3" /> Stop
                    </Button>
                  </>
                )}
              </div>
              {/* Follow Latest toggle */}
              <div className="flex items-center gap-2 mt-2">
                <Switch
                  checked={job.follow_latest !== false}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onResume(true);
                    }
                  }}
                  className="scale-75"
                />
                <span className="text-[9px] text-muted-foreground">
                  Follow Latest Version
                  {job.follow_latest === false && job.resume_document_id && (
                    <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1 bg-amber-500/10 text-amber-500 border-amber-500/30">pinned</Badge>
                  )}
                </span>
              </div>
              {/* Safe mode toggle */}
              <div className="flex items-center gap-2 mt-1">
                <Switch checked={safeMode} onCheckedChange={setSafeMode} className="scale-75" />
                <span className="text-[9px] text-muted-foreground">Safe Mode (require approval for all promotions)</span>
              </div>
            </CardContent>
          </Card>

          {/* C) Series Writer Handoff Gate — replaces generic approval when approval_type === "series_writer" */}
          {job.awaiting_approval && job.approval_type === 'series_writer' && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Film className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">Series Writer Required</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Episode scripts for series formats must be created and revised through Series Writer to maintain version continuity. AutoRun handles all pre-script stages; Series Writer owns the script stage.
                    </p>
                  </div>
                </div>
                <div className="p-2 rounded border border-amber-500/20 bg-amber-500/5 text-[10px] text-amber-400">
                  ⚠ Creating a new script via AutoRun would break version history. Use Series Writer to generate or revise episode scripts.
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 flex-1"
                    onClick={() => navigate(`/projects/${projectId}/series-writer`)}
                  >
                    <Film className="h-3.5 w-3.5" /> Open Series Writer
                  </Button>
                  <Button variant="destructive" size="sm" className="h-8 text-xs gap-1.5" onClick={onStop}>
                    <Square className="h-3.5 w-3.5" /> Stop AutoRun
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* C2) Standard Approval Gate — only shown when NOT a series_writer handoff */}
          {job.awaiting_approval && job.approval_type !== 'series_writer' && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">Approval Required</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {job.approval_type === 'convert'
                        ? `Review the newly generated ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before continuing.`
                        : job.pending_next_doc_type === 'series_writer'
                          ? `Review ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before entering Series Writer.`
                          : `Review ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before promoting to ${LADDER_LABELS[job.pending_next_doc_type || ''] || job.pending_next_doc_type || 'Next Step'}.`
                      }
                    </p>
                  </div>
                </div>

                {pendingLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading document…
                  </div>
                )}

                {pendingDoc && (
                  <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                    <FileText className="h-3 w-3" />
                    {pendingDoc.char_count?.toLocaleString()} chars
                    <Badge variant="outline" className="text-[8px] px-1 py-0">{pendingDoc.approval_type}</Badge>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" className="h-8 text-xs gap-1.5 flex-1" onClick={() => onApproveNext('approve')}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Continue
                  </Button>
                  <Button variant="destructive" size="sm" className="h-8 text-xs gap-1.5" onClick={() => onApproveNext('stop')}>
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending decision cards */}
          {hasDecisions && blockingDecision && (
            <DecisionCard decision={blockingDecision} onApprove={onApproveDecision} />
          )}

          {/* D) Interventions Accordion */}
          <Accordion type="multiple" className="space-y-1">
            {/* D1: Story Setup */}
            <AccordionItem value="story" className="border rounded-lg px-3">
              <AccordionTrigger className="text-xs py-2">
                <span className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Story Setup</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                {['logline', 'premise', 'tone_genre', 'protagonist', 'antagonist', 'stakes', 'world_rules', 'comparables'].map(field => (
                  <div key={field}>
                    <Label className="text-[10px] capitalize">{field.replace(/_/g, ' ')}</Label>
                    <Textarea className="text-xs min-h-[40px] mt-0.5" value={storySetup[field] || ''}
                      onChange={e => setStorySetup(prev => ({ ...prev, [field]: e.target.value }))}
                      placeholder={field === 'comparables' ? 'Title 1, Title 2, …' : `Enter ${field.replace(/_/g, ' ')}…`} />
                  </div>
                ))}
                <Button size="sm" className="h-7 text-[10px] w-full" disabled={saving === 'story'}
                  onClick={async () => { setSaving('story'); await onSaveStorySetup(storySetup); toast({ title: 'Story setup saved' }); setSaving(null); }}>
                  {saving === 'story' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save to Project'}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* D2: Qualifications */}
            <AccordionItem value="quals" className="border rounded-lg px-3">
              <AccordionTrigger className="text-xs py-2">
                <span className="flex items-center gap-1.5"><Settings2 className="h-3 w-3" /> Format & Qualifications</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Ep Duration Min (s)</Label>
                    <Input type="number" className="h-7 text-xs mt-0.5" value={quals.episode_target_duration_min_seconds || ''}
                      onChange={e => setQuals(p => ({ ...p, episode_target_duration_min_seconds: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Ep Duration Max (s)</Label>
                    <Input type="number" className="h-7 text-xs mt-0.5" value={quals.episode_target_duration_max_seconds || ''}
                      onChange={e => setQuals(p => ({ ...p, episode_target_duration_max_seconds: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Season Episodes</Label>
                    <Input type="number" className="h-7 text-xs mt-0.5" value={quals.season_episode_count || ''}
                      onChange={e => setQuals(p => ({ ...p, season_episode_count: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Runtime Min (low)</Label>
                    <Input type="number" className="h-7 text-xs mt-0.5" value={quals.target_runtime_min_low || ''}
                      onChange={e => setQuals(p => ({ ...p, target_runtime_min_low: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Runtime Min (high)</Label>
                    <Input type="number" className="h-7 text-xs mt-0.5" value={quals.target_runtime_min_high || ''}
                      onChange={e => setQuals(p => ({ ...p, target_runtime_min_high: Number(e.target.value) }))} />
                  </div>
                </div>
                <Button size="sm" className="h-7 text-[10px] w-full" disabled={saving === 'quals'}
                  onClick={async () => { setSaving('quals'); await onSaveQualifications(quals); toast({ title: 'Qualifications saved' }); setSaving(null); }}>
                  {saving === 'quals' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Qualifications'}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* D3: Lane/Budget */}
            <AccordionItem value="lane" className="border rounded-lg px-3">
              <AccordionTrigger className="text-xs py-2">
                <span className="flex items-center gap-1.5"><ArrowUpRight className="h-3 w-3" /> Lane & Budget</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Lane</Label>
                    <Select value={lane} onValueChange={setLane}>
                      <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {LANE_OPTIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Budget</Label>
                    <Select value={budget} onValueChange={setBudget}>
                      <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {BUDGET_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button size="sm" className="h-7 text-[10px] w-full" disabled={saving === 'lane' || !lane || !budget}
                  onClick={async () => { setSaving('lane'); await onSaveLaneBudget(lane, budget); toast({ title: 'Lane & budget saved' }); setSaving(null); }}>
                  {saving === 'lane' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Lane/Budget'}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* D5: Stage Control */}
            <AccordionItem value="stage" className="border rounded-lg px-3">
              <AccordionTrigger className="text-xs py-2">
                <span className="flex items-center gap-1.5"><Radio className="h-3 w-3" /> Stage Control</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                <div>
                  <Label className="text-[10px]">Jump to stage</Label>
                  <Select value={jumpStage} onValueChange={setJumpStage}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Select stage…" /></SelectTrigger>
                    <SelectContent>
                      {LADDER_OPTIONS.map(s => <SelectItem key={s} value={s}>{LADDER_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!jumpStage}
                    onClick={() => { onSetStage(jumpStage); toast({ title: `Stage set to ${LADDER_LABELS[jumpStage]}` }); }}>
                    Set Stage
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onForcePromote}>
                    <ArrowUpRight className="h-3 w-3" /> Force Promote
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!jumpStage}
                    onClick={() => { onRestartFromStage(jumpStage); toast({ title: `Restarted from ${LADDER_LABELS[jumpStage]}` }); }}>
                    <RotateCcw className="h-3 w-3" /> Restart From Stage
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* D6: Escalation */}
            {hasEscalation && (
              <AccordionItem value="escalation" className="border border-destructive/30 rounded-lg px-3">
                <AccordionTrigger className="text-xs py-2">
                  <span className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-3 w-3" /> Escalation Required</span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-3">
                  <p className="text-[10px] text-muted-foreground">Auto-run cannot proceed without a strategic decision.</p>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onForcePromote}>
                      <ArrowUpRight className="h-3 w-3" /> Force Promote
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onPause}>
                      <Pause className="h-3 w-3" /> Pause for Manual Editing
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>

        {/* ══════ RIGHT COLUMN ══════ */}
        <div className="space-y-3">
          {/* Timeline */}
          <Card>
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" /> Timeline ({steps.length} steps)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <ScrollArea className="max-h-[300px]">
                <StepTimeline steps={steps} onViewOutput={loadStepDoc} />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Document Viewer */}
          <Card>
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs flex items-center gap-2">
                <Eye className="h-3.5 w-3.5" /> Document Viewer
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <Tabs value={docViewerTab} onValueChange={setDocViewerTab}>
                <TabsList className="h-7">
                  <TabsTrigger value="current" className="text-[10px] px-2 h-6">Current Doc</TabsTrigger>
                  {job.awaiting_approval && (
                    <TabsTrigger value="pending" className="text-[10px] px-2 h-6">Pending Doc</TabsTrigger>
                  )}
                  <TabsTrigger value="step" className="text-[10px] px-2 h-6">From Step</TabsTrigger>
                </TabsList>

                <TabsContent value="pending" className="mt-2">
                  {pendingLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
                  {pendingDoc && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Badge variant="outline" className="text-[8px]">{pendingDoc.doc_type}</Badge>
                        <span>{pendingDoc.char_count?.toLocaleString()} chars</span>
                      </div>
                      <ScrollArea className="max-h-[400px] border rounded p-2 bg-muted/20">
                        <pre className="text-[10px] whitespace-pre-wrap font-mono leading-relaxed text-foreground">
                          {pendingDoc.text || pendingDoc.preview || '(empty)'}
                        </pre>
                      </ScrollArea>
                      <div className="flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1" onClick={() => copyText(pendingDoc.text)}>
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1" onClick={() => downloadTxt(pendingDoc.text, `${pendingDoc.doc_type}.txt`)}>
                          <Download className="h-3 w-3" /> Download
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="current" className="mt-2">
                  {!viewerText && !viewerLoading && (
                    <div className="text-center py-6">
                      <p className="text-[10px] text-muted-foreground">Click a step to view its output, or load current doc</p>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] mt-2" onClick={loadCurrentDoc}>
                        <Eye className="h-3 w-3 mr-1" /> Load Current Document
                      </Button>
                    </div>
                  )}
                  {viewerLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
                  {viewerText && docViewerTab === 'current' && (
                    <DocViewer text={viewerText} meta={viewerMeta} onCopy={copyText} onDownload={downloadTxt} />
                  )}
                </TabsContent>

                <TabsContent value="step" className="mt-2">
                  {viewerLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
                  {!viewerText && !viewerLoading && docViewerTab === 'step' && (
                    <p className="text-[10px] text-muted-foreground text-center py-6">Click a step's 👁 icon to view its output</p>
                  )}
                  {viewerText && docViewerTab === 'step' && (
                    <DocViewer text={viewerText} meta={viewerMeta} onCopy={copyText} onDownload={downloadTxt} />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DocViewer({ text, meta, onCopy, onDownload }: {
  text: string;
  meta: { doc_type?: string; version?: number; char_count?: number };
  onCopy: (t: string) => void;
  onDownload: (t: string, f: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {meta.doc_type && <Badge variant="outline" className="text-[8px]">{meta.doc_type}</Badge>}
        {meta.version != null && <span>v{meta.version}</span>}
        {meta.char_count != null && <span>{meta.char_count.toLocaleString()} chars</span>}
      </div>
      <ScrollArea className="max-h-[400px] border rounded p-2 bg-muted/20">
        <pre className="text-[10px] whitespace-pre-wrap font-mono leading-relaxed text-foreground">
          {text || '(empty)'}
        </pre>
      </ScrollArea>
      <div className="flex gap-1.5">
        <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1" onClick={() => onCopy(text)}>
          <Copy className="h-3 w-3" /> Copy
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1" onClick={() => onDownload(text, `${meta.doc_type || 'document'}.txt`)}>
          <Download className="h-3 w-3" /> Download
        </Button>
      </div>
    </div>
  );
}

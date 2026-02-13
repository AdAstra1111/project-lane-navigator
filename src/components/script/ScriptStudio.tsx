/**
 * Script Studio — Read-only Script Page with 2-column layout.
 * Left: Script Viewer with scene navigator.
 * Right: Intelligence Panel with tabs (Coverage, Notes, Compare, Metrics, Structure, Evidence).
 * Simple vs Advanced mode properly gated.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, ChevronDown, MoreHorizontal, Download, Copy, Eye, Search,
  FileSearch, Loader2, Compass, RotateCw, List, WrapText, Type,
  ChevronRight, BarChart3, ClipboardList, GitCompareArrows, Layers,
  BookOpen, Star, Zap, Package, DollarSign, Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { useUIMode } from '@/hooks/useUIMode';
import { canSeeAdvanced } from '@/lib/visibility';
import { useScriptEngine, type ScriptScene, type ScriptVersion } from '@/hooks/useScriptEngine';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format as fmtDate } from 'date-fns';

// Intelligence sub-panels — lazy imports via the existing coverage component internals
import { GreenlightSimulator } from '@/components/GreenlightSimulator';
import { ConvergencePanel } from '@/components/ConvergencePanel';
import { NotesReview } from '@/components/script/NotesReview';
import { OperationProgress } from '@/components/OperationProgress';
import type { StructuredNote } from '@/hooks/useNoteFeedback';
import type { PackagingMode, PackagingStage } from '@/lib/role-gravity-engine';

/* ──────────────────────────── Types ──────────────────────────── */

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

interface ScriptStudioProps {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  hasDocuments: boolean;
  lane?: string;
  productionType?: string;
  packagingMode?: PackagingMode;
  packagingStage?: PackagingStage;
  characters?: any[];
  scripts: any[];
  currentScript: any;
  documents: any[];
  scriptText: string | null;
}

const COVERAGE_STAGES = [
  { at: 5, label: 'Pass A: Analyst diagnosis…' },
  { at: 25, label: 'Pass A: Extracting evidence…' },
  { at: 40, label: 'Pass B: Producer notes…' },
  { at: 60, label: 'Pass B: Building action plan…' },
  { at: 75, label: 'Pass C: QC + structuring notes…' },
  { at: 90, label: 'Saving results…' },
];

/* ──────────────────────────── Helpers ──────────────────────────── */

function stripJsonFromCoverage(raw: string): string {
  const lines = raw.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let jsonDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    if (!inCodeBlock && jsonDepth === 0) {
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) &&
        (trimmed.includes('"note_id"') || trimmed.includes('"structured_notes"') ||
         trimmed.includes('"finding"') || trimmed.includes('"diagnosis"'))) {
        jsonDepth = 1; continue;
      }
    }
    if (jsonDepth > 0) {
      for (const ch of trimmed) {
        if (ch === '{' || ch === '[') jsonDepth++;
        if (ch === '}' || ch === ']') jsonDepth--;
      }
      if (jsonDepth <= 0) jsonDepth = 0;
      continue;
    }
    if (trimmed.match(/^"[a-z_]+":\s*[\[{"]/)) continue;
    if (trimmed.match(/^\{?\s*"note_id"/)) continue;
    if (trimmed.match(/^\},?\s*$/)) continue;
    if (trimmed.match(/^\]\s*$/)) continue;
    if (trimmed.match(/^#{1,4}\s*structured.?notes/i)) continue;
    if (trimmed.match(/^\*{1,2}structured.?notes\*{1,2}/i)) continue;
    if (trimmed.match(/^structured.?notes\s*:?\s*$/i)) continue;
    result.push(line);
  }
  return result.join('\n').trim();
}

function CoverageMarkdown({ markdown }: { markdown: string }) {
  const cleaned = stripJsonFromCoverage(markdown);
  const lines = cleaned.split('\n');
  return (
    <div className="prose prose-sm prose-invert max-w-none space-y-1">
      {lines.map((line, i) => {
        if (line.match(/^#{1,3}\s/))
          return <h4 key={i} className="text-primary font-display font-semibold mt-4 mb-1 text-sm">{line.replace(/^#+\s*/, '')}</h4>;
        if (line.match(/^\*\*[A-Z]/))
          return <p key={i} className="text-foreground font-semibold text-sm mt-3">{line.replace(/\*\*/g, '')}</p>;
        if (line.match(/^[-•*]\s/))
          return <p key={i} className="text-sm text-muted-foreground pl-4 before:content-['•'] before:mr-2 before:text-primary/60">{line.replace(/^[-•*]\s*/, '')}</p>;
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{line}</p>;
      })}
    </div>
  );
}

/* ──────────────────────────── Scene Parsing ──────────────────────────── */

interface ParsedScene {
  number: number;
  heading: string;
  startIndex: number;
}

function parseSceneHeadings(text: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  const regex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)[\s]+(.+)/gim;
  let match;
  let num = 1;
  while ((match = regex.exec(text)) !== null) {
    scenes.push({
      number: num++,
      heading: match[0].trim(),
      startIndex: match.index,
    });
  }
  return scenes;
}

/* ──────────────────────────── Script Viewer ──────────────────────────── */

function ScriptViewer({
  text,
  scenes: engineScenes,
  isAdvanced,
}: {
  text: string | null;
  scenes: ScriptScene[];
  isAdvanced: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [screenplayStyle, setScreenplayStyle] = useState(true);
  const [fixedWidth, setFixedWidth] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const parsedScenes = useMemo(() => {
    if (!text) return [];
    return parseSceneHeadings(text);
  }, [text]);

  const displayScenes = parsedScenes.length > 0 ? parsedScenes : engineScenes.map((s, i) => ({
    number: s.scene_number,
    heading: s.location ? `${s.location}` : `Scene ${s.scene_number}`,
    startIndex: i,
  }));

  const scrollToScene = useCallback((sceneIndex: number) => {
    if (!viewerRef.current || !text) return;
    const scene = parsedScenes[sceneIndex];
    if (!scene) return;
    // Find the approximate line position and scroll
    const textBefore = text.substring(0, scene.startIndex);
    const linesBefore = textBefore.split('\n').length;
    const lineHeight = 22; // approximate
    viewerRef.current.scrollTop = linesBefore * lineHeight;
  }, [text, parsedScenes]);

  // Filter text for search highlights
  const highlightText = useCallback((content: string) => {
    if (!searchQuery) return content;
    return content;
  }, [searchQuery]);

  if (!text) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">No script text available</p>
        <p className="text-muted-foreground/60 text-xs mt-1">Upload a script document to view it here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mini toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0">
        <div className="relative flex-1 max-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search script…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setFixedWidth(!fixedWidth)}
            className={`p-1 rounded text-xs ${fixedWidth ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            title={fixedWidth ? 'Wrapped' : 'Fixed width'}
          >
            <WrapText className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setScreenplayStyle(!screenplayStyle)}
            className={`p-1 rounded text-xs ${screenplayStyle ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            title={screenplayStyle ? 'Screenplay style' : 'Plain'}
          >
            <Type className="h-3.5 w-3.5" />
          </button>
          {isAdvanced && displayScenes.length > 0 && (
            <button
              onClick={() => setShowNav(!showNav)}
              className={`p-1 rounded text-xs ${showNav ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              title="Scene Navigator"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Scene Navigator */}
        <AnimatePresence>
          {showNav && isAdvanced && displayScenes.length > 0 && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 200, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-r border-border/40 overflow-hidden shrink-0"
            >
              <ScrollArea className="h-full">
                <div className="p-2 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 py-1">Scenes</p>
                  {displayScenes.map((scene, i) => (
                    <button
                      key={i}
                      onClick={() => scrollToScene(i)}
                      className="w-full text-left text-[11px] px-2 py-1.5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors truncate"
                    >
                      <span className="font-mono text-[9px] text-muted-foreground/60 mr-1.5">{scene.number}.</span>
                      {scene.heading}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Script content */}
        <ScrollArea className="flex-1" ref={viewerRef}>
          <div className={`p-6 ${fixedWidth ? 'max-w-[680px] mx-auto' : ''}`}>
            <pre
              className={`whitespace-pre-wrap leading-relaxed text-foreground ${
                screenplayStyle
                  ? 'font-mono text-[13px] tracking-wide'
                  : 'font-sans text-sm'
              }`}
            >
              {text}
            </pre>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/* ──────────────────────────── Intelligence Panel ──────────────────────────── */

function IntelligencePanel({
  projectId,
  projectTitle,
  format,
  genres,
  lane,
  selectedRun,
  runs,
  isAdvanced,
  onRunCoverage,
  isCoverageLoading,
  packagingMode,
  packagingStage,
  characters,
}: {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  lane: string;
  selectedRun: CoverageRunData | null;
  runs: CoverageRunData[];
  isAdvanced: boolean;
  onRunCoverage: () => void;
  isCoverageLoading: boolean;
  packagingMode?: PackagingMode;
  packagingStage?: PackagingStage;
  characters?: any[];
}) {
  const [activeTab, setActiveTab] = useState('coverage');

  // Empty state
  if (!selectedRun) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <FileSearch className="h-10 w-10 text-muted-foreground/30 mb-4" />
        <p className="text-sm font-medium text-foreground mb-1">No Coverage Yet</p>
        <p className="text-xs text-muted-foreground mb-4">Run coverage analysis to get structured notes, greenlight simulation, and more.</p>
        <Button onClick={onRunCoverage} disabled={isCoverageLoading} size="sm">
          {isCoverageLoading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running…</>
          ) : (
            <><FileSearch className="h-3.5 w-3.5 mr-1.5" />Run Coverage</>
          )}
        </Button>
        <OperationProgress isActive={isCoverageLoading} stages={COVERAGE_STAGES} />
      </div>
    );
  }

  // Build tabs based on mode
  const simpleTabs = [
    { id: 'coverage', label: 'Coverage', icon: FileSearch },
    { id: 'notes', label: 'Notes', icon: ClipboardList },
  ];

  const advancedTabs = [
    { id: 'coverage', label: 'Coverage', icon: FileSearch },
    { id: 'notes', label: 'Notes', icon: ClipboardList },
    ...(runs.length > 1 ? [{ id: 'compare', label: 'Compare', icon: GitCompareArrows }] : []),
    { id: 'metrics', label: 'Metrics', icon: BarChart3 },
    { id: 'structure', label: 'Structure', icon: Layers },
    { id: 'greenlight', label: 'Greenlight', icon: Zap },
    { id: 'convergence', label: 'Convergence', icon: Compass },
  ];

  const tabs = isAdvanced ? advancedTabs : simpleTabs;

  // Ensure activeTab is valid for current mode
  const validTab = tabs.find(t => t.id === activeTab) ? activeTab : 'coverage';

  return (
    <div className="flex flex-col h-full">
      <Tabs value={validTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <TabsList className="bg-muted/30 mx-3 mt-3 shrink-0 flex-wrap h-auto gap-0.5 justify-start">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.id} value={t.id} className="text-[11px] gap-1 py-1 px-2">
                <Icon className="h-3 w-3" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <ScrollArea className="flex-1 px-3 pb-3">
          <TabsContent value="coverage" className="mt-3">
            <CoverageMarkdown markdown={selectedRun.final_coverage} />
          </TabsContent>

          <TabsContent value="notes" className="mt-3">
            {selectedRun.structured_notes?.length > 0 ? (
              <NotesReview
                notes={selectedRun.structured_notes}
                runId={selectedRun.id}
                projectId={projectId}
                projectType={selectedRun.project_type}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No structured notes for this coverage run.</p>
              </div>
            )}
          </TabsContent>

          {isAdvanced && (
            <>
              <TabsContent value="compare" className="mt-3">
                {runs.length >= 2 ? (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">Compare coverage across drafts</p>
                    {runs.map((run, i) => (
                      <div key={run.id} className="rounded-lg border border-border/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-foreground">{run.draft_label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {fmtDate(new Date(run.created_at), 'dd MMM yyyy')}
                          </span>
                        </div>
                        {run.metrics && (
                          <div className="flex gap-2 flex-wrap">
                            {Object.entries(run.metrics).filter(([k, v]) => typeof v === 'number').slice(0, 5).map(([k, v]) => (
                              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">
                                {k.replace(/_/g, ' ')}: {v as number}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Need 2+ coverage runs to compare.</p>
                )}
              </TabsContent>

              <TabsContent value="metrics" className="mt-3">
                {selectedRun.metrics && Object.keys(selectedRun.metrics).length > 0 ? (
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider">Script Metrics</h5>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(selectedRun.metrics)
                        .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                        .map(([k, v]) => (
                          <div key={k} className="bg-muted/20 rounded-lg p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.replace(/_/g, ' ')}</p>
                            <p className="text-sm font-medium text-foreground mt-0.5">{typeof v === 'number' ? Math.round(v as number) : String(v)}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No metrics available.</p>
                )}
              </TabsContent>

              <TabsContent value="structure" className="mt-3">
                <div className="space-y-3">
                  <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider">Analysis Passes</h5>
                  {[
                    { label: 'Pass A: Analyst', content: selectedRun.pass_a },
                    { label: 'Pass B: Producer', content: selectedRun.pass_b },
                    { label: 'Pass C: QC', content: selectedRun.pass_c },
                  ].filter(p => p.content).map(pass => (
                    <Collapsible key={pass.label}>
                      <CollapsibleTrigger className="w-full text-left">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:text-foreground py-1.5">
                          <BarChart3 className="h-3 w-3" /> {pass.label}
                          <ChevronDown className="h-3 w-3 ml-auto transition-transform [[data-state=open]_&]:rotate-180" />
                        </p>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 p-3 rounded-lg bg-muted/20 border border-border/30 max-h-[300px] overflow-y-auto">
                          <CoverageMarkdown markdown={pass.content} />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="greenlight" className="mt-3">
                <GreenlightSimulator
                  projectTitle={projectTitle}
                  format={format}
                  genres={genres}
                  lane={lane}
                  scoringGrid={selectedRun.metrics?.scoring_grid}
                  riskFlags={selectedRun.metrics?.risk_flags}
                  developmentTier={selectedRun.metrics?.development_tier}
                  financeReadiness={selectedRun.metrics?.finance_readiness}
                  coverageSummary={selectedRun.final_coverage?.slice(0, 3000)}
                />
              </TabsContent>

              <TabsContent value="convergence" className="mt-3">
                <ConvergencePanel
                  projectId={projectId}
                  projectTitle={projectTitle}
                  format={format}
                  genres={genres}
                  lane={lane}
                  scoringGrid={selectedRun.metrics?.scoring_grid}
                  riskFlags={selectedRun.metrics?.risk_flags}
                  coverageSummary={selectedRun.final_coverage?.slice(0, 3000)}
                />
              </TabsContent>
            </>
          )}
        </ScrollArea>
      </Tabs>
    </div>
  );
}

/* ──────────────────────────── Main Component ──────────────────────────── */

const FORMAT_LABELS: Record<string, string> = {
  film: 'Feature Film', 'tv-series': 'TV Series', documentary: 'Documentary Feature',
  'documentary-series': 'Documentary Series', commercial: 'Commercial / Advert',
  'branded-content': 'Branded Content', 'short-film': 'Short Film',
  'music-video': 'Music Video', 'proof-of-concept': 'Proof of Concept',
  'digital-series': 'Digital / Social Series', hybrid: 'Hybrid Project',
  'vertical-drama': 'Vertical Drama',
};

export function ScriptStudio({
  projectId, projectTitle, format, genres, hasDocuments,
  lane, productionType, packagingMode, packagingStage, characters,
  scripts, currentScript, documents, scriptText,
}: ScriptStudioProps) {
  const { mode } = useUIMode();
  const isAdvanced = canSeeAdvanced(mode);
  const { user } = useAuth();

  // Script engine data
  const { scenes, versions, activeScript } = useScriptEngine(projectId);

  // Coverage runs
  const [runs, setRuns] = useState<CoverageRunData[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [isCoverageLoading, setIsCoverageLoading] = useState(false);
  const [draftLabel, setDraftLabel] = useState('Draft 1');

  // Version selector
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);

  // Coverage progress state for bottom bar
  const [showProgress, setShowProgress] = useState(false);

  const selectedRun = runs.find(r => r.id === selectedRunId) || null;

  // Load coverage runs
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
        setSelectedRunId(mapped[0].id);
        setDraftLabel(`Draft ${data.length + 1}`);
      }
    };
    load();
  }, [projectId]);

  // Handle generate coverage
  const handleRunCoverage = async () => {
    setIsCoverageLoading(true);
    setShowProgress(true);
    try {
      const { data: docs } = await supabase
        .from('project_documents')
        .select('extracted_text')
        .eq('project_id', projectId)
        .not('extracted_text', 'is', null);

      let text = (docs || [])
        .map((d: any) => d.extracted_text)
        .filter((t: string) => t && t.length > 100)
        .join('\n\n---\n\n');

      if (!text || text.length < 100) {
        toast.error('No extracted text found — upload a script document first.');
        return;
      }

      const trimmedScript = text.slice(0, 15000);
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
      setSelectedRunId(newRun.id);
      setDraftLabel(`Draft ${runs.length + 2}`);
      toast.success('Coverage analysis complete');
    } catch (e: any) {
      toast.error(e.message || 'Coverage failed');
    } finally {
      setIsCoverageLoading(false);
      setTimeout(() => setShowProgress(false), 2000);
    }
  };

  const handleCopyText = () => {
    if (scriptText) {
      navigator.clipboard.writeText(scriptText);
      toast.success('Script text copied');
    }
  };

  const handleDownload = () => {
    if (scriptText) {
      const blob = new Blob([scriptText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectTitle || 'script'}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const scriptStatus = activeScript?.status || currentScript?.status || 'draft';
  const statusLabel = scriptStatus === 'LOCKED' ? 'Locked' : scriptStatus === 'current' ? 'Latest' : 'Draft';
  const statusColor = scriptStatus === 'LOCKED'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-primary/15 text-primary border-primary/30';

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[500px]">
      {/* ═══ A) PAGE HEADER ═══ */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-foreground text-lg truncate">
              {currentScript?.version_label || activeScript?.version_label || 'Script'}
            </h2>
            <Link to={`/projects/${projectId}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
              ← {projectTitle}
            </Link>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Version selector */}
            {versions.length > 1 && (
              <Select
                value={String(selectedVersionIdx)}
                onValueChange={v => setSelectedVersionIdx(Number(v))}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v, i) => (
                    <SelectItem key={v.id} value={String(i)} className="text-xs">
                      Version {v.draft_number} — {fmtDate(new Date(v.created_at), 'dd MMM')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Status pill */}
            <Badge variant="outline" className={`text-[10px] ${statusColor}`}>
              {statusLabel}
            </Badge>

            {/* Primary CTA */}
            <Button
              size="sm"
              onClick={handleRunCoverage}
              disabled={isCoverageLoading || !hasDocuments}
              className="text-xs gap-1.5"
            >
              {isCoverageLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
              ) : (
                <><FileSearch className="h-3.5 w-3.5" />Run Coverage</>
              )}
            </Button>

            {/* Development Engine */}
            <Button variant="outline" size="sm" className="text-xs gap-1.5" asChild>
              <Link to="/development-engine">
                <Zap className="h-3.5 w-3.5" />Dev Engine
              </Link>
            </Button>

            {/* Overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownload} disabled={!scriptText}>
                  <Download className="h-3.5 w-3.5 mr-2" />Download
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyText} disabled={!scriptText}>
                  <Copy className="h-3.5 w-3.5 mr-2" />Copy text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Simple/Advanced indicator */}
            <Badge variant="outline" className="text-[10px] ml-1">
              {isAdvanced ? 'Advanced' : 'Simple'}
            </Badge>
          </div>
        </div>
      </div>

      {/* ═══ B) MAIN BODY — 2-column Studio Layout ═══ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT COLUMN: Script Viewer */}
        <div className="flex-[7] min-w-0 border-r border-border/40">
          <ScriptViewer
            text={scriptText === '__SCRIPT_EXISTS_NO_TEXT__' ? null : scriptText}
            scenes={scenes}
            isAdvanced={isAdvanced}
          />
        </div>

        {/* RIGHT COLUMN: Intelligence Panel */}
        <div className="flex-[3] min-w-0 bg-card/50">
          <IntelligencePanel
            projectId={projectId}
            projectTitle={projectTitle}
            format={format}
            genres={genres}
            lane={lane || ''}
            selectedRun={selectedRun}
            runs={runs}
            isAdvanced={isAdvanced}
            onRunCoverage={handleRunCoverage}
            isCoverageLoading={isCoverageLoading}
            packagingMode={packagingMode}
            packagingStage={packagingStage}
            characters={characters}
          />
        </div>
      </div>

      {/* ═══ C) BOTTOM STICKY ACTION BAR ═══ */}
      <AnimatePresence>
        {showProgress && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="sticky bottom-0 z-10 bg-background/95 backdrop-blur border-t border-border/40 px-4 py-2 flex items-center gap-3"
          >
            {isCoverageLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Running coverage analysis…</span>
                <OperationProgress isActive={true} stages={COVERAGE_STAGES} />
              </>
            ) : (
              <>
                <span className="text-xs text-emerald-400">✓ Coverage complete</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowProgress(false)}
                >
                  Dismiss
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

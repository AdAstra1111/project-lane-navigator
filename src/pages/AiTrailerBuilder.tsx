/**
 * AiTrailerBuilder — Wizard page for building an AI taster trailer.
 * Uses multi-source "Trailer Definition Pack" for source selection.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import {
  ArrowLeft, ArrowRight, Sparkles, Film, FileText, Image,
  Loader2, Star, Zap, Heart, Download, Package, Play, Pause,
  ChevronUp, ChevronDown, X, Search, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useAiTrailerFactory, TrailerDefinitionPackItem } from '@/hooks/useAiTrailerFactory';
import { Input } from '@/components/ui/input';

type Step = 'source' | 'moments' | 'shotlist' | 'generate' | 'assemble';

const EXTRACT_STAGES = ['Reading Materials', 'Analyzing Structure', 'Extracting Moments', 'Saving Moments', 'Complete'];
const GENERATE_STAGES = ['Preparing Prompts', 'Generating Frames', 'Generating Motion Stills', 'Saving Media', 'Complete'];
const ASSEMBLE_STAGES = ['Collecting Assets', 'Building Timeline', 'Writing Timeline File', 'Finalizing', 'Complete'];
const PDF_EXTRACT_STAGES = ['Locating Script PDF', 'Creating Signed URL', 'Extracting Text', 'Creating Script Document', 'Saving Version'];

// Doc type categories for grouping
const DOC_CATEGORIES: Record<string, string[]> = {
  'Script-like': ['script', 'screenplay', 'episode_script', 'treatment'],
  'Story': ['beat_sheet', 'blueprint', 'story_outline', 'episode_grid', 'pilot_story'],
  'World / Canon': ['character_bible', 'world_bible', 'architecture', 'series_bible', 'tone_doc'],
  'Market': ['market_sheet', 'pitch_deck', 'one_pager', 'concept_brief', 'sales_sheet'],
  'Visual': ['lookbook', 'mood_board', 'storyboard', 'visual_references'],
  'Other': [],
};

const PRIMARY_DOC_TYPES = ['script', 'screenplay', 'treatment', 'beat_sheet', 'blueprint', 'concept_brief', 'idea'];

interface SelectedItem {
  documentId: string;
  versionId?: string;
  role: 'primary' | 'supporting';
  sortOrder: number;
  include: boolean;
}

export default function AiTrailerBuilder() {
  const { id: projectId } = useParams<{ id: string }>();
  const [step, setStep] = useState<Step>('source');
  const [selectedMomentIds, setSelectedMomentIds] = useState<Set<string>>(new Set());
  const [activeShotlistId, setActiveShotlistId] = useState<string | null>(null);
  const [selectedBeatIndices, setSelectedBeatIndices] = useState<Set<number>>(new Set());
  const [pdfStageIndex, setPdfStageIndex] = useState(0);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfDetail, setPdfDetail] = useState('');
  const pdfTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Generation state
  const [genRunning, setGenRunning] = useState(false);
  const [genPaused, setGenPaused] = useState(false);
  const genPausedRef = useRef(false);
  const genAbortRef = useRef(false);
  const [genResults, setGenResults] = useState<any[]>([]);
  const [genCurrentBeat, setGenCurrentBeat] = useState<string | null>(null);
  const [genTotalBeats, setGenTotalBeats] = useState(0);
  const [genFrames, setGenFrames] = useState(0);
  const [genMotionStills, setGenMotionStills] = useState(0);

  // Pack builder state
  const [packSelection, setPackSelection] = useState<SelectedItem[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState('');

  const qc = useQueryClient();
  const ai = useAiTrailerFactory(projectId);

  const clearPdfTimers = useCallback(() => {
    pdfTimersRef.current.forEach(clearTimeout);
    pdfTimersRef.current = [];
  }, []);

  useEffect(() => () => clearPdfTimers(), [clearPdfTimers]);

  // Load ALL project documents (not filtered by doc_type)
  const { data: allDocuments = [] } = useQuery({
    queryKey: ['ai-trailer-all-docs', projectId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_documents')
        .select('id, title, doc_type, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!projectId,
  });

  // Load versions for selected docs
  const selectedDocIds = packSelection.map(s => s.documentId);
  const { data: docVersionsMap = {} } = useQuery({
    queryKey: ['ai-trailer-doc-versions', selectedDocIds.sort().join(',')],
    queryFn: async () => {
      if (selectedDocIds.length === 0) return {};
      const { data } = await (supabase as any)
        .from('project_document_versions')
        .select('id, document_id, version_number, created_at')
        .in('document_id', selectedDocIds)
        .order('version_number', { ascending: false });
      const map: Record<string, any[]> = {};
      for (const v of (data || [])) {
        if (!map[v.document_id]) map[v.document_id] = [];
        map[v.document_id].push(v);
      }
      return map;
    },
    enabled: selectedDocIds.length > 0,
  });

  const { data: project } = useQuery({
    queryKey: ['ai-trailer-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  // Hydrate from existing pack on mount
  useEffect(() => {
    if (ai.packs.length > 0 && packSelection.length === 0) {
      const pack = ai.packs[0];
      setActivePackId(pack.id);
      const items = pack.trailer_definition_pack_items || [];
      setPackSelection(items.map((item: TrailerDefinitionPackItem) => ({
        documentId: item.document_id,
        versionId: item.version_id || undefined,
        role: item.role as 'primary' | 'supporting',
        sortOrder: item.sort_order,
        include: item.include,
      })));
    }
  }, [ai.packs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select heuristic when no pack and docs loaded
  useEffect(() => {
    if (packSelection.length === 0 && ai.packs.length === 0 && allDocuments.length > 0) {
      const priorityOrder = ['script', 'screenplay', 'treatment', 'beat_sheet', 'blueprint', 'concept_brief', 'idea'];
      const supportingTypes = ['character_bible', 'market_sheet', 'architecture', 'script_coverage', 'tone_doc'];

      const auto: SelectedItem[] = [];
      let order = 0;

      // Pick primary docs
      for (const dt of priorityOrder) {
        const doc = allDocuments.find((d: any) => d.doc_type === dt && !auto.some(a => a.documentId === d.id));
        if (doc) {
          auto.push({ documentId: doc.id, role: auto.length < 2 ? 'primary' : 'supporting', sortOrder: order++, include: true });
          if (auto.length >= 3) break;
        }
      }

      // Pick supporting docs
      for (const dt of supportingTypes) {
        const doc = allDocuments.find((d: any) => d.doc_type === dt && !auto.some(a => a.documentId === d.id));
        if (doc) {
          auto.push({ documentId: doc.id, role: 'supporting', sortOrder: order++, include: true });
        }
      }

      if (auto.length > 0) setPackSelection(auto);
    }
  }, [allDocuments, ai.packs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPdfExtraction = useCallback(() => {
    clearPdfTimers();
    setPdfStageIndex(0);
    setPdfProgress(5);
    setPdfDetail('Locating script PDF…');

    const t = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      pdfTimersRef.current.push(id);
    };
    t(() => { setPdfStageIndex(1); setPdfProgress(15); setPdfDetail('Downloading PDF…'); }, 2000);
    t(() => { setPdfStageIndex(2); setPdfProgress(30); setPdfDetail('Extracting text via AI…'); }, 5000);
    t(() => { setPdfProgress(50); setPdfDetail('AI is reading the screenplay…'); }, 15000);
    t(() => { setPdfProgress(65); setPdfDetail('Still extracting — large scripts take longer…'); }, 30000);

    ai.createTrailerSourceScript.mutate(undefined, {
      onSuccess: (data: any) => {
        clearPdfTimers();
        setPdfStageIndex(3);
        setPdfProgress(85);
        setPdfDetail('Saving script document…');
        const doneTimer = setTimeout(() => {
          setPdfStageIndex(4);
          setPdfProgress(100);
          setPdfDetail('Complete');
          qc.invalidateQueries({ queryKey: ['ai-trailer-all-docs', projectId] });
          // Auto-add extracted script to pack as primary at top
          if (data.documentId) {
            setPackSelection(prev => {
              const exists = prev.some(p => p.documentId === data.documentId);
              if (exists) return prev;
              return [
                { documentId: data.documentId, versionId: data.versionId, role: 'primary' as const, sortOrder: 0, include: true },
                ...prev.map((p, i) => ({ ...p, sortOrder: i + 1 })),
              ];
            });
          }
        }, 500);
        pdfTimersRef.current.push(doneTimer);
      },
      onError: () => {
        clearPdfTimers();
        setPdfStageIndex(0);
        setPdfProgress(0);
        setPdfDetail('');
      },
    });
  }, [ai.createTrailerSourceScript, clearPdfTimers, projectId, qc]);

  // Group documents by category
  const groupedDocs = useMemo(() => {
    const filtered = docSearch
      ? allDocuments.filter((d: any) =>
          d.title.toLowerCase().includes(docSearch.toLowerCase()) ||
          d.doc_type.toLowerCase().includes(docSearch.toLowerCase()))
      : allDocuments;

    const groups: Record<string, any[]> = {};
    for (const [cat, types] of Object.entries(DOC_CATEGORIES)) {
      if (cat === 'Other') continue;
      const docs = filtered.filter((d: any) => types.includes(d.doc_type));
      if (docs.length > 0) groups[cat] = docs;
    }
    // Other
    const knownTypes = Object.values(DOC_CATEGORIES).flat();
    const otherDocs = filtered.filter((d: any) => !knownTypes.includes(d.doc_type));
    if (otherDocs.length > 0) groups['Other'] = otherDocs;
    return groups;
  }, [allDocuments, docSearch]);

  const isDocSelected = (docId: string) => packSelection.some(s => s.documentId === docId);

  const toggleDoc = (docId: string, docType: string) => {
    setPackSelection(prev => {
      if (prev.some(s => s.documentId === docId)) {
        return prev.filter(s => s.documentId !== docId);
      }
      const isPrimary = PRIMARY_DOC_TYPES.includes(docType) && prev.filter(p => p.role === 'primary').length < 2;
      return [...prev, {
        documentId: docId,
        role: isPrimary ? 'primary' as const : 'supporting' as const,
        sortOrder: prev.length,
        include: true,
      }];
    });
  };

  const moveItem = (docId: string, direction: 'up' | 'down') => {
    setPackSelection(prev => {
      const idx = prev.findIndex(s => s.documentId === docId);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? Math.max(0, idx - 1) : Math.min(prev.length - 1, idx + 1);
      if (newIdx === idx) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next.map((s, i) => ({ ...s, sortOrder: i }));
    });
  };

  const toggleRole = (docId: string) => {
    setPackSelection(prev => prev.map(s =>
      s.documentId === docId ? { ...s, role: s.role === 'primary' ? 'supporting' as const : 'primary' as const } : s
    ));
  };

  const savePack = async () => {
    await ai.upsertPack.mutateAsync({
      packId: activePackId || undefined,
      title: 'Trailer Definition Pack',
      items: packSelection.map(s => ({
        documentId: s.documentId,
        versionId: s.versionId,
        role: s.role,
        sortOrder: s.sortOrder,
        include: s.include,
      })),
    });
    // Set active pack from response
    qc.invalidateQueries({ queryKey: ['trailer-packs', projectId] });
  };

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'source', label: 'Sources', icon: <FileText className="h-4 w-4" /> },
    { key: 'moments', label: 'Moments', icon: <Sparkles className="h-4 w-4" /> },
    { key: 'shotlist', label: 'Shotlist', icon: <Film className="h-4 w-4" /> },
    { key: 'generate', label: 'Generate', icon: <Image className="h-4 w-4" /> },
    { key: 'assemble', label: 'Assemble', icon: <Package className="h-4 w-4" /> },
  ];

  const stepIndex = steps.findIndex(s => s.key === step);
  const canNext = (() => {
    if (step === 'source') return packSelection.length > 0;
    if (step === 'moments') return ai.moments.length > 0;
    if (step === 'shotlist') return ai.shotlists.length > 0;
    return true;
  })();

  const activeShotlist = ai.shotlists.find(s => s.id === activeShotlistId) || ai.shotlists[0];
  const shotlistItems = activeShotlist?.items || [];
  const dbSelectedIndices = (activeShotlist as any)?.selected_indices as number[] | null;

  useEffect(() => {
    if (!activeShotlist || shotlistItems.length === 0) return;
    const initial = dbSelectedIndices && dbSelectedIndices.length > 0
      ? new Set(dbSelectedIndices)
      : new Set(shotlistItems.map((item: any) => item.index as number));
    setSelectedBeatIndices(initial);
  }, [activeShotlist?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Existing generated media for this shotlist (persisted in DB)
  const shotlistMedia = ai.media.filter(m => m.trailer_shotlist_id === activeShotlist?.id);

  const startGeneration = useCallback(async () => {
    if (!activeShotlist) return;
    setGenRunning(true);
    setGenPaused(false);
    genPausedRef.current = false;
    genAbortRef.current = false;
    setGenResults([]);
    setGenFrames(0);
    setGenMotionStills(0);
    setGenCurrentBeat(null);

    try {
      // Save selected indices first
      await ai.saveSelectedIndices.mutateAsync({
        shotlistId: activeShotlist.id,
        selectedIndices: Array.from(selectedBeatIndices),
      });

      // Get the plan
      const plan = await ai.generateTrailerAssetsPlan.mutateAsync(activeShotlist.id);
      if (plan.mode !== 'plan' || !plan.beats?.length) {
        setGenRunning(false);
        return;
      }

      setGenTotalBeats(plan.beats.length);
      let motionStillsTotal = 0;
      const motionStillBudget = 8;

      for (const beat of plan.beats) {
        if (genAbortRef.current) break;

        // Wait while paused
        while (genPausedRef.current) {
          await new Promise(r => setTimeout(r, 300));
          if (genAbortRef.current) break;
        }
        if (genAbortRef.current) break;

        setGenCurrentBeat(`Beat ${beat.index}: ${beat.shot_title}`);

        try {
          const res = await ai.generateSingleBeat.mutateAsync({
            trailerShotlistId: activeShotlist.id,
            beatIndex: beat.index,
            skipMotionStill: motionStillsTotal >= motionStillBudget,
          });

          setGenFrames(prev => prev + (res.framesGenerated || 0));
          motionStillsTotal += res.motionStillsGenerated || 0;
          setGenMotionStills(motionStillsTotal);
          setGenResults(prev => [...prev, res]);
        } catch (err) {
          setGenResults(prev => [...prev, { index: beat.index, status: 'error' }]);
        }
      }
    } catch (err) {
      console.error('Generation failed:', err);
    }

    setGenCurrentBeat(null);
    setGenRunning(false);
  }, [activeShotlist, selectedBeatIndices, ai]);

  const togglePause = useCallback(() => {
    setGenPaused(prev => {
      genPausedRef.current = !prev;
      return !prev;
    });
  }, []);

  const stopGeneration = useCallback(() => {
    genAbortRef.current = true;
    genPausedRef.current = false;
    setGenPaused(false);
  }, []);

  // Get the active pack ID for downstream actions
  const currentPackId = activePackId || (ai.packs.length > 0 ? ai.packs[0].id : null);

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}/development`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Trailer Factory
              </h1>
              {project?.title && <p className="text-xs text-muted-foreground">{project.title}</p>}
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center gap-1 mb-6">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setStep(s.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                  step === s.key
                    ? 'bg-primary text-primary-foreground'
                    : i < stepIndex
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          {/* Step: Define Trailer Sources */}
          {step === 'source' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: Available Documents */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Available Project Documents</CardTitle>
                  <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Search documents…"
                      value={docSearch}
                      onChange={e => setDocSearch(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <ScrollArea className="max-h-[55vh]">
                    {Object.entries(groupedDocs).map(([cat, docs]) => (
                      <div key={cat} className="mb-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                        <div className="space-y-1">
                          {docs.map((doc: any) => (
                            <button
                              key={doc.id}
                              onClick={() => toggleDoc(doc.id, doc.doc_type)}
                              className={`w-full text-left flex items-center gap-2 p-2 rounded border transition-colors text-xs ${
                                isDocSelected(doc.id)
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:bg-muted/30'
                              }`}
                            >
                              <Checkbox checked={isDocSelected(doc.id)} className="pointer-events-none" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{doc.title}</p>
                                <p className="text-[10px] text-muted-foreground">{doc.doc_type}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {allDocuments.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">No project documents found.</p>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Right: Selected for Trailer */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Selected for Trailer ({packSelection.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <ScrollArea className="max-h-[45vh]">
                    {packSelection.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        Select documents from the left to define your trailer sources.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {packSelection.map((item, idx) => {
                          const doc = allDocuments.find((d: any) => d.id === item.documentId);
                          if (!doc) return null;
                          const versions = docVersionsMap[item.documentId] || [];
                          return (
                            <div key={item.documentId} className="flex items-center gap-1.5 p-2 rounded border border-border bg-card">
                              <div className="flex flex-col gap-0.5">
                                <button onClick={() => moveItem(item.documentId, 'up')} disabled={idx === 0}
                                  className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                                <button onClick={() => moveItem(item.documentId, 'down')} disabled={idx === packSelection.length - 1}
                                  className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{doc.title}</p>
                                <p className="text-[10px] text-muted-foreground">{doc.doc_type}</p>
                                {versions.length > 1 && (
                                  <select
                                    value={item.versionId || ''}
                                    onChange={e => {
                                      setPackSelection(prev => prev.map(s =>
                                        s.documentId === item.documentId ? { ...s, versionId: e.target.value || undefined } : s
                                      ));
                                    }}
                                    className="mt-0.5 text-[10px] bg-muted border-border rounded px-1 py-0.5"
                                  >
                                    <option value="">Latest</option>
                                    {versions.map((v: any) => (
                                      <option key={v.id} value={v.id}>v{v.version_number}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                              <Badge
                                variant={item.role === 'primary' ? 'default' : 'outline'}
                                className="text-[8px] cursor-pointer shrink-0"
                                onClick={() => toggleRole(item.documentId)}
                              >
                                {item.role === 'primary' ? 'Primary' : 'Supporting'}
                              </Badge>
                              <button onClick={() => toggleDoc(item.documentId, doc.doc_type)}
                                className="text-muted-foreground hover:text-destructive shrink-0">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  <div className="space-y-2 mt-3 border-t border-border pt-3">
                    <Button size="sm" className="text-xs gap-1 w-full"
                      onClick={savePack}
                      disabled={ai.upsertPack.isPending || packSelection.length === 0}>
                      {ai.upsertPack.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                      Save Definition Pack
                    </Button>

                    {/* Optional PDF extraction CTA */}
                    <Button variant="outline" size="sm" className="text-xs gap-1.5 w-full"
                      onClick={startPdfExtraction}
                      disabled={ai.createTrailerSourceScript.isPending}>
                      {ai.createTrailerSourceScript.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Sparkles className="h-3 w-3" />}
                      Extract Script From PDF (adds to pack)
                    </Button>
                  </div>

                  {ai.createTrailerSourceScript.isPending && (
                    <div className="mt-3">
                      <StagedProgressBar
                        title="Extracting Script from PDF"
                        stages={PDF_EXTRACT_STAGES}
                        currentStageIndex={pdfStageIndex}
                        progressPercent={pdfProgress}
                        etaSeconds={Math.max(0, Math.round((100 - pdfProgress) * 0.8))}
                        detailMessage={pdfDetail || PDF_EXTRACT_STAGES[pdfStageIndex] + '…'}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step: Moments */}
          {step === 'moments' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Moments</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={() => {
                    if (currentPackId) {
                      ai.extractMoments.mutate({ packId: currentPackId });
                    } else if (packSelection.length > 0) {
                      // Auto-save pack first, then extract
                      savePack().then(() => {
                        const packId = ai.packs[0]?.id;
                        if (packId) ai.extractMoments.mutate({ packId });
                      });
                    }
                  }}
                  disabled={ai.extractMoments.isPending || packSelection.length === 0}>
                  {ai.extractMoments.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Extract Moments
                </Button>
              </CardHeader>
              <CardContent>
                {ai.extractMoments.isPending && (
                  <div className="mb-4">
                    <StagedProgressBar
                      title="Extracting Trailer Moments"
                      stages={EXTRACT_STAGES}
                      currentStageIndex={1}
                      progressPercent={40}
                      etaSeconds={30}
                      detailMessage="Analyzing project materials and identifying high-impact beats…"
                    />
                  </div>
                )}
                {ai.isLoadingMoments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : ai.moments.length === 0 && !ai.extractMoments.isPending ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No moments extracted yet. Click "Extract Moments" to analyze your selected documents.</p>
                ) : !ai.extractMoments.isPending && (
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-2">
                      {ai.moments.map(m => (
                        <div key={m.id} className={`p-3 rounded border transition-colors ${
                          selectedMomentIds.has(m.id) ? 'border-primary bg-primary/5' : 'border-border'
                        }`}>
                          <div className="flex items-start gap-2">
                            <Checkbox checked={selectedMomentIds.has(m.id)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedMomentIds);
                                if (checked) next.add(m.id); else next.delete(m.id);
                                setSelectedMomentIds(next);
                              }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{m.moment_summary}</p>
                              {m.scene_number && <span className="text-[10px] text-muted-foreground">Scene {m.scene_number}</span>}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] flex items-center gap-0.5"><Zap className="h-2.5 w-2.5 text-amber-400" />{m.hook_strength}</span>
                                <span className="text-[10px] flex items-center gap-0.5"><Star className="h-2.5 w-2.5 text-blue-400" />{m.spectacle_score}</span>
                                <span className="text-[10px] flex items-center gap-0.5"><Heart className="h-2.5 w-2.5 text-red-400" />{m.emotional_score}</span>
                                {m.ai_friendly && (
                                  <Badge variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">AI-Friendly</Badge>
                                )}
                              </div>
                              {m.suggested_visual_approach && (
                                <p className="text-[10px] text-muted-foreground mt-1 italic">{m.suggested_visual_approach}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Shotlist */}
          {step === 'shotlist' && (
            <Card>
             <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Shotlist</CardTitle>
                <div className="flex items-center gap-2">
                  {activeShotlist && (
                    <Button size="sm" variant="outline" className="text-xs gap-1"
                      onClick={() => {
                        ai.saveSelectedIndices.mutate({
                          shotlistId: activeShotlist.id,
                          selectedIndices: Array.from(selectedBeatIndices),
                        });
                      }}
                      disabled={ai.saveSelectedIndices.isPending || selectedBeatIndices.size === 0}>
                      {ai.saveSelectedIndices.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Save Selection ({selectedBeatIndices.size}/{shotlistItems.length})
                    </Button>
                  )}
                  <Button size="sm" className="text-xs gap-1"
                    onClick={() => {
                      const momentIds = selectedMomentIds.size > 0
                        ? Array.from(selectedMomentIds)
                        : undefined;
                      ai.buildShotlist.mutate({ count: 16, momentIds });
                    }}
                    disabled={ai.buildShotlist.isPending || ai.moments.length === 0}>
                    {ai.buildShotlist.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
                    {selectedMomentIds.size > 0 ? `Build from ${selectedMomentIds.size} Selected` : 'Build Shotlist'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ai.isLoadingShotlists ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : !activeShotlist ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No shotlist yet. Extract moments first, then build a shotlist.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2"
                        onClick={() => {
                          setSelectedBeatIndices(new Set(shotlistItems.map((i: any) => i.index)));
                          if (activeShotlist) {
                            const updatedItems = shotlistItems.map((it: any) => ({ ...it, included: true }));
                            ai.updateShotlistItems.mutate({ shotlistId: activeShotlist.id, items: updatedItems });
                          }
                        }}>
                        Select All
                      </Button>
                      <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2"
                        onClick={() => {
                          setSelectedBeatIndices(new Set());
                          if (activeShotlist) {
                            const updatedItems = shotlistItems.map((it: any) => ({ ...it, included: false }));
                            ai.updateShotlistItems.mutate({ shotlistId: activeShotlist.id, items: updatedItems });
                          }
                        }}>
                        Deselect All
                      </Button>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {selectedBeatIndices.size} of {shotlistItems.length} beats selected
                      </span>
                    </div>
                    <ScrollArea className="max-h-[60vh]">
                      <div className="space-y-2">
                        {shotlistItems.map((item: any, idx: number) => {
                          const isSelected = selectedBeatIndices.has(item.index);
                          return (
                            <div key={idx} className={`flex items-center gap-3 p-2 rounded border transition-colors ${
                              isSelected ? 'border-primary bg-primary/5' : 'border-border opacity-60'
                            }`}>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selectedBeatIndices);
                                  if (checked) next.add(item.index); else next.delete(item.index);
                                  setSelectedBeatIndices(next);
                                  if (activeShotlist) {
                                    const updatedItems = shotlistItems.map((it: any) =>
                                      it.index === item.index ? { ...it, included: !!checked } : it
                                    );
                                    ai.updateShotlistItems.mutate({ shotlistId: activeShotlist.id, items: updatedItems });
                                  }
                                }}
                              />
                              <span className="text-xs font-mono text-muted-foreground w-6">{item.index}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium">{item.shot_title}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{item.shot_description}</p>
                              </div>
                              <Badge variant="outline" className={`text-[8px] ${
                                item.ai_suggested_tier === 'A' ? 'bg-emerald-500/10 text-emerald-400' :
                                item.ai_suggested_tier === 'B' ? 'bg-blue-500/10 text-blue-400' :
                                'bg-amber-500/10 text-amber-400'
                              }`}>{item.ai_suggested_tier}</Badge>
                              <span className="text-[10px] text-muted-foreground">{item.intended_duration}s</span>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Generate */}
          {step === 'generate' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm">Generate Trailer Assets</CardTitle>
                <div className="flex items-center gap-1">
                  {genRunning && (
                    <>
                      <Button size="sm" variant="outline" className="text-xs gap-1" onClick={togglePause}>
                        {genPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        {genPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs gap-1 text-destructive" onClick={stopGeneration}>
                        <X className="h-3 w-3" />Stop
                      </Button>
                    </>
                  )}
                  {!genRunning && (
                    <Button size="sm" className="text-xs gap-1"
                      onClick={startGeneration}
                      disabled={ai.saveSelectedIndices.isPending || !activeShotlist || selectedBeatIndices.size === 0}>
                      <Play className="h-3 w-3" />
                      Generate Selected Assets ({selectedBeatIndices.size})
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Live progress during generation */}
                {genRunning && (
                  <div className="space-y-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {genPaused ? '⏸ Paused' : `Processing beat ${genResults.length + 1} of ${genTotalBeats}`}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {genResults.length}/{genTotalBeats}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${genTotalBeats > 0 ? (genResults.length / genTotalBeats) * 100 : 0}%` }}
                      />
                    </div>
                    {genCurrentBeat && !genPaused && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{genCurrentBeat} — Generating frame{genResults.length > 0 && genResults[genResults.length - 1]?.motionStillsGenerated > 0 ? ' + motion still' : ''}…</span>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{genFrames}</p>
                        <p className="text-[9px] text-muted-foreground">Frames</p>
                      </div>
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{genMotionStills}</p>
                        <p className="text-[9px] text-muted-foreground">Motion Stills</p>
                      </div>
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{genResults.length}</p>
                        <p className="text-[9px] text-muted-foreground">Completed</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Live results feed — shows as each beat completes */}
                {genResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {genRunning ? 'Assets generating…' : `Generation complete — ${genFrames} frames, ${genMotionStills} motion stills`}
                    </p>
                    <ScrollArea className="h-[30vh]">
                      <div className="space-y-1.5">
                        {genResults.map((r: any) => (
                          <div key={r.index} className="flex items-center gap-2 p-1.5 rounded border border-border">
                            <span className="font-mono text-[10px] text-muted-foreground w-6">#{r.index}</span>
                            {r.status === 'ok' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                            )}
                            {r.frame_url && (
                              <img src={r.frame_url} alt={`Beat ${r.index}`} className="h-10 w-16 object-cover rounded" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] truncate">Beat {r.index}</p>
                              <p className="text-[9px] text-muted-foreground">
                                {r.framesGenerated || 0} frame{r.motionStillsGenerated ? ` + ${r.motionStillsGenerated} motion still` : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* Previously generated assets from DB (persisted) */}
                {!genRunning && genResults.length === 0 && shotlistMedia.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Previously Generated Assets ({shotlistMedia.length})
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center mb-3">
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{shotlistMedia.filter(m => m.media_type === 'storyboard_frame').length}</p>
                        <p className="text-[9px] text-muted-foreground">Frames</p>
                      </div>
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{shotlistMedia.filter(m => m.media_type === 'motion_still').length}</p>
                        <p className="text-[9px] text-muted-foreground">Motion Stills</p>
                      </div>
                      <div className="p-2 rounded border border-border">
                        <p className="text-lg font-bold text-primary">{shotlistMedia.length}</p>
                        <p className="text-[9px] text-muted-foreground">Total</p>
                      </div>
                    </div>
                    <ScrollArea className="h-[30vh]">
                      <div className="grid grid-cols-4 gap-2">
                        {shotlistMedia.filter(m => m.media_type === 'storyboard_frame').map(m => (
                          <div key={m.id} className="space-y-1">
                            {m.public_url || m.storage_path ? (
                              <img
                                src={m.public_url || `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/ai-media/${m.storage_path}`}
                                alt={`Beat ${(m.generation_params as any)?.beat_index || '?'}`}
                                className="w-full aspect-video object-cover rounded border border-border"
                              />
                            ) : (
                              <div className="w-full aspect-video bg-muted rounded border border-border flex items-center justify-center">
                                <Image className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <p className="text-[8px] text-muted-foreground text-center">
                              Beat {(m.generation_params as any)?.beat_index || '?'} • {m.media_type === 'storyboard_frame' ? 'Frame' : 'Motion'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* Empty state */}
                {!genRunning && genResults.length === 0 && shotlistMedia.length === 0 && (
                  <div className="text-center py-8">
                    <Image className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground mb-2">
                      Generate AI storyboard frames and motion stills for each selected beat.
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      1 frame per beat • Up to 8 motion stills for top beats • All assets saved to your project
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Assemble */}
          {step === 'assemble' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Assemble Taster Trailer</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={async () => {
                    if (!activeShotlist) return;
                    await ai.saveSelectedIndices.mutateAsync({
                      shotlistId: activeShotlist.id,
                      selectedIndices: Array.from(selectedBeatIndices),
                    });
                    ai.assembleTrailer.mutate(activeShotlist.id);
                  }}
                  disabled={ai.assembleTrailer.isPending || !activeShotlist}>
                  {ai.assembleTrailer.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                  Assemble
                </Button>
              </CardHeader>
              <CardContent>
                {ai.assembleTrailer.isPending && (
                  <div className="mb-4">
                    <StagedProgressBar
                      title="Assembling Taster Trailer"
                      stages={ASSEMBLE_STAGES}
                      currentStageIndex={1}
                      progressPercent={30}
                      etaSeconds={20}
                      detailMessage="Building timeline from shotlist and generated assets…"
                    />
                  </div>
                )}
                {ai.assembleTrailer.isSuccess && ai.assembleTrailer.data ? (
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{ai.assembleTrailer.data.timeline?.frame_count || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Frames</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{ai.assembleTrailer.data.timeline?.motion_still_count || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Motion Stills</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{Math.round(ai.assembleTrailer.data.timeline?.total_duration || 0)}s</p>
                        <p className="text-[10px] text-muted-foreground">Duration</p>
                      </div>
                    </div>

                    {ai.assembleTrailer.data.missing_frames?.length > 0 && (
                      <p className="text-[10px] text-amber-400">
                        {ai.assembleTrailer.data.missing_frames.length} beats missing frames. Go back to Generate to fill gaps.
                      </p>
                    )}

                    {ai.assembleTrailer.data.timeline_url && (
                      <a href={ai.assembleTrailer.data.timeline_url} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="text-xs gap-1 w-full">
                          <Download className="h-3 w-3" />Download Timeline JSON
                        </Button>
                      </a>
                    )}

                    {ai.assembleTrailer.data.timeline?.timeline && (
                      <ScrollArea className="max-h-[40vh]">
                        <div className="space-y-1">
                          {ai.assembleTrailer.data.timeline.timeline.map((t: any) => (
                            <div key={t.index} className="flex items-center gap-2 p-1.5 rounded border border-border">
                              <span className="font-mono text-[10px] text-muted-foreground w-5">#{t.index}</span>
                              {t.frame_url && (
                                <img src={t.frame_url} alt={t.shot_title} className="h-8 w-14 object-cover rounded" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-medium truncate">{t.shot_title}</p>
                                <p className="text-[9px] text-muted-foreground">{t.intended_duration}s</p>
                              </div>
                              {t.has_motion_still && <Image className="h-3 w-3 text-primary" />}
                              {t.text_card && <Badge variant="outline" className="text-[7px]">{t.text_card}</Badge>}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}

                    <p className="text-xs text-muted-foreground text-center">{ai.assembleTrailer.data.message}</p>
                  </div>
                ) : !ai.assembleTrailer.isPending && (
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground">
                      Click "Assemble" to create a trailer timeline from your shotlist and generated assets.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <Button variant="outline" size="sm" className="text-xs gap-1"
              onClick={() => setStep(steps[Math.max(0, stepIndex - 1)].key)}
              disabled={stepIndex === 0}>
              <ArrowLeft className="h-3 w-3" />Previous
            </Button>
            <Button size="sm" className="text-xs gap-1"
              onClick={() => {
                // Auto-save pack on first "Next" from source
                if (step === 'source' && packSelection.length > 0 && !activePackId) {
                  savePack().then(() => setStep(steps[Math.min(steps.length - 1, stepIndex + 1)].key));
                  return;
                }
                setStep(steps[Math.min(steps.length - 1, stepIndex + 1)].key);
              }}
              disabled={stepIndex >= steps.length - 1 || !canNext}>
              Next<ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

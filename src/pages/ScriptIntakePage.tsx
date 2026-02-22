/**
 * ScriptIntakePage — Upload a screenplay PDF, generate coverage, and backfill development docs.
 */
import { useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowLeft, Upload, FileText, Loader2, Sparkles, Save, Download,
  CheckCircle2, AlertTriangle, ChevronDown, BarChart3,
  BookOpen, Target, Lightbulb, Users, Map, Clapperboard,
} from 'lucide-react';
import { useScriptIntake, type CoverageResult, type BackfillDoc } from '@/hooks/useScriptIntake';
import { exportCoveragePDF } from '@/lib/coverage-pdf-export';
import { toast } from 'sonner';

const BACKFILL_DOC_TYPES = [
  { key: 'idea', label: 'Project Idea', icon: Lightbulb },
  { key: 'concept_brief', label: 'Concept Brief', icon: Target },
  { key: 'market_sheet', label: 'Market Sheet', icon: BarChart3 },
  { key: 'blueprint', label: 'Blueprint / Bible', icon: Map },
  { key: 'architecture', label: 'Story Architecture', icon: BookOpen },
  { key: 'character_bible', label: 'Character Bible', icon: Users },
  { key: 'beat_sheet', label: 'Beat Sheet', icon: Clapperboard },
] as const;

export default function ScriptIntakePage() {
  const { id: projectId } = useParams<{ id: string }>();

  const { data: project } = useQuery({
    queryKey: ['intake-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const {
    intake, coverage, backfillDocs,
    upload, generateCoverage, saveCoverage,
    generateBackfill, approveBackfillDoc,
  } = useScriptIntake(projectId);

  const [activeTab, setActiveTab] = useState('coverage');
  const [selectedBackfillTypes, setSelectedBackfillTypes] = useState<string[]>([
    'idea', 'concept_brief', 'market_sheet', 'character_bible', 'beat_sheet',
  ]);

  // File dropzone
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are supported');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large (max 20MB)');
      return;
    }
    upload.mutate(file);
  }, [upload]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const toggleBackfillType = (key: string) => {
    setSelectedBackfillTypes(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Script Intake
              </h1>
              {project?.title && (
                <p className="text-xs text-muted-foreground">{project.title}</p>
              )}
            </div>
          </div>

          {/* Upload card */}
          {!intake && (
            <Card className="mb-6">
              <CardContent className="py-8">
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                    dragOver ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  {upload.isPending ? (
                    <div className="space-y-3">
                      <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                      <p className="text-sm text-muted-foreground">Uploading and parsing script…</p>
                      <p className="text-xs text-muted-foreground">This may take a minute for longer scripts.</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm font-medium mb-1">Drop a screenplay PDF here</p>
                      <p className="text-xs text-muted-foreground">or click to browse · PDF only · max 20MB</p>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={onFileSelect}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Parsed metadata */}
          {intake && (
            <Card className="mb-6">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{intake.titleGuess}</p>
                    <p className="text-xs text-muted-foreground">
                      {intake.pageCount} pages · {intake.scenes.length} scenes detected
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] gap-1 text-[hsl(var(--chart-2))]">
                    <CheckCircle2 className="h-2.5 w-2.5" />Parsed
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs: Coverage / Backfill */}
          {intake && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="coverage" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" />Coverage
                </TabsTrigger>
                <TabsTrigger value="backfill" className="text-xs gap-1">
                  <BookOpen className="h-3 w-3" />Backfill Docs
                </TabsTrigger>
              </TabsList>

              <TabsContent value="coverage">
                <CoverageTab
                  coverage={coverage}
                  generating={generateCoverage.isPending}
                  saving={saveCoverage.isPending}
                  onGenerate={() => generateCoverage.mutate()}
                  onSave={() => saveCoverage.mutate()}
                  scriptTitle={intake?.titleGuess || project?.title || 'Script'}
                />
              </TabsContent>

              <TabsContent value="backfill">
                <BackfillTab
                  backfillDocs={backfillDocs}
                  selectedTypes={selectedBackfillTypes}
                  onToggleType={toggleBackfillType}
                  generating={generateBackfill.isPending}
                  onGenerate={() => generateBackfill.mutate(selectedBackfillTypes)}
                  onApprove={(doc) => approveBackfillDoc.mutate({ doc, approve: true })}
                  onSaveDraft={(doc) => approveBackfillDoc.mutate({ doc, approve: false })}
                  approving={approveBackfillDoc.isPending}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

/* ── Coverage Tab ── */
function CoverageTab({
  coverage, generating, saving, onGenerate, onSave, scriptTitle,
}: {
  coverage: CoverageResult | null;
  generating: boolean;
  saving: boolean;
  onGenerate: () => void;
  onSave: () => void;
  scriptTitle: string;
}) {
  if (!coverage) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Generate professional coverage with evidence-backed analysis.
          </p>
          <Button onClick={onGenerate} disabled={generating} className="gap-1 text-xs">
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {generating ? 'Generating Coverage…' : 'Generate Coverage'}
          </Button>
          {generating && (
            <p className="text-[10px] text-muted-foreground mt-2">This may take 1–2 minutes for full coverage.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => exportCoveragePDF(coverage, scriptTitle)}>
          <Download className="h-3 w-3" />
          Export PDF
        </Button>
        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Coverage to Project
        </Button>
      </div>

      {/* Scorecard */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Scorecard
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-4 gap-3 mb-3">
            {(['premise', 'structure', 'characters', 'dialogue', 'originality', 'commercial_viability', 'overall'] as const).map(key => (
              <div key={key} className="text-center">
                <p className="text-[10px] text-muted-foreground capitalize">{key.replace('_', ' ')}</p>
                <p className={`text-lg font-bold ${key === 'overall' ? 'text-primary' : ''}`}>
                  {coverage.scorecard[key]}
                </p>
              </div>
            ))}
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Verdict</p>
              <Badge variant="outline" className={`text-xs mt-1 ${
                coverage.scorecard.recommendation === 'RECOMMEND' ? 'border-[hsl(var(--chart-2)/0.3)] text-[hsl(var(--chart-2))]'
                : coverage.scorecard.recommendation === 'CONSIDER' ? 'border-[hsl(var(--chart-4)/0.3)] text-[hsl(var(--chart-4))]'
                : 'border-destructive/30 text-destructive'
              }`}>
                {coverage.scorecard.recommendation}
              </Badge>
            </div>
          </div>
          {coverage.confidence_summary && (
            <p className="text-[10px] text-muted-foreground">
              Confidence: {coverage.confidence_summary.overall}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Loglines */}
      <CoverageSection title="Loglines" icon={<Lightbulb className="h-3.5 w-3.5 text-primary" />}>
        <ol className="space-y-2">
          {coverage.loglines.map((l, i) => (
            <li key={i} className="text-xs">
              <span className="text-muted-foreground font-medium mr-1">{i + 1}.</span>
              {l}
            </li>
          ))}
        </ol>
      </CoverageSection>

      {/* Synopsis */}
      <CoverageSection title="One-Page Synopsis" icon={<FileText className="h-3.5 w-3.5 text-primary" />}>
        <p className="text-xs whitespace-pre-wrap">{coverage.one_page_synopsis}</p>
      </CoverageSection>

      <CoverageSection title="Full Synopsis" icon={<BookOpen className="h-3.5 w-3.5 text-primary" />} defaultOpen={false}>
        <p className="text-xs whitespace-pre-wrap">{coverage.full_synopsis}</p>
      </CoverageSection>

      {/* Comments */}
      <CoverageSection title="Comments" icon={<FileText className="h-3.5 w-3.5 text-primary" />}>
        <p className="text-xs whitespace-pre-wrap">{coverage.comments}</p>
      </CoverageSection>

      {/* Strengths / Weaknesses */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-[hsl(var(--chart-2))]" />Strengths
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ul className="space-y-1">
              {coverage.strengths.map((s, i) => (
                <li key={i} className="text-[11px] text-foreground flex items-start gap-1.5">
                  <span className="text-[hsl(var(--chart-2))] mt-0.5">•</span>{s}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-[hsl(var(--chart-4))]" />Weaknesses
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ul className="space-y-1">
              {coverage.weaknesses.map((w, i) => (
                <li key={i} className="text-[11px] text-foreground flex items-start gap-1.5">
                  <span className="text-[hsl(var(--chart-4))] mt-0.5">•</span>{w}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Market Positioning */}
      <CoverageSection title="Market Positioning" icon={<Target className="h-3.5 w-3.5 text-primary" />}>
        <div className="space-y-2 text-xs">
          <div><span className="font-medium text-muted-foreground">Comps:</span> {coverage.market_positioning.comps.join(', ')}</div>
          <div><span className="font-medium text-muted-foreground">Audience:</span> {coverage.market_positioning.audience}</div>
          <div><span className="font-medium text-muted-foreground">Platform Fit:</span> {coverage.market_positioning.platform_fit}</div>
          <div><span className="font-medium text-muted-foreground">Budget Band:</span> {coverage.market_positioning.budget_band}</div>
          <div><span className="font-medium text-muted-foreground">Risks:</span> {coverage.market_positioning.risks.join('; ')}</div>
        </div>
      </CoverageSection>

      {/* Craft & Structure */}
      <CoverageSection title="Craft & Structure" icon={<Clapperboard className="h-3.5 w-3.5 text-primary" />}>
        <div className="space-y-2 text-xs">
          <div><span className="font-medium text-muted-foreground">Act Breakdown:</span> {coverage.craft_structure.act_breakdown}</div>
          <div><span className="font-medium text-muted-foreground">Turning Points:</span> {coverage.craft_structure.turning_points.join('; ')}</div>
          <div><span className="font-medium text-muted-foreground">Pacing:</span> {coverage.craft_structure.pacing_notes}</div>
          <div>
            <span className="font-medium text-muted-foreground">Character Arcs:</span>
            <ul className="mt-1 ml-3 space-y-1">
              {coverage.craft_structure.character_arcs.map((ca, i) => (
                <li key={i}>
                  <strong>{ca.character}:</strong> {ca.arc}
                  {ca.page_refs?.length ? <span className="text-muted-foreground"> (pp. {ca.page_refs.join(', ')})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CoverageSection>

      {/* Scene Notes */}
      <CoverageSection title={`Scene Notes (${coverage.scene_notes.length})`} icon={<Map className="h-3.5 w-3.5 text-primary" />} defaultOpen={false}>
        <ScrollArea className="max-h-96">
          <div className="space-y-1.5">
            {coverage.scene_notes.map((sn, i) => (
              <div key={i} className="text-[11px] flex items-start gap-2 py-1 border-b border-border/20 last:border-0">
                <Badge variant="outline" className="text-[8px] shrink-0 mt-0.5">p.{sn.page}</Badge>
                <div className="min-w-0">
                  <span className="font-medium">{sn.scene_heading}</span>
                  <span className="text-muted-foreground"> — {sn.note}</span>
                  {sn.strength_or_issue && (
                    <Badge variant="outline" className={`ml-1 text-[7px] ${
                      sn.strength_or_issue?.toLowerCase().includes('strength')
                        ? 'text-[hsl(var(--chart-2))]'
                        : 'text-[hsl(var(--chart-4))]'
                    }`}>
                      {sn.strength_or_issue}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CoverageSection>

      {/* Evidence Map */}
      {coverage.evidence_map && Object.keys(coverage.evidence_map).length > 0 && (
        <CoverageSection title={`Evidence Map (${Object.keys(coverage.evidence_map).length})`} icon={<BookOpen className="h-3.5 w-3.5 text-primary" />} defaultOpen={false}>
          <ScrollArea className="max-h-64">
            <div className="space-y-1.5">
              {Object.entries(coverage.evidence_map).map(([key, ev]) => (
                <div key={key} className="text-[11px] py-1 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium">{key}</span>
                    <Badge variant="outline" className="text-[7px]">p.{ev.page}</Badge>
                    <Badge variant="outline" className={`text-[7px] ${
                      ev.confidence === 'high' ? 'text-[hsl(var(--chart-2))]'
                        : ev.confidence === 'med' ? 'text-[hsl(var(--chart-4))]'
                        : 'text-destructive'
                    }`}>{ev.confidence}</Badge>
                    {ev.assumption && <Badge variant="outline" className="text-[7px] text-destructive">assumption</Badge>}
                  </div>
                  <p className="text-muted-foreground italic">"{ev.quote}"</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CoverageSection>
      )}
    </div>
  );
}

/* ── Collapsible Section ── */
function CoverageSection({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5">
              {icon}{title}
            </CardTitle>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-3 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ── Backfill Tab ── */
function BackfillTab({
  backfillDocs, selectedTypes, onToggleType, generating, onGenerate, onApprove, onSaveDraft, approving,
}: {
  backfillDocs: BackfillDoc[];
  selectedTypes: string[];
  onToggleType: (key: string) => void;
  generating: boolean;
  onGenerate: () => void;
  onApprove: (doc: BackfillDoc) => void;
  onSaveDraft: (doc: BackfillDoc) => void;
  approving: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Selection card */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Select documents to generate</CardTitle>
          <CardDescription className="text-xs">
            These documents will be derived from the uploaded script. They are NOT canonical until you approve them.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {BACKFILL_DOC_TYPES.map(dt => (
              <label
                key={dt.key}
                className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer transition-colors text-xs ${
                  selectedTypes.includes(dt.key)
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border/50 hover:border-border'
                }`}
              >
                <Checkbox
                  checked={selectedTypes.includes(dt.key)}
                  onCheckedChange={() => onToggleType(dt.key)}
                />
                <dt.icon className="h-3 w-3 text-muted-foreground" />
                {dt.label}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            className="gap-1 text-xs"
            onClick={onGenerate}
            disabled={generating || selectedTypes.length === 0}
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {generating ? 'Generating…' : `Generate ${selectedTypes.length} Documents`}
          </Button>
          {generating && (
            <p className="text-[10px] text-muted-foreground mt-2">Generating each document from the script. This may take a few minutes.</p>
          )}
        </CardContent>
      </Card>

      {/* Generated doc previews */}
      {backfillDocs.length > 0 && (
        <div className="space-y-3">
          {backfillDocs.map((doc, i) => (
            <Card key={i} className={doc.error ? 'border-destructive/30' : ''}>
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{doc.title || doc.docType}</CardTitle>
                    <Badge variant="outline" className="text-[8px]">{doc.docType}</Badge>
                    {doc.confidence_summary && (
                      <Badge variant="outline" className={`text-[8px] ${
                        doc.confidence_summary.overall === 'high' ? 'text-[hsl(var(--chart-2))]'
                          : 'text-[hsl(var(--chart-4))]'
                      }`}>
                        {doc.confidence_summary.overall} confidence
                      </Badge>
                    )}
                  </div>
                  {!doc.error && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => onSaveDraft(doc)}
                        disabled={approving}
                      >
                        <Save className="h-2.5 w-2.5" />Draft
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => onApprove(doc)}
                        disabled={approving}
                      >
                        <CheckCircle2 className="h-2.5 w-2.5" />Approve
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Derived from uploaded script · {Object.keys(doc.evidence_map || {}).length} evidence refs
                </p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {doc.error ? (
                  <p className="text-xs text-destructive">{doc.error}</p>
                ) : (
                  <ScrollArea className="max-h-64 rounded-md border border-border/30 p-3">
                    <pre className="text-[11px] whitespace-pre-wrap font-sans">{doc.content_markdown}</pre>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

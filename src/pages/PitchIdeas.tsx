import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, Radar, RefreshCw, Loader2, Download, Filter, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PitchIdeaCard } from '@/components/PitchIdeaCard';
import { usePitchIdeas, type PitchIdea } from '@/hooks/usePitchIdeas';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import { GENRES, BUDGET_RANGES } from '@/lib/constants';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';

const PRODUCTION_TYPES = [
  { value: 'film', label: 'Film' },
  { value: 'tv-series', label: 'TV Series' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'short-film', label: 'Short Film' },
  { value: 'digital-series', label: 'Digital Series' },
  { value: 'commercial', label: 'Commercial / Advert' },
  { value: 'branded-content', label: 'Branded Content' },
  { value: 'vertical-drama', label: 'Vertical Drama' },
];

const RISK_LEVELS = [
  { value: 'low', label: 'Low Risk' },
  { value: 'medium', label: 'Medium Risk' },
  { value: 'high', label: 'High Risk' },
];

const REGIONS = ['Global', 'North America', 'Europe', 'UK', 'Asia-Pacific', 'Latin America', 'Middle East & Africa'];
const PLATFORMS = ['Any', 'Theatrical', 'Netflix', 'Amazon', 'Apple TV+', 'HBO/Max', 'Disney+', 'Broadcast', 'YouTube', 'TikTok/Mobile', 'FAST'];

export default function PitchIdeas() {
  const { user } = useAuth();
  const { ideas, isLoading, save, remove } = usePitchIdeas();
  const { projects } = useProjects();
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<'greenlight' | 'coverage-transform'>('greenlight');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>('');

  // Filters
  const [productionType, setProductionType] = useState('film');
  const [genre, setGenre] = useState('');
  const [budgetBand, setBudgetBand] = useState('');
  const [lane, setLane] = useState('');
  const [region, setRegion] = useState('');
  const [platformTarget, setPlatformTarget] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filteredIdeas = useMemo(() => {
    return ideas.filter(i => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (productionType && i.production_type !== productionType) return false;
      return true;
    });
  }, [ideas, statusFilter, productionType]);

  const generate = async () => {
    setGenerating(true);
    try {
      let coverageContext: string | undefined;
      if (mode === 'coverage-transform' && selectedProject) {
        const proj = projects.find(p => p.id === selectedProject);
        if (proj?.analysis_passes) {
          coverageContext = JSON.stringify(proj.analysis_passes);
        }
      }

      const { data, error } = await supabase.functions.invoke('generate-pitch', {
        body: {
          productionType,
          genre,
          budgetBand,
          region,
          platformTarget,
          riskLevel,
          count: 3,
          coverageContext,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const pitchIdeas = data.ideas || data;
      for (const idea of pitchIdeas) {
        await save({
          mode,
          production_type: productionType,
          title: idea.title,
          logline: idea.logline,
          one_page_pitch: idea.one_page_pitch,
          comps: idea.comps || [],
          recommended_lane: idea.recommended_lane || '',
          lane_confidence: idea.lane_confidence || 0,
          budget_band: idea.budget_band || budgetBand,
          packaging_suggestions: idea.packaging_suggestions || [],
          development_sprint: idea.development_sprint || [],
          risks_mitigations: idea.risks_mitigations || [],
          why_us: idea.why_us || '',
          genre: idea.genre || genre,
          region: region,
          platform_target: platformTarget,
          risk_level: idea.risk_level || riskLevel || 'medium',
          project_id: selectedProject || null,
          raw_response: idea,
        });
      }
      toast.success(`${pitchIdeas.length} ideas generated`);
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18);
    doc.text('IFFY — Pitch Ideas', 14, y);
    y += 12;

    for (const idea of filteredIdeas) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.text(idea.title, 14, y); y += 7;
      doc.setFontSize(10);
      const logLines = doc.splitTextToSize(idea.logline, 180);
      doc.text(logLines, 14, y); y += logLines.length * 5 + 3;
      doc.text(`Lane: ${idea.recommended_lane} (${idea.lane_confidence}%) | Budget: ${idea.budget_band} | Risk: ${idea.risk_level}`, 14, y);
      y += 7;
      const pitchLines = doc.splitTextToSize(idea.one_page_pitch, 180);
      doc.text(pitchLines, 14, y); y += pitchLines.length * 5 + 5;
      doc.text(`Comps: ${idea.comps.join(', ')}`, 14, y); y += 7;
      if (idea.why_us) {
        const whyLines = doc.splitTextToSize(`Why Us: ${idea.why_us}`, 180);
        doc.text(whyLines, 14, y); y += whyLines.length * 5 + 5;
      }
      y += 8;
    }

    doc.save('iffy-pitch-ideas.pdf');
    toast.success('PDF exported');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <motion.main
        className="container py-8 space-y-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
              <Lightbulb className="h-7 w-7 text-primary" />
              Pitch Ideas
            </h1>
            <p className="text-muted-foreground mt-1">AI-powered development concepts ranked by market viability</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="h-4 w-4 mr-1" />
              Filters
            </Button>
            {filteredIdeas.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportPDF}>
                <Download className="h-4 w-4 mr-1" />
                Export PDF
              </Button>
            )}
          </div>
        </div>

        {/* Mode tabs */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList>
            <TabsTrigger value="greenlight" className="gap-1.5">
              <Radar className="h-4 w-4" />
              Greenlight Radar
            </TabsTrigger>
            <TabsTrigger value="coverage-transform" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Coverage Transformer
            </TabsTrigger>
          </TabsList>

          <TabsContent value="greenlight" className="mt-4">
            <Card className="border-border/50">
              <CardContent className="pt-5 space-y-4">
                <p className="text-sm text-muted-foreground">Generate fresh development concepts based on current market trends, genre cycles, and your filters.</p>
                {showFilters && <FiltersPanel {...{ productionType, setProductionType, genre, setGenre, budgetBand, setBudgetBand, lane, setLane, region, setRegion, platformTarget, setPlatformTarget, riskLevel, setRiskLevel }} />}
                <Button onClick={generate} disabled={generating} className="gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                  {generating ? 'Generating…' : 'Generate Ideas'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coverage-transform" className="mt-4">
            <Card className="border-border/50">
              <CardContent className="pt-5 space-y-4">
                <p className="text-sm text-muted-foreground">Transform an existing project's coverage into pivot pitches — new angles on existing IP.</p>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Select a project with coverage" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.filter(p => p.analysis_passes).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showFilters && <FiltersPanel {...{ productionType, setProductionType, genre, setGenre, budgetBand, setBudgetBand, lane, setLane, region, setRegion, platformTarget, setPlatformTarget, riskLevel, setRiskLevel }} />}
                <Button onClick={generate} disabled={generating || !selectedProject} className="gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {generating ? 'Generating…' : 'Generate Pivots'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {['', 'draft', 'shortlisted', 'in-development', 'archived'].map(s => (
            <Badge
              key={s || 'all'}
              variant={statusFilter === s ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(s)}
            >
              {s || 'All'} {s ? `(${ideas.filter(i => i.status === s && (!productionType || i.production_type === productionType)).length})` : `(${ideas.filter(i => !productionType || i.production_type === productionType).length})`}
            </Badge>
          ))}
        </div>

        {/* Ideas list */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filteredIdeas.length === 0 ? (
          <Card className="border-border/30">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No pitch ideas yet. Generate some above!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredIdeas.map((idea, i) => (
              <PitchIdeaCard
                key={idea.id}
                idea={idea}
                rank={i + 1}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </motion.main>
    </div>
  );
}

// Filters sub-component
function FiltersPanel({ productionType, setProductionType, genre, setGenre, budgetBand, setBudgetBand, lane, setLane, region, setRegion, platformTarget, setPlatformTarget, riskLevel, setRiskLevel }: any) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4 rounded-lg border border-border/30 bg-muted/30">
      <Select value={productionType} onValueChange={setProductionType}>
        <SelectTrigger><SelectValue placeholder="Production Type" /></SelectTrigger>
        <SelectContent>{PRODUCTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={genre} onValueChange={setGenre}>
        <SelectTrigger><SelectValue placeholder="Genre" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any Genre</SelectItem>
          {GENRES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={budgetBand} onValueChange={setBudgetBand}>
        <SelectTrigger><SelectValue placeholder="Budget" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any Budget</SelectItem>
          {BUDGET_RANGES.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={lane} onValueChange={setLane}>
        <SelectTrigger><SelectValue placeholder="Lane" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any Lane</SelectItem>
          {Object.entries(LANE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={region} onValueChange={setRegion}>
        <SelectTrigger><SelectValue placeholder="Region" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Global</SelectItem>
          {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={platformTarget} onValueChange={setPlatformTarget}>
        <SelectTrigger><SelectValue placeholder="Platform" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any</SelectItem>
          {PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={riskLevel} onValueChange={setRiskLevel}>
        <SelectTrigger><SelectValue placeholder="Risk Level" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any</SelectItem>
          {RISK_LEVELS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

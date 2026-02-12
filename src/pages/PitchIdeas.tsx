import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, Radar, RefreshCw, Loader2, Download, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PitchIdeaCard } from '@/components/PitchIdeaCard';
import { DevelopmentBriefBuilder } from '@/components/DevelopmentBriefBuilder';
import { usePitchIdeas, type PitchIdea } from '@/hooks/usePitchIdeas';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import type { DevelopmentBrief } from '@/hooks/useDevelopmentBriefs';

export default function PitchIdeas() {
  const { user } = useAuth();
  const { ideas, isLoading, save, update, remove } = usePitchIdeas();
  const { projects } = useProjects();
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<'greenlight' | 'coverage-transform'>('greenlight');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const filteredIdeas = useMemo(() => {
    return ideas
      .filter(i => {
        if (statusFilter && i.status !== statusFilter) return false;
        if (typeFilter && i.production_type !== typeFilter) return false;
        return true;
      })
      .sort((a, b) => (Number(b.score_total) || 0) - (Number(a.score_total) || 0));
  }, [ideas, statusFilter, typeFilter]);

  const generate = async (brief: DevelopmentBrief) => {
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
          productionType: brief.production_type,
          genre: brief.genre,
          subgenre: brief.subgenre,
          budgetBand: brief.budget_band,
          region: brief.region,
          platformTarget: brief.platform_target,
          audienceDemo: brief.audience_demo,
          riskLevel: brief.risk_appetite,
          briefNotes: brief.notes,
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
          production_type: brief.production_type,
          brief_id: brief.id,
          title: idea.title,
          logline: idea.logline,
          one_page_pitch: idea.one_page_pitch,
          comps: idea.comps || [],
          recommended_lane: idea.recommended_lane || '',
          lane_confidence: idea.lane_confidence || 0,
          budget_band: idea.budget_band || brief.budget_band,
          packaging_suggestions: idea.packaging_suggestions || [],
          development_sprint: idea.development_sprint || [],
          risks_mitigations: idea.risks_mitigations || [],
          why_us: idea.why_us || '',
          genre: idea.genre || brief.genre,
          region: brief.region,
          platform_target: brief.platform_target,
          risk_level: idea.risk_level || brief.risk_appetite || 'medium',
          project_id: selectedProject || null,
          raw_response: idea,
          score_market_heat: idea.score_market_heat || 0,
          score_feasibility: idea.score_feasibility || 0,
          score_lane_fit: idea.score_lane_fit || 0,
          score_saturation_risk: idea.score_saturation_risk || 0,
          score_company_fit: idea.score_company_fit || 0,
          score_total: idea.score_total || 0,
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
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.text(idea.title, 14, y); y += 7;
      doc.setFontSize(10);
      const logLines = doc.splitTextToSize(idea.logline, 180);
      doc.text(logLines, 14, y); y += logLines.length * 5 + 3;
      doc.text(`Score: ${Number(idea.score_total).toFixed(0)} | Lane: ${idea.recommended_lane} (${idea.lane_confidence}%) | Budget: ${idea.budget_band} | Risk: ${idea.risk_level}`, 14, y);
      y += 5;
      doc.text(`  Market: ${idea.score_market_heat} | Feasibility: ${idea.score_feasibility} | Lane Fit: ${idea.score_lane_fit} | Saturation: ${idea.score_saturation_risk} | Company: ${idea.score_company_fit}`, 14, y);
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
            <p className="text-muted-foreground mt-1">AI-powered development concepts ranked by weighted viability scoring</p>
          </div>
          {filteredIdeas.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportPDF}>
              <Download className="h-4 w-4 mr-1" />
              Export PDF
            </Button>
          )}
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Shared brief builder across both modes */}
        <DevelopmentBriefBuilder
          onGenerate={generate}
          generating={generating || (mode === 'coverage-transform' && !selectedProject)}
        />

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {['', 'draft', 'shortlisted', 'in-development', 'archived'].map(s => (
            <Badge
              key={s || 'all'}
              variant={statusFilter === s ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(s)}
            >
              {s || 'All'} ({ideas.filter(i => s ? i.status === s : true).length})
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
              <p>No pitch ideas yet. Complete a brief above to generate ideas.</p>
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
                onUpdate={update}
              />
            ))}
          </div>
        )}
      </motion.main>
    </div>
  );
}

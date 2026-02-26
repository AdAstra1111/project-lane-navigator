import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, Loader2, Download, RefreshCw, Globe } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { HardCriteriaForm, EMPTY_CRITERIA, type HardCriteria } from '@/components/pitch/HardCriteriaForm';
import { SlateCard } from '@/components/pitch/SlateCard';
import { PromoteToDevSeedDialog } from '@/components/pitch/PromoteToDevSeedDialog';
import { ApplyDevSeedDialog } from '@/components/pitch/ApplyDevSeedDialog';
import { OperationProgress, GENERATE_PITCH_STAGES } from '@/components/OperationProgress';
import { usePitchIdeas, type PitchIdea } from '@/hooks/usePitchIdeas';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import jsPDF from 'jspdf';

export default function PitchIdeas() {
  const { user } = useAuth();
  const { ideas, isLoading, save, update, remove } = usePitchIdeas();
  const { projects } = useProjects();
  const [generating, setGenerating] = useState(false);
  const [criteria, setCriteria] = useState<HardCriteria>({ ...EMPTY_CRITERIA });
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [promoteIdea, setPromoteIdea] = useState<PitchIdea | null>(null);
  const [applyIdea, setApplyIdea] = useState<PitchIdea | null>(null);

  const filteredIdeas = useMemo(() => {
    return ideas
      .filter(i => {
        if (statusFilter && i.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => (Number(b.score_total) || 0) - (Number(a.score_total) || 0));
  }, [ideas, statusFilter]);

  const clean = (v: string) => (!v || v === '__any__' || v === '__none__') ? '' : v;

  const generate = useCallback(async () => {
    if (!criteria.productionType) {
      toast.error('Select a format/type first');
      return;
    }
    setGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke('generate-pitch', {
        body: {
          productionType: criteria.productionType,
          genre: clean(criteria.genre),
          subgenre: clean(criteria.subgenre),
          budgetBand: clean(criteria.budgetBand),
          region: clean(criteria.region),
          platformTarget: clean(criteria.platformTarget),
          riskLevel: criteria.riskLevel || 'medium',
          count: 10,
          projectId: (!selectedProject || selectedProject === '__none__') ? undefined : selectedProject,
          hardCriteria: {
            culturalTag: clean(criteria.culturalTag),
            toneAnchor: clean(criteria.toneAnchor),
            lane: clean(criteria.lane),
            rating: clean(criteria.rating),
            audience: clean(criteria.audience),
            languageTerritory: clean(criteria.languageTerritory),
            epLength: criteria.epLength || undefined,
            epCount: criteria.epCount || undefined,
            runtimeMin: criteria.runtimeMin || undefined,
            runtimeMax: criteria.runtimeMax || undefined,
            settingType: clean(criteria.settingType),
            locationVibe: clean(criteria.locationVibe),
            arenaProfession: clean(criteria.arenaProfession),
            romanceTropes: criteria.romanceTropes,
            heatLevel: clean(criteria.heatLevel),
            obstacleType: clean(criteria.obstacleType),
            mustHaveTropes: criteria.mustHaveTropes,
            avoidTropes: criteria.avoidTropes,
            prohibitedComps: criteria.prohibitedComps,
            locationsMax: criteria.locationsMax || undefined,
            castSizeMax: criteria.castSizeMax || undefined,
            starRole: clean(criteria.starRole),
            noveltyLevel: criteria.noveltyLevel || 'balanced',
            differentiateBy: clean(criteria.differentiateBy),
          },
          briefNotes: criteria.notes || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const pitchIdeas = data.ideas || data;
      for (const idea of pitchIdeas) {
        await save({
          mode: 'greenlight',
          production_type: criteria.productionType,
          title: idea.title,
          logline: idea.logline,
          one_page_pitch: idea.one_page_pitch,
          comps: idea.comps || [],
          recommended_lane: idea.recommended_lane || '',
          lane_confidence: idea.lane_confidence || 0,
          budget_band: idea.budget_band || criteria.budgetBand || '',
          packaging_suggestions: idea.packaging_suggestions || [],
          development_sprint: idea.development_sprint || [],
          risks_mitigations: idea.risks_mitigations || [],
          why_us: idea.why_us || '',
          genre: idea.genre || criteria.genre || '',
          region: criteria.region || '',
          platform_target: criteria.platformTarget || '',
          risk_level: idea.risk_level || criteria.riskLevel || 'medium',
          project_id: (!selectedProject || selectedProject === '__none__') ? null : selectedProject,
          raw_response: {
            ...idea,
            premise: idea.premise || '',
            trend_fit_bullets: idea.trend_fit_bullets || [],
            differentiation_move: idea.differentiation_move || '',
            tone_tag: idea.tone_tag || '',
            format_summary: idea.format_summary || '',
          },
          score_market_heat: idea.score_market_heat || 0,
          score_feasibility: idea.score_feasibility || 0,
          score_lane_fit: idea.score_lane_fit || 0,
          score_saturation_risk: idea.score_saturation_risk || 0,
          score_company_fit: idea.score_company_fit || 0,
          score_total: idea.score_total || 0,
        });
      }
      toast.success(`${pitchIdeas.length} concepts generated`);
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [criteria, selectedProject, save]);

  const handleShortlist = useCallback(async (id: string, shortlisted: boolean) => {
    await update({ id, status: shortlisted ? 'shortlisted' : 'draft' });
    toast.success(shortlisted ? 'Added to shortlist' : 'Removed from shortlist');
  }, [update]);

  const handlePromoted = useCallback((idea: PitchIdea) => {
    setPromoteIdea(null);
    setApplyIdea(idea);
  }, []);

  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18);
    doc.text('IFFY — Pitch Slate', 14, y);
    y += 12;
    for (const idea of filteredIdeas) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.text(idea.title, 14, y); y += 7;
      doc.setFontSize(10);
      const logLines = doc.splitTextToSize(idea.logline, 180);
      doc.text(logLines, 14, y); y += logLines.length * 5 + 3;
      doc.text(`Score: ${Number(idea.score_total).toFixed(0)} | Lane: ${idea.recommended_lane} | Budget: ${idea.budget_band}`, 14, y);
      y += 10;
    }
    doc.save('iffy-pitch-slate.pdf');
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
        {/* Title */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
              <Lightbulb className="h-7 w-7 text-primary" />
              Pitch Slate
            </h1>
            <p className="text-muted-foreground mt-1">Generate batches of 10 concepts with hard criteria, then promote the best to DevSeed</p>
          </div>
          <div className="flex items-center gap-2">
            {filteredIdeas.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportPDF}>
                <Download className="h-4 w-4 mr-1" />
                Export PDF
              </Button>
            )}
          </div>
        </div>

        {/* Optional project context */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Project context:</span>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="None (Global Ideas)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> None (Global Ideas)</span>
              </SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!selectedProject || selectedProject === '__none__' ? (
            <Badge variant="outline" className="text-xs">Global Mode</Badge>
          ) : (
            <Badge variant="default" className="text-xs">Project-tuned</Badge>
          )}
        </div>

        {/* Hard Criteria Form */}
        <HardCriteriaForm
          criteria={criteria}
          onChange={setCriteria}
          onGenerate={generate}
          generating={generating}
          hasProject={!!selectedProject && selectedProject !== '__none__'}
        />

        <OperationProgress isActive={generating} stages={GENERATE_PITCH_STAGES} />

        {/* Status filter + Generate More */}
        <div className="flex items-center justify-between flex-wrap gap-2">
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
          {filteredIdeas.length > 0 && !generating && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={generate}>
              <RefreshCw className="h-3.5 w-3.5" />
              Generate 10 More
            </Button>
          )}
        </div>

        {/* Slate grid */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filteredIdeas.length === 0 ? (
          <Card className="border-border/30">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No concepts yet. Set your hard criteria above and generate a slate.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredIdeas.map((idea, i) => (
              <SlateCard
                key={idea.id}
                idea={idea}
                rank={i + 1}
                onPromote={setPromoteIdea}
                onShortlist={handleShortlist}
                onDelete={remove}
              />
            ))}
          </div>
        )}

        {/* Promote dialog */}
        <PromoteToDevSeedDialog
          idea={promoteIdea}
          open={!!promoteIdea}
          onOpenChange={open => { if (!open) setPromoteIdea(null); }}
          onPromoted={handlePromoted}
        />

        {/* Apply DevSeed dialog */}
        <ApplyDevSeedDialog
          idea={applyIdea}
          open={!!applyIdea}
          onOpenChange={open => { if (!open) setApplyIdea(null); }}
        />
      </motion.main>
    </div>
  );
}

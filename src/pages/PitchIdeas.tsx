import { useState, useMemo, useCallback } from 'react';
import { initEditedFields, normalizePitchCriteria, type EditedFieldsMap } from '@/lib/pitch/normalizePitchCriteria';
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
  const [generateFailed, setGenerateFailed] = useState(false);
  const [criteria, setCriteria] = useState<HardCriteria>({ ...EMPTY_CRITERIA });
  const [editedFields, setEditedFields] = useState<EditedFieldsMap>(() => initEditedFields());
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [resolutionMeta, setResolutionMeta] = useState<Record<string, { status: string; scope: string; note?: string }>>({});
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

  

  const generate = useCallback(async () => {
    if (!criteria.productionType) {
      toast.error('Select a format/type first');
      return;
    }
    setGenerating(true);
    setGenerateFailed(false);

    try {
      // Normalize: only user-edited fields go as manual_criteria; rest are auto_fields
      const normalized = normalizePitchCriteria(criteria as unknown as Record<string, unknown>, editedFields);

      const { data, error } = await supabase.functions.invoke('generate-pitch', {
        body: {
          productionType: criteria.productionType,
          count: 10,
          projectId: (!selectedProject || selectedProject === '__none__') ? undefined : selectedProject,
          // New contract: manual_criteria + auto_fields
          manual_criteria: normalized.manual_criteria,
          auto_fields: normalized.auto_fields,
          meta: normalized.meta,
          // Legacy top-level fields for backward compat with current backend
          genre: normalized.manual_criteria.genre || '',
          subgenre: normalized.manual_criteria.subgenre || '',
          budgetBand: normalized.manual_criteria.budgetBand || '',
          region: normalized.manual_criteria.region || '',
          platformTarget: normalized.manual_criteria.platformTarget || '',
          riskLevel: (normalized.manual_criteria.riskLevel as string) || 'medium',
          hardCriteria: normalized.manual_criteria,
          briefNotes: (normalized.manual_criteria.notes as string) || undefined,
        },
      });

      console.log('[PitchIdeas] invoke result — error:', error, 'data keys:', data ? Object.keys(data) : 'null', 'ideas count:', data?.ideas?.length);

      if (error) {
        // Extract actual error message from edge function response body
        let errMsg = 'Generation failed';
        try {
          console.error('[PitchIdeas] FunctionsError details:', JSON.stringify(error, null, 2));
          if (error.context) {
            // Try to read the response body for the actual error message
            const response = error.context;
            if (response instanceof Response) {
              const body = await response.json().catch(() => null);
              console.error('[PitchIdeas] Error response body:', body);
              if (body?.error) errMsg = body.error;
            } else if (typeof response === 'object' && response.body) {
              const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
              if (body?.error) errMsg = body.error;
            }
          }
          if (errMsg === 'Generation failed' && error.message) {
            errMsg = error.message;
          }
        } catch { /* use default */ }
        throw new Error(errMsg);
      }
      if (data?.error) throw new Error(data.error);

      const pitchIdeas = data?.ideas;
      // Capture resolution meta for UI transparency
      if (data?.resolution_meta?.auto_field_status) {
        setResolutionMeta(data.resolution_meta.auto_field_status);
      }
      console.log('[PitchIdeas] Ideas to save:', pitchIdeas?.length, 'first title:', pitchIdeas?.[0]?.title);
      if (!Array.isArray(pitchIdeas) || pitchIdeas.length === 0) {
        throw new Error('No ideas returned. Please retry.');
      }

      let savedCount = 0;
      const saveErrors: string[] = [];

      for (const idea of pitchIdeas) {
        try {
          await save({
            mode: 'greenlight',
            status: 'draft',
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
              signals_metadata: data?.signals_metadata || null,
            },
            score_market_heat: idea.score_market_heat || 0,
            score_feasibility: idea.score_feasibility || 0,
            score_lane_fit: idea.score_lane_fit || 0,
            score_saturation_risk: idea.score_saturation_risk || 0,
            score_company_fit: idea.score_company_fit || 0,
            score_total: idea.score_total || 0,
          });
          savedCount++;
        } catch (saveErr: any) {
          console.error(`[PitchIdeas] Failed to save idea "${idea.title}":`, saveErr);
          saveErrors.push(idea.title || 'Untitled');
        }
      }

      if (savedCount === 0) {
        throw new Error('All ideas failed to save. Please retry.');
      } else if (saveErrors.length > 0) {
        toast.warning(`${savedCount} saved, ${saveErrors.length} failed: ${saveErrors.join(', ')}`);
      } else {
        toast.success(`${savedCount} concepts generated`);
      }
    } catch (e: any) {
      setGenerateFailed(true);
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
          editedFields={editedFields}
          onEditedFieldsChange={setEditedFields}
          resolutionMeta={resolutionMeta}
        />

        <OperationProgress isActive={generating} stages={GENERATE_PITCH_STAGES} />
        {generateFailed && !generating && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive text-center">
              Generation failed — check the error above and retry.
            </CardContent>
          </Card>
        )}

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

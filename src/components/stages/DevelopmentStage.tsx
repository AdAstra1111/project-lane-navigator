/**
 * Development Stage: Creative and commercial validation.
 * Now uses ScriptStudio for the 2-column read-only script page layout.
 * For documentary projects: switches to Documentary Intelligence Mode automatically.
 */

import { useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, TrendingUp, AlertTriangle, Quote, CheckCircle2, ShieldAlert, MessageSquareQuote, Zap, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { DevelopmentIntelligencePanel } from '@/components/intelligence/DevelopmentIntelligencePanel';
import { ScriptStudio } from '@/components/script/ScriptStudio';
import { ProjectInsightPanel } from '@/components/project/ProjectInsightPanel';
import { AnalysisPassesDisplay } from '@/components/AnalysisPassesDisplay';
import { ProjectRelevantSignals } from '@/components/project/ProjectRelevantSignals';
import { CompAnalysis } from '@/components/market/CompAnalysis';
import { GeographySelector } from '@/components/GeographySelector';
import { ProjectNoteInput } from '@/components/project/ProjectNoteInput';
import { AddDocumentsUpload } from '@/components/AddDocumentsUpload';
import { DocumentsList } from '@/components/DocumentsList';
import { DocumentaryIntelligencePanel } from '@/components/documentary/DocumentaryIntelligencePanel';
import { GenerateSeedPackModal } from '@/components/seedpack/GenerateSeedPackModal';

import { isDocumentaryFormat } from '@/lib/types';
import { useAutoRunMissionControl } from '@/hooks/useAutoRunMissionControl';
import type { Project, FullAnalysis, Recommendation } from '@/lib/types';
import type { ProjectDocument } from '@/lib/types';
import type { StageReadinessResult } from '@/lib/stage-readiness';
import { BUDGET_RANGES, TARGET_AUDIENCES, TONES } from '@/lib/constants';

interface Props {
  project: Project;
  projectId: string;
  analysis: FullAnalysis | null;
  hasNewAnalysis: boolean;
  insights: any;
  scripts: any[];
  currentScript: any;
  hasDocuments: boolean;
  hasScript: boolean;
  documents: ProjectDocument[];
  onUpload: (files: File[], scriptInfo?: any, docType?: string) => void;
  isUploading: boolean;
  scriptText: string | null;
  stageReadiness: StageReadinessResult | null;
}

function getLabel(value: string, list: readonly { value: string; label: string }[]) {
  return list.find(item => item.value === value)?.label || value;
}

export function DevelopmentStage({
  project, projectId, analysis, hasNewAnalysis, insights,
  scripts, currentScript, hasDocuments, hasScript, documents,
  onUpload, isUploading, scriptText, stageReadiness,
}: Props) {
  const legacyRecs = (project.recommendations || []) as Recommendation[];
  const isDoc = isDocumentaryFormat(project.format);
  const [seedPackOpen, setSeedPackOpen] = useState(false);
  const qc = useQueryClient();
  const autoRun = useAutoRunMissionControl(projectId);

  const handleSeedSuccess = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
    qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
  }, [qc, projectId]);

  const handleStartAutoRun = useCallback(async (mode: string, startDoc: string, targetDoc: string) => {
    await autoRun.start(mode, startDoc, targetDoc);
  }, [autoRun]);

  return (
    <div className="space-y-4">
      {/* Stage Readiness */}
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}

      {/* Documentary Intelligence Mode */}
      {isDoc && (
        <DocumentaryIntelligencePanel
          projectId={projectId}
          projectTitle={project.title}
          format={project.format}
          genres={project.genres || []}
          lane={project.assigned_lane}
        />
      )}

      {/* Development Intelligence */}
      <DevelopmentIntelligencePanel
        project={project}
        scripts={scripts}
        analysis={analysis}
        coverageVerdict={project.script_coverage_verdict}
      />

      {/* Dev Engine link — always visible */}
      <div className="flex items-center justify-between glass-card rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">
            {hasDocuments || hasScript ? 'Continue developing in the Dev Engine' : 'No documents yet — create and develop your idea'}
          </span>
        </div>
        <Button variant="default" size="sm" className="gap-1.5" asChild>
          <Link to={`/projects/${projectId}/development`}>
            <Zap className="h-3.5 w-3.5" />Dev Engine
          </Link>
        </Button>
      </div>

      {/* Seed Pack */}
      <div className="flex items-center justify-between glass-card rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <Sprout className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">
            Generate structured scaffold documents from your pitch
          </span>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSeedPackOpen(true)}>
          <Sprout className="h-3.5 w-3.5" />Generate Seed Pack
        </Button>
      </div>
      <GenerateSeedPackModal
        open={seedPackOpen}
        onOpenChange={setSeedPackOpen}
        projectId={projectId}
        defaultLane={project.assigned_lane}
        projectFormat={project.format}
        onSuccess={handleSeedSuccess}
        onStartAutoRun={handleStartAutoRun}
      />

      {/* Script Intake link */}
      <div className="flex items-center justify-between glass-card rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">
            Upload a screenplay PDF for full coverage + backfill documents
          </span>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <Link to={`/projects/${projectId}/script-intake`}>
            <FileText className="h-3.5 w-3.5" />Script Intake
          </Link>
        </Button>
      </div>

      {/* Script Studio — 2-column read-only layout */}
      {(hasDocuments || hasScript) && (
        <ScriptStudio
          projectId={projectId}
          projectTitle={project.title}
          format={project.format}
          genres={project.genres || []}
          hasDocuments={hasDocuments || hasScript}
          productionType={project.format}
          packagingMode={(project as any).packaging_mode || 'streamer_prestige'}
          packagingStage={(project as any).packaging_stage || 'early_dev'}
          scripts={scripts}
          currentScript={currentScript}
          documents={documents}
          scriptText={scriptText}
        />
      )}

      {/* IFFY Verdict */}
      {hasNewAnalysis && analysis?.verdict && (
        <div className="glass-card rounded-xl p-5 border-l-4 border-primary">
          <div className="flex items-start gap-3">
            <MessageSquareQuote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">IFFY Verdict</p>
              <p className="text-lg font-display font-semibold text-foreground">{analysis.verdict}</p>
            </div>
          </div>
        </div>
      )}

      {/* Project Details */}
      <div className="glass-card rounded-xl p-5">
        <h4 className="font-display font-semibold text-foreground text-base mb-3">Project Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground mb-0.5">Budget Range</p>
            <p className="text-foreground font-medium">{getLabel(project.budget_range, BUDGET_RANGES)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Target Audience</p>
            <p className="text-foreground font-medium">{getLabel(project.target_audience, TARGET_AUDIENCES)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Tone</p>
            <p className="text-foreground font-medium">{getLabel(project.tone, TONES)}</p>
          </div>
          {project.comparable_titles && (
            <div>
              <p className="text-muted-foreground mb-0.5">Comparables</p>
              <p className="text-foreground font-medium">{project.comparable_titles}</p>
            </div>
          )}
        </div>
      </div>

      <GeographySelector
        projectId={projectId}
        primaryTerritory={(project as any).primary_territory || ''}
        secondaryTerritories={(project as any).secondary_territories || []}
      />

      {/* Analysis & Intelligence */}
      {project && <ProjectRelevantSignals project={project} />}
      {insights && <ProjectInsightPanel insights={insights} />}
      {hasNewAnalysis && analysis && <AnalysisPassesDisplay passes={analysis} />}

      {hasNewAnalysis && analysis?.do_next && analysis?.avoid && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <h4 className="font-display font-semibold text-foreground">Do Next</h4>
            </div>
            <ol className="space-y-3">
              {analysis.do_next.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-emerald-400 font-bold shrink-0">{i + 1}.</span>
                  <span className="text-foreground leading-relaxed">{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="h-5 w-5 text-red-400" />
              <h4 className="font-display font-semibold text-foreground">Avoid</h4>
            </div>
            <ol className="space-y-3">
              {analysis.avoid.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-red-400 font-bold shrink-0">{i + 1}.</span>
                  <span className="text-foreground leading-relaxed">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {hasNewAnalysis && analysis?.lane_not_suitable && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Lane Not Suitable For</p>
              <p className="text-sm text-foreground leading-relaxed">{analysis.lane_not_suitable}</p>
            </div>
          </div>
        </div>
      )}

      {project.reasoning && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Quote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <h4 className="font-display font-semibold text-foreground mb-2">Why This Lane</h4>
              <p className="text-muted-foreground leading-relaxed">{project.reasoning}</p>
            </div>
          </div>
        </div>
      )}

      {/* Comp Analysis */}
      <CompAnalysis
        projectTitle={project.title}
        format={project.format}
        genres={project.genres || []}
        budgetRange={project.budget_range}
        tone={project.tone}
        comparableTitles={project.comparable_titles}
      />

      {/* Notes & Documents */}
      <ProjectNoteInput projectId={projectId} />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-display font-semibold text-foreground text-lg">
            {hasDocuments ? 'Uploaded Documents' : 'Documents'}
          </h4>
        </div>
        {hasDocuments && <DocumentsList documents={documents} projectId={projectId} />}
        <div className={hasDocuments ? 'mt-4' : ''}>
          <AddDocumentsUpload
            existingCount={documents.length}
            onUpload={onUpload}
            isUploading={isUploading}
          />
        </div>
      </div>
    </div>
  );
}

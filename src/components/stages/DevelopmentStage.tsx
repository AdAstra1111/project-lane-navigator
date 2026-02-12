/**
 * Development Stage: Creative and commercial validation.
 * Contains: Script coverage, analysis, project details, insights, comp analysis.
 */

import { useMemo } from 'react';
import { FileText, TrendingUp, AlertTriangle, Quote, CheckCircle2, ShieldAlert, MessageSquareQuote } from 'lucide-react';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { DevelopmentIntelligencePanel } from '@/components/DevelopmentIntelligencePanel';
import { DraftDeltaPanel } from '@/components/DraftDeltaPanel';
import { ScriptEnginePanel } from '@/components/ScriptEnginePanel';
import { ScriptCoverage } from '@/components/ScriptCoverage';
import { ProjectInsightPanel } from '@/components/ProjectInsightPanel';
import { AnalysisPassesDisplay } from '@/components/AnalysisPassesDisplay';
import { ProjectRelevantSignals } from '@/components/ProjectRelevantSignals';
import { CompAnalysis } from '@/components/CompAnalysis';
import { GeographySelector } from '@/components/GeographySelector';
import { ProjectNoteInput } from '@/components/ProjectNoteInput';
import { AddDocumentsUpload } from '@/components/AddDocumentsUpload';
import { DocumentsList } from '@/components/DocumentsList';
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
  onUpload: (files: File[], scriptInfo?: any) => void;
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

  return (
    <div className="space-y-4">
      {/* Stage Readiness */}
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}

      {/* Development Intelligence */}
      <DevelopmentIntelligencePanel
        project={project}
        scripts={scripts}
        analysis={analysis}
        coverageVerdict={project.script_coverage_verdict}
      />

      {/* Draft Delta */}
      <DraftDeltaPanel projectId={projectId} />

      {/* Script Engine */}
      <ScriptEnginePanel projectId={projectId} />

      {/* Script Status */}
      <div className={`flex items-center gap-3 glass-card rounded-lg px-4 py-2.5 text-sm ${
        currentScript ? 'border-l-4 border-emerald-500/50' : hasScript ? 'border-l-4 border-amber-500/50' : 'border-l-4 border-muted'
      }`}>
        <FileText className={`h-4 w-4 shrink-0 ${currentScript ? 'text-emerald-400' : 'text-muted-foreground'}`} />
        {currentScript ? (
          <span className="text-foreground">
            Current Script: <strong>{currentScript.version_label}</strong>
            <span className="text-muted-foreground ml-2 text-xs">
              {new Date(currentScript.created_at).toLocaleDateString()}
            </span>
          </span>
        ) : hasScript ? (
          <span className="text-muted-foreground">
            {scripts.length} archived script{scripts.length > 1 ? 's' : ''} — no current draft set
          </span>
        ) : (
          <span className="text-muted-foreground">No script attached — upload one to unlock deeper analysis</span>
        )}
      </div>

      {/* Script Coverage */}
      {(hasDocuments || hasScript) && (
        <ScriptCoverage
          projectId={projectId}
          projectTitle={project.title}
          format={project.format}
          genres={project.genres || []}
          hasDocuments={hasDocuments || hasScript}
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

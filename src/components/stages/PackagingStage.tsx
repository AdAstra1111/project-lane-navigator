/**
 * Packaging Stage: Attach elements that unlock financing.
 * Contains: Cast, crew, partners, cast impact, smart packaging.
 */

import { ProjectAttachmentTabs } from '@/components/ProjectAttachmentTabs';
import { CastImpactPanel } from '@/components/CastImpactPanel';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { StoryEnginePanel } from '@/components/tv/StoryEnginePanel';
import { SeasonArcPanel } from '@/components/tv/SeasonArcPanel';
import { SeriesBiblePanel } from '@/components/tv/SeriesBiblePanel';
import { ShowrunnerViabilityPanel } from '@/components/tv/ShowrunnerViabilityPanel';
import { PlatformFitPanel } from '@/components/tv/PlatformFitPanel';
import { RenewalProbabilityPanel } from '@/components/tv/RenewalProbabilityPanel';
import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';
import type { StageReadinessResult } from '@/lib/stage-readiness';

interface Props {
  project: Project;
  projectId: string;
  cast: ProjectCastMember[];
  hods: ProjectHOD[];
  scriptCharacters: any[];
  scriptCharactersLoading: boolean;
  scriptText: string | null;
  isTV: boolean;
  stageReadiness: StageReadinessResult | null;
}

export function PackagingStage({
  project, projectId, cast, hods,
  scriptCharacters, scriptCharactersLoading, scriptText, isTV, stageReadiness,
}: Props) {
  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}
      <ProjectAttachmentTabs
        projectId={projectId}
        projectContext={{ title: project.title, format: project.format, budget_range: project.budget_range, genres: project.genres }}
        projectTitle={project.title}
        format={project.format}
        genres={project.genres || []}
        budgetRange={project.budget_range}
        tone={project.tone}
        assignedLane={project.assigned_lane}
        scriptCharacters={scriptCharacters}
        scriptCharactersLoading={scriptCharactersLoading}
      />
      <CastImpactPanel cast={cast} hods={hods} />

      {/* TV-specific packaging */}
      {isTV && (
        <>
          <StoryEnginePanel
            projectId={projectId}
            projectTitle={project.title}
            format={project.format}
            genres={project.genres || []}
            scriptText={scriptText}
          />
          <SeasonArcPanel projectTitle={project.title} scriptText={scriptText} />
          <SeriesBiblePanel projectTitle={project.title} scriptText={scriptText} />
          <ShowrunnerViabilityPanel hods={hods} />
          <PlatformFitPanel
            format={project.format}
            genres={project.genres || []}
            budgetRange={project.budget_range}
            tone={project.tone}
            targetAudience={project.target_audience}
            assignedLane={project.assigned_lane}
          />
          <RenewalProbabilityPanel
            genres={project.genres || []}
            budgetRange={project.budget_range}
            cast={cast}
            hods={hods}
          />
        </>
      )}
    </div>
  );
}

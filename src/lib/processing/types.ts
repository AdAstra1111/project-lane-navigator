/**
 * ProcessingTracker — Shared types for global processing visibility.
 * Every long-running workflow registers here so the user can see what's happening.
 */

export type ProcessStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed';

export interface ProcessStage {
  label: string;
  description: string;
}

export interface ActiveProcess {
  /** Unique key per process instance (e.g. "ingestion-{projectId}" or "autopopulate-{projectId}-{timestamp}") */
  id: string;
  /** Human-readable workflow name */
  type: string;
  /** Project context */
  projectId?: string;
  projectTitle?: string;
  /** Current status */
  status: ProcessStatus;
  /** Stage-based progress */
  stages?: string[];
  currentStageIndex?: number;
  stageDescription?: string;
  /** Numeric progress if truly available */
  percent?: number;
  /** Counts if available */
  processed?: number;
  total?: number;
  /** Timestamps */
  startedAt: number;
  completedAt?: number;
  /** Error info */
  error?: string;
  /** Link to relevant workspace */
  href?: string;
}

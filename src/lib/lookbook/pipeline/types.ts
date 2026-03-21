/**
 * Pipeline types for the canonical LookBook build pipeline.
 * Defines stage enum, state shape, and progress reporting.
 */
import type { LookBookData, SlideContent, LookBookVisualIdentity } from '../types';
import type { ProjectImage } from '@/lib/images/types';
import type { SectionImageResult, ResolutionDiagnostics, ResolvedCanonImages } from '../resolveCanonImages';
import type { GapAnalysisResult } from '@/lib/images/lookbookGapAnalyzer';
import type { OrchestrationResult, BuildWorkingSet } from '@/lib/images/lookbookImageOrchestrator';
import type { PoolKey } from './lookbookSlotRegistry';

// ── Pipeline Stages ──────────────────────────────────────────────────────────

export enum PipelineStage {
  MODE_SELECTION = 'MODE_SELECTION',
  NARRATIVE_EXTRACTION = 'NARRATIVE_EXTRACTION',
  SLOT_PLANNING = 'SLOT_PLANNING',
  IDENTITY_BINDING = 'IDENTITY_BINDING',
  INVENTORY = 'INVENTORY',
  GAP_ANALYSIS = 'GAP_ANALYSIS',
  RESOLUTION = 'RESOLUTION',
  GENERATION = 'GENERATION',
  ELECTION = 'ELECTION',
  ASSEMBLY = 'ASSEMBLY',
  QA = 'QA',
}

export type PipelineMode = 'fresh_build' | 'reuse_recovery';

// ── Stage Status ─────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'complete' | 'warning' | 'blocked' | 'skipped';

export interface StageState {
  stage: PipelineStage;
  status: StageStatus;
  startedAt?: number;
  completedAt?: number;
  message?: string;
}

// ── Pipeline State (progressive accumulation) ────────────────────────────────

export interface NarrativeContext {
  projectTitle: string;
  genre: string;
  format: string;
  formatLabel: string;
  tone: string;
  targetAudience: string;
  assignedLane: string;
  comparableTitles: string;
  logline: string;
  premise: string;
  worldRules: string;
  locations: string;
  timeline: string;
  toneStyle: string;
  formatConstraints: string;
  comparables: string;
  synopsis: string;
  creativeStatement: string;
  characters: unknown;
}

export interface InventoryResult {
  canonImages: ResolvedCanonImages;
  sectionPools: Record<PoolKey, ProjectImage[]>;
  allUniqueImages: ProjectImage[];
  diagnostics: ResolutionDiagnostics;
  characterImageMap: Map<string, string>;
  characterNameImageMap: Map<string, string>;
}

export interface ElectionContext {
  /** Deck-level URL usage tracker */
  deckImageUsage: Map<string, { count: number; usedOnSlides: string[] }>;
  /** Semantic fingerprint tracker */
  usedFingerprints: Map<string, number>;
  /** URL → ProjectImage lookup */
  urlToImage: Map<string, ProjectImage>;
  /** Used background URLs for dedup */
  usedBackgroundUrls: string[];
}

export interface QAResult {
  totalSlides: number;
  slidesWithImages: number;
  slidesWithoutImages: number;
  totalImageRefs: number;
  unresolvedSlides: string[];
  reuseWarnings: string[];
  fingerprintWarnings: string[];
  publishable: boolean;
}

// ── Pipeline Progress Callback ───────────────────────────────────────────────

export interface PipelineProgress {
  currentStage: PipelineStage;
  stageStatus: StageStatus;
  message: string;
  percent?: number;
  logs: string[];
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

// ── Pipeline Options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  projectId: string;
  mode: PipelineMode;
  companyName: string | null;
  companyLogoUrl: string | null;
  /** Working set from previous auto-complete (reuse_recovery mode) */
  workingSet?: BuildWorkingSet | null;
  /** Previous slides for user decision preservation */
  previousSlides?: SlideContent[] | null;
  /** Progress callback for UI updates */
  onProgress?: PipelineProgressCallback;
}

// ── Pipeline Result ──────────────────────────────────────────────────────────

export interface PipelineResult {
  data: LookBookData;
  qa: QAResult;
  stages: StageState[];
  logs: string[];
  durationMs: number;
}

export type ProjectFormat = 'film' | 'tv-series' | 'limited-series' | 'short-film' | 'documentary' | 'documentary-series' | 'hybrid-documentary' | 'digital-series' | 'commercial' | 'branded-content' | 'music-video' | 'proof-of-concept' | 'hybrid' | 'vertical-drama' | 'anim-feature' | 'anim-series' | 'reality' | 'podcast-ip';

export type DocumentarySubtype = 'documentary' | 'documentary-series' | 'hybrid-documentary';

export function isDocumentaryFormat(format: string): boolean {
  return ['documentary', 'documentary-series', 'hybrid-documentary'].includes(format);
}

// ---- Documentary Monetisation Lanes ----

export type DocMonetisationLane =
  | 'grant-festival'
  | 'broadcaster-commission'
  | 'streamer-acquisition'
  | 'impact-first'
  | 'theatrical-doc'
  | 'hybrid-distribution';

export const DOC_LANE_LABELS: Record<DocMonetisationLane, string> = {
  'grant-festival': 'Grant + Festival Circuit',
  'broadcaster-commission': 'Broadcaster Commission',
  'streamer-acquisition': 'Streamer Acquisition',
  'impact-first': 'Impact-First Distribution',
  'theatrical-doc': 'Theatrical Documentary',
  'hybrid-distribution': 'Hybrid Distribution',
};

export const DOC_LANE_COLORS: Record<DocMonetisationLane, string> = {
  'grant-festival': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  'broadcaster-commission': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'streamer-acquisition': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'impact-first': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'theatrical-doc': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'hybrid-distribution': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
};

export type TVSubformat = 'limited' | 'returning' | 'anthology';

export type MonetisationLane =
  | 'studio-streamer'
  | 'independent-film'
  | 'low-budget'
  | 'international-copro'
  | 'genre-market'
  | 'prestige-awards'
  | 'fast-turnaround';

export type TVMonetisationLane =
  | 'streamer-original'
  | 'broadcaster-commission'
  | 'international-copro-series'
  | 'premium-cable'
  | 'fast-channel'
  | 'hybrid-platform';

export const TV_LANE_LABELS: Record<TVMonetisationLane, string> = {
  'streamer-original': 'Streamer Original',
  'broadcaster-commission': 'Broadcaster Commission',
  'international-copro-series': 'International Co-Pro Series',
  'premium-cable': 'Premium Cable',
  'fast-channel': 'FAST Channel',
  'hybrid-platform': 'Hybrid / Multi-Platform',
};

export const TV_LANE_COLORS: Record<TVMonetisationLane, string> = {
  'streamer-original': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'broadcaster-commission': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'international-copro-series': 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  'premium-cable': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'fast-channel': 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  'hybrid-platform': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
};

// ---- Analysis Types ----

export interface StructuralRead {
  format_detected: string;
  genre_as_written: string;
  protagonist_goal_clarity: string;
  structure_clarity: string;
}

export interface CreativeSignal {
  originality: string;
  tone_consistency: string;
  emotional_engine: string;
  standout_elements: string;
}

export interface MarketReality {
  likely_audience: string;
  comparable_titles: string;
  budget_implications: string;
  commercial_risks: string;
}

export interface FullAnalysis {
  verdict?: string;
  structural_read: StructuralRead;
  creative_signal: CreativeSignal;
  market_reality: MarketReality;
  do_next: string[];
  avoid: string[];
  lane_not_suitable?: string;
  partial_read?: { pages_analyzed: number; total_pages: number } | null;
}

// ---- Document Types ----

export interface DocumentExtractionResult {
  file_name: string;
  file_path: string;
  extracted_text: string;
  extraction_status: 'success' | 'partial' | 'failed';
  total_pages: number | null;
  pages_analyzed: number | null;
  error_message: string | null;
}

export type DocumentType = 'script' | 'treatment' | 'deck' | 'lookbook' | 'schedule' | 'budget' | 'document';

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  script: 'Script',
  treatment: 'Treatment',
  deck: 'Deck',
  lookbook: 'Lookbook',
  schedule: 'Schedule',
  budget: 'Budget',
  document: 'Document',
};

export interface ProjectDocument {
  id: string;
  project_id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  extracted_text: string | null;
  extraction_status: string;
  total_pages: number | null;
  pages_analyzed: number | null;
  error_message: string | null;
  created_at: string;
  doc_type: DocumentType;
  ingestion_source?: string;
  char_count?: number;
  /** Plaintext from latest project_document_versions row (for dev-engine docs) */
  version_plaintext?: string | null;
}

// ---- AI Response ----

export interface AnalysisResponse {
  verdict: string;
  lane: MonetisationLane;
  confidence: number;
  rationale: string;
  structural_read: StructuralRead;
  creative_signal: CreativeSignal;
  market_reality: MarketReality;
  do_next: string[];
  avoid: string[];
  lane_not_suitable: string;
  partial_read?: { pages_analyzed: number; total_pages: number } | null;
  documents: DocumentExtractionResult[];
}

// ---- Legacy Types (backward compat) ----

export interface Recommendation {
  category: string;
  title: string;
  description: string;
}

// Old analysis pass structure (from pre-document analysis)
export interface LegacyAnalysisPass {
  title: string;
  summary: string;
  signals: string[];
}

// ---- Project Types ----

export interface ProjectInput {
  title: string;
  format: ProjectFormat;
  genres: string[];
  budget_range: string;
  target_audience: string;
  tone: string;
  comparable_titles: string;
}

export interface ClassificationResult {
  lane: MonetisationLane;
  confidence: number;
  reasoning: string;
  recommendations: Recommendation[];
}

export type PipelineStage = 'development' | 'packaging' | 'financing' | 'pre-production';

export const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'development', label: 'Development' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'financing', label: 'Financing' },
  { value: 'pre-production', label: 'Pre-Production' },
];

export interface Project {
  id: string;
  user_id: string;
  title: string;
  format: string;
  genres: string[];
  budget_range: string;
  target_audience: string;
  tone: string;
  comparable_titles: string;
  assigned_lane: string | null;
  confidence: number | null;
  reasoning: string | null;
  recommendations: Recommendation[] | null;
  document_urls: string[];
  analysis_passes: FullAnalysis | null;
  pipeline_stage: PipelineStage;
  script_coverage_verdict: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  development_behavior?: string | null;
  episode_target_duration_seconds?: number | null;
}

export const LANE_LABELS: Record<MonetisationLane, string> = {
  'studio-streamer': 'Studio / Streamer',
  'independent-film': 'Independent Film',
  'low-budget': 'Low-Budget / Microbudget',
  'international-copro': 'International Co-Production',
  'genre-market': 'Genre / Market-Driven',
  'prestige-awards': 'Prestige / Awards',
  'fast-turnaround': 'Fast-Turnaround / Trend-Based',
};

export const LANE_COLORS: Record<MonetisationLane, string> = {
  'studio-streamer': 'bg-lane-studio/15 text-lane-studio border-lane-studio/30',
  'independent-film': 'bg-lane-independent/15 text-lane-independent border-lane-independent/30',
  'low-budget': 'bg-lane-lowbudget/15 text-lane-lowbudget border-lane-lowbudget/30',
  'international-copro': 'bg-lane-copro/15 text-lane-copro border-lane-copro/30',
  'genre-market': 'bg-lane-genre/15 text-lane-genre border-lane-genre/30',
  'prestige-awards': 'bg-lane-prestige/15 text-lane-prestige border-lane-prestige/30',
  'fast-turnaround': 'bg-lane-fast/15 text-lane-fast border-lane-fast/30',
};

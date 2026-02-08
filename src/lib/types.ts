export type ProjectFormat = 'film' | 'tv-series';

export type MonetisationLane =
  | 'studio-streamer'
  | 'independent-film'
  | 'low-budget'
  | 'international-copro'
  | 'genre-market'
  | 'prestige-awards'
  | 'fast-turnaround';

export interface Recommendation {
  category: string;
  title: string;
  description: string;
}

export interface AnalysisPass {
  title: string;
  summary: string;
  signals: string[];
}

export interface AnalysisPasses {
  structure: AnalysisPass;
  creative: AnalysisPass;
  market: AnalysisPass;
}

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
  passes?: AnalysisPasses;
}

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
  analysis_passes: AnalysisPasses | null;
  created_at: string;
  updated_at: string;
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

/**
 * Creative Framing Engine — Type definitions.
 * Single source of truth for framing strategies across all content surfaces.
 */

export type StrategyType =
  | 'market_aligned'
  | 'prestige'
  | 'commercial'
  | 'subversive'
  | 'experimental'
  | 'parody';

export type AudienceTarget = 'mass' | 'niche' | 'festival' | 'platform_specific';

export type RiskLevel = 'safe' | 'elevated' | 'bold' | 'experimental';

export type TropeHandling = 'follow' | 'invert' | 'subvert' | 'parody';

export type ContentType = 'poster' | 'lookbook' | 'deck' | 'script' | 'pitch';

export interface CanonLock {
  era: string;
  world: string;
  genre: string;
  toneBoundaries: string[];
  prohibitions: string[];
}

export interface FramingStrategy {
  id: string;
  projectId: string;
  contentType: ContentType;
  strategyKey: string;
  strategyType: StrategyType;
  intent: string;
  audienceTarget: AudienceTarget;
  riskLevel: RiskLevel;
  creativeAngle: string;
  tropeHandling: TropeHandling;
  visualLanguage: string;
  canonLockSummary: string;
  fullBrief: string;
  isSelected: boolean;
  generatedAt: string;
  metaJson: Record<string, unknown>;
}

/** Strategy display metadata */
export const STRATEGY_TYPE_META: Record<StrategyType, {
  label: string;
  color: string;
  description: string;
}> = {
  market_aligned: {
    label: 'Market-Aligned',
    color: 'text-emerald-400',
    description: 'Industry-standard positioning, commercially clear',
  },
  prestige: {
    label: 'Prestige',
    color: 'text-amber-400',
    description: 'Awards-leaning, restrained, thematic elegance',
  },
  commercial: {
    label: 'Commercial',
    color: 'text-blue-400',
    description: 'Bold hook, high-concept, mass-market appeal',
  },
  subversive: {
    label: 'Subversive',
    color: 'text-red-400',
    description: 'Flips expectations, unexpected angle on the story',
  },
  experimental: {
    label: 'Experimental',
    color: 'text-purple-400',
    description: 'Boundary-pushing approach, canon-safe innovation',
  },
  parody: {
    label: 'Meta / Parody',
    color: 'text-orange-400',
    description: 'Self-aware, trope commentary, genre-literate',
  },
};

export const RISK_LEVEL_META: Record<RiskLevel, { label: string; color: string }> = {
  safe: { label: 'Safe', color: 'bg-emerald-500/20 text-emerald-400' },
  elevated: { label: 'Elevated', color: 'bg-amber-500/20 text-amber-400' },
  bold: { label: 'Bold', color: 'bg-orange-500/20 text-orange-400' },
  experimental: { label: 'Experimental', color: 'bg-red-500/20 text-red-400' },
};

export const AUDIENCE_META: Record<AudienceTarget, string> = {
  mass: 'Mass Market',
  niche: 'Niche / Targeted',
  festival: 'Festival Circuit',
  platform_specific: 'Platform-Specific',
};

/** Map DB row to FramingStrategy */
export function mapRowToStrategy(row: any): FramingStrategy {
  return {
    id: row.id,
    projectId: row.project_id,
    contentType: row.content_type,
    strategyKey: row.strategy_key,
    strategyType: row.strategy_type,
    intent: row.intent,
    audienceTarget: row.audience_target,
    riskLevel: row.risk_level,
    creativeAngle: row.creative_angle,
    tropeHandling: row.trope_handling,
    visualLanguage: row.visual_language,
    canonLockSummary: row.canon_lock_summary,
    fullBrief: row.full_brief,
    isSelected: row.is_selected,
    generatedAt: row.generated_at,
    metaJson: row.meta_json || {},
  };
}

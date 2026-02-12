/**
 * Stage-aware trend mapping.
 * Maps lifecycle stages to the most relevant intelligence layers and signal priorities.
 */

import type { LifecycleStage } from '@/lib/lifecycle-stages';

export interface StageTrendContext {
  stage: LifecycleStage;
  label: string;
  primaryLayers: string[];       // intelligence_layer values to prioritise
  secondaryLayers: string[];     // still shown but deprioritised
  signalFocus: string[];         // signal categories most relevant
  description: string;
  stalenessThresholdDays: number; // how old data can be before flagged
}

const STAGE_TREND_MAP: Record<LifecycleStage, StageTrendContext> = {
  development: {
    stage: 'development',
    label: 'Development Trends',
    primaryLayers: ['narrative', 'market'],
    secondaryLayers: ['talent', 'platform'],
    signalFocus: ['Narrative', 'IP', 'Market Behaviour'],
    description: 'Genre saturation, narrative trends, and audience appetite signals most relevant during development.',
    stalenessThresholdDays: 30,
  },
  packaging: {
    stage: 'packaging',
    label: 'Packaging Trends',
    primaryLayers: ['talent', 'market'],
    secondaryLayers: ['narrative', 'platform'],
    signalFocus: ['Market Behaviour', 'Narrative'],
    description: 'Talent heat, buyer appetite, and market positioning signals to strengthen your package.',
    stalenessThresholdDays: 14,
  },
  'pre-production': {
    stage: 'pre-production',
    label: 'Pre-Production Trends',
    primaryLayers: ['market', 'platform'],
    secondaryLayers: ['talent', 'narrative'],
    signalFocus: ['Market Behaviour'],
    description: 'Territory incentive shifts, labour market conditions, and production cost trends.',
    stalenessThresholdDays: 14,
  },
  production: {
    stage: 'production',
    label: 'Production Trends',
    primaryLayers: ['market'],
    secondaryLayers: ['talent', 'narrative', 'platform'],
    signalFocus: ['Market Behaviour'],
    description: 'Monitor market shifts that may impact delivery strategy and post-production decisions.',
    stalenessThresholdDays: 30,
  },
  'post-production': {
    stage: 'post-production',
    label: 'Post-Production Trends',
    primaryLayers: ['platform', 'market'],
    secondaryLayers: ['narrative', 'talent'],
    signalFocus: ['Market Behaviour'],
    description: 'Platform demand signals and festival timing to optimise release strategy.',
    stalenessThresholdDays: 14,
  },
  'sales-delivery': {
    stage: 'sales-delivery',
    label: 'Sales & Distribution Trends',
    primaryLayers: ['platform', 'market'],
    secondaryLayers: ['talent', 'narrative'],
    signalFocus: ['Market Behaviour', 'IP'],
    description: 'Platform demand, territory pricing trends, and buyer appetite for your genre/format.',
    stalenessThresholdDays: 7,
  },
};

export function getStageTrendContext(stage: LifecycleStage): StageTrendContext {
  return STAGE_TREND_MAP[stage];
}

/**
 * Check if a trend engine's data is stale given the current stage context.
 */
export function isTrendStale(
  lastRefresh: string | null | undefined,
  stage: LifecycleStage,
): boolean {
  if (!lastRefresh) return true;
  const ctx = getStageTrendContext(stage);
  const refreshDate = new Date(lastRefresh);
  const daysSince = (Date.now() - refreshDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > ctx.stalenessThresholdDays;
}

/**
 * Returns whether a given intelligence layer is primary for the current stage.
 */
export function isLayerPrimary(layer: string, stage: LifecycleStage): boolean {
  return getStageTrendContext(stage).primaryLayers.includes(layer);
}

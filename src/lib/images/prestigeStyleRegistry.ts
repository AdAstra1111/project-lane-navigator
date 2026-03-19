/**
 * Prestige Vertical Style Registry — THIN RE-EXPORT from canonical contract.
 *
 * All data and logic lives in prestigeStyleContract.ts (which mirrors
 * supabase/functions/_shared/prestigeStyleSystem.ts exactly).
 *
 * This file exists only for backward-compatible imports.
 * DO NOT add data here. Edit prestigeStyleContract.ts instead.
 */

export {
  // Types
  type LaneGrammar,
  type PrestigeStyleDef as PrestigeStyle,
  type PrestigeStyleKey,
  type ComplianceResult,
  // Data
  LANE_GRAMMARS,
  PRESTIGE_STYLES,
  PRESTIGE_STYLE_KEYS,
  // Functions
  resolveFormatToLane,
  resolvePrestigeStyle,
  classifyImageForStyleFilter,
  validateLaneCompliance,
  getAspectDimensions,
} from './prestigeStyleContract';

// Re-export PrestigeStyleDef under its old name for components that used it
export type { PrestigeStyleDef } from './prestigeStyleContract';

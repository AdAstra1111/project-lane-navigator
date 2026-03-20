/**
 * Lookbook Rebuild Trigger — Deterministic trigger conditions and mode selection
 * for auto-run / mission-control integration.
 *
 * Provides canonical rules for:
 * 1. Whether a lookbook rebuild should run
 * 2. Which mode to select (preserve vs reset)
 * 3. Structured trigger diagnostics
 *
 * Consumers: auto-run orchestration, mission control, health checks, LookBookPage.
 * Does NOT contain rebuild business logic — delegates to canonRebuildExecutor.
 */

import { resolveRequiredVisualSet, type RequiredSlot } from './requiredVisualSet';
import { classifySlotWeakness, type SlotTarget, type RebuildMode } from './canonRebuildScoring';
import { extractEntities } from './canonRebuildExecutor';
import type { ProjectImage } from './types';

// ── Trigger Condition Types ──

export type RebuildTriggerCondition =
  | 'unresolved_required_slots'
  | 'non_compliant_primaries'
  | 'missing_primaries'
  | 'weak_primaries'
  | 'canon_changed'
  | 'explicit_request';

export interface RebuildTriggerDiagnostics {
  shouldRebuild: boolean;
  conditions: RebuildTriggerCondition[];
  recommendedMode: RebuildMode;
  modeReason: string;
  slotSummary: {
    totalSlots: number;
    filledSlots: number;
    emptySlots: number;
    weakSlots: number;
    nonCompliantSlots: number;
  };
}

// ── Trigger Evaluation ──

/**
 * Evaluate whether a lookbook rebuild should be triggered and which mode to use.
 * Deterministic — same inputs always produce same output.
 */
export function evaluateRebuildTrigger(
  canonJson: any,
  images: ProjectImage[],
  isVerticalDrama: boolean,
  projectFormat: string,
  projectLane: string,
  options?: {
    /** Force trigger regardless of conditions */
    forceTriggered?: boolean;
    /** Explicit condition override */
    explicitCondition?: RebuildTriggerCondition;
  },
): RebuildTriggerDiagnostics {
  const entities = extractEntities(canonJson);
  const required = resolveRequiredVisualSet(
    entities.characters, entities.locations, images, isVerticalDrama,
  );

  // Build slot targets for weakness classification
  const slotTargets: SlotTarget[] = required.slots.map(s => ({
    key: s.key,
    assetGroup: s.assetGroup,
    subject: s.subject,
    shotType: s.shotType || '',
    expectedAspectRatio: s.aspectRatio,
    isIdentity: s.isIdentity,
  }));

  let emptySlots = 0;
  let weakSlots = 0;
  let nonCompliantSlots = 0;
  let filledSlots = 0;

  for (const slot of required.slots) {
    const target = slotTargets.find(t => t.key === slot.key);
    if (!target) continue;

    if (!slot.primaryImage) {
      emptySlots++;
      continue;
    }

    filledSlots++;
    const weakness = classifySlotWeakness(
      slot.primaryImage, target, isVerticalDrama, projectFormat, projectLane,
    );
    if (weakness.isWeak) {
      weakSlots++;
      if (weakness.reasons.some(r => r.includes('compliance') || r.includes('non-compliant'))) {
        nonCompliantSlots++;
      }
    }
  }

  const totalSlots = required.slots.length;
  const conditions: RebuildTriggerCondition[] = [];

  if (options?.explicitCondition) {
    conditions.push(options.explicitCondition);
  }

  if (emptySlots > 0) conditions.push('missing_primaries');
  if (nonCompliantSlots > 0) conditions.push('non_compliant_primaries');
  if (weakSlots > nonCompliantSlots) conditions.push('weak_primaries');
  if (emptySlots > 0 && emptySlots === totalSlots) conditions.push('unresolved_required_slots');

  const shouldRebuild = options?.forceTriggered || conditions.length > 0;

  // ── Mode Selection ──
  // RESET when: no primaries at all, or > 50% slots empty, or explicit reset request
  // PRESERVE when: some primaries exist and are worth keeping
  const { mode, reason } = selectRebuildMode(
    totalSlots, filledSlots, emptySlots, weakSlots, nonCompliantSlots,
    options?.explicitCondition,
  );

  return {
    shouldRebuild,
    conditions,
    recommendedMode: mode,
    modeReason: reason,
    slotSummary: {
      totalSlots,
      filledSlots,
      emptySlots,
      weakSlots,
      nonCompliantSlots,
    },
  };
}

// ── Mode Selection Logic ──

function selectRebuildMode(
  totalSlots: number,
  filledSlots: number,
  emptySlots: number,
  weakSlots: number,
  nonCompliantSlots: number,
  explicitCondition?: RebuildTriggerCondition,
): { mode: RebuildMode; reason: string } {
  // Explicit reset request
  if (explicitCondition === 'canon_changed') {
    return {
      mode: 'RESET_FULL_CANON_REBUILD',
      reason: 'Canon changed — full reset recommended',
    };
  }

  // No primaries at all → reset
  if (filledSlots === 0) {
    return {
      mode: 'RESET_FULL_CANON_REBUILD',
      reason: 'No existing primaries — starting from scratch',
    };
  }

  // > 50% empty → reset (not enough anchor material for preserve)
  if (emptySlots > totalSlots * 0.5) {
    return {
      mode: 'RESET_FULL_CANON_REBUILD',
      reason: `${emptySlots}/${totalSlots} slots empty — insufficient anchor set for preserve mode`,
    };
  }

  // > 50% non-compliant → reset (anchor set is corrupted)
  if (nonCompliantSlots > filledSlots * 0.5) {
    return {
      mode: 'RESET_FULL_CANON_REBUILD',
      reason: `${nonCompliantSlots}/${filledSlots} primaries non-compliant — anchor set unreliable`,
    };
  }

  // Default: preserve existing compliant primaries
  const weakCount = weakSlots + emptySlots;
  return {
    mode: 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD',
    reason: `${filledSlots} primaries anchored, ${weakCount} slots targeted for repair`,
  };
}

// ── Trigger Condition Labels ──

export function getTriggerConditionLabel(condition: RebuildTriggerCondition): string {
  switch (condition) {
    case 'unresolved_required_slots': return 'All required slots unresolved';
    case 'non_compliant_primaries': return 'Non-compliant primary images detected';
    case 'missing_primaries': return 'Missing primary images';
    case 'weak_primaries': return 'Weak primary images detected';
    case 'canon_changed': return 'Canon data changed';
    case 'explicit_request': return 'Manually requested';
  }
}

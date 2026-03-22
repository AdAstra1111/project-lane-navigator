/**
 * regenPolicyEngine — Phase 13: Regeneration Policy Engine.
 *
 * READ-ONLY decision layer that converts Phase 10–12 diagnostics
 * into explicit, structured regeneration recommendations.
 *
 * No mutations. No job creation. No execution.
 * Deterministic policy + planning only.
 */
import { evaluateOutputConsistency, type OutputConsistencyResult } from './castConsistency';
import { evaluateCharacterContinuity, type CharacterContinuityResult } from './continuityDiagnostics';
import { evaluateSceneConsistency, type SceneConsistencyResult } from './sceneConsistency';

export type RegenPolicyReason =
  | 'scene_broken'
  | 'scene_partial'
  | 'character_misaligned'
  | 'character_unbound'
  | 'continuity_mixed'
  | 'continuity_broken';

export interface RegenPolicyItem {
  output_id: string;
  character_key: string | null;
  priority: 'high' | 'medium' | 'low';
  reasons: RegenPolicyReason[];
  confidence: number; // 0–100
}

export interface RegenPolicySummary {
  total_items: number;
  high_priority: number;
  medium_priority: number;
  low_priority: number;
  items: RegenPolicyItem[];
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function higherPriority(
  a: RegenPolicyItem['priority'],
  b: RegenPolicyItem['priority'],
): RegenPolicyItem['priority'] {
  return (PRIORITY_RANK[a] || 0) >= (PRIORITY_RANK[b] || 0) ? a : b;
}

/**
 * Build a deterministic regeneration policy from Phase 10–12 diagnostics.
 */
export async function buildRegenPolicy(
  projectId: string,
): Promise<RegenPolicySummary> {
  // 1. Gather diagnostics from existing engines (no recomputation)
  const [consistencyResults, continuityResults, sceneResults] = await Promise.all([
    evaluateOutputConsistency(projectId),
    evaluateCharacterContinuity(projectId),
    evaluateSceneConsistency(projectId),
  ]);

  // Accumulator: keyed by "output_id|character_key"
  const itemMap = new Map<
    string,
    { output_id: string; character_key: string | null; priority: RegenPolicyItem['priority']; reasons: Set<RegenPolicyReason>; confidence: number }
  >();

  function mergeItem(
    output_id: string,
    character_key: string | null,
    reason: RegenPolicyReason,
    priority: RegenPolicyItem['priority'],
    confidence: number,
  ) {
    const key = `${output_id}|${character_key ?? '__ALL__'}`;
    const existing = itemMap.get(key);
    if (existing) {
      existing.reasons.add(reason);
      existing.priority = higherPriority(existing.priority, priority);
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      itemMap.set(key, {
        output_id,
        character_key,
        priority,
        reasons: new Set([reason]),
        confidence,
      });
    }
  }

  // ── A. Scene-level signals (Phase 12) ──

  for (const scene of sceneResults) {
    if (scene.overall_status === 'broken') {
      for (const ch of scene.characters) {
        mergeItem(scene.output_id, ch.character_key || null, 'scene_broken', 'high', 95);
      }
    } else if (scene.overall_status === 'partial') {
      for (const ch of scene.characters) {
        if (ch.status !== 'aligned') {
          mergeItem(scene.output_id, ch.character_key || null, 'scene_partial', 'medium', 80);
        }
      }
    }
  }

  // ── B. Character consistency signals (Phase 10) ──

  for (const r of consistencyResults) {
    if (r.status === 'misaligned') {
      mergeItem(r.output_id, r.character_key || null, 'character_misaligned', 'high', 90);
    } else if (r.status === 'unbound') {
      mergeItem(r.output_id, r.character_key || null, 'character_unbound', 'high', 95);
    }
  }

  // ── C. Continuity signals (Phase 11) ──
  // Continuity is per-character across outputs. We need to map affected
  // outputs back. We use consistency results to find which outputs
  // contain which characters.

  const outputsByCharacter = new Map<string, string[]>();
  for (const r of consistencyResults) {
    if (r.character_key) {
      const list = outputsByCharacter.get(r.character_key) || [];
      list.push(r.output_id);
      outputsByCharacter.set(r.character_key, list);
    }
  }

  for (const [charKey, continuity] of Object.entries(continuityResults)) {
    if (continuity.status === 'broken') {
      const outputIds = outputsByCharacter.get(charKey) || [];
      for (const oid of outputIds) {
        mergeItem(oid, charKey, 'continuity_broken', 'high', 95);
      }
    } else if (continuity.status === 'mixed') {
      const outputIds = outputsByCharacter.get(charKey) || [];
      for (const oid of outputIds) {
        mergeItem(oid, charKey, 'continuity_mixed', 'medium', 75);
      }
    }
  }

  // ── Build final sorted list ──

  const items: RegenPolicyItem[] = [];
  for (const entry of itemMap.values()) {
    items.push({
      output_id: entry.output_id,
      character_key: entry.character_key,
      priority: entry.priority,
      reasons: [...entry.reasons],
      confidence: entry.confidence,
    });
  }

  // Deterministic sort: high → medium → low, then output_id, then character_key
  items.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pa !== pb) return pb - pa;
    const oa = a.output_id.localeCompare(b.output_id);
    if (oa !== 0) return oa;
    return (a.character_key || '').localeCompare(b.character_key || '');
  });

  return {
    total_items: items.length,
    high_priority: items.filter((i) => i.priority === 'high').length,
    medium_priority: items.filter((i) => i.priority === 'medium').length,
    low_priority: items.filter((i) => i.priority === 'low').length,
    items,
  };
}

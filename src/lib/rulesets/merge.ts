/**
 * Ruleset Engine — Merge rules with overrides
 */
import type { EngineProfile, OverridePatch } from './types';

/**
 * Deep clone a profile.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Apply JSON Patch-like operations to an EngineProfile.
 * Paths use "/" separator, e.g. "/budgets/twist_cap".
 */
export function applyOverrides(
  profile: EngineProfile,
  patches: OverridePatch[],
): EngineProfile {
  const result = deepClone(profile);

  for (const patch of patches) {
    const parts = patch.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    if (patch.op === 'remove') {
      // Navigate to parent
      let target: Record<string, unknown> = result as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]] as Record<string, unknown>;
        if (!target) break;
      }
      if (target) {
        const key = parts[parts.length - 1];
        if (Array.isArray(target)) {
          const idx = parseInt(key, 10);
          if (!isNaN(idx)) (target as unknown[]).splice(idx, 1);
        } else {
          delete target[key];
        }
      }
      continue;
    }

    // replace or add
    let target: Record<string, unknown> = result as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) {
        target[parts[i]] = {};
      }
      target = target[parts[i]] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = patch.value;
  }

  return result;
}

/**
 * Merge: lane defaults → engine profile → project overrides → run overrides.
 * Each layer's patches are applied in order.
 */
export function mergeRuleset(
  base: EngineProfile,
  engineProfile: EngineProfile | null,
  projectOverrides: OverridePatch[],
  runOverrides: OverridePatch[],
): EngineProfile {
  let result = engineProfile ? deepClone(engineProfile) : deepClone(base);

  // Apply project-default overrides
  if (projectOverrides.length > 0) {
    result = applyOverrides(result, projectOverrides);
  }

  // Apply run-only overrides (highest precedence)
  if (runOverrides.length > 0) {
    result = applyOverrides(result, runOverrides);
  }

  return result;
}

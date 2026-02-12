import type { UIMode } from './mode';

/**
 * Determines whether advanced-only panels should be visible.
 */
export function canSeeAdvanced(mode: UIMode): boolean {
  return mode === 'advanced';
}

/**
 * Resolve effective mode: project override wins over user preference.
 */
export function getEffectiveMode(
  userMode: UIMode,
  projectOverride: string | null | undefined,
): UIMode {
  if (projectOverride === 'simple' || projectOverride === 'advanced') {
    return projectOverride;
  }
  return userMode;
}

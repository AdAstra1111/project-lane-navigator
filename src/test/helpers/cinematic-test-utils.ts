/**
 * Shared test utilities for CIK test files.
 * Extracted from cinematic-features.test.ts — no logic changes.
 */
import type { CinematicUnit } from "../../../supabase/functions/_shared/cinematic-model";

export function makeUnit(overrides: Partial<CinematicUnit> & { id: string }): CinematicUnit {
  return {
    intent: "intrigue",
    energy: 0.5,
    tension: 0.5,
    density: 0.5,
    tonal_polarity: 0,
    ...overrides,
  };
}

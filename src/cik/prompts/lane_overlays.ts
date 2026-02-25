/**
 * CIK Prompt Library — Lane-specific overlays
 * Each overlay adds lane-aware constraints on top of the base prompt.
 * All overlays are static constants — no randomness.
 */

export interface LaneOverlay {
  lane: string;
  label: string;
  systemSuffix: string;
  repairHints: string;
}

const FEATURE_FILM_OVERLAY: LaneOverlay = {
  lane: "feature_film",
  label: "Feature Film",
  systemSuffix: `Lane: Feature Film.
- Aim for cinematic depth: complex emotional arcs, layered tension.
- Peak must feel like a trailer "money shot" moment.
- Minimum 3 tonal shifts across beats.`,
  repairHints: `Lane-specific (Feature Film):
- Ensure climax beat reads as a decisive turning point.
- Peak energy must be unmistakable (≥0.92).
- Prefer dramatic escalation over quick cuts.`,
};

const SERIES_OVERLAY: LaneOverlay = {
  lane: "series",
  label: "Series",
  systemSuffix: `Lane: Series.
- Build hook-driven beats that tease episodic arcs.
- End on a cliffhanger or question, not full resolution.
- Minimum 3 distinct character/plot threads referenced.`,
  repairHints: `Lane-specific (Series):
- Maintain multi-thread tension; don't collapse to single arc.
- Final beat should open questions, not close them.
- Ensure breadth of intent (intrigue + threat + wonder).`,
};

const VERTICAL_DRAMA_OVERLAY: LaneOverlay = {
  lane: "vertical_drama",
  label: "Vertical Drama",
  systemSuffix: `Lane: Vertical Drama.
- Short-form: every beat must punch. No filler.
- Faster pacing; density should be consistently high.
- Hook within first 2 beats.`,
  repairHints: `Lane-specific (Vertical Drama):
- Tighten: delete any beat under 0.50 energy.
- Front-load the hook; peak can be earlier than feature films.
- Keep total beat count compact.`,
};

const DOCUMENTARY_OVERLAY: LaneOverlay = {
  lane: "documentary",
  label: "Documentary",
  systemSuffix: `Lane: Documentary.
- Tone should feel authentic and grounded.
- Emotional arc builds through revelation, not spectacle.
- Include interview/testimony-style beats where appropriate.`,
  repairHints: `Lane-specific (Documentary):
- Arc should feel revelatory, building toward insight.
- Avoid spectacle-driven peaks; prefer emotional truth.
- Maintain grounded tonal register throughout.`,
};

/** All registered lane overlays (static map). */
export const LANE_OVERLAYS: Record<string, LaneOverlay> = {
  feature_film: FEATURE_FILM_OVERLAY,
  series: SERIES_OVERLAY,
  vertical_drama: VERTICAL_DRAMA_OVERLAY,
  documentary: DOCUMENTARY_OVERLAY,
};

/**
 * Get the overlay for a lane. Returns undefined for unknown lanes.
 * Callers should fall back to base-only behavior.
 */
export function getLaneOverlay(lane: string): LaneOverlay | undefined {
  return LANE_OVERLAYS[lane];
}

/**
 * Get all known lane keys (for testing/enumeration).
 */
export function getAllLaneKeys(): string[] {
  return Object.keys(LANE_OVERLAYS);
}

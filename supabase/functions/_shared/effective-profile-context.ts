/**
 * Shared Effective Profile Context Block Builder
 * 
 * Single canonical source for the prompt-injectable "EFFECTIVE PROFILE" block.
 * Used by dev-engine-v2 (and any future engines). Deterministic, no Supabase client, no env reads.
 * 
 * IMPORTANT: Do NOT use "@/" aliases — this runs in Deno edge functions.
 */

// ── Lane voice defaults (market-lane strings) ──
const LANE_VOICE_DEFAULTS: Record<string, { tone_band?: string; pacing?: string }> = {
  "independent-film": { tone_band: "dramatic", pacing: "measured" },
  "studio-streamer": { tone_band: "elevated", pacing: "accelerating" },
  "prestige-awards": { tone_band: "restrained", pacing: "deliberate" },
  "genre-market": { tone_band: "heightened", pacing: "accelerating" },
  "fast-turnaround": { tone_band: "punchy", pacing: "accelerating" },
};

export interface EffectiveProfileContextInput {
  canonJson: any;
  project: any;
}

/**
 * Builds a deterministic prompt-injectable text block from canon + project data.
 * Returns empty string if no meaningful data to inject.
 * 
 * Stable ordering. Clamped to top 6 comparables.
 * Header/footer: "=== EFFECTIVE PROFILE (from Seed Intel Pack) ===" / "=== END EFFECTIVE PROFILE ==="
 */
export function buildEffectiveProfileContextBlock(input: EffectiveProfileContextInput): string {
  const { canonJson, project } = input;
  const pack = canonJson?.seed_intel_pack;

  // Early exit if no pack and no explicit comparables
  if (!pack && !(Array.isArray(canonJson?.comparables) && canonJson.comparables.length > 0)) {
    return "";
  }

  const lane = project?.assigned_lane || "independent-film";
  const defaults = LANE_VOICE_DEFAULTS[lane] || {};
  const packTone = pack?.tone_style_signals || {};

  // ── Comparables: canon explicit > pack candidates ──
  let comps: any[] = [];
  if (Array.isArray(canonJson?.comparables) && canonJson.comparables.length > 0) {
    comps = canonJson.comparables;
  } else if (Array.isArray(pack?.comparable_candidates)) {
    comps = pack.comparable_candidates;
  }

  // Sort by weight desc then title asc if weights present
  const sorted = [...comps].sort((a: any, b: any) => {
    const wa = a.weight ?? 0;
    const wb = b.weight ?? 0;
    if (wb !== wa) return wb - wa;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  const parts: string[] = [];

  // Market profile
  parts.push(`Market Profile: ${lane}`);

  // Top 6 comparables
  const topComps = sorted.filter((c: any) => c.title).slice(0, 6);
  if (topComps.length > 0) {
    const lines = topComps.map((c: any, i: number) => {
      const axis = c.reference_axis ? ` [${c.reference_axis}]` : "";
      const w = c.weight != null ? ` w=${c.weight}` : "";
      const r = c.reason ? ` — ${c.reason}` : "";
      return `  ${i + 1}. ${c.title}${axis}${w}${r}`;
    });
    parts.push(`Comparable References:\n${lines.join("\n")}`);
  }

  // Voice profile
  const voiceParts: string[] = [];
  const toneBand = project?.tone || packTone.tone_band || defaults.tone_band;
  const pacing = packTone.pacing || defaults.pacing;
  if (toneBand) voiceParts.push(`tone=${toneBand}`);
  if (pacing) voiceParts.push(`pacing=${pacing}`);
  if (packTone.dialogue_density) voiceParts.push(`dialogue_density=${packTone.dialogue_density}`);
  if (packTone.humor_darkness) voiceParts.push(`humor=${packTone.humor_darkness}`);
  if (voiceParts.length > 0) parts.push(`Voice Profile: ${voiceParts.join(", ")}`);

  // Constraints
  const pc = pack?.constraints_suggestions || {};
  const cParts: string[] = [];
  if (project?.budget_range || pc.budget_band) cParts.push(`budget=${project?.budget_range || pc.budget_band}`);
  if (pc.runtime_band) cParts.push(`runtime=${pc.runtime_band}`);
  if (pc.rating) cParts.push(`rating=${pc.rating}`);
  if (cParts.length > 0) parts.push(`Constraints: ${cParts.join(", ")}`);

  // Primary style axis from comparables
  if (topComps.length > 0) {
    const axisCounts: Record<string, number> = {};
    for (const c of topComps) {
      if (c.reference_axis) {
        axisCounts[c.reference_axis] = (axisCounts[c.reference_axis] || 0) + (c.weight ?? 1);
      }
    }
    const sorted = Object.entries(axisCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      parts.push(`Primary Style Axis: ${sorted[0][0]}`);
    }
  }

  if (parts.length <= 1) return ""; // Only market profile — not worth injecting

  return `\n=== EFFECTIVE PROFILE (from Seed Intel Pack) ===\n${parts.join("\n")}\n=== END EFFECTIVE PROFILE ===`;
}

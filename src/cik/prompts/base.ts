/**
 * CIK Prompt Library — Base shared blocks
 * System framing, output contracts, safety/determinism rules.
 * All engines import from here instead of inlining.
 */

export const SYSTEM_DETERMINISM_RULES = `Rules:
- Return ONLY valid JSON. No commentary. No explanation. No markdown.
- Maintain all existing required fields and overall structure.
- Do NOT change the response JSON shape, field names, or required structure.`;

export const OUTPUT_CONTRACT_TRAILER = `Output contract (trailer):
- Each beat must include: beat_index, intent, energy, tension, density, tonal_polarity.
- energy/tension/density: 0.0 to 1.0 floats reflecting beat intensity.
- tonal_polarity: -1.0 (dark/threatening) to 1.0 (hopeful/uplifting).
- Do NOT omit any field.`;

export const OUTPUT_CONTRACT_STORYBOARD = `Output contract (storyboard):
- Each panel entry must include unit_key and panels array.
- Each panel must include panel_index and prompt.
- Do NOT drop, rename, or duplicate unit_key values.`;

export const CIK_QUALITY_MINIMUMS = `CIK QUALITY MINIMUMS (MUST SATISFY):
- PEAK: At least one of the final 2 units must have energy >= 0.90 AND tension >= 0.80.
- CONTRAST: At least one adjacent pair of units must have an energy increase >= 0.20.`;

export const SAFETY_BLOCK = `SAFETY:
- No explicit violence, hate speech, or illegal content.
- Characters and settings must be consistent with source material.`;

/** Maximum characters for assembled repair instruction. */
export const MAX_REPAIR_CHARS = 2500;

/** Maximum characters for base system prompt (before lane overlay). */
export const MAX_SYSTEM_PROMPT_CHARS = 12000;

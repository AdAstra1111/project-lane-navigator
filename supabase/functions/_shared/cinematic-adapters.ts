/**
 * Cinematic Intelligence Kernel — Hybrid adapters
 * Prefer explicit cik.units metadata; fallback to deterministic heuristics.
 */
import type { CinematicUnit, CinematicIntent } from "./cinematic-model.ts";

export interface AdapterResult {
  units: CinematicUnit[];
  mode: "explicit" | "heuristic";
  fallbackReasons?: AdapterFallbackReason[];
}

export interface AdapterFallbackReason {
  type: "missing_fields" | "out_of_range_fields" | "unit_count_mismatch";
  details: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Fixed-lexicon intent inference ───

const INTENT_LEXICONS: [CinematicIntent, RegExp][] = [
  ["threat",  /\b(threat|danger|kill|attack|destroy|hunt|blood|weapon|gun|knife|dead|murder|fear|scream)\b/i],
  ["wonder",  /\b(wonder|magic|beautiful|awe|dream|fantasy|enchant|shimmer|glow|light|radiant|miracle)\b/i],
  ["chaos",   /\b(chaos|explod|crash|shatter|collapse|riot|storm|destruction|fire|inferno|pandemonium)\b/i],
  ["emotion", /\b(love|cry|tear|heart|loss|grief|hope|tender|embrace|farewell|remember|miss)\b/i],
  ["release", /\b(release|free|escape|breathe|peace|calm|resolve|finally|triumph|relief|dawn)\b/i],
];

function inferIntent(text: string): CinematicIntent {
  for (const [intent, rx] of INTENT_LEXICONS) {
    if (rx.test(text)) return intent;
  }
  return "intrigue";
}

// ─── Energy / tension / density / polarity from text ───

const ACTION_VERBS = /\b(run|chase|fight|smash|slam|scream|explode|crash|sprint|strike|punch|throw|leap|charge)\b/gi;

function energyFromText(text: string): number {
  const len = Math.min(text.length, 500);
  const actionHits = (text.match(ACTION_VERBS) || []).length;
  const excl = (text.match(/!/g) || []).length;
  const raw = (len / 500) * 0.3 + Math.min(actionHits, 5) * 0.1 + Math.min(excl, 3) * 0.05;
  return clamp(raw + 0.2, 0, 1);
}

const TENSION_WORDS = /\b(stakes|danger|threat|risk|deadline|bomb|trap|betray|secret|lie|die|survive|urgent)\b/gi;

function tensionFromText(text: string): number {
  const hits = (text.match(TENSION_WORDS) || []).length;
  return clamp(hits * 0.15 + 0.2, 0, 1);
}

function densityFromText(text: string): number {
  const len = Math.min(text.length, 600);
  return clamp(len / 600, 0, 1);
}

const LIGHT_WORDS = /\b(hope|light|warm|sunrise|laugh|joy|bright|gentle|peace|love|tender)\b/gi;
const DARK_WORDS = /\b(dark|death|dread|fear|shadow|cold|bleak|grim|pain|suffering|void)\b/gi;

function polarityFromText(text: string): number {
  const light = (text.match(LIGHT_WORDS) || []).length;
  const dark = (text.match(DARK_WORDS) || []).length;
  const total = light + dark;
  if (total === 0) return 0;
  return clamp((light - dark) / Math.max(total, 1), -1, 1);
}

const VALID_INTENTS = new Set(["intrigue","threat","wonder","chaos","emotion","release"]);
const REQUIRED_FIELDS = ["energy", "tension", "density", "tonal_polarity"] as const;

function makeDefaultUnit(id: string): CinematicUnit {
  return { id, intent: "intrigue", energy: 0.45, tension: 0.45, density: 0.45, tonal_polarity: 0 };
}

/** Validate explicit CIK units; return reasons if invalid. */
function validateExplicitUnits(units: any[], expectedCount?: number): AdapterFallbackReason[] {
  const reasons: AdapterFallbackReason[] = [];
  const missingFields: string[] = [];
  const outOfRange: string[] = [];

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    for (const f of REQUIRED_FIELDS) {
      if (u[f] == null || typeof u[f] !== "number") {
        missingFields.push(`unit[${i}].${f}`);
      }
    }
    if (typeof u.energy === "number" && (u.energy < 0 || u.energy > 1)) outOfRange.push(`unit[${i}].energy=${u.energy}`);
    if (typeof u.tension === "number" && (u.tension < 0 || u.tension > 1)) outOfRange.push(`unit[${i}].tension=${u.tension}`);
    if (typeof u.density === "number" && (u.density < 0 || u.density > 1)) outOfRange.push(`unit[${i}].density=${u.density}`);
    if (typeof u.tonal_polarity === "number" && (u.tonal_polarity < -1 || u.tonal_polarity > 1)) outOfRange.push(`unit[${i}].tonal_polarity=${u.tonal_polarity}`);
  }

  if (missingFields.length > 0) reasons.push({ type: "missing_fields", details: missingFields });
  if (outOfRange.length > 0) reasons.push({ type: "out_of_range_fields", details: outOfRange });
  if (expectedCount != null && units.length !== expectedCount) {
    reasons.push({ type: "unit_count_mismatch", details: [`expected=${expectedCount}`, `actual=${units.length}`] });
  }
  return reasons;
}

// ─── Explicit CIK unit mapper ───

function mapExplicitUnit(u: any, i: number): CinematicUnit {
  return {
    id: u.id || `unit_${i}`,
    intent: (VALID_INTENTS.has(u.intent) ? u.intent : "intrigue") as CinematicIntent,
    energy: clamp(Number(u.energy) || 0.45, 0, 1),
    tension: clamp(Number(u.tension) || 0.45, 0, 1),
    density: clamp(Number(u.density) || 0.45, 0, 1),
    tonal_polarity: clamp(Number(u.tonal_polarity) || 0, -1, 1),
  };
}

function hasExplicitCik(raw: any): boolean {
  return raw?.cik?.units && Array.isArray(raw.cik.units) && raw.cik.units.length > 0;
}

/** Deterministic pad/trim to match expected count exactly. */
export function enforceUnitCount(units: CinematicUnit[], expected: number, expectedKeys?: string[]): CinematicUnit[] {
  if (units.length === expected) return units;
  if (units.length > expected) {
    // Trim: keep first `expected` units (drop tail — least informative)
    return units.slice(0, expected);
  }
  // Pad: add conservative default units using expected keys if provided
  const padded = [...units];
  const existingIds = new Set(units.map(u => u.id));
  while (padded.length < expected) {
    const idx = padded.length;
    const id = expectedKeys && expectedKeys[idx] && !existingIds.has(expectedKeys[idx])
      ? expectedKeys[idx]
      : expectedKeys ? (expectedKeys.find(k => !existingIds.has(k)) ?? `pad_${idx}`) : `pad_${idx}`;
    existingIds.add(id);
    padded.push(makeDefaultUnit(id));
  }
  return padded;
}

// ─── Trailer adapters ───

export function adaptTrailerOutputWithMode(raw: any, expectedUnitCount?: number): AdapterResult {
  if (hasExplicitCik(raw)) {
    const validationIssues = validateExplicitUnits(raw.cik.units, expectedUnitCount);
    if (validationIssues.length === 0) {
      let units = raw.cik.units.map(mapExplicitUnit);
      if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount);
      return { units, mode: "explicit" };
    }
    let units = raw.cik.units.map(mapExplicitUnit);
    if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount);
    return { units, mode: "heuristic", fallbackReasons: validationIssues };
  }
  const items: any[] = raw?.beats || raw?.segments || (Array.isArray(raw) ? raw : []);
  let units = items.map((b: any, i: number) => {
    const text = b.text || b.line || b.description || b.emotional_intent || b.title || "";
    return {
      id: b.beat_index != null ? `beat_${b.beat_index}` : `beat_${i}`,
      intent: inferIntent(text),
      energy: b.movement_intensity_target != null ? clamp(b.movement_intensity_target / 10, 0, 1) : energyFromText(text),
      tension: tensionFromText(text),
      density: b.shot_density_target != null ? clamp(b.shot_density_target / 3, 0, 1) : densityFromText(text),
      tonal_polarity: polarityFromText(text),
    };
  });
  if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount);
  return { units, mode: "heuristic" };
}

export function adaptTrailerOutput(raw: any): CinematicUnit[] {
  return adaptTrailerOutputWithMode(raw).units;
}

// ─── Storyboard adapters ───

export interface StoryboardAdapterOpts {
  expectedUnitCount?: number;
  expectedUnitKeys?: string[];
}

export function adaptStoryboardPanelsWithMode(raw: any, optsOrCount?: StoryboardAdapterOpts | number): AdapterResult {
  const opts: StoryboardAdapterOpts = typeof optsOrCount === "number"
    ? { expectedUnitCount: optsOrCount }
    : (optsOrCount ?? {});
  const expectedUnitCount = opts.expectedUnitCount;
  const expectedUnitKeys = opts.expectedUnitKeys;

  if (hasExplicitCik(raw)) {
    const validationIssues = validateExplicitUnits(raw.cik.units, expectedUnitCount);
    if (validationIssues.length === 0) {
      let units = raw.cik.units.map(mapExplicitUnit);
      if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount, expectedUnitKeys);
      return { units, mode: "explicit" };
    }
    let units = raw.cik.units.map(mapExplicitUnit);
    if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount, expectedUnitKeys);
    return { units, mode: "heuristic", fallbackReasons: validationIssues };
  }
  const items: any[] = raw?.panels || raw?.items || (Array.isArray(raw) ? raw : []);
  let units = items.map((p: any, i: number) => {
    const text = p.prompt || p.description || p.composition || p.action || "";
    return {
      id: p.unit_key || p.id || `panel_${i}`,
      intent: inferIntent(text),
      energy: energyFromText(text),
      tension: tensionFromText(text),
      density: densityFromText(text),
      tonal_polarity: polarityFromText(text),
    };
  });
  if (expectedUnitCount != null) units = enforceUnitCount(units, expectedUnitCount, expectedUnitKeys);
  return { units, mode: "heuristic" };
}

export function adaptStoryboardPanels(raw: any): CinematicUnit[] {
  return adaptStoryboardPanelsWithMode(raw).units;
}

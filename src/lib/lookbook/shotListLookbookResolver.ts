/**
 * shotListLookbookResolver — Resolves canonical script-derived shot list
 * into structured lookbook context for Phase 18.1 Shot-List-Driven Lookbooks.
 *
 * PRIORITY SOURCE: shot_lists + shot_list_items tables
 * NEVER uses: scene_shots, trailer_shotlists, raw scene parser
 *
 * Read-only. No mutations.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LookbookShotSourceItem {
  id: string;
  order_index: number;
  scene_number: string | null;
  scene_heading: string | null;
  shot_type: string | null;
  framing: string | null;
  camera_movement: string | null;
  action: string | null;
  characters_present: string[];
  location: string | null;
  time_of_day: string | null;
  duration_est_seconds: number | null;
}

export interface LookbookShotSource {
  shot_list_id: string;
  items: LookbookShotSourceItem[];
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical shot list for a project.
 * Returns the latest shot list + ordered items, or null if none exist.
 */
export async function resolveProjectLookbookShotSource(
  projectId: string,
): Promise<LookbookShotSource | null> {
  // Fetch the most recent shot list for the project
  const { data: lists, error: listErr } = await (supabase as any)
    .from('shot_lists')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (listErr || !lists?.length) return null;

  const shotListId = lists[0].id;

  // Fetch ordered items
  const { data: rawItems, error: itemErr } = await (supabase as any)
    .from('shot_list_items')
    .select('id, order_index, scene_number, scene_heading, shot_type, framing, camera_movement, action, characters_present, location, time_of_day, duration_est_seconds')
    .eq('shot_list_id', shotListId)
    .order('order_index', { ascending: true });

  if (itemErr || !rawItems?.length) return null;

  const items: LookbookShotSourceItem[] = rawItems.map((r: any) => ({
    id: r.id,
    order_index: r.order_index ?? 0,
    scene_number: r.scene_number || null,
    scene_heading: r.scene_heading || null,
    shot_type: r.shot_type || null,
    framing: r.framing || null,
    camera_movement: r.camera_movement || null,
    action: r.action || null,
    characters_present: Array.isArray(r.characters_present)
      ? r.characters_present.filter((c: any) => typeof c === 'string')
      : [],
    location: r.location || null,
    time_of_day: r.time_of_day || null,
    duration_est_seconds: typeof r.duration_est_seconds === 'number' ? r.duration_est_seconds : null,
  }));

  return { shot_list_id: shotListId, items };
}

// ── Slide-to-Shot Mapping ────────────────────────────────────────────────────
// Deterministic mapping from lookbook slide type → best-fit shot list items.
// Uses only canonical metadata: shot_type, framing, camera_movement, action,
// characters_present, location, time_of_day, and ordering position.

/**
 * Score a single shot item for a given slide type.
 * Higher score = better fit. Deterministic.
 */
function scoreShotForSlide(
  item: LookbookShotSourceItem,
  slideType: string,
  totalItems: number,
): number {
  let score = 0;
  const positionRatio = totalItems > 1 ? item.order_index / (totalItems - 1) : 0.5;
  const framing = (item.framing || '').toUpperCase();
  const shotType = (item.shot_type || '').toUpperCase();
  const movement = (item.camera_movement || '').toUpperCase();
  const action = (item.action || '').toLowerCase();
  const hasCharacters = item.characters_present.length > 0;

  switch (slideType) {
    case 'cover':
    case 'poster_directions':
      // Prefer iconic / high-energy shots near beginning or central premise
      if (['WS', 'MS'].includes(framing)) score += 8;
      if (hasCharacters) score += 5;
      if (action.includes('reveal') || action.includes('confront') || action.includes('discover')) score += 6;
      // Prefer early-to-mid shots for cover
      if (positionRatio < 0.4) score += 4;
      break;

    case 'world':
      // Prefer wide/establishing/environmental shots
      if (['WS', 'AERIAL'].includes(framing) || shotType === 'WS' || shotType === 'AERIAL') score += 10;
      if (item.location) score += 6;
      if (item.time_of_day) score += 3;
      if (!hasCharacters) score += 4; // Pure environment
      if (movement === 'STATIC' || movement === 'PAN') score += 2;
      break;

    case 'characters':
      // Prefer close-up / medium with single character presence
      if (['CU', 'ECU', 'MS'].includes(framing)) score += 8;
      if (item.characters_present.length === 1) score += 6;
      else if (hasCharacters) score += 3;
      break;

    case 'key_moments':
      // Prefer high-intensity action/tension shots
      if (hasCharacters) score += 4;
      if (action.includes('fight') || action.includes('chase') || action.includes('confront') ||
          action.includes('reveal') || action.includes('discover') || action.includes('escape')) score += 8;
      if (['OTS', '2SHOT', 'TRACKING'].includes(shotType)) score += 5;
      if (movement !== 'STATIC') score += 3;
      // Prefer mid-to-late dramatic peaks
      if (positionRatio > 0.3 && positionRatio < 0.8) score += 4;
      break;

    case 'story_engine':
      // Prefer conflict-driving / relational moments
      if (item.characters_present.length >= 2) score += 8;
      if (['OTS', '2SHOT'].includes(shotType)) score += 6;
      if (action.includes('argue') || action.includes('tension') || action.includes('confront') ||
          action.includes('betray') || action.includes('negotiate')) score += 6;
      if (['CU', 'MS'].includes(framing)) score += 3;
      break;

    case 'themes':
    case 'visual_language':
      // Prefer atmospheric / reflective / design-weighted
      if (['WS', 'INSERT'].includes(framing) || shotType === 'INSERT') score += 6;
      if (item.location) score += 3;
      if (!hasCharacters || item.characters_present.length === 0) score += 4;
      if (item.time_of_day) score += 3;
      if (movement === 'STATIC' || movement === 'PAN') score += 2;
      break;

    case 'closing':
      // Prefer later reflective / aftermath / resolution-like
      if (positionRatio > 0.7) score += 8;
      if (action.includes('depart') || action.includes('walk') || action.includes('reflect') ||
          action.includes('end') || action.includes('silence') || action.includes('leave')) score += 6;
      if (['WS', 'MS'].includes(framing)) score += 3;
      break;

    default:
      // Neutral: slight preference for variety
      score += 2;
  }

  return score;
}

/**
 * Map shot source items to a specific lookbook slide type.
 * Returns top-N best-fit items, deterministically sorted.
 */
export function mapShotSourceToSlideType(
  slideType: string,
  source: LookbookShotSource,
  maxItems: number = 5,
): LookbookShotSourceItem[] {
  if (!source.items.length) return [];

  const totalItems = source.items.length;
  const scored = source.items.map(item => ({
    item,
    score: scoreShotForSlide(item, slideType, totalItems),
  }));

  // Deterministic sort: score desc, then order_index asc, then id asc
  scored.sort((a, b) =>
    b.score - a.score ||
    a.item.order_index - b.item.order_index ||
    a.item.id.localeCompare(b.item.id),
  );

  return scored.slice(0, maxItems).map(s => s.item);
}

// ── Serialization helpers ────────────────────────────────────────────────────

/**
 * Build a prompt context block from shot list items.
 * Used for prompt injection in the generation edge function.
 */
export function buildShotListPromptBlock(items: LookbookShotSourceItem[]): string {
  if (!items.length) return '';

  const lines = ['[SHOT LIST CONTEXT — CANONICAL CINEMATIC SOURCE]', ''];

  // Use the top item as primary, reference others for texture
  const primary = items[0];

  if (primary.scene_heading) lines.push(`SCENE: ${primary.scene_heading}`);
  if (primary.action) lines.push(`ACTION: ${primary.action}`);
  if (primary.characters_present.length > 0) {
    lines.push(`CHARACTERS PRESENT: ${primary.characters_present.join(', ')}`);
  }
  if (primary.location) lines.push(`LOCATION: ${primary.location}`);
  if (primary.time_of_day) lines.push(`TIME OF DAY: ${primary.time_of_day}`);
  if (primary.framing) lines.push(`FRAMING: ${primary.framing}`);
  if (primary.camera_movement) lines.push(`CAMERA MOVEMENT: ${primary.camera_movement}`);

  if (items.length > 1) {
    lines.push('');
    lines.push(`ADDITIONAL SCENE CONTEXT (${items.length - 1} more shots from this section):`);
    for (const item of items.slice(1, 3)) {
      const parts: string[] = [];
      if (item.scene_heading) parts.push(item.scene_heading);
      if (item.action) parts.push(item.action.slice(0, 80));
      if (parts.length) lines.push(`  • ${parts.join(' — ')}`);
    }
  }

  lines.push('');
  lines.push('Generate this image grounded in this specific cinematic plan.');

  return lines.join('\n');
}

/**
 * Derive intensity from shot list metadata.
 * Returns 0–1 based on shot type, movement, and position signals.
 */
export function deriveShotListIntensity(
  items: LookbookShotSourceItem[],
  totalItems: number,
): number {
  if (!items.length) return 0.5;

  const primary = items[0];
  let intensity = 0.5;

  // Movement adds energy
  const movement = (primary.camera_movement || '').toUpperCase();
  if (['TRACKING', 'HANDHELD', 'CRANE'].includes(movement)) intensity += 0.15;
  else if (['PAN', 'TILT', 'DOLLY'].includes(movement)) intensity += 0.08;

  // Framing: close-ups are more intense than wides
  const framing = (primary.framing || '').toUpperCase();
  if (['CU', 'ECU'].includes(framing)) intensity += 0.1;
  else if (['WS', 'AERIAL'].includes(framing)) intensity -= 0.05;

  // Action text signals
  const action = (primary.action || '').toLowerCase();
  if (action.includes('fight') || action.includes('chase') || action.includes('confront')) intensity += 0.15;
  if (action.includes('silence') || action.includes('still') || action.includes('calm')) intensity -= 0.1;

  // Position in script (late = higher intensity generally)
  if (totalItems > 1) {
    const posRatio = primary.order_index / (totalItems - 1);
    // Slight arc: higher in the middle/late sections
    if (posRatio > 0.3 && posRatio < 0.8) intensity += 0.05;
  }

  return Math.max(0, Math.min(1, intensity));
}

/**
 * Derive emotional state from shot list metadata.
 * Returns a deterministic string label.
 */
export function deriveShotListEmotionalState(item: LookbookShotSourceItem): string {
  const action = (item.action || '').toLowerCase();
  const framing = (item.framing || '').toUpperCase();

  if (action.includes('fight') || action.includes('chase') || action.includes('escape')) return 'tension';
  if (action.includes('confront') || action.includes('argue') || action.includes('betray')) return 'conflict';
  if (action.includes('reveal') || action.includes('discover')) return 'anticipation';
  if (action.includes('depart') || action.includes('leave') || action.includes('end')) return 'resolution';
  if (action.includes('embrace') || action.includes('kiss') || action.includes('love')) return 'intimate';
  if (['CU', 'ECU'].includes(framing)) return 'intimate';
  if (['WS', 'AERIAL'].includes(framing)) return 'awe';

  return 'neutral';
}

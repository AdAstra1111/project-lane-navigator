/**
 * narrativeMoments — Client-side narrative moment resolver for lookbook slides.
 *
 * Resolves a deterministic “narrative moment” per slide from available canon data.
 * Used by the pipeline for provenance and by the viewer for diagnostics.
 *
 * The ACTUAL narrative moment injection into generation prompts happens
 * server-side in the edge function (loadNarrativeMoments + selectNarrativeMoment).
 * This client-side engine provides the pipeline with structured moment context
 * for election scoring and assembly diagnostics.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface NarrativeMomentContext {
  moment_text: string;
  characters_present: string[];
  emotional_state: string;
  intensity: number; // 0–1
}

// ── Slide → Intensity Map ────────────────────────────────────────────────────
// Deterministic editorial intensity per slide type

const SLIDE_INTENSITY: Record<string, number> = {
  cover: 0.7,
  creative_statement: 0.3,
  overview: 0.4,
  world: 0.3,
  characters: 0.5,
  key_moments: 0.9,
  story_engine: 0.8,
  themes: 0.5,
  visual_language: 0.4,
  comparables: 0.2,
  poster_directions: 0.85,
  closing: 0.6,
};

// ── Emotional state inference ────────────────────────────────────────────────

const SLIDE_EMOTIONAL_STATE: Record<string, string> = {
  cover: 'anticipation',
  creative_statement: 'contemplative',
  overview: 'neutral',
  world: 'awe',
  characters: 'intimate',
  key_moments: 'tension',
  story_engine: 'conflict',
  themes: 'reflective',
  visual_language: 'observational',
  comparables: 'analytical',
  poster_directions: 'dramatic',
  closing: 'resolution',
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve a deterministic narrative moment for a lookbook slide.
 *
 * @param slideType - The canonical slide type
 * @param canonJson - Project canon data (logline, premise, characters, etc.)
 * @param slideTitle - Optional slide title for context
 * @param slideBody - Optional slide body text for context
 */
export function resolveNarrativeMomentForSlide(
  slideType: string,
  canonJson: Record<string, unknown> | null,
  slideTitle?: string,
  slideBody?: string,
): NarrativeMomentContext {
  const intensity = SLIDE_INTENSITY[slideType] ?? 0.5;
  const emotional_state = SLIDE_EMOTIONAL_STATE[slideType] ?? 'neutral';

  // Extract characters from canon if available
  let characters_present: string[] = [];
  if (canonJson?.characters && Array.isArray(canonJson.characters)) {
    characters_present = canonJson.characters
      .slice(0, 4)
      .map((c: any) => (typeof c === 'string' ? c : c?.name || ''))
      .filter(Boolean);
  }

  // For non-character slides, reduce character presence
  if (['world', 'visual_language', 'themes', 'comparables', 'closing'].includes(slideType)) {
    characters_present = [];
  }
  // For character slides, keep all
  // For scene slides, keep top 2
  if (['key_moments', 'story_engine', 'cover', 'poster_directions'].includes(slideType)) {
    characters_present = characters_present.slice(0, 2);
  }

  // Build moment text from available canon
  const logline = typeof canonJson?.logline === 'string' ? canonJson.logline : '';
  const premise = typeof canonJson?.premise === 'string' ? canonJson.premise : '';
  const conflict = typeof canonJson?.central_conflict === 'string' ? canonJson.central_conflict : '';

  let moment_text = '';
  switch (slideType) {
    case 'cover':
    case 'poster_directions':
      moment_text = logline || premise || 'The story begins.';
      break;
    case 'key_moments':
      moment_text = conflict || premise || 'A pivotal dramatic moment.';
      break;
    case 'story_engine':
      moment_text = conflict || 'The central tension that drives the narrative.';
      break;
    case 'world':
      moment_text = typeof canonJson?.world_description === 'string'
        ? canonJson.world_description
        : 'The world of the story.';
      break;
    case 'characters':
      moment_text = 'The individuals whose choices shape the story.';
      break;
    case 'themes':
      moment_text = Array.isArray(canonJson?.themes)
        ? canonJson.themes.filter((t: any) => typeof t === 'string').join(', ')
        : 'The thematic undercurrents.';
      break;
    case 'creative_statement':
      moment_text = slideBody || premise || 'The creative vision.';
      break;
    default:
      moment_text = logline || premise || slideTitle || 'A moment from the story.';
  }

  // Truncate to reasonable length
  if (moment_text.length > 300) {
    moment_text = moment_text.slice(0, 297) + '...';
  }

  return {
    moment_text,
    characters_present,
    emotional_state,
    intensity,
  };
}

/**
 * Serialize a narrative moment into a prompt block.
 * Used when building prompts client-side (e.g., requirementExecutor).
 */
export function serializeNarrativeMoment(moment: NarrativeMomentContext): string {
  const lines = ['[NARRATIVE MOMENT — STORY CONTEXT]', ''];
  lines.push(`MOMENT: ${moment.moment_text}`);
  if (moment.characters_present.length > 0) {
    lines.push(`CHARACTERS PRESENT: ${moment.characters_present.join(', ')}`);
  }
  lines.push(`EMOTIONAL STATE: ${moment.emotional_state}`);
  lines.push(`INTENSITY: ${(moment.intensity * 100).toFixed(0)}%`);
  lines.push('');
  lines.push('Generate this image to embody this narrative context.');
  return lines.join('\n');
}

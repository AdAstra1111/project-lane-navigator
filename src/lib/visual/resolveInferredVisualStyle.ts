/**
 * resolveInferredVisualStyle — Derives a VSAL profile from canon, project metadata,
 * and existing visual assets. Produces reasonable defaults so VSAL never starts empty.
 */
import { supabase } from '@/integrations/supabase/client';

export interface InferredVisualStyle {
  period: string;
  cultural_context: string;
  lighting_philosophy: string;
  camera_philosophy: string;
  composition_philosophy: string;
  texture_materiality: string;
  color_response: string;
  environment_realism: string;
  forbidden_traits: string[];
}

interface CanonData {
  world_description?: string;
  setting?: string;
  locations?: string;
  tone_style?: string;
  tone?: string;
  themes?: string | string[];
  logline?: string;
  premise?: string;
  world_rules?: string;
  timeline?: string;
  format_constraints?: string;
  [key: string]: unknown;
}

interface ProjectMeta {
  format?: string;
  genres?: string[];
  tone?: string;
  assigned_lane?: string;
}

// ── Genre/tone → style mapping tables ──────────────────────────────────────

const GENRE_LIGHTING: Record<string, string> = {
  horror: 'Low-key, high contrast, deep shadows with isolated pools of light',
  thriller: 'Atmospheric, chiaroscuro, motivated practical sources',
  drama: 'Naturalistic, soft ambient with directional warmth',
  comedy: 'Even, bright, open lighting with minimal shadows',
  romance: 'Golden hour warmth, soft diffusion, backlit halos',
  'sci-fi': 'Cool blue-white key, neon accents, volumetric haze',
  fantasy: 'Ethereal, dappled, god-rays through atmosphere',
  documentary: 'Available light, unmanipulated, observational',
  war: 'Harsh directional, smoke-filtered, desaturated',
  noir: 'Hard shadows, venetian blinds, single-source pools',
};

const GENRE_CAMERA: Record<string, string> = {
  horror: 'Slow dolly, static wide with sudden close-up intrusions',
  thriller: 'Handheld tension, telephoto compression, canted angles',
  drama: 'Steady, observational, medium shots with patient holds',
  comedy: 'Loose framing, two-shots, comfortable distance',
  romance: 'Shallow depth of field, close-ups, gentle movement',
  'sci-fi': 'Wide anamorphic, symmetrical compositions, slow push-ins',
  fantasy: 'Sweeping crane moves, epic wides, rack focus reveals',
  documentary: 'Handheld, verité, reactive framing',
  war: 'Shaky handheld, ground-level, embedded perspective',
};

const GENRE_COLOR: Record<string, string> = {
  horror: 'Desaturated with sickly green or amber undertones',
  thriller: 'Cool teal and orange, restrained palette',
  drama: 'Earth tones, warm midtones, naturalistic response',
  comedy: 'Saturated, warm, inviting color palette',
  romance: 'Warm pastels, rose gold, soft color grading',
  'sci-fi': 'Steel blue, neon accent, clinical whites',
  fantasy: 'Rich jewel tones, emerald, gold, deep purple',
  documentary: 'Ungraded, true-to-life color response',
  war: 'Bleached, desaturated olive and rust',
};

const GENRE_TEXTURE: Record<string, string> = {
  horror: 'Decayed surfaces, moisture, organic rot, rough textures',
  thriller: 'Polished urban, glass, steel, clinical surfaces',
  drama: 'Lived-in, worn fabrics, natural wood, tactile warmth',
  comedy: 'Clean, bright, everyday materials',
  romance: 'Soft fabrics, flowers, warm natural materials',
  'sci-fi': 'Sleek metal, holographic, synthetic materials',
  fantasy: 'Hand-crafted, stone, leather, forged metal, organic',
  documentary: 'As-found, unart-directed, authentic surfaces',
  war: 'Mud, torn fabric, scorched metal, battlefield debris',
};

function inferPeriod(canon: CanonData, meta: ProjectMeta): string {
  const sources = [canon.timeline, canon.setting, canon.world_description, canon.world_rules].filter(Boolean).join(' ');
  if (!sources) return meta.assigned_lane === 'feature_film' ? 'Contemporary' : 'Contemporary';

  const lower = sources.toLowerCase();
  if (/medieval|feudal|ancient|viking|roman|greek/.test(lower)) return 'Medieval / Ancient';
  if (/1920|1930|prohibition|jazz age/.test(lower)) return '1920s–1930s';
  if (/1940|wartime|world war|ww2|wwii/.test(lower)) return '1940s wartime';
  if (/1950|1960|mid-century/.test(lower)) return '1950s–1960s';
  if (/1970|1980|retro/.test(lower)) return '1970s–1980s';
  if (/1990|2000/.test(lower)) return '1990s–2000s';
  if (/futur|dystop|post-apoc|space|cyber/.test(lower)) return 'Near-future / Speculative';
  if (/victorian|edwardian|regency|19th century/.test(lower)) return '19th Century';

  return 'Contemporary';
}

function inferCulturalContext(canon: CanonData): string {
  const sources = [canon.setting, canon.world_description, canon.locations].filter(Boolean).join(' ');
  if (!sources) return 'Universal / unspecified';
  return sources.split(/[.,;]/).filter(Boolean).slice(0, 2).map(s => s.trim()).join(', ') || 'Universal / unspecified';
}

function matchGenre(genres: string[] | undefined): string | null {
  if (!genres?.length) return null;
  const normalised = genres.map(g => g.toLowerCase().replace(/[^a-z-]/g, ''));
  for (const g of normalised) {
    if (GENRE_LIGHTING[g]) return g;
  }
  // partial match
  for (const g of normalised) {
    for (const key of Object.keys(GENRE_LIGHTING)) {
      if (g.includes(key) || key.includes(g)) return key;
    }
  }
  return null;
}

function inferTone(canon: CanonData, meta: ProjectMeta): string {
  return canon.tone_style || canon.tone as string || meta.tone || '';
}

export async function resolveInferredVisualStyle(projectId: string): Promise<InferredVisualStyle> {
  // Load canon
  let canonJson: CanonData = {};
  try {
    const { data } = await (supabase as any)
      .from('project_canon')
      .select('canon_json')
      .eq('project_id', projectId)
      .maybeSingle();
    if (data?.canon_json && typeof data.canon_json === 'object') {
      canonJson = data.canon_json as CanonData;
    }
  } catch { /* non-fatal */ }

  // Load project metadata
  let projectMeta: ProjectMeta = {};
  try {
    const { data } = await supabase
      .from('projects')
      .select('format, genres, tone, assigned_lane')
      .eq('id', projectId)
      .single();
    if (data) projectMeta = data as ProjectMeta;
  } catch { /* non-fatal */ }

  const genre = matchGenre(projectMeta.genres);
  const tone = inferTone(canonJson, projectMeta);

  const period = inferPeriod(canonJson, projectMeta);
  const cultural_context = inferCulturalContext(canonJson);

  const lighting_philosophy = GENRE_LIGHTING[genre || '']
    || (tone.toLowerCase().includes('dark') ? 'Low-key, atmospheric, motivated practical sources' : 'Naturalistic, soft ambient with directional warmth');

  const camera_philosophy = GENRE_CAMERA[genre || '']
    || 'Steady, observational, medium shots with patient holds';

  const composition_philosophy = period.includes('Contemporary')
    ? 'Balanced, natural framing, story-motivated composition'
    : 'Period-appropriate, non-modern staging, environmental context';

  const texture_materiality = GENRE_TEXTURE[genre || '']
    || 'Lived-in, authentic materials appropriate to setting';

  const color_response = GENRE_COLOR[genre || '']
    || 'Naturalistic, period-appropriate color response';

  const environment_realism = period.includes('Contemporary')
    ? 'Grounded in recognisable reality, no stylisation unless motivated'
    : `Historically grounded for ${period}, no anachronistic modern elements`;

  // Derive forbidden traits from period
  const forbidden_traits: string[] = [];
  if (!period.includes('Contemporary') && !period.includes('future')) {
    forbidden_traits.push('modern lens flare', 'digital sharpness', 'neon lighting', 'contemporary furniture');
  }
  if (genre === 'documentary') {
    forbidden_traits.push('cinematic colour grading', 'staged compositions', 'studio lighting');
  }

  return {
    period,
    cultural_context,
    lighting_philosophy,
    camera_philosophy,
    composition_philosophy,
    texture_materiality,
    color_response,
    environment_realism,
    forbidden_traits,
  };
}
